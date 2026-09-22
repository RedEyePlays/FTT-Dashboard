import { SalesTransaction, InventoryItem, PayPeriodPaid, CashReconciliation, CashDrawerEntry, Settlement, DeviceBuyer, Expense, StaffBonus } from '../types';
import { bonusTotal } from './bonuses';
import { clampToBooksStart, booksStartClamps } from './dates';
import { isLegacySettlement, settlementFeeIncome } from './dropoffs';
import { isReversed } from './pos';
import { kindOf } from './inventory';
import { ExpenseCategory, plExpenseTotal, expenseTotalsByCategory, CategoryTotal } from './expenses';

// Back-office filing reports — daily cash reconciliation and sales-tax
// remittance — derived purely from salesTransactions. Repairs have no separate
// tax field (only repairPrice/deposit), so all remittable tax comes from sales.
// Pure and testable, like domain/analytics.ts; date handling mirrors it
// (YYYY-MM-DD strings, half-open logic where relevant).

const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// The cash-relevant amount collected ON THIS TRANSACTION'S OWN DATE — for
// daily till reconciliation, deliberately NOT "however much has been
// collected on this sale overall" (that's domain/pos.ts's collectedOnSale,
// used for void/return refund caps instead).
//
// Keyed off whether `deposit` was EVER set, not whether `balanceOwing` is
// CURRENTLY > 0. Those two only ever coincided before a layaway had a
// completion flow (domain/layaway.ts) — a sale's `balanceOwing` was fixed
// forever once written. Now it can be paid down or cleared on a LATER date
// via a balance payment, while `deposit` stays frozen at whatever was
// collected at the original checkout (see applyBalancePayment's doc
// comment). If this used `balanceOwing > 0` instead, a layaway that gets
// paid off next month would suddenly report its FULL total as cash
// collected on the ORIGINAL sale date the next time this recomputes —
// silently inflating an already-reconciled day, months after the fact. A
// balance payment's own cash effect is posted separately, against the day
// it's actually taken (App.tsx's handleCollectBalance, same pattern as
// void/return's refund entries) — never folded back in here.
//
// A REVERSED (voided/returned) sale is deliberately NOT zeroed here. This
// used to `return 0` for one, which double-counted the reversal: the money
// was removed twice from the expected drawer total, once by this exclusion
// (retroactively, against the ORIGINAL sale date) and once by the explicit
// refund cash-out entry that handleVoidSale/handleReturnSale already write
// against TODAY's drawer (domain/pos.ts's saleRefundDrawerEffect). A voided
// $400 cash sale left the expected drawer $400 short of reality, and
// re-ringing the device only ever restored one of the two deductions —
// exactly the reported "cash goes out on void and re-selling doesn't bring
// the balance back" symptom.
//
// The refund entry is the correct half to keep: it lands on the day the
// reversal was actually processed, which is where the cash physically
// leaves the till. Zeroing the original transaction instead rewrites a past
// (often already-counted and closed) day, which is precisely what every
// other money path in this file refuses to do (see the balance-payment note
// above, and handleCollectBalance's own today-only drawer posting). So the
// cash a reversed sale took in still counts on ITS OWN original date — it
// really was in the till that day — and the reversal is accounted for once,
// later, where it happened.
const collectedOnTx = (t: SalesTransaction): number =>
  t.deposit !== undefined ? (t.deposit || 0) : (t.totalPaid || 0);

// --- Part 1: daily cash reconciliation ------------------------------------

/**
 * The cash portion collected on one transaction (for the till count):
 *  • cash sales → the whole collected amount,
 *  • mixed sales → their recorded cash portion,
 *  • card sales → nothing.
 *
 * Reversed (voided/returned) sales STILL count, on their own original date:
 * that cash genuinely was collected and sat in the till that day. The refund
 * is a separate, later cash-out entry posted against the day the reversal is
 * actually processed (App.tsx's handleVoidSale/handleReturnSale via
 * domain/pos.ts's saleRefundDrawerEffect), so the money is removed exactly
 * once and never retroactively out of an already-reconciled day. See
 * collectedOnTx above for the full reasoning.
 */
export const cashCollectedOnTx = (t: SalesTransaction): number => {
  const collected = collectedOnTx(t);
  if (collected <= 0) return 0;
  if (t.paymentMethod === 'cash') return round2(collected);
  if (t.paymentMethod === 'mixed') return round2(Math.max(0, t.cashAmount || 0));
  return 0; // card / etransfer / unset
};

/** Expected cash in the till for a given calendar day (YYYY-MM-DD). */
export const expectedCashForDate = (transactions: SalesTransaction[], dateISO: string): number =>
  round2(transactions.filter(t => t.date === dateISO).reduce((s, t) => s + cashCollectedOnTx(t), 0));

/**
 * Cash taken in on a day AFTER that day's drawer was counted and closed.
 *
 * Business hours don't stop because the till was counted — an evening wholesale
 * deal is a real sale on that day and must still be recognized as revenue and
 * profit. But the cash from it genuinely wasn't in the drawer at count time, so
 * the reconciliation screen surfaces this figure instead of the sale being
 * suppressed or the variance silently shifting under a closed day.
 *
 * Sales written before `createdAt` existed can't be placed relative to the
 * close, so they're treated as pre-close (not counted here) rather than
 * guessed at.
 */
export const cashSalesAfterClose = (
  transactions: SalesTransaction[],
  dateISO: string,
  reconciledAt: number | undefined,
): number => {
  if (!reconciledAt) return 0;
  return round2(transactions
    .filter(t => t.date === dateISO && typeof t.createdAt === 'number' && t.createdAt > reconciledAt)
    .reduce((s, t) => s + cashCollectedOnTx(t), 0));
};

/**
 * Past days whose drawer was started (opened, or had cash logged against it) but
 * never reconciled. A day like that holds real cash movement nobody ever counted,
 * and nothing surfaces it once the date rolls over — so the Dashboard flags it.
 *
 * Only days with actual drawer activity qualify: a shop that simply didn't use
 * the drawer feature on a given day is not "unreconciled", it's uninvolved.
 * Today is always excluded — it isn't late until it's over.
 */
export const unreconciledDays = (
  reconciliations: CashReconciliation[],
  todayISO: string,
  booksStartDate?: string,
): CashReconciliation[] =>
  reconciliations
    // Days before the books start are excluded: the shop wasn't running the
    // drawer through the app then, so flagging them as "never reconciled"
    // is a permanent, unactionable alert about history the owner has
    // deliberately set aside.
    .filter(r => (!booksStartDate || r.date >= booksStartDate))
    .filter(r => r.date < todayISO && !r.reconciledAt)
    .filter(r => !!r.openedAt
      || (r.cashIn?.length || 0) > 0
      || (r.cashOut?.length || 0) > 0
      || (r.withdrawals?.length || 0) > 0)
    .sort((a, b) => a.date.localeCompare(b.date));

export interface CashVariance { expected: number; counted: number; variance: number; direction: 'over' | 'short' | 'balanced' }

