import { describe, it, expect } from 'vitest';
import { KioskStaff, TimeEntry, TimeBreak, BreakReason } from '../types';
import {
  punchRoster, punchStateFor, confirmLabel, fmtDuration, breakElapsedMs, canStepOut,
  isPunchableEntry, isStaleOpenShift, staleShiftLabel,
  initialPinAttempts, registerFailedPin, pinCooldownActive, pinErrorMessage,
  MAX_PIN_ATTEMPTS, PIN_COOLDOWN_MS, WRONG_PIN_MESSAGE,
  buildKioskClockIn, buildKioskClockOut, buildKioskStartBreak, buildKioskEndBreak,
  validateBreakEvolution, validateKioskWrite,
} from './kiosk';
import { workedHours, isOnBreak, isClockedIn } from './timeclock';
import { canAssignPin, canHaveKioskPin, isValidKioskPinFormat, KIOSK_PIN_LENGTH, isValidPinFormat } from './pin';
import { can, ROLE_PERMISSIONS } from '../services/rbac';
import { isPayrollStaff } from './timeclock';

// The iPad by the door. It must be able to do exactly two things — show who
// can punch, and record a punch — and nothing else, so that it is worthless if
// it is stolen.

const H = 3_600_000;
const M = 60_000;
const NOON = 1_700_000_000_000;

const person = (over: Partial<KioskStaff> = {}): KioskStaff => ({
  id: 'u1', uid: 'u1', displayName: 'Ali', workspaceId: 'ws', active: true,
  pinHash: 'h', pinSalt: 's', pinIterations: 1000, updatedAt: 1, ...over,
});
const shiftFor = (userId: string, over: Partial<TimeEntry> = {}): TimeEntry => ({
  id: `e-${userId}`, userId, clockIn: NOON, breaks: [], createdAt: NOON, ...over,
});

/* ---------------- Part 1: the kiosk role can do nothing else ---------------- */

describe('the kiosk role is a device, not a person', () => {
  it('holds NO permissions at all', () => {
    expect(ROLE_PERMISSIONS.kiosk).toEqual([]);
  });

  it('is refused every permission, including the profit tiers', () => {
    expect(can('kiosk', 'sales.complete')).toBe(false);
    expect(can('kiosk', 'inventory.add')).toBe(false);
    expect(can('kiosk', 'reports.view')).toBe(false);
    expect(can('kiosk', 'users.manage')).toBe(false);
    expect(can('kiosk', 'settings.manage')).toBe(false);
    expect(can('kiosk', 'reports.profit.summary', { allowProfit: true })).toBe(false);
    expect(can('kiosk', 'reports.profit.detailed', { allowProfit: true })).toBe(false);
  });

  it('does NOT hold timeclock.use — it has no shifts of its own', () => {
    // It punches for other people, authorised by their PIN and by the rules'
    // kiosk branch — never by a permission on the device account.
    expect(can('kiosk', 'timeclock.use')).toBe(false);
    expect(can('employee', 'timeclock.use')).toBe(true);
  });

  it('can never be given an app-unlock PIN, by anyone', () => {
    // Rank alone would have let it through (it sits below everyone); the
    // explicit refusal is what stops a shared device holding a session key.
    expect(canAssignPin('owner', 'kiosk')).toBe(false);
    expect(canAssignPin('manager', 'kiosk')).toBe(false);
    expect(canAssignPin('owner', 'employee')).toBe(true);
  });

  it('can never be given a punch PIN either — a device has no shifts', () => {
    expect(canHaveKioskPin('kiosk')).toBe(false);
    expect(canHaveKioskPin('employee')).toBe(true);
    expect(canHaveKioskPin('technician')).toBe(true);
    expect(canHaveKioskPin('owner')).toBe(true);
  });

  it('never counts as payroll staff', () => {
    expect(isPayrollStaff({ role: 'kiosk', disabled: false })).toBe(false);
    expect(isPayrollStaff({ role: 'employee', disabled: false })).toBe(true);
    expect(isPayrollStaff({ role: 'employee', disabled: true })).toBe(false);
  });
});

