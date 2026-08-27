import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { setDoc, doc } from 'firebase/firestore';

/**
 * Regression test for the OR-semantics catch-all bug: a recursive
 * `match /{document=**}` under `user_data/{ws}` independently granted
 * `isStaffOf(ws)` write / `activeMemberOf(ws)` read to EVERY document in the
 * workspace, including ones with their own stricter dedicated block —
 * Firestore rules are OR'd, so the existence of a stricter block does nothing
 * to narrow a separate rule that also matches and also allows. Every case
 * below failed (i.e. the forbidden operation SUCCEEDED) before the catch-all
 * was replaced with an enumerated, no-default-access set of collection
 * blocks. They must all pass now.
 *
 * Run with `npm run test:rules` (spins up the Firestore emulator via
 * `firebase emulators:exec`, which is why this file is NOT part of the
 * default `npm test` — see vitest.config.ts's exclude — the emulator needs a
 * JVM and a running process this repo's normal unit tests don't require, and
 * per this repo's own firestore.rules comment, rules "cannot be exercised in
 * CI" here).
 */

const PROJECT_ID = 'ftt-dashboard-rules-test';
const WORKSPACE = 'owner-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  // Seed the user registry (users/{uid}) as an admin context, bypassing rules
  // — this is workspace setup, not part of what's under test.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', WORKSPACE), { id: WORKSPACE, email: 'owner@shop.test', role: 'owner', workspaceId: WORKSPACE, disabled: false });
    await setDoc(doc(db, 'users', 'manager-uid'), { id: 'manager-uid', email: 'manager@shop.test', role: 'manager', workspaceId: WORKSPACE, disabled: false });
    await setDoc(doc(db, 'users', 'employee-uid'), { id: 'employee-uid', email: 'employee@shop.test', role: 'employee', workspaceId: WORKSPACE, disabled: false });
    await setDoc(doc(db, 'users', 'tech-uid'), { id: 'tech-uid', email: 'tech@shop.test', role: 'technician', workspaceId: WORKSPACE, disabled: false });
    // Pre-existing records the DENIED-mutation tests attempt to alter.
    await setDoc(doc(db, 'user_data', WORKSPACE, 'cashReconciliations', 'today'), { date: '2026-01-01' });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'salesTransactions', 'sale1'), { status: 'completed', total: 100 });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'meta', 'app'), { notes: [] });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'staffNotes', 'note1'), { text: 'hi' });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'repairs', 'r1'), { status: 'in_progress' });
  });
});

const asOwner = () => testEnv.authenticatedContext(WORKSPACE).firestore();
const asManager = () => testEnv.authenticatedContext('manager-uid').firestore();
const asEmployee = () => testEnv.authenticatedContext('employee-uid').firestore();
const asTech = () => testEnv.authenticatedContext('tech-uid').firestore();

describe('the catch-all cannot resurrect access a dedicated block denies', () => {
  it('employee write to cashReconciliations reconcile fields is DENIED', async () => {
    const db = asEmployee();
    await assertFails(setDoc(doc(db, 'user_data', WORKSPACE, 'cashReconciliations', 'today'),
      { reconciledAt: Date.now(), reconciledBy: 'employee-uid', countedCash: 120 }, { merge: true }));
  });

  it('manager write to cashReconciliations reconcile fields is ALLOWED', async () => {
    const db = asManager();
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'cashReconciliations', 'today'),
      { reconciledAt: Date.now(), reconciledBy: 'manager-uid', countedCash: 120 }, { merge: true }));
  });

  it("employee update of salesTransactions status to 'voided' is DENIED", async () => {
    const db = asEmployee();
    await assertFails(setDoc(doc(db, 'user_data', WORKSPACE, 'salesTransactions', 'sale1'),
      { status: 'voided' }, { merge: true }));
  });

  it("manager update of salesTransactions status to 'voided' is ALLOWED", async () => {
    const db = asManager();
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'salesTransactions', 'sale1'),
      { status: 'voided' }, { merge: true }));
  });

  it('employee write to meta touching settings is DENIED', async () => {
    const db = asEmployee();
    await assertFails(setDoc(doc(db, 'user_data', WORKSPACE, 'meta', 'app'),
      { settings: { shopName: 'Hacked' } }, { merge: true }));
  });

  it('owner write to meta touching settings is ALLOWED', async () => {
    const db = asOwner();
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'meta', 'app'),
      { settings: { shopName: 'Legit' } }, { merge: true }));
  });

  it('technician read of staffNotes is DENIED', async () => {
    const { getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(asTech(), 'user_data', WORKSPACE, 'staffNotes', 'note1')));
  });

  it('owner read of staffNotes is ALLOWED', async () => {
    const { getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(asOwner(), 'user_data', WORKSPACE, 'staffNotes', 'note1')));
  });
});

