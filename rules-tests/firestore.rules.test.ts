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
  // NOTE: the two cases this block originally pinned (employee reconcile,
  // employee void) are now legitimately ALLOWED — employees hold
  // cash.reconcile / sales.void / sales.return since the end-to-end
  // operational grant (services/rbac.ts). They moved to the
  // "employee operational permissions" describe below. What this block still
  // proves is the part that did NOT change: settings, staffNotes and unlisted
  // collections stay denied, i.e. removing the catch-all is still what's
  // holding those closed.

  it('manager write to cashReconciliations reconcile fields is ALLOWED', async () => {
    const db = asManager();
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'cashReconciliations', 'today'),
      { reconciledAt: Date.now(), reconciledBy: 'manager-uid', countedCash: 120 }, { merge: true }));
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

describe('expense ledger — the expenses.add / expenses.viewAll split', () => {
  const mineDoc = () => ({
    id: 'own1', date: '2026-07-01', amount: 40, category: 'rent', paymentMethod: 'cash',
    enteredBy: 'manager-uid', enteredByEmail: 'manager@shop.test', createdAt: Date.now(),
  });
  const theirsDoc = () => ({
    id: 'other1', date: '2026-07-01', amount: 99, category: 'rent', paymentMethod: 'cash',
    enteredBy: 'employee-uid', enteredByEmail: 'employee@shop.test', createdAt: Date.now(),
  });
  // Seeded with rules disabled: these exist regardless of who may write them.
  const seedExpenses = async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'user_data', WORKSPACE, 'expenses', 'own1'), mineDoc());
      await setDoc(doc(db, 'user_data', WORKSPACE, 'expenses', 'other1'), theirsDoc());
    });
  };

  it('MANAGER may CREATE an expense — but only stamped with their OWN enteredBy', async () => {
    await assertSucceeds(setDoc(doc(asManager(), 'user_data', WORKSPACE, 'expenses', 'm-new'),
      { ...mineDoc(), id: 'm-new' }));
    // Filing one under someone else's name is DENIED.
    await assertFails(setDoc(doc(asManager(), 'user_data', WORKSPACE, 'expenses', 'm-forged'),
      { ...theirsDoc(), id: 'm-forged' }));
  });

  it('MANAGER reading their OWN expense is ALLOWED', async () => {
    await seedExpenses();
    const { getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(asManager(), 'user_data', WORKSPACE, 'expenses', 'own1')));
  });

  it('MANAGER EDITING another user\'s expense is DENIED (the airtight, server-enforced half)', async () => {
    await seedExpenses();
    await assertFails(setDoc(doc(asManager(), 'user_data', WORKSPACE, 'expenses', 'other1'),
      { amount: 1 }, { merge: true }));
  });

  it('MANAGER DELETING another user\'s expense is DENIED', async () => {
    await seedExpenses();
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(asManager(), 'user_data', WORKSPACE, 'expenses', 'other1')));
  });

  it('MANAGER may edit and delete their OWN expense', async () => {
    await seedExpenses();
    const { deleteDoc } = await import('firebase/firestore');
    await assertSucceeds(setDoc(doc(asManager(), 'user_data', WORKSPACE, 'expenses', 'own1'),
      { amount: 41 }, { merge: true }));
    await assertSucceeds(deleteDoc(doc(asManager(), 'user_data', WORKSPACE, 'expenses', 'own1')));
  });

  it('MANAGER may not REASSIGN an expense\'s enteredBy away from themselves', async () => {
    await seedExpenses();
    await assertFails(setDoc(doc(asManager(), 'user_data', WORKSPACE, 'expenses', 'own1'),
      { ...mineDoc(), enteredBy: 'employee-uid' }));
  });

  /**
   * DOCUMENTED, DELIBERATE GAP — read is manager-wide, not own-entries-only.
   *
   * Restricting a manager's READ to `enteredBy == uid` would also truncate
   * their live `expenses` subscription (Firestore evaluates read rules per
   * document even for a collection query), which is the exact array
   * domain/reports.ts's profitAndLoss subtracts — the manager's net profit
   * would then silently OMIT everyone else's spend and be overstated. A wrong
   * P&L is worse than a manager being able to read a peer's expense doc, so
   * the "my submitted expenses only" scoping is applied client-side in
   * ExpensesTab while WRITE stays enforced here. This test asserts the real
   * behavior rather than a guarantee the implementation does not provide.
   */
  it('MANAGER reading another user\'s expense is ALLOWED — the documented read-side gap (write stays denied)', async () => {
    await seedExpenses();
    const { getDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(asManager(), 'user_data', WORKSPACE, 'expenses', 'other1')));
  });

  it('EMPLOYEE has NO expense access at all — cannot read or write any expense', async () => {
    await seedExpenses();
    const { getDoc, deleteDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'expenses', 'other1')));  // not even their OWN
    await assertFails(getDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'expenses', 'own1')));
    await assertFails(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'expenses', 'e-new'),
      { id: 'e-new', amount: 10, enteredBy: 'employee-uid' }));
    await assertFails(deleteDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'expenses', 'other1')));
  });

  it('TECHNICIAN still has no expense access', async () => {
    await seedExpenses();
    const { getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(asTech(), 'user_data', WORKSPACE, 'expenses', 'own1')));
    await assertFails(setDoc(doc(asTech(), 'user_data', WORKSPACE, 'expenses', 't1'), { id: 't1', amount: 10 }));
  });

  it('OWNER reads and mutates every expense, whoever entered it', async () => {
    await seedExpenses();
    const { getDoc, deleteDoc } = await import('firebase/firestore');
    await assertSucceeds(getDoc(doc(asOwner(), 'user_data', WORKSPACE, 'expenses', 'own1')));
    await assertSucceeds(getDoc(doc(asOwner(), 'user_data', WORKSPACE, 'expenses', 'other1')));
    await assertSucceeds(setDoc(doc(asOwner(), 'user_data', WORKSPACE, 'expenses', 'other1'), { amount: 1 }, { merge: true }));
    await assertSucceeds(deleteDoc(doc(asOwner(), 'user_data', WORKSPACE, 'expenses', 'other1')));
  });

  it('recurringExpenses (incl. the variable-amount templates) is OWNER-ONLY configuration', async () => {
    await assertSucceeds(setDoc(doc(asOwner(), 'user_data', WORKSPACE, 'recurringExpenses', 'r1'),
      { id: 'r1', category: 'rent', amount: 1500, amountMode: 'fixed', paymentMethod: 'etransfer', frequency: 'monthly', startDate: '2026-01-01', active: true, createdBy: WORKSPACE, createdByEmail: 'owner@shop.test', createdAt: Date.now() }));
    await assertSucceeds(setDoc(doc(asOwner(), 'user_data', WORKSPACE, 'recurringExpenses', 'r-var'),
      { id: 'r-var', category: 'utilities', amount: 0, amountMode: 'variable', estimatedAmount: 140, paymentMethod: 'etransfer', frequency: 'monthly', startDate: '2026-01-01', active: true, createdBy: WORKSPACE, createdByEmail: 'owner@shop.test', createdAt: Date.now() }));
    // Everyone else — manager included — is shut out of the schedule config.
    const { getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(asManager(), 'user_data', WORKSPACE, 'recurringExpenses', 'r1')));
    await assertFails(setDoc(doc(asManager(), 'user_data', WORKSPACE, 'recurringExpenses', 'r2'), { id: 'r2', amount: 10 }));
    await assertFails(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'recurringExpenses', 'r3'), { id: 'r3', amount: 10 }));
    await assertFails(setDoc(doc(asTech(), 'user_data', WORKSPACE, 'recurringExpenses', 'r4'), { id: 'r4', amount: 10 }));
  });
});