describe('the punch PIN is a SEPARATE credential from the unlock PIN', () => {
  it('is exactly 6 digits — longer, because it is typed in public', () => {
    expect(KIOSK_PIN_LENGTH).toBe(6);
    expect(isValidKioskPinFormat('123456')).toBe(true);
    expect(isValidKioskPinFormat('12345')).toBe(false);
    expect(isValidKioskPinFormat('1234567')).toBe(false);
    expect(isValidKioskPinFormat('12345a')).toBe(false);
  });

  it('a 4-digit code is a valid UNLOCK pin but never a valid punch PIN', () => {
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidKioskPinFormat('1234')).toBe(false);
  });
});

/* ---------------- Part 2: what the next tap does ---------------- */

describe('the roster', () => {
  it('shows active staff, alphabetically', () => {
    const list = [person({ uid: 'c', displayName: 'Zoe' }), person({ uid: 'a', displayName: 'Ali' })];
    expect(punchRoster(list).map(p => p.displayName)).toEqual(['Ali', 'Zoe']);
  });

  it('hides a deactivated person without needing their record deleted', () => {
    const list = [person({ uid: 'a', displayName: 'Ali' }), person({ uid: 'b', displayName: 'Gone', active: false })];
    expect(punchRoster(list).map(p => p.uid)).toEqual(['a']);
  });
});

describe('punchStateFor', () => {
  it('offers CLOCK IN when there is no open shift', () => {
    expect(punchStateFor('u1', [], NOON).action).toBe('clock_in');
  });

  it('offers CLOCK OUT on an open shift, with the hours so far', () => {
    const s = punchStateFor('u1', [shiftFor('u1')], NOON + 8 * H);
    expect(s.action).toBe('clock_out');
    expect(s.workedMsSoFar).toBe(8 * H);
  });

  it('offers only BACK FROM BREAK while on a break', () => {
    // Clocking out THROUGH a break would abandon it; coming back is the only
    // punch offered, so a break can never be left dangling.
    const open = shiftFor('u1', { breaks: [{ id: 'b', start: NOON + 2 * H, reason: 'lunch' }] });
    const s = punchStateFor('u1', [open], NOON + 3 * H);
    expect(s.action).toBe('end_break');
    expect(s.onBreakReason).toBe('lunch');
    expect(breakElapsedMs(s, NOON + 3 * H)).toBe(H);
    expect(canStepOut(s)).toBe(false);
  });

  it('a finished shift does not count as open', () => {
    const done = shiftFor('u1', { clockOut: NOON + 8 * H });
    expect(punchStateFor('u1', [done], NOON + 9 * H).action).toBe('clock_in');
  });

  it("reads only THIS person's shifts", () => {
    expect(punchStateFor('u1', [shiftFor('u2')], NOON).action).toBe('clock_in');
  });

  it('the hours so far honour the paid-break setting', () => {
    const open = shiftFor('u1', { breaks: [{ id: 'b', start: NOON + 2 * H, end: NOON + 2 * H + 30 * M, reason: 'lunch' }] });
    expect(punchStateFor('u1', [open], NOON + 8 * H, ['lunch']).workedMsSoFar).toBe(8 * H);
    expect(punchStateFor('u1', [open], NOON + 8 * H, []).workedMsSoFar).toBe(8 * H - 30 * M);
  });
});

describe('the confirm step says exactly what will happen', () => {
  it('names the person and the time on a clock-in', () => {
    const s = punchStateFor('u1', [], NOON);
    expect(confirmLabel(s, 'Ali', '10:04 AM', NOON)).toBe('Clock in Ali — 10:04 AM');
  });

  it('adds the hours worked on a clock-out', () => {
    const s = punchStateFor('u1', [shiftFor('u1')], NOON + 8 * H + 12 * M);
    expect(confirmLabel(s, 'Ali', '6:32 PM', NOON + 8 * H + 12 * M))
      .toBe('Clock out Ali — 6:32 PM · 8h 12m worked today');
  });

  it('formats a duration the way staff read it, not as a decimal', () => {
    expect(fmtDuration(8 * H + 12 * M)).toBe('8h 12m');
    expect(fmtDuration(42 * M)).toBe('42m');
    expect(fmtDuration(0)).toBe('0m');
  });
});

