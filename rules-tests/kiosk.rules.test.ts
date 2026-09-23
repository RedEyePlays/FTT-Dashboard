import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { setDoc, getDoc, getDocs, collection, doc, deleteDoc, updateDoc, query, where, orderBy, limit } from 'firebase/firestore';

/**
 * The kiosk device account must be worthless if the iPad is stolen.
 *
 * These tests deliberately lead with the DENIALS — an "allow" test passing
 * proves the punch screen works, but it is the denials that prove the device
 * can't be turned into a data leak. The specific hazard being closed is that
 * every previous role check was written as "not a technician" or "any active
 * member", both of which a new role silently satisfies.
 *
 * Run with `npm run test:rules` (spins up the Firestore emulator via
 * `firebase emulators:exec` — not part of the default `npm test`).
 */

const PROJECT_ID = 'ftt-dashboard-kiosk-rules-test';
const WORKSPACE = 'owner-uid';

let testEnv: RulesTestEnvironment;
let openClockIn = 0;

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
    await setDoc(doc(db, 'users', 'employee-uid'), { id: 'employee-uid', email: 'employee@shop.test', role: 'employee', workspaceId: WORKSPACE, disabled: false });
    await setDoc(doc(db, 'users', 'kiosk-uid'), { id: 'kiosk-uid', email: 'kiosk@shop.test', role: 'kiosk', workspaceId: WORKSPACE, disabled: false });
    await setDoc(doc(db, 'users', 'revoked-kiosk-uid'), { id: 'revoked-kiosk-uid', email: 'old@shop.test', role: 'kiosk', workspaceId: WORKSPACE, disabled: true });

    // A representative document in every collection the kiosk must not read.
    await setDoc(doc(db, 'user_data', WORKSPACE, 'inventory', 'i1'), { id: 'i1', item: 'iPhone', purchaseCost: 400 });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'salesTransactions', 't1'), { id: 't1', totalPaid: 500 });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'customers', 'c1'), { id: 'c1', name: 'A Customer', phone: '555' });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'repairs', 'r1'), { id: 'r1', repairNumber: 'RPR-1' });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'expenses', 'x1'), { id: 'x1', amount: 100 });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'payPeriods', 'p1'), { id: 'p1', userId: 'employee-uid', gross: 900 });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'staffBonuses', 'b1'), { id: 'b1', userId: 'employee-uid', amount: 250 });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'cashReconciliations', '2026-09-19'), { id: '2026-09-19', expectedCash: 500 });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'auditLogs', 'a1'), { id: 'a1', action: 'sale.complete' });

    // The punch roster (written only by the syncKioskStaff Admin-SDK trigger).
    await setDoc(doc(db, 'user_data', WORKSPACE, 'kioskStaff', 'employee-uid'),
      { id: 'employee-uid', uid: 'employee-uid', displayName: 'Ali', workspaceId: WORKSPACE, active: true, pinHash: 'h', pinSalt: 's', pinIterations: 150000, updatedAt: Date.now() });

    openClockIn = Date.now() - 3600_000;
    await setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-open'),
      { id: 'employee-open', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: openClockIn, breaks: [], createdAt: openClockIn, source: 'kiosk' });
    // A shift left open from two days ago — nobody fixes that at the iPad.
    const twoDaysAgo = Date.now() - 50 * 3600_000;
    await setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-stale'),
      { id: 'employee-stale', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: twoDaysAgo, breaks: [], createdAt: twoDaysAgo });
    // THE WEEKEND CASE: clocked in Friday morning, back Monday morning, never
    // clocked out. 72 hours — outside the old two-day window, which is why the
    // punch screen could not see it and offered a second clock-in.
    const fridayMorning = Date.now() - 72 * 3600_000;
    await setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-friday'),
      { id: 'employee-friday', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: fridayMorning, breaks: [], createdAt: fridayMorning });
    // Genuinely old. Past the read window by any measure.
    const lastMonth = Date.now() - 30 * 24 * 3600_000;
    await setDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-ancient'),
      { id: 'employee-ancient', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: lastMonth, breaks: [], createdAt: lastMonth });
  });
});

