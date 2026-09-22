import { Repair, RepairBatch } from '../types';
import { isRepairFinished } from './repairVisibility';
import { matchesRepair } from './repairs';
import { isPrivateBatch } from './autoInventory';

/**
 * FINISHED WORK LEAVES THE LIST — INSIDE A BATCH TOO.
 *
 * #195 split the Tickets tab into Active and Completed, and that works: a
 * finished ticket stops crowding the bench list. But a personal or store repair
 * does not live in Tickets — it lives inside a PRIVATE batch (RepairBatch.private,
 * see domain/autoInventory.ts's isPrivateBatch), typically one long-running
 * "FTT Personal" batch that is never itself completed. So every device the shop
 * has ever repaired for itself stayed in that batch's device list forever, and
 * the split never reached it.
 *
 * Same split, same definition of done. isRepairFinished is REUSED rather than
 * re-derived — it is itself defined as "not isRepairOpen", so there is exactly
 * one notion of terminal in the app and these two lists can never disagree
 * about what counts as finished.
 *
 * SEARCH SPANS BOTH. Completed devices are MOVED, not hidden — the same
 * principle the Tickets tab already follows. Searching inside a batch looks
 * through the completed ones too, and says how many it found there.
 *
 * VIEW ONLY: nothing is migrated, nothing is deleted, and printing and
 * auto-inventory behaviour are untouched.
 *
 * Pure: no DOM, no Firestore.
 */

export type BatchDeviceView = 'inprogress' | 'completed';

export interface BatchDeviceSplit {
  inProgress: Repair[];
  completed: Repair[];
  /** Counts BEFORE the search filter — what the two tab labels show. */
  totalInProgress: number;
  totalCompleted: number;
}

/**
 * A batch's devices, split by whether the work is over.
 *
 * Sorted oldest-first, matching the existing batch table (devices are numbered
 * in the order they were taken in, and that numbering must not jump about).
 */
export const splitBatchDevices = (
  repairs: Repair[],
  batchId: string,
  query = '',
): BatchDeviceSplit => {
  const devices = repairs
    .filter(r => r.batchId === batchId)
    .sort((a, b) => a.createdAt - b.createdAt);
  const q = query.trim();
  const shown = q ? devices.filter(r => matchesRepair(r, q)) : devices;
  return {
    inProgress: shown.filter(r => !isRepairFinished(r)),
    completed: shown.filter(isRepairFinished),
    totalInProgress: devices.filter(r => !isRepairFinished(r)).length,
    totalCompleted: devices.filter(isRepairFinished).length,
  };
};

/**
 * Which half to open on.
 *
 * Always In progress — that is the work in front of somebody. Spelled out as a
 * function rather than a literal default because a PRIVATE batch is the case
 * that most needs it: the batch itself is active forever, so "the batch is
 * active, show everything" would put every device the shop has ever refurbished
 * back on the screen.
 */
export const defaultBatchView = (_batch: Pick<RepairBatch, 'private' | 'autoInventory' | 'status'>): BatchDeviceView =>
  'inprogress';

/** True when a search found matches only on the side that isn't open. */
export const searchHitsOtherView = (
  split: BatchDeviceSplit,
  view: BatchDeviceView,
  query: string,
): number => {
  if (!query.trim()) return 0;
  return view === 'inprogress' ? split.completed.length : split.inProgress.length;
};

export const otherViewHitLabel = (n: number, view: BatchDeviceView): string | null => {
  if (n <= 0) return null;
  const where = view === 'inprogress' ? 'Completed' : 'In progress';
  return `${n} more match${n === 1 ? '' : 'es'} in ${where}.`;
};

/* ---------------- The batches list itself ---------------- */

export interface BatchSplit {
  active: RepairBatch[];
  completed: RepairBatch[];
}

/**
 * Batches split by their OWN status, so a finished wholesale batch stops
 * crowding the list.
 *
 * A PRIVATE batch that is still active stays in Active — it is the shop's
 * permanent workbench, not something that ever gets handed back to a customer,
 * and burying it would make the personal-repair flow harder than it was before.
 * Only its status decides, exactly like every other batch; this is stated
 * explicitly because the temptation is to special-case it the other way.
 */
export const splitBatches = (batches: RepairBatch[]): BatchSplit => ({
  active: batches.filter(b => b.status === 'active'),
  completed: batches.filter(b => b.status !== 'active'),
});

/** Does this batch belong in the Active list? */
export const isActiveBatch = (b: Pick<RepairBatch, 'status'>): boolean => b.status === 'active';

/** Private batches are never auto-completed by this view — see splitBatches. */
export const isPermanentBatch = (b: Pick<RepairBatch, 'private' | 'autoInventory' | 'status'>): boolean =>
  isPrivateBatch(b) && b.status === 'active';
