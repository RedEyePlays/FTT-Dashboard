import { describe, it, expect } from 'vitest';
import { InventoryItem, SalesTransaction, SalesLine } from '../types';
import {
  salesLedger, saleTotals, trimLedger, trimLedgerRow, salesLedgerCsvRows,
  ledgerSellers, refundSplitLabel,
} from './salesLedger';
import { profitAndLoss, taxRemittance } from './reports';

const line = (p: Partial<SalesLine> = {}): SalesLine => ({
  kind: 'device', name: 'iPhone 13', quantity: 1, unitPrice: 400, ...p,
});

const tx = (p: Partial<SalesTransaction> = {}): SalesTransaction => ({
  id: 't1', date: '2026-03-10', customerName: 'Walk-in',
  subtotal: 400, tax: 52, platformFee: 0,
  purchaseCost: 200, repairCost: 40, totalCost: 240, totalPaid: 452, netProfit: 160,
  lines: [line()], paymentMethod: 'cash', ...p,
});

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'PHN-000001', date: '2026-01-01', item: 'iPhone 13',
  imei: '351234567890123', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready', ...p,
});

const plInput = (transactions: SalesTransaction[], inventory: InventoryItem[] = []) => ({
  transactions, inventory, payPeriods: [], cashReconciliations: [],
  settlements: [], expenses: [], expenseCategories: [],
});

describe('the money side of one sale', () => {
  it('reports tax EXACTLY as recorded — including a manually typed one', () => {
    expect(saleTotals(tx({ tax: 17.31 })).tax).toBe(17.31);
    // A sale with no tax reads $0.00, not blank.
    expect(saleTotals(tx({ tax: 0 })).tax).toBe(0);
  });

  it('splits a MIXED cash/card sale the way it was actually paid', () => {
    const t = tx({ paymentMethod: 'mixed', cashAmount: 200, cardAmount: 252, tax: 52, totalPaid: 452 });
    const s = saleTotals(t);
    expect(s.cash).toBe(200);
    expect(s.card).toBe(252);
    expect(s.etransfer).toBe(0);
    expect(s.totalPaid).toBe(452);
    expect(s.tax).toBe(52);
    expect(s.paymentMethod).toBe('Mixed');
  });

  it('puts the whole total under its own method on a single-method sale', () => {
    expect(saleTotals(tx({ paymentMethod: 'etransfer', totalPaid: 452 })))
      .toMatchObject({ cash: 0, card: 0, etransfer: 452, paymentMethod: 'E-Transfer' });
  });

  it('carries a payment note through, and store credit reads 0 until that feature exists', () => {
    const s = saleTotals(tx({ notes: 'paid half now' }));
    expect(s.paymentNote).toBe('paid half now');
    expect(s.storeCredit).toBe(0);
  });
});

