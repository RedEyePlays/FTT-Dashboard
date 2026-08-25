import {
  collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, getDocs, writeBatch, query, where, orderBy, limit, runTransaction, increment,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  InventoryItem, Runner, DropOff, Settlement, Customer, SalesTransaction, ActivityEntry, Note, Task,
  AppUser, WorkspaceInvite, AuditEntry, TimeEntry, PayPeriodPaid, CashReconciliation, StaffNote,
} from '../types';
import { collectionFor } from '../domain/inventory';
import { AppSettings } from '../domain/settings';
import { allocateSkuInTxn } from './sku';

// Shared shop data lives under user_data/{workspaceId}/<collection>, where
// workspaceId is the owning account's uid. The `wsId` arg below is that id.
export const COLLECTIONS = [
  'inventory', 'accessories', 'salesTransactions', 'customers',
  'dropOffs', 'runners', 'settlements', 'activityLog', 'auditLogs',
  'repairs', 'repairBatches', 'timeEntries', 'payPeriods', 'cashReconciliations', 'staffNotes',
] as const;
export type CollName = typeof COLLECTIONS[number];

const colRef = (wsId: string, name: CollName) => collection(db, 'user_data', wsId, name);
const docRef = (wsId: string, name: CollName, id: string) => doc(db, 'user_data', wsId, name, id);
const metaRef = (wsId: string) => doc(db, 'user_data', wsId, 'meta', 'app');

// Firestore rejects `undefined` — deep-strip before writing.
const clean = (v: any): any => {
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    const out: any = {};
    for (const k of Object.keys(v)) if (v[k] !== undefined) out[k] = clean(v[k]);
    return out;
  }
  return v;
};

export function subscribeCollection<T extends { id: string }>(
  uid: string, name: CollName, cb: (rows: T[]) => void, onError: (e: Error) => void,
  // Optional server-side bound: only fetch the most recent `limitTo` docs ordered
  // by `orderByField` (desc). Used for the unbounded logs (activity/audit) so load
  // time and memory don't scale with the shop's entire history.
  opts?: { orderByField: string; limitTo: number },
) {
  const ref = opts
    ? query(colRef(uid, name), orderBy(opts.orderByField, 'desc'), limit(opts.limitTo))
    : colRef(uid, name);
  return onSnapshot(ref,
    snap => cb(snap.docs.map(d => ({ ...(d.data() as any), id: d.id })) as T[]),
    onError);
}

export interface AppMeta { notes?: Note[]; tasks?: Task[]; skuCounters?: Record<string, number>; lastBackup?: number; settings?: Partial<AppSettings>; }
export function subscribeMeta(uid: string, cb: (m: AppMeta) => void, onError: (e: Error) => void) {
  return onSnapshot(metaRef(uid), snap => cb((snap.data() as AppMeta) || {}), onError);
}
export const saveMeta = (uid: string, meta: Partial<AppMeta>) => setDoc(metaRef(uid), clean(meta), { merge: true });

/**
 * Atomically allocate the next SKU / repair number / batch number for a prefix.
 *
 * The counter lives in `skuCounters` on the workspace meta doc. A Firestore
 * transaction makes the read-increment-write atomic: if two clients allocate for
 * the same prefix at once, the transaction retries on conflict so each caller
 * gets a distinct number — no Cloud Function required. `existing` is an optional
 * belt-and-suspenders list of items whose SKUs must be skipped (e.g. after a
 * restore that outpaced the counter). Returns the new SKU and the persisted
 * counters (so callers can refresh their local mirror immediately).
 */
export function allocateSku(uid: string, prefix: string, existing: { sku?: string }[] = []) {
  return runTransaction(db, tx => allocateSkuInTxn({
    read: async () => ((await tx.get(metaRef(uid))).data() as AppMeta | undefined)?.skuCounters || {},
    write: counters => { tx.set(metaRef(uid), { skuCounters: counters }, { merge: true }); },
  }, prefix, existing as InventoryItem[]));
}

// Owner-configurable business settings, stored on the workspace meta doc. Written
// whole (not merged field-by-field) so removing a list entry actually deletes it.
export const saveSettings = (uid: string, settings: AppSettings) => setDoc(metaRef(uid), clean({ settings }), { merge: true });

