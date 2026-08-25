import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { buildTechRepairUpdate } from "./repairUpdate";

// Shared Admin app (aiGenerate/backups/repairLookup may also init it).
if (!admin.apps.length) admin.initializeApp();

interface TechUpdateRequest {
  repairId?: unknown;
  draft?: Record<string, unknown>;
}

/**
 * The ONLY write path a technician has for a repair ticket now that
 * firestore.rules' techRepairKeys() excludes completedAt/warrantyUntil from
 * direct client writes (see the comment there). Previously a technician
 * could write any value to those two fields straight from dev tools —
 * backdating completion to inflate their own Tech Performance turnaround
 * stats, or setting an arbitrary warranty end date. buildTechRepairUpdate
 * (repairUpdate.ts) re-derives both server-side from this function's own
 * clock and the ticket's real warrantyDays, and never trusts a client-
 * supplied value for either — see that module for the full guard.
 */
export const techUpdateRepair = onCall(
  { region: "us-central1" },
  async (request: CallableRequest<TechUpdateRequest>) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "You must be signed in.");
    }
    const uid = request.auth.uid;
    const db = admin.firestore();

    const userSnap = await db.collection("users").doc(uid).get();
    const user = userSnap.data() as { role?: string; workspaceId?: string; disabled?: boolean } | undefined;
    if (!user || user.disabled || user.role !== "technician" || !user.workspaceId) {
      throw new HttpsError("permission-denied", "Only an active technician may use this.");
    }
    const workspaceId = user.workspaceId;

    const repairId = String(request.data?.repairId ?? "").trim();
    if (!repairId) {
      throw new HttpsError("invalid-argument", "Missing repairId.");
    }

    const repairRef = db.collection("user_data").doc(workspaceId).collection("repairs").doc(repairId);
    const repairSnap = await repairRef.get();
    if (!repairSnap.exists) {
      throw new HttpsError("not-found", "Repair ticket not found.");
    }

    const update = buildTechRepairUpdate(
      repairSnap.data() as Record<string, unknown>,
      request.data?.draft || {},
      uid,
      Date.now(),
    );

    await repairRef.set(update, { merge: true });
    return { ok: true };
  }
);