const asKiosk = () => testEnv.authenticatedContext('kiosk-uid').firestore();
const asRevokedKiosk = () => testEnv.authenticatedContext('revoked-kiosk-uid').firestore();
const asEmployee = () => testEnv.authenticatedContext('employee-uid').firestore();
const asOwner = () => testEnv.authenticatedContext(WORKSPACE).firestore();

/* ---------------- The denials ---------------- */

describe('a kiosk is denied read on every collection except its own two', () => {
  const denied: [string, string][] = [
    ['inventory', 'i1'],
    ['salesTransactions', 't1'],
    ['customers', 'c1'],
    ['repairs', 'r1'],
    ['expenses', 'x1'],
    ['payPeriods', 'p1'],
    ['staffBonuses', 'b1'],
    ['cashReconciliations', '2026-09-19'],
    ['auditLogs', 'a1'],
  ];

  for (const [coll, id] of denied) {
    it(`cannot read ${coll}`, async () => {
      await assertFails(getDoc(doc(asKiosk(), 'user_data', WORKSPACE, coll, id)));
    });
    it(`cannot list ${coll} either`, async () => {
      await assertFails(getDocs(collection(asKiosk(), 'user_data', WORKSPACE, coll)));
    });
  }

  it('cannot read another user profile — no wage, no role, no email', async () => {
    await assertFails(getDoc(doc(asKiosk(), 'users', 'employee-uid')));
  });

  it('cannot read the workspace settings document', async () => {
    await assertFails(getDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'meta', 'app')));
  });
});

describe('a kiosk is denied every shop WRITE', () => {
  it('cannot write inventory', async () => {
    await assertFails(setDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'inventory', 'i2'), { id: 'i2', item: 'stolen' }));
  });
  it('cannot write a sale', async () => {
    await assertFails(setDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'salesTransactions', 't2'), { id: 't2', totalPaid: 1 }));
  });
  it('cannot write a customer', async () => {
    await assertFails(setDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'customers', 'c2'), { id: 'c2', name: 'x' }));
  });
  it('cannot write the cash drawer', async () => {
    await assertFails(setDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'cashReconciliations', '2026-09-20'), { id: '2026-09-20', expectedCash: 0 }));
  });
});

describe('the punch roster is read-only, to everyone', () => {
  it('the kiosk may READ it — this is the one thing it needs', async () => {
    await assertSucceeds(getDocs(collection(asKiosk(), 'user_data', WORKSPACE, 'kioskStaff')));
  });

  it('the kiosk may NOT write it — a device cannot invent a punch identity', async () => {
    await assertFails(setDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'kioskStaff', 'forged'),
      { id: 'forged', uid: 'forged', displayName: 'Ghost', workspaceId: WORKSPACE, active: true, pinHash: 'h', pinSalt: 's', pinIterations: 1, updatedAt: Date.now() }));
  });

  it('even the OWNER may not write it — only the Admin-SDK trigger does', async () => {
    await assertFails(setDoc(doc(asOwner(), 'user_data', WORKSPACE, 'kioskStaff', 'employee-uid'),
      { id: 'employee-uid', uid: 'employee-uid', displayName: 'Renamed', workspaceId: WORKSPACE, active: true, pinHash: 'h', pinSalt: 's', pinIterations: 1, updatedAt: Date.now() }));
  });

  it('the kiosk may not delete a roster entry', async () => {
    await assertFails(deleteDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'kioskStaff', 'employee-uid')));
  });

  it('an ordinary employee may NOT read it — it holds colleagues\' PIN hashes', async () => {
    await assertFails(getDocs(collection(asEmployee(), 'user_data', WORKSPACE, 'kioskStaff')));
  });

  it('the owner may read it, to inspect the roster from Users', async () => {
    await assertSucceeds(getDocs(collection(asOwner(), 'user_data', WORKSPACE, 'kioskStaff')));
  });
});

