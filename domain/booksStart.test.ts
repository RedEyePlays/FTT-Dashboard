import { describe, it, expect } from 'vitest';
import { SalesTransaction, Expense, RecurringExpense, CashReconciliation } from '../types';
import { clampToBooksStart, clampToBooksStartMs, booksStartClamps, isoDateToMs } from './dates';
import { profitAndLoss, ProfitLossInput, taxRemittance, taxReportCsvRows, yearEndSummary, yearEndCsvRows, unreconciledDays } from './reports';
import { duePeriodsFor, expensesInRange, plExpenseTotal, DEFAULT_EXPENSE_CATEGORIES } from './expenses';

// The owner only began using the system in full in September 2026. The
// partial data from before that — half-entered sales, expenses nobody logged,
// days the drawer was never run — is real history and must not be deleted,
// but folding it into a total produces a figure that is simply wrong:
// revenue without its costs, an expense ledger with holes, permanent
// unactionable alerts for days the shop wasn't using the app.
//
// So TOTALS start at the books start date. Individual records stay fully
// visible and searchable — this is a reporting rule, not a deletion.

const BOOKS = '2026-09-01';

describe('clampToBooksStart — the one rule', () => {
  it('pulls a range that reaches back before the books start forward', () => {
    expect(clampToBooksStart('2026-01-01', BOOKS)).toBe(BOOKS);
  });

  it('leaves a range that already starts on or after it untouched', () => {
    expect(clampToBooksStart('2026-09-01', BOOKS)).toBe('2026-09-01');
    expect(clampToBooksStart('2026-10-15', BOOKS)).toBe('2026-10-15');
  });

  it('UNSET means no clamp at all — existing workspaces are unchanged', () => {
    expect(clampToBooksStart('2020-01-01', undefined)).toBe('2020-01-01');
    expect(clampToBooksStart('2020-01-01', '')).toBe('2020-01-01');
  });

  it('flags whether a clamp actually happened, so the report can say so', () => {
    expect(booksStartClamps('2026-01-01', BOOKS)).toBe(true);
    expect(booksStartClamps('2026-09-01', BOOKS)).toBe(false);
    expect(booksStartClamps('2026-01-01', undefined)).toBe(false);
  });

  it('the epoch-ms twin clamps to LOCAL midnight of the books start', () => {
    const jan = isoDateToMs('2026-01-01');
    expect(clampToBooksStartMs(jan, BOOKS)).toBe(isoDateToMs(BOOKS));
    expect(clampToBooksStartMs(isoDateToMs('2026-10-01'), BOOKS)).toBe(isoDateToMs('2026-10-01'));
    expect(clampToBooksStartMs(jan, undefined)).toBe(jan);
  });
});

/* ---------------- P&L ---------------- */

const sale = (date: string, subtotal: number, tax = 0): SalesTransaction => ({
  id: `tx-${date}-${subtotal}`, date, customerName: 'A', lines: [],
  subtotal, tax, totalPaid: subtotal + tax, netProfit: subtotal, paymentMethod: 'cash',
} as SalesTransaction);

const expense = (date: string, amount: number, category = 'rent'): Expense => ({
  id: `e-${date}-${amount}`, date, amount, category,
  paymentMethod: 'cash', enteredBy: 'owner', enteredByEmail: 'owner@shop.test', createdAt: 1,
} as Expense);

const plBase: ProfitLossInput = {
  transactions: [], inventory: [], payPeriods: [], cashReconciliations: [],
  settlements: [], expenses: [], expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
};

