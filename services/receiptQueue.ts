import { QueuedScan, QueuedState } from '../domain/receiptQueue';

/**
 * THE SCANNED BYTES, HELD ON THIS DEVICE UNTIL THEY ARE ACTUALLY STORED.
 *
 * Cloud Storage has no offline queue: an upload attempted with no connection
 * fails outright. Firestore's cache WOULD happily sync the receipt document,
 * so without this the archive would fill with receipts whose photo does not
 * exist — the silent loss the whole feature is written to prevent, since the
 * owner bins the paper once he has photographed it.
 *
 * IndexedDB rather than localStorage because these are Blobs: localStorage is
 * strings only, and base64-ing a 400 KB JPEG into a 5 MB quota is how you
 * discover the quota.
 *
 * EVERY READ AND WRITE IS GUARDED. Private browsing, a cleared site, a Safari
 * quirk or a full disk all make IndexedDB throw or return nothing, and the
 * scanner must still work — it falls back to "upload now or tell the owner it
 * failed", which is the loud-failure behaviour, rather than pretending to have
 * saved something. domain/receiptQueue.ts holds the state machine; this file
 * is only storage.
 */

const DB_NAME = 'ftt-receipts';
const DB_VERSION = 1;
const STORE = 'scans';

interface StoredScan extends QueuedScan {
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = (): Promise<IDBDatabase | null> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>(resolve => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('receiptId', 'receiptId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // A blocked upgrade (another tab holding the old version) must not hang
      // the scanner forever.
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
};

const tx = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> => {
  const db = await openDb();
  if (!db) return null;
  return new Promise<T | null>(resolve => {
    try {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => resolve(null);
      t.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
};

/** Is the queue usable at all? The scanner tells the owner when it is not. */
export const queueAvailable = async (): Promise<boolean> => (await openDb()) !== null;

export interface EnqueueInput {
  id: string;
  receiptId: string;
  page: number;
  blob: Blob;
  capturedAt: number;
}

/** Hold one page's bytes. Resolves false when the queue is unusable. */
export const enqueueScan = async (input: EnqueueInput): Promise<boolean> => {
  const record: StoredScan = {
    id: input.id,
    receiptId: input.receiptId,
    page: input.page,
    state: 'pending',
    capturedAt: input.capturedAt,
    attempts: 0,
    sizeBytes: input.blob.size,
    contentType: input.blob.type || 'image/jpeg',
    blob: input.blob,
  };
  const ok = await tx<IDBValidKey>('readwrite', s => s.put(record) as IDBRequest<IDBValidKey>);
  return ok !== null;
};

/** Everything still held, newest capture first. Metadata only — no blobs. */
export const listQueue = async (): Promise<QueuedScan[]> => {
  const all = await tx<StoredScan[]>('readonly', s => s.getAll() as IDBRequest<StoredScan[]>);
  if (!all) return [];
  return all
    .map(({ blob: _blob, ...meta }) => meta as QueuedScan)
    .sort((a, b) => b.capturedAt - a.capturedAt);
};

export const getScanBlob = async (id: string): Promise<Blob | null> => {
  const rec = await tx<StoredScan | undefined>('readonly', s => s.get(id) as IDBRequest<StoredScan | undefined>);
  return rec?.blob ?? null;
};

export const updateScan = async (next: QueuedScan): Promise<void> => {
  const rec = await tx<StoredScan | undefined>('readonly', s => s.get(next.id) as IDBRequest<StoredScan | undefined>);
  if (!rec) return;
  await tx('readwrite', s => s.put({ ...rec, ...next }) as IDBRequest<IDBValidKey>);
};

export const setScanState = async (id: string, state: QueuedState): Promise<void> => {
  const rec = await tx<StoredScan | undefined>('readonly', s => s.get(id) as IDBRequest<StoredScan | undefined>);
  if (!rec) return;
  await tx('readwrite', s => s.put({ ...rec, state }) as IDBRequest<IDBValidKey>);
};

/**
 * Drop a page once it is genuinely stored.
 *
 * Only ever called after the upload resolved AND the document write resolved.
 * Deleting on upload alone would lose the page if the document write then
 * failed, which is the same silent loss in a smaller window.
 */
export const dequeueScan = async (id: string): Promise<void> => {
  await tx('readwrite', s => s.delete(id) as IDBRequest<undefined>);
};
