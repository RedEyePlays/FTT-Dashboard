import { KioskStaff, TimeEntry, TimeBreak, BreakReason } from '../types';
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

/* ---------------- WHICH STORE THIS IPAD IS ---------------- */
//
// Multi-store stage 3. The punch screen must know which shop it is standing
// in, because every clock-in it takes is stamped with that answer.
//
// WHERE THE ANSWER COMES FROM: the kiosk's OWN DEVICE ACCOUNT —
// `users/{kioskUid}.kioskLocationId`, set by the owner in Users. Not from the
// person punching (staff work both stores and must not be choosing), and not
// from anything the device itself can edit: firestore.rules lets only the
// owner write that field, and the kiosk's own self-update branch is limited to
// `lastLogin`/`notifSeenTs`. So the binding is the device's, a staff member at
// the door cannot change it, and it survives reloads and the iPad being shut
// overnight — it rides in the same persistent IndexedDB cache that already
// lets the kiosk punch with the wifi down.
//
// IT IS RESOLVED FROM THE DEVICE ALONE, AND THAT IS DELIBERATE. The kiosk
// subscribes to exactly two collections (the punch roster and a bounded window
// of time entries) and this stage does not make it three: a device by the
// front door is unattended, shared and stealable, so the less it holds the
// better. The store NAME is therefore denormalized onto the device account
// beside the id, which costs one trade-off, stated plainly: rename a store and
// the iPad keeps showing the old name until the owner re-saves that device's
// store. The id — the thing actually stamped on hours — is never stale, and
// the owner's own Users screen checks the pair against the live store list
// (see kioskStoreIssue below), where the list IS readable.
//
// AN UNCONFIGURED KIOSK REFUSES TO PUNCH. It does NOT fall back to the default
// store: silently filing Mississauga's first week into Brampton would go
// unnoticed until payroll, while a kiosk that will not punch is a visible
// problem somebody fixes in a minute. firestore.rules refuses the write too,
// so this is not merely a screen being polite.
//
// A workspace with no stores at all is in the same position: its kiosk waits
// to be told. That is a deliberate choice over the alternative — a device that
// cannot tell "this shop has one shop" from "nobody has configured me" and
// guesses — and the on-screen message says exactly what to do about it.

export interface KioskStore {
  /** The store to stamp on a punch. '' whenever punching is not allowed. */
  locationId: string;
  /** What the screen shows, large: the shop this iPad is standing in. */
  name: string;
  /** False blocks every punch. */
  ready: boolean;
}

/** The device fields this resolution reads, and nothing else. */
export type KioskDevice = { kioskLocationId?: string; kioskLocationName?: string };

export const kioskStoreFor = (device: KioskDevice | null | undefined): KioskStore => {
  const locationId = (device?.kioskLocationId || '').trim();
  if (!locationId) return { locationId: '', name: '', ready: false };
  return {
    locationId,
    // Falls back to a neutral label rather than an empty header: an older
    // device record may carry the id without the denormalized name.
    name: (device?.kioskLocationName || '').trim() || 'this store',
    ready: true,
  };
};

/** What to tell whoever is standing in front of a kiosk that will not punch. */
export const KIOSK_NOT_SET_MESSAGE =
  'This iPad has not been told which store it is in, so it cannot record hours yet — '
  + 'they would be filed against the wrong shop. Please get the owner: it takes a minute '
  + 'in Settings \u2192 Users \u2192 Clock-in kiosk.';

/**
 * THE OWNER'S SIDE of the same question, checked against the live store list.
 *
 * Run where the list is readable — the Users screen — so the owner sees a
 * device pointing at a store that has been closed or that no longer exists,
 * and a device still showing a store's old name. The kiosk itself cannot
 * perform these checks (it does not read the store list, on purpose), which is
 * exactly why they are surfaced to the person who can fix them.
 */
export type KioskStoreIssue = 'not-set' | 'unknown-store' | 'closed-store' | 'stale-name';