/**
 * Reconcile a counted till against expected cash. `variance` is counted − expected:
 * positive = over (more cash than expected), negative = short, ~0 = balanced.
 */
export const reconcileCash = (counted: number, expected: number): CashVariance => {
  const variance = round2((counted || 0) - (expected || 0));
  const direction = variance > 0.005 ? 'over' : variance < -0.005 ? 'short' : 'balanced';
  return { expected: round2(expected), counted: round2(counted || 0), variance, direction };
};

/** Sum a list of cash-drawer entries (cash-out or withdrawals), ignoring negatives. */
export const sumDrawerEntries = (entries?: { amount: number }[]): number =>
  round2((entries || []).reduce((s, e) => s + Math.max(0, e.amount || 0), 0));

/** The label the close-time removal is recorded under, in one place. */
export const CLOSE_REMOVAL_NOTE = 'Removed at close';
export const FLOAT_CORRECTION_NOTE = 'Float correction';

/** A bookkeeping entry rather than a till movement — see CashDrawerEntry.adjustment. */
export const isAdjustmentEntry = (e: Pick<CashDrawerEntry, 'adjustment'>): boolean => !!e.adjustment;

/**
 * Withdrawals that belong in the day's expected-vs-counted arithmetic.
 *
 * Every ordinary withdrawal counts. The two adjustment kinds do not, and both
 * are still shown in full in the Money Trail:
 *
 *  - the close removal happened AFTER the count, so including it would make a
 *    perfectly balanced till read as over by exactly the amount banked;
 *  - a float correction moved no cash at all, and the corrected float already
 *    carries its effect.
 *
 * Keeping the sums separate is what lets both be recorded honestly without
 * either one landing twice.
 */
export const sumTillWithdrawals = (entries?: CashDrawerEntry[]): number =>
  sumDrawerEntries((entries || []).filter(e => !isAdjustmentEntry(e)));

/** The cash physically taken out of the till at close, for the day's trail. */
export const sumCloseRemovals = (entries?: CashDrawerEntry[]): number =>
  sumDrawerEntries((entries || []).filter(e => e.adjustment === 'closeRemoval'));

export interface DayCashInputs {
  openingFloat?: number;   // starting cash in the drawer
  cashSales?: number;      // cash-in from that day's sales
  cashIn?: number;         // total manual cash added (top-ups, tips, off-sale payments)
  cashOut?: number;        // total cash expenses paid out
  withdrawals?: number;    // total owner pulls / deposits
}

/**
 * Expected ending cash in the drawer:
 *   opening float + cash sales + manual cash-in − cash paid out − withdrawals.
 * This is the corrected reconciliation baseline — comparing the count against
 * sales alone would falsely flag a shortage whenever cash legitimately leaves
 * the drawer (an expense paid in cash, or a till pull / deposit) or is added to
 * it (a change-fund top-up or a cash payment taken outside a normal sale).
 */
export const expectedEndingCash = (i: DayCashInputs): number =>
  round2((i.openingFloat || 0) + (i.cashSales || 0) + (i.cashIn || 0) - (i.cashOut || 0) - (i.withdrawals || 0));

// The live/at-close snapshot of one day's drawer, computed from its saved record
// (if any) plus that day's cash sales. The SINGLE source of the expected-cash
// figure — the POS running total, the quick-log modal and the reconciliation
// screen all read this, so they can never drift apart. `opened` reflects whether
// the drawer was explicitly opened (float set) vs silently assumed.
export interface CashDrawerSummary {
  opened: boolean;
  openingFloat: number;
  cashSales: number;
  cashIn: number;
  cashOut: number;
  withdrawals: number;
  expected: number;
  /** The day was explicitly closed (reconciledAt set). */
  closed: boolean;
  /** What was counted at close, or null while the day is still open. */
  countedCash: number | null;
  /** What was left in for tomorrow, or null (an open day, or a legacy close). */
  leftInDrawer: number | null;
  /** What was taken out at close. */
  removedAtClose: number;
  /** counted − expected; 0 while the day is open. */
  variance: number;
}
// What the reconciliation screen hands back when a day is counted + closed. The
// app recomputes expectedCash / variance from these via the shared math (so the
// screen and the stored record can't disagree) and stamps who/when.
export interface ReconciliationInput {
  date: string;
  openingFloat: number;
  cashIn: CashDrawerEntry[];
  cashOut: CashDrawerEntry[];
  withdrawals: CashDrawerEntry[];
  /**
   * The counted till. ABSENT means "save my corrections, don't close the day"
   * — editing a float, a cash entry or the note without counting.
   *
   * This distinction is the fix for an accidental close. The screen used to
   * require a count before it would save anything at all, and saving always
   * stamped reconciledAt. So there was no way to fix a typo in today's
   * cash-out note without also closing the live drawer — which is one of the
   * ways a drawer "randomly closed" mid-shift.
   */
  countedCash?: number;
  note?: string;
}

/**
 * What the previous day leaves behind for this one.
 *
 * Two real-world facts the drawer used to ignore, both reported as bugs:
 *
 *  1. THE DRAWER DOESN'T CLOSE AT MIDNIGHT. A day's record is keyed by date,
 *     so at 00:00 today had no record and the drawer silently read as
 *     "never opened" — it closed itself, and staff had to re-open it every
 *     morning even though nobody had counted or closed anything. A drawer
 *     that was opened and never reconciled is STILL OPEN, however many
 *     dates have rolled past. Only an explicit close (reconciledAt) closes it.
 *
 *  2. THE CASH IS STILL PHYSICALLY IN THE TILL. Whatever the drawer ended
 *     yesterday with is what's in it this morning — it does not reset to
 *     zero. So yesterday's ending cash is today's opening float.
 *
 * `float` is the COUNTED cash when the day was actually counted (what's
 * really in the till beats what was expected), otherwise that day's
 * expected ending. `stillOpen` is true when the carried day was opened
 * and never reconciled.
 *
 * Looks at the most recent PRIOR day with a record, not merely yesterday —
 * a shop closed Sunday and Monday still carries Saturday's till forward.
 */
export interface DrawerCarryOver {
  float: number;
  /** The date the float came from (YYYY-MM-DD), for the UI to name. */
  fromDate: string;
  /** The carried day was opened and never explicitly closed. */
  stillOpen: boolean;
}

/**
 * A day's record with NOTHING behind it: never opened, never counted, no
 * float, and no movement logged. Such a record gets written by paths that
 * touch a date without running a till — a void/return refund, a device-buyer
 * settlement's cash entry against a back-dated day. It represents no drawer,
 * so it carries nothing.
 */
// Movements alone do NOT make a day a till: a refund cash-out or a settlement
// cash-in writes entries against a date without anyone opening a drawer that
// day. Only an open, a count, or a float means a drawer was actually run.
const isBareDrawerRecord = (r: CashReconciliation): boolean =>
  !r.openedAt && r.countedCash == null && !(r.openingFloat || 0);