describe('rows', () => {
  it('one row per sale line, with the sale-level block on the first', () => {
    const t = tx({ lines: [line({ name: 'iPhone 13', unitPrice: 300 }), line({ kind: 'accessory', name: 'Case', unitPrice: 100 })], subtotal: 400 });
    const l = salesLedger({ transactions: [t], inventory: [] }, '2026-03-01', '2026-03-31');
    expect(l.rows).toHaveLength(2);
    expect(l.rows[0].firstOfSale).toBe(true);
    expect(l.rows[1].firstOfSale).toBe(false);
    expect(l.rows.map(r => r.lineKind)).toEqual(['device', 'accessory']);
  });

  it('resolves the SKU and IMEI off the linked inventory item', () => {
    const d = device({ id: 'd9', sku: 'PHN-000042', imei: '359999999999999' });
    const t = tx({ lines: [line({ inventoryId: 'd9' })] });
    const l = salesLedger({ transactions: [t], inventory: [d] }, '2026-03-01', '2026-03-31');
    expect(l.rows[0].sku).toBe('PHN-000042');
    expect(l.rows[0].imei).toBe('359999999999999');
  });

  it('apportions cost and the channel fee across lines by their share of the sale', () => {
    const t = tx({
      lines: [line({ unitPrice: 300 }), line({ kind: 'accessory', name: 'Case', unitPrice: 100 })],
      subtotal: 400, purchaseCost: 200, repairCost: 40, platformFee: 20,
    });
    const l = salesLedger({ transactions: [t], inventory: [] }, '2026-03-01', '2026-03-31');
    expect(l.rows[0].totalCost).toBe(180); // 75% of 240
    expect(l.rows[1].totalCost).toBe(60);  // 25% of 240
    expect(l.rows[0].channelFee).toBe(15);
    // ...but the TOTAL comes from the transaction, so it is exact.
    expect(l.totals.cost).toBe(240);
  });

  it('includes a standalone sold device — the off-POS sale the P&L also counts', () => {
    const sold = device({ id: 'direct', soldDate: '2026-03-12', salePrice: 500, purchaseCost: 300, soldTo: 'Ali' });
    const l = salesLedger({ transactions: [], inventory: [sold] }, '2026-03-01', '2026-03-31');
    expect(l.rows).toHaveLength(1);
    expect(l.rows[0].revenue).toBe(500);
    expect(l.rows[0].sale.paymentMethod).toBe('Direct sale');
    expect(l.rows[0].sale.tax).toBe(0);
  });

  it('does not double-count a device that sold through the POS', () => {
    const d = device({ id: 'd9', soldDate: '2026-03-10', salePrice: 400 });
    const t = tx({ lines: [line({ inventoryId: 'd9' })] });
    const l = salesLedger({ transactions: [t], inventory: [d] }, '2026-03-01', '2026-03-31');
    expect(l.rows).toHaveLength(1);
    expect(l.totals.revenue).toBe(400);
  });

  it('excludes a layaway that still has a balance owing', () => {
    const t = tx({ balanceOwing: 100 });
    expect(salesLedger({ transactions: [t], inventory: [] }, '2026-03-01', '2026-03-31').rows).toHaveLength(0);
  });
});

describe('voids and returns', () => {
  const march = new Date('2026-03-15T12:00:00').getTime();
  const april = new Date('2026-04-02T12:00:00').getTime();

  it('appears NEGATIVE in the month it happened, not the month of the sale', () => {
    const t = tx({ date: '2026-03-10', status: 'returned', returnedAt: april, refundAmount: 452, refundPaidFrom: 'card' });
    const inMarch = salesLedger({ transactions: [t], inventory: [] }, '2026-03-01', '2026-03-31');
    const inApril = salesLedger({ transactions: [t], inventory: [] }, '2026-04-01', '2026-04-30');
    expect(inMarch.reversalRows).toHaveLength(0);
    expect(inApril.reversalRows).toHaveLength(1);
    expect(inApril.reversalRows[0].revenue).toBeLessThan(0);
    expect(inApril.reversalRows[0].date).toBe('2026-04-02');
  });

  it('says how the refund was actually paid', () => {
    const t = tx({ status: 'voided', voidedAt: march, refundSplits: [{ paidFrom: 'store_cash', amount: 200 }, { paidFrom: 'card', amount: 252 }] });
    const l = salesLedger({ transactions: [t], inventory: [] }, '2026-03-01', '2026-03-31');
    const rev = l.reversalRows[0].reversal!;
    expect(rev.kind).toBe('voided');
    expect(rev.refundAmount).toBe(452);
    expect(refundSplitLabel(rev.splits)).toBe('Store cash $200.00 + Card $252.00');
    expect(rev.label).toContain('Voided 2026-03-15');
  });

  it('falls back to the implied split for a reversal recorded before that field existed', () => {
    const t = tx({ status: 'voided', voidedAt: march, paymentMethod: 'card' });
    const l = salesLedger({ transactions: [t], inventory: [] }, '2026-03-01', '2026-03-31');
    expect(l.reversalRows[0].reversal!.splits[0].paidFrom).toBe('card');
  });

  it('is NEVER netted off revenue — it is reported on its own line', () => {
    const good = tx({ id: 'ok', date: '2026-03-05' });
    const bad = tx({ id: 'gone', date: '2026-03-05', status: 'voided', voidedAt: march });
    const l = salesLedger({ transactions: [good, bad], inventory: [] }, '2026-03-01', '2026-03-31');
    expect(l.totals.revenue).toBe(400);       // only the good sale
    expect(l.totals.refunds).toBe(452);       // the refund, separately
    expect(l.rows).toHaveLength(1);
  });

  it('leaves the ORIGINAL sale in its own month untouched', () => {
    // A sale rung in March and returned in April: March's ledger still shows
    // nothing for it (it is no longer recognized), and April shows the refund.
    const t = tx({ date: '2026-03-10', status: 'returned', returnedAt: april, refundAmount: 452 });
    const march2 = salesLedger({ transactions: [t], inventory: [] }, '2026-03-01', '2026-03-31');
    expect(march2.totals.revenue).toBe(0);
    expect(march2.totals.refunds).toBe(0);
  });
});

