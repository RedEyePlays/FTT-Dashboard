import { describe, it, expect } from 'vitest';
import { computeAnalytics, presetRange } from './analytics';
import { profitAndLoss } from './reports';
import { settlementFeeIncome } from './dropoffs';
import { Settlement, SalesTransaction, InventoryItem } from '../types';

// Settling a device buyer added fee income to the P&L report and moved NOTHING
// on the Dashboard tiles / Close Out / Daily History — domain/analytics.ts had
// no reference to settlements at all. These lock in the fix, and above all the
// rule that makes it correct: ONLY THE FEE IS PROFIT. The principal the buyer
// repays is the store's own purchase money coming back — a receivable, not
// revenue.

const DATE = '2026-03-10';

const settlement = (p: Partial<Settlement> = {}): Settlement => ({
  id: 's1', buyerId: 'b1', date: DATE, dropOffIds: ['d1'],
  model: 'financing',
  principalStoreFunded: 100, principalPersonalFunded: 0, principalOwed: 100,
  totalFees: 20,
  amountOwed: 120, storeCashIn: 120, notes: '',
  ...p,
});

const emptyInput = {
  salesTransactions: [] as SalesTransaction[],
  repairs: [], inventory: [] as InventoryItem[], customers: [], auditLogs: [], activity: [],
};

// A range covering DATE, expressed the way each module wants it.
const range = () => presetRange('custom', new Date(`${DATE}T12:00:00`).getTime(), { start: DATE, end: DATE });
const analytics = (settlements: Settlement[]) =>
  computeAnalytics(range(), { ...emptyInput, settlements }, new Date(`${DATE}T20:00:00`).getTime());

const pl = (settlements: Settlement[]) => profitAndLoss({
  transactions: [], inventory: [], payPeriods: [], cashReconciliations: [],
  settlements, expenses: [], expenseCategories: [],
}, DATE, DATE);

describe('settlementFeeIncome — the one shared derivation', () => {
  it('counts the service fee and NOTHING else', () => {
    expect(settlementFeeIncome([settlement()])).toBe(20);
  });

  it('never touches principal, amountOwed or storeCashIn', () => {
    // A settlement whose principal dwarfs the fee still yields only the fee.
    expect(settlementFeeIncome([settlement({
      principalStoreFunded: 5000, principalOwed: 5000, amountOwed: 5020, storeCashIn: 5020, totalFees: 20,
    })])).toBe(20);
  });

  it('sums across several settlements', () => {
    expect(settlementFeeIncome([settlement(), settlement({ id: 's2', totalFees: 15 })])).toBe(35);
  });

  it('is 0 for an empty set and tolerates a missing fee', () => {
    expect(settlementFeeIncome([])).toBe(0);
    expect(settlementFeeIncome([{ totalFees: undefined as unknown as number }])).toBe(0);
  });
});

describe('analytics: settled buyer fees reach the profit figures', () => {
  it('a $100 store-funded device with a $20 fee raises profit by EXACTLY $20', () => {
    const before = analytics([]);
    const after = analytics([settlement()]);
    expect(after.grossProfit - before.grossProfit).toBe(20);
    // Not $120 — the classic failure this guards against.
    expect(after.grossProfit - before.grossProfit).not.toBe(120);
  });

  it('the principal NEVER appears in revenue', () => {
    const a = analytics([settlement()]);
    expect(a.revenue).toBe(0);        // a fee is margin with no cost of goods
    expect(a.grossProfit).toBe(20);
    expect(a.deviceBuyerFeeIncome).toBe(20);
  });

  it('reaches Close Out / Daily History through the same eod object', () => {
    const a = analytics([settlement()]);
    expect(a.eod.grossProfit).toBe(20);
    expect(a.eod.deviceBuyerFeeIncome).toBe(20);
    expect(a.eod.revenue).toBe(0);
  });

  it('shows on the Daily History chart, on the settlement date', () => {
    const a = analytics([settlement()]);
    const day = a.revenueSeries.find(d => d.date === DATE.slice(5));
    expect(day).toBeTruthy();
    expect(day!.profit).toBe(20);
    expect(day!.revenue).toBe(0);
    // The chart and the headline tile above it must not disagree.
    expect(a.revenueSeries.reduce((s, d) => s + d.profit, 0)).toBe(a.grossProfit);
  });

  it('a settlement OUTSIDE the range changes nothing', () => {
    expect(analytics([settlement({ date: '2026-03-01' })]).grossProfit).toBe(0);
  });

  it('is broken out as its own category, as profit with no revenue', () => {
    const cat = analytics([settlement()]).categories.find(c => c.name === 'Device Buyer Fees');
    expect(cat).toBeTruthy();
    expect(cat!.profit).toBe(20);
    expect(cat!.revenue).toBe(0);
  });

  it('callers that pass no settlements at all are completely unaffected', () => {
    const a = computeAnalytics(range(), emptyInput, Date.now());
    expect(a.deviceBuyerFeeIncome).toBe(0);
    expect(a.grossProfit).toBe(0);
  });
});

describe('analytics and profitAndLoss agree for the same date range', () => {
  it('report the identical fee-income figure', () => {
    const s = [settlement(), settlement({ id: 's2', totalFees: 12.5 })];
    expect(analytics(s).deviceBuyerFeeIncome).toBe(pl(s).deviceBuyerFeeIncome);
    expect(analytics(s).deviceBuyerFeeIncome).toBe(32.5);
  });

  it('both move by the same amount when a settlement is added', () => {
    const deltaAnalytics = analytics([settlement()]).grossProfit - analytics([]).grossProfit;
    const deltaPl = pl([settlement()]).netProfit - pl([]).netProfit;
    expect(deltaAnalytics).toBe(deltaPl);
    expect(deltaAnalytics).toBe(20);
  });

  it('neither counts principal, on any settlement shape', () => {
    const big = [settlement({ principalStoreFunded: 9999, principalOwed: 9999, amountOwed: 10019, storeCashIn: 10019 })];
    expect(analytics(big).deviceBuyerFeeIncome).toBe(20);
    expect(pl(big).deviceBuyerFeeIncome).toBe(20);
    expect(analytics(big).revenue).toBe(0);
    expect(pl(big).revenue).toBe(0);
  });

  it('a legacy (pre-rework) settlement is treated on the same terms by both', () => {
    // `model` unset = legacy. `totalFees` means the same thing on both shapes,
    // so dropping legacy records would silently lose real fee income.
    const legacy = [settlement({ model: undefined, totalFees: 8 })];
    expect(analytics(legacy).deviceBuyerFeeIncome).toBe(8);
    expect(pl(legacy).deviceBuyerFeeIncome).toBe(8);
  });
});
