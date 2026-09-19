import { KioskStaff, TimeEntry, BreakReason } from '../types';
import { isClockedIn, isOnBreak, openEntryFor, workedMs, msToHours, breakMs, shiftEnd, PaidBreakReasons } from './timeclock';

// The punch screen's decisions, kept pure so every branch is testable without
// a component, a device, or Firestore.
//
// Everything here is about WHAT the next tap should do. The punch itself
// reuses domain/timeclock.ts's helpers and the same Firestore writes as the
// in-app Time Clock — there is deliberately no second punch path.

/** Active staff, in a stable alphabetical order for the tile grid. */
export const punchRoster = (staff: KioskStaff[]): KioskStaff[] =>
  staff
    .filter(s => s.active)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

/**
 * What the person in front of the iPad can do right now.
 *
 *  • 'clock_in'   — no open shift.
 *  • 'clock_out'  — open shift, not on a break. "Step out" is also offered.
 *  • 'end_break'  — on a break. Coming back is the ONLY punch offered, so a
 *                   break can't be abandoned by clocking out through it.
 */
export type PunchAction = 'clock_in' | 'clock_out' | 'end_break';

export interface PunchState {
  action: PunchAction;
  open?: TimeEntry;
  /** The running break, when on one. */
  onBreakSince?: number;
  onBreakReason?: BreakReason;
  /** Paid ms worked on the open shift so far (0 when clocking in). */
  workedMsSoFar: number;
}

export const punchStateFor = (
  userId: string,
  entries: TimeEntry[],
  now: number,
  paidReasons: PaidBreakReasons = [],
): PunchState => {
  const open = openEntryFor(entries, userId);
  if (!open) return { action: 'clock_in', workedMsSoFar: 0 };
  const running = (open.breaks || []).find(b => b.end == null);
  return {
    action: running ? 'end_break' : 'clock_out',
    open,
    onBreakSince: running?.start,
    onBreakReason: running?.reason,
    workedMsSoFar: workedMs(open, now, paidReasons),
  };
};

/** Hours worked on the open shift so far, for the confirm step. */
export const punchWorkedHours = (s: PunchState): number => msToHours(s.workedMsSoFar);

/** "8h 12m" — how staff read a shift length, not "8.20". */
export const fmtDuration = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 60_000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/** How long the running break has lasted, for "Back from lunch · 42m". */
export const breakElapsedMs = (s: PunchState, now: number): number =>
  s.onBreakSince ? Math.max(0, now - s.onBreakSince) : 0;

/**
 * Stepping out is a BREAK on the open shift, never a clock-out. A day out and
 * back therefore stays ONE entry, which is what makes the hours add up and
 * what stops the payroll screen filling with fragments of a single day.
 */
export const canStepOut = (s: PunchState): boolean => s.action === 'clock_out';

/* ---------------- Wrong-PIN throttling ---------------- */
//
// Same shape as components/LockScreen.tsx's attempt limiting, applied to the
// whole DEVICE rather than to one name: a shared iPad is exactly where
// somebody would sit and try codes, and per-name counters would just be
// sidestepped by switching tiles between guesses.

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_COOLDOWN_MS = 30_000;

export interface PinAttemptState {
  attempts: number;
  cooldownUntil: number | null;
}

export const initialPinAttempts: PinAttemptState = { attempts: 0, cooldownUntil: null };

export const pinCooldownActive = (s: PinAttemptState, now: number): boolean =>
  !!s.cooldownUntil && now < s.cooldownUntil;

export const registerFailedPin = (s: PinAttemptState, now: number): PinAttemptState => {
  const attempts = s.attempts + 1;
  return attempts >= MAX_PIN_ATTEMPTS
    ? { attempts: 0, cooldownUntil: now + PIN_COOLDOWN_MS }
    : { attempts, cooldownUntil: null };
};

/**
 * The message shown after a wrong PIN.
 *
 * NEVER says whether the person has a PIN set, or whether the name exists —
 * the tile is visible to anyone standing at the door, so "no PIN set for Ali"
 * would be a free piece of reconnaissance. One message for every failure.
 */
export const WRONG_PIN_MESSAGE = 'That PIN didn\'t match. Try again.';

export const pinErrorMessage = (s: PinAttemptState, now: number): string => {
  if (pinCooldownActive(s, now)) {
    const secs = Math.ceil((s.cooldownUntil! - now) / 1000);
    return `Too many incorrect attempts. Try again in ${secs} second${secs === 1 ? '' : 's'}.`;
  }
  return WRONG_PIN_MESSAGE;
};

/* ---------------- Building the punch ---------------- */
//
// These return the record to WRITE. They are the same shapes App.tsx's
// handleClockIn/handleClockOut/handleStartBreak/handleEndBreak produce — the
// only addition is `source: 'kiosk'`, so a door punch and a phone punch are
// told apart later in the Time Clock view and the audit log.

export const buildKioskClockIn = (
  person: Pick<KioskStaff, 'uid'>, id: string, now: number,
): TimeEntry => ({
  id, userId: person.uid, clockIn: now, breaks: [], createdAt: now, source: 'kiosk',
});

export const buildKioskClockOut = (open: TimeEntry, now: number): TimeEntry => ({
  ...open,
  // Close any still-running break at clock-out so it can't run forever —
  // identical to the in-app path.
  breaks: (open.breaks || []).map(b => (b.end == null ? { ...b, end: now } : b)),
  clockOut: now,
  source: 'kiosk',
});

export const buildKioskStartBreak = (
  open: TimeEntry, breakId: string, reason: BreakReason, now: number,
): TimeEntry => ({
  ...open,
  breaks: [...(open.breaks || []), { id: breakId, start: now, reason }],
  source: 'kiosk',
});

export const buildKioskEndBreak = (open: TimeEntry, now: number): TimeEntry => ({
  ...open,
  breaks: (open.breaks || []).map(b => (b.end == null ? { ...b, end: now } : b)),
  source: 'kiosk',
});

/**
 * A punch may only ever touch TODAY's shift — the same rule firestore.rules
 * enforces server-side (withinLastDay). Checked here too so the screen refuses
 * rather than firing a write it knows will be rejected, and so the reason
 * shown to the person is a sentence instead of a permission error.
 */
export const DAY_MS = 86_400_000;
export const isPunchableEntry = (e: TimeEntry, now: number): boolean =>
  isClockedIn(e) && now - e.clockIn < DAY_MS;

/**
 * A shift left open from a previous day. Nobody fixes their hours at the
 * iPad, so the screen says so and sends them to a manager rather than
 * silently clocking out a 30-hour shift.
 */
export const isStaleOpenShift = (s: PunchState, now: number): boolean =>
  !!s.open && !isPunchableEntry(s.open, now);

/** Wording for the confirm step, so the screen and the tests agree on it. */
export const confirmLabel = (
  s: PunchState, name: string, timeLabel: string, now: number,
): string => {
  if (s.action === 'clock_in') return `Clock in ${name} — ${timeLabel}`;
  if (s.action === 'end_break') return `Back from break — ${name}`;
  return `Clock out ${name} — ${timeLabel} · ${fmtDuration(s.workedMsSoFar)} worked today`;
};

export { isClockedIn, isOnBreak, breakMs, shiftEnd };