describe('THE THREE REPORTS AGREE', () => {
  const transactions = [
    tx({ id: 'a', date: '2026-03-02', subtotal: 400, tax: 52, purchaseCost: 200, repairCost: 40, totalPaid: 452 }),
    tx({ id: 'b', date: '2026-03-14', subtotal: 250, tax: 32.5, purchaseCost: 120, repairCost: 0, totalPaid: 282.5, paymentMethod: 'card', lines: [line({ unitPrice: 250 })] }),
    tx({ id: 'c', date: '2026-03-20', subtotal: 180, tax: 0, purchaseCost: 90, repairCost: 10, totalPaid: 180, paymentMethod: 'etransfer', lines: [line({ kind: 'accessory', name: 'Case', unitPrice: 180 })] }),
    // Excluded from all three, for the same reason in each.
    tx({ id: 'void', date: '2026-03-21', status: 'voided', voidedAt: new Date('2026-03-21T12:00:00').getTime() }),
    tx({ id: 'layaway', date: '2026-03-22', balanceOwing: 50 }),
    // Out of range.
    tx({ id: 'april', date: '2026-04-01' }),
  ];
  const inventory = [device({ id: 'direct', soldDate: '2026-03-25', salePrice: 500, purchaseCost: 300, repairCost: 20 })];
  const START = '2026-03-01', END = '2026-03-31';

  const ledger = salesLedger({ transactions, inventory }, START, END);
  const pl = profitAndLoss(plInput(transactions, inventory), START, END);
  const tax = taxRemittance(transactions, START, END);

  it('ledger revenue equals the P&L revenue', () => {
    expect(ledger.totals.revenue).toBe(pl.revenue);
  });

  it('ledger cost and profit equal the P&L cost of goods and gross profit', () => {
    expect(ledger.totals.cost).toBe(pl.costOfGoods);
    expect(ledger.totals.profit).toBe(pl.grossProfit);
  });

  it('ledger tax equals the Sales Tax tab total', () => {
    expect(ledger.totals.tax).toBe(tax.totalTaxCollected);
  });

  it('the payment splits add up to what was collected on the recognized sales', () => {
    expect(ledger.totals.cash + ledger.totals.card + ledger.totals.etransfer)
      .toBeCloseTo(452 + 282.5 + 180, 2);
  });

  it('the void is excluded from all three and appears only as a refund row', () => {
    expect(ledger.rows.some(r => r.saleId === 'void')).toBe(false);
    expect(ledger.reversalRows.map(r => r.saleId)).toEqual(['void']);
    expect(ledger.totals.refunds).toBeGreaterThan(0);
  });
});

