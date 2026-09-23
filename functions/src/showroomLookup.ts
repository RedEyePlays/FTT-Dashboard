import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  ShowroomItem, ShowroomRepair, ShowroomResult, ShowroomTradeIn,
  isShowroomEligible, sortItems, toShowroomBuild, toShowroomDevice,
  toShowroomRepair, toShowroomTradeIn,
} from "./showroomPolicy";

if (!admin.apps.length) admin.initializeApp();

// --- The counter kiosk's listing -------------------------------------------
//
// A tablet on the counter that customers pick up: what is for sale, what the
// shop charges for repairs, and what it pays for a trade-in.
//
// Same model as repairStatusLookup and buildShareLookup, and for the same
// reasons:
//   • NO ACCOUNT IS SIGNED INTO THE TABLET. The device is identified by an
//     unguessable token in the URL, not by a workspace id somebody could
//     guess, and it holds no credential that could be lifted off it.
//   • The Admin SDK reads server-side; the browser never touches Firestore.
//   • Everything returned is built FIELD BY FIELD by showroomPolicy.ts from an
//     allow-list. The tablet is public and unattended — assume it is picked up
//     by somebody who would like to know what the shop paid.
//   • An unknown or revoked token returns the same plain not-found.
//
// NO FIRESTORE INDEX IS NEEDED. Unlike the build share link, this token lives
// on the workspace META document rather than scattered across a collection, so
// the lookup is one indexed-by-default collection-group query on a single
// field of a tiny collection. See the PR body.

interface LookupRequest {
  token?: unknown;
}

type Result = ShowroomResult | { found: false };

const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;          // a tablet polls; be generous but bounded
function throttled(key: string): boolean {
  const now = Date.now();
  const recent = (HITS.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  HITS.set(key, recent);
  if (HITS.size > 5000) HITS.clear();
  return recent.length > MAX_PER_WINDOW;
}

// The tablet polls every couple of minutes; this keeps a shop full of tablets
// off Firestore while staying fresh enough that a sold device disappears.
const CACHE_MS = 60_000;
const CACHE = new Map<string, { at: number; value: Result }>();

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export const showroomLookup = onCall(
  { region: "us-central1" },
  async (request: CallableRequest<LookupRequest>): Promise<Result> => {
    const token = str(request.data?.token);
    if (!token || token.length < 22 || token.length > 64 || !/^[a-z0-9]+$/.test(token)) {
      return { found: false };
    }

    const rateKey = (request.rawRequest?.ip || "anon") + "|" + token;
    if (throttled(rateKey)) {
      throw new HttpsError("resource-exhausted", "Too many requests. Please wait a minute.");
    }

    const cached = CACHE.get(token);
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

    const remember = (value: Result): Result => {
      CACHE.set(token, { at: Date.now(), value });
      if (CACHE.size > 2000) CACHE.clear();
      return value;
    };

    // The token is an ordinary setting — Settings → Counter Kiosk writes it to
    // settings.operations.kioskToken on the workspace's meta/app document — so
    // finding it is ONE equality query over the `meta` collection group on that
    // nested field path.
    //
    // NO COMPOSITE INDEX IS NEEDED. This is a single-field equality with no
    // second filter and no ordering, and Firestore maintains single-field
    // indexes (collection-group scope included) automatically, for map
    // subfields as well as top-level ones. Same shape as buildLookup.ts's
    // shareToken query, which has been running without one.
    const metaSnap = await admin.firestore()
      .collectionGroup("meta")
      .where("settings.operations.kioskToken", "==", token)
      .limit(2)
      .get();
    if (metaSnap.size !== 1) return remember({ found: false });

    const metaDoc = metaSnap.docs[0];
    const workspacePath = metaDoc.ref.parent.parent?.path;
    if (!workspacePath) return remember({ found: false });

    const settings = (metaDoc.data()?.settings || {}) as Record<string, unknown>;
    const general = (settings.general || {}) as Record<string, unknown>;
    const store = (settings.store || {}) as Record<string, unknown>;
    const operations = (settings.operations || {}) as Record<string, unknown>;
    const warrantyDays = typeof operations.deviceWarrantyDays === "number"
      ? Math.round(operations.deviceWarrantyDays) : 0;
    const repairWarrantyDays = typeof operations.repairWarrantyDays === "number"
      ? Math.round(operations.repairWarrantyDays) : 0;

    const db = admin.firestore();
    const [invSnap, buildSnap] = await Promise.all([
      db.collection(`${workspacePath}/inventory`).limit(500).get(),
      db.collection(`${workspacePath}/pcBuilds`).where("status", "==", "ready").limit(100).get(),
    ]);

    const devices = invSnap.docs.map(d => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
    const byId = new Map(devices.map(d => [d.id, d]));

    // Devices already shown as a finished build are not listed twice.
    const buildDeviceIds = new Set(
      buildSnap.docs.map(d => str((d.data() as Record<string, unknown>).inventoryId)).filter(Boolean),
    );

    const items: ShowroomItem[] = [];
    for (const device of devices) {
      if (buildDeviceIds.has(device.id)) continue;
      if (!isShowroomEligible(device)) continue;
      const item = toShowroomDevice(device, warrantyDays);
      if (item) items.push(item);
    }
    for (const doc of buildSnap.docs) {
      const build = doc.data() as Record<string, unknown>;
      const device = byId.get(str(build.inventoryId));
      // A build whose device has sold is off the floor like any other.
      if (device && !isShowroomEligible(device)) continue;
      const item = toShowroomBuild(build, device, warrantyDays);
      if (item) items.push(item);
    }

    const repairRows = Array.isArray(operations.repairPrices)
      ? (operations.repairPrices as Record<string, unknown>[]) : [];
    const repairs = repairRows.map(toShowroomRepair).filter((r): r is ShowroomRepair => r !== null);

    const tradeRows = Array.isArray(operations.tradeInRanges)
      ? (operations.tradeInRanges as Record<string, unknown>[]) : [];
    const tradeIns = tradeRows.map(toShowroomTradeIn).filter((t): t is ShowroomTradeIn => t !== null);

    const value: ShowroomResult = {
      found: true,
      shopName: str(general.storeName) || str(store.storeName) || "Our shop",
      items: sortItems(items),
      repairs,
      repairWarrantyDays,
      tradeIns,
      updatedAt: Date.now(),
    };
    const phone = str(store.phone) || str(general.phone);
    if (phone) value.shopPhone = phone;

    return remember(value);
  }
);
