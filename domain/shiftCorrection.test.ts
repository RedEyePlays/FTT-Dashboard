import { describe, it, expect } from 'vitest';
import {
  correctClockOut, isValidClockOutCorrection, isCorrectedEntry, isLongShift,
  payrollFlagsFor, payPeriodFor, isMissedClockOut, missedClockOuts, dayKey,
  DEFAULT_LONG_SHIFT_HOURS,
} from './timeclock';
import {
  fromZonedInput, toZonedInput, isoDateInZone, timeInZone, zoneCity,
  shopTimeNote, safeZone, deviceDiffersFromShop,
} from './shopTime';
import { AppUser, TimeEntry } from '../types';

/**
 * THE OVERNIGHT OUTAGE, AND THE THREE THINGS IT EXPOSED.
 *
 * The shop's internet dropped overnight and nobody's clock-out reached
 * Firebase. Next morning the screen read: Animesh 21.20 h open, Kritika
 * 24.56 h open, Sanchit 20.94 h CLOSED with a wrong clock-out. Real hours were
 * about 4.6, 7.7 and 6.5.
 *
 * The first two were fixable. Sanchit's was not: his shift had a clock-out, so
 * no correction control rendered for it anywhere in the app — a 14-hour
 * overstatement, roughly $245, with nothing flagging it.
 *
 * Meanwhile the owner was reading all of this from Dubai, eight hours ahead,
 * so every time on screen was eight hours out with nothing saying so.
 *
 *   1. a closed shift could not be corrected      → the wrench, and this file
 *   2. no timezone anywhere                       → domain/shopTime.ts
 *   3. nothing flagged an impossible shift        → isLongShift
 */

const at = (y: number, mo: number, d: number, h = 0, mi = 0): number =>
  new Date(y, mo, d, h, mi, 0, 0).getTime();

const entry = (p: Partial<TimeEntry> & { clockIn: number }): TimeEntry => ({
  id: 'e1', userId: 'u1', breaks: [], ...p,
});

const user = (p: Partial<AppUser> & { id: string }): AppUser =>
  ({ email: `${p.id}@shop.test`, role: 'employee', workspaceId: 'ws', ...p });

const HOUR = 3600_000;

/* ---------------- Gap 1: correcting a CLOSED shift ---------------- */

describe('a shift that already has a clock-out can be corrected', () => {
  // Sanchit's shift, as stored: clocked in 09:00, closed at a wrong 05:56 the
  // next morning — 20.94 h. The real clock-out was about 15:30.
  const wrong = entry({
    id: 'sanchit', userId: 'u3',
    clockIn: at(2026, 8, 28, 9, 0),
    clockOut: at(2026, 8, 29, 5, 56),
  });

  it('is a valid correction — nothing in the validator ever refused this', () => {
    // The restriction was only ever in the UI. isValidClockOutCorrection cares
    // about after-clock-in and not-in-future, and never about whether the
    // shift was open.
    const real = at(2026, 8, 28, 15, 30);
    expect(isValidClockOutCorrection(wrong, real, at(2026, 8, 29, 10, 0))).toBe(true);
  });

  it('appends to corrections, preserving the WRONG value in fromClockOut', () => {
    const real = at(2026, 8, 28, 15, 30);
    const fixed = correctClockOut(wrong, real, 'owner-uid', at(2026, 8, 29, 10, 0), {
      correctedByEmail: 'owner@shop.test',
    });

    expect(fixed.clockOut).toBe(real);
    expect(fixed.corrections).toHaveLength(1);
    const c = fixed.corrections![0];
    // The original is kept — this is the whole point of the history.
    expect(c.fromClockOut).toBe(wrong.clockOut);
    expect(c.toClockOut).toBe(real);
    expect(c.correctedBy).toBe('owner-uid');
    expect(c.correctedByEmail).toBe('owner@shop.test');
    expect(c.correctedAt).toBe(at(2026, 8, 29, 10, 0));
    expect(isCorrectedEntry(fixed)).toBe(true);
  });

  it('correcting TWICE leaves two records, not one', () => {
    // A second correction must not overwrite the first: the trail is the
    // record of who changed somebody's paid hours, and a trail that keeps only
    // the latest edit answers none of the questions it exists for.
    const once = correctClockOut(wrong, at(2026, 8, 28, 15, 30), 'mgr', at(2026, 8, 29, 10, 0));
    const twice = correctClockOut(once, at(2026, 8, 28, 15, 45), 'owner', at(2026, 8, 29, 11, 0));

    expect(twice.corrections).toHaveLength(2);
    expect(twice.corrections!.map(c => c.fromClockOut)).toEqual([
      wrong.clockOut,                // the original wrong value
      at(2026, 8, 28, 15, 30),        // what the first correction set
    ]);
    expect(twice.corrections!.map(c => c.correctedBy)).toEqual(['mgr', 'owner']);
    expect(twice.clockOut).toBe(at(2026, 8, 28, 15, 45));
  });

  it('still refuses a clock-out before clock-in, or in the future', () => {
    const now = at(2026, 8, 29, 10, 0);
    expect(isValidClockOutCorrection(wrong, at(2026, 8, 28, 8, 59), now)).toBe(false);  // before in
    expect(isValidClockOutCorrection(wrong, wrong.clockIn, now)).toBe(false);           // equal to in
    expect(isValidClockOutCorrection(wrong, now + HOUR, now)).toBe(false);              // future
    expect(isValidClockOutCorrection(wrong, NaN, now)).toBe(false);
    // The boundary: exactly `now` is allowed.
    expect(isValidClockOutCorrection(wrong, now, now)).toBe(true);
  });

  it('there is ONE validator — the closed case gets no second rule', () => {
    // An open and a closed entry with the same clock-in are judged identically;
    // a separate code path for closed shifts is how the two drift apart.
    const open = entry({ clockIn: wrong.clockIn });
    const now = at(2026, 8, 29, 10, 0);
    for (const t of [at(2026, 8, 28, 15, 30), at(2026, 8, 28, 8, 0), now + HOUR]) {
      expect(isValidClockOutCorrection(open, t, now)).toBe(isValidClockOutCorrection(wrong, t, now));
    }
  });
});