/**
 * PART 1 of the employee-permissions change: the five operational actions an
 * employee gained (sales.void, sales.return, inventory.edit, cash.reconcile,
 * dropoffs.manage) must actually work SERVER-SIDE, and the
 * manager/owner-only set must stay shut. These are the emulator cases the PR
 * body quotes.
 */
describe('employee operational permissions (granted)', () => {
  it('employee can VOID a sale (status -> voided, with attribution)', async () => {
    await assertSucceeds(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'salesTransactions', 'sale1'),
      { status: 'voided', voidedAt: Date.now(), voidedBy: 'employee-uid', voidedByEmail: 'employee@shop.test' }, { merge: true }));
  });

  it('employee can RETURN a sale (status -> returned, with attribution)', async () => {
    await assertSucceeds(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'salesTransactions', 'sale1'),
      { status: 'returned', returnedAt: Date.now(), returnedBy: 'employee-uid', returnedByEmail: 'employee@shop.test', refundAmount: 100 }, { merge: true }));
  });

  it('employee can RECONCILE the drawer (write reconcile fields on cashReconciliations)', async () => {
    await assertSucceeds(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'cashReconciliations', 'today'),
      { reconciledAt: Date.now(), reconciledBy: 'employee-uid', reconciledByEmail: 'employee@shop.test', countedCash: 120, note: 'end of shift' }, { merge: true }));
  });

  it('employee can EDIT an inventory item they created', async () => {
    await assertSucceeds(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'inventory', 'item1'),
      { sku: 'FTT-0001', deviceStatus: 'ready' }));
    await assertSucceeds(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'inventory', 'item1'),
      { deviceStatus: 'repair', item: 'iPhone 13 (edited)' }, { merge: true }));
  });

  it('employee can ACCEPT a drop-off and SETTLE a device buyer', async () => {
    await assertSucceeds(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'dropOffs', 'd1'),
      { id: 'd1', buyerId: 'b1', item: 'Pixel 8', status: 'accepted', acceptedBy: 'employee-uid', acceptedByEmail: 'employee@shop.test', acceptedAt: Date.now() }));
    await assertSucceeds(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'runners', 'b1'), { id: 'b1', name: 'Device buyer' }));
    await assertSucceeds(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'settlements', 's1'),
      { id: 's1', buyerId: 'b1', amountPaid: 300, settledBy: 'employee-uid', settledByEmail: 'employee@shop.test', settledAt: Date.now() }));
  });

  // NOTE: "employee can LOG AN EXPENSE" used to live here. That grant has been
  // REVOKED — expense amounts are cost/profit-sensitive, so the employee role
  // lost expense access entirely in the expenses.add / expenses.viewAll split.
  // The replacement assertions (employee create AND read both DENIED) are in
  // the expense-ledger describe above; this is the pointer so the removal
  // reads as deliberate rather than a dropped case.
  it('employee can no longer LOG AN EXPENSE — the one operational grant that was rolled back', async () => {
    await assertFails(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'expenses', 'e2'),
      { id: 'e2', date: '2026-07-01', amount: 40, category: 'supplies', paymentMethod: 'cash', enteredBy: 'employee-uid', enteredByEmail: 'employee@shop.test', createdAt: Date.now() }));
  });
});

