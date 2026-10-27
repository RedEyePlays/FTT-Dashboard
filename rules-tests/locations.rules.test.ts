import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, getDocs, collection, setDoc, updateDoc } from 'firebase/firestore';
import { Role } from '../types';

/**
 * STORES — multi-store stage 1.
 *
 * Read by every active member (pickers need the list from stage 2 on, and a
 * location is a name and an address), written by the owner alone, and NEVER
 * deleted by anybody: a deleted location orphans every device, sale, repair
 * and shift pointing at it with no way left to say where any of it happened.
 *
 * The other half of this file is the stage's own promise: ADDING THE FIELD DID
 * NOT CHANGE WHO MAY READ WHAT. Tightening rules by location mid-migration
 * would lock staff out of every record not yet backfilled, so a record with a
 * location and a record without one are equally readable to exactly the same
 * people as before.
 *
 * Run with `npm run test:rules`.
 */

const PROJECT_ID = 'ftt-dashboard-locations-rules-test';
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
    await setDoc(doc(db, 'users', 'other-owner'), {
      id: 'other-owner', email: 'other@shop.test', role: 'owner', workspaceId: 'other-ws', disabled: false,
    });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'locations', 'brampton'), {
      id: 'brampton', name: 'Brampton', active: true, isDefault: true, createdAt: 1,
    });
    // Two devices: one backfilled, one not. Both must read the same to the
    // same people — that is stage 1's promise.
    await setDoc(doc(db, 'user_data', WORKSPACE, 'inventory', 'tagged'), {
      id: 'tagged', sku: 'PHN-1', item: 'iPhone 13', locationId: 'brampton',
    });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'inventory', 'untagged'), {
      id: 'untagged', sku: 'PHN-2', item: 'iPhone 14',
    });
  });
});

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const LOC = (uid: string) => doc(as(uid), 'user_data', WORKSPACE, 'locations', 'brampton');

describe('reading the store list', () => {
  it('every active member can — including an employee and a technician', async () => {
    // A staff member who cannot read the list cannot be shown which store a
    // record belongs to, which is what stage 2 onward needs.
    for (const uid of [WORKSPACE, 'manager-uid', 'employee-uid', 'tech-uid']) {
      await assertSucceeds(getDoc(LOC(uid)));
    }
  });

  it('and can list them, which is what a picker does', async () => {
    await assertSucceeds(getDocs(collection(as('employee-uid'), 'user_data', WORKSPACE, 'locations')));
  });

  it('the KIOSK cannot — activeMemberOf excludes it', async () => {
    await assertFails(getDoc(LOC('kiosk-uid')));
  });

  it('a signed-out user cannot', async () => {
    await assertFails(getDoc(doc(anon(), 'user_data', WORKSPACE, 'locations', 'brampton')));
  });

  it("another workspace's owner cannot", async () => {
    await assertFails(getDoc(doc(as('other-owner'), 'user_data', WORKSPACE, 'locations', 'brampton')));
  });

  it('a disabled owner cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'users', 'manager-uid'), { disabled: true });
    });
    await assertFails(getDoc(LOC('manager-uid')));
  });
});

describe('opening, renaming and closing a store is the owner alone', () => {
  const draft = { id: 'mississauga', name: 'Mississauga', active: true, createdAt: 2 };

  it('the owner may create one', async () => {
    await assertSucceeds(setDoc(doc(as(WORKSPACE), 'user_data', WORKSPACE, 'locations', 'mississauga'), draft));
  });

  it('the owner may rename and close one', async () => {
    await assertSucceeds(updateDoc(LOC(WORKSPACE), { name: 'Brampton North' }));
    await assertSucceeds(updateDoc(LOC(WORKSPACE), { active: false }));
  });

  it('A MANAGER MAY NOT — opening a store is a decision about the business', async () => {
    await assertFails(setDoc(doc(as('manager-uid'), 'user_data', WORKSPACE, 'locations', 'mississauga'), draft));
    await assertFails(updateDoc(LOC('manager-uid'), { name: 'Nope' }));
  });

  it('nobody else may either', async () => {
    for (const uid of ['employee-uid', 'tech-uid', 'kiosk-uid']) {
      await assertFails(setDoc(doc(as(uid), 'user_data', WORKSPACE, 'locations', 'mississauga'), draft));
      await assertFails(updateDoc(LOC(uid), { name: 'Nope' }));
    }
  });
});

describe('A LOCATION CANNOT BE HARD-DELETED, BY ANYBODY', () => {
  it('not even the owner', async () => {
    // Closing a store is `active: false`, which keeps every record pointing at
    // it readable. There is no deleteLocation in services/firestoreDb.ts
    // either — this is the second lock, on the stored copy.
    await assertFails(deleteDoc(LOC(WORKSPACE)));
  });

  it('and not any other role', async () => {
    for (const uid of ['manager-uid', 'employee-uid', 'tech-uid', 'kiosk-uid']) {
      await assertFails(deleteDoc(LOC(uid)));
    }
  });

  it('a closed location is still readable, and its records still resolve', async () => {
    await assertSucceeds(updateDoc(LOC(WORKSPACE), { active: false, isDefault: false }));
    const snap = await getDoc(LOC('employee-uid'));
    expect(snap.exists()).toBe(true);
    expect(snap.data()!.name).toBe('Brampton');
    // The device pointing at it is untouched and still reads.
    await assertSucceeds(getDoc(doc(as('employee-uid'), 'user_data', WORKSPACE, 'inventory', 'tagged')));
  });
});

describe("ADDING THE FIELD DID NOT CHANGE WHO MAY READ WHAT", () => {
  it('a backfilled record and an un-backfilled one read identically', async () => {
    // The stage's promise. If these ever differ, a half-finished migration has
    // started locking staff out of their own records.
    for (const uid of [WORKSPACE, 'manager-uid', 'employee-uid']) {
      for (const id of ['tagged', 'untagged']) {
        await assertSucceeds(getDoc(doc(as(uid), 'user_data', WORKSPACE, 'inventory', id)));
      }
    }
  });

  it('writing a record WITH a location is allowed exactly as without one', async () => {
    const base = { id: 'new1', sku: 'PHN-9', item: 'iPhone 15', date: '2026-10-27' };
    await assertSucceeds(setDoc(doc(as('employee-uid'), 'user_data', WORKSPACE, 'inventory', 'new1'), base));
    await assertSucceeds(setDoc(
      doc(as('employee-uid'), 'user_data', WORKSPACE, 'inventory', 'new2'),
      { ...base, id: 'new2', locationId: 'brampton' },
    ));
  });

  it('a record may be stamped with ANY location string — no rule validates it yet', async () => {
    // Deliberate for stage 1: validating the reference would reject a write
    // from a client whose location list has not synced, and nothing reads the
    // field yet. Stage 2 onward can tighten it once pickers exist.
    await assertSucceeds(updateDoc(
      doc(as('employee-uid'), 'user_data', WORKSPACE, 'inventory', 'untagged'),
      { locationId: 'not-a-real-location' },
    ));
  });
});
