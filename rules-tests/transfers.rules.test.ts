import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { Role } from '../types';

/**
 * WHO MAY MOVE STOCK BETWEEN STORES — multi-store stage 4, server side.
 *
 * The check lives here and not only in the UI, and it follows the shape stages
 * 2 and 3 established (tillAllowed / selfPunchLocationOk): locationIds is the
 * list, an EMPTY list means the default store rather than no access, the owner
 * holds every store, and an empty list is not narrowed because rules cannot
 * resolve which store is the default.
 *
 * The three asymmetries that matter:
 *   • sending is the SENDING store's staff;
 *   • receiving is the RECEIVING store's staff and NEVER the sender — the
 *     two-step is what catches a device that never arrived;
 *   • cancelling is the sender or the owner, and NOT the receiving store,
 *     whose "it never arrived so I'll cancel it" would erase the discrepancy.
 */

const PROJECT_ID = 'ftt-transfers-rules-test';
const WS = 'owner-uid';
const BRAM = 'brampton';
const MISS = 'mississauga';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await testEnv?.cleanup(); });

const USERS: { uid: string; role: Role; locationIds?: string[] }[] = [
  { uid: WS, role: 'owner' },
  { uid: 'bram-uid', role: 'employee', locationIds: [BRAM] },
  { uid: 'bram2-uid', role: 'employee', locationIds: [BRAM] },
  { uid: 'miss-uid', role: 'employee', locationIds: [MISS] },
  { uid: 'both-uid', role: 'manager', locationIds: [BRAM, MISS] },
  { uid: 'nolist-uid', role: 'employee' },
  { uid: 'tech-uid', role: 'technician', locationIds: [BRAM] },
  { uid: 'kiosk-uid', role: 'kiosk' },
];

const IN_TRANSIT = {
  id: 't1', itemIds: ['d1'], fromLocationId: BRAM, toLocationId: MISS,
  status: 'in_transit', sentAt: Date.now(), sentBy: 'bram-uid', sentByEmail: 'bram@shop.test',
};

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const u of USERS) {
      await setDoc(doc(db, 'users', u.uid), {
        id: u.uid, email: `${u.uid}@shop.test`, role: u.role, workspaceId: WS, disabled: false,
        ...(u.locationIds ? { locationIds: u.locationIds } : {}),
      });
    }
    await setDoc(doc(db, 'user_data', WS, 'transfers', 't1'), IN_TRANSIT);
  });
});

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const transfer = (uid: string, id = 't1') => doc(as(uid), 'user_data', WS, 'transfers', id);
const send = (uid: string, from: string, to: string, extra: Record<string, unknown> = {}) => ({
  id: 'new1', itemIds: ['d9'], fromLocationId: from, toLocationId: to,
  status: 'in_transit', sentAt: Date.now(), sentBy: uid, ...extra,
});

describe('sending', () => {
  it('staff at the SENDING store may send from it', async () => {
    await assertSucceeds(setDoc(doc(as('bram-uid'), 'user_data', WS, 'transfers', 'new1'), send('bram-uid', BRAM, MISS)));
  });

  it('BUT NOT FROM THE OTHER STORE', async () => {
    await assertFails(setDoc(doc(as('miss-uid'), 'user_data', WS, 'transfers', 'new1'), send('miss-uid', BRAM, MISS)));
  });

  it('the owner may send from either', async () => {
    await assertSucceeds(setDoc(doc(as(WS), 'user_data', WS, 'transfers', 'new1'), send(WS, MISS, BRAM)));
  });

  it('somebody with no store list is not locked out', async () => {
    await assertSucceeds(setDoc(doc(as('nolist-uid'), 'user_data', WS, 'transfers', 'new1'), send('nolist-uid', BRAM, MISS)));
  });

  it('a dispatch cannot carry somebody ELSE as the sender', async () => {
    await assertFails(setDoc(doc(as('bram-uid'), 'user_data', WS, 'transfers', 'new1'), send('both-uid', BRAM, MISS)));
  });

  it('cannot be sent to the store it is already at', async () => {
    await assertFails(setDoc(doc(as('bram-uid'), 'user_data', WS, 'transfers', 'new1'), send('bram-uid', BRAM, BRAM)));
  });

  it('cannot arrive pre-received', async () => {
    await assertFails(setDoc(doc(as('bram-uid'), 'user_data', WS, 'transfers', 'new1'),
      send('bram-uid', BRAM, MISS, { receivedAt: Date.now(), receivedBy: 'bram-uid' })));
  });

  it('a technician and the kiosk cannot send at all', async () => {
    for (const uid of ['tech-uid', 'kiosk-uid']) {
      await assertFails(setDoc(doc(as(uid), 'user_data', WS, 'transfers', 'new1'), send(uid, BRAM, MISS)));
    }
  });
});