describe('a REVOKED kiosk loses access immediately', () => {
  it('cannot read the roster', async () => {
    await assertFails(getDocs(collection(asRevokedKiosk(), 'user_data', WORKSPACE, 'kioskStaff')));
  });
  it('cannot punch', async () => {
    await assertFails(setDoc(doc(asRevokedKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'revoked-punch'),
      { id: 'revoked-punch', userId: 'employee-uid', clockIn: Date.now(), breaks: [], createdAt: Date.now(), source: 'kiosk' }));
  });
});

/* ---------------- Punching: what it may and may not do ---------------- */

describe('kiosk punches', () => {
  it('may CLOCK IN somebody else — the whole point of a shared door iPad', async () => {
    await assertSucceeds(setDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'kiosk-in'),
      { id: 'kiosk-in', userId: 'employee-uid', userEmail: 'employee@shop.test', clockIn: Date.now(), breaks: [], createdAt: Date.now(), source: 'kiosk' }));
  });


  it('may CLOCK OUT today\'s open shift', async () => {
    await assertSucceeds(updateDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'employee-open'),
      { clockOut: Date.now() }));
  });

  it('may START and END a break on today\'s shift', async () => {
    const db = asKiosk();
    await assertSucceeds(updateDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-open'),
      { breaks: [{ id: 'b1', start: Date.now(), reason: 'lunch' }] }));
    await assertSucceeds(updateDoc(doc(db, 'user_data', WORKSPACE, 'timeEntries', 'employee-open'),
      { breaks: [{ id: 'b1', start: Date.now() - 1000, end: Date.now(), reason: 'lunch' }] }));
  });

  it('may NOT delete an entry — nothing at the door destroys an hours record', async () => {
    await assertFails(deleteDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'employee-open')));
  });

  it('may NOT change clockIn — a shift could otherwise be backdated for pay', async () => {
    await assertFails(updateDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'employee-open'),
      { clockIn: Date.now() - 12 * 3600_000 }));
  });

  it('may NOT move an entry onto another person', async () => {
    await assertFails(updateDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'employee-open'),
      { userId: 'kiosk-uid' }));
  });

  it('may NOT back-date a clock-in on create', async () => {
    await assertFails(setDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'backdated'),
      { id: 'backdated', userId: 'employee-uid', clockIn: Date.now() - 8 * 3600_000, breaks: [], createdAt: Date.now(), source: 'kiosk' }));
  });

  it('may NOT create a shift that is already clocked out with inflated hours', async () => {
    await assertFails(setDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'inflated'),
      { id: 'inflated', userId: 'employee-uid', clockIn: Date.now(), clockOut: Date.now() + 8 * 3600_000, breaks: [], createdAt: Date.now(), source: 'kiosk' }));
  });

  it('may NOT touch an entry from a PREVIOUS DAY', async () => {
    // Nobody fixes their hours at the iPad — a stale shift is a correction,
    // and corrections happen on a real screen with an audit trail.
    await assertFails(updateDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'employee-stale'),
      { clockOut: Date.now() }));
  });

  it('may NOT write correction/audit fields', async () => {
    await assertFails(updateDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'employee-open'),
      { corrections: [{ at: Date.now(), by: 'kiosk-uid', from: 0, to: Date.now() }] }));
  });

  it('may NOT clock ITSELF in — a device has no shifts', async () => {
    await assertFails(setDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'self'),
      { id: 'self', userId: 'kiosk-uid', clockIn: Date.now(), breaks: [], createdAt: Date.now(), source: 'kiosk' }));
  });
});

/* ---------------- PIN fields on users/{uid} ---------------- */

