import { describe, it, expect } from 'vitest';
import { SalesTransaction } from '../types';
import {
  cashCollectedOnTx, expectedCashForDate, reconcileCash,
  expectedEndingCash, sumDrawerEntries,
  taxRemittance, taxReportCsvRows,
} from './reports';

const tx = (p: Partial<SalesTransaction>): SalesTransaction => ({
  id: 't', date: '2026-07-20', customerName: '', subtotal: 0, tax: 0, platformFee: 0,
  purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines: [], ...p,
});

describe('cashCollectedOnTx', () => {
  it('counts the full total of a cash sale', () => {
    expect(cashCollectedOnTx(tx({ paymentMethod: 'cash', totalPaid: 113 }))).toBe(113);
  });
  it('counts only the cash portion of a mixed sale', () => {
    expect(cashCollectedOnTx(tx({ paymentMethod: 'mixed', totalPaid: 200, cashAmount: 120, cardAmount: 80 }))).toBe(120);
  });
  it('counts nothing for a card sale', () => {
    expect(cashCollectedOnTx(tx({ paymentMethod: 'card', totalPaid: 90 }))).toBe(0);
  });
  it('counts only the deposit of a cash layaway (balance not yet collected)', () => {
    expect(cashCollectedOnTx(tx({ paymentMethod: 'cash', totalPaid: 500, deposit: 100, balanceOwing: 400 }))).toBe(100);
  });
  it('counts nothing for a reversed (voided/returned) sale', () => {
    expect(cashCollectedOnTx(tx({ paymentMethod: 'cash', totalPaid: 100, status: 'voided' }))).toBe(0);
    expect(cashCollectedOnTx(tx({ paymentMethod: 'cash', totalPaid: 100, status: 'returned' }))).toBe(0);
  });
});

describe('expectedCashForDate', () => {
  const txns = [
    tx({ id: 'a', date: '2026-07-20', paymentMethod: 'cash', totalPaid: 100 }),
    tx({ id: 'b', date: '2026-07-20', paymentMethod: 'mixed', totalPaid: 200, cashAmount: 50 }),
    tx({ id: 'c', date: '2026-07-20', paymentMethod: 'card', totalPaid: 80 }),   // no cash
    tx({ id: 'd', date: '2026-07-19', paymentMethod: 'cash', totalPaid: 999 }),   // other day
    tx({ id: 'e', date: '2026-07-20', paymentMethod: 'cash', totalPaid: 300, status: 'voided' }), // reversed
  ];
  it('sums the cash portion of the given day only', () => {
    expect(expectedCashForDate(txns, '2026-07-20')).toBe(150); // 100 + 50
  });
  it('is zero for a day with no cash sales', () => {
    expect(expectedCashForDate(txns, '2026-01-01')).toBe(0);
  });
});

describe('sumDrawerEntries', () => {
  it('sums entry amounts, ignoring blanks and negatives', () => {
    expect(sumDrawerEntries([{ amount: 20 }, { amount: 5.5 }, { amount: -3 }, { amount: 0 }])).toBe(25.5);
    expect(sumDrawerEntries()).toBe(0);
  });
});

describe('expectedEndingCash', () => {
  it('is opening float + cash sales − cash out − withdrawals', () => {
    expect(expectedEndingCash({ openingFloat: 200, cashSales: 500, cashOut: 60, withdrawals: 300 })).toBe(340);
  });
  it('treats missing components as zero', () => {
    expect(expectedEndingCash({ cashSales: 100 })).toBe(100);
    expect(expectedEndingCash({})).toBe(0);
  });
  it('does not falsely flag a shortage when cash legitimately left the drawer', () => {
    // Float 100, $400 cash sales, but $150 paid out + $200 pulled to the bank.
    const expected = expectedEndingCash({ openingFloat: 100, cashSales: 400, cashOut: 150, withdrawals: 200 });
    expect(expected).toBe(150);
    // Counting exactly $150 is balanced — the old sales-only formula would have
    // wrongly shown a $250 shortage.
    expect(reconcileCash(150, expected).direction).toBe('balanced');
  });
});

describe('reconcileCash', () => {
  it('flags an over count', () => {
    expect(reconcileCash(160, 150)).toEqual({ expected: 150, counted: 160, variance: 10, direction: 'over' });
  });
  it('flags a short count with the exact amount', () => {
    const r = reconcileCash(140, 150);
    expect(r.variance).toBe(-10);
    expect(r.direction).toBe('short');
  });
  it('reports balanced when the till matches (within a cent)', () => {
    expect(reconcileCash(150, 150).direction).toBe('balanced');
    expect(reconcileCash(150.004, 150).direction).toBe('balanced');
  });
});

describe('taxRemittance', () => {
  const txns = [
    tx({ id: 'jan', date: '2026-01-15', subtotal: 100, tax: 13 }),
    tx({ id: 'feb1', date: '2026-02-10', subtotal: 200, tax: 26 }),
    tx({ id: 'feb2', date: '2026-02-20', subtotal: 100, tax: 13 }),
    tx({ id: 'apr', date: '2026-04-05', subtotal: 300, tax: 39 }),
    tx({ id: 'void', date: '2026-02-11', subtotal: 500, tax: 65, status: 'voided' }),      // excluded
    tx({ id: 'ret', date: '2026-02-12', subtotal: 400, tax: 52, status: 'returned' }),     // excluded
    tx({ id: 'lay', date: '2026-02-13', subtotal: 700, tax: 91, deposit: 100, balanceOwing: 691 }), // not settled → excluded
    tx({ id: 'out', date: '2026-05-01', subtotal: 999, tax: 130 }),                        // out of range
  ];

  it('totals tax over the range, excluding reversed and unsettled sales', () => {
    const r = taxRemittance(txns, '2026-01-01', '2026-04-30', 'month');
    expect(r.totalTaxCollected).toBe(91);       // 13 + 26 + 13 + 39
    expect(r.totalTaxableSales).toBe(700);      // 100 + 200 + 100 + 300
    expect(r.totalSalesCount).toBe(4);
  });

  it('groups by month', () => {
    const r = taxRemittance(txns, '2026-01-01', '2026-04-30', 'month');
    expect(r.rows.map(x => [x.key, x.taxCollected])).toEqual([
      ['2026-01', 13], ['2026-02', 39], ['2026-04', 39],
    ]);
    expect(r.rows[1].label).toBe('February 2026');
  });

  it('groups by quarter', () => {
    const r = taxRemittance(txns, '2026-01-01', '2026-12-31', 'quarter');
    const q1 = r.rows.find(x => x.key === '2026-Q1');
    const q2 = r.rows.find(x => x.key === '2026-Q2');
    expect(q1?.taxCollected).toBe(52);   // Jan 13 + Feb 26 + Feb 13
    expect(q2?.taxCollected).toBe(169);  // Apr 39 + May 130 (both in range for the full year)
    expect(q1?.label).toBe('Q1 2026');
  });

  it('handles reversed start/end order and produces CSV rows with a Total', () => {
    const r = taxRemittance(txns, '2026-04-30', '2026-01-01', 'month'); // swapped
    expect(r.start).toBe('2026-01-01');
    const rows = taxReportCsvRows(r);
    expect(rows[rows.length - 1]).toMatchObject({ Period: 'Total', 'Tax Collected': '91.00' });
  });
});