export const drawerCarryOver = (
  reconciliations: CashReconciliation[],
  todayISO: string,
  /** That day's cash sales, so the carried float is recomputed, not trusted. */
  cashSalesFor?: (date: string) => number,
): DrawerCarryOver | null => {
  // SKIP bare records and keep looking further back, rather than stopping at
  // the single most recent prior date.
  //
  // The bug this fixes: the carry-over used to read only the latest prior
  // record and bail if it was bare. So a drawer opened Friday and never
  // closed, followed by a bare Saturday record (written by, say, a refund
  // cash-out or a settlement), made MONDAY read as "never opened" with a $0
  // float — the till's cash and its open state both vanished, and the day
  // looked closed when it wasn't. A record with no drawer behind it must not
  // be able to hide the real one behind IT.
  const prior = reconciliations
    .filter(r => r.date < todayISO)
    .sort((a, b) => b.date.localeCompare(a.date))
    .find(r => !isBareDrawerRecord(r));
  if (!prior) return null;
  // RECOMPUTED, not read off the record. A drawer write made while offline is
  // a field-merge that cannot know the whole day's state, so it deliberately
  // does not write expectedCash/variance (see buildDrawerMergeWrite) — the
  // stored figures can therefore be stale until the next online write. Every
  // read derives them instead, so the till never carries a wrong number
  // forward. `cashSalesFor` supplies that day's cash sales; without it this
  // falls back to the stored figure, which is all a caller without the sales
  // data can do.
  //
  // WHAT WAS LEFT IN beats what was counted. Closing now asks how much stays in
  // the drawer for tomorrow and how much is going to the bank; the leftover is
  // the float. Before that existed the whole count carried forward, so every
  // day's takings compounded into the next morning's float and it climbed
  // without limit — the reported $11,865 in a phone shop's till.
  //
  // `leftInDrawer` is ABSENT on every day closed before this shipped, and those
  // days deliberately fall through to the count exactly as they always did.
  // Fixing the future must not restate the past.
  const float = prior.leftInDrawer != null
    ? round2(prior.leftInDrawer)
    : prior.countedCash != null
      ? round2(prior.countedCash)
      : recomputedExpectedCash(prior, cashSalesFor?.(prior.date));
  return {
    float: Math.max(0, float),
    fromDate: prior.date,
    stillOpen: !!prior.openedAt && !prior.reconciledAt,
  };
};

/**
 * A day's expected ending cash, derived from what the record actually holds
 * rather than from its stored `expectedCash` field.
 *
 * The stored field is written only by the online transaction path. An offline
 * field-merge write appends an entry or sets a float without being able to
 * recompute the total, so `expectedCash` on the document can lag reality until
 * the next online write rewrites it. Deriving on read means a queued offline
 * cash-out still shows up in the expected total immediately, on the terminal
 * that logged it, with no wrong figure in between.
 *
 * `cashSales` is passed in because the record does not own that number — it
 * comes from the day's sales. When it is omitted the record's own stored
 * `cashSales` is used, then its stored `expectedCash` as a last resort.
 */
export const recomputedExpectedCash = (
  recon: CashReconciliation | undefined,
  cashSales?: number,
): number => {
  if (!recon) return 0;
  const sales = cashSales ?? recon.cashSales;
  if (sales == null) return round2(recon.expectedCash || 0);
  return expectedEndingCash({
    openingFloat: recon.openingFloat || 0,
    cashSales: sales,
    cashIn: sumDrawerEntries(recon.cashIn),
    cashOut: sumDrawerEntries(recon.cashOut),
    withdrawals: sumTillWithdrawals(recon.withdrawals),
  });
};

/** A day's variance, derived the same way — counted − recomputed expected. */
export const recomputedVariance = (
  recon: CashReconciliation | undefined,
  cashSales?: number,
): number => (recon?.countedCash == null ? 0 : round2(recon.countedCash - recomputedExpectedCash(recon, cashSales)));

/**
 * The live drawer for a day. `carry` is the previous day's leftovers
 * (drawerCarryOver) and is used ONLY while today has no record of its own —
 * once the day is opened, logged against or counted, its own stored
 * numbers are the truth and the carry-over is not consulted again.
 *
 * This is what makes the till continuous across midnight: with a carry-over
 * in hand, today starts with yesterday's cash already in the drawer and
 * stays open if yesterday was never closed.
 */
export const cashDrawerSummary = (
  recon: CashReconciliation | undefined,
  cashSales: number,
  carry?: DrawerCarryOver | null,
): CashDrawerSummary => {
  const hasOwnRecord = !!recon?.openedAt || recon?.countedCash != null;
  const openingFloat = round2(
    hasOwnRecord || recon?.openingFloat ? (recon?.openingFloat || 0) : (carry?.float || 0),
  );
  const cashIn = sumDrawerEntries(recon?.cashIn);
  const cashOut = sumDrawerEntries(recon?.cashOut);
  const withdrawals = sumTillWithdrawals(recon?.withdrawals);
  const expected = expectedEndingCash({ openingFloat, cashSales, cashIn, cashOut, withdrawals });
  return {
    // Open if opened today, OR carried forward from a day that was opened
    // and never closed — the drawer nobody ever closed is still open.
    opened: !!recon?.openedAt || (!recon?.reconciledAt && !!carry?.stillOpen),
    openingFloat, cashSales: round2(cashSales), cashIn, cashOut, withdrawals,
    expected,
    // The closed state, so the panel can stop showing a live figure for a day
    // that is finished. `closed` is the explicit close, never inferred.
    closed: !!recon?.reconciledAt,
    countedCash: recon?.countedCash ?? null,
    leftInDrawer: recon?.leftInDrawer ?? null,
    removedAtClose: sumCloseRemovals(recon?.withdrawals),
    variance: recon?.countedCash == null ? 0 : round2(recon.countedCash - expected),
  };
};

// The patch to apply when the drawer is (re-)opened for the day — the ONE write
// path for the "Open Drawer" / "Float" action. Opening always leaves the day in
// an active/open state: it stamps openedAt/By the first time (preserved on later
// re-opens/float-adjustments, never bumped), and — critically — explicitly clears
// any prior reconciledAt/reconciledBy/reconciledByEmail/countedCash for the day.
// Without that clear, a day that was already closed once (deliberately or by
// mistake, e.g. a manager testing "Close drawer" earlier in the day) stays stuck
// showing "Closed today" forever after, with no action able to resume it —
// opening it again silently no-ops on the reconciled fields instead of reopening.
// Reconciling/closing stays exclusively the job of the explicit close/reconcile
// action (handleCloseDrawer / handleSaveReconciliation) — this function never
// sets those fields, only clears them.
export function openDrawerPatch(
  openingFloat: number,
  user: { id: string; email: string },
  existing: Pick<CashReconciliation, 'openedAt' | 'openedBy' | 'openedByEmail'> | undefined,
  now: number = Date.now(),
): Pick<CashReconciliation, 'openingFloat' | 'openedAt' | 'openedBy' | 'openedByEmail' | 'reconciledAt' | 'reconciledBy' | 'reconciledByEmail' | 'countedCash' | 'leftInDrawer'> {
  return {
    openingFloat: Math.max(0, openingFloat),
    openedAt: existing?.openedAt ?? now,
    openedBy: existing?.openedBy ?? user.id,
    openedByEmail: existing?.openedByEmail ?? user.email,
    reconciledAt: undefined,
    reconciledBy: undefined,
    reconciledByEmail: undefined,
    countedCash: undefined,
    // Re-opening undoes the close, so the "left in for tomorrow" figure goes
    // with it — the float being set right now IS what is in the drawer. The
    // close-removal entry stays on the record: that cash really did leave, and
    // it is excluded from the arithmetic either way (sumTillWithdrawals), so
    // clearing this cannot make it count twice.
    leftInDrawer: undefined,
  };
}

