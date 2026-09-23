import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import {
  Candidate, CommonsLicence, canSearch, creditLine, modelCacheKey, pickBest, searchPhrase,
} from "./commonsPolicy";

if (!admin.apps.length) admin.initializeApp();

// --- Automatic stock photos from Wikimedia Commons ---------------------------
//
// Devices have no photos, and nobody has time to take one for every phone that
// comes through the door. So a device with a brand and a model gets a stock
// photo of that MODEL fetched for it, labelled as a stock photo everywhere it
// is shown publicly, and replaced the moment somebody takes a real one.
//
// WHY THE SERVER: the browser never touches Commons. This runs with Admin
// credentials, writes to a public Storage prefix no client may write to
// arbitrarily, and — more importantly — the licence check has to happen
// somewhere a client cannot skip it.
//
// EVERY DECISION IS IN commonsPolicy.ts, which is pure and tested: whether the
// licence permits commercial use, and whether the file is actually a picture of
// the model asked for. Both fail closed. A wrong photo is worse than no photo,
// and an unlicensed one is worse than both.
//
// FAILURE IS NORMAL AND QUIET. No photo found means no photo. Nothing is shown
// to staff, because "we couldn't find a picture of your phone" is not
// information anybody needs.

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
// Commons asks for a descriptive User-Agent identifying the caller.
const USER_AGENT = "FlipThatTech-Dashboard/1.0 (shop inventory photos; contact via shop)";

/** The two sizes stored. Commons resizes for us, so no image library is needed. */
const FULL_WIDTH = 1600;
const THUMB_WIDTH = 400;

