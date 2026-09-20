/**
 * THE LOCK SCREEN'S PERSISTENCE RULES, kept pure so every branch is testable
 * without a DOM, a clock, or Firebase.
 *
 * THE HOLE THIS CLOSES: the locked flag lived in sessionStorage, and
 * sessionStorage dies with the tab. So the screen locked, somebody closed the
 * tab, reopened the app, and they were straight back inside — still signed in,
 * no PIN, no password. On a shared counter register that made the lock
 * decorative. Refresh and the back button had been considered; closing the tab
 * had not.
 *
 * Moving to localStorage fixes that, and immediately makes the existing
 * "genuine sign-out vs the transient pre-auth null" care matter MORE, not
 * less: a flag that now outlives the browser must never greet a DIFFERENT
 * person who signs in afterwards. So the flag is keyed to the uid it was set
 * for, and a record belonging to somebody else is ignored rather than obeyed.
 */

export interface LockRecord {
  /** The uid this lock was set for. A record with no uid is not trusted. */
  uid?: string;
  /** Locked explicitly — by the idle timer or by Lock app. */
  locked?: boolean;
  /** Epoch ms this session was last known to be in use. */
  seen?: number;
  /**
   * The idle window in force for that session, in ms. 0 or absent means
   * auto-lock did not apply to that person on that device (see
   * domain/registerMode.ts), so being away is not by itself a reason to lock.
   */
  idleMs?: number;
}

/** A record that says nothing is not a record. */
export const isEmptyRecord = (r: LockRecord | null | undefined): boolean =>
  !r || (!r.locked && !r.seen);

/**
 * Locked at mount, BEFORE auth has resolved.
 *
 * Deliberately pessimistic: auth resolves a tick later, and briefly showing a
 * lock that then clears is a great deal better than briefly showing the app to
 * somebody who should be looking at a lock. The uid check happens in
 * `lockedAfterAuth` as soon as there is a uid to check against.
 */
export const initialLocked = (rec: LockRecord | null, now: number): boolean => {
  if (isEmptyRecord(rec)) return false;
  if (rec!.locked) return true;
  return awayTooLong(rec!, now);
};

/**
 * Was the app away longer than that session's own idle window?
 *
 * CLOSING THE TAB MUST NEVER RESET THE TIMER. Without this, the way to get
 * past a lock that was about to fire is to close the tab and reopen it, and
 * the idle count starts again from zero.
 *
 * `idleMs` of 0 (auto-lock did not apply to that person on that device) means
 * absence alone never locks — they were never on a timer to begin with.
 */
export const awayTooLong = (rec: LockRecord | null, now: number): boolean => {
  if (!rec || !rec.seen || !rec.idleMs || rec.idleMs <= 0) return false;
  return now - rec.seen >= rec.idleMs;
};

/**
 * What the lock should be once auth has actually resolved.
 *
 * `uid` is undefined ONLY for a genuine sign-out — the caller must not call
 * this during the transient pre-auth null tick, which is exactly the
 * distinction that kept a refresh from silently dropping the lock.
 */
export const lockedAfterAuth = (
  rec: LockRecord | null,
  uid: string | undefined,
  wasLocked: boolean,
): boolean => {
  // A genuine sign-out always clears: there is no session left to protect,
  // and leaving the flag would lock out the next person to sign in.
  if (!uid) return false;
  // Nothing persisted to contradict the in-memory state (e.g. storage is
  // unavailable, or this lock was set during this very session).
  if (isEmptyRecord(rec) || !rec!.uid) return wasLocked;
  // SOMEBODY ELSE'S LOCK. Not theirs to be held by, and obeying it would lock
  // a person out of their own freshly signed-in session.
  if (rec!.uid !== uid) return false;
  return wasLocked;
};

/** The record to persist for the current state. */
export const buildRecord = (
  uid: string | undefined,
  locked: boolean,
  now: number,
  idleMs: number,
): LockRecord => ({
  ...(uid ? { uid } : {}),
  locked,
  seen: now,
  idleMs: Math.max(0, Math.round(idleMs)),
});
