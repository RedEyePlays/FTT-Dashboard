import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { Role } from '../types';

/**
 * ONE CASH DRAWER PER STORE — the server's half (multi-store stage 2).
 *
 * The client resolves which store's till it is writing (hooks/useActiveStore.ts
 * + domain/drawerKey.ts). These are the two things the client cannot be trusted
 * with, so firestore.rules enforces them:
 *
 *  1. THE KEY AND THE FIELD AGREE. A write claiming Mississauga while landing
 *     on Brampton's document would put one store's cash on the other's day and
 *     leave the record itself saying otherwise.
 *
 *  2. A PERSON WRITES THEIR OWN STORE'S TILL, when the owner has set which
 *     stores they work at. An EMPTY list is deliberately NOT narrowed: it
 *     means "the default store", rules cannot resolve which store that is
 *     without a query, and locking the whole shop out of the till would be far
 *     worse than a rule that bites only once somebody is actually restricted.
 *
 * Also pinned here: a manager cannot grant themselves — or anyone — another
 * store, because no manager-writable branch on `users` names `locationIds`.
 * That needed no rules change; this is the test that says so, and that would
 * fail if one were ever widened.
 *
 * Run with `npm run test:rules`.
 */

const PROJECT_ID = 'ftt-dashboard-drawer-store-rules-test';
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

// 'brampton-uid' works Brampton only; 'both-uid' works both; 'nolist-uid' has
// no list at all, which is what every account holds today.
const ROLES: [string, Role, string[] | undefined][] = [
  [WORKSPACE, 'owner', [BRAMPTON]],
  ['manager-uid', 'manager', undefined],
  ['brampton-uid', 'employee', [BRAMPTON]],
  ['miss-uid', 'employee', [MISS]],
  ['both-uid', 'employee', [BRAMPTON, MISS]],
  ['nolist-uid', 'employee', undefined],
  ['empty-uid', 'employee', []],
  ['tech-uid', 'technician', [BRAMPTON]],
  ['kiosk-uid', 'kiosk', undefined],
];

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, role, locationIds] of ROLES) {
      await setDoc(doc(db, 'users', uid), {
        id: uid, email: `${uid}@shop.test`, role, workspaceId: WORKSPACE, disabled: false,
        ...(locationIds ? { locationIds } : {}),
      });
    }
    for (const id of [BRAMPTON, MISS]) {
      await setDoc(doc(db, 'user_data', WORKSPACE, 'locations', id), {
        id, name: id, active: true, isDefault: id === BRAMPTON, createdAt: 1,
      });
    }
    // One day, two stores, two documents — the shape stage 2 creates.
    for (const store of [BRAMPTON, MISS]) {
      await setDoc(doc(db, 'user_data', WORKSPACE, 'cashReconciliations', `2026-10-27__${store}`), {
        id: `2026-10-27__${store}`, date: '2026-10-27', locationId: store,
        expectedCash: 0, variance: 0, recordedBy: 'seed', recordedAt: 1,
      });
    }
    // And one bare-date document from before stage 2 — history is not re-keyed.
    await setDoc(doc(db, 'user_data', WORKSPACE, 'cashReconciliations', '2026-09-01'), {
      id: '2026-09-01', date: '2026-09-01', locationId: BRAMPTON,
      expectedCash: 0, variance: 0, recordedBy: 'seed', recordedAt: 1,
    });
  });
});

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const drawer = (uid: string, id: string) =>
  doc(as(uid), 'user_data', WORKSPACE, 'cashReconciliations', id);

const body = (id: string, date: string, locationId?: string) => ({
  id, date, ...(locationId ? { locationId } : {}),
  expectedCash: 0, variance: 0, recordedBy: 'x', recordedAt: 2,
});

describe('the key and the store field must agree', () => {
  it('a matching composite write is allowed', async () => {
    await assertSucceeds(setDoc(drawer('both-uid', '2026-10-28__brampton'),
      body('2026-10-28__brampton', '2026-10-28', BRAMPTON)));
  });

  it('A WRITE CLAIMING THE OTHER STORE IS REJECTED', async () => {
    // The failure this stage exists to prevent, attempted directly.
    await assertFails(setDoc(drawer('both-uid', '2026-10-28__brampton'),
      body('2026-10-28__brampton', '2026-10-28', MISS)));
  });

  it('a stored id that is not the document id is rejected', async () => {
    await assertFails(setDoc(drawer('both-uid', '2026-10-28__brampton'),
      body('2026-10-28__mississauga', '2026-10-28', BRAMPTON)));
  });

  it('a date that does not match the key is rejected', async () => {
    await assertFails(setDoc(drawer('both-uid', '2026-10-28__brampton'),
      body('2026-10-28__brampton', '2026-10-29', BRAMPTON)));
  });

  it('A BARE-DATE DOCUMENT IS STILL WRITABLE — history is not re-keyed, and the cutover day keeps its own id', async () => {
    await assertSucceeds(updateDoc(drawer('brampton-uid', '2026-09-01'), { openingFloat: 150 }));
    // Including one stamped with its store by stage 1's backfill.
    await assertSucceeds(setDoc(drawer('brampton-uid', '2026-09-03'),
      body('2026-09-03', '2026-09-03', BRAMPTON)));
  });

  it('an UNTAGGED write by a restricted person is refused, on purpose', async () => {
    // An untagged write can only ever land on a bare-date document, and a
    // bare-date document is the DEFAULT store's — so somebody rostered to
    // Mississauga only has no business making one. Brampton-only staff are
    // refused here for the same reason read the other way: the write does not
    // say which till it is for, and guessing is how cash ends up in the wrong
    // drawer. A refused cash write is loud (App.tsx's writeFailed); cash
    // quietly logged against the wrong store is not.
    await assertFails(setDoc(drawer('miss-uid', '2026-09-02'), body('2026-09-02', '2026-09-02')));
    await assertFails(setDoc(drawer('brampton-uid', '2026-09-02'), body('2026-09-02', '2026-09-02')));
    // Somebody with no list set is NOT caught by this — that is the state
    // every account is in today, and it is not a lockout.
    await assertSucceeds(setDoc(drawer('nolist-uid', '2026-09-02'), body('2026-09-02', '2026-09-02')));
  });
});

