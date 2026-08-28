import { DropOff, Settlement, SettlementLineAdjustment, SettlementPaymentMethod } from '../types';

const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// Pure money math for the runner drop-off flow — no Firebase/React imports so it
// can be unit-tested, matching domain/pos.ts, domain/repairs.ts, etc. The runner
// balance and settlement totals were previously defined inline in DropOffView;
// the device acquisition-cost calc lived (buggily) inline in App.tsx.

export interface RunnerBalance {
  cashFronted: number; // cash the runner fronted to sellers (drop-offs paidBy 'runner')
  feesOwed: number;    // drop-off commission owed to the runner
  net: number;         // total owed to the runner (positive = store owes runner)
  count: number;       // number of active drop-offs counted
}

// Balance owed to a runner: the cash they fronted to sellers (paidBy 'runner')
// plus the fees owed, across drop-offs that are neither rejected nor already
// settled. Store-paid devices don't add to what we owe the runner (only the fee
// does).
export function runnerBalance(runnerId: string, dropOffs: DropOff[]): RunnerBalance {
  const active = dropOffs.filter(d =>
    d.runnerId === runnerId && d.status !== 'rejected' && d.status !== 'settled'
  );
  const cashFronted = active.filter(d => d.paidBy === 'runner').reduce((s, d) => s + (d.purchasePrice || 0), 0);
  const feesOwed = active.reduce((s, d) => s + (d.dropOffFee || 0), 0);
  return { cashFronted, feesOwed, net: cashFronted + feesOwed, count: active.length };
}

// Drop-offs eligible to be rolled into a settlement for a runner: accepted or
// paid-out, and not yet settled/rejected.
export function settleableDropOffs(runnerId: string, dropOffs: DropOff[]): DropOff[] {
  return dropOffs.filter(d =>
    d.runnerId === runnerId && (d.status === 'accepted' || d.status === 'paidout')
  );
}

export interface SettlementTotals {
  cashFronted: number; // fronted cash to reimburse (paidBy 'runner')
  totalFees: number;   // all drop-off fees in the set
  amountToPay: number; // cashFronted + totalFees
}

// Amount to pay a runner for a set of drop-offs: reimburse the cash they fronted
// (paidBy 'runner') plus every drop-off fee.
export function settlementTotals(dropOffs: DropOff[]): SettlementTotals {
  const cashFronted = dropOffs.filter(d => d.paidBy === 'runner').reduce((s, d) => s + (d.purchasePrice || 0), 0);
  const totalFees = dropOffs.reduce((s, d) => s + (d.dropOffFee || 0), 0);
  return { cashFronted, totalFees, amountToPay: cashFronted + totalFees };
}

// Acquisition cost of a device sourced via a drop-off: what was paid to the
// seller PLUS the runner's commission — both are real costs of acquiring it, and
// both are what the settlement pays the runner. (Previously purchaseCost dropped
// the fee, overstating resale Net Profit by exactly the fee.)
export function dropOffPurchaseCost(d: Pick<DropOff, 'purchasePrice' | 'dropOffFee'>): number {
  return (d.purchasePrice || 0) + (d.dropOffFee || 0);
}

// Shared shape for "this money action moved cash in the till, log it as this
// kind/amount" — returned by every drawer-affecting decision below.
//
// IMPORTANT: any NEW action that hands cash to/from someone outside a normal
// POS sale (a settlement, a drop-off purchase, a refund, ...) must decide its
// drawer effect through a function here (returning DrawerEffect | null) and
// have its App.tsx handler write that effect via commitDrawerRecord — the same
// two-step every effect below follows. A handler that skips this is a missing
// drawer entry, which is exactly the store-paid-drop-off bug this file's
// dropOffAcceptDrawerEffect was added to fix: the cash really left the till,
// but nothing ever told the reconciliation screen.
export interface DrawerEffect { kind: 'cashOut' | 'cashIn'; amount: number }