/**
 * Auto-inventory create-or-attach (domain/autoInventory.ts's 'create'/'attach'
 * outcomes), committed atomically so two concurrent tickets for the same
 * device never create two inventory records.
 *
 * Firestore has no server-side unique-column constraint, so the identity
 * index doubles for it: `inventoryImeiIndex/{normalized}` holds the winning
 * record's id. The transaction reads that doc first — if it already exists,
 * someone else's create (or an earlier ticket) already claimed this identity,
 * so we attach to it instead (falling through to Case B) rather than erroring.
 * If it doesn't exist, we create both the inventory record and the index doc
 * in the same transaction. Two clients racing to create the same identity
 * both read the index as missing, but only one write wins — Firestore
 * transparently retries the loser's transaction, which then re-reads the now-
 * existing index and falls through to attach. This is what makes concurrent
 * duplicate creates (spec test case 8) resolve to exactly one record.
 */
export async function commitAutoInventory(uid: string, payload: {
  normalized: string;
  candidate: InventoryItem; // pre-built record (id/SKU already allocated) to use if creating
}): Promise<{ action: 'create' | 'attach'; item: InventoryItem }> {
  const indexRef = doc(db, 'user_data', uid, 'inventoryImeiIndex', payload.normalized);
  return runTransaction(db, async tx => {
    const indexSnap = await tx.get(indexRef);
    if (indexSnap.exists()) {
      const inventoryId = (indexSnap.data() as { inventoryId: string }).inventoryId;
      const itemSnap = await tx.get(docRef(uid, 'inventory', inventoryId));
      if (itemSnap.exists()) {
        return { action: 'attach' as const, item: { ...(itemSnap.data() as any), id: itemSnap.id } as InventoryItem };
      }
      // Index points at a record that's gone (inventory records are never
      // hard-deleted, but be defensive) — reclaim the slot below instead of
      // getting stuck unable to ever create under this identity again.
    }
    tx.set(docRef(uid, 'inventory', payload.candidate.id), clean(payload.candidate));
    tx.set(indexRef, { inventoryId: payload.candidate.id });
    return { action: 'create' as const, item: payload.candidate };
  });
}

export const saveItem = (uid: string, name: CollName, item: { id: string } & Record<string, any>) =>
  setDoc(docRef(uid, name, item.id), clean(item));
export const deleteItem = (uid: string, name: CollName, id: string) =>
  deleteDoc(docRef(uid, name, id));

// Sync a whole array against a previous array: upsert changed, delete removed.
export async function syncArray<T extends { id: string }>(uid: string, name: CollName, next: T[], prev: T[]) {
  const batch = writeBatch(db);
  const nextIds = new Set(next.map(i => i.id));
  next.forEach(i => batch.set(docRef(uid, name, i.id), clean(i)));
  prev.forEach(i => { if (!nextIds.has(i.id)) batch.delete(docRef(uid, name, i.id)); });
  await batch.commit();
}

export const logActivityDoc = (uid: string, entry: ActivityEntry) =>
  setDoc(docRef(uid, 'activityLog', entry.id), clean(entry));

// One transaction commit: mark devices sold, decrement accessories, write the
// sales transaction + customer, and log activity — all atomically.
export async function commitSale(uid: string, payload: {
  soldRows: InventoryItem[];
  // A signed quantity delta per accessory (negative = units sold). Applied with
  // Firestore's atomic increment() so concurrent sales of the same accessory sum
  // correctly regardless of write order — no lost update from writing absolute
  // quantities computed off a stale local snapshot.
  accessoryUpdates: { id: string; delta: number }[];
  transaction: SalesTransaction;
  customer?: Customer;
  activity: ActivityEntry[];
}) {
  const batch = writeBatch(db);
  payload.soldRows.forEach(d => batch.set(docRef(uid, 'inventory', d.id), clean(d)));
  payload.accessoryUpdates.forEach(a => batch.set(docRef(uid, 'accessories', a.id), { quantity: increment(a.delta) }, { merge: true } as any));
  batch.set(docRef(uid, 'salesTransactions', payload.transaction.id), clean(payload.transaction));
  if (payload.customer) batch.set(docRef(uid, 'customers', payload.customer.id), clean(payload.customer), { merge: true } as any);
  payload.activity.forEach(a => batch.set(docRef(uid, 'activityLog', a.id), clean(a)));
  await batch.commit();
}