describe('legitimate flows still work after removing the catch-all', () => {
  it('employee create of an inventory item is ALLOWED', async () => {
    const db = asEmployee();
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'inventory', 'item1'),
      { sku: 'FTT-0001', deviceStatus: 'ready' }));
  });

  it('employee completing a sale (create salesTransactions) is ALLOWED', async () => {
    const db = asEmployee();
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'salesTransactions', 'sale2'),
      { status: 'completed', total: 50 }));
  });

  it('employee logging a cash movement (no reconcile fields) is ALLOWED', async () => {
    const db = asEmployee();
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'cashReconciliations', 'today2'),
      { date: '2026-01-02', cashIn: [{ amount: 20 }] }));
  });

  it('technician update within techRepairKeys is ALLOWED', async () => {
    const db = asTech();
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'repairs', 'r1'),
      { status: 'picked_up' }, { merge: true }));
  });

  it('technician update outside techRepairKeys is DENIED', async () => {
    const db = asTech();
    await assertFails(setDoc(doc(db, 'user_data', WORKSPACE, 'repairs', 'r1'),
      { repairPrice: 999 }, { merge: true }));
  });

  // The three collections that had NO dedicated block and relied entirely on
  // the catch-all — customers, activityLog, payPeriods — needed their own
  // rule once the catch-all was removed, or these would now be DENIED for
  // everyone, including legitimate staff.
  it('staff write to customers is ALLOWED', async () => {
    await assertSucceeds(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'customers', 'c1'), { name: 'Jane' }));
  });
  it('technician write to customers is DENIED (read-only)', async () => {
    await assertFails(setDoc(doc(asTech(), 'user_data', WORKSPACE, 'customers', 'c1'), { name: 'Jane' }));
  });
  it('staff write to activityLog is ALLOWED', async () => {
    await assertSucceeds(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'activityLog', 'a1'), { ts: Date.now(), type: 'sale' }));
  });
  // payPeriods (mark-paid records) is owner-only, matching the app's own
  // canMarkPaid gating: only the owner may sign a period off as paid.
  // Manager (payroll.manage tier) can approve (payPeriodApprovals below)
  // but not mark paid.
  it('owner write to payPeriods is ALLOWED', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), 'user_data', WORKSPACE, 'payPeriods', 'p1'), { periodEnd: '2026-01-15' }));
  });
  it('manager write to payPeriods is DENIED (owner-only, matches canMarkPaid in the UI)', async () => {
    await assertFails(setDoc(doc(asManager(), 'user_data', WORKSPACE, 'payPeriods', 'p1'), { periodEnd: '2026-01-15' }));
  });
  it('manager write to payPeriodApprovals is ALLOWED (payroll.manage tier)', async () => {
    await assertSucceeds(setDoc(doc(asManager(), 'user_data', WORKSPACE, 'payPeriodApprovals', 'a1'), { periodEnd: '2026-01-15' }));
  });
  it('employee write to payPeriodApprovals is DENIED', async () => {
    await assertFails(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'payPeriodApprovals', 'a1'), { periodEnd: '2026-01-15' }));
  });

  // A collection that genuinely has no rule at all must now be denied outright
  // — the whole point of enumerating instead of wildcarding.
  it('an unlisted collection is DENIED even for the owner', async () => {
    await assertFails(setDoc(doc(asOwner(), 'user_data', WORKSPACE, 'somethingNobodyDeclared', 'x'), { a: 1 }));
  });
});

describe('auditLogs stays append-only (tightened while here)', () => {
  it('create is ALLOWED for any active member', async () => {
    await assertSucceeds(setDoc(doc(asTech(), 'user_data', WORKSPACE, 'auditLogs', 'log1'), { ts: Date.now(), action: 'clock_in' }));
  });
  it('update of an existing audit log entry is DENIED, even for the owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'user_data', WORKSPACE, 'auditLogs', 'log2'), { ts: 1, action: 'clock_in' });
    });
    await assertFails(setDoc(doc(asOwner(), 'user_data', WORKSPACE, 'auditLogs', 'log2'), { action: 'edited' }, { merge: true }));
  });
});