// A completed settlement's effect on today's cash drawer — the ONE place that
// decides whether paying a runner touches the till. Only 'cash' ever does;
// e-transfer/other never do, no matter the amount. A settlement predating this
// field (paymentMethod absent) defaults to 'cash', matching how every
// settlement was implicitly treated before payment method was tracked.
// amountPaid > 0 (store owes runner) is cash OUT of the drawer; a negative
// amountPaid (runner owed the store) is cash IN. Zero/near-zero produces no
// entry at all.
export function settlementDrawerEffect(settlement: Pick<Settlement, 'paymentMethod' | 'amountPaid'>): DrawerEffect | null {
  const method = settlement.paymentMethod || 'cash';
  if (method !== 'cash') return null;
  const amount = round2(settlement.amountPaid || 0);
  if (Math.abs(amount) < 0.005) return null;
  return amount > 0 ? { kind: 'cashOut', amount } : { kind: 'cashIn', amount: -amount };
}

// A drop-off's effect on today's cash drawer at the moment it's accepted
// (pending → accepted) — the ONE place that decides whether accepting a
// drop-off touches the till. Only a store-paid purchase does: that's the shop
// handing cash to the seller directly, right now. A runner-paid drop-off never
// touches the drawer here — that was the runner's own cash, fronted on the
// store's behalf and reimbursed later (as a lump sum, alongside the fee) via
// settlementDrawerEffect when the runner is settled, not at acceptance.
//
// The caller is responsible for only invoking this on the actual pending→
// accepted transition (not on every save of an already-accepted drop-off) so
// the purchase is never logged to the drawer twice.
export function dropOffAcceptDrawerEffect(d: Pick<DropOff, 'paidBy' | 'purchasePrice'>): DrawerEffect | null {
  if (d.paidBy !== 'store') return null;
  const amount = round2(d.purchasePrice || 0);
  if (amount < 0.005) return null;
  return { kind: 'cashOut', amount };
}

/* ---------------- Pre-settlement review (editable) ---------------- */
//
// The review screen lets the owner correct a per-device fee or exclude a
// device from THIS settlement run before anything is written. All of that
// state lives here as pure data/functions so it's fully unit-testable
// without a component — components/SettlementReviewModal.tsx and
// DropOffView.tsx's SettlementTab just hold this shape in React state and
// call these functions to total it up / build the final record.

// One line on the review screen: whether it's still included in this
// settlement, and the fee actually being paid for it (may differ from the
// drop-off's stored dropOffFee if edited on this screen).
export interface SettlementReviewLine {
  dropOffId: string;
  included: boolean;
  fee: number;
}

// Seed one review line per settleable drop-off, unedited (fee = its stored
// dropOffFee, included = true) — the natural starting point before any
// review-screen edits or exclusions.
export function initSettlementReview(dropOffs: DropOff[]): SettlementReviewLine[] {
  return dropOffs.map(d => ({ dropOffId: d.id, included: true, fee: round2(d.dropOffFee || 0) }));
}

export interface SettlementReviewTotals {
  deviceCount: number;    // included lines only
  cashFronted: number;    // purchasePrice of included, paidBy 'runner' lines
  totalFees: number;      // sum of included lines' (possibly-edited) fee
  subtotal: number;       // cashFronted + totalFees
  adjustmentAmount: number;
  netAmount: number;      // subtotal + adjustmentAmount — what settlementDrawerEffect/Settlement.amountPaid uses
}

