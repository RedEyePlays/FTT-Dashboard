import { useEffect, useRef, useState } from 'react';
import {
  LockRecord, initialLocked, lockedAfterAuth, awayTooLong, buildRecord,
} from '../domain/appLock';

// A lock OVERLAY, not a sign-out: the authenticated session stays intact, the
// rest of the app just isn't rendered while `locked` is true (App.tsx's early
// return).
//
// PERSISTED TO localStorage, NOT sessionStorage. sessionStorage dies with the
// tab, so the screen locked, somebody closed the tab, reopened the app, and
// they were straight back inside — still signed in, no PIN, no password. On a
// shared counter register that made the lock decorative. Refresh and the back
// button had been considered; closing the tab had not.
//
// The key name is unchanged so an existing sessionStorage entry simply stops
// being read; nothing needs migrating, because a stale lock is never something
// we want to resurrect anyway.
export const APP_LOCK_KEY = 'bizTrackAppLocked';

const readRecord = (): LockRecord | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(APP_LOCK_KEY);
    if (!raw) return null;
    // '1' is the old sessionStorage format. Treat it as "locked, owner
    // unknown" rather than discarding it: it still means somebody locked.
    if (raw === '1') return { locked: true };
    const parsed = JSON.parse(raw) as LockRecord;
    return typeof parsed === 'object' && parsed ? parsed : null;
  } catch {
    return null;
  }
};

const writeRecord = (rec: LockRecord): void => {
  try { localStorage.setItem(APP_LOCK_KEY, JSON.stringify(rec)); }
  catch { /* storage unavailable (private mode) — the lock still works in memory */ }
};

const clearRecord = (): void => {
  try { localStorage.removeItem(APP_LOCK_KEY); }
  catch { /* ignore */ }
};

const uidOf = (user: unknown): string | undefined => {
  const u = (user as { uid?: unknown } | null | undefined)?.uid;
  return typeof u === 'string' && u ? u : undefined;
};

/** How often the in-use heartbeat is written while the app is open. */
const SEEN_INTERVAL_MS = 15_000;

/**
 * Owns the `appLocked` flag and its persistence, plus the rules that decide
 * when a lock may clear itself.
 *
 * `user` and `authLoading` come straight from the Firebase Auth listener.
 * `authLoading` is true only until `onAuthStateChanged` has fired at least
 * once, and gating the clear on `!authLoading` is essential: without it, a
 * page load renders with `user === null` for the first tick, the effect fires,
 * and the flag just read back from storage is wiped before auth had a chance
 * to restore the real session — a refresh would silently drop the lock.
 *
 * That care matters MORE now the flag outlives the browser, not less: see
 * domain/appLock.ts for why the record is keyed to a uid.
 *
 * `idleMs` is the idle window in force for THIS person on THIS device (0 when
 * auto-lock doesn't apply to them — see domain/registerMode.ts). It is stored
 * alongside the heartbeat so that returning after longer than that window
 * comes back LOCKED, rather than restarting the idle count from zero. Closing
 * the tab must never be a way to reset the timer.
 */
export function useAppLock(user: unknown, authLoading: boolean, idleMs: number = 0) {
  const [locked, setLocked] = useState<boolean>(() => initialLocked(readRecord(), Date.now()));
  const uid = uidOf(user);
  // Read once at mount, before any of this session's own writes overwrite it —
  // the uid check below has to compare against what the PREVIOUS session left.
  const bootRecord = useRef<LockRecord | null>(readRecord());
  const idleRef = useRef(idleMs);
  idleRef.current = idleMs;

  // Persist every state change, including the heartbeat that makes
  // "away too long" answerable.
  useEffect(() => {
    if (locked || uid) writeRecord(buildRecord(uid, locked, Date.now(), idleMs));
    else clearRecord();
  }, [locked, uid, idleMs]);

  // Once auth has actually resolved, reconcile the persisted record against
  // who is really signed in. A genuine sign-out clears; somebody ELSE'S lock
  // is ignored rather than obeyed, so a stale flag can never lock a different
  // person out of their own freshly signed-in session.
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (authLoading) return;
    const next = lockedAfterAuth(bootRecord.current, uid, locked);
    if (next !== locked) setLocked(next);
    if (!reconciledRef.current) {
      reconciledRef.current = true;
      // The boot record has served its purpose; from here on this session's
      // own writes are the truth.
      bootRecord.current = null;
    }
    if (!uid) clearRecord();
  }, [authLoading, uid, locked]);

  // Heartbeat while the app is open, and a final stamp as it goes away, so
  // the gap between sessions is measurable.
  useEffect(() => {
    if (!uid) return;
    const stamp = () => writeRecord(buildRecord(uid, locked, Date.now(), idleRef.current));
    const timer = window.setInterval(stamp, SEEN_INTERVAL_MS);
    const onHide = () => { if (document.visibilityState === 'hidden') stamp(); };
    window.addEventListener('pagehide', stamp);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', stamp);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [uid, locked]);

  // BACKGROUNDED LONGER THAN THE IDLE WINDOW comes back locked. The interval
  // above doesn't run reliably in a hidden tab, so returning is checked
  // explicitly rather than assumed.
  useEffect(() => {
    if (!uid) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      const rec = readRecord();
      if (!locked && awayTooLong(rec, Date.now())) setLocked(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [uid, locked]);

  return [locked, setLocked] as const;
}
