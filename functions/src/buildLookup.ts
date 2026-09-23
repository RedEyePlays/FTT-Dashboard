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
//   • The ONLY input is the token, which is 26 characters from a CSPRNG
//     (domain/buildShare.ts). There is no index and no way to browse; holding
//     the token is the whole of the access check, which is why it is long.
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
function throttled(key: string): boolean {
  const now = Date.now();
  const recent = (HITS.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  HITS.set(key, recent);
  if (HITS.size > 5000) HITS.clear(); // crude memory bound
  return recent.length > MAX_PER_WINDOW;
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
    };
  } catch {
    // A missing or unreadable profile must not take the listing down with it.
    return {};
  }
}

export const buildShareLookup = onCall(
  { region: "us-central1" },
  async (request: CallableRequest<LookupRequest>): Promise<PublicBuildResult> => {
    const token = String(request.data?.token ?? "").trim();

    // Shape-check before touching Firestore: a token is lowercase alphanumeric
    // and 22–64 long, so anything else is not a near miss, it is noise.
    if (!token || token.length < 22 || token.length > 64 || !/^[a-z0-9]+$/.test(token)) {
      return { found: false };
    }

    const rateKey = (request.rawRequest?.ip || "anon") + "|" + token;
    if (throttled(rateKey)) {
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

    // Exactly one, or nothing. Two documents sharing a token cannot happen
    // with 130 bits of randomness; if it somehow did, showing neither is the
    // only safe answer.
    if (snap.size !== 1) return notFound();

    const doc = snap.docs[0];
    const build = doc.data() as Record<string, unknown>;
    const now = Date.now();

    // Cleared, cancelled, or past the sold grace period — all the same answer.
    if (!shareVisible(build, now)) return notFound();

    // user_data/{workspaceId}/pcBuilds/{id} → user_data/{workspaceId}
    const workspacePath = doc.ref.parent.parent?.path;
    const shop = workspacePath ? await shopProfileFor(workspacePath) : {};

    const value: PublicBuildResult = toPublicBuild(build, shop, now);
    CACHE.set(token, { at: now, value });
    if (CACHE.size > 2000) CACHE.clear();
    return value;
  }
);