export const kioskStoreIssue = (
  device: KioskDevice | null | undefined,
  locations: { id: string; name: string; active: boolean }[],
): KioskStoreIssue | null => {
  const id = (device?.kioskLocationId || '').trim();
  if (!id) return 'not-set';
  const found = (locations || []).find(l => l.id === id);
  if (!found) return 'unknown-store';
  if (!found.active) return 'closed-store';
  if ((device?.kioskLocationName || '') !== found.name) return 'stale-name';
  return null;
};

export const KIOSK_STORE_ISSUE_MESSAGE: Record<KioskStoreIssue, string> = {
  'not-set': 'No store set — this iPad will refuse to record hours until you set one.',
  'unknown-store': 'Set to a store that no longer exists. This iPad will refuse to record hours.',
  'closed-store': 'Set to a closed store. Pick the store it is actually standing in.',
  'stale-name': 'The store was renamed since this iPad was set up. Re-save its store so the punch screen shows the new name — hours are already being recorded against the right store.',
};

/* ---------------- Building the punch ---------------- */
//
// These return the record to WRITE. They are the same shapes App.tsx's
// handleClockIn/handleClockOut/handleStartBreak/handleEndBreak produce — the
// only addition is `source: 'kiosk'`, so a door punch and a phone punch are
// told apart later in the Time Clock view and the audit log.

/**
 * `locationId` IS THE KIOSK'S, not the person's (multi-store stage 3).
 *
 * Stamped here, at clock-in, and nowhere else: the clock-out and break
 * builders below simply carry whatever the shift already holds, so a device
 * reconfigured mid-shift cannot rewrite where that shift happened. Omitted
 * entirely in a workspace with no stores, which behaves exactly as before.
 *
 * `locationSource: 'kiosk'` records that a DEVICE vouched for it — a kiosk
 * cannot change which store it claims to be (firestore.rules), so it is
 * evidence in a way an app punch is not.
 */
