import { DropOff, Settlement } from '../types';

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