// Reverse a completed sale in one atomic commit: return sold devices to unsold,
// increment accessory stock back (via the same atomic increment() as commitSale —
// never a raw absolute write), and flag the transaction as voided (kept for
// audit history, not deleted). Activity is logged in the same batch.
export async function voidSale(uid: string, payload: {
  transactionId: string;
  deviceIds: string[];                               // device inventory rows to return to unsold
  accessoryUpdates: { id: string; delta: number }[]; // positive deltas to restock
  voided: { voidedAt: number; voidedBy: string; voidedByEmail?: string };
  activity: ActivityEntry[];
}) {
  const batch = writeBatch(db);
  payload.deviceIds.forEach(id => batch.set(docRef(uid, 'inventory', id),
    { soldDate: '', soldTo: '', salePrice: 0, deviceStatus: 'ready', transactionId: '' }, { merge: true } as any));
  payload.accessoryUpdates.forEach(a => batch.set(docRef(uid, 'accessories', a.id),
    { quantity: increment(a.delta) }, { merge: true } as any));
  batch.set(docRef(uid, 'salesTransactions', payload.transactionId),
    { status: 'voided', ...payload.voided }, { merge: true } as any);
  payload.activity.forEach(a => batch.set(docRef(uid, 'activityLog', a.id), clean(a)));
  await batch.commit();
}

// Process a return in one atomic commit (the after-the-void-window counterpart
// to voidSale): restock accessories via the same atomic increment(), set each
// returned device to its chosen disposition — resellable ('ready') or
// not-for-resale ('returned') — clearing its sale fields either way, and flag the
// transaction 'returned' with the refund + restocking fee (kept for history).
export async function returnSale(uid: string, payload: {
  transactionId: string;
  resellDeviceIds: string[];                         // devices going back to sellable stock
  defectiveDeviceIds: string[];                      // devices pulled from sale (not-for-resale)
  accessoryUpdates: { id: string; delta: number }[]; // positive deltas to restock
  returned: { returnedAt: number; returnedBy: string; returnedByEmail?: string; restockingFee?: number; refundAmount: number };
  activity: ActivityEntry[];
}) {
  const batch = writeBatch(db);
  payload.resellDeviceIds.forEach(id => batch.set(docRef(uid, 'inventory', id),
    { soldDate: '', soldTo: '', salePrice: 0, deviceStatus: 'ready', transactionId: '' }, { merge: true } as any));
  payload.defectiveDeviceIds.forEach(id => batch.set(docRef(uid, 'inventory', id),
    { soldDate: '', soldTo: '', salePrice: 0, deviceStatus: 'returned', transactionId: '' }, { merge: true } as any));
  payload.accessoryUpdates.forEach(a => batch.set(docRef(uid, 'accessories', a.id),
    { quantity: increment(a.delta) }, { merge: true } as any));
  batch.set(docRef(uid, 'salesTransactions', payload.transactionId),
    { status: 'returned', ...payload.returned }, { merge: true } as any);
  payload.activity.forEach(a => batch.set(docRef(uid, 'activityLog', a.id), clean(a)));
  await batch.commit();
}

// Record a runner settlement in one atomic commit: save the settlement record
// AND flag every drop-off it covers 'settled', in the same batch — never as a
// separate, untracked follow-up write. Without this, settleableDropOffs
// (domain/dropoffs.ts) never sees these drop-offs leave 'accepted'/'paidout',
// so the exact same batch of devices stays eligible for a second settlement
// and the runner risks getting paid twice for it.
export async function settleRunner(uid: string, payload: { settlement: Settlement; dropOffIds: string[] }) {
  const batch = writeBatch(db);
  batch.set(docRef(uid, 'settlements', payload.settlement.id), clean(payload.settlement));
  payload.dropOffIds.forEach(id => batch.set(docRef(uid, 'dropOffs', id),
    { status: 'settled', settlementId: payload.settlement.id }, { merge: true } as any));
  await batch.commit();
}

// Seed sample devices/accessories into Firestore (demo option, not auto-loaded).
export async function seedSampleData(uid: string, items: InventoryItem[]) {
  const batch = writeBatch(db);
  items.forEach(i => {
    batch.set(docRef(uid, collectionFor(i), i.id), clean(i));
  });
  await batch.commit();
}

// One-time migration from the legacy single encrypted blob into collections.
export async function migrateLegacyIfNeeded(uid: string, legacy: {
  inventory?: InventoryItem[]; runners?: Runner[]; dropOffs?: DropOff[];
  settlements?: Settlement[]; notes?: Note[]; tasks?: Task[]; skuCounters?: Record<string, number>;
}): Promise<boolean> {
  const existing = await getDocs(colRef(uid, 'inventory'));
  const existingAcc = await getDocs(colRef(uid, 'accessories'));
  if (!existing.empty || !existingAcc.empty) return false; // already migrated
  const inv = legacy.inventory || [];
  if (inv.length === 0 && !(legacy.runners?.length)) return false;
  const batch = writeBatch(db);
  inv.forEach(i => {
    batch.set(docRef(uid, collectionFor(i), i.id), clean(i));
  });
  (legacy.runners || []).forEach(r => batch.set(docRef(uid, 'runners', r.id), clean(r)));
  (legacy.dropOffs || []).forEach(d => batch.set(docRef(uid, 'dropOffs', d.id), clean(d)));
  (legacy.settlements || []).forEach(s => batch.set(docRef(uid, 'settlements', s.id), clean(s)));
  batch.set(metaRef(uid), clean({ notes: legacy.notes || [], tasks: legacy.tasks || [], skuCounters: legacy.skuCounters || {} }), { merge: true });
  await batch.commit();
  return true;
}

