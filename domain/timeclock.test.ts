import { describe, it, expect } from 'vitest';
import {
  workedMs, workedHours, totalBreakMs, breakMs, shiftEnd,
  isClockedIn, isOnBreak, openEntryFor,
  msToHours, HOUR_MS, grossPay, round2,
  payPeriodFor, recentPayPeriods, periodEndInclusive, PAY_PERIOD_DAYS,
  dayRange, weekRange, hoursInRange, periodPayFor, paidKey, entriesOnDate, toISODate,
} from './timeclock';
import { TimeEntry, TimeBreak } from '../types';

// Build timestamps with the LOCAL Date constructor so they line up with the
// local-time helpers (startOfDay, payPeriodFor, …) regardless of the CI timezone.
const at = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  new Date(y, mo, d, h, mi, 0, 0).getTime();

const brk = (start: number, end: number | undefined, reason: TimeBreak['reason'] = 'lunch'): TimeBreak =>
  ({ id: `b${start}`, start, end, reason });

const entry = (p: Partial<TimeEntry> & { clockIn: number }): TimeEntry => ({
  id: 'e1', userId: 'u1', breaks: [], ...p,
});

describe('shift state', () => {
  it('isClockedIn is true until there is a clock-out', () => {
    expect(isClockedIn(entry({ clockIn: at(2024, 5, 10, 9) }))).toBe(true);
    expect(isClockedIn(entry({ clockIn: at(2024, 5, 10, 9), clockOut: at(2024, 5, 10, 17) }))).toBe(false);
  });

  it('isOnBreak only while clocked in with an open break', () => {
    const onBreak = entry({ clockIn: at(2024, 5, 10, 9), breaks: [brk(at(2024, 5, 10, 12), undefined)] });
    expect(isOnBreak(onBreak)).toBe(true);
    const ended = entry({ clockIn: at(2024, 5, 10, 9), breaks: [brk(at(2024, 5, 10, 12), at(2024, 5, 10, 12, 30))] });
    expect(isOnBreak(ended)).toBe(false);
    // An open break on an already-clocked-out shift doesn't count as "on break".
    const clockedOut = entry({ clockIn: at(2024, 5, 10, 9), clockOut: at(2024, 5, 10, 17), breaks: [brk(at(2024, 5, 10, 12), undefined)] });
    expect(isOnBreak(clockedOut)).toBe(false);
  });

  it('openEntryFor finds the one open shift per user', () => {
    const entries = [
      entry({ id: 'a', userId: 'u1', clockIn: at(2024, 5, 9, 9), clockOut: at(2024, 5, 9, 17) }),
      entry({ id: 'b', userId: 'u1', clockIn: at(2024, 5, 10, 9) }),
      entry({ id: 'c', userId: 'u2', clockIn: at(2024, 5, 10, 9) }),
    ];
    expect(openEntryFor(entries, 'u1')?.id).toBe('b');
    expect(openEntryFor(entries, 'u2')?.id).toBe('c');
    expect(openEntryFor(entries, 'nobody')).toBeUndefined();
  });
});

describe('workedMs', () => {
  it('is (clockOut - clockIn) minus breaks', () => {
    // 09:00 → 17:00 = 8h, minus a 30-min lunch = 7.5h worked.
    const e = entry({
      clockIn: at(2024, 5, 10, 9),
      clockOut: at(2024, 5, 10, 17),
      breaks: [brk(at(2024, 5, 10, 12), at(2024, 5, 10, 12, 30))],
    });
    expect(totalBreakMs(e, 0)).toBe(30 * 60_000);
    expect(workedHours(e, 0)).toBe(7.5);
  });

  it('excludes break time from the paid total (multiple breaks)', () => {
    const e = entry({
      clockIn: at(2024, 5, 10, 9),
      clockOut: at(2024, 5, 10, 17),
      breaks: [
        brk(at(2024, 5, 10, 12), at(2024, 5, 10, 12, 30)),
        brk(at(2024, 5, 10, 15), at(2024, 5, 10, 15, 15)),
      ],
    });
    expect(workedHours(e, 0)).toBe(8 - 0.75); // 7.25h
  });

  it('EDGE: a shift that crosses midnight counts the full span', () => {
    // 23:00 → 02:00 next day = 3h. Never negative, never split.
    const e = entry({ clockIn: at(2024, 5, 10, 23), clockOut: at(2024, 5, 11, 2) });
    expect(workedHours(e, 0)).toBe(3);
  });

  it('EDGE: forgot to clock out — accrues up to `now`, not lost', () => {
    const clockIn = at(2024, 5, 10, 9);
    const now = clockIn + 2 * HOUR_MS;
    const e = entry({ clockIn }); // no clockOut
    expect(isClockedIn(e)).toBe(true);
    expect(shiftEnd(e, now)).toBe(now);
    expect(workedHours(e, now)).toBe(2);
  });

  it('EDGE: started a break and forgot to end it before clocking out', () => {
    // In 09:00, break starts 10:00 (never ended), clocked out 12:00.
    // The break clamps to the clock-out, so 10:00→12:00 is break; only
    // 09:00→10:00 (1h) is paid.
    const e = entry({
      clockIn: at(2024, 5, 10, 9),
      clockOut: at(2024, 5, 10, 12),
      breaks: [brk(at(2024, 5, 10, 10), undefined)],
    });
    expect(breakMs(e.breaks[0], e.clockOut!)).toBe(2 * HOUR_MS);
    expect(workedHours(e, 0)).toBe(1);
  });

  it('EDGE: open break on a still-open shift clamps to `now`', () => {
    const clockIn = at(2024, 5, 10, 9);
    const breakStart = clockIn + 1 * HOUR_MS;
    const now = clockIn + 3 * HOUR_MS;
    const e = entry({ clockIn, breaks: [brk(breakStart, undefined)] });
    // worked = 3h elapsed − 2h still-running break = 1h.
    expect(workedHours(e, now)).toBe(1);
  });

  it('never returns negative worked time from a malformed entry', () => {
    const e = entry({ clockIn: at(2024, 5, 10, 17), clockOut: at(2024, 5, 10, 9) });
    expect(workedMs(e, 0)).toBe(0);
  });
});