describe('stepping out is a BREAK, never a clock-out', () => {
  const open = shiftFor('u1');

  it('is offered only while on shift and not already on a break', () => {
    expect(canStepOut(punchStateFor('u1', [open], NOON + H))).toBe(true);
    expect(canStepOut(punchStateFor('u1', [], NOON))).toBe(false);
  });

  it('a day out and back stays ONE entry', () => {
    // This is the whole reason it is a break: two entries would fragment the
    // day and misstate the hours.
    const out = buildKioskStartBreak(open, 'b1', 'lunch', NOON + 4 * H);
    const back = buildKioskEndBreak(out, NOON + 4 * H + 30 * M);
    expect(back.id).toBe(open.id);
    expect(back.clockOut).toBeUndefined();
    expect(isClockedIn(back)).toBe(true);
    expect(back.breaks).toHaveLength(1);
    expect(back.breaks[0].reason).toBe('lunch');
    expect(back.breaks[0].end).toBe(NOON + 4 * H + 30 * M);
  });

  it('the whole round trip pays correctly under a paid lunch', () => {
    const out = buildKioskStartBreak(open, 'b1', 'lunch', NOON + 4 * H);
    const back = buildKioskEndBreak(out, NOON + 4 * H + 30 * M);
    const done = buildKioskClockOut(back, NOON + 8 * H);
    expect(workedHours(done, 0, ['lunch'])).toBe(8);
    expect(workedHours(done, 0, [])).toBe(7.5);
  });
});

describe('the punch records built for Firestore', () => {
  it('a clock-in is tagged as coming from the kiosk', () => {
    const e = buildKioskClockIn(person(), 'new-id', NOON);
    expect(e).toEqual({ id: 'new-id', userId: 'u1', clockIn: NOON, breaks: [], createdAt: NOON, source: 'kiosk' });
  });

  it('a clock-out closes a still-running break so it cannot run forever', () => {
    const open = shiftFor('u1', { breaks: [{ id: 'b', start: NOON + 2 * H, reason: 'bank' }] });
    const out = buildKioskClockOut(open, NOON + 8 * H);
    expect(out.clockOut).toBe(NOON + 8 * H);
    expect(out.breaks[0].end).toBe(NOON + 8 * H);
    expect(isOnBreak(out)).toBe(false);
  });

  it('every kiosk write carries source: kiosk, so a door punch is told apart from a phone punch', () => {
    const open = shiftFor('u1');
    expect(buildKioskClockIn(person(), 'i', NOON).source).toBe('kiosk');
    expect(buildKioskClockOut(open, NOON).source).toBe('kiosk');
    expect(buildKioskStartBreak(open, 'b', 'lunch', NOON).source).toBe('kiosk');
    expect(buildKioskEndBreak(open, NOON).source).toBe('kiosk');
  });

  it('never changes clockIn or userId on an update', () => {
    const open = shiftFor('u1');
    for (const next of [buildKioskClockOut(open, NOON + H), buildKioskStartBreak(open, 'b', 'lunch', NOON + H), buildKioskEndBreak(open, NOON + H)]) {
      expect(next.clockIn).toBe(open.clockIn);
      expect(next.userId).toBe(open.userId);
      expect(next.id).toBe(open.id);
    }
  });
});

describe('nobody fixes their hours at the iPad', () => {
  it("yesterday's still-open shift is refused, and sent to a manager", () => {
    const stale = shiftFor('u1', { clockIn: NOON - 30 * H });
    const s = punchStateFor('u1', [stale], NOON);
    expect(isPunchableEntry(stale, NOON)).toBe(false);
    expect(isStaleOpenShift(s, NOON)).toBe(true);
  });

  it("today's shift punches normally", () => {
    const open = shiftFor('u1');
    expect(isPunchableEntry(open, NOON + 8 * H)).toBe(true);
    expect(isStaleOpenShift(punchStateFor('u1', [open], NOON + 8 * H), NOON + 8 * H)).toBe(false);
  });

  it('a clock-in (no open shift) is never stale', () => {
    expect(isStaleOpenShift(punchStateFor('u1', [], NOON), NOON)).toBe(false);
  });
});