/**
 * CLOSING THE DRAWER: what was counted, and what stays in it for tomorrow.
 *
 * Returns the record patch plus — when anything is being taken out — the
 * withdrawal entry that records it. Leaving the whole count in writes no
 * entry at all, because nothing moved.
 *
 * The removal is deliberately NOT part of the day's expected-vs-counted
 * arithmetic (see sumTillWithdrawals): it happens after the count. It reaches
 * tomorrow through `leftInDrawer`, which is what the carry-over reads.
 */
export interface CloseDrawerPlan {
  patch: Pick<CashReconciliation, 'countedCash' | 'leftInDrawer' | 'note'>;
  /** The withdrawal to append, or undefined when nothing was taken out. */
  removal?: CashDrawerEntry;
  /** counted − leftIn, for the confirmation the screen shows. */
  removedAmount: number;
}

export const closeDrawerPlan = (
  countedCash: number,
  leftInDrawer: number,
  note: string | undefined,
  entryId: string,
): CloseDrawerPlan => {
  const counted = round2(Math.max(0, countedCash));
  // Never more than was counted: you cannot leave behind money that isn't there.
  const left = round2(Math.min(Math.max(0, leftInDrawer), counted));
  const removedAmount = round2(counted - left);
  return {
    patch: { countedCash: counted, leftInDrawer: left, ...(note ? { note } : {}) },
    removedAmount,
    ...(removedAmount >= 0.005
      ? {
          removal: {
            id: entryId,
            amount: removedAmount,
            note: CLOSE_REMOVAL_NOTE,
            refType: 'manual' as const,
            adjustment: 'closeRemoval' as const,
          },
        }
      : {}),
  };
};

/**
 * PUTTING A WRONG FLOAT RIGHT, ONCE, WITHOUT REWRITING HISTORY.
 *
 * The snowballed float is today's number, so today's number is what gets
 * corrected — no past day is touched and no stored figure is restated. The
 * correction itself is recorded as an adjustment entry carrying the reason and
 * both figures, so the Money Trail shows a $11,565 float being written down
 * rather than a drawer that quietly got smaller overnight.
 *
 * The entry moves no cash (nothing physically left the till today), so it is
 * excluded from the expected arithmetic — the corrected float already carries
 * the whole effect, and counting it as well would subtract it twice.
 */
export const correctFloatPlan = (
  currentFloat: number,
  newFloat: number,
  reason: string,
  entryId: string,
): { patch: Pick<CashReconciliation, 'openingFloat'>; entry: CashDrawerEntry; delta: number } => {
  const from = round2(Math.max(0, currentFloat));
  const to = round2(Math.max(0, newFloat));
  const delta = round2(from - to);
  return {
    patch: { openingFloat: to },
    delta,
    entry: {
      id: entryId,
      amount: Math.abs(delta),
      note: `${FLOAT_CORRECTION_NOTE}: $${from.toFixed(2)} → $${to.toFixed(2)} — ${reason.trim()}`,
      refType: 'manual',
      adjustment: 'floatCorrection',
    },
  };
}

/* ---------------- The one drawer-write merge ---------------- */

// Appends to a day's movement lists. Kept SEPARATE from `patch` on purpose:
// an append must be applied to whatever the stored record currently holds, not
// to a locally-copied array. See mergeDrawerRecord below for why that
// distinction is the whole point of this shape.
export interface DrawerAppends {
  cashIn?: CashDrawerEntry[];
  cashOut?: CashDrawerEntry[];
  withdrawals?: CashDrawerEntry[];
}

export interface DrawerMergeInput {
  date: string;
  /** The record as it exists RIGHT NOW on the server (undefined = no record yet). */
  existing: CashReconciliation | undefined;
  /** Fields to set outright (float, count, note, open/reconcile stamps). */
  patch?: Partial<CashReconciliation>;
  /** Entries to ADD to the existing lists — never a replacement array. */
  appends?: DrawerAppends;
  /** That day's cash sales, recomputed by the caller from the sales data. */
  cashSales: number;
  /** Seed float for a day with no record yet (the previous till carried over). */
  carry: DrawerCarryOver | null;
  actor: { id: string; email: string };
  now?: number;
}

/**
 * Build the record to write for one drawer change — the SINGLE merge rule,
 * pure so every branch is testable without Firestore.
 *
 * WHY THIS EXISTS AS A PURE FUNCTION. The drawer used to be written as a
 * whole document built from React state and `setDoc`-ed with no merge. Two
 * terminals (the POS tablet and the back-office desktop), or one of them
 * flushing a write queued while offline, could each write a full document
 * built from a snapshot taken before the other's change — and the later write
 * won wholesale. Whatever the other had done was gone: cash entries, the
 * count, and — the reported symptom — `openedAt`, which made the drawer read
 * as closed out of nowhere. Running this inside a Firestore transaction
 * against the freshly-read `existing` is what makes the write a merge instead
 * of a replacement.
 *
 * `appends` exists for the same reason. Appending by sending
 * `[...localCopy, entry]` re-asserts the whole list from a snapshot and drops
 * anything another terminal added in between; appending to `existing` inside
 * the transaction cannot.
 *
 * expected/variance are always recomputed here from the shared math, so the
 * stored figures can never disagree with what the screens compute.
 */
