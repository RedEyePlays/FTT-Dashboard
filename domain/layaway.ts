import { SalesTransaction, BalancePayment } from '../types';
import { isReversed, isLayaway } from './pos';

// Layaway completion: collecting the remaining balance on a sale that started
// as a deposit-only checkout (hooks/useCheckout.ts's isLayaway path). Before
// this, there was no flow to ever collect that balance — the device stayed
// `reserved` forever and the sale's revenue never recognized. Pure money/state
// math lives here so it's identically testable and shared by the "Collect
// balance" mini-modal and any list/aging view that needs the same numbers.

const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

/** Every open layaway: not reversed, still owing money. */
export const openLayaways = (transactions: SalesTransaction[]): SalesTransaction[] =>
  transactions.filter(t => !isReversed(t) && isLayaway(t));

export interface LayawayTotals { count: number; outstanding: number }

/** Count + total dollars still owed across every open layaway — the Dashboard tile figure. */
export const layawayTotals = (transactions: SalesTransaction[]): LayawayTotals => {
  const open = openLayaways(transactions);
  return { count: open.length, outstanding: round2(open.reduce((s, t) => s + (t.balanceOwing || 0), 0)) };
};

// Whole days between two YYYY-MM-DD dates (mirrors domain/pos.ts's private
// daysBetween — kept local since it's a two-line UTC-midnight diff, not worth
// exporting/importing for).
const daysBetween = (fromISO: string, toISO: string): number => {
  const a = Date.parse(`${fromISO}T00:00:00Z`), b = Date.parse(`${toISO}T00:00:00Z`);
  if (isNaN(a) || isNaN(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
};

/** How many days old an open layaway is, measured from its sale date. */
export const layawayAgeDays = (tx: Pick<SalesTransaction, 'date'>, todayISO: string): number =>
  daysBetween(tx.date, todayISO);

/** A layaway old enough to need follow-up — same "just a flag" spirit as the aging-inventory alert, no automatic forfeiture. */
export const isStaleLayaway = (tx: Pick<SalesTransaction, 'date'>, todayISO: string, thresholdDays: number): boolean =>
  layawayAgeDays(tx, todayISO) >= Math.max(1, thresholdDays);

/**
 * The cash portion of one balance payment — same contract as
 * domain/pos.ts's cashCollectedOnSale: a cash payment banks its whole amount,
 * a mixed payment banks only its recorded cash slice, card/e-transfer bank
 * nothing.
 */
export const cashPortionOfPayment = (p: Pick<BalancePayment, 'paymentMethod' | 'amount' | 'cashAmount'>): number => {
  if (p.paymentMethod === 'cash') return round2(p.amount || 0);
  if (p.paymentMethod === 'mixed') return round2(Math.max(0, p.cashAmount || 0));
  return 0;
};

export interface ApplyBalancePaymentResult {
  transaction: SalesTransaction;
  fullyPaid: boolean; // balanceOwing reached 0 with this payment
}

/**
 * Apply one balance payment to a layaway transaction: reduces `balanceOwing`,
 * appends the itemized `balancePayments` record, and stamps
 * `layawayCompletedAt` the moment the balance clears. The payment amount is
 * clamped to the remaining balance — this only ever pays DOWN or clears a
 * balance, never turns it negative or creates a credit.
 *
 * `deposit` is deliberately left untouched. It's not "total collected so
 * far" — it's frozen at whatever was actually collected at the ORIGINAL
 * checkout, and domain/reports.ts's daily cash reconciliation depends on that
 * staying frozen: it reads `deposit` against the sale's own (fixed) `date` to
 * know how much cash came in on THAT day. If a later balance payment bumped
 * `deposit`, that day's already-reconciled expected-cash figure would
 * silently inflate retroactively. A balance payment's own cash effect is
 * posted separately, against the day it's actually taken — same pattern as
 * void/return's refund entries (see App.tsx's handleVoidSale/
 * handleReturnSale) — never folded back into the original sale's numbers.
 * Use `totalCollectedSoFar` below for "how much has this customer actually
 * paid in total" (receipts, refund caps) — that one DOES include payments.
 */
export function applyBalancePayment(tx: SalesTransaction, payment: BalancePayment): ApplyBalancePaymentResult {
  const remaining = tx.balanceOwing || 0;
  const amount = Math.min(Math.max(0, payment.amount || 0), remaining);
  const clampedPayment: BalancePayment = { ...payment, amount };
  const nextBalance = round2(Math.max(0, remaining - amount));
  const fullyPaid = nextBalance <= 0.005;
  const transaction: SalesTransaction = {
    ...tx,
    balanceOwing: fullyPaid ? undefined : nextBalance,
    balancePayments: [...(tx.balancePayments || []), clampedPayment],
    layawayCompletedAt: fullyPaid ? (tx.layawayCompletedAt ?? payment.at) : tx.layawayCompletedAt,
  };
  return { transaction, fullyPaid };
}

/**
 * Total actually collected on a sale to date, across its whole lifetime —
 * the original deposit (or the full total, for a sale that was never a
 * layaway) plus every balance payment made since. Distinct from `deposit`
 * itself (frozen at checkout, see applyBalancePayment's doc comment) — this
 * is what a receipt, or a refund cap on cancellation, should actually use.
 */
export function totalCollectedSoFar(tx: Pick<SalesTransaction, 'totalPaid' | 'deposit' | 'balanceOwing' | 'balancePayments'>): number {
  if (!isLayaway(tx)) return tx.totalPaid || 0; // never a layaway, or fully paid off
  const paymentsSoFar = (tx.balancePayments || []).reduce((s, p) => s + (p.amount || 0), 0);
  return round2((tx.deposit || 0) + paymentsSoFar);
}