describe('wrong-PIN throttling, per DEVICE', () => {
  it('counts up to the limit, then starts a cooldown', () => {
    let s = initialPinAttempts;
    for (let i = 1; i < MAX_PIN_ATTEMPTS; i++) {
      s = registerFailedPin(s, NOON);
      expect(pinCooldownActive(s, NOON)).toBe(false);
    }
    s = registerFailedPin(s, NOON);
    expect(pinCooldownActive(s, NOON)).toBe(true);
    expect(pinCooldownActive(s, NOON + PIN_COOLDOWN_MS + 1)).toBe(false);
  });

  it('is per device, not per name — switching tiles does not reset it', () => {
    // A shared iPad is exactly where somebody sits and tries codes; per-name
    // counters would just be sidestepped by tapping a different tile.
    let s = initialPinAttempts;
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) s = registerFailedPin(s, NOON);
    expect(pinCooldownActive(s, NOON)).toBe(true);
  });

  it('NEVER reveals whether a name has a PIN set', () => {
    // The tiles are visible to anyone standing at the door, so a message like
    // "no PIN set for Ali" would be free reconnaissance. One message, always.
    expect(pinErrorMessage(initialPinAttempts, NOON)).toBe(WRONG_PIN_MESSAGE);
    expect(WRONG_PIN_MESSAGE).not.toMatch(/not set|no pin|unknown|exist/i);
  });

  it('the cooldown message counts down in seconds', () => {
    let s = initialPinAttempts;
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) s = registerFailedPin(s, NOON);
    expect(pinErrorMessage(s, NOON)).toContain('30 seconds');
  });
});

/* ---------------- A kiosk may not trim a break ---------------- */

describe('the breaks array may only ever grow', () => {
  // The kiosk credential lives on a tablet by the front door. The punch screen
  // only ever appends a break or ends the running one, but the WRITE permission
  // was wider than that: anybody holding the credential could shorten or delete
  // a break on today's entry and inflate paid hours for every unpaid reason.
  // These are the checks that close the gap on the way in.

  const lunch: TimeBreak = { id: 'b1', start: NOON + H, end: NOON + H + 30 * M, reason: 'lunch' };
  const bank: TimeBreak = { id: 'b2', start: NOON + 3 * H, end: NOON + 3 * H + 15 * M, reason: 'bank' };
  const running: TimeBreak = { id: 'b3', start: NOON + 5 * H, reason: 'personal' };

  it('accepts an unchanged list', () => {
    expect(validateBreakEvolution([lunch, bank], [lunch, bank])).toEqual({ ok: true, change: 'none' });
  });

  it('accepts one break appended', () => {
    const r = validateBreakEvolution([lunch], [lunch, { id: 'b9', start: NOON + 6 * H, reason: 'bank' }]);
    expect(r).toEqual({ ok: true, change: 'appended' });
  });

  it('accepts the end stamped on the last open break', () => {
    const r = validateBreakEvolution([lunch, running], [lunch, { ...running, end: NOON + 6 * H }]);
    expect(r).toEqual({ ok: true, change: 'ended' });
  });

  it('REJECTS a shrunk list — this is the whole point', () => {
    const r = validateBreakEvolution([lunch, bank], [lunch]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/shrank/);
  });

  it('REJECTS a reordered list even though the length matches', () => {
    const r = validateBreakEvolution([lunch, bank], [bank, lunch]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/identity or order/);
  });

  it('REJECTS shortening a break that was already recorded', () => {
    const trimmed = { ...lunch, end: lunch.end! - 20 * M };
    const r = validateBreakEvolution([lunch], [trimmed]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/end changed/);
  });

  it('REJECTS moving a break\'s start or changing its reason to a paid one', () => {
    expect(validateBreakEvolution([bank], [{ ...bank, reason: 'lunch' }]).ok).toBe(false);
    expect(validateBreakEvolution([bank], [{ ...bank, start: bank.start + 10 * M }]).ok).toBe(false);
  });

  it('REJECTS clearing an end to re-open a finished break', () => {
    const reopened = { ...lunch }; delete (reopened as { end?: number }).end;
    expect(validateBreakEvolution([lunch], [reopened]).ok).toBe(false);
  });

  it('REJECTS two changes in one write', () => {
    const r = validateBreakEvolution(
      [lunch, running],
      [lunch, { ...running, end: NOON + 6 * H }, { id: 'b4', start: NOON + 7 * H, reason: 'bank' }],
    );
    expect(r.ok).toBe(false);
  });

  it('REJECTS starting a break while one is already running', () => {
    const r = validateBreakEvolution([running], [running, { id: 'b4', start: NOON + 6 * H, reason: 'bank' }]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/already running/);
  });

  it('REJECTS back-filling a completed break at the door', () => {
    const r = validateBreakEvolution([], [lunch]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/must be open/);
  });

  it('REJECTS more than one break added at once', () => {
    const r = validateBreakEvolution([], [
      { id: 'x', start: NOON + H, reason: 'bank' },
      { id: 'y', start: NOON + 2 * H, reason: 'bank' },
    ]);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/at most one/);
  });
});