describe('filters', () => {
  const transactions = [
    tx({ id: 'a', date: '2026-03-02', soldBy: 'u1', soldByEmail: 'sam@shop.test', lines: [line({ name: 'iPhone 16', sku: 'PHN-1' })] }),
    tx({ id: 'b', date: '2026-03-03', soldBy: 'u2', soldByEmail: 'ali@shop.test', paymentMethod: 'card', lines: [line({ kind: 'accessory', name: 'Braided Cable', sku: 'ACC-1' })] }),
  ];
  const range = (f = {}) => salesLedger({ transactions, inventory: [] }, '2026-03-01', '2026-03-31', f);

  it('filters by line kind', () => {
    expect(range({ kinds: ['accessory'] }).rows.map(r => r.saleId)).toEqual(['b']);
    expect(range({ kinds: ['device'] }).rows.map(r => r.saleId)).toEqual(['a']);
  });

  it('filters by payment method and by seller', () => {
    expect(range({ paymentMethods: ['card'] }).rows.map(r => r.saleId)).toEqual(['b']);
    expect(range({ soldBy: 'u1' }).rows.map(r => r.saleId)).toEqual(['a']);
  });

  it('searches with the SHARED multi-word matcher', () => {
    expect(range({ query: 'iphone 16' }).rows.map(r => r.saleId)).toEqual(['a']);
    expect(range({ query: '16 iphone' }).rows.map(r => r.saleId)).toEqual(['a']); // order-free
    expect(range({ query: 'braided cable' }).rows.map(r => r.saleId)).toEqual(['b']);
    expect(range({ query: 'ali' }).rows.map(r => r.saleId)).toEqual(['b']);       // by seller
    expect(range({ query: 'nothing' }).rows).toHaveLength(0);
  });

  it('lists the sellers who actually appear in the range', () => {
    expect(ledgerSellers(transactions, '2026-03-01', '2026-03-31'))
      .toEqual([{ id: 'u2', email: 'ali@shop.test' }, { id: 'u1', email: 'sam@shop.test' }]);
  });
});

describe('a manager sees no cost or profit — in the rows OR the CSV', () => {
  const t = tx({ soldByEmail: 'sam@shop.test' });
  const full = salesLedger({ transactions: [t], inventory: [] }, '2026-03-01', '2026-03-31');

  it('strips the fields from the object, not merely from the table', () => {
    const trimmed = trimLedger(full, false);
    const row = trimmed.rows[0];
    expect('purchaseCost' in row).toBe(false);
    expect('repairCost' in row).toBe(false);
    expect('totalCost' in row).toBe(false);
    expect('profit' in row).toBe(false);
    expect('channelFee' in row).toBe(false);
    expect('cost' in trimmed.totals).toBe(false);
    expect('profit' in trimmed.totals).toBe(false);
  });

  it('keeps everything a manager legitimately needs', () => {
    const row = trimLedgerRow(full.rows[0], false);
    expect(row.revenue).toBe(400);
    expect(row.sale.tax).toBe(52);
    expect(row.sale.cash).toBe(452);
    expect(row.soldByEmail).toBe('sam@shop.test');
  });

  it('the CSV carries no cost column at all', () => {
    const csv = salesLedgerCsvRows(trimLedger(full, false), false);
    const headers = Object.keys(csv[0]);
    expect(headers).not.toContain('Purchase cost');
    expect(headers).not.toContain('Profit');
    expect(headers).toContain('Tax');
    expect(JSON.stringify(csv)).not.toContain('240');  // the total cost
    expect(JSON.stringify(csv)).not.toContain('200');  // the purchase cost
  });

  it('the owner\'s CSV does carry them', () => {
    const csv = salesLedgerCsvRows(full, true);
    expect(Object.keys(csv[0])).toContain('Profit');
    expect(csv[csv.length - 1]).toMatchObject({ Date: 'Total' });
  });
});

describe('the books start date', () => {
  it('pulls the range forward and says so', () => {
    const t = tx({ date: '2025-06-01' });
    const l = salesLedger({ transactions: [t], inventory: [], booksStartDate: '2026-01-01' }, '2025-01-01', '2026-12-31');
    expect(l.clampedToBooksStart).toBe(true);
    expect(l.start).toBe('2026-01-01');
    expect(l.rows).toHaveLength(0);
    expect(salesLedgerCsvRows(l, true)[0].Date).toContain('books start date');
  });
});
