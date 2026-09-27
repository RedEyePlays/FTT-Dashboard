import { describe, it, expect } from 'vitest';
import { dashboardPeriods, periodEvents } from './dashboardPeriods';
import { InventoryItem, SalesTransaction } from '../types';

/**
 * THE SALES SIDE OF THE PERIOD CARDS, pinned across the extraction.
 *
 * This logic was lifted out of components/Dashboard.tsx's useMemo unchanged so
 * settlement fee income could be added to it and tested. It is live money on
 * the first screen the owner opens, so the rules it already enforced — the
 * recognized-sale filter, the transaction/inventory-row de-duplication, and
 * local-date bucketing — are asserted here rather than taken on trust.
 *
 * The settlement rule itself lives in domain/settlementProfit.test.ts, next to
 * the same rule for the P&L and Owner Analytics, so all three read together.
 */

const NOW = new Date('2026-03-10T20:00:00');
const TODAY = '2026-03-10';

const txn = (p: Partial<SalesTransaction> = {}): SalesTransaction => ({
  id: 't1', date: TODAY, lines: [], subtotal: 500, tax: 0, total: 500, totalPaid: 500,
  netProfit: 120, paymentMethod: 'cash', createdAt: Date.now(),
  ...p,
} as SalesTransaction);

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', item: 'iPhone 13', sku: 'PHN-1', date: '2026-03-01',
  purchaseCost: 300, salePrice: 500, soldDate: TODAY,
  ...p,
} as InventoryItem);

const cards = (data: InventoryItem[], salesTransactions: SalesTransaction[]) =>
  dashboardPeriods({ data, salesTransactions }, NOW);

describe('period cards: recognized sales only', () => {
  it('a plain transaction contributes its subtotal and net profit', () => {
    expect(cards([], [txn()]).today).toEqual({ revenue: 500, profit: 120 });
  });

  it('an open layaway still owing a balance contributes NOTHING', () => {
    // The bug this filter exists for: a fresh $500 layaway that had collected
    // a $50 deposit inflated the cards by the full $500 the moment it existed.
    expect(cards([], [txn({ balanceOwing: 450 })]).today).toEqual({ revenue: 0, profit: 0 });
  });

  it('a voided or returned sale contributes nothing', () => {
    // Reversal is a `status`, not a pair of booleans (domain/pos.ts).
    expect(cards([], [txn({ status: 'voided' })]).today.revenue).toBe(0);
    expect(cards([], [txn({ status: 'returned' })]).today.revenue).toBe(0);
  });
});

describe('period cards: devices sold on their own row', () => {
  it('count once, net of cost, repairs, shipping and platform fees', () => {
    const d = device({ purchaseCost: 300, repairCost: 40, shippingCost: 10, platformFees: 25 });
    expect(cards([d], []).today).toEqual({ revenue: 500, profit: 125 });
  });

  it('are NOT double-counted when the same device is on a transaction line', () => {
    const t = txn({ lines: [{ inventoryId: 'd1', kind: 'device', name: 'iPhone 13', quantity: 1, unitPrice: 500 }] } as Partial<SalesTransaction>);
    // The transaction is the record; the row is skipped.
    expect(cards([device()], [t]).today).toEqual({ revenue: 500, profit: 120 });
  });

  it('an unsold device contributes nothing, and neither does an accessory row', () => {
    expect(cards([device({ soldDate: undefined })], []).today.revenue).toBe(0);
    // Accessories are sold through transactions; a bare accessory row is stock.
    expect(cards([{ id: 'a1', item: 'Case', quantity: 5, costPerUnit: 3, sellingPrice: 15 } as InventoryItem], []).today.revenue).toBe(0);
  });
});

describe('period cards: the three buckets', () => {
  const on = (date: string) => cards([], [txn({ date })]);

  it('Today is today alone', () => {
    expect(on(TODAY).today.revenue).toBe(500);
    expect(on('2026-03-09').today.revenue).toBe(0);
  });

  it('Last 7 Days is today plus the six days before it, inclusive', () => {
    expect(on('2026-03-04').week.revenue).toBe(500);   // sixth day back — in
    expect(on('2026-03-03').week.revenue).toBe(0);     // seventh — out
    // A future-dated sale is out of the window, not silently counted.
    expect(on('2026-03-11').week.revenue).toBe(0);
  });

  it('This Month is the calendar month, not the last 30 days', () => {
    expect(on('2026-03-01').month.revenue).toBe(500);
    expect(on('2026-02-28').month.revenue).toBe(0);
  });

  it('buckets on the LOCAL date, so an evening sale is not tomorrow', () => {
    // toISODate, never toISOString().split('T')[0] — the latter yields
    // tomorrow's date for an evening event west of UTC.
    expect(dashboardPeriods({ data: [], salesTransactions: [txn()] }, new Date('2026-03-10T23:30:00')).today.revenue).toBe(500);
  });
});

describe('periodEvents', () => {
  it('produces one dated event per contributing record', () => {
    const events = periodEvents({ data: [device()], salesTransactions: [txn({ id: 't2' })] });
    expect(events.map(e => e.date)).toEqual([TODAY, TODAY]);
    expect(events.reduce((n, e) => n + e.revenue, 0)).toBe(1000);
  });

  it('is empty for an empty shop', () => {
    expect(periodEvents({ data: [], salesTransactions: [] })).toEqual([]);
  });
});