describe('every builder produces a legal evolution', () => {
  // The builders are the ONLY way a kiosk breaks array is produced — none of
  // them takes a caller-supplied array. This pins that property down so a
  // future edit that starts accepting one fails here.
  const open = shiftFor('u1', { breaks: [{ id: 'b1', start: NOON + H, end: NOON + H + 30 * M, reason: 'lunch' }] });

  it('starting a break', () => {
    expect(validateKioskWrite(open, buildKioskStartBreak(open, 'new', 'bank', NOON + 3 * H)))
      .toEqual({ ok: true, change: 'appended' });
  });

  it('ending a break', () => {
    const onBreak = buildKioskStartBreak(open, 'new', 'bank', NOON + 3 * H);
    expect(validateKioskWrite(onBreak, buildKioskEndBreak(onBreak, NOON + 4 * H)))
      .toEqual({ ok: true, change: 'ended' });
  });

  it('clocking out, which also closes the running break', () => {
    const onBreak = buildKioskStartBreak(open, 'new', 'bank', NOON + 3 * H);
    expect(validateKioskWrite(onBreak, buildKioskClockOut(onBreak, NOON + 4 * H)))
      .toEqual({ ok: true, change: 'ended' });
  });

  it('refuses a punch that moves the clock-in or re-opens a closed shift', () => {
    const closed = { ...open, clockOut: NOON + 8 * H };
    expect(validateKioskWrite(open, { ...open, clockIn: NOON - H }).ok).toBe(false);
    expect(validateKioskWrite(closed, { ...closed, clockOut: NOON + 9 * H }).ok).toBe(false);
    expect(validateKioskWrite(open, { ...open, userId: 'u2' }).ok).toBe(false);
  });
});

/* ---------------- A shift left open over a weekend ---------------- */

describe('a shift somebody never clocked out of on Friday', () => {
  // The read window is four days so the punch screen can SEE this. It still
  // refuses to touch it: firestore.rules allows a kiosk write only within the
  // last day, and the door iPad must never decide what somebody's hours were.
  const friday = NOON - 72 * H;
  const open = shiftFor('u1', { clockIn: friday });
  const state = punchStateFor('u1', [open], NOON);

  it('is recognised as stale rather than punchable', () => {
    expect(isStaleOpenShift(state, NOON)).toBe(true);
    expect(isPunchableEntry(open, NOON)).toBe(false);
  });

  it('NAMES the shift, so the person recognises which one it is', () => {
    const label = staleShiftLabel(state, ms => new Date(ms).toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }));
    expect(label).toMatch(/^You're still clocked in from .+\.$/);
  });

  it('says nothing when there is no open shift to describe', () => {
    expect(staleShiftLabel(punchStateFor('nobody', [], NOON), () => 'x')).toBeNull();
  });

  it('a shift from this morning is NOT stale — the punch goes through', () => {
    const today = punchStateFor('u1', [shiftFor('u1', { clockIn: NOON - 3 * H })], NOON);
    expect(isStaleOpenShift(today, NOON)).toBe(false);
  });
});
