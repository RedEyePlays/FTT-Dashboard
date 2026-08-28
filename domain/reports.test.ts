import { describe, it, expect } from 'vitest';
import { SalesTransaction, InventoryItem, PayPeriodPaid, CashReconciliation, Settlement, DeviceBuyer, Expense } from '../types';
import {
  cashCollectedOnTx, expectedCashForDate, reconcileCash,
  expectedEndingCash, sumDrawerEntries, cashDrawerSummary, openDrawerPatch,
  taxRemittance, taxReportCsvRows,
  profitAndLoss, profitLossCsvRows, settlementHistory, yearEndSummary, ProfitLossInput,
  cashSalesAfterClose, unreconciledDays,
} from './reports';
import { DEFAULT_EXPENSE_CATEGORIES } from './expenses';

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
// A settlement under the corrected financing model: the buyer repays the
// principal the store advanced and pays the store's service fee.
const settle = (p: Partial<Settlement>): Settlement => ({
  id: 's', buyerId: 'r1', date: '2026-07-05', dropOffIds: [], model: 'financing',
  principalStoreFunded: 0, principalPersonalFunded: 0, principalOwed: 0,
  totalFees: 0, amountOwed: 0, storeCashIn: 0, notes: '', ...p,
});
// A settlement as recorded BEFORE the rework — stored fields untouched, no
// `model`. Used to prove history is read as stored, never reinterpreted.
const legacySettle = (p: Partial<Settlement>): Settlement => ({
  id: 's-old', buyerId: 'r1', date: '2026-07-05', dropOffIds: [],
  totalPurchaseFronted: 0, totalFees: 0, amountPaid: 0, notes: '', ...p,
});
// The canonical case: store fronts $100 for a device the buyer keeps, charges
// a $20 service fee, and collects $120.
const financed120 = (p: Partial<Settlement> = {}): Settlement => settle({
  principalStoreFunded: 100, principalOwed: 100, totalFees: 20, amountOwed: 120, storeCashIn: 120, ...p,
});
const buyer = (p: Partial<DeviceBuyer>): DeviceBuyer => ({ id: 'r1', name: 'Alex', phone: '', notes: '', ...p });
const expense = (p: Partial<Expense>): Expense => ({
  id: 'e', date: '2026-07-10', amount: 0, category: 'other', paymentMethod: 'cash',
  enteredBy: 'o', enteredByEmail: 'o@shop.test', createdAt: 0, ...p,
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
  it('counts nothing for an e-transfer sale — no physical cash ever changed hands', () => {
    expect(cashCollectedOnTx(tx({ paymentMethod: 'etransfer', totalPaid: 250 }))).toBe(0);
  });

  it('still counts only the original deposit once a layaway is later paid off — never retroactively the full total', () => {
    // This is the specific bug a naive "balanceOwing > 0 ? deposit : totalPaid"
    // check would reintroduce: once a later balance payment clears
    // balanceOwing, that check would flip to totalPaid and this (already
    // reconciled, in the past) sale date's expected cash would silently
    // inflate the next time it's recomputed. `deposit` staying set (even
    // though balanceOwing is now cleared) is exactly the frozen signal that
    // must keep this at the original $100, not jump to $500.
    expect(cashCollectedOnTx(tx({ paymentMethod: 'cash', totalPaid: 500, deposit: 100, balanceOwing: undefined }))).toBe(100);
  });
});

