import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';
import { assertOnline } from './functionsGuard';
import { hashPin } from '../domain/pin';
import { Role } from '../types';

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

// Owner (or manager, for a technician only) account creation — sets the
// email/password/PIN directly instead of creating a "pending invite" the new
// hire has to self-claim by signing in with a password only they know. Same
// reasoning as setStaffPassword above for why this has to be a callable: the
// client Firebase Auth SDK can't create another user's account without
// signing the CALLER out and becoming that new user's session instead.
//
// `pin` is optional plaintext — hashed HERE, client-side, via the same
// domain/pin.ts hashPin() every other PIN-set path in the app uses, so the
// plaintext never leaves the device (mirrors App.tsx's handleSetPin).
export interface CreateStaffUserInput {
  email: string;
  password: string;
  // Typed as the full Role union for a simple call-site shape; the
  // callable's own authorizeStaffUserCreate is what actually refuses
  // 'owner' (or any role the caller isn't allowed to grant) — this is not a
  // security boundary, just matching the caller's already-validated input.
  role: Role;
  pin?: string;
}

const createCall = httpsCallable<
  { email: string; password: string; role: string; pinHash?: string; pinSalt?: string; pinIterations?: number },
  { ok: boolean; uid: string }
>(functions, 'createStaffUser');

export const createStaffUser = async (input: CreateStaffUserInput): Promise<{ uid: string }> => {
  assertOnline();
  let pinFields: { pinHash?: string; pinSalt?: string; pinIterations?: number } = {};
  if (input.pin) {
    const { hash, salt, iterations } = await hashPin(input.pin);
    pinFields = { pinHash: hash, pinSalt: salt, pinIterations: iterations };
  }
  const res = await createCall({ email: input.email, password: input.password, role: input.role, ...pinFields });
  return { uid: res.data.uid };
};
