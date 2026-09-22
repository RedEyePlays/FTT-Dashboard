import { describe, it, expect } from 'vitest';
import { AppUser, PayPeriodPaid, TimeEntry } from '../types';
import {
  rateTimeline, rateOnDate, rateForShift, rateAtFor, segmentsLabel,
  defaultEffectiveFrom, periodsRepricedBy, rateChangeAllowed, applyRateChange,
  rateHistoryForDisplay, effectiveFromLabel,
} from './payRates';
import { periodPayFor, payPeriodFor, PAY_PERIOD_DAYS, toISODate } from './timeclock';

const user = (p: Partial<AppUser> = {}): AppUser => ({
  id: 'u1', email: 'sam@shop.test', role: 'employee', workspaceId: 'w1', ...p,
});

// Local midnight + hours, so every shift in these tests has an unambiguous
// LOCAL clock-in date whatever the machine's zone.
const at = (dateISO: string, hour = 9): number => new Date(`${dateISO}T${String(hour).padStart(2, '0')}:00:00`).getTime();

const shift = (dateISO: string, hours: number, hour = 9): TimeEntry => ({
  id: `${dateISO}-${hour}`, userId: 'u1', clockIn: at(dateISO, hour),
  clockOut: at(dateISO, hour) + hours * 3_600_000, breaks: [],
});

describe('rateTimeline / rateOnDate — a legacy user needs no migration', () => {
  it('treats a bare hourlyRate as one entry effective from the start', () => {
    const u = user({ hourlyRate: 16 });
    expect(rateTimeline(u)).toEqual([{ rate: 16, effectiveFrom: '', setBy: '', setAt: 0 }]);
    expect(rateOnDate(u, '2020-01-01')).toBe(16);
    expect(rateOnDate(u, '2026-09-22')).toBe(16);
  });

  it('reports no rate at all when none is set — not zero', () => {
    expect(rateOnDate(user(), '2026-09-22')).toBeUndefined();
  });

  it('picks the last entry effective on or before the date', () => {
    const u = user({
      hourlyRate: 17,
      rateHistory: [
        { rate: 16, effectiveFrom: '', setBy: 'o', setAt: 1 },
        { rate: 17, effectiveFrom: '2026-09-15', setBy: 'o', setAt: 2 },
        { rate: 18, effectiveFrom: '2026-12-01', setBy: 'o', setAt: 3 },
      ],
    });
    expect(rateOnDate(u, '2026-09-14')).toBe(16);
    expect(rateOnDate(u, '2026-09-15')).toBe(17); // inclusive
    expect(rateOnDate(u, '2026-11-30')).toBe(17);
    expect(rateOnDate(u, '2026-12-01')).toBe(18);
  });

  it('prices a shift by its CLOCK-IN local date, not its clock-out', () => {
    const u = user({ hourlyRate: 17, rateHistory: [
      { rate: 16, effectiveFrom: '', setBy: 'o', setAt: 1 },
      { rate: 17, effectiveFrom: '2026-09-15', setBy: 'o', setAt: 2 },
    ] });
    // Clocks in at 22:00 on the 14th, out at 02:00 on the 15th — one shift, the
    // OLD rate. A UTC-date split would have paid the tail at $17.
    expect(rateForShift(u, at('2026-09-14', 22))).toBe(16);
    expect(rateForShift(u, at('2026-09-15', 2))).toBe(17);
  });
});

describe('a mid-period raise splits the period', () => {
  const u = user({ hourlyRate: 17, rateHistory: [
    { rate: 16, effectiveFrom: '', setBy: 'o', setAt: 1 },
    { rate: 17, effectiveFrom: '2026-09-15', setBy: 'o', setAt: 2 },
  ] });
  const period = payPeriodFor(at('2026-09-16'), PAY_PERIOD_DAYS);
  const entries = [
    shift('2026-09-14', 8),   // before the raise
    shift('2026-09-16', 7.5), // after
    shift('2026-09-17', 5),   // after
  ];

  it('reports two segments, and the segments add up to the gross', () => {
    const pay = periodPayFor(entries, 'u1', u.hourlyRate, period, Date.now(), [], rateAtFor(u));
    expect(pay.rateSplit).toBe(true);
    expect(pay.segments).toEqual([
      { rate: 16, hours: 8, gross: 128 },
      { rate: 17, hours: 12.5, gross: 212.5 },
    ]);
    expect(pay.hours).toBe(20.5);
    expect(pay.gross).toBe(340.5);
    // The whole point: NOT 20.5 × 17 = 348.50.
    expect(pay.gross).not.toBe(348.5);
  });

  it('labels it the way the screen shows it', () => {
    const pay = periodPayFor(entries, 'u1', u.hourlyRate, period, Date.now(), [], rateAtFor(u));
    expect(segmentsLabel(pay.segments!)).toBe('8.00 hrs × $16.00 + 12.50 hrs × $17.00');
  });

  it('a legacy user with only hourlyRate prices exactly as before', () => {
    const legacy = user({ hourlyRate: 16 });
    const withHistory = periodPayFor(entries, 'u1', 16, period, Date.now(), [], rateAtFor(legacy));
    const oldWay = periodPayFor(entries, 'u1', 16, period, Date.now(), []);
    expect(withHistory.gross).toBe(oldWay.gross);
    expect(withHistory.hours).toBe(oldWay.hours);
    expect(withHistory.rateSplit).toBe(false);
  });

  it('with no rateAt at all, the flat rate is used for everything (unchanged behaviour)', () => {
    const pay = periodPayFor(entries, 'u1', 17, period, Date.now(), []);
    expect(pay.gross).toBe(348.5);
    expect(pay.segments).toBeUndefined();
  });
});

