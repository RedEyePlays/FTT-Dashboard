import { InventoryItem, Repair, RepairBatch } from '../types';
import { isRepairOpen, openRepairFor } from './repairs';
import { isPrivateBatch } from './autoInventory';

// Three related display rules, kept pure so each is testable without a
// component:
//
//   1. A SOLD device never reads as "in repair", whatever its tickets say.
//   2. Finished tickets leave the active list without leaving the app.
//   3. A private/personal-batch ticket is an internal refurb, so the
//      customer-payment fields on it are meaningless and are hidden.

// --- 1. Sold devices are never "in repair" ----------------------------------

/**
 * Has this device left the building? `deviceStatus` is the authority, but a
 * row carrying a `soldDate` and a stale status is still sold — the sale
 * paths write both, and reading either means a half-written record can't
 * make a sold device look available.
 */
export const isSoldDevice = (
  item: Pick<InventoryItem, 'deviceStatus' | 'soldDate'>,
): boolean => item.deviceStatus === 'sold' || !!item.soldDate;

/**
 * The open ticket that should make this device DISPLAY as in-repair — the
 * orange SKU cell, the in-repair filters and counts.
 *
 * The bug this fixes: a device flagged in-repair that then sells kept its
 * orange SKU and kept being counted as on the bench, because the highlight
 * was driven by `openRepairFor` alone, which knows nothing about the
 * device. The device is gone; whatever its ticket says, it is not on the
 * bench.
 *
 * Deliberately a DISPLAY rule, not a data change. The ticket itself is left
 * open on purpose (see soldWithOpenTicket below) — closing it silently at
 * sale time would discard real, unfinished work.
 */
export const inRepairTicketFor = (
  item: Pick<InventoryItem, 'id' | 'deviceStatus' | 'soldDate'>,
  repairs: Repair[],
): Repair | undefined => (isSoldDevice(item) ? undefined : openRepairFor(item.id, repairs));

/** Convenience predicate for filters/counts — same rule as the highlight. */
export const showsAsInRepair = (
  item: Pick<InventoryItem, 'id' | 'deviceStatus' | 'soldDate'>,
  repairs: Repair[],
): boolean => !!inRepairTicketFor(item, repairs);

/**
 * Tickets left open on a device that has already sold.
 *
 * A sold device with an open ticket is a real inconsistency, not just a
 * display glitch — somebody's unfinished work is attached to something
 * that has left the shop. Rather than close it silently (which loses that
 * work) the sale stamps `deviceSoldAt` on the ticket and this surfaces it,
 * so it can be finished or cancelled deliberately instead of quietly
 * rotting in the list.
 */
export const soldWithOpenTicket = (
  repairs: Repair[],
  inventory: Pick<InventoryItem, 'id' | 'deviceStatus' | 'soldDate'>[],
): Repair[] => {
  const soldIds = new Set(inventory.filter(isSoldDevice).map(i => i.id));
  return repairs.filter(r => isRepairOpen(r) && !!r.inventoryId && soldIds.has(r.inventoryId));
};

/**
 * The stamp to put on a still-open ticket whose device just sold. Returns
 * null when there is nothing to mark — the ticket is already finished, or
 * already carries the stamp, so re-running a sale path can't churn it.
 */
export const markTicketDeviceSold = (
  r: Pick<Repair, 'status' | 'deviceSoldAt'>,
  now: number,
): { deviceSoldAt: number } | null => {
  if (!isRepairOpen(r as Repair)) return null;
  if (r.deviceSoldAt) return null;
  return { deviceSoldAt: now };
};

// --- 2. Finished tickets leave the active list ------------------------------

/**
 * Terminal = the work is over, however it ended. Completed and picked up are
 * finished; cancelled never happened. All three belong in Completed rather
 * than cluttering the list of what's actually on the bench.
 *
 * Defined as "not open" rather than as its own status list so it can never
 * disagree with isRepairOpen — one definition of done.
 */
export const isRepairFinished = (r: Pick<Repair, 'status'>): boolean => !isRepairOpen(r as Repair);

// --- 3. Private-batch tickets hide customer-payment fields ------------------

/**
 * Is this ticket an INTERNAL REFURB — the shop working on its own stock?
 *
 * True for a device under a private/personal batch (RepairBatch.private, via
 * isPrivateBatch) and for a standalone `internal` ticket. For both, the
 * "customer" is the shop itself, so there is nobody to take a deposit from
 * and nobody who can owe a balance.
 *
 * The batch is passed in rather than looked up so this stays pure; callers
 * resolve it from `repair.batchId`.
 */
export const isInternalRefurb = (
  r: Pick<Repair, 'type' | 'batchId'>,
  batch: Pick<RepairBatch, 'private' | 'autoInventory'> | undefined,
): boolean => r.type === 'internal' || (!!r.batchId && isPrivateBatch(batch));

/**
 * Should this ticket show customer-payment UI (deposit, balance owing, the
 * price charged, a receipt with money due)?
 *
 * False for an internal refurb. What stays is what a refurb actually
 * tracks: the issue, the status, the PARTS AND LABOUR COST — which is the
 * real number here, since it flows to the device's `repairCost` — and the
 * warranty if the shop wants one.
 *
 * A DISPLAY rule only. The underlying fields are untouched, so a ticket
 * whose type or batch later changes renders its history correctly, and
 * nothing about cost tracking or profit moves.
 */
export const showsCustomerPayment = (
  r: Pick<Repair, 'type' | 'batchId'>,
  batch: Pick<RepairBatch, 'private' | 'autoInventory'> | undefined,
): boolean => !isInternalRefurb(r, batch);