describe('expectedCashForDate', () => {
  const txns = [
    tx({ id: 'a', date: '2026-07-20', paymentMethod: 'cash', totalPaid: 100 }),
    tx({ id: 'b', date: '2026-07-20', paymentMethod: 'mixed', totalPaid: 200, cashAmount: 50 }),
    tx({ id: 'c', date: '2026-07-20', paymentMethod: 'card', totalPaid: 80 }),   // no cash
    tx({ id: 'd', date: '2026-07-19', paymentMethod: 'cash', totalPaid: 999 }),   // other day
    tx({ id: 'e', date: '2026-07-20', paymentMethod: 'cash', totalPaid: 300, status: 'voided' }), // reversed
    tx({ id: 'f', date: '2026-07-20', paymentMethod: 'etransfer', totalPaid: 400 }), // no cash either
  ];
  it('sums the cash portion of the given day only', () => {
    expect(expectedCashForDate(txns, '2026-07-20')).toBe(150); // 100 + 50 — etransfer's 400 never counted
  });
  it('is zero for a day with no cash sales', () => {
    expect(expectedCashForDate(txns, '2026-01-01')).toBe(0);
  });
  it('a day of ONLY e-transfer sales has zero expected cash', () => {
    const etransferOnly = [tx({ id: 'g', date: '2026-08-01', paymentMethod: 'etransfer', totalPaid: 999 })];
    expect(expectedCashForDate(etransferOnly, '2026-08-01')).toBe(0);
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

describe('openDrawerPatch', () => {
  const user = { id: 'u1', email: 'staff@shop.com' };

  it('opens a fresh day active — stamps openedAt/By and leaves it un-reconciled', () => {
    const patch = openDrawerPatch(100, user, undefined, 1000);
    expect(patch).toMatchObject({
      openingFloat: 100, openedAt: 1000, openedBy: 'u1', openedByEmail: 'staff@shop.com',
      reconciledAt: undefined, reconciledBy: undefined, reconciledByEmail: undefined, countedCash: undefined,
    });
  });

  it('preserves the original openedAt/By on a later float adjustment (does not re-stamp)', () => {
    const existing = recon({ openingFloat: 50, openedAt: 500, openedBy: 'owner1', openedByEmail: 'owner@shop.com' });
    const patch = openDrawerPatch(75, user, existing, 2000);
    expect(patch.openingFloat).toBe(75);
    expect(patch.openedAt).toBe(500);
    expect(patch.openedBy).toBe('owner1');
    expect(patch.openedByEmail).toBe('owner@shop.com');
  });

  it('clears a prior close/reconcile for the day — opening always resumes an active state', () => {
    const closedToday = recon({
      openingFloat: 100, openedAt: 500, openedBy: 'owner1', openedByEmail: 'owner@shop.com',
      countedCash: 150, variance: 10,
      reconciledAt: 900, reconciledBy: 'owner1', reconciledByEmail: 'owner@shop.com',
    });
    const patch = openDrawerPatch(100, user, closedToday, 2000);
    expect(patch.reconciledAt).toBeUndefined();
    expect(patch.reconciledBy).toBeUndefined();
    expect(patch.reconciledByEmail).toBeUndefined();
    expect(patch.countedCash).toBeUndefined();
    // The open-session markers still carry through unchanged.
    expect(patch.openedAt).toBe(500);
  });

  it('floors a negative float to zero, like the rest of the drawer math', () => {
    const patch = openDrawerPatch(-20, user, undefined, 1000);
    expect(patch.openingFloat).toBe(0);
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
  const base: ProfitLossInput = {
    transactions: [], inventory: [], payPeriods: [], cashReconciliations: [], settlements: [],
    expenses: [], expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
  };

  it('builds a P&L: revenue − COGS − payroll − expenses + device buyer service fees', () => {
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
      expenses: [
        expense({ id: 'e1', date: '2026-07-08', amount: 40, category: 'rent' }),
        expense({ id: 'e2', date: '2026-07-09', amount: 10, category: 'utilities' }),
        expense({ id: 'wage', date: '2026-07-09', amount: 5000, category: 'wages' }), // excluded from P&L — payroll already subtracts it
      ],
      settlements: [settle({ date: '2026-07-05', principalStoreFunded: 200, principalOwed: 200, totalFees: 30, amountOwed: 230, storeCashIn: 230 })],
    };
    const pl = profitAndLoss(input, '2026-07-01', '2026-07-31');
    expect(pl.revenue).toBe(1300);         // 1000 txn + 300 standalone
    expect(pl.costOfGoods).toBe(570);      // (400+50) + (100+20)
    expect(pl.grossProfit).toBe(730);
    expect(pl.payroll).toBe(600);          // only the in-range paid period
    expect(pl.expenses).toBe(50);          // 40 + 10 — Wages excluded, not double-subtracted against payroll
    // The service fee is income; the $200 principal repayment is NOT — it is a
    // receivable being settled, so it never reaches revenue or profit.
    expect(pl.deviceBuyerFeeIncome).toBe(30);
    expect(pl.netProfit).toBe(110);            // 730 − 600 − 50 + 30
  });

  // --- The store FINANCES the buyer: only the service fee is profit ---

  it('a store-funded $100 device with a $20 fee raises profit by exactly $20, not $120', () => {
    const pl = profitAndLoss({ ...base, settlements: [financed120()] }, '2026-07-01', '2026-07-31');
    expect(pl.deviceBuyerFeeIncome).toBe(20);
    expect(pl.netProfit).toBe(20);
  });

  it('a buyer-funded device with a $20 fee also raises profit by exactly $20', () => {
    const pl = profitAndLoss({
      ...base,
      settlements: [settle({ totalFees: 20, amountOwed: 20, storeCashIn: 20 })], // no principal at all
    }, '2026-07-01', '2026-07-31');
    expect(pl.deviceBuyerFeeIncome).toBe(20);
    expect(pl.netProfit).toBe(20);
  });

  it('the principal repayment never appears in revenue, COGS or profit', () => {
    const cheap = profitAndLoss({ ...base, settlements: [financed120()] }, '2026-07-01', '2026-07-31');
    // Same $20 fee, but the store advanced $5,000 instead of $100. Nothing
    // about revenue, cost of goods or profit may move.
    const expensive = profitAndLoss({
      ...base,
      settlements: [financed120({ principalStoreFunded: 5000, principalOwed: 5000, amountOwed: 5020, storeCashIn: 5020 })],
    }, '2026-07-01', '2026-07-31');
    expect(expensive.revenue).toBe(0);
    expect(expensive.costOfGoods).toBe(0);
    expect(expensive.netProfit).toBe(cheap.netProfit);
    expect(expensive.netProfit).toBe(20);
  });

  it('fees add up across settlements — there is no direction or conditionality any more', () => {
    const pl = profitAndLoss({
      ...base,
      settlements: [
        financed120({ id: 'a', date: '2026-07-05' }),
        settle({ id: 'b', date: '2026-07-06', totalFees: 50, amountOwed: 50, storeCashIn: 50 }),
      ],
    }, '2026-07-01', '2026-07-31');
    expect(pl.deviceBuyerFeeIncome).toBe(70);
    expect(pl.netProfit).toBe(70);
  });

  it('the CSV export shows the service fee as a single income row, with no commission wording', () => {
    const pl = profitAndLoss({ ...base, settlements: [financed120()] }, '2026-07-01', '2026-07-31');
    const rows = profitLossCsvRows(pl);
    expect(rows).toContainEqual({ Line: 'Device buyer service fees (income)', Amount: '20.00' });
    expect(rows.some(r => String(r.Line).toLowerCase().includes('commission'))).toBe(false);
    expect(rows.some(r => String(r.Line).toLowerCase().includes('fees paid'))).toBe(false);
  });

  it('is all-zero for an empty range and produces labelled CSV rows', () => {
    const pl = profitAndLoss(base, '2026-01-01', '2026-12-31');
    expect(pl.netProfit).toBe(0);
    const rows = profitLossCsvRows(pl);
    expect(rows[0]).toEqual({ Line: 'Revenue', Amount: '0.00' });
    expect(rows[rows.length - 1]).toEqual({ Line: 'Net profit', Amount: '0.00' });
  });

  it('a cash-paid expense is counted exactly once in P&L, regardless of any cashOut entries also present on the drawer', () => {
    // App.tsx's handleSaveExpense appends a matching cashOut drawer entry
    // whenever an expense is paid in cash (so the till reflects it) — but
    // profitAndLoss must sum P&L expenses from the Expense ledger ONLY,
    // never from cashReconciliations.cashOut too, or a cash expense would be
    // subtracted twice. This is the core anti-double-count contract.
    const input: ProfitLossInput = {
      ...base,
      expenses: [expense({ id: 'e1', date: '2026-07-08', amount: 75, category: 'vehicle_fuel', paymentMethod: 'cash' })],
      // The SAME $75 also shows up as a drawer cashOut entry (this is the
      // expected, intentional drawer effect) — it must not be summed again.
      cashReconciliations: [recon({ date: '2026-07-08', cashOut: [{ id: 'c1', amount: 75 }] })],
    };
    const pl = profitAndLoss(input, '2026-07-01', '2026-07-31');
    expect(pl.expenses).toBe(75); // not 150
  });

  it('a settlement collection on the drawer never leaks into P&L expenses or revenue', () => {
    // Settling in cash writes a cashIn drawer entry (App.tsx) and no Expense
    // record. The drawer is not a P&L source: only the service fee counts.
    const input: ProfitLossInput = {
      ...base,
      cashReconciliations: [recon({ date: '2026-07-05', cashIn: [{ id: 'c1', amount: 120 }] })],
      settlements: [financed120()],
    };
    const pl = profitAndLoss(input, '2026-07-01', '2026-07-31');
    expect(pl.expenses).toBe(0);
    expect(pl.revenue).toBe(0);              // the $100 principal is not revenue
    expect(pl.deviceBuyerFeeIncome).toBe(20);
    expect(pl.netProfit).toBe(20);
  });

  it('breaks expenses out by category, including the excluded-from-PL ones for visibility', () => {
    const input: ProfitLossInput = {
      ...base,
      expenses: [
        expense({ id: 'e1', date: '2026-07-08', amount: 40, category: 'rent' }),
        expense({ id: 'wage', date: '2026-07-09', amount: 5000, category: 'wages' }),
      ],
    };
    const pl = profitAndLoss(input, '2026-07-01', '2026-07-31');
    expect(pl.expensesByCategory).toEqual([
      { category: 'wages', label: 'Wages', total: 5000, excludedFromPL: true },
      { category: 'rent', label: 'Rent', total: 40, excludedFromPL: false },
    ]);
    const rows = profitLossCsvRows(pl);
    expect(rows.find(r => (r as any).Line?.includes('Wages'))).toMatchObject({ Amount: '-5000.00' });
  });
});

describe('settlementHistory', () => {
  const deviceBuyers = [buyer({ id: 'r1', name: 'Alex' }), buyer({ id: 'r2', name: 'Sam' })];
  const settlements = [
    settle({ id: 's1', buyerId: 'r1', date: '2026-07-05', principalStoreFunded: 200, principalOwed: 200, totalFees: 30, amountOwed: 230, storeCashIn: 230 }),
    settle({ id: 's2', buyerId: 'r1', date: '2026-07-20', totalFees: 20, amountOwed: 20, storeCashIn: 20 }),
    settle({ id: 's3', buyerId: 'r2', date: '2026-07-10', principalStoreFunded: 100, principalOwed: 100, totalFees: 15, amountOwed: 115, storeCashIn: 115 }),
    settle({ id: 'old', buyerId: 'r1', date: '2026-06-01', totalFees: 999, amountOwed: 999 }), // out of range
  ];

  it('aggregates per buyer and overall within the range, principal apart from fees', () => {
    const h = settlementHistory(settlements, deviceBuyers, '2026-07-01', '2026-07-31');
    expect(h.count).toBe(3);
    expect(h.totalAmount).toBe(365);    // 230 + 20 + 115
    expect(h.totalPrincipal).toBe(300); // 200 + 0 + 100 — never merged into the fee figure
    expect(h.totalFees).toBe(65);       // 30 + 20 + 15
    expect(h.legacyCount).toBe(0);
    const alex = h.perBuyer.find(r => r.buyerId === 'r1')!;
    expect(alex.buyerName).toBe('Alex');
    expect(alex.settlementCount).toBe(2);
    expect(alex.totalAmount).toBe(250);
    expect(alex.totalPrincipal).toBe(200);
    expect(alex.totalFees).toBe(50);
    // sorted by total, newest lines first
    expect(h.perBuyer[0].buyerId).toBe('r1');
    expect(h.lines[0].id).toBe('s2');
  });

  it('a PRE-REWORK settlement is reported exactly as it was stored, and flagged as legacy', () => {
    const h = settlementHistory(
      [legacySettle({ id: 'old1', buyerId: 'r1', date: '2026-07-05', totalPurchaseFronted: 200, totalFees: 30, amountPaid: 230 })],
      deviceBuyers, '2026-07-01', '2026-07-31');
    expect(h.lines[0].legacy).toBe(true);
    expect(h.lines[0].totalPrincipal).toBe(200); // its stored totalPurchaseFronted, not recomputed
    expect(h.lines[0].totalAmount).toBe(230);    // its stored amountPaid
    expect(h.legacyCount).toBe(1);
    expect(h.perBuyer[0].legacyCount).toBe(1);
  });

  it('labels an unknown buyer and reverses swapped start/end', () => {
    const h = settlementHistory([settle({ id: 'z', buyerId: 'ghost', date: '2026-07-09', amountOwed: 10 })], deviceBuyers, '2026-07-31', '2026-07-01');
    expect(h.start).toBe('2026-07-01');
    expect(h.lines[0].buyerName).toBe('Unknown device buyer');
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
      cashReconciliations: [],
      expenses: [expense({ id: 'e1', date: '2026-06-01', amount: 25, category: 'rent' })],
      expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
      settlements: [settle({ date: '2026-08-01', totalFees: 45, amountOwed: 45, storeCashIn: 45 })],
    };
    const s = yearEndSummary(input, 2026);
    expect(s.revenue).toBe(1000);
    expect(s.salesTaxCollected).toBe(130);
    expect(s.payrollPaid).toBe(800);
    expect(s.expenses).toBe(25);
    expect(s.deviceBuyerFeeIncome).toBe(45);
    expect(s.netProfit).toBe(1000 - 400 - 800 - 25 + 45);
  });
});

// --- Post-close cash + unreconciled-day flagging -----------------------------
describe('cashSalesAfterClose', () => {
  const tx = (id: string, date: string, cash: number, createdAt?: number): SalesTransaction => ({
    id, date, createdAt, customerName: 'C', paymentMethod: 'cash',
    subtotal: cash, tax: 0, platformFee: 0, purchaseCost: 0, repairCost: 0, totalCost: 0,
    totalPaid: cash, netProfit: cash, lines: [],
  } as unknown as SalesTransaction);

  const CLOSE = 1_000_000;

  it('sums only the cash that came in after the drawer was counted', () => {
    const txs = [tx('before', '2026-08-26', 100, CLOSE - 1), tx('after', '2026-08-26', 250, CLOSE + 1)];
    expect(cashSalesAfterClose(txs, '2026-08-26', CLOSE)).toBe(250);
  });

  it('is zero for a day that was never reconciled — nothing is "after" an event that did not happen', () => {
    expect(cashSalesAfterClose([tx('t', '2026-08-26', 100, CLOSE + 1)], '2026-08-26', undefined)).toBe(0);
  });

  it('ignores other days', () => {
    expect(cashSalesAfterClose([tx('t', '2026-08-27', 100, CLOSE + 1)], '2026-08-26', CLOSE)).toBe(0);
  });

  it('treats a legacy row with no createdAt as pre-close rather than guessing', () => {
    expect(cashSalesAfterClose([tx('legacy', '2026-08-26', 100, undefined)], '2026-08-26', CLOSE)).toBe(0);
  });

  it('counts only the cash portion of a mixed payment, and nothing for a card sale', () => {
    const mixed = { ...tx('m', '2026-08-26', 300, CLOSE + 1), paymentMethod: 'mixed', cashAmount: 120 } as SalesTransaction;
    const card = { ...tx('c', '2026-08-26', 500, CLOSE + 1), paymentMethod: 'card' } as SalesTransaction;
    expect(cashSalesAfterClose([mixed, card], '2026-08-26', CLOSE)).toBe(120);
  });

  it('excludes a post-close sale that was then voided', () => {
    const voided = { ...tx('v', '2026-08-26', 200, CLOSE + 1), status: 'voided' } as SalesTransaction;
    expect(cashSalesAfterClose([voided], '2026-08-26', CLOSE)).toBe(0);
  });
});

describe('unreconciledDays', () => {
  const day = (date: string, p: Partial<CashReconciliation> = {}): CashReconciliation => ({
    id: date, date, expectedCash: 0, variance: 0, recordedBy: 'u', recordedAt: 0, ...p,
  });

  it('flags a past day that was opened but never reconciled', () => {
    const rows = [day('2026-08-24', { openedAt: 1 }), day('2026-08-25', { openedAt: 1, reconciledAt: 2 })];
    expect(unreconciledDays(rows, '2026-08-26').map(r => r.date)).toEqual(['2026-08-24']);
  });

  it('flags a past day with cash movement even if the drawer was never formally opened', () => {
    const rows = [
      day('2026-08-24', { cashIn: [{ id: 'a', amount: 50 }] }),
      day('2026-08-23', { withdrawals: [{ id: 'b', amount: 20 }] }),
      day('2026-08-22', { cashOut: [{ id: 'c', amount: 10 }] }),
    ];
    expect(unreconciledDays(rows, '2026-08-26').map(r => r.date)).toEqual(['2026-08-22', '2026-08-23', '2026-08-24']);
  });

  it('never flags today — a day is not late until it is over', () => {
    expect(unreconciledDays([day('2026-08-26', { openedAt: 1 })], '2026-08-26')).toEqual([]);
  });

  it('ignores a day with a record but no activity at all', () => {
    expect(unreconciledDays([day('2026-08-24')], '2026-08-26')).toEqual([]);
  });

  it('returns oldest-first so the flag can name the longest-outstanding day', () => {
    const rows = [day('2026-08-25', { openedAt: 1 }), day('2026-08-20', { openedAt: 1 })];
    expect(unreconciledDays(rows, '2026-08-26').map(r => r.date)).toEqual(['2026-08-20', '2026-08-25']);
  });
});