export const buildKioskClockIn = (
  person: Pick<KioskStaff, 'uid'>, id: string, now: number, locationId?: string,
): TimeEntry => ({
  id, userId: person.uid, clockIn: now, breaks: [], createdAt: now, source: 'kiosk',
  ...(locationId ? { locationId, locationSource: 'kiosk' as const } : {}),
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

/* ---------------- The breaks array may only ever GROW ---------------- */
//
// A kiosk write is allowed to touch `breaks`, and firestore.rules can only
// check the coarse half of that (the list never gets shorter) because rules
// cannot deep-compare array contents. The real integrity check lives here,
// next to the builders that produce the array in the first place.
//
// What this stops: anybody holding the kiosk credential trimming or deleting a
// break on today's entry, which would inflate paid hours for every unpaid
// break reason. The door UI never does that — the permission was simply wider
// than the intent, and this closes the gap on the way in.
//
// The builders above are the ONLY way a kiosk breaks array is produced: each
// one is `existing breaks` + at most one change. None of them accepts a
// caller-supplied array, and `validateBreakEvolution` re-checks that property
// on the value about to be written, so a mutated object in between is caught.

export type BreakEvolution =
  | { ok: true; change: 'none' | 'appended' | 'ended' }
  | { ok: false; reason: string };

const sameBreakExceptEnd = (a: TimeBreak, b: TimeBreak): boolean =>
  a.id === b.id && a.start === b.start && a.reason === b.reason && a.note === b.note;

/**
 * Is `next` a legal evolution of `prev`?
 *
 * Legal: identical; one break appended (open, and only when nothing else is
 * open); or the end stamped on the one already-open break. Everything else —
 * a shorter list, a reorder, an edited start/reason, an `end` moved or
 * cleared — is rejected, and the reason is a sentence so it can be audited
 * rather than failing silently.
 */
export const validateBreakEvolution = (
  prev: TimeBreak[] = [], next: TimeBreak[] = [],
): BreakEvolution => {
  if (next.length < prev.length) {
    return { ok: false, reason: `breaks shrank from ${prev.length} to ${next.length}` };
  }
  if (next.length > prev.length + 1) {
    return { ok: false, reason: `breaks grew by ${next.length - prev.length}; at most one break may be added` };
  }

  let ended = 0;
  for (let i = 0; i < prev.length; i++) {
    const before = prev[i];
    const after = next[i];
    if (!after || before.id !== after.id) {
      return { ok: false, reason: `break ${i} changed identity or order (${before.id} → ${after?.id ?? 'missing'})` };
    }
    if (!sameBreakExceptEnd(before, after)) {
      return { ok: false, reason: `break ${before.id} was edited; a punch may only set its end` };
    }
    if (before.end == null && after.end != null) {
      ended++;
      // Only the LAST break can be the open one; ending anything else means
      // the array was rebuilt rather than punched.
      if (i !== prev.length - 1) {
        return { ok: false, reason: `break ${before.id} is not the last break and cannot be ended` };
      }
    } else if (before.end !== after.end) {
      return { ok: false, reason: `break ${before.id} had its end changed from ${before.end} to ${after.end}` };
    }
  }

  const appended = next.length > prev.length;
  if (appended) {
    if (ended > 0) {
      return { ok: false, reason: 'a break was ended and another added in the same write' };
    }
    const added = next[next.length - 1];
    if (added.end != null) {
      return { ok: false, reason: 'an added break must be open; a completed break cannot be back-filled at the door' };
    }
    if (prev.some(b => b.end == null)) {
      return { ok: false, reason: 'a break is already running; it must be ended before another starts' };
    }
    return { ok: true, change: 'appended' };
  }

  return { ok: true, change: ended > 0 ? 'ended' : 'none' };
};

/**
 * The same check applied to the whole entry, which is what App.tsx runs
 * immediately before a kiosk write. Also refuses a punch that re-opens a
 * closed shift or moves the clock-in, since those travel on the same write.
 */
export const validateKioskWrite = (
  before: TimeEntry, after: TimeEntry,
): BreakEvolution => {
  if (before.id !== after.id || before.userId !== after.userId) {
    return { ok: false, reason: 'a punch may not move an entry to another shift or person' };
  }
  if (before.clockIn !== after.clockIn) {
    return { ok: false, reason: 'a punch may not change the clock-in time' };
  }
  if (before.clockOut != null && after.clockOut !== before.clockOut) {
    return { ok: false, reason: 'a shift that is already clocked out cannot be changed at the door' };
  }
  return validateBreakEvolution(before.breaks || [], after.breaks || []);
};

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

/**
 * "You're still clocked in from Friday, 9:14 AM."
 *
 * NAMES the shift rather than gesturing at it: somebody who forgot to clock
 * out on Friday needs to recognise which shift this is before a manager can
 * fix it. Returns null when there is no stale shift to describe.
 *
 * The screen deliberately offers NO punch here — not a clock-out, not a fresh
 * clock-in. firestore.rules refuses a kiosk write to an entry this old anyway
 * (withinLastDay), and the door iPad must never decide what somebody's hours
 * were. The shift stays open and flagged for the owner to correct on the Time
 * Clock screen.
 */
export const staleShiftLabel = (s: PunchState, fmt: (ms: number) => string): string | null =>
  s.open && s.open.clockIn ? `You're still clocked in from ${fmt(s.open.clockIn)}.` : null;

/** Wording for the confirm step, so the screen and the tests agree on it. */
export const confirmLabel = (
  s: PunchState, name: string, timeLabel: string, now: number,
): string => {
  if (s.action === 'clock_in') return `Clock in ${name} — ${timeLabel}`;
  if (s.action === 'end_break') return `Back from break — ${name}`;
  return `Clock out ${name} — ${timeLabel} · ${fmtDuration(s.workedMsSoFar)} worked today`;
};

export { isClockedIn, isOnBreak, breakMs, shiftEnd };