export function mergeDrawerRecord(input: DrawerMergeInput): CashReconciliation {
  const { date, existing, patch, appends, cashSales, carry, actor } = input;
  const now = input.now ?? Date.now();

  const merged: CashReconciliation = {
    // Seed a brand-new day's record with whatever the till was left holding
    // rather than 0 — without this the day's first write (a cash-out, a
    // close) would silently reset the opening float to zero and report the
    // whole carried till as a shortage. Only ever applied when the day has NO
    // record yet; once it does, its own stored float is the truth.
    id: date, date, openingFloat: carry?.float || 0, expectedCash: 0, variance: 0,
    recordedBy: actor.id, recordedByEmail: actor.email, recordedAt: now,
    ...existing, ...patch,
  };

  // Appends land on the SERVER's arrays, and skip ids already present so a
  // transaction retry (Firestore re-runs the whole function on contention)
  // can't double-post the same entry.
  const append = (key: 'cashIn' | 'cashOut' | 'withdrawals') => {
    const add = appends?.[key];
    if (!add?.length) return;
    const base = existing?.[key] || [];
    const seen = new Set(base.map(e => e.id));
    merged[key] = [...base, ...add.filter(e => !seen.has(e.id))];
  };
  append('cashIn'); append('cashOut'); append('withdrawals');

  // A drawer carried forward from a day nobody closed is still open — stamp
  // that on the new day's record so it reads as open rather than as "never
  // opened today".
  if (!existing && !merged.openedAt && carry?.stillOpen) {
    merged.openedAt = now;
    merged.openedBy = actor.id;
    merged.openedByEmail = actor.email;
  }

  merged.cashSales = cashSales;
  merged.expectedCash = expectedEndingCash({
    openingFloat: merged.openingFloat, cashSales,
    cashIn: sumDrawerEntries(merged.cashIn), cashOut: sumDrawerEntries(merged.cashOut), withdrawals: sumTillWithdrawals(merged.withdrawals),
  });
  merged.variance = merged.countedCash != null ? round2(merged.countedCash - merged.expectedCash) : 0;
  merged.recordedBy = actor.id; merged.recordedByEmail = actor.email; merged.recordedAt = now;
  return merged;
}

/* ---------------- The offline fallback write ---------------- */

// Firestore TRANSACTIONS REQUIRE A SERVER. Unlike setDoc, they are not queued
// by the persistent offline cache — a transaction started with no connection
// rejects instead of waiting. So moving drawer writes into a transaction (the
// fix for the lost update) quietly broke the offline case: a cash-in, a
// cash-out, a refund, an expense, a settlement, an open or a close done while
// the wifi drops at the counter was thrown away, while the UI still said
// "Drawer closed".
//
// The fallback is a FIELD MERGE (`setDoc(..., { merge: true })`), which the
// offline cache does queue — and which, crucially, cannot cause the lost
// update the transaction was introduced to prevent, because it only ever
// touches the fields it names. Cash entries go on with arrayUnion, so two
// terminals appending while both offline both survive the reconnect.

export interface DrawerMergeWrite {
  /** Fields to set outright, merged onto whatever the document holds. */
  set: Record<string, unknown>;
  /** Field names to REMOVE (Firestore deleteField()) — e.g. reopening a day. */
  clear: string[];
  /** Entries to append with arrayUnion, never a whole replacement array. */
  union: { cashIn?: CashDrawerEntry[]; cashOut?: CashDrawerEntry[]; withdrawals?: CashDrawerEntry[] };
}

const MOVEMENT_KEYS = ['cashIn', 'cashOut', 'withdrawals'] as const;

/**
 * The payload for an offline-safe drawer write. Pure, so the three rules that
 * matter can be tested without Firestore:
 *
 *  1. APPENDS BECOME arrayUnion. Entries already carry unique ids, so a union
 *     is exactly right: it adds without re-asserting the list, it is
 *     idempotent if the queued write replays, and two terminals that each
 *     appended while offline both keep their entry. Sending
 *     `[...localCopy, entry]` instead would drop the other's — the same lost
 *     update, one level down.
 *
 *  2. UNDEFINED BECOMES deleteField. A field merge ignores a missing key, so
 *     "clear this" has to be said explicitly. openDrawerPatch reopens a day by
 *     setting reconciledAt/countedCash to undefined; without the delete those
 *     would silently persist and the day would stay closed.
 *
 *  3. expectedCash AND variance ARE NEVER WRITTEN HERE. This write cannot see
 *     the merged result, so any total it computed would be a guess. They are
 *     left alone and derived on read (recomputedExpectedCash), and the next
 *     online transaction rewrites the stored figures for good.
 *
 * A caller that genuinely REPLACES a movement list (the Reports cash tab,
 * where the user is editing the entries themselves) passes it in `patch` and
 * it is set as a whole array — that is a deliberate replacement, not an
 * append, and it is the one case where the last writer legitimately wins.
 */
export function buildDrawerMergeWrite(input: {
  date: string;
  patch?: Partial<CashReconciliation>;
  appends?: DrawerAppends;
  actor: { id: string; email: string };
  now?: number;
}): DrawerMergeWrite {
  const { date, patch, appends, actor } = input;
  const now = input.now ?? Date.now();

  const set: Record<string, unknown> = {
    id: date, date,
    recordedBy: actor.id, recordedByEmail: actor.email, recordedAt: now,
  };
  const clear: string[] = [];
  const union: DrawerMergeWrite['union'] = {};

  for (const [key, value] of Object.entries(patch || {})) {
    // Never let a stale local total overwrite the stored one — rule 3.
    if (key === 'expectedCash' || key === 'variance' || key === 'cashSales') continue;
    if (value === undefined) clear.push(key);
    else set[key] = value;
  }

  for (const key of MOVEMENT_KEYS) {
    const add = appends?.[key];
    if (!add?.length) continue;
    // An append and a whole-array replacement of the same list in one write
    // would contradict each other; the explicit replacement wins and the
    // append is folded into it by the caller's own array.
    if (set[key] !== undefined) continue;
    union[key] = add;
  }

  return { set, clear, union };
}

// What a drawer write did to the two fields that decide whether the day reads
// as open or closed. Every write reports this so the change can be audited and
// a "random" close can be traced to a person, a terminal and a code path.
export interface DrawerStateChange {
  openedSet: boolean;
  openedCleared: boolean;
  reconciledSet: boolean;
  reconciledCleared: boolean;
  /** True for the specific case worth shouting about: openedAt disappearing. */
  losesOpenedAt: boolean;
}

export function drawerStateChange(
  before: CashReconciliation | undefined,
  after: CashReconciliation,
): DrawerStateChange {
  const hadOpen = !!before?.openedAt, hasOpen = !!after.openedAt;
  const hadRecon = !!before?.reconciledAt, hasRecon = !!after.reconciledAt;
  return {
    openedSet: !hadOpen && hasOpen,
    openedCleared: hadOpen && !hasOpen,
    reconciledSet: !hadRecon && hasRecon,
    reconciledCleared: hadRecon && !hasRecon,
    losesOpenedAt: hadOpen && !hasOpen,
  };
}

/** True when this write changes the day's open/closed state at all. */
export const changesDrawerState = (c: DrawerStateChange): boolean =>
  c.openedSet || c.openedCleared || c.reconciledSet || c.reconciledCleared;

// --- Part 2: sales-tax remittance -----------------------------------------

export type TaxGrouping = 'month' | 'quarter';

export interface TaxPeriodRow {
  key: string;            // sortable, e.g. '2026-03' or '2026-Q1'
  label: string;          // human, e.g. 'March 2026' or 'Q1 2026'
  taxableSales: number;   // Σ subtotal (the base tax was charged on)
  taxCollected: number;   // Σ tax
  salesCount: number;
}

