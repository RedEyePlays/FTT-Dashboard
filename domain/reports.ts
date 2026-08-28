import { SalesTransaction, InventoryItem, PayPeriodPaid, CashReconciliation, CashDrawerEntry, Settlement, DeviceBuyer, Expense } from '../types';
import { settlementFeeTotals } from './dropoffs';
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
const collectedOnTx = (t: SalesTransaction): number => {
  if (isReversed(t)) return 0;
  return t.deposit !== undefined ? (t.deposit || 0) : (t.totalPaid || 0);
};

// --- Part 1: daily cash reconciliation ------------------------------------

/**
 * The cash portion collected on one transaction (for the till count):
 *  • cash sales → the whole collected amount,
 *  • mixed sales → their recorded cash portion,
 *  • card sales → nothing.
 * Reversed (voided/returned) sales contribute nothing.
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

export const cashDrawerSummary = (recon: CashReconciliation | undefined, cashSales: number): CashDrawerSummary => {
  const openingFloat = round2(recon?.openingFloat || 0);
  const cashIn = sumDrawerEntries(recon?.cashIn);
  const cashOut = sumDrawerEntries(recon?.cashOut);
  const withdrawals = sumDrawerEntries(recon?.withdrawals);
  return {
    opened: !!recon?.openedAt,
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
// Settlement records already carry the money facts: totalFees (the drop-off fee
// — which may be owed BY the device buyer TO the store, or paid BY the store TO
// the buyer, depending on the settlement's feeDirection; see
// domain/dropoffs.ts's settlementFeeDirection), totalPurchaseFronted
// (reimbursement of what the device buyer paid sellers — that becomes device
// purchaseCost/COGS), and amountPaid (net cash moved). Pure aggregation over
// the existing records; no new tracking.
//
// The aggregates below are a plain sum of the fees on each settlement in range,
// regardless of direction — a "how much fee money changed hands" view. The
// income-vs-expense split that net profit depends on lives in
// settlementFeeTotals / profitAndLoss, NOT here.

export interface DeviceBuyerSettlementRow {
  buyerId: string;
  buyerName: string;
  settlementCount: number;
  totalFees: number;        // Σ drop-off fees (either direction — see header)
  totalFronted: number;     // Σ seller-purchase reimbursement
  totalPaid: number;        // Σ net cash moved (negative = the buyer owed the store)
}

export interface SettlementLine {
  id: string;
  date: string;
  buyerId: string;
  buyerName: string;
  totalFees: number;
  totalFronted: number;
  amountPaid: number;
}

export interface SettlementHistory {
  start: string;
  end: string;
  perBuyer: DeviceBuyerSettlementRow[];
  lines: SettlementLine[];   // individual settlements in range, newest first
  totalFees: number;
  totalFronted: number;
  totalPaid: number;
  count: number;
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
  let totalFees = 0, totalFronted = 0, totalPaid = 0;
  const lines: SettlementLine[] = [];

  for (const s of inRangeSettlements) {
    const buyerName = nameOf.get(s.buyerId) || 'Unknown device buyer';
    const fees = s.totalFees || 0, fronted = s.totalPurchaseFronted || 0, paid = s.amountPaid || 0;
    lines.push({ id: s.id, date: s.date, buyerId: s.buyerId, buyerName, totalFees: fees, totalFronted: fronted, amountPaid: paid });
    const row = byBuyer.get(s.buyerId) || { buyerId: s.buyerId, buyerName, settlementCount: 0, totalFees: 0, totalFronted: 0, totalPaid: 0 };
    row.settlementCount += 1;
    row.totalFees = round2(row.totalFees + fees);
    row.totalFronted = round2(row.totalFronted + fronted);
    row.totalPaid = round2(row.totalPaid + paid);
    byBuyer.set(s.buyerId, row);
    totalFees = round2(totalFees + fees); totalFronted = round2(totalFronted + fronted); totalPaid = round2(totalPaid + paid);
  }

  return {
    start: lo, end: hi,
    perBuyer: [...byBuyer.values()].sort((a, b) => b.totalPaid - a.totalPaid),
    lines: lines.sort((a, b) => b.date.localeCompare(a.date)),
    totalFees, totalFronted, totalPaid, count: lines.length,
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
  // Drop-off fees split by direction (see domain/dropoffs.ts's
  // settlementFeeDirection). These are NOT a single signed "commissions"
  // figure: in this shop the fee often flows TO the store, and both
  // arrangements coexist across buyers/settlements.
  deviceBuyerFeesCollected: number; // fees the buyer owed the store — INCOME
  deviceBuyerFeesPaid: number;      // fees the store paid the buyer — EXPENSE
  // grossProfit − payroll − expenses + deviceBuyerFeesCollected − deviceBuyerFeesPaid
  netProfit: number;
}

export const profitAndLoss = (input: ProfitLossInput, start: string, end: string): ProfitLoss => {
  const [lo, hi] = order(start, end);
  const { transactions, inventory, payPeriods, settlements, expenses, expenseCategories } = input;

  // Every inventory id referenced by any transaction line, so a device captured
  // in a POS sale isn't also counted as a standalone sold device (mirrors analytics).
  const txnInvIds = new Set<string>();
  transactions.forEach(t => t.lines?.forEach(l => l.inventoryId && txnInvIds.add(l.inventoryId)));

  let revenue = 0, costOfGoods = 0;
  for (const t of transactions) {
    if (!inDateRange(t.date, lo, hi) || !isRecognizedSale(t)) continue;
    revenue = round2(revenue + (t.subtotal || 0));
    costOfGoods = round2(costOfGoods + (t.purchaseCost || 0) + (t.repairCost || 0));
  }
  // Standalone sold devices not tied to a transaction. Voided/returned devices
  // have their soldDate cleared, so they're naturally excluded.
  for (const i of inventory) {
    if (kindOf(i) !== 'device' || !i.soldDate || txnInvIds.has(i.id)) continue;
    if (!inDateRange(i.soldDate, lo, hi)) continue;
    revenue = round2(revenue + (i.salePrice || 0));
    costOfGoods = round2(costOfGoods + (i.purchaseCost || 0) + (i.repairCost || 0));
  }

  const payroll = round2(payPeriods
    .filter(p => inDateRange(p.periodStart, lo, hi))
    .reduce((s, p) => s + (p.gross || 0), 0));

  const expensesTotal = plExpenseTotal(expenses, expenseCategories, lo, hi);
  const expensesByCategory = expenseTotalsByCategory(expenses, expenseCategories, lo, hi);

  // Drop-off fees are direction-aware: a fee the device buyer owes the STORE is
  // income and RAISES net profit; a fee the store pays the buyer is an expense
  // and lowers it. This previously subtracted every fee unconditionally, which
  // understated profit by 2× the fee on every buyer-owes-store settlement.
  const feeTotals = settlementFeeTotals(settlements.filter(s => inDateRange(s.date, lo, hi)));

  const grossProfit = round2(revenue - costOfGoods);
  const netProfit = round2(grossProfit - payroll - expensesTotal + feeTotals.netContribution);
  return {
    start: lo, end: hi, revenue, costOfGoods, grossProfit, payroll,
    expenses: expensesTotal, expensesByCategory,
    deviceBuyerFeesCollected: feeTotals.feesCollected,
    deviceBuyerFeesPaid: feeTotals.feesPaid,
    netProfit,
  };
};

/** Flatten a P&L to labelled CSV rows — one row per expense category between
 * gross profit and net profit, so the accountant export shows the same
 * gross profit → expenses → net profit walk the report screen does. */