describe('kiosk PIN fields', () => {
  it('the owner may set a punch PIN on a staff member', async () => {
    await assertSucceeds(updateDoc(doc(asOwner(), 'users', 'employee-uid'), {
      kioskPinHash: 'h', kioskPinSalt: 's', kioskPinIterations: 150000,
      kioskPinUpdatedAt: Date.now(), kioskPinUpdatedBy: WORKSPACE, kioskPinUpdatedByEmail: 'owner@shop.test',
    }));
  });

  it('the owner may NOT set a punch PIN on the kiosk device itself', async () => {
    await assertFails(updateDoc(doc(asOwner(), 'users', 'kiosk-uid'), {
      kioskPinHash: 'h', kioskPinSalt: 's', kioskPinIterations: 150000,
      kioskPinUpdatedAt: Date.now(), kioskPinUpdatedBy: WORKSPACE, kioskPinUpdatedByEmail: 'owner@shop.test',
    }));
  });

  it('the owner may NOT set an APP-UNLOCK PIN on the kiosk device', async () => {
    // A shared device must never hold a credential that opens a session.
    await assertFails(updateDoc(doc(asOwner(), 'users', 'kiosk-uid'), {
      pinHash: 'h', pinSalt: 's', pinIterations: 150000,
      pinUpdatedAt: Date.now(), pinUpdatedBy: WORKSPACE, pinUpdatedByEmail: 'owner@shop.test',
    }));
  });

  it('an employee may not set their own punch PIN', async () => {
    await assertFails(updateDoc(doc(asEmployee(), 'users', 'employee-uid'), {
      kioskPinHash: 'h', kioskPinSalt: 's', kioskPinIterations: 150000,
    }));
  });

  it('the kiosk may not write to any user document', async () => {
    await assertFails(updateDoc(doc(asKiosk(), 'users', 'employee-uid'), { disabled: true }));
    await assertFails(updateDoc(doc(asKiosk(), 'users', 'kiosk-uid'), { role: 'owner' }));
  });
});

/* ---------------- How MUCH history the door iPad may hold ---------------- */

describe('a kiosk timeEntries read is BOUNDED, server-side', () => {
  // The punch screen only needs to know who is currently on shift or on a
  // break. Left unbounded, a tablet sitting by the front door caches months of
  // everyone's hours — so the bound is enforced in rules, not merely applied
  // by the client. A `list` rule is evaluated against EVERY document the query
  // would return, which is what makes a clockIn floor enforceable: an
  // unbounded query reaches an old entry, that entry fails, the whole query is
  // denied.
  // FOUR DAYS. Two was not enough to cover a weekend — see the Friday case.
  const WINDOW_MS = 96 * 3600_000;
  const entries = () => collection(asKiosk(), 'user_data', WORKSPACE, 'timeEntries');
  const bounded = (since: number) =>
    query(entries(), where('clockIn', '>=', since), orderBy('clockIn', 'desc'), limit(200));

  it('an UNBOUNDED list is DENIED', async () => {
    await assertFails(getDocs(entries()));
  });

  it('a bounded list is allowed', async () => {
    await assertSucceeds(getDocs(bounded(Date.now() - WINDOW_MS)));
  });

  it('and it returns the open shift the punch screen needs', async () => {
    const snap = await getDocs(bounded(Date.now() - WINDOW_MS));
    expect(snap.docs.map(d => d.id)).toContain('employee-open');
  });

  it('a bound reaching FURTHER BACK than the window is still denied', async () => {
    // Widening to four days did NOT make the read unbounded: a month-old
    // query still sweeps in an entry that fails the rule, so it is refused.
    await assertFails(getDocs(bounded(Date.now() - 30 * 24 * 3600_000)));
  });

  it('a kiosk cannot read an entry older than the bound even one at a time', async () => {
    await assertFails(getDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'employee-ancient')));
  });

  it('SEES the Friday shift somebody never clocked out of', async () => {
    // The whole point of widening: at 48 hours this fell outside the window,
    // so the punch screen offered "Clock in" and the person ended up with two
    // open entries.
    const snap = await getDocs(bounded(Date.now() - WINDOW_MS));
    expect(snap.docs.map(d => d.id)).toContain('employee-friday');
  });

  it('but may still NOT write to it — reading is not correcting', async () => {
    // The write window (withinLastDay) is untouched. The door iPad can now
    // show the stale shift; it still cannot decide what those hours were.
    await assertFails(updateDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'employee-friday'),
      { clockOut: Date.now() }));
  });

  it('a list without a page cap is denied', async () => {
    await assertFails(getDocs(query(entries(), where('clockIn', '>=', Date.now() - WINDOW_MS), orderBy('clockIn', 'desc'))));
  });

  it('owner and manager reads are UNCHANGED — they still see everything', async () => {
    await assertSucceeds(getDocs(collection(asOwner(), 'user_data', WORKSPACE, 'timeEntries')));
    await assertSucceeds(getDoc(doc(asOwner(), 'user_data', WORKSPACE, 'timeEntries', 'employee-ancient')));
  });
});

