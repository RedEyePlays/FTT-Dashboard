import { describe, it, expect } from 'vitest';
import { computeAnalytics, presetRange } from './analytics';
import { profitAndLoss } from './reports';
import { settlementFeeIncome } from './dropoffs';
import { dashboardPeriods, settlementsIncluded } from './dashboardPeriods';
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

/* ---------------- The Dashboard period cards ---------------- */

/**
 * THE LAST SURFACE WITH THE GAP.
 *
 * components/Dashboard.tsx hand-rolled its own Today / Last 7 Days / This
 * Month totals from two sources — recognized transactions and devices sold on
 * their inventory row — and had no notion of settlements at all. Settle a
 * buyer for $360 in fees and the P&L moved while these three cards did not, so
 * every settlement day understated Dashboard profit by the whole fee.
 *
 * The rule the cards must now match, and which the two other surfaces above
 * already do: the FEE is profit, the PRINCIPAL is nothing, and revenue does
 * not move.
 */
describe('dashboard period cards: settlement fees reach profit', () => {
  // `now` is inside DATE, so DATE lands in all three buckets.
  const NOW = new Date(`${DATE}T20:00:00`);
  const cards = (settlements?: Settlement[]) =>
    dashboardPeriods({ data: [], salesTransactions: [], settlements }, NOW);

  it('a settlement dated inside the Today bucket adds its fees to profit', () => {
    expect(cards([settlement()]).today.profit).toBe(20);
    // And to the wider buckets, which contain the same day.
    expect(cards([settlement()]).week.profit).toBe(20);
    expect(cards([settlement()]).month.profit).toBe(20);
  });

  it('the same settlement does NOT change revenue', () => {
    const after = cards([settlement()]);
    expect(after.today.revenue).toBe(0);
    expect(after.week.revenue).toBe(0);
    expect(after.month.revenue).toBe(0);
    // Profit exceeding revenue on a quiet settlement day is CORRECT and
    // matches Owner Analytics — a fee is margin with no cost of goods behind
    // it. There is deliberately no guard against it.
    expect(after.today.profit).toBeGreaterThan(after.today.revenue);
  });

  it('principal never contributes — a $100 device with a $20 fee moves profit $20, not $120', () => {
    const before = cards([]);
    const after = cards([settlement()]);
    expect(after.today.profit - before.today.profit).toBe(20);
    expect(after.today.profit - before.today.profit).not.toBe(120);
    // Even when the principal dwarfs the fee.
    expect(cards([settlement({
      principalStoreFunded: 5000, principalOwed: 5000, amountOwed: 5020, storeCashIn: 5020,
    })]).today.profit).toBe(20);
  });

  it('a legacy-shaped settlement still contributes its totalFees', () => {
    expect(cards([settlement({ model: undefined, totalFees: 8 })]).today.profit).toBe(8);
  });

  it('a settlement dated outside the range contributes nothing', () => {
    // Earlier in the same month: out of Today and out of the 7-day window,
    // still inside This Month — which is the bucketing working, not a leak.
    const old = cards([settlement({ date: '2026-03-01' })]);
    expect(old.today.profit).toBe(0);
    expect(old.week.profit).toBe(0);
    expect(old.month.profit).toBe(20);
    // A different month is out of all three.
    const older = cards([settlement({ date: '2026-01-15' })]);
    expect([older.today.profit, older.week.profit, older.month.profit]).toEqual([0, 0, 0]);
  });

  it('dates by `date` (the day settled), never by `periodEnd`', () => {
    // A settlement week that closed on the 1st but was actually settled today
    // is TODAY's fee income — which is the field profitAndLoss filters on too.
    expect(cards([settlement({ date: DATE, periodEnd: '2026-03-01' })]).today.profit).toBe(20);
    // And the reverse: settled on the 1st for a week ending today counts on
    // the 1st, so it is out of the Today bucket entirely.
    expect(cards([settlement({ date: '2026-03-01', periodEnd: DATE })]).today.profit).toBe(0);
  });

  it('agrees with the P&L on the same day, to the cent', () => {
    const s = [settlement(), settlement({ id: 's2', totalFees: 12.5 })];
    expect(cards(s).today.profit).toBe(pl(s).deviceBuyerFeeIncome);
    expect(cards(s).today.profit).toBe(32.5);
  });

  it('omitted settlements are NOT silently treated as none', () => {
    // undefined means "not loaded, or not readable by this viewer", which is a
    // different statement from "the shop settled nobody" — the Dashboard says
    // so on the card instead of showing a total that is short by the fees.
    expect(settlementsIncluded(undefined)).toBe(false);
    expect(settlementsIncluded([])).toBe(true);
    // And an absent array still produces the pre-fix figures rather than
    // throwing, so the cards render while the subscription is in flight.
    expect(cards(undefined).today).toEqual({ revenue: 0, profit: 0 });
  });
});