export interface TaxReport {
  start: string;
  end: string;
  grouping: TaxGrouping;
  /** The range reached back before the books start date and was pulled forward. */
  clampedToBooksStart: boolean;
  rows: TaxPeriodRow[];
  totalTaxableSales: number;
  totalTaxCollected: number;
  totalSalesCount: number;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// The period a YYYY-MM-DD date falls in, for the chosen grouping.
const periodOf = (dateISO: string, grouping: TaxGrouping): { key: string; label: string } => {
  const year = dateISO.slice(0, 4);
  const month = parseInt(dateISO.slice(5, 7), 10) || 1; // 1..12
  if (grouping === 'quarter') {
    const q = Math.ceil(month / 3);
    return { key: `${year}-Q${q}`, label: `Q${q} ${year}` };
  }
  return { key: `${year}-${dateISO.slice(5, 7)}`, label: `${MONTHS[month - 1]} ${year}` };
};

/**
 * Sales tax collected over an inclusive [start, end] date range, grouped by
 * month or quarter for filing. Only recognized sales count — reversed
 * (voided/returned) and not-yet-settled layaways are excluded, mirroring how
 * domain/analytics.ts recognizes revenue.
 */
export const taxRemittance = (
  transactions: SalesTransaction[],
  start: string,
  end: string,
  grouping: TaxGrouping = 'month',
  booksStartDate?: string,
): TaxReport => {
  const requested = start <= end ? start : end;
  const clampedToBooksStart = booksStartClamps(requested, booksStartDate);
  const lo = clampToBooksStart(requested, booksStartDate);
  const hi = start <= end ? end : start;
  const byKey = new Map<string, TaxPeriodRow>();
  let totalTaxableSales = 0, totalTaxCollected = 0, totalSalesCount = 0;

  for (const t of transactions) {
    if (!t.date || t.date < lo || t.date > hi) continue;
    if (isReversed(t) || (t.balanceOwing || 0) > 0) continue; // not recognized
    const { key, label } = periodOf(t.date, grouping);
    const row = byKey.get(key) || { key, label, taxableSales: 0, taxCollected: 0, salesCount: 0 };
    row.taxableSales = round2(row.taxableSales + (t.subtotal || 0));
    row.taxCollected = round2(row.taxCollected + (t.tax || 0));
    row.salesCount += 1;
    byKey.set(key, row);
    totalTaxableSales = round2(totalTaxableSales + (t.subtotal || 0));
    totalTaxCollected = round2(totalTaxCollected + (t.tax || 0));
    totalSalesCount += 1;
  }

  const rows = [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  return { start: lo, end: hi, grouping, clampedToBooksStart, rows, totalTaxableSales, totalTaxCollected, totalSalesCount };
};

/** Flatten a tax report to CSV rows (period breakdown + a Total row) for export. */
export const taxReportCsvRows = (report: TaxReport): Record<string, string | number>[] => {
  // Same rule as the year-end export: if the range was pulled forward to the
  // books start, the file says so on its own first line.
  const rows: Record<string, string | number>[] = report.clampedToBooksStart
    ? [{ Period: `Figures start ${report.start} (books start date)`, 'Taxable Sales': '', 'Tax Collected': '', Sales: '' }]
    : [];
  rows.push(...report.rows.map(r => ({
    Period: r.label,
    'Taxable Sales': r.taxableSales.toFixed(2),
    'Tax Collected': r.taxCollected.toFixed(2),
    Sales: r.salesCount,
  })));
  rows.push({
    Period: 'Total',
    'Taxable Sales': report.totalTaxableSales.toFixed(2),
    'Tax Collected': report.totalTaxCollected.toFixed(2),
    Sales: report.totalSalesCount,
  });
  return rows;
};

// A sale counts toward revenue/COGS only when it's recognized — not reversed
// (voided/returned) and not a layaway with a balance still owing. Mirrors the
// txns filter in domain/analytics.ts so the P&L reconciles with Owner Analytics.
// Exported so components/Dashboard.tsx and domain/customers.ts can apply the
// exact same recognition rule instead of each re-deriving it (Dashboard's own
// revenue tiles didn't, which was the layaway-misreporting bug).
export const isRecognizedSale = (t: SalesTransaction): boolean => !isReversed(t) && !((t.balanceOwing || 0) > 0);
const inDateRange = (dateISO: string | undefined, lo: string, hi: string): boolean => !!dateISO && dateISO >= lo && dateISO <= hi;
const order = (start: string, end: string): [string, string] => (start <= end ? [start, end] : [end, start]);

// --- Part 3: device buyer settlement history ------------------------------------
// Settlement records already carry the money facts. Under the corrected
// financing model (types.ts / domain/dropoffs.ts) the store FINANCES the
// device buyer: at settlement he repays the principal the store advanced and
// pays the store's service fee. Money flows INTO the store.
//
// Principal and fee are aggregated as SEPARATE totals and never summed into
// one opaque figure — only the fee is income (see profitAndLoss); the
// principal is a receivable being settled.
//
// PRE-REWORK records (no `model`) are read exactly as they were stored — their
// legacy totalPurchaseFronted/amountPaid — and flagged `legacy` so the UI can
// say so. Nothing about them is recomputed or migrated.

export interface DeviceBuyerSettlementRow {
  buyerId: string;
  buyerName: string;
  settlementCount: number;
  totalFees: number;      // Σ service fees the store charged
  totalPrincipal: number; // Σ principal repaid (legacy records: the amount they recorded as fronted)
  totalAmount: number;    // Σ settlement totals (new: owed by the buyer; legacy: paid out to him)
  legacyCount: number;    // how many of those settlements predate the financing rework
}

export interface SettlementLine {
  id: string;
  date: string;
  buyerId: string;
  buyerName: string;
  totalFees: number;
  totalPrincipal: number;
  totalAmount: number;
  legacy: boolean;        // true = recorded under the prior model, shown as stored
}

export interface SettlementHistory {
  start: string;
  end: string;
  perBuyer: DeviceBuyerSettlementRow[];
  lines: SettlementLine[];   // individual settlements in range, newest first
  totalFees: number;
  totalPrincipal: number;
  totalAmount: number;
  count: number;
  legacyCount: number;
}

export const settlementHistory = (
  settlements: Settlement[],
  deviceBuyers: DeviceBuyer[],
  start: string,
  end: string,
  booksStartDate?: string,
): SettlementHistory => {
  const [lo, hi] = order(clampToBooksStart(start, booksStartDate), end);
  const nameOf = new Map(deviceBuyers.map(r => [r.id, r.name]));
  const inRangeSettlements = settlements.filter(s => inDateRange(s.date, lo, hi));

  const byBuyer = new Map<string, DeviceBuyerSettlementRow>();
  let totalFees = 0, totalPrincipal = 0, totalAmount = 0, legacyCount = 0;
  const lines: SettlementLine[] = [];

  for (const s of inRangeSettlements) {
    const buyerName = nameOf.get(s.buyerId) || 'Unknown device buyer';
    const legacy = isLegacySettlement(s);
    const fees = s.totalFees || 0;
    // New records: principal the buyer repaid + what he owed in total.
    // Legacy records: the figures exactly as they were stored back then.
    const principal = legacy ? (s.totalPurchaseFronted || 0) : (s.principalOwed || 0);
    const amount = legacy ? (s.amountPaid || 0) : (s.amountOwed || 0);
    lines.push({ id: s.id, date: s.date, buyerId: s.buyerId, buyerName, totalFees: fees, totalPrincipal: principal, totalAmount: amount, legacy });
    const row = byBuyer.get(s.buyerId) || { buyerId: s.buyerId, buyerName, settlementCount: 0, totalFees: 0, totalPrincipal: 0, totalAmount: 0, legacyCount: 0 };
    row.settlementCount += 1;
    if (legacy) row.legacyCount += 1;
    row.totalFees = round2(row.totalFees + fees);
    row.totalPrincipal = round2(row.totalPrincipal + principal);
    row.totalAmount = round2(row.totalAmount + amount);
    byBuyer.set(s.buyerId, row);
    totalFees = round2(totalFees + fees);
    totalPrincipal = round2(totalPrincipal + principal);
    totalAmount = round2(totalAmount + amount);
    if (legacy) legacyCount += 1;
  }

  return {
    start: lo, end: hi,
    perBuyer: [...byBuyer.values()].sort((a, b) => b.totalAmount - a.totalAmount),
    lines: lines.sort((a, b) => b.date.localeCompare(a.date)),
    totalFees, totalPrincipal, totalAmount, count: lines.length, legacyCount,
  };
};

// --- Part 1: Profit & Loss statement --------------------------------------

export interface ProfitLossInput {
  transactions: SalesTransaction[];
  inventory: InventoryItem[];
  payPeriods: PayPeriodPaid[];       // paid pay-period snapshots (gross pay)
  cashReconciliations: CashReconciliation[];
  settlements: Settlement[];
  // The general expense ledger (domain/expenses.ts) — every business expense
  // regardless of payment method. This REPLACES the old cashReconciliations-
  // only cashExpenses figure: a cash-paid expense entered through the ledger
  // also appends a matching cashOut entry to that day's drawer (App.tsx's
  // handleSaveExpense), so cashReconciliations.cashOut is no longer summed
  // independently here — doing so would double-count it. See the PR
  // description for the full double-counting analysis (cash expenses,
  // payroll, device buyer fees).
  expenses: Expense[];
  expenseCategories: ExpenseCategory[];
  // Staff bonuses (domain/bonuses.ts). Kept SEPARATE from payPeriods because
  // pay-period gross is strictly hours × rate — and separate from `expenses`
  // because the Wages category is excludeFromPL, so a bonus logged there
  // never reduced net profit at all. This is the record that closes that hole.
  bonuses?: StaffBonus[];
  // The shop's books start date (settings.operations.booksStartDate). Every
  // figure below starts here instead of at `start` when it is set, so the
  // partial pre-system history cannot distort a total. Unset = no clamp.
  booksStartDate?: string;
}

export interface ProfitLoss {
  start: string;
  end: string;
  revenue: number;
  costOfGoods: number;       // device purchaseCost + repairCost of goods sold
  grossProfit: number;       // revenue − costOfGoods
  payroll: number;           // gross pay of pay periods paid in range — hours × rate only, unchanged
  // One-off staff bonuses paid in range, dated by the day they were paid.
  // Its own line, never folded into `payroll` (which is the hourly figure the
  // accountant reconciles against timesheets) and never into `expenses`
  // (whose Wages category is excluded from the P&L by design).
  bonuses: number;
  expenses: number;          // expense ledger total in range, any payment method, excl. Wages-flagged categories
  expensesByCategory: CategoryTotal[];
  // The store's drop-off service fees — ALWAYS income. The store finances the
  // device buyer and charges a fee for it; it never pays him a commission, so
  // there is no direction or conditionality here any more. The principal the
  // buyer repays is deliberately absent: it is a receivable being settled, not
  // revenue, and counting it would overstate profit by the whole device price.
  deviceBuyerFeeIncome: number;
  // The two SELLING costs of an online sale, each on its own line and
  // deliberately NOT merged with the other:
  //
  //  • platformFees — the marketplace's commission (eBay, Best Buy, …).
  //  • shipping     — postage/packaging to get the box to the buyer.
  //
  // They are different costs with different drivers (one is a % of price,
  // one is a flat per-parcel amount), so rolling shipping into the fee is
  // exactly the distortion this reports separately to avoid. Both reduce
  // net profit; neither touches revenue, since neither is a discount.
  //
  // NOTE: online selling costs previously reached NO report at all — the
  // P&L computed gross profit from revenue − cost of goods and stopped.
  // Adding both here means a shop selling on Best Buy finally sees what
  // that channel actually costs.
  platformFees: number;
  shipping: number;
  // grossProfit − payroll − bonuses − expenses − platformFees − shipping + deviceBuyerFeeIncome
  netProfit: number;
  // True when the requested range reached back before the books start date
  // and was pulled forward. `start` above is the date actually used, so the
  // report can say so rather than quietly returning a smaller number.
  clampedToBooksStart: boolean;
}

export const profitAndLoss = (input: ProfitLossInput, start: string, end: string): ProfitLoss => {
  // Everything downstream reads `lo`, so clamping once here covers revenue,
  // cost of goods, payroll, bonuses, expenses, selling costs and device-buyer
  // fee income in one place — no per-figure clamp to forget.
  const clampedToBooksStart = booksStartClamps(order(start, end)[0], input.booksStartDate);
  const [lo, hi] = order(clampToBooksStart(start, input.booksStartDate), end);
  const { transactions, inventory, payPeriods, settlements, expenses, expenseCategories } = input;

  // Every inventory id referenced by any transaction line, so a device captured
  // in a POS sale isn't also counted as a standalone sold device (mirrors analytics).
  const txnInvIds = new Set<string>();
  transactions.forEach(t => t.lines?.forEach(l => l.inventoryId && txnInvIds.add(l.inventoryId)));

  let revenue = 0, costOfGoods = 0, platformFees = 0, shipping = 0;
  for (const t of transactions) {
    if (!inDateRange(t.date, lo, hi) || !isRecognizedSale(t)) continue;
    revenue = round2(revenue + (t.subtotal || 0));
    costOfGoods = round2(costOfGoods + (t.purchaseCost || 0) + (t.repairCost || 0));
    // Selling costs, kept OUT of cost of goods (they're not what the
    // stock cost) and out of revenue (they're not a discount) — each
    // reported on its own line below.
    platformFees = round2(platformFees + (t.platformFee || 0));
    shipping = round2(shipping + (t.shippingCost || 0));
  }
  // Standalone sold devices not tied to a transaction. Voided/returned devices
  // have their soldDate cleared, so they're naturally excluded.
  for (const i of inventory) {
    if (kindOf(i) !== 'device' || !i.soldDate || txnInvIds.has(i.id)) continue;
    if (!inDateRange(i.soldDate, lo, hi)) continue;
    revenue = round2(revenue + (i.salePrice || 0));
    costOfGoods = round2(costOfGoods + (i.purchaseCost || 0) + (i.repairCost || 0));
    platformFees = round2(platformFees + (i.platformFees || 0));
    shipping = round2(shipping + (i.shippingCost || 0));
  }

  const payroll = round2(payPeriods
    .filter(p => inDateRange(p.periodStart, lo, hi))
    .reduce((s, p) => s + (p.gross || 0), 0));
  // Dated by when the bonus was PAID, not by the period it may be attached
  // to: a July bonus handed over in August is an August cost.
  const bonuses = bonusTotal(input.bonuses || [], lo, hi);

  const expensesTotal = plExpenseTotal(expenses, expenseCategories, lo, hi);
  const expensesByCategory = expenseTotalsByCategory(expenses, expenseCategories, lo, hi);

  // Settlement service fees are store INCOME, full stop — the store is always
  // the financier collecting a fee, never the party paying one. Only the fee
  // is counted: the principal repayment on the same settlement is a
  // receivable being settled and never touches revenue or profit.
  // settlementFeeIncome (domain/dropoffs.ts) is the SHARED derivation — the
  // analytics path (Dashboard tiles / Close Out / Daily History) calls the
  // same function, so the two can't drift on what counts as fee income.
  const deviceBuyerFeeIncome = round2(settlementFeeIncome(
    settlements.filter(s => inDateRange(s.date, lo, hi)),
  ));

  const grossProfit = round2(revenue - costOfGoods);
  const netProfit = round2(grossProfit - payroll - bonuses - expensesTotal - platformFees - shipping + deviceBuyerFeeIncome);
  return {
    start: lo, end: hi, revenue, costOfGoods, grossProfit, payroll, bonuses,
    expenses: expensesTotal, expensesByCategory,
    deviceBuyerFeeIncome,
    platformFees, shipping,
    netProfit, clampedToBooksStart,
  };
};

/** Flatten a P&L to labelled CSV rows — one row per expense category between
 * gross profit and net profit, so the accountant export shows the same
 * gross profit → expenses → net profit walk the report screen does.
 *
 * `withCategories: false` collapses those rows into one "Expenses" line for a
 * viewer without expenses.viewAll (a manager). The NUMBERS are identical
 * either way — net profit still subtracts every workspace expense; only the
 * per-category breakdown is withheld. */
export const profitLossCsvRows = (pl: ProfitLoss, withCategories = true): Record<string, string | number>[] => [
  { Line: 'Revenue', Amount: pl.revenue.toFixed(2) },
  { Line: 'Cost of goods sold', Amount: (-pl.costOfGoods).toFixed(2) },
  { Line: 'Gross profit', Amount: pl.grossProfit.toFixed(2) },
  { Line: 'Payroll', Amount: (-pl.payroll).toFixed(2) },
  { Line: 'Staff bonuses', Amount: (-pl.bonuses).toFixed(2) },
  ...(withCategories
    ? pl.expensesByCategory.map(c => ({
        Line: `Expense: ${c.label}${c.excludedFromPL ? ' (informational — not in net profit)' : ''}`,
        Amount: (-c.total).toFixed(2),
      }))
    : [{ Line: 'Expenses', Amount: (-pl.expenses).toFixed(2) }]),
  { Line: 'Platform fees', Amount: (-pl.platformFees).toFixed(2) },
  { Line: 'Shipping', Amount: (-pl.shipping).toFixed(2) },
  { Line: 'Device buyer service fees (income)', Amount: pl.deviceBuyerFeeIncome.toFixed(2) },
  { Line: 'Net profit', Amount: pl.netProfit.toFixed(2) },
];

// --- Part 2: year-end accountant export -----------------------------------

export interface YearEndSummary {
  year: number;
  revenue: number;
  costOfGoods: number;
  grossProfit: number;
  payrollPaid: number;
  bonuses: number;          // staff bonuses paid in the year — its own line, see ProfitLoss
  expenses: number;
  expensesByCategory: CategoryTotal[];
  // Store service fees on drop-off settlements — always income, see ProfitLoss.
  deviceBuyerFeeIncome: number;
  // Online-selling costs, separately — see ProfitLoss for why they are two
  // lines and not one.
  platformFees: number;
  shipping: number;
  netProfit: number;
  salesTaxCollected: number;
  /** The year reached back before the books start date — figures start there. */
  clampedToBooksStart: boolean;
  /** The first day actually included (the books start, when clamped). */
  figuresStart: string;
}

/** One consolidated annual summary for handing to an accountant. */
export const yearEndSummary = (input: ProfitLossInput, year: number): YearEndSummary => {
  const start = `${year}-01-01`, end = `${year}-12-31`;
  // Both halves of the export clamp identically, so the accountant's P&L and
  // their tax figures cover exactly the same days.
  const pl = profitAndLoss(input, start, end);
  const tax = taxRemittance(input.transactions, start, end, 'month', input.booksStartDate);
  return {
    year,
    revenue: pl.revenue,
    costOfGoods: pl.costOfGoods,
    grossProfit: pl.grossProfit,
    payrollPaid: pl.payroll,
    bonuses: pl.bonuses,
    expenses: pl.expenses,
    expensesByCategory: pl.expensesByCategory,
    deviceBuyerFeeIncome: pl.deviceBuyerFeeIncome,
    platformFees: pl.platformFees,
    shipping: pl.shipping,
    clampedToBooksStart: pl.clampedToBooksStart,
    figuresStart: pl.start,
    netProfit: pl.netProfit,
    salesTaxCollected: tax.totalTaxCollected,
  };
};

/** Flatten the year-end summary to labelled CSV rows for the accountant export. */
export const yearEndCsvRows = (s: YearEndSummary, withCategories = true): Record<string, string | number>[] => [
  { Metric: `Year`, Value: String(s.year) },
  // Stated in the file itself, not just on screen: an accountant reading the
  // CSV must not take a clamped year for a full one.
  ...(s.clampedToBooksStart ? [{ Metric: 'Figures start', Value: `${s.figuresStart} (books start date)` }] : []),
  { Metric: 'Revenue', Value: s.revenue.toFixed(2) },
  { Metric: 'Cost of goods sold', Value: s.costOfGoods.toFixed(2) },
  { Metric: 'Gross profit', Value: s.grossProfit.toFixed(2) },
  { Metric: 'Payroll paid', Value: s.payrollPaid.toFixed(2) },
  { Metric: 'Staff bonuses paid', Value: s.bonuses.toFixed(2) },
  ...(withCategories
    ? s.expensesByCategory.map(c => ({ Metric: `Expense: ${c.label}${c.excludedFromPL ? ' (informational)' : ''}`, Value: c.total.toFixed(2) }))
    : [{ Metric: 'Expenses', Value: s.expenses.toFixed(2) }]),
  { Metric: 'Platform fees', Value: (-s.platformFees).toFixed(2) },
  { Metric: 'Shipping', Value: (-s.shipping).toFixed(2) },
  { Metric: 'Device buyer service fees (income)', Value: s.deviceBuyerFeeIncome.toFixed(2) },
  { Metric: 'Net profit', Value: s.netProfit.toFixed(2) },
  { Metric: 'Sales tax collected', Value: s.salesTaxCollected.toFixed(2) },
];