describe('the P&L starts at the books start date', () => {
  const input: ProfitLossInput = {
    ...plBase,
    transactions: [sale('2026-08-15', 1000), sale('2026-09-15', 500)],
    expenses: [expense('2026-08-20', 300), expense('2026-09-20', 100)],
    booksStartDate: BOOKS,
  };

  it('pre-books revenue and expenses are both excluded', () => {
    const pl = profitAndLoss(input, '2026-01-01', '2026-12-31');
    expect(pl.revenue).toBe(500);
    expect(pl.expenses).toBe(100);
    expect(pl.netProfit).toBe(400);
  });

  it('the reported start is the books start, not the requested one', () => {
    const pl = profitAndLoss(input, '2026-01-01', '2026-12-31');
    expect(pl.start).toBe(BOOKS);
    expect(pl.clampedToBooksStart).toBe(true);
  });

  it('a range already inside the books is not flagged and not moved', () => {
    const pl = profitAndLoss(input, '2026-09-01', '2026-09-30');
    expect(pl.clampedToBooksStart).toBe(false);
    expect(pl.start).toBe('2026-09-01');
    expect(pl.revenue).toBe(500);
  });

  it('WITHOUT a books start date the same data behaves exactly as before', () => {
    const pl = profitAndLoss({ ...input, booksStartDate: undefined }, '2026-01-01', '2026-12-31');
    expect(pl.revenue).toBe(1500);
    expect(pl.expenses).toBe(400);
    expect(pl.clampedToBooksStart).toBe(false);
  });

  it('clamps payroll and bonuses on the same boundary', () => {
    const pl = profitAndLoss({
      ...plBase, booksStartDate: BOOKS,
      payPeriods: [
        { id: 'p1', userId: 'u1', periodStart: '2026-08-01', periodEnd: '2026-08-14', markedBy: 'o', markedAt: 1, hours: 10, gross: 200, rate: 20 },
        { id: 'p2', userId: 'u1', periodStart: '2026-09-01', periodEnd: '2026-09-14', markedBy: 'o', markedAt: 1, hours: 10, gross: 300, rate: 30 },
      ],
      bonuses: [
        { id: 'b1', userId: 'u1', userEmail: 'a@b.c', amount: 50, date: '2026-08-20', reason: 'x', paidFrom: 'store_cash', createdBy: 'o', createdAt: 1 },
        { id: 'b2', userId: 'u1', userEmail: 'a@b.c', amount: 75, date: '2026-09-20', reason: 'y', paidFrom: 'store_cash', createdBy: 'o', createdAt: 1 },
      ],
    }, '2026-01-01', '2026-12-31');
    expect(pl.payroll).toBe(300);
    expect(pl.bonuses).toBe(75);
  });
});

/* ---------------- Sales tax ---------------- */

describe('the sales-tax remittance report starts there too', () => {
  const txns = [sale('2026-08-15', 1000, 130), sale('2026-09-15', 500, 65)];

  it('excludes pre-books tax from the filing figures', () => {
    const r = taxRemittance(txns, '2026-01-01', '2026-12-31', 'month', BOOKS);
    expect(r.totalTaxableSales).toBe(500);
    expect(r.totalTaxCollected).toBe(65);
    expect(r.totalSalesCount).toBe(1);
    expect(r.start).toBe(BOOKS);
    expect(r.clampedToBooksStart).toBe(true);
  });

  it('without a books start date it reports everything, as before', () => {
    const r = taxRemittance(txns, '2026-01-01', '2026-12-31', 'month');
    expect(r.totalTaxCollected).toBe(195);
    expect(r.clampedToBooksStart).toBe(false);
  });

  it('the CSV says so in the file itself, not only on screen', () => {
    const rows = taxReportCsvRows(taxRemittance(txns, '2026-01-01', '2026-12-31', 'month', BOOKS));
    expect(String(rows[0].Period)).toContain(BOOKS);
    expect(String(rows[0].Period)).toContain('books start date');
  });

  it('an unclamped CSV gains no extra header row', () => {
    const rows = taxReportCsvRows(taxRemittance(txns, '2026-09-01', '2026-12-31', 'month', BOOKS));
    expect(String(rows[0].Period)).not.toContain('books start');
  });
});

