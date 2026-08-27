import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { setDoc, doc, deleteDoc } from 'firebase/firestore';

/**
 * Regression test for the timeEntries ownership hole: the old rule granted
 * create/update to `isStaffOf(ws)` (owner/manager/EMPLOYEE, no ownership
 * check at all) OR a technician writing their own entry. An employee could
 * write ANY coworker's timeEntry directly — backdate/extend their own hours,
 * or alter someone else's — backwards from every other trust boundary in
 * this file, where technician is the MORE restricted role.
 *
 * Run with `npm run test:rules` (spins up the Firestore emulator via
 * `firebase emulators:exec` — not part of the default `npm test`, see
 * rules-tests/vitest.config.ts).
 */

const PROJECT_ID = 'ftt-dashboard-timeentries-rules-test';
const WORKSPACE = 'owner-uid';

let testEnv: RulesTestEnvironment;
// Fixed per-run timestamps, reused for both seeding and later update payloads
// — self-service updates spread `...open` in the real app (App.tsx), so
// clockIn/createdAt never actually change value on a legitimate clock-out/
// break update. Calling Date.now() again at update time would drift by a
// few ms and spuriously trip the "only clockOut/breaks/userEmail changed"
// check below — a test artifact, not a rules bug.
let employeeClockIn = 0;
let employeeCreatedAt = 0;

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
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', WORKSPACE), { id: WORKSPACE, email: 'owner@shop.test', role: 'owner', workspaceId: WORKSPACE, disabled: false });
    await setDoc(doc(db, 'users', 'manager-uid'), { id: 'manager-uid', email: 'manager@shop.test', role: 'manager', workspaceId: WORKSPACE, disabled: false });
    await setDoc(doc(db, 'users', 'employee-uid'), { id: 'employee-uid', email: 'employee@shop.test', role: 'employee', workspaceId: WORKSPACE, disabled: false });
    await setDoc(doc(db, 'users', 'coworker-uid'), { id: 'coworker-uid', email: 'coworker@shop.test', role: 'employee', workspaceId: WORKSPACE, disabled: false });
    await setDoc(doc(db, 'users', 'tech-uid'), { id: 'tech-uid', email: 'tech@shop.test', role: 'technician', workspaceId: WORKSPACE, disabled: false });

    // A pre-existing open shift for the coworker, and one for the employee
    // themselves, used by the update-path tests below.
    await setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'coworker-open'),
      { id: 'coworker-open', userId: 'coworker-uid', userEmail: 'coworker@shop.test', clockIn: Date.now() - 3600_000, breaks: [], createdAt: Date.now() - 3600_000 });
    employeeClockIn = Date.now() - 3600_000;
    employeeCreatedAt = employeeClockIn;
    await setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-open'),
      { id: 'employee-open', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: employeeClockIn, breaks: [], createdAt: employeeCreatedAt });
    // An employee entry with a missed clock-out, for the manager-correction test.
    const yesterday = Date.now() - 26 * 3600_000;
    await setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-missed'),
      { id: 'employee-missed', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: yesterday, breaks: [], createdAt: yesterday });
  });
});

const asManager = () => testEnv.authenticatedContext('manager-uid').firestore();
const asEmployee = () => testEnv.authenticatedContext('employee-uid').firestore();
const asTech = () => testEnv.authenticatedContext('tech-uid').firestore();

