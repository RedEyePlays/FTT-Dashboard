import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { Role } from '../types';

/**
 * A KIOSK CANNOT PUNCH FOR A STORE IT IS NOT — the server's half of
 * multi-store stage 3.
 *
 * This IS checkable in rules, and that is why the design puts the binding
 * where it does: a kiosk's store lives on its own DEVICE ACCOUNT
 * (`users/{kioskUid}.kioskLocationId`), set by the owner. Rules can read the
 * authenticated account, so a punch's `locationId` is checked against the
 * store the owner assigned that iPad — rather than against a device-local
 * value, which rules could not see and which would have made any check here
 * theatre.
 *
 * Also pinned:
 *
 *  • an UNCONFIGURED kiosk cannot write a punch at all (it does not fall back
 *    to the default store);
 *  • the device cannot move itself — no branch on /users lets a kiosk write
 *    its own kioskLocationId, and a staff member cannot write it either;
 *  • a shift's store is IMMUTABLE after clock-in on both punch paths, because
 *    neither update key list contains it;
 *  • an APP punch must be marked as the person's own claim and must name a
 *    store they actually work at.
 *
 * Run with `npm run test:rules`.
 */

const PROJECT_ID = 'ftt-dashboard-shift-location-rules-test';
const WORKSPACE = 'owner-uid';
const BRAMPTON = 'brampton';
const MISS = 'mississauga';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => { await testEnv?.cleanup(); });

const USERS: { uid: string; role: Role; extra?: Record<string, unknown> }[] = [
  { uid: WORKSPACE, role: 'owner' },
  { uid: 'manager-uid', role: 'manager' },
  // Works Brampton only.
  { uid: 'brampton-uid', role: 'employee', extra: { locationIds: [BRAMPTON] } },
  // Works both.
  { uid: 'both-uid', role: 'employee', extra: { locationIds: [BRAMPTON, MISS] } },
  // No list — the state every account is in today.
  { uid: 'nolist-uid', role: 'employee' },
  // Two iPads, one per shop, and one that nobody has configured.
  { uid: 'kiosk-bram', role: 'kiosk', extra: { kioskLocationId: BRAMPTON, kioskLocationName: 'Brampton' } },
  { uid: 'kiosk-miss', role: 'kiosk', extra: { kioskLocationId: MISS, kioskLocationName: 'Mississauga' } },
  { uid: 'kiosk-new', role: 'kiosk' },
];

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const u of USERS) {
      await setDoc(doc(db, 'users', u.uid), {
        id: u.uid, email: `${u.uid}@shop.test`, role: u.role, workspaceId: WORKSPACE, disabled: false,
        ...(u.extra || {}),
      });
    }
    for (const id of [BRAMPTON, MISS]) {
      await setDoc(doc(db, 'user_data', WORKSPACE, 'locations', id), {
        id, name: id, active: true, isDefault: id === BRAMPTON, createdAt: 1,
      });
    }
  });
});

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const entry = (uid: string, id: string) => doc(as(uid), 'user_data', WORKSPACE, 'timeEntries', id);

const kioskPunch = (id: string, userId: string, locationId?: string, locationSource = 'kiosk') => ({
  id, userId, clockIn: Date.now(), breaks: [], createdAt: Date.now(), source: 'kiosk',
  ...(locationId ? { locationId, locationSource } : {}),
});

const appPunch = (id: string, userId: string, locationId?: string, locationSource = 'self_selected') => ({
  id, userId, clockIn: Date.now(), breaks: [], createdAt: Date.now(),
  ...(locationId ? { locationId, locationSource } : {}),
});

describe('a kiosk punch carries the store the OWNER gave that iPad', () => {
  it('its own store: allowed', async () => {
    await assertSucceeds(setDoc(entry('kiosk-bram', 'e1'), kioskPunch('e1', 'both-uid', BRAMPTON)));
    await assertSucceeds(setDoc(entry('kiosk-miss', 'e2'), kioskPunch('e2', 'both-uid', MISS)));
  });

  it('THE OTHER SHOP\'S STORE: REFUSED', async () => {
    // The failure the stage exists to prevent, attempted directly: Brampton's
    // iPad claiming Mississauga's hours.
    await assertFails(setDoc(entry('kiosk-bram', 'e1'), kioskPunch('e1', 'both-uid', MISS)));
    await assertFails(setDoc(entry('kiosk-miss', 'e2'), kioskPunch('e2', 'both-uid', BRAMPTON)));
  });

  it('WHOEVER PUNCHES — a Brampton-only employee still files at the iPad\'s store', async () => {
    // The asymmetry with stage 2: the person's own store list does not decide
    // where their hours land. Mississauga's iPad files Mississauga even for
    // somebody rostered to Brampton.
    await assertSucceeds(setDoc(entry('kiosk-miss', 'e1'), kioskPunch('e1', 'brampton-uid', MISS)));
  });

  it('A PUNCH WITH NO STORE IS REFUSED — no silent fallback to the default', async () => {
    await assertFails(setDoc(entry('kiosk-bram', 'e1'), kioskPunch('e1', 'both-uid')));
  });

  it('AN UNCONFIGURED IPAD CANNOT PUNCH AT ALL', async () => {
    // With or without a location on the write. This is the server half of the
    // refusal the punch screen shows.
    await assertFails(setDoc(entry('kiosk-new', 'e1'), kioskPunch('e1', 'both-uid')));
    await assertFails(setDoc(entry('kiosk-new', 'e2'), kioskPunch('e2', 'both-uid', BRAMPTON)));
  });

  it('a device punch must SAY it is a device punch', async () => {
    // So it can never be mistaken later for somebody's own claim about where
    // they were — which is the distinction payroll is shown.
    await assertFails(setDoc(entry('kiosk-bram', 'e1'), kioskPunch('e1', 'both-uid', BRAMPTON, 'self_selected')));
  });
});

