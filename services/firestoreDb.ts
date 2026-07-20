import {
  collection, doc, onSnapshot, setDoc, deleteDoc, getDoc, getDocs, writeBatch, query, where,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  InventoryItem, Runner, DropOff, Settlement, Customer, SalesTransaction, ActivityEntry, Note, Task,
  AppUser, WorkspaceInvite, AuditEntry,
} from '../types';
import { collectionFor } from '../domain/inventory';
import { AppSettings } from '../domain/settings';

// Shared shop data lives under user_data/{workspaceId}/<collection>, where
// workspaceId is the owning account's uid. The `wsId` arg below is that id.
export const COLLECTIONS = [
  'inventory', 'accessories', 'salesTransactions', 'customers',
  'dropOffs', 'runners', 'settlements', 'activityLog', 'auditLogs',
  'repairs', 'repairBatches',
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
) {
  return onSnapshot(colRef(uid, name),
    snap => cb(snap.docs.map(d => ({ ...(d.data() as any), id: d.id })) as T[]),
    onError);
}

export interface AppMeta { notes?: Note[]; tasks?: Task[]; skuCounters?: Record<string, number>; lastBackup?: number; settings?: Partial<AppSettings>; }
export function subscribeMeta(uid: string, cb: (m: AppMeta) => void, onError: (e: Error) => void) {
  return onSnapshot(metaRef(uid), snap => cb((snap.data() as AppMeta) || {}), onError);
}
export const saveMeta = (uid: string, meta: Partial<AppMeta>) => setDoc(metaRef(uid), clean(meta), { merge: true });

// Owner-configurable business settings, stored on the workspace meta doc. Written
// whole (not merged field-by-field) so removing a list entry actually deletes it.
export const saveSettings = (uid: string, settings: AppSettings) => setDoc(metaRef(uid), clean({ settings }), { merge: true });

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