/* ---------------- Gap 2: shop time, not device time ---------------- */

const TORONTO = 'America/Toronto';
const DUBAI = 'Asia/Dubai';

describe('times render in the SHOP timezone, whatever device is reading', () => {
  // The instant Animesh clocked in: 13:22 on 29 Sep 2026, Toronto.
  const clockIn = fromZonedInput('2026-09-29T13:22', TORONTO);

  it('reads as shop time in Toronto AND from Dubai — the same instant', () => {
    expect(timeInZone(clockIn, TORONTO)).toBe('13:22');
    // What the owner's phone showed, and why the screen looked wrong.
    expect(timeInZone(clockIn, DUBAI)).toBe('21:22');
    // The fix: ask for shop time and get shop time, from either device.
    expect(toZonedInput(clockIn, TORONTO)).toBe('2026-09-29T13:22');
  });

  it('SHOP TIME AND DEVICE TIME FALL ON DIFFERENT DATES — the confusing case', () => {
    // 20:00 Toronto is already the next calendar day in Dubai. This is exactly
    // what made the correction box ask for a Sep 30 value directly under a
    // heading that said Sep 29: both were right, in different zones.
    const evening = fromZonedInput('2026-09-29T20:00', TORONTO);
    expect(isoDateInZone(evening, TORONTO)).toBe('2026-09-29');
    expect(isoDateInZone(evening, DUBAI)).toBe('2026-09-30');
    // The screen now dates it by the shop, so the heading and the input agree.
    expect(toZonedInput(evening, TORONTO).slice(0, 10)).toBe('2026-09-29');
  });

  it('a typed shop wall-clock time round-trips to the right instant', () => {
    // The delicate half: what the owner TYPES is what gets stored.
    const typed = fromZonedInput('2026-09-29T15:30', TORONTO);
    expect(toZonedInput(typed, TORONTO)).toBe('2026-09-29T15:30');
    // And it is a real instant, not a string — it is 8 hours from Dubai's.
    expect(timeInZone(typed, DUBAI)).toBe('23:30');
  });

  it('survives both DST transitions rather than landing an hour out', () => {
    for (const wall of ['2026-11-01T00:30', '2026-11-01T01:30', '2026-11-01T03:00', '2026-03-08T03:30']) {
      expect(toZonedInput(fromZonedInput(wall, TORONTO), TORONTO)).toBe(wall);
    }
    // The hour that does not exist on spring-forward morning has no instant to
    // map to. It resolves an hour earlier — stable, finite and still validated,
    // which is the most that can be said for a time that did not happen.
    expect(timeInZone(fromZonedInput('2026-03-08T02:30', TORONTO), TORONTO)).toBe('01:30');
  });

  it('a missed clock-out is judged on the SHOP\'s day, not the reader\'s', () => {
    // Clocked in 13:00 Toronto, still on shift at 17:00 Toronto the same day.
    // On a Dubai clock those are Sep 29 21:00 and Sep 30 01:00 — different
    // days — so every open shift read as "missed" to the one person able to
    // act on it.
    const open = entry({ clockIn: fromZonedInput('2026-09-29T13:00', TORONTO) });
    const now = fromZonedInput('2026-09-29T17:00', TORONTO);

    expect(isMissedClockOut(open, now, TORONTO)).toBe(false);
    expect(isMissedClockOut(open, now, DUBAI)).toBe(true);     // the false alarm
    expect(missedClockOuts([open], now, TORONTO)).toEqual([]);

    // A genuinely missed one is still caught in shop time.
    const nextDay = fromZonedInput('2026-09-30T09:00', TORONTO);
    expect(isMissedClockOut(open, nextDay, TORONTO)).toBe(true);
  });

  it('omitting the zone keeps the previous device-local behaviour exactly', () => {
    // Every existing caller passes no zone and must be unaffected.
    const open = entry({ clockIn: at(2026, 8, 29, 13, 0) });
    expect(isMissedClockOut(open, at(2026, 8, 29, 17, 0))).toBe(false);
    expect(isMissedClockOut(open, at(2026, 8, 30, 9, 0))).toBe(true);
    expect(dayKey(at(2026, 8, 29, 13, 0))).toBe(dayKey(at(2026, 8, 29, 13, 0), undefined));
  });

  it('an unusable stored zone falls back rather than throwing mid-render', () => {
    expect(safeZone('Not/AZone')).toBeUndefined();
    expect(safeZone('')).toBeUndefined();
    expect(safeZone(TORONTO)).toBe(TORONTO);
    // It must still produce something renderable.
    expect(isoDateInZone(Date.now(), 'Not/AZone')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(dayKey(Date.now(), 'Not/AZone')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('labels the zone in words a reader can act on', () => {
    expect(zoneCity(TORONTO)).toBe('Toronto');
    expect(zoneCity('America/New_York')).toBe('New York');
    expect(shopTimeNote(TORONTO)).toBe('all times in shop time — Toronto');
    // And says so plainly when there is no shop zone to show.
    expect(shopTimeNote(undefined)).toMatch(/no shop timezone is set/);
  });

  it('knows whether the device actually disagrees, so the extra line is not noise', () => {
    // Compared by reading, not by name: two names for the same offset are not
    // something to warn anybody about.
    expect(deviceDiffersFromShop(Date.now(), undefined)).toBe(false);
  });
});

/* ---------------- Gap 3: flagging an impossible shift ---------------- */

describe('a shift too long to be plausible is flagged', () => {
  const period = payPeriodFor(at(2026, 8, 28, 12));
  const now = at(2026, 8, 30, 12);
  const staff = [user({ id: 'u3', hourlyRate: 17 })];

  /** Sanchit's shift as it was stored: closed, wrong, 20.94 h. */
  const tooLong = entry({
    id: 'sanchit', userId: 'u3',
    clockIn: at(2026, 8, 28, 9, 0),
    clockOut: at(2026, 8, 29, 5, 56),
  });
  /** The same shift with its real clock-out: 6.5 h. */
  const normal = entry({
    id: 'normal', userId: 'u3',
    clockIn: at(2026, 8, 28, 9, 0),
    clockOut: at(2026, 8, 28, 15, 30),
  });

  it('appears in PayrollFlags; an ordinary shift does not', () => {
    expect(payrollFlagsFor([tooLong], staff, period, now).longShifts.map(e => e.id)).toEqual(['sanchit']);
    expect(payrollFlagsFor([normal], staff, period, now).longShifts).toEqual([]);
  });

  it('trips NONE of the three existing flags — which is why it got through', () => {
    // Not open, not corrected, and the user has a rate. This is the exact
    // shape that reached payout looking completely ordinary.
    const flags = payrollFlagsFor([tooLong], staff, period, now);
    expect(flags.missedClockOuts).toEqual([]);
    expect(flags.correctedEntries).toEqual([]);
    expect(flags.noRateUsers).toEqual([]);
    expect(flags.longShifts).toHaveLength(1);
  });

  it('measures PAID hours, so unpaid breaks pull a shift back under', () => {
    // 15 h clocked with a 2 h unpaid break is 13 paid hours — under 14, and
    // correctly not flagged, because the flag is about what is being paid.
    const withBreak = entry({
      id: 'brk', userId: 'u3',
      clockIn: at(2026, 8, 28, 6, 0), clockOut: at(2026, 8, 28, 21, 0),
      breaks: [{ id: 'b1', start: at(2026, 8, 28, 12, 0), end: at(2026, 8, 28, 14, 0), reason: 'lunch' }],
    });
    expect(isLongShift(withBreak, now, DEFAULT_LONG_SHIFT_HOURS)).toBe(false);
    // Paid through that same break, it is 15 h and IS flagged.
    expect(isLongShift(withBreak, now, DEFAULT_LONG_SHIFT_HOURS, ['lunch'])).toBe(true);
    expect(payrollFlagsFor([withBreak], staff, period, now, ['lunch']).longShifts.map(e => e.id)).toEqual(['brk']);
  });

  it('respects the shop\'s own threshold, and 0 turns it off', () => {
    expect(isLongShift(tooLong, now, 24)).toBe(false);     // a shop that runs long days
    expect(isLongShift(tooLong, now, 8)).toBe(true);
    expect(isLongShift(tooLong, now, 0)).toBe(false);      // off
    expect(isLongShift(tooLong, now, -1)).toBe(false);
    // Strictly greater than, so a shift exactly at the threshold is not flagged.
    expect(isLongShift(normal, now, 6.5)).toBe(false);
    expect(isLongShift(normal, now, 6.4)).toBe(true);
  });

  it('is INFORMATIONAL — it is a list of entries and nothing more', () => {
    // There is no blocking signal to find, because approval must stay possible:
    // somebody may genuinely have worked a long day. The flag carries entries
    // for a human to read, and PayrollFlags has no field that could stop
    // anything even if a caller wanted to.
    const flags = payrollFlagsFor([tooLong], staff, period, now);
    expect(Array.isArray(flags.longShifts)).toBe(true);
    expect(Object.keys(flags).sort()).toEqual(
      ['correctedEntries', 'longShifts', 'missedClockOuts', 'noRateUsers'],
    );
  });

  it('leaves the existing flags untouched', () => {
    const open = entry({ id: 'open1', userId: 'u3', clockIn: at(2026, 8, 28, 9) });
    const corrected = correctClockOut(
      entry({ id: 'c1', userId: 'u3', clockIn: at(2026, 8, 28, 9), clockOut: at(2026, 8, 28, 17) }),
      at(2026, 8, 28, 16), 'mgr', at(2026, 8, 28, 18),
    );
    const noRate = entry({ id: 'w1', userId: 'u9', clockIn: at(2026, 8, 28, 9), clockOut: at(2026, 8, 28, 17) });
    const flags = payrollFlagsFor(
      [open, corrected, noRate],
      [user({ id: 'u3', hourlyRate: 17 }), user({ id: 'u9' })],
      period, now,
    );
    expect(flags.missedClockOuts.map(e => e.id)).toEqual(['open1']);
    expect(flags.correctedEntries.map(e => e.id)).toEqual(['c1']);
    expect(flags.noRateUsers.map(u => u.id)).toEqual(['u9']);
    // The two closed shifts are ordinary and are not flagged as long. The OPEN
    // one is — it has been running since Sep 28 and `workedHours` counts an
    // open shift up to `now`, which is 51 h. That is right, and it is Animesh's
    // 21.20 h case exactly: a shift nobody closed keeps growing. It shows under
    // both flags, which is two true statements about one shift rather than a
    // duplicate.
    expect(flags.longShifts.map(e => e.id)).toEqual(['open1']);
  });

  it('defaults to 14 h when the caller passes no threshold at all', () => {
    expect(DEFAULT_LONG_SHIFT_HOURS).toBe(14);
    expect(payrollFlagsFor([tooLong], staff, period, now).longShifts).toHaveLength(1);
  });
});