/* ---------------- A kiosk may not trim a break ---------------- */

describe('a kiosk write may only GROW the breaks list', () => {
  // The kiosk update branch checked WHICH fields change, not HOW `breaks`
  // changes — so anybody holding the credential could shorten or delete a
  // break on today's entry and inflate paid hours for every unpaid reason.
  // Rules cannot deep-compare array contents; this is the coarse half (the
  // list never gets shorter). The exact check lives in domain/kiosk.ts's
  // validateBreakEvolution, which runs before the write.
  const twoBreaks = [
    { id: 'b1', start: 0, end: 1000, reason: 'lunch' },
    { id: 'b2', start: 2000, end: 3000, reason: 'bank' },
  ];
  const seedBreaks = async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'user_data', WORKSPACE, 'timeEntries', 'employee-open'), { breaks: twoBreaks });
    });
  };
  const openEntry = () => doc(asKiosk(), 'user_data', WORKSPACE, 'timeEntries', 'employee-open');

  it('may APPEND a break', async () => {
    await seedBreaks();
    await assertSucceeds(updateDoc(openEntry(), { breaks: [...twoBreaks, { id: 'b3', start: 4000, reason: 'personal' }] }));
  });

  it('may END the last break — same length, so still allowed', async () => {
    await seedBreaks();
    await assertSucceeds(updateDoc(openEntry(), {
      breaks: [twoBreaks[0], { ...twoBreaks[1], end: 3500 }],
    }));
  });

  it('may NOT DELETE a break', async () => {
    await seedBreaks();
    await assertFails(updateDoc(openEntry(), { breaks: [twoBreaks[0]] }));
  });

  it('may NOT clear the breaks list outright', async () => {
    await seedBreaks();
    await assertFails(updateDoc(openEntry(), { breaks: [] }));
  });

  it('the owner may still correct breaks — this bound is on the DEVICE only', async () => {
    await seedBreaks();
    await assertSucceeds(updateDoc(doc(asOwner(), 'user_data', WORKSPACE, 'timeEntries', 'employee-open'), { breaks: [twoBreaks[0]] }));
  });
});

/**
 * PC BUILDS gave technicians a new permission ('builds.manage') and a narrow
 * inventory-create grant to go with it. A kiosk is a DEVICE, not a person: it
 * holds no permissions at all, and must pick up nothing from either.
 */
describe('a kiosk gets nothing from the PC builds grants', () => {
  it('cannot read or write a build', async () => {
    await assertFails(getDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'pcBuilds', 'pc1')));
    await assertFails(setDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'pcBuilds', 'pc-kiosk'), {
      id: 'pc-kiosk', name: 'Nope', kind: 'shelf', status: 'planning', parts: [], labour: [],
      createdBy: 'kiosk-uid', createdByEmail: 'kiosk@shop.test',
      createdAt: Date.now(), updatedAt: Date.now(),
    }));
  });

  it('cannot create the build device, even shaped exactly right', async () => {
    await assertFails(setDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'inventory', 'kiosk-dev'), {
      id: 'kiosk-dev', kind: 'device', sku: 'FTT-0000900', pcBuildId: 'pc1',
      deviceType: 'Desktop PC', brand: 'Custom', item: 'Custom PC', imei: '',
      date: '2026-09-23', boughtFrom: '', purchaseCost: 0, repairCost: 0,
      soldDate: '', soldTo: '', salePrice: 0, deviceStatus: 'ready', notes: '',
    }));
  });

  it('cannot advance the SKU counters', async () => {
    await assertFails(setDoc(doc(asKiosk(), 'user_data', WORKSPACE, 'meta', 'app'),
      { skuCounters: { FTT: 999 } }, { merge: true }));
  });
});