describe('grossPay', () => {
  it('is hours × rate rounded to cents', () => {
    expect(grossPay(7.5, 20)).toBe(150);
    expect(grossPay(7.33, 18.5)).toBe(round2(7.33 * 18.5));
  });
  it('treats a missing/negative rate or negative hours as zero', () => {
    expect(grossPay(8, undefined)).toBe(0);
    expect(grossPay(8, -5)).toBe(0);
    expect(grossPay(-8, 20)).toBe(0);
  });
});

describe('day / week ranges', () => {
  it('dayRange is a 24h window starting at local midnight', () => {
    const now = at(2024, 5, 10, 14, 30);
    const { start, end } = dayRange(now);
    expect(start).toBe(at(2024, 5, 10));
    expect(end).toBe(at(2024, 5, 11));
    expect(now).toBeGreaterThanOrEqual(start);
    expect(now).toBeLessThan(end);
  });

  it('weekRange starts on Monday and spans 7 days', () => {
    // 2024-06-12 is a Wednesday; the week should start Monday 2024-06-10.
    const now = at(2024, 5, 12, 10);
    const { start, end } = weekRange(now);
    expect(new Date(start).getDay()).toBe(1); // Monday
    expect(start).toBe(at(2024, 5, 10));
    expect(end).toBe(at(2024, 5, 17));
  });
});

describe('hoursInRange', () => {
  const now = at(2024, 5, 12, 18); // Wednesday evening
  const entries: TimeEntry[] = [
    entry({ id: 'mon', userId: 'u1', clockIn: at(2024, 5, 10, 9), clockOut: at(2024, 5, 10, 17) }),  // 8h Mon
    entry({ id: 'tue', userId: 'u1', clockIn: at(2024, 5, 11, 9), clockOut: at(2024, 5, 11, 13) }),  // 4h Tue
    entry({ id: 'wed', userId: 'u1', clockIn: at(2024, 5, 12, 8), clockOut: at(2024, 5, 12, 12) }),  // 4h Wed (today)
    entry({ id: 'other', userId: 'u2', clockIn: at(2024, 5, 12, 8), clockOut: at(2024, 5, 12, 16) }), // other user
  ];

  it("sums only the target user's shifts within the window", () => {
    const day = dayRange(now);
    expect(hoursInRange(entries, 'u1', day.start, day.end, now)).toBe(4); // just today's shift
    const week = weekRange(now);
    expect(hoursInRange(entries, 'u1', week.start, week.end, now)).toBe(16); // 8 + 4 + 4
    expect(hoursInRange(entries, 'u2', week.start, week.end, now)).toBe(8);
  });

  it('buckets a midnight-crossing shift by its clock-in day', () => {
    const overnight = entry({ id: 'ov', userId: 'u1', clockIn: at(2024, 5, 10, 23), clockOut: at(2024, 5, 11, 2) });
    const monday = dayRange(at(2024, 5, 10, 12));
    const tuesday = dayRange(at(2024, 5, 11, 12));
    expect(hoursInRange([overnight], 'u1', monday.start, monday.end, now)).toBe(3); // counted on Monday
    expect(hoursInRange([overnight], 'u1', tuesday.start, tuesday.end, now)).toBe(0); // not on Tuesday
  });

  it('entriesOnDate returns the clock-in-day shifts, earliest first', () => {
    const day = toISODate(at(2024, 5, 12, 0));
    const rows = entriesOnDate(entries, day);
    expect(rows.map(e => e.id)).toEqual(['wed', 'other']); // both u1 + u2 shifts that day, sorted by clock-in
    // an overnight shift is listed on its clock-in day, not the day it ends
    const overnight = entry({ id: 'ov', userId: 'u1', clockIn: at(2024, 5, 10, 23), clockOut: at(2024, 5, 11, 2) });
    expect(entriesOnDate([overnight], toISODate(at(2024, 5, 10, 0))).map(e => e.id)).toEqual(['ov']);
    expect(entriesOnDate([overnight], toISODate(at(2024, 5, 11, 0)))).toEqual([]);
  });
});

