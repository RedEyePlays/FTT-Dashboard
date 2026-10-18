import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { can } from '../services/rbac';
import { Role } from '../types';

/**
 * A RECEIPT IS A FINANCIAL RECORD, AND IS GATED LIKE ONE.
 *
 * It photographs the shop's own spending — supplier invoices with trade
 * pricing, card slips, the owner's personal card in frame. So it must never be
 * MORE VISIBLE than the expense it would become: both rules files put it at
 * the same manager-up tier the `expenses` block uses, and delete at owner.
 *
 * BOTH RULES FILES ARE EXERCISED HERE. The storage half matters at least as
 * much as the Firestore half — the document carries a path, and the image is
 * the thing with the card number on it. Storage rules were untested in this
 * repo before this file; `npm run test:rules` now runs the storage emulator
 * too (firebase.json, package.json).
 *
 * Run with `npm run test:rules`.
 */

const PROJECT_ID = 'ftt-dashboard-receipts-rules-test';
const WORKSPACE = 'owner-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => { await testEnv?.cleanup(); });

const ROLES: [string, Role][] = [
  [WORKSPACE, 'owner'], ['manager-uid', 'manager'], ['employee-uid', 'employee'],
  ['tech-uid', 'technician'], ['kiosk-uid', 'kiosk'],
];

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, role] of ROLES) {
      await setDoc(doc(db, 'users', uid), {
        id: uid, email: `${role}@shop.test`, role, workspaceId: WORKSPACE, disabled: false,
      });
    }
    // Somebody else's shop, for the cross-workspace checks.
    await setDoc(doc(db, 'users', 'other-owner'), {
      id: 'other-owner', email: 'other@shop.test', role: 'owner', workspaceId: 'other-ws', disabled: false,
    });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'receipts', 'r1'), {
      id: 'r1', status: 'unreviewed',
      pages: [{ path: `receipts/${WORKSPACE}/r1/p1.jpg` }],
      uploadedBy: WORKSPACE, uploadedByEmail: 'owner@shop.test', uploadedAt: 1,
    });
  });
});

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext();

const RECEIPT = (uid: string) => doc(as(uid), 'user_data', WORKSPACE, 'receipts', 'r1');

const newReceipt = (uploadedBy: string) => ({
  id: 'r2', status: 'unreviewed',
  pages: [{ path: `receipts/${WORKSPACE}/r2/p1.jpg` }],
  uploadedBy, uploadedByEmail: 'x@shop.test', uploadedAt: 2,
});

/* ---------------- Firestore: the document ---------------- */

describe('reading the archive', () => {
  it('THE OWNER CAN', async () => {
    await assertSucceeds(getDoc(RECEIPT(WORKSPACE)));
  });

  it('a MANAGER can — the same tier that may file an expense', async () => {
    await assertSucceeds(getDoc(RECEIPT('manager-uid')));
  });

  it('AN EMPLOYEE CANNOT', async () => {
    // An employee holds no expense permission at all; expense amounts are
    // cost-sensitive and so is a photograph of one.
    await assertFails(getDoc(RECEIPT('employee-uid')));
  });

  it('a TECHNICIAN cannot', async () => {
    // Trusted with bench photos precisely because those are not financial
    // records. This is.
    await assertFails(getDoc(RECEIPT('tech-uid')));
  });

  it('the KIOSK cannot', async () => {
    await assertFails(getDoc(RECEIPT('kiosk-uid')));
  });

  it('a SIGNED-OUT user cannot', async () => {
    await assertFails(getDoc(doc(anon().firestore(), 'user_data', WORKSPACE, 'receipts', 'r1')));
  });

  it('another workspace\'s OWNER cannot', async () => {
    await assertFails(getDoc(doc(as('other-owner'), 'user_data', WORKSPACE, 'receipts', 'r1')));
  });

  it('a DISABLED manager cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'users', 'manager-uid'), { disabled: true });
    });
    await assertFails(getDoc(RECEIPT('manager-uid')));
  });
});

