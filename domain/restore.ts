import {
  AppData, InventoryItem, Note, Task, Runner, DropOff, Settlement, Customer, SalesTransaction, ActivityEntry,
  Repair, RepairBatch,
} from '../types';

// Normalizes a parsed backup file into a full AppData for restore.
//
// Two backup shapes exist in the wild and both must round-trip losslessly:
//   1. Simple backup (SettingsModal "Download Backup"): top-level
//      { inventory, notes, tasks, ... }.
//   2. Full export (Settings → Backup → Export JSON): a wrapper
//      { exportedAt, workspaceId, data: { inventory, accessories,
//        salesTransactions, customers, runners, dropOffs, settlements,
//        meta: [{ notes, tasks, skuCounters }] } }.
//
// The previous restore path only read top-level inventory/notes/tasks, silently
// dropping accessories, sales history, customers, runners, drop-offs and
// settlements. This normalizer preserves every collection from either shape.

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function normalizeRestore(parsed: any): AppData {
  // Unwrap the full-export envelope if present.
  const src =
    parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object'
      ? parsed.data
      : parsed || {};

  // The full export keeps devices (`inventory`) and accessories separate; the
  // simple backup keeps everything in `inventory`. Merge into one list — the
  // restore handler re-splits by `kind`.
  const inventory = [...arr<InventoryItem>(src.inventory), ...arr<InventoryItem>(src.accessories)];

  // Full export stores notes/tasks/skuCounters under meta[0]; the simple backup
  // keeps them at the top level. Prefer whichever is populated.
  const meta = arr<any>(src.meta)[0] || {};
  const notes = arr<Note>(src.notes).length ? arr<Note>(src.notes) : arr<Note>(meta.notes);
  const tasks = arr<Task>(src.tasks).length ? arr<Task>(src.tasks) : arr<Task>(meta.tasks);

  return {
    inventory,
    notes,
    tasks,
    runners: arr<Runner>(src.runners),
    dropOffs: arr<DropOff>(src.dropOffs),
    settlements: arr<Settlement>(src.settlements),
    customers: arr<Customer>(src.customers),
    salesTransactions: arr<SalesTransaction>(src.salesTransactions),
    repairs: arr<Repair>(src.repairs),
    repairBatches: arr<RepairBatch>(src.repairBatches),
    skuCounters: src.skuCounters || meta.skuCounters || {},
    activityLog: arr<ActivityEntry>(src.activityLog),
  };
}

// A backup is restorable if it yields at least one non-empty collection.
export function isRestorableBackup(parsed: any): boolean {
  const d = normalizeRestore(parsed);
  return (
    d.inventory.length > 0 ||
    d.notes.length > 0 ||
    d.tasks.length > 0 ||
    (d.runners?.length ?? 0) > 0 ||
    (d.dropOffs?.length ?? 0) > 0 ||
    (d.settlements?.length ?? 0) > 0 ||
    (d.customers?.length ?? 0) > 0 ||
    (d.salesTransactions?.length ?? 0) > 0 ||
    (d.repairs?.length ?? 0) > 0 ||
    (d.repairBatches?.length ?? 0) > 0
  );
}

/**
 * The full export wrapper ({ exportedAt, workspaceId, data }, see
 * normalizeRestore's doc comment) carries a real timestamp of when the
 * backup was taken; the simple "Download Backup" shape doesn't. Returns
 * milliseconds since epoch, or undefined when the file carries no usable
 * timestamp — callers must show "unknown" rather than guess.
 */
export function backupExportedAtMs(parsed: any): number | undefined {
  const raw = parsed && typeof parsed === 'object' ? parsed.exportedAt : undefined;
  if (typeof raw !== 'string') return undefined;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : undefined;
}

/** How many records of each kind a backup carries — shown in the restore
 * confirmation so the owner can sanity-check "is this the file I think it
 * is" before anything destructive happens. Only non-empty collections are
 * included, so the summary stays short for an old/partial backup. */
export function backupSummary(data: AppData): Record<string, number> {
  const counts: Record<string, number> = {
    inventory: data.inventory.length,
    notes: data.notes.length,
    tasks: data.tasks.length,
    customers: data.customers?.length ?? 0,
    salesTransactions: data.salesTransactions?.length ?? 0,
    repairs: data.repairs?.length ?? 0,
    repairBatches: data.repairBatches?.length ?? 0,
    runners: data.runners?.length ?? 0,
    dropOffs: data.dropOffs?.length ?? 0,
    settlements: data.settlements?.length ?? 0,
  };
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}

/**
 * Non-destructive restore: every record in `incoming` (keyed by id) is
 * added/updated into `current`; anything already in `current` but absent
 * from `incoming` is left untouched. This is what makes "merge" safe where
 * a full replace isn't — restoring an old backup this way can't delete a
 * single record created since the backup was taken, it can only add back
 * what the backup remembers (and overwrite a record present in both, with
 * the backup's version winning).
 */
export function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const byId = new Map(current.map(x => [x.id, x] as const));
  for (const item of incoming) byId.set(item.id, item);
  return Array.from(byId.values());
}

/** skuCounters merge: counters must stay monotonic, so take the larger of
 * the two sides per prefix rather than letting an old backup roll one back
 * (which would risk a newly-generated SKU colliding with one already used
 * since the backup was taken). */
export function mergeSkuCounters(
  current: Record<string, number> | undefined,
  incoming: Record<string, number> | undefined,
): Record<string, number> {
  const out: Record<string, number> = { ...(current || {}) };
  for (const [k, v] of Object.entries(incoming || {})) out[k] = Math.max(out[k] || 0, v);
  return out;
}
