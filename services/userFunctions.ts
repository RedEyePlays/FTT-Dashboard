import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { assertOnline } from './functionsGuard';

// Owner-only staff password reset. Same shape as services/repairFunctions.ts:
// a thin, online-guarded wrapper around one callable.
//
// The Admin SDK is what actually sets the password (admin.auth().updateUser)
// and it lives ONLY in functions/src/staffPassword.ts — the browser never
// imports firebase-admin and holds no service-account credential. All this
// module can do is post two values to a callable that re-derives the caller's
// role and workspace from Firestore before doing anything.
const call = httpsCallable<{ targetUid: string; newPassword: string }, { ok: boolean; sessionsRevoked: boolean }>(
  functions,
  'setStaffPassword',
);

/**
 * Set another user's password. Resolves when the reset landed; rejects with the
 * callable's HttpsError (permission-denied / not-found / invalid-argument /
 * resource-exhausted) otherwise.
 *
 * The password is passed straight through to the callable and never stored,
 * logged, or put into app state anywhere on this side.
 */
export const setStaffPassword = async (targetUid: string, newPassword: string): Promise<{ sessionsRevoked: boolean }> => {
  // `async` (not a Promise chain) so assertOnline()'s synchronous throw
  // surfaces as a rejection — see the same note in repairFunctions.ts.
  assertOnline();
  const res = await call({ targetUid, newPassword });
  return { sessionsRevoked: !!res.data?.sessionsRevoked };
};
