import { describe, it, expect } from 'vitest';
import { TimeEntry, TimeBreak, BreakReason } from '../types';
import {
  workedHours, workedMs, paidBreakMs, unpaidBreakMs, totalBreakMs, isPaidBreak,
  shiftHours, totalShiftHours, shiftHoursLabel, hoursInRange, periodPayFor, msToHours,
} from './timeclock';

// THE BUG: workedMs subtracted ALL break time unconditionally. This owner pays
// through lunch, so every staff member who honestly punched a lunch break was
// underpaid for it — the app quietly penalised the honest punch. Paid-ness is
// now decided PER BREAK by that break's own reason, which is what makes the
// realistic setup (lunch paid, personal and bank unpaid) work on one shift.

const H = 3_600_000;
const M = 60_000;
const NOON = 1_700_000_000_000;

const shift = (hours: number, breaks: TimeEntry['breaks'] = []): TimeEntry => ({
  id: 'e1', userId: 'u1', clockIn: NOON, clockOut: NOON + hours * H, breaks, createdAt: NOON,
});
// `reason` is optional here on purpose: omitting it models a legacy break
// written before reasons were captured, which must count as UNPAID.
const brk = (startMin: number, minutes: number, reason?: BreakReason): TimeBreak => ({
  id: `b-${startMin}-${reason || 'none'}`,
  start: NOON + startMin * M,
  end: NOON + (startMin + minutes) * M,
  reason,
} as unknown as TimeBreak);

const LUNCH_PAID: BreakReason[] = ['lunch'];

describe('the default — empty setting leaves hours EXACTLY as they are today', () => {
  const e = shift(8, [brk(120, 30, 'lunch'), brk(300, 15, 'bank')]);

  it('every break is still deducted when nothing is marked paid', () => {
    expect(workedHours(e, 0, [])).toBe(8 - 0.75);
  });

  it('omitting the argument entirely is identical to passing []', () => {
    // Every pre-existing call site passes nothing. They must not move.
    expect(workedHours(e, 0)).toBe(workedHours(e, 0, []));
    expect(workedMs(e, 0)).toBe(workedMs(e, 0, []));
  });

  it('a shift with no breaks is unaffected either way', () => {
    const plain = shift(8);
    expect(workedHours(plain, 0)).toBe(8);
    expect(workedHours(plain, 0, LUNCH_PAID)).toBe(8);
  });
});

describe('a shift mixing a PAID lunch and an UNPAID bank run', () => {
  // The realistic setup: 8 hours on the clock, 30 min lunch (paid),
  // 15 min bank run (unpaid).
  const e = shift(8, [brk(120, 30, 'lunch'), brk(300, 15, 'bank')]);

  it('pays through the lunch and deducts only the bank run', () => {
    expect(workedHours(e, 0, LUNCH_PAID)).toBe(8 - 0.25);
  });

  it('splits the break time into the two buckets', () => {
    expect(msToHours(paidBreakMs(e, 0, LUNCH_PAID))).toBe(0.5);
    expect(msToHours(unpaidBreakMs(e, 0, LUNCH_PAID))).toBe(0.25);
  });

  it('total break time is unchanged — the RECORD is the same, only the pay differs', () => {
    // Staff punch every break either way; that is the whole point.
    expect(totalBreakMs(e, 0)).toBe(45 * M);
    expect(paidBreakMs(e, 0, LUNCH_PAID) + unpaidBreakMs(e, 0, LUNCH_PAID)).toBe(totalBreakMs(e, 0));
  });

  it('the breakdown adds up to the time on the clock', () => {
    const h = shiftHours(e, 0, LUNCH_PAID);
    expect(h.worked).toBe(7.75);
    expect(h.paidBreak).toBe(0.5);
    expect(h.unpaidBreak).toBe(0.25);
    // worked already CONTAINS the paid break, so clock time = worked + unpaid.
    expect(h.worked + h.unpaidBreak).toBe(8);
  });

  it('marking both paid pays the whole shift', () => {
    expect(workedHours(e, 0, ['lunch', 'bank'])).toBe(8);
  });
});

describe('a break with NO reason recorded counts as UNPAID', () => {
  // The safe default, and exactly today's behaviour. Historical entries were
  // written before reasons were captured and carry none at all — treating
  // those as paid would silently start paying for time never agreed to.
  const e = shift(8, [brk(120, 30)]);

  it('is deducted even when reasons are marked paid', () => {
    expect(workedHours(e, 0, LUNCH_PAID)).toBe(7.5);
    expect(workedHours(e, 0, ['lunch', 'personal', 'bank', 'other'])).toBe(7.5);
  });

  it('isPaidBreak says so directly', () => {
    // `reason` is required on TimeBreak today, but breaks written before
    // reasons were captured have none at runtime — which is exactly the case
    // that must not be paid. Cast to model that legacy row honestly.
    expect(isPaidBreak({ id: 'x', start: 0 } as unknown as TimeBreak, LUNCH_PAID)).toBe(false);
    expect(isPaidBreak({ id: 'x', start: 0, reason: 'lunch' }, LUNCH_PAID)).toBe(true);
    expect(isPaidBreak({ id: 'x', start: 0, reason: 'bank' }, LUNCH_PAID)).toBe(false);
  });
});