describe('timeEntries — ownership + skew enforcement', () => {
  it('employee creating an entry with another user\'s userId is DENIED', async () => {
    const db = asEmployee();
    await assertFails(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'forged'),
      { id: 'forged', userId: 'coworker-uid', userEmail: 'x', clockIn: Date.now(), breaks: [], createdAt: Date.now() }));
  });

  it('employee updating a coworker\'s entry is DENIED', async () => {
    const db = asEmployee();
    await assertFails(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'coworker-open'),
      { id: 'coworker-open', userId: 'coworker-uid', userEmail: 'coworker@shop.test', clockIn: Date.now() - 3600_000, breaks: [], createdAt: Date.now() - 3600_000, clockOut: Date.now() }));
  });

  it('employee back-dating a self clock-in well before request.time is DENIED', async () => {
    const db = asEmployee();
    const wayBack = Date.now() - 8 * 3600_000; // 8 hours ago — far outside the skew allowance
    await assertFails(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'backdated'),
      { id: 'backdated', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: wayBack, breaks: [], createdAt: Date.now() }));
  });

  it('employee normal clock-in (create, self, clockIn close to now) is ALLOWED', async () => {
    const db = asEmployee();
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'clockin-ok'),
      { id: 'clockin-ok', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: Date.now(), breaks: [], createdAt: Date.now() }));
  });

  it('employee normal clock-out on their own open entry is ALLOWED', async () => {
    const db = asEmployee();
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-open'),
      { id: 'employee-open', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: employeeClockIn, breaks: [], createdAt: employeeCreatedAt, clockOut: Date.now() }));
  });

  it('employee starting/ending a break on their own open entry is ALLOWED', async () => {
    const db = asEmployee();
    const withBreak = { id: 'employee-open', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: employeeClockIn, createdAt: employeeCreatedAt, breaks: [{ id: 'b1', start: Date.now(), reason: 'lunch' }] };
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-open'), withBreak));
  });

  it('employee setting a self clock-out far in the future to inflate hours is DENIED', async () => {
    const db = asEmployee();
    const farFuture = Date.now() + 8 * 3600_000;
    await assertFails(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-open'),
      { id: 'employee-open', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: employeeClockIn, breaks: [], createdAt: employeeCreatedAt, clockOut: farFuture }));
  });

  it('employee trying to move their own entry\'s userId to someone else is DENIED', async () => {
    const db = asEmployee();
    await assertFails(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-open'),
      { id: 'employee-open', userId: 'coworker-uid', userEmail: 'employee@shop.test', clockIn: employeeClockIn, breaks: [], createdAt: employeeCreatedAt }));
  });

  it('employee writing a corrections field into their own entry is DENIED', async () => {
    const db = asEmployee();
    await assertFails(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-open'),
      { id: 'employee-open', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: employeeClockIn, breaks: [], createdAt: employeeCreatedAt, clockOut: Date.now(),
        corrections: [{ correctedBy: 'employee-uid', correctedAt: Date.now(), toClockOut: Date.now() }] }));
  });

  it('manager correcting an employee\'s missed clock-out is ALLOWED', async () => {
    const db = asManager();
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-missed'),
      { id: 'employee-missed', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: Date.now() - 26 * 3600_000, breaks: [], createdAt: Date.now() - 26 * 3600_000,
        clockOut: Date.now() - 25 * 3600_000, corrections: [{ correctedBy: 'manager-uid', correctedAt: Date.now(), toClockOut: Date.now() - 25 * 3600_000 }] }));
  });

  it('manager creating/backdating an entry for another user (no skew restriction — the manager correction flow needs this) is ALLOWED', async () => {
    const db = asManager();
    const wayBack = Date.now() - 8 * 3600_000;
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'manager-created'),
      { id: 'manager-created', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: wayBack, breaks: [], createdAt: Date.now() }));
  });

  it('technician clock-in/out on their own entry is ALLOWED', async () => {
    const db = asTech();
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'tech-own'),
      { id: 'tech-own', userId: 'tech-uid', userEmail: 'tech@shop.test', clockIn: Date.now(), breaks: [], createdAt: Date.now() }));
  });

  it('technician writing another user\'s entry is DENIED', async () => {
    const db = asTech();
    await assertFails(setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'coworker-open'),
      { id: 'coworker-open', userId: 'coworker-uid', userEmail: 'coworker@shop.test', clockIn: Date.now() - 3600_000, breaks: [], createdAt: Date.now() - 3600_000, clockOut: Date.now() }));
  });

  it('only the owner may delete a timeEntry — manager is DENIED', async () => {
    const db = asManager();
    await assertFails(deleteDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-open')));
  });

  it('every active member may read all timeEntries (deliberate — see firestore.rules comment)', async () => {
    const db = asEmployee();
    await assertSucceeds((await import('firebase/firestore')).getDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'coworker-open')));
  });
});
