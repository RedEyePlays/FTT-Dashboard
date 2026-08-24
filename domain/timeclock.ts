import { TimeEntry, TimeBreak, BreakReason, TimeEntryCorrection } from '../types';

// --- Time clock: pure hours & pay math --------------------------------------
//
// All the shift/break → worked-hours → gross-pay calculation lives here as pure
// functions (no Firebase, no React), mirroring domain/pos.ts and domain/repairs.ts.
// Firestore I/O is in services/firestoreDb.ts; RBAC gating in services/rbac.ts.
//
// Timestamps are epoch ms throughout. `now` is always passed in (never read from
// Date.now() inside these helpers) so the logic is deterministic and testable.

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

// Biweekly pay periods. The anchor is a fixed reference Monday; every period is a
// contiguous 14-day window measured from it, so periods never overlap and each
// shift belongs to exactly one (bucketed by its clock-in — see hoursInRange).
export const PAY_PERIOD_DAYS = 14;
export const PAY_PERIOD_ANCHOR = '2024-01-01'; // a Monday

// Quick-tap break reasons for the kiosk UI — big buttons, no typing. Only 'other'
// offers an optional note field.
export const BREAK_REASONS: { id: BreakReason; label: string }[] = [
  { id: 'lunch', label: 'Lunch' },
  { id: 'personal', label: 'Personal' },
  { id: 'bank', label: 'Bank run' },
  { id: 'other', label: 'Other' },
];

export const breakReasonLabel = (r: BreakReason): string =>
  BREAK_REASONS.find(b => b.id === r)?.label ?? 'Break';

// Coerce a possibly-missing numeric field to a finite number.
const nn = (n: number | undefined | null): number =>
  typeof n === 'number' && isFinite(n) ? n : 0;

export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const msToHours = (ms: number): number => ms / HOUR_MS;

// --- Shift / break state ----------------------------------------------------

export const isClockedIn = (e: TimeEntry): boolean => e.clockOut == null;

export const isOnBreak = (e: TimeEntry): boolean =>
  isClockedIn(e) && (e.breaks || []).some(b => b.end == null);

/** The user's currently-open shift (no clock-out), if any. At most one. */
export const openEntryFor = (entries: TimeEntry[], userId: string): TimeEntry | undefined =>
  entries.find(e => e.userId === userId && isClockedIn(e));

/**
 * Effective end of a shift: the real clock-out, or `now` if the user is still
 * clocked in. An entry left open because someone forgot to clock out therefore
 * accrues time up to the moment of calculation rather than silently vanishing.
 */
export const shiftEnd = (e: TimeEntry, now: number): number => e.clockOut ?? now;

/**
 * One break's duration in ms, clamped so it can never extend past the end of its
 * shift. This is what handles "started a break and forgot to end it before
 * clocking out": the break end falls back to the shift end, so the stretch from
 * break-start to clock-out is treated as break (excluded from pay) rather than
 * as an unbounded, still-running break.
 */
export const breakMs = (b: TimeBreak, shiftEndMs: number): number => {
  const start = nn(b.start);
  const end = Math.min(b.end != null ? nn(b.end) : shiftEndMs, shiftEndMs);
  return Math.max(0, end - start);
};

/** Total break ms for a shift (each break clamped to the shift end). */
export const totalBreakMs = (e: TimeEntry, now: number): number => {
  const end = shiftEnd(e, now);
  return (e.breaks || []).reduce((sum, b) => sum + breakMs(b, end), 0);
};

/**
 * Paid worked ms for a shift = (end − clock-in) − breaks, never negative. Breaks
 * are always excluded, so they don't count toward pay.
 */
export const workedMs = (e: TimeEntry, now: number): number => {
  const gross = Math.max(0, shiftEnd(e, now) - nn(e.clockIn));
  return Math.max(0, gross - totalBreakMs(e, now));
};

export const workedHours = (e: TimeEntry, now: number): number => msToHours(workedMs(e, now));

// --- Date / pay-period math -------------------------------------------------

// Local midnight for a timestamp.
const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// Add calendar days via Date (DST-safe, unlike adding n * DAY_MS).
const addDays = (ms: number, days: number): number => {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
};

// Whole calendar days between two timestamps (rounded to absorb 23h/25h DST days).
const dayDiff = (a: number, b: number): number =>
  Math.round((startOfDay(a) - startOfDay(b)) / DAY_MS);

const anchorMs = (anchorISO: string): number => startOfDay(new Date(`${anchorISO}T00:00:00`).getTime());