export const profitLossCsvRows = (pl: ProfitLoss): Record<string, string | number>[] => [
  { Line: 'Revenue', Amount: pl.revenue.toFixed(2) },
  { Line: 'Cost of goods sold', Amount: (-pl.costOfGoods).toFixed(2) },
  { Line: 'Gross profit', Amount: pl.grossProfit.toFixed(2) },
  { Line: 'Payroll', Amount: (-pl.payroll).toFixed(2) },
  ...pl.expensesByCategory.map(c => ({
    Line: `Expense: ${c.label}${c.excludedFromPL ? ' (informational — not in net profit)' : ''}`,
    Amount: (-c.total).toFixed(2),
  })),
  { Line: 'Device buyer fees collected', Amount: pl.deviceBuyerFeesCollected.toFixed(2) },
  { Line: 'Device buyer fees paid', Amount: (-pl.deviceBuyerFeesPaid).toFixed(2) },
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
  // Same direction-aware split as ProfitLoss — see its doc comment.
  deviceBuyerFeesCollected: number;
  deviceBuyerFeesPaid: number;
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
    deviceBuyerFeesCollected: pl.deviceBuyerFeesCollected,
    deviceBuyerFeesPaid: pl.deviceBuyerFeesPaid,
    netProfit: pl.netProfit,
    salesTaxCollected: tax.totalTaxCollected,
  };
};

/** Flatten the year-end summary to labelled CSV rows for the accountant export. */
export const yearEndCsvRows = (s: YearEndSummary): Record<string, string | number>[] => [
  { Metric: `Year`, Value: String(s.year) },
  { Metric: 'Revenue', Value: s.revenue.toFixed(2) },
  { Metric: 'Cost of goods sold', Value: s.costOfGoods.toFixed(2) },
  { Metric: 'Gross profit', Value: s.grossProfit.toFixed(2) },
  { Metric: 'Payroll paid', Value: s.payrollPaid.toFixed(2) },
  ...s.expensesByCategory.map(c => ({ Metric: `Expense: ${c.label}${c.excludedFromPL ? ' (informational)' : ''}`, Value: c.total.toFixed(2) })),
  { Metric: 'Device buyer fees collected', Value: s.deviceBuyerFeesCollected.toFixed(2) },
  { Metric: 'Device buyer fees paid', Value: s.deviceBuyerFeesPaid.toFixed(2) },
  { Metric: 'Net profit', Value: s.netProfit.toFixed(2) },
  { Metric: 'Sales tax collected', Value: s.salesTaxCollected.toFixed(2) },
];