describe('an UNENDED break keeps its clamp-to-shift-end behaviour', () => {
  it('an unended UNPAID break is still deducted up to the clock-out', () => {
    const e: TimeEntry = {
      ...shift(8), breaks: [{ id: 'b', start: NOON + 7 * H, reason: 'bank' }],
    };
    // Break runs 7h → 8h (the shift end), so 1h is deducted.
    expect(workedHours(e, 0, LUNCH_PAID)).toBe(7);
  });

  it('an unended PAID break is clamped the same way, then paid', () => {
    const e: TimeEntry = {
      ...shift(8), breaks: [{ id: 'b', start: NOON + 7 * H, reason: 'lunch' }],
    };
    expect(workedHours(e, 0, LUNCH_PAID)).toBe(8);
    expect(msToHours(paidBreakMs(e, 0, LUNCH_PAID))).toBe(1);
  });

  it('on a STILL-OPEN shift the break is clamped to `now`, not left unbounded', () => {
    const now = NOON + 3 * H;
    const open: TimeEntry = {
      id: 'e', userId: 'u1', clockIn: NOON, breaks: [{ id: 'b', start: NOON + 2 * H, reason: 'bank' }], createdAt: NOON,
    };
    expect(workedHours(open, now, LUNCH_PAID)).toBe(2);
  });
});

describe('several breaks of the SAME reason', () => {
  const e = shift(8, [brk(60, 15, 'lunch'), brk(180, 30, 'lunch'), brk(360, 15, 'lunch')]);

  it('are all paid, and sum correctly', () => {
    expect(workedHours(e, 0, LUNCH_PAID)).toBe(8);
    expect(msToHours(paidBreakMs(e, 0, LUNCH_PAID))).toBe(1);
  });

  it('are all deducted when the reason is not paid', () => {
    expect(workedHours(e, 0, [])).toBe(7);
  });
});

describe('the figure is explainable to the person being paid', () => {
  it('"8.00 hrs (incl. 0.50 hrs paid lunch, 0.75 hrs unpaid)"', () => {
    const h = { worked: 8, paidBreak: 0.5, unpaidBreak: 0.75 };
    expect(shiftHoursLabel(h, LUNCH_PAID)).toBe('8.00 hrs (incl. 0.50 hrs paid lunch, 0.75 hrs unpaid)');
  });

  it('says nothing extra when no break time is involved', () => {
    expect(shiftHoursLabel({ worked: 8, paidBreak: 0, unpaidBreak: 0 }, LUNCH_PAID)).toBe('8.00 hrs');
  });

  it('mentions only the half that applies', () => {
    expect(shiftHoursLabel({ worked: 8, paidBreak: 0.5, unpaidBreak: 0 }, LUNCH_PAID))
      .toBe('8.00 hrs (incl. 0.50 hrs paid lunch)');
    expect(shiftHoursLabel({ worked: 7.25, paidBreak: 0, unpaidBreak: 0.75 }, []))
      .toBe('7.25 hrs (0.75 hrs unpaid)');
  });

  it('totals the breakdown across several shifts', () => {
    const a = shift(8, [brk(120, 30, 'lunch')]);
    const b = { ...shift(8, [brk(120, 30, 'lunch'), brk(300, 15, 'bank')]), id: 'e2' };
    const t = totalShiftHours([a, b], 0, LUNCH_PAID);
    expect(t.worked).toBe(8 + 7.75);
    expect(t.paidBreak).toBe(1);
    expect(t.unpaidBreak).toBe(0.25);
  });
});

describe('it flows all the way through to pay', () => {
  const entries = [shift(8, [brk(120, 30, 'lunch'), brk(300, 15, 'bank')])];
  const period = { index: 0, start: NOON - H, end: NOON + 24 * H };

  it('hoursInRange respects the setting', () => {
    expect(hoursInRange(entries, 'u1', period.start, period.end, 0, LUNCH_PAID)).toBe(7.75);
    expect(hoursInRange(entries, 'u1', period.start, period.end, 0, [])).toBe(7.25);
  });

  it('the pay-period gross is computed off the paid hours', () => {
    const paid = periodPayFor(entries, 'u1', 20, period, 0, LUNCH_PAID);
    expect(paid.hours).toBe(7.75);
    expect(paid.gross).toBe(155);          // 7.75 × 20
    expect(paid.paidBreakHours).toBe(0.5);
    expect(paid.unpaidBreakHours).toBe(0.25);

    // Same shift, nothing marked paid — the old behaviour, unchanged.
    const unpaid = periodPayFor(entries, 'u1', 20, period, 0, []);
    expect(unpaid.hours).toBe(7.25);
    expect(unpaid.gross).toBe(145);
    expect(unpaid.paidBreakHours).toBe(0);
  });

  it('the difference is exactly the paid lunch — half an hour of pay per shift', () => {
    const withPaid = periodPayFor(entries, 'u1', 20, period, 0, LUNCH_PAID);
    const without = periodPayFor(entries, 'u1', 20, period, 0, []);
    expect(withPaid.gross - without.gross).toBe(10); // 0.5h × $20
  });
});