describe('employee restrictions that must NOT have widened', () => {
  it('employee cannot write settings (meta.settings stays owner-only)', async () => {
    await assertFails(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'meta', 'app'),
      { settings: { shopName: 'Hacked' } }, { merge: true }));
  });

  it('employee cannot read or write staffNotes (owner-only)', async () => {
    const { getDoc } = await import('firebase/firestore');
    await assertFails(getDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'staffNotes', 'note1')));
    await assertFails(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'staffNotes', 'note2'), { text: 'nope' }));
  });

  it("employee cannot write another user's timeEntry", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'user_data', WORKSPACE, 'timeEntries', 't-mgr'),
        { id: 't-mgr', userId: 'manager-uid', userEmail: 'manager@shop.test', clockIn: Date.now() });
    });
    await assertFails(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'timeEntries', 't-mgr'),
      { clockOut: Date.now() }, { merge: true }));
    await assertFails(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'timeEntries', 't-new'),
      { id: 't-new', userId: 'manager-uid', userEmail: 'manager@shop.test', clockIn: Date.now(), breaks: [], createdAt: Date.now() }));
  });

  it('employee cannot write users docs (their own role, or anyone else)', async () => {
    await assertFails(setDoc(doc(asEmployee(), 'users', 'employee-uid'), { role: 'owner' }, { merge: true }));
    await assertFails(setDoc(doc(asEmployee(), 'users', 'tech-uid'), { disabled: true }, { merge: true }));
    await assertFails(setDoc(doc(asEmployee(), 'users', 'employee-uid'),
      { pinHash: 'x', pinSalt: 'y', pinIterations: 1, pinUpdatedAt: Date.now(), pinUpdatedBy: 'employee-uid', pinUpdatedByEmail: 'employee@shop.test' }, { merge: true }));
  });

  it('employee cannot delete inventory (inventory.delete stays owner-only)', async () => {
    const { deleteDoc } = await import('firebase/firestore');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'user_data', WORKSPACE, 'inventory', 'del1'), { sku: 'FTT-9' });
    });
    await assertFails(deleteDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'inventory', 'del1')));
  });

  it('employee cannot mark a pay period paid or approved (payroll stays manager+/owner)', async () => {
    await assertFails(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'payPeriods', 'p9'), { periodEnd: '2026-01-15' }));
    await assertFails(setDoc(doc(asEmployee(), 'user_data', WORKSPACE, 'payPeriodApprovals', 'a9'), { periodEnd: '2026-01-15' }));
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
