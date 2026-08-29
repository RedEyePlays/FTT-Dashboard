import { Repair, InventoryItem } from '../types';
import { repairPartsCost } from './repairs';

// Writing a completed repair's COST back onto the device it was performed on.
//
// The bug this fixes: when a repair ticket auto-creates an inventory record
// (the FTT Personal / private-batch flow, App.tsx's handleSaveRepair) it wrote
// `repairCost: 0` and nothing ever updated it. Parts were logged on the
// ticket, the repair was completed, and the linked inventory item still said
// the refurb cost nothing — so when the device sold, profit was overstated by
// the entire cost of the work, and cost-of-goods in the P&L was understated by
// the same amount.
//
// Everything here is pure so each transition (complete, edit parts, cancel,
// reopen, second repair) is unit-testable without Firestore.
//
// NO BACKFILL — a deliberate decision, not an oversight. Devices already
// sitting in inventory with an incorrect `repairCost: 0` are left exactly as
// they are. Rewriting them would silently restate cost of goods, gross profit
// and per-item margin for periods that have already been reported on and, in
// some cases, reconciled and closed. That is the same principle this codebase
// already applies to legacy settlements ("shown exactly as originally
// recorded") and to reconciled cash days (never retroactively altered).
//
// The write-back is forward-looking: the receipt below starts undefined on
// every existing ticket, so nothing moves until a ticket is next saved. An
// owner who wants a historical device corrected can edit its repairCost on the
// inventory record by hand — a visible, attributable edit rather than a silent
// migration.

/** Terminal states in which the work is genuinely done and its cost is real. */
const isCompleted = (status: Repair['status']): boolean =>
  status === 'completed' || status === 'picked_up';

/**
 * What this ticket SHOULD currently be contributing to its linked device's
 * `repairCost`.
 *
 * Uses the repair's COST (`repairPartsCost` — the same helper the repair
 * margin and analytics already use, never a second derivation), not
 * `repairPrice`. For an internal refurb the customer-facing price is often 0
 * or notional; what actually reduces the eventual profit on the device is what
 * the parts cost the shop.
 *
 * Zero unless the ticket is BOTH linked to an inventory item AND finished:
 *  • not linked      → there is no device to attribute the cost to;
 *  • still open      → the work isn't done and the parts list can still change;
 *  • cancelled/void  → the work didn't happen, so it costs the device nothing.
 * Each of those returning 0 is what makes the reversal cases below fall out
 * automatically rather than needing their own code path.
 */
export function targetRepairCostContribution(
  r: Pick<Repair, 'status' | 'inventoryId' | 'parts' | 'partsCost'>,
): number {
  if (!r.inventoryId || !isCompleted(r.status)) return 0;
  return repairPartsCost(r);
}

export interface RepairCostWriteback {
  /** Amount to ADD to the item's existing repairCost. Negative = a reversal. */
  delta: number;
  /** The new value for `repair.inventoryRepairCostApplied`. */
  applied: number;
  /** False when nothing needs writing — the common case on an ordinary edit. */
  changed: boolean;
}

/**
 * The delta to apply to the linked device's `repairCost`, and the new receipt
 * to store on the ticket.
 *
 * Deliberately expressed as `target − alreadyApplied` rather than as a set of
 * event handlers. That single subtraction is what makes every required
 * behaviour correct at once, with no case left to forget:
 *
 *  • COMPLETING       0 → cost      ⇒ delta +cost
 *  • A SECOND REPAIR  each ticket carries its own receipt, so its delta adds
 *                     to whatever the first ticket already contributed —
 *                     additive by construction, never an overwrite.
 *  • PARTS EDITED after completion: target moves, applied hasn't ⇒ delta is
 *                     exactly the difference, so the device stays in sync
 *                     instead of keeping a stale figure.
 *  • CANCELLED / REOPENED: target drops to 0 ⇒ delta −alreadyApplied, which
 *                     removes precisely this ticket's contribution and leaves
 *                     any other ticket's intact.
 *  • REPEATED SAVES   target === applied ⇒ delta 0, changed false. Idempotent,
 *                     so re-saving a completed ticket can't inflate the cost.
 */
export function repairCostWriteback(
  r: Pick<Repair, 'status' | 'inventoryId' | 'parts' | 'partsCost' | 'inventoryRepairCostApplied'>,
): RepairCostWriteback {
  const target = round2(targetRepairCostContribution(r));
  const alreadyApplied = round2(r.inventoryRepairCostApplied || 0);
  const delta = round2(target - alreadyApplied);
  return { delta, applied: target, changed: Math.abs(delta) > 0.005 };
}

/**
 * Apply a write-back's delta to an item's running `repairCost` total.
 * Floored at 0: a negative total is never a real cost basis, and clamping here
 * means a legacy item whose repairCost was hand-entered (and so is not the sum
 * of any tickets' receipts) can't be driven negative by a later reversal.
 */
export function applyRepairCostDelta(item: Pick<InventoryItem, 'repairCost'>, delta: number): number {
  return round2(Math.max(0, (item.repairCost || 0) + delta));
}

/**
 * Has this ticket's cost been moved onto the inventory item?
 *
 * This is the DOUBLE-COUNTING GUARD. Once a ticket's parts cost lives in the
 * device's `repairCost`, it will be charged against profit when that device
 * sells (both the P&L's cost-of-goods and the analytics device-profit path
 * subtract `repairCost`). The repair-tier tally in domain/analytics.ts must
 * therefore stop counting the same parts as a repair-side cost, or the shop
 * would be charged for the parts twice — once in the Repairs category and
 * again in the device's margin.
 *
 * Keyed off the stored receipt rather than recomputing the status, so a ticket
 * whose cost was applied and then reversed correctly reads as "not applied"
 * again.
 */
export function repairCostMovedToInventory(
  r: Pick<Repair, 'inventoryRepairCostApplied'>,
): boolean {
  return (r.inventoryRepairCostApplied || 0) > 0;
}

const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;
