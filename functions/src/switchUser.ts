import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { verifyPin } from "./pinHash";
import {
  authorizeSwitch,
  buildSwitchAuditEntry,
  cooldownMessage,
  EMPTY_ATTEMPTS,
  GENERIC_DENY,
  hasPin,
  isCoolingDown,
  NO_PIN_MESSAGE,
  recordFailure,
  recordSuccess,
  WRONG_PIN_MESSAGE,
  AttemptState,
  UserRecord,
} from "./switchUserPolicy";

// Shared Admin app (aiGenerate/backups/repairLookup/staffPassword may also init it).
if (!admin.apps.length) admin.initializeApp();

interface SwitchUserRequest {
  targetUid?: unknown;
  pin?: unknown;
  deviceId?: unknown;
}

/**
 * switchUser — hand the shared counter register to the next person in about
 * two seconds, without losing who did what.
 *
 * WHY THIS IS A CLOUD FUNCTION AND NOT A BROWSER CHECK. firestore.rules lets a
 * user read users/{uid} only for themselves, or — as owner/manager — for
 * colleagues in the same workspace. A register signed in as a TECHNICIAN
 * therefore cannot read the pinHash of whoever wants to take over, so
 * client-side verification is impossible for the general case. Rather than
 * special-casing the one role pair that could do it in the browser and leaving
 * a second, differently-behaved path to rot, every switch comes through here.
 *
 * WHAT THIS DOES NOT DO:
 *   • It never returns the hash, the salt, the iteration count, or any hint
 *     about whether a PIN is set — the "no PIN" message is returned only AFTER
 *     authorization has already passed, so it cannot be used to probe uids.
 *   • It does not touch the cash drawer. The drawer belongs to the shop, not
 *     the person; a handover opens, closes and reconciles nothing.
 *   • It does not elevate anyone. The PIN is the TARGET's own credential, and
 *     the custom token minted is the target's own identity with whatever
 *     permissions that account already had.
 */
export const switchUser = onCall(
  { region: "us-central1" },
  async (request: CallableRequest<SwitchUserRequest>) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    const callerUid = request.auth.uid;
    const targetUid = String(request.data?.targetUid ?? "").trim();
    const pin = String(request.data?.pin ?? "");
    const deviceId = String(request.data?.deviceId ?? "").slice(0, 64) || undefined;

    const db = admin.firestore();
    const [callerSnap, targetSnap] = await Promise.all([
      db.collection("users").doc(callerUid).get(),
      targetUid ? db.collection("users").doc(targetUid).get() : Promise.resolve(null),
    ]);
    const caller = callerSnap.data() as UserRecord | undefined;
    const target = (targetSnap && targetSnap.exists ? targetSnap.data() : undefined) as UserRecord | undefined;

    const workspaceId = String(caller?.workspaceId ?? "");
    const audit = async (
      outcome: "switched" | "wrong_pin" | "denied" | "rate_limited",
      reason?: string,
    ) => {
      // A failed attempt is audited too: repeated failures against one
      // person's PIN is exactly the pattern worth being able to see. Written
      // with the Admin SDK into the same append-only collection the client's
      // audit() uses, so it shows up in the existing Audit Log view.
      if (!workspaceId) return;
      const entry = buildSwitchAuditEntry({
        id: db.collection("_ids").doc().id,
        now: Date.now(),
        fromUid: callerUid,
        fromEmail: String(caller?.email ?? ""),
        toUid: targetUid,
        toEmail: String(target?.email ?? ""),
        deviceId,
        outcome,
        reason,
      });
      await db
        .collection("user_data").doc(workspaceId)
        .collection("auditLogs").doc(entry.id)
        .set(entry)
        .catch(() => { /* never fail a switch because the audit write did */ });
    };

    const authz = authorizeSwitch({ callerUid, targetUid, caller, target });
    if (!authz.ok) {
      await audit("denied", authz.message);
      throw new HttpsError(authz.code, authz.message);
    }

    // RATE LIMIT, keyed by TARGET uid and held in Firestore rather than in
    // function memory: the thing being guessed is one person's 4-digit PIN, so
    // it must survive a cold start, span instances, and — the requirement —
    // be impossible to reset by reloading the page.
    const attemptRef = db
      .collection("user_data").doc(workspaceId)
      .collection("_switchAttempts").doc(targetUid);

    const now = Date.now();
    const attemptSnap = await attemptRef.get();
    const state: AttemptState = attemptSnap.exists
      ? { failures: (attemptSnap.data()?.failures as number[]) || [], cooldownUntil: attemptSnap.data()?.cooldownUntil }
      : EMPTY_ATTEMPTS;

    if (isCoolingDown(state, now)) {
      await audit("rate_limited");
      throw new HttpsError("resource-exhausted", cooldownMessage(state, now));
    }

    // Checked only after authorization, so the shape of the error tells an
    // unauthorized caller nothing.
    if (!hasPin(target)) {
      throw new HttpsError("failed-precondition", NO_PIN_MESSAGE);
    }

    const ok = await verifyPin(pin, {
      hash: target!.pinHash,
      salt: target!.pinSalt,
      iterations: target!.pinIterations,
    });

    if (!ok) {
      await attemptRef.set(recordFailure(state, now), { merge: false });
      await audit("wrong_pin");
      throw new HttpsError("permission-denied", WRONG_PIN_MESSAGE);
    }

    await attemptRef.set(recordSuccess(state), { merge: false });

    // A custom token, not a session: the client calls signInWithCustomToken
    // with it, which replaces the old session outright rather than layering a
    // second identity on top of it.
    let token: string;
    try {
      token = await admin.auth().createCustomToken(targetUid);
    } catch {
      throw new HttpsError("internal", GENERIC_DENY);
    }

    await audit("switched");
    return { ok: true, token, uid: targetUid, email: String(target!.email ?? "") };
  }
);