describe('pay periods', () => {
  it('are contiguous and non-overlapping (end is exclusive == next start)', () => {
    const p1 = payPeriodFor(at(2024, 5, 10, 12));
    const p2 = payPeriodFor(p1.end); // a timestamp exactly on the boundary
    expect(p2.start).toBe(p1.end);       // no gap
    expect(p2.index).toBe(p1.index + 1); // next period
    // The last instant of p1 still resolves to p1.
    const backInP1 = payPeriodFor(p1.end - 1);
    expect(backInP1.index).toBe(p1.index);
    expect(backInP1.start).toBe(p1.start);
  });

  it('are exactly PAY_PERIOD_DAYS long', () => {
    const p = payPeriodFor(at(2024, 5, 10, 12));
    expect(Math.round((p.end - p.start) / 86_400_000)).toBe(PAY_PERIOD_DAYS);
    expect(periodEndInclusive(p)).toBe(p.end - 86_400_000);
  });

  it('EDGE: a boundary shift lands in exactly one period, never both', () => {
    const p1 = payPeriodFor(at(2024, 5, 10, 12));
    const p2 = payPeriodFor(p1.end);
    // A shift clocked in at the exact boundary belongs to p2, not p1.
    const boundaryShift = entry({ userId: 'u1', clockIn: p1.end, clockOut: p1.end + 4 * HOUR_MS });
    expect(hoursInRange([boundaryShift], 'u1', p1.start, p1.end, boundaryShift.clockOut!)).toBe(0);
    expect(hoursInRange([boundaryShift], 'u1', p2.start, p2.end, boundaryShift.clockOut!)).toBe(4);
  });

  it('recentPayPeriods returns contiguous windows, newest first', () => {
    const now = at(2024, 5, 20, 12);
    const periods = recentPayPeriods(now, 3);
    expect(periods).toHaveLength(3);
    expect(periods[0]).toEqual(payPeriodFor(now));
    // Each older period sits immediately before the newer one.
    expect(periods[1].end).toBe(periods[0].start);
    expect(periods[2].end).toBe(periods[1].start);
    expect(periods[1].index).toBe(periods[0].index - 1);
  });
});

describe('periodPayFor', () => {
  it('aggregates a user’s hours in the period and computes gross that reconciles', () => {
    const period = payPeriodFor(at(2024, 5, 10, 12));
    const entries: TimeEntry[] = [
      entry({ id: '1', userId: 'u1', clockIn: at(2024, 5, 10, 9), clockOut: at(2024, 5, 10, 17), breaks: [brk(at(2024, 5, 10, 12), at(2024, 5, 10, 12, 30))] }), // 7.5h
      entry({ id: '2', userId: 'u1', clockIn: at(2024, 5, 11, 9), clockOut: at(2024, 5, 11, 14) }), // 5h
      entry({ id: '3', userId: 'u2', clockIn: at(2024, 5, 11, 9), clockOut: at(2024, 5, 11, 17) }), // other user, excluded
    ];
    const pay = periodPayFor(entries, 'u1', 20, period, at(2024, 5, 12, 0));
    expect(pay.hours).toBe(12.5);
    expect(pay.rate).toBe(20);
    expect(pay.gross).toBe(250);
    expect(pay.gross).toBe(round2(pay.hours * pay.rate)); // shown hours × rate == gross
  });

  it('excludes shifts from an adjacent period', () => {
    const p1 = payPeriodFor(at(2024, 5, 3, 12));
    const inNext = entry({ userId: 'u1', clockIn: p1.end + 3 * HOUR_MS, clockOut: p1.end + 7 * HOUR_MS });
    const pay = periodPayFor([inNext], 'u1', 25, p1, p1.end + 8 * HOUR_MS);
    expect(pay.hours).toBe(0);
    expect(pay.gross).toBe(0);
  });
});

describe('paidKey', () => {
  it('is stable per user + period start (idempotent id)', () => {
    expect(paidKey('u1', '2024-06-10')).toBe('u1__2024-06-10');
    expect(paidKey('u1', '2024-06-10')).toBe(paidKey('u1', '2024-06-10'));
    expect(paidKey('u2', '2024-06-10')).not.toBe(paidKey('u1', '2024-06-10'));
  });
});

describe('msToHours', () => {
  it('converts exactly', () => {
    expect(msToHours(HOUR_MS)).toBe(1);
    expect(msToHours(90 * 60_000)).toBe(1.5);
  });
});
