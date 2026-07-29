import { SalesTransaction } from '../types';
import { isReversed } from './pos';

// Back-office filing reports — daily cash reconciliation and sales-tax
// remittance — derived purely from salesTransactions. Repairs have no separate
// tax field (only repairPrice/deposit), so all remittable tax comes from sales.
// Pure and testable, like domain/analytics.ts; date handling mirrors it
// (YYYY-MM-DD strings, half-open logic where relevant).

const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// The money actually collected on a sale so far: a layaway only took its
// deposit, everything else took the full total. A reversed sale nets to zero.
const collectedOnTx = (t: SalesTransaction): number => {
  if (isReversed(t)) return 0;
  return (t.balanceOwing || 0) > 0 ? (t.deposit || 0) : (t.totalPaid || 0);
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

export interface CashVariance { expected: number; counted: number; variance: number; direction: 'over' | 'short' | 'balanced' }

/**
 * Reconcile a counted till against expected cash. `variance` is counted − expected:
 * positive = over (more cash than sales explain), negative = short, ~0 = balanced.
 */
export const reconcileCash = (counted: number, expected: number): CashVariance => {
  const variance = round2((counted || 0) - (expected || 0));
  const direction = variance > 0.005 ? 'over' : variance < -0.005 ? 'short' : 'balanced';
  return { expected: round2(expected), counted: round2(counted || 0), variance, direction };
};

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