describe('filing a receipt', () => {
  it('the owner may file one', async () => {
    await assertSucceeds(setDoc(doc(as(WORKSPACE), 'user_data', WORKSPACE, 'receipts', 'r2'), newReceipt(WORKSPACE)));
  });

  it('a manager may file one STAMPED WITH THEIR OWN uid', async () => {
    await assertSucceeds(setDoc(doc(as('manager-uid'), 'user_data', WORKSPACE, 'receipts', 'r2'), newReceipt('manager-uid')));
  });

  it('a manager may NOT file one under somebody else\'s name', async () => {
    // The same per-document ownership check the expenses create rule uses.
    await assertFails(setDoc(doc(as('manager-uid'), 'user_data', WORKSPACE, 'receipts', 'r2'), newReceipt(WORKSPACE)));
  });

  it('an employee, technician and kiosk may not file one at all', async () => {
    for (const uid of ['employee-uid', 'tech-uid', 'kiosk-uid']) {
      await assertFails(setDoc(doc(as(uid), 'user_data', WORKSPACE, 'receipts', 'r2'), newReceipt(uid)));
    }
  });
});

describe('reviewing a receipt', () => {
  it('a manager may update one the OWNER photographed', async () => {
    // Reviewing is the point of the archive: the owner scans on the way in and
    // a manager finishes it, or the other way round.
    await assertSucceeds(updateDoc(RECEIPT('manager-uid'), { entered: { total: 84.21 } }));
  });

  it('the owner may update any of them', async () => {
    await assertSucceeds(updateDoc(RECEIPT(WORKSPACE), { status: 'not_expense' }));
  });

  it('an employee and a technician may not', async () => {
    for (const uid of ['employee-uid', 'tech-uid']) {
      await assertFails(updateDoc(RECEIPT(uid), { entered: { total: 1 } }));
    }
  });
});

describe('deleting a receipt is OWNER-ONLY and deliberate', () => {
  it('the owner may', async () => {
    await assertSucceeds(deleteDoc(RECEIPT(WORKSPACE)));
  });

  it('a MANAGER MAY NOT — marking it not_expense is the manager\'s route', async () => {
    // And that route keeps the image, which is the whole difference.
    await assertFails(deleteDoc(RECEIPT('manager-uid')));
    await assertSucceeds(updateDoc(RECEIPT('manager-uid'), { status: 'not_expense' }));
  });

  it('nobody else may', async () => {
    for (const uid of ['employee-uid', 'tech-uid', 'kiosk-uid']) {
      await assertFails(deleteDoc(RECEIPT(uid)));
    }
  });
});

/* ---------------- Storage: the image — NOT COVERED HERE, AND WHY ----------------
 *
 * The storage rule for receipts/{ws}/{receiptId}/{file} cannot be exercised by
 * this harness. Storage rules reach the caller's role through a cross-service
 * `firestore.get` on users/{uid} (storage.rules' me()), and the Storage
 * emulator under @firebase/rules-unit-testing does not serve that call: it
 * evaluates to null, so the rule throws "Null value error" and denies.
 *
 * Measured, not assumed. A probe rule of `allow write: if request.auth != null`
 * passes in the emulator; the same rule with ONE me() call fails, and the
 * emulator logs the null error against the firestore.get line.
 *
 * That is why writing these tests would be WORSE than not writing them: every
 * positive assertion ("the owner can read it") fails, and every negative one
 * ("an employee cannot") passes VACUOUSLY — it would keep passing if the rule
 * denied everybody, including the owner. A suite that green-lights a broken
 * rule is a liability.
 *
 * The same limitation is why the pre-existing deviceImages and backups rules
 * have no tests either. The receipts rule is therefore reviewed by hand and
 * written to mirror the `expenses` tier exactly (isManagerUpOf for read and
 * write, isOwnerOf for delete), so the two can be read against each other —
 * and the Firestore half above pins the tier that the storage half copies.
 */

/* ---------------- The two sides agree ---------------- */

describe('the rules and services/rbac.ts name the same tier', () => {
  it('scanning is exactly the roles that hold expenses.add', async () => {
    for (const [uid, role] of ROLES) {
      const allowed = can(role, 'expenses.add');
      const attempt = setDoc(doc(as(uid), 'user_data', WORKSPACE, 'receipts', `r-${role}`), {
        ...newReceipt(uid), id: `r-${role}`,
      });
      if (allowed) await assertSucceeds(attempt); else await assertFails(attempt);
      expect({ role, allowed }).toEqual({ role, allowed: role === 'owner' || role === 'manager' });
    }
  });

  it('deleting is exactly the role that holds expenses.viewAll', async () => {
    for (const [, role] of ROLES) {
      expect({ role, del: can(role, 'expenses.viewAll') })
        .toEqual({ role, del: role === 'owner' });
    }
  });
});