describe('receiving', () => {
  const receipt = (uid: string) => ({ status: 'received', receivedAt: Date.now(), receivedBy: uid, receivedByEmail: `${uid}@shop.test` });

  it('staff at the RECEIVING store may receive', async () => {
    await assertSucceeds(updateDoc(transfer('miss-uid'), receipt('miss-uid')));
  });

  it('THE SENDER CANNOT — the two-step is what catches a device that never arrived', async () => {
    await assertFails(updateDoc(transfer('bram-uid'), receipt('bram-uid')));
  });

  it('nor can another person at the SENDING store', async () => {
    await assertFails(updateDoc(transfer('bram2-uid'), receipt('bram2-uid')));
  });

  it('somebody who works BOTH stores may receive what they did not send', async () => {
    await assertSucceeds(updateDoc(transfer('both-uid'), receipt('both-uid')));
  });

  it('a receipt cannot be filed in someone else\'s name', async () => {
    await assertFails(updateDoc(transfer('miss-uid'), receipt('both-uid')));
  });

  it('receiving cannot rewrite where it came from or what was in it', async () => {
    await assertFails(updateDoc(transfer('miss-uid'), { ...receipt('miss-uid'), fromLocationId: MISS }));
    await assertFails(updateDoc(transfer('miss-uid'), { ...receipt('miss-uid'), itemIds: ['d1', 'd2'] }));
  });

  it('an already-received transfer cannot be received again', async () => {
    await assertSucceeds(updateDoc(transfer('miss-uid'), receipt('miss-uid')));
    await assertFails(updateDoc(transfer('miss-uid'), receipt('miss-uid')));
  });
});

describe('cancelling', () => {
  const cancel = (uid: string) => ({ status: 'cancelled', cancelledAt: Date.now(), cancelledBy: uid });

  it('THE SENDER may cancel — it never left', async () => {
    await assertSucceeds(updateDoc(transfer('bram-uid'), cancel('bram-uid')));
  });

  it('THE OWNER may cancel', async () => {
    await assertSucceeds(updateDoc(transfer(WS), cancel(WS)));
  });

  it('THE RECEIVING STORE MAY NOT — that would erase the discrepancy', async () => {
    await assertFails(updateDoc(transfer('miss-uid'), cancel('miss-uid')));
  });

  it('nor may an unrelated colleague at the sending store', async () => {
    await assertFails(updateDoc(transfer('bram2-uid'), cancel('bram2-uid')));
  });
});

describe('what a transfer record is', () => {
  it('every active member can see it, in or out', async () => {
    for (const uid of [WS, 'bram-uid', 'miss-uid', 'both-uid', 'tech-uid']) {
      await assertSucceeds(getDoc(transfer(uid)));
    }
  });

  it('the kiosk cannot', async () => {
    await assertFails(getDoc(transfer('kiosk-uid')));
  });

  it('AND NOBODY CAN DELETE ONE, not even the owner', async () => {
    for (const uid of [WS, 'bram-uid', 'both-uid']) {
      await assertFails(deleteDoc(transfer(uid)));
    }
  });
});