/** YYYY-MM-DD (local) for a timestamp. */
export const toISODate = (ms: number): string => {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export interface PayPeriod {
  index: number;   // integer offset from the anchor period
  start: number;   // epoch ms at local midnight, inclusive
  end: number;     // epoch ms at local midnight, EXCLUSIVE (== next period's start)
}

/**
 * The biweekly pay period containing `ms`. Periods are contiguous and
 * non-overlapping: `end` is exclusive and equals the next period's `start`, so a
 * timestamp exactly on a boundary belongs to the later period. A shift is always
 * assigned to a single period by its clock-in (see hoursInRange).
 */
export const payPeriodFor = (ms: number, anchorISO: string = PAY_PERIOD_ANCHOR): PayPeriod => {
  const anchor = anchorMs(anchorISO);
  const index = Math.floor(dayDiff(ms, anchor) / PAY_PERIOD_DAYS);
  const start = addDays(anchor, index * PAY_PERIOD_DAYS);
  const end = addDays(start, PAY_PERIOD_DAYS);
  return { index, start, end };
};

/** The N most recent pay periods (newest first), for the summary period picker. */
export const recentPayPeriods = (now: number, count: number, anchorISO: string = PAY_PERIOD_ANCHOR): PayPeriod[] => {
  const current = payPeriodFor(now, anchorISO);
  const out: PayPeriod[] = [];
  for (let i = 0; i < count; i++) {
    const start = addDays(current.start, -i * PAY_PERIOD_DAYS);
    out.push({ index: current.index - i, start, end: addDays(start, PAY_PERIOD_DAYS) });
  }
  return out;
};

/** The inclusive last calendar day of a period (its `end` is exclusive). */
export const periodEndInclusive = (p: PayPeriod): number => addDays(p.end, -1);

// --- Range aggregation ------------------------------------------------------

/** [start, end) window for the local day containing `now`. */
export const dayRange = (now: number): { start: number; end: number } => {
  const start = startOfDay(now);
  return { start, end: addDays(start, 1) };
};

/** [start, end) window for the local week containing `now` (weeks start Monday). */
export const weekRange = (now: number): { start: number; end: number } => {
  const today = startOfDay(now);
  const dow = new Date(today).getDay();        // 0=Sun … 6=Sat
  const backToMonday = (dow + 6) % 7;          // days since Monday
  const start = addDays(today, -backToMonday);
  return { start, end: addDays(start, 7) };
};

/**
 * Total worked hours for a user across every shift whose CLOCK-IN falls in
 * [startMs, endMs). Bucketing by clock-in means a shift that crosses midnight is
 * counted whole against its start day/period (never split), and — because
 * periods are contiguous — every shift lands in exactly one pay period.
 */
export const hoursInRange = (
  entries: TimeEntry[],
  userId: string,
  startMs: number,
  endMs: number,
  now: number,
): number => {
  const ms = entries
    .filter(e => e.userId === userId && nn(e.clockIn) >= startMs && nn(e.clockIn) < endMs)
    .reduce((sum, e) => sum + workedMs(e, now), 0);
  return msToHours(ms);
};

/**
 * Shifts whose CLOCK-IN falls on the given local date (YYYY-MM-DD) — the same
 * clock-in bucketing used by hoursInRange, so a shift that crosses midnight is
 * counted whole against its start day. Sorted earliest clock-in first.
 */
export const entriesOnDate = (entries: TimeEntry[], dateISO: string): TimeEntry[] =>
  entries
    .filter(e => e.clockIn != null && toISODate(e.clockIn) === dateISO)
    .sort((a, b) => a.clockIn - b.clockIn);

// --- Missed clock-out flag + correction --------------------------------------
//
// An entry is "missed" when it's still open (no clockOut) but its clock-in was
// on an earlier calendar day than `now` — i.e. someone forgot to clock out
// before leaving, rather than simply still being on shift today.

export const isMissedClockOut = (e: TimeEntry, now: number): boolean =>
  isClockedIn(e) && toISODate(e.clockIn) !== toISODate(now);

/** Every open shift left over from a previous day, oldest clock-in first. */
export const missedClockOuts = (entries: TimeEntry[], now: number): TimeEntry[] =>
  entries.filter(e => isMissedClockOut(e, now)).sort((a, b) => a.clockIn - b.clockIn);

/** A corrected clock-out must land after the clock-in and not be in the future. */
export const isValidClockOutCorrection = (entry: TimeEntry, newClockOut: number, now: number): boolean =>
  isFinite(newClockOut) && newClockOut > entry.clockIn && newClockOut <= now;

/**
 * Apply a manual clock-out correction, appending to the entry's correction
 * history rather than silently replacing the old value — the original stays
 * visible (via `fromClockOut`) alongside who made the change and when. Pure:
 * returns the next entry, does not touch Firestore.
 */
export const correctClockOut = (
  entry: TimeEntry,
  newClockOut: number,
  correctedBy: string,
  now: number,
  opts?: { correctedByEmail?: string; note?: string },
): TimeEntry => {
  const correction: TimeEntryCorrection = {
    correctedBy,
    correctedByEmail: opts?.correctedByEmail,
    correctedAt: now,
    fromClockOut: entry.clockOut,
    toClockOut: newClockOut,
    note: opts?.note,
  };
  return { ...entry, clockOut: newClockOut, corrections: [...(entry.corrections || []), correction] };
};

// --- Pay --------------------------------------------------------------------

/** Gross pay = hours × rate, rounded to cents, never negative. */
export const grossPay = (hours: number, rate: number | undefined): number =>
  round2(Math.max(0, hours) * Math.max(0, nn(rate)));

export interface PeriodPay {
  userId: string;
  hours: number;   // rounded to 2 decimals
  rate: number;
  gross: number;   // hours (rounded) × rate, in cents — so it matches what's shown
}

/**
 * Hours + gross pay for one user in one pay period. Hours are rounded to two
 * decimals and gross is computed from that rounded figure, so the displayed
 * "hours × rate = gross" always reconciles exactly for the reviewing owner.
 */
export const periodPayFor = (
  entries: TimeEntry[],
  userId: string,
  rate: number | undefined,
  period: PayPeriod,
  now: number,
): PeriodPay => {
  const hours = round2(hoursInRange(entries, userId, period.start, period.end, now));
  return { userId, hours, rate: nn(rate), gross: grossPay(hours, rate) };
};

/** Deterministic id for a per-user, per-period paid record (idempotent). */
export const paidKey = (userId: string, periodStartISO: string): string =>
  `${userId}__${periodStartISO}`;
