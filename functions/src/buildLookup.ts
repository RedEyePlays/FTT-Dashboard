import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  PublicBuildResult, ShopProfile, shareVisible, toPublicBuild,
} from "./publicBuildPolicy";

if (!admin.apps.length) admin.initializeApp();

// --- Public PC-build listing lookup -----------------------------------------
//
// The shop posts builds on Facebook Marketplace and wants one link per build
// showing the specs, the price, and what the same parts cost new elsewhere.
//
// Same security model as repairStatusLookup, for the same reasons:
//   • The Admin SDK reads server-side, so no client Firestore rule is relaxed
//     and the browser never touches the pcBuilds collection directly. A build
//     document holds part COSTS, supplier links and part serials — none of it
//     can be reached from a browser at any price.
//   • The ONLY input is the share reference. There is no index and no way to
//     browse; holding the reference is the whole of the access check. Two
//     formats resolve: the original 26-character token (domain/buildShare.ts)
//     and the short readable code that replaced it for NEW links
//     (domain/shareCode.ts) — eight letters somebody can type off a
//     Marketplace description, at the cost of being far more guessable, which
//     is why the throttle below now also caps attempts per IP.
//   • What comes back is built field by field by publicBuildPolicy.ts from an
//     allow-list, never the stored document with fields deleted.
//   • Unknown, cleared and expired tokens all return the SAME plain not-found,
//     so nobody can tell a token that never existed from one that was revoked.
//   • A best-effort in-memory throttle by IP + token, as next door.
//     (For production, also enable Firebase App Check on this callable.)

interface LookupRequest {
  token?: unknown;
}

// Best-effort per-instance throttle, matching repairLookup.ts.
const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

/**
 * TWO LIMITS, AND THE SECOND ONE IS NEW.
 *
 * The original throttle keyed on IP **+ token**, which caps hammering ONE link
 * but does nothing about an address trying a DIFFERENT code every request —
 * every attempt lands in its own bucket. That was tolerable when a reference
 * was 26 random characters and guessing was not a strategy at any rate.
 *
 * Share codes are now eight readable letters (domain/shareCode.ts, ~6.8M
 * combinations), so sweeping is at least arithmetically imaginable and the
 * per-code limit is the wrong shape for it. MAX_PER_IP_WINDOW caps the total
 * attempts from one address regardless of which code is asked for: at 60 a
 * minute, covering the space once takes about 128 days of uninterrupted
 * guessing from a single IP, for the reward of seeing a PC the shop is
 * advertising publicly anyway.
 */
const MAX_PER_IP_WINDOW = 60;

