import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { mirrorFor, mirrorInputsChanged, SourceUser } from "./kioskStaffPolicy";

// Shared Admin app (index.ts / backups.ts / staffUser.ts may also init it).
if (!admin.apps.length) admin.initializeApp();

/**
 * Keeps `user_data/{workspaceId}/kioskStaff/{uid}` in sync with `users/{uid}`.
 *
 * WHY A TRIGGER RATHER THAN A CALLABLE. The mirror has to stay correct across
 * four separate events — a kiosk PIN set, a PIN cleared, an account disabled
 * or re-enabled, and a name change — each of which happens through a
 * different code path in the app. A callable would have to be remembered at
 * every one of them, and the failure mode of forgetting is a door iPad that
 * still shows a tile for someone who left, or still accepts a PIN that was
 * revoked. A trigger on the source document cannot be forgotten.
 *
 * WHY THE MIRROR EXISTS AT ALL. firestore.rules keeps `users/{uid}` readable
 * only by that user and by owner/manager — deliberately, since it carries
 * hourlyRate, role, email and the app-unlock PIN hash. So a low-privilege
 * device account cannot match a PIN to a person from it, and must not be
 * given the ability to: an unattended iPad by the front door is effectively
 * public. The mirror holds only a display name and a punch-PIN hash, which is
 * everything the punch screen needs and nothing that is worth stealing.
 *
 * It is written ONLY here, with the Admin SDK. firestore.rules allows no
 * client write to kioskStaff at all, ever.
 */
export const syncKioskStaff = onDocumentWritten(
  { document: "users/{uid}", region: "us-central1" },
  async (event) => {
    const uid = event.params.uid;
    const before = event.data?.before?.data() as SourceUser | undefined;
    const after = event.data?.after?.data() as SourceUser | undefined;

    // A lastLogin stamp rewrites this document on every single sign-in. Skip
    // the work unless something the mirror actually derives from moved.
    if (before && after && !mirrorInputsChanged(before, after)) return;

    const db = admin.firestore();
    const action = mirrorFor(uid, after, Date.now());

    // The workspace to clean up in is whichever one the user was OR is in —
    // a role change or a (hypothetical) workspace move must not strand a
    // stale tile behind in the old one.
    const workspaces = new Set<string>();
    for (const u of [before, after]) {
      if (u && typeof u.workspaceId === "string" && u.workspaceId) workspaces.add(u.workspaceId);
    }

    const ref = (ws: string) =>
      db.collection("user_data").doc(ws).collection("kioskStaff").doc(uid);

    if (action.kind === "write") {
      const keep = action.doc.workspaceId;
      await ref(keep).set(action.doc);
      // Remove any mirror left behind in a workspace that is no longer theirs.
      await Promise.all([...workspaces]
        .filter(ws => ws !== keep)
        .map(ws => ref(ws).delete().catch(() => {})));
      return;
    }

    await Promise.all([...workspaces].map(ws => ref(ws).delete().catch(() => {})));
  }
);