/* ------------------------------- Time clock ------------------------------- */

// Shifts and pay-period sign-offs live under the workspace like any other shop
// data (generic saveItem/deleteItem). Thin named wrappers keep the App handlers
// readable and the collection names in one place.
// Owner-only staff shoutout/notes log (see domain/staffNotes.ts + services/rbac.ts's
// staffNotes.manage). Same generic saveItem/deleteItem path as every other
// collection — access is enforced by firestore.rules, not by this file.
export const saveStaffNote = (uid: string, n: StaffNote) => saveItem(uid, 'staffNotes', n);
export const deleteStaffNote = (uid: string, id: string) => deleteItem(uid, 'staffNotes', id);

export const saveTimeEntry = (uid: string, e: TimeEntry) => saveItem(uid, 'timeEntries', e);
export const deleteTimeEntry = (uid: string, id: string) => deleteItem(uid, 'timeEntries', id);
export const savePayPeriodPaid = (uid: string, p: PayPeriodPaid) => saveItem(uid, 'payPeriods', p);
export const saveCashReconciliation = (uid: string, r: CashReconciliation) => saveItem(uid, 'cashReconciliations', r);
export const deletePayPeriodPaid = (uid: string, id: string) => deleteItem(uid, 'payPeriods', id);

/* ------------------------- Users / roles (top-level) ------------------------- */

const userRef = (uid: string) => doc(db, 'users', uid);
const inviteRef = (email: string) => doc(db, 'workspaceInvites', email.toLowerCase());

export const getUserDoc = async (uid: string): Promise<AppUser | null> => {
  const s = await getDoc(userRef(uid));
  return s.exists() ? ({ ...(s.data() as any), id: s.id }) : null;
};
export const setUserDoc = (u: AppUser) => setDoc(userRef(u.id), clean(u));
export const updateUserDoc = (uid: string, patch: Partial<AppUser>) => setDoc(userRef(uid), clean(patch), { merge: true });

export function subscribeWorkspaceUsers(wsId: string, cb: (u: AppUser[]) => void, onError: (e: Error) => void) {
  return onSnapshot(query(collection(db, 'users'), where('workspaceId', '==', wsId)),
    snap => cb(snap.docs.map(d => ({ ...(d.data() as any), id: d.id })) as AppUser[]), onError);
}

export const getInvite = async (email: string): Promise<WorkspaceInvite | null> => {
  const s = await getDoc(inviteRef(email));
  return s.exists() ? ({ ...(s.data() as any), id: s.id }) : null;
};
export const setInvite = (inv: WorkspaceInvite) => setDoc(inviteRef(inv.email), clean(inv));
export const deleteInvite = (email: string) => deleteDoc(inviteRef(email));
export function subscribeInvites(wsId: string, cb: (i: WorkspaceInvite[]) => void, onError: (e: Error) => void) {
  return onSnapshot(query(collection(db, 'workspaceInvites'), where('workspaceId', '==', wsId)),
    snap => cb(snap.docs.map(d => ({ ...(d.data() as any), id: d.id })) as WorkspaceInvite[]), onError);
}

/* --------------------------------- Audit ---------------------------------- */

export const logAudit = (wsId: string, entry: AuditEntry) =>
  setDoc(docRef(wsId, 'auditLogs', entry.id), clean(entry));

/* -------------------------------- Backups --------------------------------- */

// Read every collection for a workspace into one object (for JSON/CSV export).
export async function exportWorkspaceData(wsId: string): Promise<Record<string, any[]>> {
  const out: Record<string, any[]> = {};
  for (const name of COLLECTIONS) {
    const snap = await getDocs(colRef(wsId, name));
    out[name] = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  }
  const usersSnap = await getDocs(query(collection(db, 'users'), where('workspaceId', '==', wsId)));
  out['users'] = usersSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const metaSnap = await getDoc(metaRef(wsId));
  out['meta'] = metaSnap.exists() ? [{ id: 'app', ...(metaSnap.data() as any) }] : [];
  return out;
}

export const recordBackup = (wsId: string, ts: number) => setDoc(metaRef(wsId), clean({ lastBackup: ts }), { merge: true });
