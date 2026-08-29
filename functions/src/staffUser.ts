import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  authorizeStaffUserCreate,
  buildCreateAuditEntry,
  buildFailureLog,
  classifyCreateUserError,
  recordAttempt,
  Role,
  UserRecord,
  validateEmail,
  validatePassword,
  validatePinTriple,
} from "./staffUserPolicy";

// Shared Admin app (aiGenerate/backups/repairLookup/repairs/staffPassword may also init it).
if (!admin.apps.length) admin.initializeApp();

interface CreateStaffUserRequest {
  email?: unknown;
  password?: unknown;
  role?: unknown;
  pinHash?: unknown;
  pinSalt?: unknown;
  pinIterations?: unknown;
}

// Best-effort per-instance sliding window, same shape/limits as
// staffPassword.ts's ATTEMPTS — its own map since this is a different action,
// keyed by CALLER uid so cycling target emails doesn't sidestep it.
const ATTEMPTS = new Map<string, number[]>();

/**
 * createStaffUser — lets an owner (or a manager, for a technician account
 * only) create a fully-usable staff account in one step: email, password and
 * an optional PIN, set directly, no "pending invite" the new hire has to
 * self-claim by signing in with a password only they know.
 *
 * The Firebase client SDK can't do this itself — calling
 * createUserWithEmailAndPassword() from the browser signs the CALLER out and
 * signs the newly-created user in instead, which is why account creation has
 * to go through the Admin SDK server-side, exactly like setStaffPassword.ts
 * already does for a reset.
 *
 * Everything that matters is enforced HERE:
 *   • The caller's role/workspace are read from Firestore by uid
 *     (users/{request.auth.uid}) — never client-supplied. See
 *     authorizeStaffUserCreate for exactly who may create whom.
 *   • Rate limited per caller.
 *   • Audited (buildCreateAuditEntry — no password or PIN material).
 *   • The new users/{uid} doc is written by the Admin SDK in the SAME call
 *     that creates the Auth account, so there's never a moment where the
 *     account exists in Auth but has no workspace/role doc yet.
 */
export const createStaffUser = onCall(
  { region: "us-central1" },
  async (request: CallableRequest<CreateStaffUserRequest>) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    const callerUid = request.auth.uid;

    // Throttle before doing any work (and before touching Auth), so a
    // scripted caller burns the window, not our quota.
    const { history, exceeded } = recordAttempt(ATTEMPTS.get(callerUid) || [], Date.now());
    ATTEMPTS.set(callerUid, history);
    if (ATTEMPTS.size > 5000) ATTEMPTS.clear(); // crude memory bound, as in repairLookup.ts/staffPassword.ts
    if (exceeded) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many accounts created in a short time. Please wait a few minutes and try again."
      );
    }

    const db = admin.firestore();
    const callerSnap = await db.collection("users").doc(callerUid).get();
    const caller = callerSnap.data() as UserRecord | undefined;

    const targetRole = request.data?.role;
    const authz = authorizeStaffUserCreate({ callerUid, caller, targetRole });
    if (!authz.ok) {
      throw new HttpsError(authz.code, authz.message);
    }

    // Strength/shape checks only AFTER authorization, so an unauthorized
    // caller learns nothing from the shape of the error.
    const emailError = validateEmail(request.data?.email);
    if (emailError) throw new HttpsError("invalid-argument", emailError);
    const email = String(request.data!.email as string).trim();

    const passwordError = validatePassword(request.data?.password);
    if (passwordError) throw new HttpsError("invalid-argument", passwordError);
    const password = request.data!.password as string;

    const pinError = validatePinTriple({
      pinHash: request.data?.pinHash,
      pinSalt: request.data?.pinSalt,
      pinIterations: request.data?.pinIterations,
    });
    if (pinError) throw new HttpsError("invalid-argument", pinError);

    let uid: string;
    try {
      // NOTE: staff accounts are real Firebase Auth accounts — that is what
      // signs them in — but NO email is ever sent. createUser() does not send
      // anything, and this project never calls generateEmailVerificationLink
      // or sendPasswordResetEmail: the owner sets the password directly here
      // and resets it via setStaffPassword. That's the intended "no real
      // mailbox needed" behaviour — the email is a login identifier only.
      const created = await admin.auth().createUser({ email, password });
      uid = created.uid;
    } catch (err: unknown) {
      const classified = classifyCreateUserError(err);
      // Log the FULL error server-side with enough context to debug (caller,
      // target, stage, the Auth code) — `password` is deliberately not in
      // scope of anything logged here, and buildFailureLog has no field that
      // could carry a credential.
      console.error(
        JSON.stringify(buildFailureLog({ stage: "auth", callerUid, targetEmail: email, targetRole, err, classified })),
        classified.unexpected ? err : "",
      );
      throw new HttpsError(classified.code, classified.message);
    }

    const now = Date.now();
    const workspaceId = String(caller!.workspaceId);
    const userDoc: Record<string, unknown> = {
      id: uid,
      email,
      role: targetRole as Role,
      workspaceId,
      disabled: false,
      createdAt: now,
    };
    if (request.data?.pinHash != null) {
      userDoc.pinHash = request.data.pinHash;
      userDoc.pinSalt = request.data.pinSalt;
      userDoc.pinIterations = request.data.pinIterations;
      userDoc.pinUpdatedAt = now;
      userDoc.pinUpdatedBy = callerUid;
      userDoc.pinUpdatedByEmail = String(caller!.email ?? "");
    }

    try {
      await db.collection("users").doc(uid).set(userDoc);
    } catch (err: unknown) {
      // The Auth account exists but the Firestore doc failed — clean up
      // rather than leave an unusable half-created account with no
      // workspace/role, which would otherwise be stuck (they can't sign in
      // usefully, and re-running create would hit "email already exists").
      const classified = classifyCreateUserError(err);
      console.error(
        JSON.stringify(buildFailureLog({ stage: "firestore", callerUid, targetEmail: email, targetRole, err, classified })),
        err,
      );
      const rolledBack = await admin.auth().deleteUser(uid).then(() => true).catch(() => false);
      // Distinguish the two very different outcomes: a clean rollback is
      // safely retryable, a failed one has left an orphan Auth account that
      // will collide with "email already exists" on the next attempt — the
      // operator needs to be told that, not handed a generic retry.
      throw new HttpsError(
        rolledBack ? "unavailable" : "failed-precondition",
        rolledBack
          ? "Couldn't save the new user's profile, so the account was rolled back. Please try again."
          : "The account was created but its profile couldn't be saved, and the rollback also failed. An owner should delete this user in the Firebase console before retrying.",
      );
    }

    // A leftover pending invite for this email (created before this direct-
    // create path existed, or never followed up on) is now moot — best
    // effort, never blocks the create it's cleaning up after.
    await db.collection("workspaceInvites").doc(email.toLowerCase()).delete().catch(() => {});

    // Audit into the SAME append-only collection the client's audit() writes
    // to (user_data/{workspaceId}/auditLogs), written with the Admin SDK
    // because the acting identity must be stamped server-side.
    const entry = buildCreateAuditEntry({
      id: db.collection("_ids").doc().id,
      now,
      callerUid,
      callerEmail: String(caller!.email ?? ""),
      targetUid: uid,
      targetEmail: email,
      targetRole: targetRole as Role,
    });
    await db
      .collection("user_data").doc(workspaceId)
      .collection("auditLogs").doc(entry.id)
      .set(entry);

    return { ok: true, uid };
  }
);
