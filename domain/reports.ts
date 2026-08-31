import { SalesTransaction, InventoryItem, PayPeriodPaid, CashReconciliation, CashDrawerEntry, Settlement, DeviceBuyer, Expense } from '../types';
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
): CashReconciliation[] =>
  reconciliations
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
  countedCash: number;
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

export const drawerCarryOver = (
  reconciliations: CashReconciliation[],
  todayISO: string,
): DrawerCarryOver | null => {
  const prior = reconciliations
    .filter(r => r.date < todayISO)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  // Only a day that was actually STARTED carries anything: a bare record
  // (written by some other path, never opened, no movement) has no till
  // behind it to carry.
  if (!prior || (!prior.openedAt && !prior.countedCash && !(prior.openingFloat || 0))) return null;
  const float = prior.countedCash != null ? round2(prior.countedCash) : round2(prior.expectedCash || 0);
  return {
    float: Math.max(0, float),
    fromDate: prior.date,
    stillOpen: !!prior.openedAt && !prior.reconciledAt,
  };
};

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
  const withdrawals = sumDrawerEntries(recon?.withdrawals);
  return {
    // Open if opened today, OR carried forward from a day that was opened
    // and never closed — the drawer nobody ever closed is still open.
    opened: !!recon?.openedAt || (!recon?.reconciledAt && !!carry?.stillOpen),
    openingFloat, cashSales: round2(cashSales), cashIn, cashOut, withdrawals,
    expected: expectedEndingCash({ openingFloat, cashSales, cashIn, cashOut, withdrawals }),
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
): Pick<CashReconciliation, 'openingFloat' | 'openedAt' | 'openedBy' | 'openedByEmail' | 'reconciledAt' | 'reconciledBy' | 'reconciledByEmail' | 'countedCash'> {
  return {
    openingFloat: Math.max(0, openingFloat),
    openedAt: existing?.openedAt ?? now,
    openedBy: existing?.openedBy ?? user.id,
    openedByEmail: existing?.openedByEmail ?? user.email,
    reconciledAt: undefined,
    reconciledBy: undefined,
    reconciledByEmail: undefined,
    countedCash: undefined,
  };
}

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
): TaxReport => {
  const [lo, hi] = start <= end ? [start, end] : [end, start];
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
  return { start: lo, end: hi, grouping, rows, totalTaxableSales, totalTaxCollected, totalSalesCount };
};

/** Flatten a tax report to CSV rows (period breakdown + a Total row) for export. */
export const taxReportCsvRows = (report: TaxReport): Record<string, string | number>[] => {
  const rows: Record<string, string | number>[] = report.rows.map(r => ({
    Period: r.label,
    'Taxable Sales': r.taxableSales.toFixed(2),
    'Tax Collected': r.taxCollected.toFixed(2),
    Sales: r.salesCount,
  }));
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
): SettlementHistory => {
  const [lo, hi] = order(start, end);
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
}

export interface ProfitLoss {
  start: string;
  end: string;
  revenue: number;
  costOfGoods: number;       // device purchaseCost + repairCost of goods sold
  grossProfit: number;       // revenue − costOfGoods
  payroll: number;           // gross pay of pay periods paid in range
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
  // grossProfit − payroll − expenses − platformFees − shipping + deviceBuyerFeeIncome
  netProfit: number;
}

export const profitAndLoss = (input: ProfitLossInput, start: string, end: string): ProfitLoss => {
  const [lo, hi] = order(start, end);
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
  const netProfit = round2(grossProfit - payroll - expensesTotal - platformFees - shipping + deviceBuyerFeeIncome);
  return {
    start: lo, end: hi, revenue, costOfGoods, grossProfit, payroll,
    expenses: expensesTotal, expensesByCategory,
    deviceBuyerFeeIncome,
    platformFees, shipping,
    netProfit,
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
}

/** One consolidated annual summary for handing to an accountant. */
export const yearEndSummary = (input: ProfitLossInput, year: number): YearEndSummary => {
  const start = `${year}-01-01`, end = `${year}-12-31`;
  const pl = profitAndLoss(input, start, end);
  const tax = taxRemittance(input.transactions, start, end, 'month');
  return {
    year,
    revenue: pl.revenue,
    costOfGoods: pl.costOfGoods,
    grossProfit: pl.grossProfit,
    payrollPaid: pl.payroll,
    expenses: pl.expenses,
    expensesByCategory: pl.expensesByCategory,
    deviceBuyerFeeIncome: pl.deviceBuyerFeeIncome,
    platformFees: pl.platformFees,
    shipping: pl.shipping,
    netProfit: pl.netProfit,
    salesTaxCollected: tax.totalTaxCollected,
  };
};

/** Flatten the year-end summary to labelled CSV rows for the accountant export. */
export const yearEndCsvRows = (s: YearEndSummary, withCategories = true): Record<string, string | number>[] => [
  { Metric: `Year`, Value: String(s.year) },
  { Metric: 'Revenue', Value: s.revenue.toFixed(2) },
  { Metric: 'Cost of goods sold', Value: s.costOfGoods.toFixed(2) },
  { Metric: 'Gross profit', Value: s.grossProfit.toFixed(2) },
  { Metric: 'Payroll paid', Value: s.payrollPaid.toFixed(2) },
  ...(withCategories
    ? s.expensesByCategory.map(c => ({ Metric: `Expense: ${c.label}${c.excludedFromPL ? ' (informational)' : ''}`, Value: c.total.toFixed(2) }))
    : [{ Metric: 'Expenses', Value: s.expenses.toFixed(2) }]),
  { Metric: 'Platform fees', Value: (-s.platformFees).toFixed(2) },
  { Metric: 'Shipping', Value: (-s.shipping).toFixed(2) },
  { Metric: 'Device buyer service fees (income)', Value: s.deviceBuyerFeeIncome.toFixed(2) },
  { Metric: 'Net profit', Value: s.netProfit.toFixed(2) },
  { Metric: 'Sales tax collected', Value: s.salesTaxCollected.toFixed(2) },
];