function hit(key: string, max: number): boolean {
  const now = Date.now();
  const recent = (HITS.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  HITS.set(key, recent);
  if (HITS.size > 5000) HITS.clear(); // crude memory bound
  return recent.length > max;
}

function throttled(ip: string, ref: string): boolean {
  // Both are always recorded — `||` would stop counting the IP as soon as the
  // per-code limit tripped, which is exactly backwards.
  const perRef = hit(`${ip}|${ref}`, MAX_PER_WINDOW);
  const perIp = hit(`ip|${ip}`, MAX_PER_IP_WINDOW);
  return perRef || perIp;
}

// A listing changes rarely and may be opened by many people at once when a
// Marketplace post lands, so a short cache keeps a burst off Firestore. Short
// enough that "Sold" appears on the page within a minute of the sale.
const CACHE_MS = 60_000;
const CACHE = new Map<string, { at: number; value: PublicBuildResult }>();

/** The shop profile the page shows, read from the workspace meta document. */
async function shopProfileFor(workspacePath: string): Promise<ShopProfile> {
  try {
    const snap = await admin.firestore().doc(`${workspacePath}/meta/app`).get();
    const settings = (snap.data() as Record<string, unknown> | undefined)?.settings as
      | Record<string, unknown>
      | undefined;
    const general = (settings?.general || {}) as Record<string, unknown>;
    const store = (settings?.store || {}) as Record<string, unknown>;
    const operations = (settings?.operations || {}) as Record<string, unknown>;
    return {
      name: general.storeName ?? store.storeName,
      phone: store.phone ?? general.phone,
      address: store.address ?? general.address,
      email: store.email ?? general.email,
      warrantyDays: operations.deviceWarrantyDays,
      // The shop's reviewed per-GPU frame-rate table. The page shows the
      // figures the shop APPROVED, never a fresh opinion — which is the whole
      // reason the table exists (domain/gpuPerformance.ts).
      gpuPerformance: operations.gpuPerformance,
    };
  } catch {
    // A missing or unreadable profile must not take the listing down with it.
    return {};
  }
}

/**
 * The inventory device a finished build became — read ONLY for its photos.
 *
 * The whole document is fetched (Firestore has no field projection here) but
 * nothing of it reaches the public object except what publicPhoto() builds,
 * and that is an allow-list of four keys. Any failure is swallowed: a listing
 * without a picture is a worse listing, not a broken one.
 */
async function finishedDeviceFor(
  workspacePath: string,
  inventoryId: unknown,
): Promise<Record<string, unknown> | undefined> {
  const id = typeof inventoryId === "string" ? inventoryId.trim() : "";
  if (!id) return undefined;
  try {
    const snap = await admin.firestore().doc(`${workspacePath}/inventory/${id}`).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export const buildShareLookup = onCall(
  { region: "us-central1" },
  async (request: CallableRequest<LookupRequest>): Promise<PublicBuildResult> => {
    const token = String(request.data?.token ?? "").trim();

    // Shape-check before touching Firestore. TWO FORMATS RESOLVE HERE:
    //   • the original 26-character token, still in adverts that have been up
    //     for weeks and which this must never invalidate;
    //   • the short readable code, 8 letters (domain/shareCode.ts), or a
    //     custom word the owner typed.
    // Lowercase alphanumeric, 4–64. Anything else is not a near miss, it is
    // noise, and it never reaches Firestore. This is a filter, not the access
    // check — the database decides, and an unknown code and a revoked one get
    // the identical answer below.
    if (!token || token.length < 4 || token.length > 64 || !/^[a-z0-9]+$/.test(token)) {
      return { found: false };
    }

    if (throttled(request.rawRequest?.ip || "anon", token)) {
      throw new HttpsError("resource-exhausted", "Too many requests. Please wait a minute and try again.");
    }

    const cached = CACHE.get(token);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

    const notFound = (): PublicBuildResult => {
      const value: PublicBuildResult = { found: false };
      CACHE.set(token, { at: Date.now(), value });
      if (CACHE.size > 2000) CACHE.clear();
      return value;
    };

    const snap = await admin
      .firestore()
      .collectionGroup("pcBuilds")
      .where("shareToken", "==", token)
      .limit(2)
      .get();

    // Exactly one, or nothing. Two builds sharing a reference should be
    // impossible — the generator checks what is already in use and gives up
    // rather than reusing a code — but if it ever happened, showing neither is
    // the only safe answer.
    if (snap.size !== 1) return notFound();

    const doc = snap.docs[0];
    const build = doc.data() as Record<string, unknown>;
    const now = Date.now();

    // Cleared, cancelled, or past the sold grace period — all the same answer.
    if (!shareVisible(build, now)) return notFound();

    // user_data/{workspaceId}/pcBuilds/{id} → user_data/{workspaceId}
    const workspacePath = doc.ref.parent.parent?.path;
    const shop = workspacePath ? await shopProfileFor(workspacePath) : {};
    // The finished machine's photos live on the inventory device the build
    // became, so the listing needs that one extra read. A build that was never
    // finished simply has no device and no photo — which is not an error, and
    // must not take the listing down.
    const device = workspacePath ? await finishedDeviceFor(workspacePath, build.inventoryId) : undefined;

    const value: PublicBuildResult = toPublicBuild(build, shop, now, device);
    CACHE.set(token, { at: now, value });
    if (CACHE.size > 2000) CACHE.clear();
    return value;
  }
);
