import { describe, it, expect } from 'vitest';
import { toISODate, todayISO, isoDateToMs, shiftISODate } from './dates';
import { presetRange, computeAnalytics } from './analytics';
import { SalesTransaction } from '../types';

// These assertions are written to hold in ANY timezone the suite happens to run
// in: they compare against the runtime's own local calendar fields rather than
// hardcoding a zone. The bug being guarded is precisely a disagreement between
// the local and UTC calendar date, so a test that assumed one zone would be
// testing the wrong thing.
const localYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('toISODate', () => {
  it('returns the LOCAL calendar date, not the UTC one', () => {
    for (const iso of ['2026-08-26T20:30:00Z', '2026-01-15T03:00:00Z', '2026-12-31T23:59:00Z', '2026-06-01T00:30:00Z']) {
      const d = new Date(iso);
      expect(toISODate(d)).toBe(localYMD(d));
    }
  });

  it('accepts an epoch-ms instant as well as a Date', () => {
    const d = new Date('2026-08-26T20:30:00Z');
    expect(toISODate(d.getTime())).toBe(toISODate(d));
  });

  it('zero-pads month and day', () => {
    expect(toISODate(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
  });

  it('round-trips through isoDateToMs at local midnight', () => {
    const ymd = '2026-08-26';
    const ms = isoDateToMs(ymd);
    expect(toISODate(ms)).toBe(ymd);
    expect(new Date(ms).getHours()).toBe(0);
  });

  it('returns empty string for an invalid date rather than "NaN-NaN-NaN"', () => {
    expect(toISODate(new Date('nonsense'))).toBe('');
  });

  it('todayISO agrees with toISODate for the same instant', () => {
    const now = Date.now();
    expect(todayISO(now)).toBe(toISODate(now));
  });
});

describe('shiftISODate', () => {
  it('moves forward and backward by whole local days', () => {
    expect(shiftISODate('2026-08-26', 1)).toBe('2026-08-27');
    expect(shiftISODate('2026-08-26', -1)).toBe('2026-08-25');
    expect(shiftISODate('2026-08-26', 0)).toBe('2026-08-26');
  });
  it('crosses month and year boundaries', () => {
    expect(shiftISODate('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftISODate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftISODate('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('survives a DST transition without drifting a day', () => {
    // Nov 1 2026 is the US/Canada fall-back date; +1 day must still be Nov 2.
    expect(shiftISODate('2026-11-01', 1)).toBe('2026-11-02');
    expect(shiftISODate('2026-03-08', 1)).toBe('2026-03-09');
  });
});

// --- The actual reported bug -----------------------------------------------
// "Sales completed after the register is closed (evening wholesale deals) don't
// count toward that day's profit." Root cause: the sale was stamped with the
// UTC date while "Today" is a local range.
describe('regression: an evening sale counts toward that same local day', () => {
  const tx = (id: string, date: string, subtotal: number, netProfit: number): SalesTransaction => ({
    id, date, subtotal, netProfit, total: subtotal, lines: [], paymentMethod: 'cash',
  } as unknown as SalesTransaction);

  const emptyInput = { repairs: [], inventory: [], customers: [], auditLogs: [], activity: [] };

  it('a sale rung up late in the evening lands in TODAY, not tomorrow', () => {
    // 8:30pm local — past UTC midnight for any western-hemisphere shop.
    const evening = new Date();
    evening.setHours(20, 30, 0, 0);
    const stamped = toISODate(evening);           // what the app now stores
    const range = presetRange('today', evening.getTime());

    const a = computeAnalytics(range, { ...emptyInput, salesTransactions: [tx('t1', stamped, 500, 200)] }, evening.getTime());
    expect(a.revenue).toBe(500);
    expect(a.grossProfit).toBe(200);
    expect(a.eod.revenue).toBe(500);
  });

  it('the old UTC stamping is what dropped it — proving the fix is load-bearing', () => {
    const evening = new Date();
    evening.setHours(20, 30, 0, 0);
    const range = presetRange('today', evening.getTime());
    const utcStamped = evening.toISOString().split('T')[0]; // the old behavior

    const a = computeAnalytics(range, { ...emptyInput, salesTransactions: [tx('t1', utcStamped, 500, 200)] }, evening.getTime());

    // In a timezone where 20:30 local is already tomorrow in UTC, the old
    // stamping loses the sale entirely. Where it isn't (UTC / eastern zones at
    // this hour), both agree — so assert the relationship rather than a
    // zone-specific outcome.
    const utcDiffers = utcStamped !== toISODate(evening);
    expect(a.revenue).toBe(utcDiffers ? 0 : 500);
  });

  it('profit for the day is unaffected by how many sales came before or after any close', () => {
    // Three sales across the day, all on the same local date: morning, evening,
    // and one after a hypothetical drawer close. Nothing about the drawer is an
    // input to this calculation at all — which is the invariant that matters.
    const day = new Date();
    day.setHours(12, 0, 0, 0);
    const date = toISODate(day);
    const range = presetRange('today', day.getTime());
    const a = computeAnalytics(range, {
      ...emptyInput,
      salesTransactions: [tx('morning', date, 100, 40), tx('evening', date, 200, 80), tx('after-close', date, 300, 120)],
    }, day.getTime());

    expect(a.revenue).toBe(600);
    expect(a.grossProfit).toBe(240);
    expect(a.salesCount).toBe(3);
  });
});