describe('a person writes their own store\'s till', () => {
  it('their own store: yes', async () => {
    await assertSucceeds(updateDoc(drawer('miss-uid', '2026-10-27__mississauga'), { openingFloat: 100 }));
  });

  it('THE OTHER STORE: NO', async () => {
    await assertFails(updateDoc(drawer('miss-uid', '2026-10-27__brampton'), { openingFloat: 100 }));
  });

  it('somebody on both stores may write either', async () => {
    await assertSucceeds(updateDoc(drawer('both-uid', '2026-10-27__brampton'), { openingFloat: 100 }));
    await assertSucceeds(updateDoc(drawer('both-uid', '2026-10-27__mississauga'), { openingFloat: 100 }));
  });

  it('the OWNER may write any store\'s drawer, whatever their own list says', async () => {
    await assertSucceeds(updateDoc(drawer(WORKSPACE, '2026-10-27__mississauga'), { openingFloat: 100 }));
  });

  it('NO LIST IS NOT A LOCKOUT — the state every account is in today', async () => {
    await assertSucceeds(updateDoc(drawer('nolist-uid', '2026-10-27__brampton'), { openingFloat: 100 }));
    await assertSucceeds(updateDoc(drawer('empty-uid', '2026-10-27__brampton'), { openingFloat: 100 }));
    // And a legacy bare-date day, which is where every existing record is.
    await assertSucceeds(updateDoc(drawer('nolist-uid', '2026-09-01'), { openingFloat: 100 }));
  });

  it('a restricted person is still blocked from the OTHER store\'s legacy days', async () => {
    // A bare-date document is the default store's, so Mississauga-only staff
    // have no business writing it.
    await assertFails(updateDoc(drawer('miss-uid', '2026-09-01'), { openingFloat: 100 }));
  });
});

describe('who may touch the drawer at all — unchanged by this stage', () => {
  it('every human member still READS every store\'s drawer', async () => {
    for (const uid of [WORKSPACE, 'manager-uid', 'miss-uid', 'tech-uid']) {
      await assertSucceeds(getDoc(drawer(uid, '2026-10-27__brampton')));
    }
  });

  it('a technician still cannot write one', async () => {
    await assertFails(updateDoc(drawer('tech-uid', '2026-10-27__brampton'), { openingFloat: 100 }));
  });

  it('the kiosk device still cannot read or write one', async () => {
    await assertFails(getDoc(drawer('kiosk-uid', '2026-10-27__brampton')));
    await assertFails(updateDoc(drawer('kiosk-uid', '2026-10-27__brampton'), { openingFloat: 100 }));
  });

  it('only the owner deletes a day', async () => {
    await assertFails(updateDoc(drawer('both-uid', '2026-10-27__brampton'), { date: '2026-10-28' }));
  });
});

describe('A MANAGER CANNOT GRANT THEMSELVES — OR ANYONE — ANOTHER STORE', () => {
  const userDoc = (uid: string, target: string) => doc(as(uid), 'users', target);

  it('not on their own account', async () => {
    await assertFails(updateDoc(userDoc('manager-uid', 'manager-uid'), { locationIds: [BRAMPTON, MISS] }));
  });

  it('not on a technician\'s, the one account they may otherwise edit', async () => {
    // The manager branch on /users is hasOnly(['disabled']) — this is what
    // keeps store access out of their reach without a rules change.
    await assertFails(updateDoc(userDoc('manager-uid', 'tech-uid'), { locationIds: [MISS] }));
  });

  it('nor can an employee give themselves the other store', async () => {
    await assertFails(updateDoc(userDoc('miss-uid', 'miss-uid'), { locationIds: [BRAMPTON, MISS] }));
  });

  it('THE OWNER SETS IT', async () => {
    await assertSucceeds(updateDoc(userDoc(WORKSPACE, 'miss-uid'), { locationIds: [BRAMPTON, MISS] }));
    // And may clear it back to "the default store", which is not a lockout.
    await assertSucceeds(updateDoc(userDoc(WORKSPACE, 'miss-uid'), { locationIds: [] }));
  });
});
