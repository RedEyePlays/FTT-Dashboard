import { InventoryItem, SalesTransaction, Settlement } from '../types';
import { isRecognizedSale } from './reports';
import { kindOf } from './inventory';
import { settlementFeeIncome } from './dropoffs';
import { toISODate, shiftISODate } from './dates';

/**
 * THE DASHBOARD'S Today / Last 7 Days / This Month CARDS.
 *
 * Extracted from components/Dashboard.tsx, which hand-rolled these totals
 * inline. That was how it came to be the LAST profit surface still missing
 * settlement fee income: domain/reports.ts (the P&L) and domain/analytics.ts
 * (Owner Analytics) both call the shared `settlementFeeIncome`, and this one
 * had no notion of settlements at all, so settling a device buyer for $360
 * moved the P&L and left these three cards unchanged. Every settlement day
 * understated Dashboard profit by the full fee.
 *
 * It lives here, as a pure function, so that rule is testable without
 * mounting the component — which is the other half of why it drifted.
 *
 * THREE SOURCES, and they are the same three every other profit surface uses:
 *
 *   1. recognized sales transactions
 *   2. devices sold directly on their inventory row (not already in a txn)
 *   3. device-buyer settlement FEES — profit only, never revenue
 *
 * Pure: no React, no Firestore.
 */

export interface PeriodTotals {
  revenue: number;
  profit: number;
}

export interface DashboardPeriods {
  today: PeriodTotals;
  week: PeriodTotals;
  month: PeriodTotals;
}

export interface DashboardPeriodInput {
  /** Devices + accessories. */
  data: InventoryItem[];
  salesTransactions: SalesTransaction[];
  /**
   * Device-buyer settlements. UNDEFINED means "not available to this viewer or
   * not loaded yet" and is NOT the same as an empty array — the caller is
   * expected to say so on screen rather than quietly show a figure that is
   * short by the day's fee income. See `settlementsIncluded`.
   */
  settlements?: Settlement[];
}

/** One dated money event. Revenue and profit move independently — see below. */
export interface PeriodEvent {
  date: string;
  revenue: number;
  profit: number;
}

/**
 * Every dated money event in the period cards.
 *
 * Sales are unioned and de-duplicated: every transaction, plus any device sold
 * directly on its inventory row that isn't already in a transaction.
 *
 * Only RECOGNIZED sales contribute (domain/reports.ts's isRecognizedSale — not
 * voided/returned, and not an open layaway still owing a balance). The tiles
 * used to count every transaction's full subtotal/netProfit unconditionally,
 * which meant a fresh $500 layaway that had only collected a $50 deposit
 * inflated Today/This Week/This Month revenue by the full $500 the moment it
 * was created.
 */
export function periodEvents(input: DashboardPeriodInput): PeriodEvent[] {
  const { data, salesTransactions, settlements } = input;
  const txnInvIds = new Set<string>();
  salesTransactions.forEach(t => t.lines?.forEach(l => { if (l.inventoryId) txnInvIds.add(l.inventoryId); }));

  const events: PeriodEvent[] = [];
  salesTransactions.filter(isRecognizedSale).forEach(t => events.push({
    date: t.date, revenue: t.subtotal || 0, profit: t.netProfit || 0,
  }));
  data.forEach(i => {
    if (kindOf(i) === 'device' && i.soldDate && !txnInvIds.has(i.id)) {
      const revenue = i.salePrice || 0;
      const profit = revenue - (i.purchaseCost || 0) - (i.repairCost || 0) - (i.shippingCost || 0) - (i.platformFees || 0);
      events.push({ date: i.soldDate, revenue, profit });
    }
  });

  // --- Device-buyer settlements: THE FEE, AS PROFIT, WITH NO REVENUE --------
  //
  // Only the SERVICE FEE is income. The principal the buyer repays is the
  // store's own purchase money coming back: a receivable being settled, not
  // revenue. Counting it would report a $100 device with a $20 fee as $120 of
  // profit. settlementFeeIncome (domain/dropoffs.ts) is the ONE shared
  // derivation of that rule — called here, by profitAndLoss and by
  // computeAnalytics — so the three can never drift on what counts.
  //
  // It lands in `profit` and NOT in `revenue`, matching domain/analytics.ts
  // exactly: a fee is margin with no cost of goods behind it, so putting it in
  // revenue would distort gross margin and the revenue-per-sale averages. The
  // P&L applies it at the net-profit line for the same reason. A third
  // convention here is the actual failure mode, so there is deliberately not
  // one. A consequence worth expecting rather than guarding against: on a
  // quiet settlement day profit EXCEEDS revenue on these cards, exactly as it
  // already does in Owner Analytics.
  //
  // Dated by `date` — the day settled, which is what profitAndLoss filters on.
  // Not `periodEnd` and not `cashCollectedOn`.
  //
  // Legacy (pre-financing-rework) settlements are included on the same terms;
  // `settlementFeeIncome` already handles both record shapes.
  (settlements || []).forEach(s => {
    const fee = settlementFeeIncome([s]);
    if (fee !== 0 && s.date) events.push({ date: s.date, revenue: 0, profit: fee });
  });

  return events;
}

const bucket = (events: PeriodEvent[], inPeriod: (d: string) => boolean): PeriodTotals =>
  events.filter(e => inPeriod(e.date)).reduce(
    (a, e) => ({ revenue: a.revenue + e.revenue, profit: a.profit + e.profit }),
    { revenue: 0, profit: 0 },
  );

/**
 * The three cards, for a given "now".
 *
 * All comparisons are on LOCAL 'YYYY-MM-DD' strings (domain/dates.ts's
 * toISODate), never on UTC ones — an evening sale in a negative-offset
 * timezone otherwise lands on tomorrow's card.
 *
 * "Last 7 Days" is today plus the six days before it, inclusive, which is what
 * the card has always meant.
 */
export function dashboardPeriods(
  input: DashboardPeriodInput,
  now: Date | number = Date.now(),
): DashboardPeriods {
  const todayStr = toISODate(now);
  const weekAgoStr = shiftISODate(todayStr, -6);
  const monthPrefix = todayStr.slice(0, 7);
  const events = periodEvents(input);
  return {
    today: bucket(events, d => d === todayStr),
    week: bucket(events, d => d >= weekAgoStr && d <= todayStr),
    month: bucket(events, d => d.startsWith(monthPrefix)),
  };
}

/**
 * Are these cards actually settlement-inclusive?
 *
 * `undefined` settlements means the figures are short by whatever the shop
 * settled in the period — either because the deferred subscription has not
 * delivered yet, or because this viewer cannot read the collection at all. In
 * both cases the number looks EXACTLY like the bug this was written to fix, so
 * the Dashboard says so on the card rather than letting it pass as complete.
 */
export const settlementsIncluded = (settlements: Settlement[] | undefined): boolean =>
  Array.isArray(settlements);