// Recompute every total live from the current review state — called on every
// edit so the screen never shows a stale number. `adjustmentAmount` is the
// settlement-level correction (positive = more owed to the runner, negative
// = less), independent of any per-line fee edit.
export function settlementReviewTotals(
  dropOffs: DropOff[],
  lines: SettlementReviewLine[],
  adjustmentAmount: number,
): SettlementReviewTotals {
  const byId = new Map(dropOffs.map(d => [d.id, d]));
  let cashFronted = 0;
  let totalFees = 0;
  let deviceCount = 0;
  for (const l of lines) {
    if (!l.included) continue;
    const d = byId.get(l.dropOffId);
    if (!d) continue;
    deviceCount += 1;
    if (d.paidBy === 'runner') cashFronted += d.purchasePrice || 0;
    totalFees += l.fee || 0;
  }
  cashFronted = round2(cashFronted);
  totalFees = round2(totalFees);
  const adj = round2(adjustmentAmount || 0);
  const subtotal = round2(cashFronted + totalFees);
  return { deviceCount, cashFronted, totalFees, subtotal, adjustmentAmount: adj, netAmount: round2(subtotal + adj) };
}

// Which per-device fee edits actually happened — only lines still included
// AND whose fee differs from the drop-off's original stored dropOffFee.
// Excluding a line, or leaving its fee untouched, produces no adjustment
// entry for it (nothing to disclose that wasn't already true).
export function buildLineAdjustments(dropOffs: DropOff[], lines: SettlementReviewLine[]): SettlementLineAdjustment[] {
  const byId = new Map(dropOffs.map(d => [d.id, d]));
  const out: SettlementLineAdjustment[] = [];
  for (const l of lines) {
    if (!l.included) continue;
    const d = byId.get(l.dropOffId);
    if (!d) continue;
    const originalFee = round2(d.dropOffFee || 0);
    const adjustedFee = round2(l.fee || 0);
    if (originalFee !== adjustedFee) out.push({ dropOffId: l.dropOffId, originalFee, adjustedFee });
  }
  return out;
}

export type SettlementDirection = 'pay_runner' | 'runner_owes' | 'even';

// Zero (to the cent) reads as neither direction — a settlement that landed
// exactly even shouldn't be described as "the store pays the runner $0.00",
// which is technically true but misleading on a printed page.
export function settlementDirection(netAmount: number): SettlementDirection {
  if (netAmount > 0.004) return 'pay_runner';
  if (netAmount < -0.004) return 'runner_owes';
  return 'even';
}

// Plain-words statement of the net amount's direction — this is what goes on
// the printed breakdown so there's no ambiguity on paper about who owes whom.
export function settlementDirectionLabel(netAmount: number, direction: SettlementDirection = settlementDirection(netAmount)): string {
  const amt = money2(Math.abs(netAmount));
  if (direction === 'pay_runner') return `Store pays runner ${amt}`;
  if (direction === 'runner_owes') return `Runner owes store ${amt}`;
  return 'Settled even — no balance either way';
}

const money2 = (n: number): string => `$${n.toFixed(2)}`;

// Assemble the final Settlement record from the reviewed state — the ONE
// place that turns review-screen edits into what actually gets saved, so the
// pre-commit print preview and the post-commit save can never disagree.
export function buildSettlementFromReview(
  base: { id: string; runnerId: string; date: string; paymentMethod: SettlementPaymentMethod; notes: string },
  dropOffs: DropOff[],
  lines: SettlementReviewLine[],
  adjustmentAmount: number,
  adjustmentNote: string,
): Settlement {
  const totals = settlementReviewTotals(dropOffs, lines, adjustmentAmount);
  const lineAdjustments = buildLineAdjustments(dropOffs, lines);
  const trimmedNote = (adjustmentNote || '').trim();
  return {
    ...base,
    dropOffIds: lines.filter(l => l.included).map(l => l.dropOffId),
    totalPurchaseFronted: totals.cashFronted,
    totalFees: totals.totalFees,
    amountPaid: totals.netAmount,
    lineAdjustments: lineAdjustments.length ? lineAdjustments : undefined,
    adjustmentAmount: Math.abs(totals.adjustmentAmount) >= 0.005 ? totals.adjustmentAmount : undefined,
    adjustmentNote: trimmedNote || undefined,
  };
}
