import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { functions, auth } from './firebase';
import { assertOnline, OfflineError } from './functionsGuard';

/**
 * Fast user switching on a shared register.
 *
 * The PIN check happens in the `switchUser` callable, not here: firestore.rules
 * will not let a technician's session read a colleague's pinHash, so the
 * browser genuinely cannot do it. All this module does is post two values and
 * exchange the returned custom token for a session.
 *
 * The PIN is passed straight through and is never stored, logged or put into
 * app state on this side.
 */
const call = httpsCallable<
  { targetUid: string; pin: string; deviceId?: string },
  { ok: boolean; token: string; uid: string; email: string }
>(functions, 'switchUser');

export interface SwitchResult {
  uid: string;
  email: string;
}

/**
 * THE OFFLINE CASE IS THE ONE THAT MATTERS.
 *
 * The callable needs a connection. If there isn't one, this throws BEFORE
 * touching the current session, so the person who was signed in stays signed
 * in and the screen can say plainly what happened. The failure that must never
 * occur is the quiet one: the switch appearing to work, or appearing to fail
 * while actually having signed the previous person out, so the next person
 * rings a sale under a name that isn't theirs.
 *
 * The old session is signed out only AFTER a token has been obtained — the one
 * window where a failure could strand the register signed out is between the
 * signOut and the signInWithCustomToken, which is why they are adjacent and
 * the token is already in hand.
 */
export const switchUser = async (
  targetUid: string,
  pin: string,
  deviceId?: string,
): Promise<SwitchResult> => {
  // `async` (not a Promise chain) so assertOnline()'s synchronous throw
  // surfaces as a rejection — same note as repairFunctions.ts.
  assertOnline();

  // If this rejects (wrong PIN, rate limited, denied, or the network dropped
  // between the check above and here) the current session is untouched.
  const res = await call({ targetUid, pin, deviceId });
  const token = res.data?.token;
  if (!token) throw new OfflineError('Could not switch users. Sign in with a password.');

  // Replace the session outright rather than layering a second identity on
  // top: signOut first so no listener ever observes the old user's uid with
  // the new user's data, or the reverse.
  await signOut(auth);
  await signInWithCustomToken(auth, token);
  return { uid: res.data.uid, email: res.data.email };
};

/**
 * What to show when a switch fails.
 *
 * Offline gets its own sentence because it is the one case where the answer is
 * "do something else", not "try again".
 */
export const switchErrorMessage = (e: unknown): string => {
  if (e instanceof OfflineError) {
    return "Can't switch users while offline — sign in with a password.";
  }
  const code = (e as { code?: string })?.code || '';
  const message = (e as { message?: string })?.message || '';
  if (code.includes('unavailable') || code.includes('deadline-exceeded') || /network/i.test(message)) {
    return "Can't switch users while offline — sign in with a password.";
  }
  // The callable's own messages are already written for the counter (wrong
  // PIN, cooling down, no PIN set), so they are passed through as-is.
  return message || 'Could not switch users. Sign in with a password.';
};
