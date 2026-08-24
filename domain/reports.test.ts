import { describe, it, expect } from 'vitest';
import { SalesTransaction, InventoryItem, PayPeriodPaid, CashReconciliation, Settlement, Runner } from '../types';
import {
  cashCollectedOnTx, expectedCashForDate, reconcileCash,
  expectedEndingCash, sumDrawerEntries, cashDrawerSummary,
  taxRemittance, taxReportCsvRows,
  profitAndLoss, profitLossCsvRows, settlementHistory, yearEndSummary, ProfitLossInput,
} from './reports';

const tx = (p: Partial<SalesTransaction>): SalesTransaction => ({
  id: 't', date: '2026-07-20', customerName: '', subtotal: 0, tax: 0, platformFee: 0,
  purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines: [], ...p,
});
const dev = (p: Partial<InventoryItem>): InventoryItem => ({
  id: 'd', kind: 'device', date: '2026-01-01', item: 'Phone', imei: '', boughtFrom: '', purchaseCost: 0,
  repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, notes: '', ...p,
} as InventoryItem);
const paid = (p: Partial<PayPeriodPaid>): PayPeriodPaid => ({
  id: 'x', userId: 'u', periodStart: '2026-07-01', periodEnd: '2026-07-14', markedBy: 'o', markedAt: 0, hours: 0, gross: 0, rate: 0, ...p,
});
const recon = (p: Partial<CashReconciliation>): CashReconciliation => ({
  id: 'r', date: '2026-07-10', expectedCash: 0, countedCash: 0, variance: 0, recordedBy: 'o', recordedAt: 0, ...p,
});
const settle = (p: Partial<Settlement>): Settlement => ({
  id: 's', runnerId: 'r1', date: '2026-07-05', dropOffIds: [], totalPurchaseFronted: 0, totalFees: 0, amountPaid: 0, notes: '', ...p,
});
const runner = (p: Partial<Runner>): Runner => ({ id: 'r1', name: 'Alex', phone: '', notes: '', ...p });

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
  it('adds manual cash-in (top-ups / tips / off-sale payments)', () => {
    // Float 100 + 400 sales + 50 cash-in − 30 out = 520.
    expect(expectedEndingCash({ openingFloat: 100, cashSales: 400, cashIn: 50, cashOut: 30 })).toBe(520);
  });
});

