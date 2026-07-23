import { DropOff } from '../types';

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