describe('the year-end accountant export', () => {
  const input: ProfitLossInput = {
    ...plBase,
    transactions: [sale('2026-03-15', 1000, 130), sale('2026-09-15', 500, 65)],
    booksStartDate: BOOKS,
  };

  it('clamps its P&L and its tax figures on the SAME boundary', () => {
    const s = yearEndSummary(input, 2026);
    expect(s.revenue).toBe(500);
    expect(s.salesTaxCollected).toBe(65);
    expect(s.clampedToBooksStart).toBe(true);
    expect(s.figuresStart).toBe(BOOKS);
  });

  it('states the start date in the exported CSV', () => {
    const rows = yearEndCsvRows(yearEndSummary(input, 2026));
    const note = rows.find(r => String(r.Metric) === 'Figures start');
    expect(String(note?.Value)).toContain(BOOKS);
  });

  it('a year entirely after the books start is unflagged and unchanged', () => {
    const s = yearEndSummary({ ...input, booksStartDate: '2026-01-01' }, 2026);
    expect(s.clampedToBooksStart).toBe(false);
    expect(s.revenue).toBe(1500);
  });
});

/* ---------------- Expenses ---------------- */

describe('expense totals', () => {
  const list = [expense('2026-08-10', 300), expense('2026-09-10', 100)];

  it('a total excludes pre-books expenses', () => {
    expect(plExpenseTotal(list, DEFAULT_EXPENSE_CATEGORIES, '2026-01-01', '2026-12-31', BOOKS)).toBe(100);
  });

  it('and so does the in-range list the by-category breakdown is built from', () => {
    expect(expensesInRange(list, '2026-01-01', '2026-12-31', BOOKS).map(e => e.date)).toEqual(['2026-09-10']);
  });

  it('without a books start date, nothing changes', () => {
    expect(plExpenseTotal(list, DEFAULT_EXPENSE_CATEGORIES, '2026-01-01', '2026-12-31')).toBe(400);
  });
});

describe('recurring expenses never offer a period from before the books start', () => {
  const rent = (over: Partial<RecurringExpense> = {}): RecurringExpense => ({
    id: 'r1', label: 'Rent', amount: 2000, category: 'rent', frequency: 'monthly',
    startDate: '2026-01-01', active: true, paymentMethod: 'cash',
    createdBy: 'owner', createdAt: 1, ...over,
  } as RecurringExpense);
  const NOW = isoDateToMs('2026-10-15');

  it('the bug: a January template offers every month back to January', () => {
    // Without the clamp the owner is handed ten months of back-rent to post,
    // every one of them into a period the books are meant to exclude.
    const due = duePeriodsFor(rent(), NOW);
    expect(due.length).toBeGreaterThan(6);
    expect(due[0].date).toBe('2026-01-01');
  });

  it('with a books start date it begins there instead', () => {
    const due = duePeriodsFor(rent(), NOW, BOOKS);
    expect(due.map(d => d.date)).toEqual(['2026-09-01', '2026-10-01']);
  });

  it('a template that starts AFTER the books start keeps its own start date', () => {
    const due = duePeriodsFor(rent({ startDate: '2026-10-01' }), NOW, BOOKS);
    expect(due.map(d => d.date)).toEqual(['2026-10-01']);
  });

  it('already-generated and skipped periods are still honoured', () => {
    const due = duePeriodsFor(rent({ generatedPeriods: ['2026-09'], skippedPeriods: ['2026-10'] }), NOW, BOOKS);
    expect(due).toEqual([]);
  });
});

/* ---------------- Alerts ---------------- */

describe('drawer alerts stop nagging about days before the books start', () => {
  const day = (date: string): CashReconciliation => ({
    id: date, date, openedAt: 1, openingFloat: 100, expectedCash: 100, variance: 0,
    recordedBy: 'u1', recordedAt: 1,
  });

  it('a pre-books unreconciled day is not flagged — the till was never run through the app', () => {
    const rows = unreconciledDays([day('2026-08-10'), day('2026-09-10')], '2026-09-20', BOOKS);
    expect(rows.map(r => r.date)).toEqual(['2026-09-10']);
  });

  it('without a books start date every unreconciled day is still flagged', () => {
    const rows = unreconciledDays([day('2026-08-10'), day('2026-09-10')], '2026-09-20');
    expect(rows.map(r => r.date)).toEqual(['2026-08-10', '2026-09-10']);
  });

  it('today is still excluded either way — it is not late until it is over', () => {
    expect(unreconciledDays([day('2026-09-20')], '2026-09-20', BOOKS)).toEqual([]);
  });
});
