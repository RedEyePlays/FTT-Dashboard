#!/usr/bin/env node
/*
 * OPTIONAL one-time provisioning / merge script (Firebase Admin SDK).
 *
 * You do NOT need this for a normal single-owner setup: the app auto-creates a
 * users/{uid} profile on first login (Owner of their own workspace), and no
 * existing shop data moves (paths are unchanged). See MIGRATION.md.
 *
 * Use this ONLY to:
 *   - pre-provision users/roles before people log in, or
 *   - MERGE pre-existing separate accounts into one shared shop (workspace),
 *     which the in-app invite flow cannot do after those accounts already exist.
 *
 * ------------------------------------------------------------------------
 * HOW TO RUN
 * ------------------------------------------------------------------------
 * 1. Firebase Console -> Project settings -> Service accounts ->
 *    "Generate new private key". Save the JSON somewhere private.
 * 2. In a scratch folder (NOT committed):
 *      npm init -y
 *      npm i firebase-admin
 *      export GOOGLE_APPLICATION_CREDENTIALS=/abs/path/serviceAccount.json
 * 3. Edit OWNER_UID and MEMBERS below (get uids from Firebase Console ->
 *    Authentication -> Users).
 * 4. Dry run first, then apply:
 *      node scripts/provision-users.mjs            # prints what it would do
 *      node scripts/provision-users.mjs --apply    # writes to Firestore
 *
 * NEVER ship the service account key in the frontend or commit it.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// ---------------------------- EDIT THESE ----------------------------
// The account whose uid becomes the shared workspace id (all shop data lives
// under user_data/{OWNER_UID}). For an existing shop, use the current owner.
const OWNER_UID = 'REPLACE_WITH_OWNER_UID';

// Everyone who should belong to this shop, with their role.
// Roles: 'owner' | 'manager' | 'employee'
const MEMBERS = [
  { uid: OWNER_UID, email: 'owner@example.com', role: 'owner' },
  // { uid: 'MANAGER_UID', email: 'manager@example.com', role: 'manager' },
  // { uid: 'EMPLOYEE_UID', email: 'employee@example.com', role: 'employee', allowProfit: false },
];
// --------------------------------------------------------------------

const APPLY = process.argv.includes('--apply');

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

async function main() {
  if (OWNER_UID.startsWith('REPLACE')) {
    console.error('Set OWNER_UID (and MEMBERS) before running.');
    process.exit(1);
  }
  console.log(`Workspace = ${OWNER_UID}\nMode = ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`);

  for (const m of MEMBERS) {
    const doc = {
      id: m.uid,
      email: m.email,
      role: m.role,
      workspaceId: OWNER_UID,          // <-- this is what merges accounts into one shop
      disabled: false,
      ...(m.allowProfit !== undefined ? { allowProfit: m.allowProfit } : {}),
      createdAt: Date.now(),
    };
    console.log(`${APPLY ? 'writing' : 'would write'} users/${m.uid} -> role=${m.role}, workspaceId=${OWNER_UID}`);
    if (APPLY) await db.collection('users').doc(m.uid).set(doc, { merge: true });
  }

  // OPTIONAL: if a merged account previously stored its own data under
  // user_data/{theirUid}, that data is NOT moved by this script. Reassigning
  // their workspaceId only changes which shop they SEE going forward. If you
  // need to move that old data into the owner's workspace, copy the sub-
  // collection docs from user_data/{theirUid}/* to user_data/{OWNER_UID}/*
  // (uncomment and adapt copyWorkspace below).

  console.log(`\nDone. ${APPLY ? 'Users provisioned.' : 'Re-run with --apply to write.'}`);
}

// async function copyWorkspace(fromUid, toUid) {
//   const collections = ['inventory','accessories','salesTransactions','customers','dropOffs','runners','settlements','activityLog','auditLogs'];
//   for (const c of collections) {
//     const snap = await db.collection('user_data').doc(fromUid).collection(c).get();
//     for (const d of snap.docs) {
//       await db.collection('user_data').doc(toUid).collection(c).doc(d.id).set(d.data(), { merge: true });
//     }
//     console.log(`copied ${snap.size} docs from ${c}`);
//   }
// }

main().catch(e => { console.error(e); process.exit(1); });
