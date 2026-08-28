import { useEffect, useState } from 'react';

// A lock OVERLAY, not a sign-out: the authenticated session stays intact, the
// rest of the app just isn't rendered while `locked` is true (App.tsx's early
// return). Persisted to sessionStorage so a refresh (or the browser back
// button, which only changes in-app view state) can't drop back into the app
// without re-entering the PIN/password — the locked flag is read back out
// BEFORE the first paint via the lazy useState initializer.
export const APP_LOCK_KEY = 'bizTrackAppLocked';

const readPersistedLock = (): boolean => {
  if (typeof window === 'undefined') return false;
  try { return sessionStorage.getItem(APP_LOCK_KEY) === '1'; } catch { return false; }
};

/**
 * Owns the `appLocked` flag and its sessionStorage persistence, plus the one
 * rule that decides when a lock is allowed to clear itself: a GENUINE
 * sign-out, never the transient pre-auth `null` Firebase Auth reports on
 * every page load before it resolves.
 *
 * `user` and `authLoading` should come straight from the Firebase Auth
 * listener (useWorkspaceData's `user`/`isLoadingAuth`) — `authLoading` is
 * true only until `onAuthStateChanged` has fired at least once. Gating the
 * clear on `!authLoading` is essential: without it, a page refresh renders
 * with `user === null` for the first tick (auth hasn't resolved yet), this
 * would-be effect fires, and the lock flag just read back from
 * sessionStorage above gets wiped out before auth even had a chance to
 * restore the real session — a refresh silently dropped the lock.
 */
export function useAppLock(user: unknown, authLoading: boolean) {
  const [locked, setLocked] = useState<boolean>(readPersistedLock);

  useEffect(() => {
    try {
      if (locked) sessionStorage.setItem(APP_LOCK_KEY, '1');
      else sessionStorage.removeItem(APP_LOCK_KEY);
    } catch { /* storage unavailable (e.g. private mode) — lock still works in-memory */ }
  }, [locked]);

  useEffect(() => {
    if (!authLoading && !user) setLocked(false);
  }, [authLoading, user]);

  return [locked, setLocked] as const;
}
