import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  authorizeStaffPasswordReset,
  buildResetAuditEntry,
  recordAttempt,
  UserRecord,
  validatePassword,
} from "./staffPasswordPolicy";

// Shared Admin app (aiGenerate/backups/repairLookup/repairs may also init it).
if (!admin.apps.length) admin.initializeApp();

interface SetStaffPasswordRequest {
  targetUid?: unknown;
  newPassword?: unknown;
}

// Best-effort per-instance sliding window, the same shape repairLookup.ts uses
// (functions/src/repairLookup.ts's HITS/throttled). Keyed by CALLER uid, not by
// target, so an owner can't sidestep the cap by cycling targets.
const ATTEMPTS = new Map<string, number[]>();

/**
 * setStaffPassword — the in-app replacement for Firebase's email-based
 * password reset, which is useless here: staff accounts are routinely created
 * with addresses that never receive mail (there is no email verification), so
 * a reset link goes nowhere. The owner sets the new password directly and
 * hands it over in person.
 *
 * Everything that matters is enforced HERE, server-side, with the Admin SDK:
 *
 *   • The caller's role and workspace are READ FROM FIRESTORE by uid
 *     (`users/{request.auth.uid}`) — exactly how aiGenerate's
 *     requireProfitVisibility and techUpdateRepair resolve a caller. The
 *     client sends only a target uid and the new password; a forged role,
 *     workspaceId or custom claim in the request body is not read and cannot
 *     influence the decision.
 *   • The target's workspace is read the same way. Cross-workspace is denied,
 *     with the same message as "no such user" so uids can't be probed.
 *   • Owner-targets-owner is denied (see authorizeStaffPasswordReset) — that
 *     includes an owner targeting themselves. An owner's own password change
 *     is the normal reauthenticate flow in the app; it is deliberately not
 *     built here.
 *   • Rate limited per caller.
 *   • Audited. The audit entry is built by buildResetAuditEntry, which takes
 *     no password parameter at all — the password is never written to
 *     Firestore, never included in a thrown error, and never passed to
 *     console/logger anywhere in this file.
 */
export const setStaffPassword = onCall(
  { region: "us-central1" },
  async (request: CallableRequest<SetStaffPasswordRequest>) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    const callerUid = request.auth.uid;
    const targetUid = String(request.data?.targetUid ?? "").trim();
    const newPassword = request.data?.newPassword;

    // Throttle before doing any work (and before touching Auth), so a
    // scripted caller burns the window, not our quota.
    const { history, exceeded } = recordAttempt(ATTEMPTS.get(callerUid) || [], Date.now());
    ATTEMPTS.set(callerUid, history);
    if (ATTEMPTS.size > 5000) ATTEMPTS.clear(); // crude memory bound, as in repairLookup.ts
    if (exceeded) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many password resets in a short time. Please wait a few minutes and try again."
      );
    }

    const db = admin.firestore();
    const [callerSnap, targetSnap] = await Promise.all([
      db.collection("users").doc(callerUid).get(),
      targetUid ? db.collection("users").doc(targetUid).get() : Promise.resolve(null),
    ]);

    const caller = callerSnap.data() as UserRecord | undefined;
    const target = (targetSnap && targetSnap.exists ? targetSnap.data() : undefined) as UserRecord | undefined;

    const authz = authorizeStaffPasswordReset({ callerUid, targetUid, caller, target });
    if (!authz.ok) {
      throw new HttpsError(authz.code, authz.message);
    }

    // Strength is checked only AFTER authorization, so an unauthorized caller
    // learns nothing from the shape of the error.
    const weak = validatePassword(newPassword);
    if (weak) {
      throw new HttpsError("invalid-argument", weak);
    }

    await admin.auth().updateUser(targetUid, { password: newPassword as string });

    // Revoke the target's existing sessions. Implemented (rather than skipped)
    // because it is one Admin SDK call on the same admin.auth() handle already
    // in use above — no extra dependency or wiring. It is the point of a
    // reset: if the account was reset because someone shouldn't be in it any
    // more, leaving their live refresh tokens valid would defeat the whole
    // action. Best-effort: a failure here must not make the caller think the
    // password change itself failed (it already succeeded), so it's caught and
    // recorded in the audit entry as sessionsRevoked:false.
    let sessionsRevoked = true;
    try {
      await admin.auth().revokeRefreshTokens(targetUid);
    } catch {
      sessionsRevoked = false;
    }

    // Audit into the SAME append-only collection the client's audit() writes
    // to (user_data/{workspaceId}/auditLogs — see services/firestoreDb.ts's
    // logAudit and firestore.rules), so this shows up in the existing Audit
    // Log view with no new surface. Written with the Admin SDK because the
    // acting identity must be stamped server-side.
    const workspaceId = String(caller!.workspaceId);
    const entry = buildResetAuditEntry({
      id: db.collection("_ids").doc().id,
      now: Date.now(),
      callerUid,
      callerEmail: String(caller!.email ?? ""),
      targetUid,
      targetEmail: String(target!.email ?? ""),
      sessionsRevoked,
    });
    await db
      .collection("user_data").doc(workspaceId)
      .collection("auditLogs").doc(entry.id)
      .set(entry);

    return { ok: true, sessionsRevoked };
  }
);