interface CommonsPage {
  title?: string;
  imageinfo?: {
    url?: string;
    thumburl?: string;
    width?: number;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

const meta = (page: CommonsPage, key: string): string | undefined =>
  page.imageinfo?.[0]?.extmetadata?.[key]?.value;

async function commonsJson(params: Record<string, string>): Promise<any> {
  const url = `${COMMONS_API}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Commons responded ${res.status}`);
  return res.json();
}

/**
 * Ask Commons for candidate files, with their licence metadata and a
 * pre-resized thumbnail URL at the width we intend to store.
 *
 * `generator=search` + `prop=imageinfo` in ONE call, so a lookup is one round
 * trip rather than a search followed by n metadata fetches.
 */
async function searchCommons(phrase: string, width: number): Promise<CommonsPage[]> {
  const data = await commonsJson({
    action: "query",
    generator: "search",
    gsrsearch: `filetype:bitmap ${phrase}`,
    gsrnamespace: "6",              // File:
    gsrlimit: "12",
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: String(width),
  });
  const pages = data?.query?.pages;
  return pages ? (Object.values(pages) as CommonsPage[]) : [];
}

/** Fetch bytes and put them in the device-photos prefix. */
async function store(url: string, destination: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Image fetch responded ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const file = admin.storage().bucket().file(destination);
  await file.save(buffer, {
    contentType: "image/jpeg",
    // These are shown on the kiosk and on Marketplace share links, which have
    // no login — see storage.rules for why that is deliberate.
    public: true,
    metadata: { cacheControl: "public, max-age=31536000, immutable" },
  });
  return file.publicUrl();
}

export interface FoundPhoto {
  url: string;
  thumbUrl: string;
  credit: string;
  sourceUrl: string;
}

/**
 * The model → photo cache.
 *
 * KEYED ON THE MODEL, NOT THE DEVICE. Two iPhone 13 Pros cost one Commons
 * lookup and one stored copy: the second device references the same URLs. The
 * cache also remembers a MISS, so a model Commons has never heard of is not
 * re-searched every time one comes through the door.
 *
 * user_data/{ws}/deviceImageCache/{modelKey}
 */
interface CacheEntry {
  photo?: FoundPhoto;
  missedAt?: number;
  at: number;
}

/** How long a miss is remembered before trying again. */
const MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

async function cached(ws: string, key: string): Promise<CacheEntry | null> {
  const snap = await admin.firestore().doc(`user_data/${ws}/deviceImageCache/${key}`).get();
  return snap.exists ? (snap.data() as CacheEntry) : null;
}

/**
 * Find and store a stock photo for a model. Returns null when there is nothing
 * confidently matching and usable — which is a normal outcome, not an error.
 */
export async function findStockPhoto(
  workspaceId: string,
  brand: string,
  model: string,
): Promise<FoundPhoto | null> {
  if (!canSearch(brand, model)) return null;

  const key = modelCacheKey(brand, model);
  const hit = await cached(workspaceId, key);
  if (hit?.photo) return hit.photo;
  if (hit?.missedAt && Date.now() - hit.missedAt < MISS_TTL_MS) return null;

  const phrase = searchPhrase(brand, model);
  let pages: CommonsPage[];
  try {
    pages = await searchCommons(phrase, FULL_WIDTH);
  } catch {
    return null;                                    // Commons down: quietly none
  }

  const candidates: Candidate[] = pages
    .filter(p => p.title && p.imageinfo?.[0])
    .map(p => ({
      title: p.title!,
      width: p.imageinfo![0].width,
      licence: {
        shortName: meta(p, "LicenseShortName"),
        usageTerms: meta(p, "UsageTerms"),
        artist: meta(p, "Artist"),
        attributionRequired: meta(p, "AttributionRequired"),
      } as CommonsLicence,
    }));

  const best = pickBest(phrase, candidates);
  if (!best) {
    await admin.firestore().doc(`user_data/${workspaceId}/deviceImageCache/${key}`)
      .set({ missedAt: Date.now(), at: Date.now() } as CacheEntry);
    return null;
  }

  const page = pages.find(p => p.title === best.title)!;
  const info = page.imageinfo![0];
  const fullSource = info.thumburl || info.url;
  if (!fullSource) return null;

  let thumbSource = fullSource;
  try {
    const small = await searchCommons(phrase, THUMB_WIDTH);
    thumbSource = small.find(p => p.title === best.title)?.imageinfo?.[0]?.thumburl || fullSource;
  } catch {
    // A missing thumbnail is cosmetic; the full image still works.
  }

  try {
    // Stored under the CACHE key, not a device id — one copy per model.
    const base = `deviceImages/${workspaceId}/_stock/${key}`;
    const [url, thumbUrl] = await Promise.all([
      store(fullSource, `${base}.jpg`),
      store(thumbSource, `${base}_thumb.jpg`),
    ]);
    const photo: FoundPhoto = {
      url,
      thumbUrl,
      credit: creditLine(best.licence, best.title),
      sourceUrl: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(best.title)}`,
    };
    await admin.firestore().doc(`user_data/${workspaceId}/deviceImageCache/${key}`)
      .set({ photo, at: Date.now() } as CacheEntry);
    return photo;
  } catch {
    return null;
  }
}

/** Attach a found photo to a device, unless it already has one. */
async function attach(ws: string, collection: string, itemId: string, photo: FoundPhoto): Promise<void> {
  const ref = admin.firestore().doc(`user_data/${ws}/${collection}/${itemId}`);
  await admin.firestore().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists) return;
    const photos = (snap.data()?.photos as unknown[]) || [];
    // Somebody may have taken a real photo while Commons was answering. Theirs
    // wins; this one is not added at all.
    if (photos.length > 0) return;
    tx.update(ref, {
      photos: [{
        id: `stock-${Date.now().toString(36)}`,
        url: photo.url,
        thumbUrl: photo.thumbUrl,
        kind: "stock",
        credit: photo.credit,
        sourceUrl: photo.sourceUrl,
        addedBy: "auto",
        addedAt: Date.now(),
      }],
    });
  });
}

/**
 * DEBOUNCE. Renaming a device letter by letter must not fire a Commons search
 * per keystroke. A model is only looked up once every DEBOUNCE_MS per
 * instance; the trigger also skips any device that already has a photo, which
 * catches most of it.
 */
const DEBOUNCE_MS = 60_000;
const RECENT = new Map<string, number>();
function recentlyTried(key: string): boolean {
  const now = Date.now();
  const last = RECENT.get(key);
  if (last && now - last < DEBOUNCE_MS) return true;
  RECENT.set(key, now);
  if (RECENT.size > 5000) RECENT.clear();
  return false;
}

/**
 * On create, or when brand/model changes on a device with no photo.
 *
 * Deliberately does nothing when the device already has a photo — including a
 * stock one, so an edit to an unrelated field never replaces a real photo
 * somebody took.
 */
export const autoDevicePhoto = onDocumentWritten(
  { document: "user_data/{ws}/inventory/{itemId}", region: "us-central1" },
  async (event) => {
    const after = event.data?.after?.data() as Record<string, unknown> | undefined;
    if (!after) return;
    const before = event.data?.before?.data() as Record<string, unknown> | undefined;

    const photos = (after.photos as unknown[]) || [];
    if (photos.length > 0) return;                        // already has one
    if (after.kind === "accessory") return;

    const brand = String(after.brand ?? "").trim();
    const model = String(after.model ?? "").trim();
    if (!canSearch(brand, model)) return;

    // Only on create, or when the thing we search on actually changed.
    const changed = !before
      || String(before.brand ?? "").trim() !== brand
      || String(before.model ?? "").trim() !== model;
    if (!changed) return;

    const ws = event.params.ws as string;
    if (recentlyTried(`${ws}|${modelCacheKey(brand, model)}`)) return;

    const photo = await findStockPhoto(ws, brand, model);
    if (photo) await attach(ws, "inventory", event.params.itemId as string, photo);
  }
);

/**
 * "Find a photo" — the same thing, asked for explicitly.
 *
 * Staff-only, and it says whether it found one, because somebody who PRESSED a
 * button is owed an answer. (The automatic path stays silent; nobody asked it.)
 */
export const findDevicePhoto = onCall(
  { region: "us-central1" },
  async (request: CallableRequest<{ itemId?: unknown; brand?: unknown; model?: unknown }>) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Sign in first.");

    const userSnap = await admin.firestore().doc(`users/${uid}`).get();
    const user = userSnap.data() as Record<string, unknown> | undefined;
    const ws = String(user?.workspaceId ?? "");
    if (!ws || user?.disabled === true || user?.role === "kiosk") {
      throw new HttpsError("permission-denied", "You don't have access to that.");
    }

    const itemId = String(request.data?.itemId ?? "").trim();
    const brand = String(request.data?.brand ?? "").trim();
    const model = String(request.data?.model ?? "").trim();
    if (!itemId || !canSearch(brand, model)) {
      return { found: false as const };
    }

    const photo = await findStockPhoto(ws, brand, model);
    if (!photo) return { found: false as const };
    await attach(ws, "inventory", itemId, photo);
    return { found: true as const };
  }
);