describe('cashDrawerSummary', () => {
  it('rolls a saved record + the day\'s cash sales into one expected figure', () => {
    const r = recon({
      openingFloat: 100, openedAt: 1,
      cashIn: [{ id: 'i', amount: 20 }, { id: 'i2', amount: 5 }],
      cashOut: [{ id: 'o', amount: 15 }],
      withdrawals: [{ id: 'w', amount: 50 }],
    });
    const s = cashDrawerSummary(r, 400);
    expect(s).toMatchObject({ opened: true, openingFloat: 100, cashSales: 400, cashIn: 25, cashOut: 15, withdrawals: 50 });
    // 100 + 400 + 25 − 15 − 50 = 460 — same formula as reconciliation.
    expect(s.expected).toBe(460);
    expect(s.expected).toBe(expectedEndingCash({ openingFloat: 100, cashSales: 400, cashIn: 25, cashOut: 15, withdrawals: 50 }));
  });
  it('reports not-opened and zeroes for a day with no record', () => {
    const s = cashDrawerSummary(undefined, 120);
    expect(s.opened).toBe(false);
    expect(s.openingFloat).toBe(0);
    expect(s.expected).toBe(120); // just the day's cash sales
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

describe('profitAndLoss', () => {
  const base: ProfitLossInput = { transactions: [], inventory: [], payPeriods: [], cashReconciliations: [], settlements: [] };

  it('builds a P&L: revenue − COGS − payroll − cash expenses − runner commissions', () => {
    const input: ProfitLossInput = {
      ...base,
      transactions: [
        tx({ id: 'a', date: '2026-07-10', subtotal: 1000, purchaseCost: 400, repairCost: 50, lines: [{ inventoryId: 'd1', kind: 'device', name: 'x', quantity: 1, unitPrice: 1000 } as any] }),
        tx({ id: 'void', date: '2026-07-11', subtotal: 500, purchaseCost: 200, status: 'voided' }),                 // excluded
        tx({ id: 'lay', date: '2026-07-12', subtotal: 800, purchaseCost: 300, deposit: 100, balanceOwing: 700 }),  // excluded
        tx({ id: 'old', date: '2026-06-30', subtotal: 999, purchaseCost: 999 }),                                    // out of range
      ],
      inventory: [
        dev({ id: 'd9', soldDate: '2026-07-15', salePrice: 300, purchaseCost: 100, repairCost: 20 }),  // standalone sold
        dev({ id: 'd1', soldDate: '2026-07-10', salePrice: 1000, purchaseCost: 400 }),                  // in a txn → not double counted
        dev({ id: 'unsold', soldDate: '', salePrice: 0, purchaseCost: 250 }),                           // not sold
      ],
      payPeriods: [paid({ periodStart: '2026-07-01', gross: 600 }), paid({ periodStart: '2026-06-01', gross: 999 })],
      cashReconciliations: [recon({ date: '2026-07-08', cashOut: [{ id: 'c', amount: 40 }, { id: 'c2', amount: 10 }] })],
      settlements: [settle({ date: '2026-07-05', totalFees: 30, totalPurchaseFronted: 200, amountPaid: 230 })],
    };
    const pl = profitAndLoss(input, '2026-07-01', '2026-07-31');
    expect(pl.revenue).toBe(1300);         // 1000 txn + 300 standalone
    expect(pl.costOfGoods).toBe(570);      // (400+50) + (100+20)
    expect(pl.grossProfit).toBe(730);
    expect(pl.payroll).toBe(600);          // only the in-range paid period
    expect(pl.cashExpenses).toBe(50);      // 40 + 10
    expect(pl.runnerCommissions).toBe(30); // fees only, not amountPaid (avoids double-counting COGS)
    expect(pl.netProfit).toBe(50);         // 730 − 600 − 50 − 30
  });

  it('is all-zero for an empty range and produces labelled CSV rows', () => {
    const pl = profitAndLoss(base, '2026-01-01', '2026-12-31');
    expect(pl.netProfit).toBe(0);
    const rows = profitLossCsvRows(pl);
    expect(rows[0]).toEqual({ Line: 'Revenue', Amount: '0.00' });
    expect(rows[rows.length - 1]).toEqual({ Line: 'Net profit', Amount: '0.00' });
  });
});

describe('settlementHistory', () => {
  const runners = [runner({ id: 'r1', name: 'Alex' }), runner({ id: 'r2', name: 'Sam' })];
  const settlements = [
    settle({ id: 's1', runnerId: 'r1', date: '2026-07-05', totalFees: 30, totalPurchaseFronted: 200, amountPaid: 230 }),
    settle({ id: 's2', runnerId: 'r1', date: '2026-07-20', totalFees: 20, totalPurchaseFronted: 0, amountPaid: 20 }),
    settle({ id: 's3', runnerId: 'r2', date: '2026-07-10', totalFees: 15, totalPurchaseFronted: 100, amountPaid: 115 }),
    settle({ id: 'old', runnerId: 'r1', date: '2026-06-01', totalFees: 999, amountPaid: 999 }), // out of range
  ];

  it('aggregates per runner and overall within the range', () => {
    const h = settlementHistory(settlements, runners, '2026-07-01', '2026-07-31');
    expect(h.count).toBe(3);
    expect(h.totalPaid).toBe(365);   // 230 + 20 + 115
    expect(h.totalFees).toBe(65);    // 30 + 20 + 15
    const alex = h.perRunner.find(r => r.runnerId === 'r1')!;
    expect(alex.runnerName).toBe('Alex');
    expect(alex.settlementCount).toBe(2);
    expect(alex.totalPaid).toBe(250);
    expect(alex.totalFees).toBe(50);
    // sorted by total paid, newest lines first
    expect(h.perRunner[0].runnerId).toBe('r1');
    expect(h.lines[0].id).toBe('s2');
  });

  it('labels an unknown runner and reverses swapped start/end', () => {
    const h = settlementHistory([settle({ id: 'z', runnerId: 'ghost', date: '2026-07-09', amountPaid: 10 })], runners, '2026-07-31', '2026-07-01');
    expect(h.start).toBe('2026-07-01');
    expect(h.lines[0].runnerName).toBe('Unknown runner');
  });
});

describe('yearEndSummary', () => {
  it('rolls the year up into one accountant-ready summary', () => {
    const input: ProfitLossInput = {
      transactions: [
        tx({ id: 'a', date: '2026-03-01', subtotal: 1000, tax: 130, purchaseCost: 400 }),
        tx({ id: 'b', date: '2027-01-01', subtotal: 500, tax: 65, purchaseCost: 100 }), // next year, excluded
      ],
      inventory: [],
      payPeriods: [paid({ periodStart: '2026-05-01', gross: 800 })],
      cashReconciliations: [recon({ date: '2026-06-01', cashOut: [{ id: 'c', amount: 25 }] })],
      settlements: [settle({ date: '2026-08-01', totalFees: 45, amountPaid: 45 })],
    };
    const s = yearEndSummary(input, 2026);
    expect(s.revenue).toBe(1000);
    expect(s.salesTaxCollected).toBe(130);
    expect(s.payrollPaid).toBe(800);
    expect(s.cashExpenses).toBe(25);
    expect(s.runnerCommissions).toBe(45);
    expect(s.netProfit).toBe(1000 - 400 - 800 - 25 - 45);
  });
});
