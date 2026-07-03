import {
  collection, doc, onSnapshot, setDoc, deleteDoc, getDocs, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  InventoryItem, Runner, DropOff, Settlement, Customer, SalesTransaction, ActivityEntry, Note, Task,
} from '../types';

// All per-user data lives under user_data/{uid}/<collection>.
export const COLLECTIONS = [
  'inventory', 'accessories', 'salesTransactions', 'customers',
  'dropOffs', 'runners', 'settlements', 'activityLog',
] as const;
export type CollName = typeof COLLECTIONS[number];

const colRef = (uid: string, name: CollName) => collection(db, 'user_data', uid, name);
const docRef = (uid: string, name: CollName, id: string) => doc(db, 'user_data', uid, name, id);
const metaRef = (uid: string) => doc(db, 'user_data', uid, 'meta', 'app');

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
) {
  return onSnapshot(colRef(uid, name),
    snap => cb(snap.docs.map(d => ({ ...(d.data() as any), id: d.id })) as T[]),
    onError);
}

export interface AppMeta { notes?: Note[]; tasks?: Task[]; skuCounters?: Record<string, number>; }
export function subscribeMeta(uid: string, cb: (m: AppMeta) => void, onError: (e: Error) => void) {
  return onSnapshot(metaRef(uid), snap => cb((snap.data() as AppMeta) || {}), onError);
}
export const saveMeta = (uid: string, meta: Partial<AppMeta>) => setDoc(metaRef(uid), clean(meta), { merge: true });

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
  accessoryUpdates: { id: string; quantity: number }[];
  transaction: SalesTransaction;
  customer?: Customer;
  activity: ActivityEntry[];
}) {
  const batch = writeBatch(db);
  payload.soldRows.forEach(d => batch.set(docRef(uid, 'inventory', d.id), clean(d)));
  payload.accessoryUpdates.forEach(a => batch.set(docRef(uid, 'accessories', a.id), { quantity: a.quantity }, { merge: true } as any));
  batch.set(docRef(uid, 'salesTransactions', payload.transaction.id), clean(payload.transaction));
  if (payload.customer) batch.set(docRef(uid, 'customers', payload.customer.id), clean(payload.customer), { merge: true } as any);
  payload.activity.forEach(a => batch.set(docRef(uid, 'activityLog', a.id), clean(a)));
  await batch.commit();
}

// Seed sample devices/accessories into Firestore (demo option, not auto-loaded).
export async function seedSampleData(uid: string, items: InventoryItem[]) {
  const batch = writeBatch(db);
  items.forEach(i => {
    const name: CollName = (i.kind ?? 'device') === 'accessory' ? 'accessories' : 'inventory';
    batch.set(docRef(uid, name, i.id), clean(i));
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
    const name: CollName = (i.kind ?? 'device') === 'accessory' ? 'accessories' : 'inventory';
    batch.set(docRef(uid, name, i.id), clean(i));
  });
  (legacy.runners || []).forEach(r => batch.set(docRef(uid, 'runners', r.id), clean(r)));
  (legacy.dropOffs || []).forEach(d => batch.set(docRef(uid, 'dropOffs', d.id), clean(d)));
  (legacy.settlements || []).forEach(s => batch.set(docRef(uid, 'settlements', s.id), clean(s)));
  batch.set(metaRef(uid), clean({ notes: legacy.notes || [], tasks: legacy.tasks || [], skuCounters: legacy.skuCounters || {} }), { merge: true });
  await batch.commit();
  return true;
}