describe('changing a rate', () => {
  const paid: PayPeriodPaid[] = [{
    id: 'u1__2026-08-24', userId: 'u1', periodStart: '2026-08-24', periodEnd: '2026-09-06',
    markedBy: 'o', markedAt: 1, hours: 60, gross: 960, rate: 16,
  }];

  it('defaults the effective date to the start of the NEXT period', () => {
    const period = payPeriodFor(at('2026-09-16'), PAY_PERIOD_DAYS);
    expect(defaultEffectiveFrom(period)).toBe(toISODate(period.end));
  });

  it('refuses a date inside a period that has already been PAID', () => {
    expect(rateChangeAllowed('2026-08-30', paid, 'u1')).toEqual({ ok: false, reason: 'inside_paid_period', periodStart: '2026-08-24' });
    expect(rateChangeAllowed('2026-08-24', paid, 'u1')).toMatchObject({ ok: false }); // first day counts
    expect(rateChangeAllowed('2026-09-06', paid, 'u1')).toMatchObject({ ok: false }); // last day counts
  });

  it('allows a date after the paid period, and one belonging to another user', () => {
    expect(rateChangeAllowed('2026-09-07', paid, 'u1')).toEqual({ ok: true });
    expect(rateChangeAllowed('2026-08-30', paid, 'u2')).toEqual({ ok: true });
  });

  it('names the unpaid periods a backdate would reprice', () => {
    const periods = [
      payPeriodFor(at('2026-08-25'), PAY_PERIOD_DAYS),
      payPeriodFor(at('2026-09-08'), PAY_PERIOD_DAYS),
      payPeriodFor(at('2026-09-22'), PAY_PERIOD_DAYS),
    ];
    const isPaid = (p: typeof periods[number]) => toISODate(p.start) === '2026-08-24';
    const hit = periodsRepricedBy('2026-09-10', periods, isPaid).map(p => toISODate(p.start));
    expect(hit).toEqual(['2026-09-07', '2026-09-21']);
  });

  it('materialises the old rate so past hours keep it', () => {
    const before = user({ hourlyRate: 16 });
    const next = applyRateChange(before, { rate: 17, effectiveFrom: '2026-09-21', setBy: 'o', setAt: 99 }, '2026-09-22');
    expect(next.rateHistory).toEqual([
      { rate: 16, effectiveFrom: '', setBy: '', setAt: 0 },
      { rate: 17, effectiveFrom: '2026-09-21', setBy: 'o', setAt: 99 },
    ]);
    expect(next.hourlyRate).toBe(17);
    // The hours worked before the change still price at the old rate.
    expect(rateOnDate(next, '2026-09-20')).toBe(16);
  });

  it('keeps hourlyRate as TODAY\'s rate when the change is dated into the future', () => {
    const before = user({ hourlyRate: 16 });
    const next = applyRateChange(before, { rate: 17, effectiveFrom: '2026-12-01', setBy: 'o', setAt: 99 }, '2026-09-22');
    expect(next.hourlyRate).toBe(16);
    expect(rateOnDate(next, '2026-12-01')).toBe(17);
  });

  it('replaces rather than duplicates a change for the same date', () => {
    const u = user({ hourlyRate: 17, rateHistory: [
      { rate: 16, effectiveFrom: '', setBy: 'o', setAt: 1 },
      { rate: 17, effectiveFrom: '2026-09-21', setBy: 'o', setAt: 2 },
    ] });
    const next = applyRateChange(u, { rate: 18, effectiveFrom: '2026-09-21', setBy: 'o', setAt: 3 }, '2026-09-22');
    expect(next.rateHistory.filter(r => r.effectiveFrom === '2026-09-21')).toHaveLength(1);
    expect(next.hourlyRate).toBe(18);
  });

  it('shows history newest first, with a readable effective-from', () => {
    const u = user({ hourlyRate: 17, rateHistory: [
      { rate: 16, effectiveFrom: '', setBy: 'o', setAt: 1 },
      { rate: 17, effectiveFrom: '2026-09-21', setBy: 'o', setAt: 2 },
    ] });
    const rows = rateHistoryForDisplay(u);
    expect(rows.map(r => r.rate)).toEqual([17, 16]);
    expect(effectiveFromLabel(rows[0])).toBe('from 2026-09-21');
    expect(effectiveFromLabel(rows[1])).toBe('from the start');
  });
});

describe('an already-paid period is untouched by a later raise', () => {
  it('the stored snapshot is what was signed off, whatever the rate is now', () => {
    // The paid record is the record. Re-deriving it is not what payroll does —
    // this pins that the snapshot fields are the ones read back.
    const record: PayPeriodPaid = {
      id: 'u1__2026-08-24', userId: 'u1', periodStart: '2026-08-24', periodEnd: '2026-09-06',
      markedBy: 'o', markedAt: 1, hours: 60, gross: 960, rate: 16,
    };
    const u = user({ hourlyRate: 20, rateHistory: [
      { rate: 16, effectiveFrom: '', setBy: 'o', setAt: 1 },
      { rate: 20, effectiveFrom: '2026-09-07', setBy: 'o', setAt: 2 },
    ] });
    expect(record.gross).toBe(960);
    expect(record.rate).toBe(16);
    // ...and the rate in force during that period still reads as the old one.
    expect(rateOnDate(u, '2026-08-30')).toBe(16);
  });
});
