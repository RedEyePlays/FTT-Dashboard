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