describe('THE IPAD CANNOT MOVE ITSELF', () => {
  it('a kiosk cannot write its own store', async () => {
    await assertFails(updateDoc(doc(as('kiosk-bram'), 'users', 'kiosk-bram'), { kioskLocationId: MISS }));
  });

  it('nor can an employee or a manager set one for it', async () => {
    for (const uid of ['brampton-uid', 'both-uid', 'manager-uid']) {
      await assertFails(updateDoc(doc(as(uid), 'users', 'kiosk-bram'), { kioskLocationId: MISS }));
    }
  });

  it('THE OWNER SETS IT', async () => {
    await assertSucceeds(updateDoc(doc(as(WORKSPACE), 'users', 'kiosk-new'),
      { kioskLocationId: MISS, kioskLocationName: 'Mississauga' }));
  });
});

describe('a shift belongs to where it started', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'user_data', WORKSPACE, 'timeEntries', 'open1'), {
        id: 'open1', userId: 'both-uid', clockIn: Date.now(), breaks: [], createdAt: Date.now(),
        source: 'kiosk', locationId: BRAMPTON, locationSource: 'kiosk',
      });
    });
  });

  it('a kiosk clock-out may not change the store, even its own', async () => {
    // kioskUpdateKeys is ['clockOut', 'breaks'] — the store is not in it, so a
    // device reconfigured (or carried) mid-shift cannot rewrite history.
    await assertSucceeds(updateDoc(entry('kiosk-bram', 'open1'), { clockOut: Date.now() }));
    await assertFails(updateDoc(entry('kiosk-bram', 'open1'), { clockOut: Date.now(), locationId: MISS }));
    await assertFails(updateDoc(entry('kiosk-miss', 'open1'), { clockOut: Date.now(), locationId: MISS }));
  });

  it('and neither may the person whose shift it is', async () => {
    await assertFails(updateDoc(entry('both-uid', 'open1'), { locationId: MISS }));
    await assertFails(updateDoc(entry('both-uid', 'open1'), { clockOut: Date.now(), locationId: MISS }));
    // Clocking out itself still works — from any device, without re-asking.
    await assertSucceeds(updateDoc(entry('both-uid', 'open1'), { clockOut: Date.now() }));
  });
});

describe('the app punch — a claim, checked for what it can be', () => {
  it('a store the person works at, marked as their own choice: allowed', async () => {
    await assertSucceeds(setDoc(entry('both-uid', 'e1'), appPunch('e1', 'both-uid', MISS)));
    await assertSucceeds(setDoc(entry('brampton-uid', 'e2'), appPunch('e2', 'brampton-uid', BRAMPTON)));
  });

  it('A STORE THEY DO NOT WORK AT: REFUSED', async () => {
    await assertFails(setDoc(entry('brampton-uid', 'e1'), appPunch('e1', 'brampton-uid', MISS)));
  });

  it('it cannot pass itself off as a device punch', async () => {
    await assertFails(setDoc(entry('both-uid', 'e1'), appPunch('e1', 'both-uid', MISS, 'kiosk')));
  });

  it('somebody with no store list is not locked out of their own time clock', async () => {
    // As in stage 2, an empty list means "the default store" and rules cannot
    // resolve which that is — so the restriction bites once the owner has
    // actually restricted somebody, and never before.
    await assertSucceeds(setDoc(entry('nolist-uid', 'e1'), appPunch('e1', 'nolist-uid', BRAMPTON)));
  });

  it('and a punch with no store at all still works — a workspace may have none', async () => {
    await assertSucceeds(setDoc(entry('both-uid', 'e1'), appPunch('e1', 'both-uid')));
  });

  it('nobody can punch for somebody else from the app', async () => {
    await assertFails(setDoc(entry('both-uid', 'e1'), appPunch('e1', 'brampton-uid', BRAMPTON)));
  });
});

describe('what this stage did NOT change', () => {
  it('a manager still corrects any shift', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'user_data', WORKSPACE, 'timeEntries', 'old1'), {
        id: 'old1', userId: 'both-uid', clockIn: Date.now() - 86_400_000, breaks: [],
        locationId: BRAMPTON, locationSource: 'kiosk',
      });
    });
    await assertSucceeds(updateDoc(entry('manager-uid', 'old1'), { clockOut: Date.now() }));
  });

  it('a kiosk still cannot delete an hours record', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'user_data', WORKSPACE, 'timeEntries', 'old1'), {
        id: 'old1', userId: 'both-uid', clockIn: Date.now(), breaks: [], locationId: BRAMPTON,
      });
    });
    await assertFails(updateDoc(entry('kiosk-bram', 'old1'), { userId: 'someone-else' }));
  });

  it('HISTORICAL ENTRIES WITH NO LOCATION STILL READ AND STILL CORRECT', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'user_data', WORKSPACE, 'timeEntries', 'hist1'), {
        id: 'hist1', userId: 'both-uid', clockIn: Date.now() - 86_400_000, breaks: [],
      });
    });
    await assertSucceeds(updateDoc(entry('manager-uid', 'hist1'), { clockOut: Date.now() }));
  });
});
