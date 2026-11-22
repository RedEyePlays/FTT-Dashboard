import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { Role } from '../types';

/**
 * WHOLESALE OFFERS (domain/offers.ts).
 *
 * Two things this file exists to hold:
 *
 *  1. READ IS WIDER THAN WRITE, deliberately. Quick Sale reads offers on every
 *     cart to warn that a device is out on a quote, and that warning is the
 *     whole reason the record exists — an employee at the till who cannot read
 *     offers is an employee who sells the phone a buyer has just agreed to.
 *     Writing one is a selling activity, so it sits at the same tier as
 *     completing a sale; a technician holds no sales permission and may not.
 *
 *  2. AN OFFER MUST NEVER CARRY MONEY. No price, no agreed figure, no revenue,
 *     no sold flag. Revenue written anywhere but salesTransactions never
 *     reaches the P&L, the drawer, the dashboard or the daily close, so the
 *     rule REFUSES THE DOCUMENT rather than trusting every present and future
 *     client not to send one.
 *
 * Run with `npm run test:rules` (needs the Firestore emulator).
 */

const PROJECT_ID = 'ftt-dashboard-offers-rules-test';
const WS = 'owner-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});
afterAll(async () => { await testEnv?.cleanup(); });

const ROLES: [string, Role][] = [
  [WS, 'owner'], ['manager-uid', 'manager'], ['employee-uid', 'employee'],
  ['tech-uid', 'technician'], ['kiosk-uid', 'kiosk'],
];

const OFFER = {
  id: 'o1', buyerName: 'Rashid', buyerContact: '555-0100', date: '2026-11-20',
  status: 'open', lines: [{ itemId: 'd1', outcome: 'pending', grade: 'A', note: 'mint' }],
  notes: 'met at the mall', createdAt: 1, createdBy: WS,
};

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, role] of ROLES) {
      await setDoc(doc(db, 'users', uid), {
        id: uid, email: `${role}@shop.test`, role, workspaceId: WS, disabled: false,
      });
    }
    await setDoc(doc(db, 'users', 'other-owner'), {
      id: 'other-owner', email: 'other@shop.test', role: 'owner', workspaceId: 'other-ws', disabled: false,
    });
    await setDoc(doc(db, 'user_data', WS, 'offers', 'o1'), OFFER);
  });
});

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const anon = () => testEnv.unauthenticatedContext().firestore();
const offerDoc = (uid: string, id = 'o1') => doc(as(uid), 'user_data', WS, 'offers', id);

/* ======================================================================== *
 * READING — every active member, because the till needs it
 * ======================================================================== */

describe('reading offers', () => {
  for (const uid of [WS, 'manager-uid', 'employee-uid', 'tech-uid']) {
    it(`${uid} may read`, async () => {
      await assertSucceeds(getDoc(offerDoc(uid)));
    });
  }

  it('the KIOSK device may not — it reads nothing but the punch roster', async () => {
    await assertFails(getDoc(offerDoc('kiosk-uid')));
  });

  it('another workspace may not, and nor may an anonymous caller', async () => {
    await assertFails(getDoc(offerDoc('other-owner')));
    await assertFails(getDoc(doc(anon(), 'user_data', WS, 'offers', 'o1')));
  });
});

/* ======================================================================== *
 * WRITING — the tier that may sell
 * ======================================================================== */

describe('raising and editing an offer', () => {
  const fresh = (extra: Record<string, unknown> = {}) => ({ ...OFFER, id: 'o2', ...extra });

  for (const uid of [WS, 'manager-uid', 'employee-uid']) {
    it(`${uid} may raise one`, async () => {
      await assertSucceeds(setDoc(offerDoc(uid, 'o2'), fresh()));
    });
  }

  it('a TECHNICIAN may not — quoting a buyer is a selling activity', async () => {
    await assertFails(setDoc(offerDoc('tech-uid', 'o2'), fresh()));
  });

  it('the kiosk device may not', async () => {
    await assertFails(setDoc(offerDoc('kiosk-uid', 'o2'), fresh()));
  });

  it('another workspace may not', async () => {
    await assertFails(setDoc(offerDoc('other-owner', 'o2'), fresh()));
  });

  it('staff may add lines, grade them, decline them and close the offer', async () => {
    await assertSucceeds(updateDoc(offerDoc('employee-uid'), {
      lines: [
        { itemId: 'd1', outcome: 'declined', grade: 'B', note: 'scratch on the back' },
        { itemId: 'd2', outcome: 'pending', sentToSaleAt: 99 },
      ],
      updatedAt: 100,
      sentAt: 90,
      status: 'closed',
    }));
  });
});

/* ======================================================================== *
 * THE FIELD GUARD — no money, ever
 * ======================================================================== */

describe('an offer cannot carry money', () => {
  for (const [label, extra] of [
    ['an agreed lot price', { agreedPrice: 4200 }],
    ['revenue', { revenue: 4200 }],
    ['a total', { total: 4200 }],
    ['a sale price', { salePrice: 420 }],
    ['a sold flag', { sold: true }],
    ['a sale date', { soldDate: '2026-11-22' }],
    ['a transaction id', { transactionId: 'tx-1' }],
  ] as [string, Record<string, unknown>][]) {
    it(`refuses ${label} on create`, async () => {
      await assertFails(setDoc(offerDoc(WS, 'o2'), { ...OFFER, id: 'o2', ...extra }));
    });
    it(`refuses ${label} on update`, async () => {
      await assertFails(updateDoc(offerDoc(WS), extra));
    });
  }

  it('refuses a field nobody has thought of yet — the whitelist is the point', async () => {
    await assertFails(updateDoc(offerDoc(WS), { somethingNew: 'x' }));
  });

  it('refuses a status that is not open or closed', async () => {
    await assertFails(updateDoc(offerDoc(WS), { status: 'sold' }));
    await assertFails(updateDoc(offerDoc(WS), { status: 'part-sold' }));
  });

  it('refuses lines that are not a list, or an absurd number of them', async () => {
    await assertFails(updateDoc(offerDoc(WS), { lines: 'd1,d2' }));
    await assertFails(updateDoc(offerDoc(WS), {
      lines: Array.from({ length: 501 }, (_, k) => ({ itemId: `d${k}`, outcome: 'pending' })),
    }));
  });
});

/* ======================================================================== *
 * DELETING
 * ======================================================================== */

describe('deleting an offer', () => {
  it('the owner may', async () => {
    await assertSucceeds(deleteDoc(offerDoc(WS)));
  });

  it('nobody else may — it is the only record of what was quoted to whom', async () => {
    for (const uid of ['manager-uid', 'employee-uid', 'tech-uid', 'kiosk-uid']) {
      await assertFails(deleteDoc(offerDoc(uid)));
    }
  });
});
