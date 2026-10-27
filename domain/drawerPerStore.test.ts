import { describe, it, expect } from 'vitest';
import { CashReconciliation, SalesTransaction, Location, AppUser } from '../types';
import {
  drawerCarryOver, unreconciledDays, cashDrawerSummary,
  expectedCashForDate, expectedCashForDateAt,
  mergeDrawerRecord, buildDrawerMergeWrite,
} from './reports';
import { drawersAt, drawerKey } from './drawerKey';
import { permittedLocations, canUseLocation, resolveActiveLocation } from './locations';

/**
 * WHAT A PER-STORE DRAWER HAS TO GET RIGHT.
 *
 * domain/drawerKey.test.ts pins the key. This pins the arithmetic and the
 * access that hang off it — the four ways a second store could still have
 * corrupted the first one's cash:
 *
 *  1. the float left in one shop becoming the other shop's opening float;
 *  2. both drawers expecting the WHOLE company's cash takings, so each reads
 *     as short by the other's day;
 *  3. a write landing on the right document but not saying which store it is;
 *  4. somebody being locked out of their own till — or handed somebody
 *     else's — by the new store list.
 */

const ACTOR = { id: 'u1', email: 'till@shop.test' };
const NOW = 1_800_000_000_000;
const BRAMPTON = 'brampton';
const MISS = 'mississauga';

const rec = (id: string, p: Partial<CashReconciliation> = {}): CashReconciliation => ({
  id, date: id.slice(0, 10), expectedCash: 0, variance: 0,
  recordedBy: 'u0', recordedAt: 1, ...p,
});

const sale = (p: Partial<SalesTransaction>): SalesTransaction => ({
  id: 'tx', date: '2026-10-27', lines: [], totalPaid: 0, paymentMethod: 'cash',
  ...p,
} as SalesTransaction);

/* ---------------- 1. The carry-over stays in its own shop ---------------- */

describe('the float carries forward WITHIN A STORE ONLY', () => {
  // Yesterday: Brampton left $300 in the till, Mississauga left $50.
  const yesterday = [
    rec(drawerKey('2026-10-26', BRAMPTON), { openedAt: 1, openingFloat: 200, countedCash: 900, leftInDrawer: 300, reconciledAt: 2 }),
    rec(drawerKey('2026-10-26', MISS), { openedAt: 1, openingFloat: 100, countedCash: 400, leftInDrawer: 50, reconciledAt: 2 }),
  ];

  it('each store opens with its own leftovers', () => {
    const b = drawerCarryOver(drawersAt(yesterday, BRAMPTON, BRAMPTON), '2026-10-27');
    const m = drawerCarryOver(drawersAt(yesterday, MISS, BRAMPTON), '2026-10-27');
    expect(b!.float).toBe(300);
    expect(m!.float).toBe(50);
  });

  it('WITHOUT the scoping, one store would inherit the other\'s till', () => {
    // The unscoped list is what the code did before this stage: the most
    // recent prior record wins, whichever shop it belonged to. Kept as a test
    // so the reason the scoping exists cannot quietly stop being true.
    const unscoped = drawerCarryOver(yesterday, '2026-10-27');
    expect(unscoped!.float).not.toBe(50);
  });

  it('a store shut yesterday carries ITS OWN last day, not the other shop\'s', () => {
    const recs = [
      ...yesterday.filter(r => r.id.endsWith(MISS)),
      rec(drawerKey('2026-10-20', BRAMPTON), { openedAt: 1, openingFloat: 200, countedCash: 500, leftInDrawer: 150, reconciledAt: 2 }),
    ];
    const b = drawerCarryOver(drawersAt(recs, BRAMPTON, BRAMPTON), '2026-10-27');
    expect(b).toMatchObject({ float: 150, fromDate: '2026-10-20' });
  });

  it('an unclosed drawer at one shop does not make the other read as open', () => {
    const recs = [
      rec(drawerKey('2026-10-26', MISS), { openedAt: 1, openingFloat: 100 }),     // never closed
      rec(drawerKey('2026-10-26', BRAMPTON), { openedAt: 1, openingFloat: 200, countedCash: 400, leftInDrawer: 200, reconciledAt: 2 }),
    ];
    expect(drawerCarryOver(drawersAt(recs, MISS, BRAMPTON), '2026-10-27')!.stillOpen).toBe(true);
    expect(drawerCarryOver(drawersAt(recs, BRAMPTON, BRAMPTON), '2026-10-27')!.stillOpen).toBe(false);
  });

  it('a LEGACY bare-date day carries into the default store and no other', () => {
    // History is not re-keyed, so yesterday really is a bare-date document.
    const recs = [rec('2026-10-26', { openedAt: 1, openingFloat: 200, countedCash: 700, leftInDrawer: 250, reconciledAt: 2 })];
    expect(drawerCarryOver(drawersAt(recs, BRAMPTON, BRAMPTON), '2026-10-27')!.float).toBe(250);
    expect(drawerCarryOver(drawersAt(recs, MISS, BRAMPTON), '2026-10-27')).toBeNull();
  });
});

describe('the unreconciled-days flag, per store', () => {
  const recs = [
    rec(drawerKey('2026-10-26', BRAMPTON), { openedAt: 1, reconciledAt: 2 }),
    rec(drawerKey('2026-10-26', MISS), { openedAt: 1 }),   // counted by nobody
  ];

  it('flags the shop that never counted, and not the one that did', () => {
    expect(unreconciledDays(drawersAt(recs, MISS, BRAMPTON), '2026-10-27').map(r => r.id))
      .toEqual([drawerKey('2026-10-26', MISS)]);
    expect(unreconciledDays(drawersAt(recs, BRAMPTON, BRAMPTON), '2026-10-27')).toEqual([]);
  });

  it('the whole-workspace view still sees it — an uncounted till at the other shop is the one nobody would notice', () => {
    expect(unreconciledDays(recs, '2026-10-27')).toHaveLength(1);
  });
});

/* ---------------- 2. Each drawer expects its own takings ---------------- */

describe('one store\'s cash sales', () => {
  const sales = [
    sale({ id: 'b1', totalPaid: 100, locationId: BRAMPTON }),
    sale({ id: 'm1', totalPaid: 60, locationId: MISS }),
    sale({ id: 'old', totalPaid: 40 }),                       // predates stamping
    sale({ id: 'card', totalPaid: 500, paymentMethod: 'card', locationId: MISS }),
  ];

  it('counts only that store\'s cash', () => {
    expect(expectedCashForDateAt(sales, '2026-10-27', MISS, BRAMPTON)).toBe(60);
  });

  it('AN UNTAGGED SALE COUNTS TOWARD THE DEFAULT STORE — the same rule a bare-date drawer id follows', () => {
    expect(expectedCashForDateAt(sales, '2026-10-27', BRAMPTON, BRAMPTON)).toBe(140);
  });

  it('with no store list it is the company total, exactly as before', () => {
    expect(expectedCashForDateAt(sales, '2026-10-27', '', '')).toBe(expectedCashForDate(sales, '2026-10-27'));
    expect(expectedCashForDate(sales, '2026-10-27')).toBe(200);
  });

  it('so neither drawer reads as short by the other\'s day', () => {
    const day = rec(drawerKey('2026-10-27', MISS), { openedAt: 1, openingFloat: 100, countedCash: 160 });
    const summary = cashDrawerSummary(day, expectedCashForDateAt(sales, '2026-10-27', MISS, BRAMPTON), null);
    expect(summary.expected).toBe(160);
    expect(summary.variance).toBe(0);
    // The company-wide figure is what the shared drawer used to produce: a
    // perfectly counted till reading as $140 over.
    const wrong = cashDrawerSummary(day, expectedCashForDate(sales, '2026-10-27'), null);
    expect(wrong.variance).toBe(-140);
  });
});

/* ---------------- 3. A write says which store it is ---------------- */

describe('every drawer write carries its store', () => {
  const merge = (id: string, locationId: string, existing?: CashReconciliation) => mergeDrawerRecord({
    date: '2026-10-27', id, locationId, existing, patch: { openingFloat: 150 },
    cashSales: 0, carry: null, actor: ACTOR, now: NOW,
  });

  it('the stored id IS the document id, and the location field agrees with it', () => {
    const out = merge(drawerKey('2026-10-27', MISS), MISS);
    expect(out.id).toBe('2026-10-27__mississauga');
    expect(out.locationId).toBe(MISS);
    expect(out.date).toBe('2026-10-27');
  });

  it('a stale local copy\'s id cannot re-key the document', () => {
    // `existing` is the server's record, spread over the defaults — if its id
    // won, a record read under one key could be written back under another.
    const out = merge(drawerKey('2026-10-27', MISS), MISS, rec('2026-10-27', { openingFloat: 200 }));
    expect(out.id).toBe('2026-10-27__mississauga');
  });

  it('a legacy bare-date day gets its store stamped on without being re-keyed', () => {
    const out = merge('2026-10-27', BRAMPTON, rec('2026-10-27', { openedAt: 1, openingFloat: 200 }));
    expect(out.id).toBe('2026-10-27');       // history is not moved
    expect(out.locationId).toBe(BRAMPTON);   // but it is now attributable
    expect(out.openedAt).toBe(1);            // and nothing about it is lost
  });

  it('a patch cannot move a drawer to another store', () => {
    const out = mergeDrawerRecord({
      date: '2026-10-27', id: drawerKey('2026-10-27', BRAMPTON), locationId: BRAMPTON,
      existing: undefined,
      patch: { locationId: MISS, id: drawerKey('2026-10-27', MISS) } as Partial<CashReconciliation>,
      cashSales: 0, carry: null, actor: ACTOR, now: NOW,
    });
    expect(out.id).toBe('2026-10-27__brampton');
    expect(out.locationId).toBe(BRAMPTON);
  });

  it('stamps nothing when the workspace has no store list', () => {
    const out = mergeDrawerRecord({
      date: '2026-10-27', id: '2026-10-27', existing: undefined, patch: {},
      cashSales: 0, carry: null, actor: ACTOR, now: NOW,
    });
    expect(out.id).toBe('2026-10-27');
    expect(out.locationId).toBeUndefined();
  });

  describe('THE OFFLINE QUEUE, which is the one that cannot be re-checked later', () => {
    it('names the store in the merge payload', () => {
      const w = buildDrawerMergeWrite({
        date: '2026-10-27', id: drawerKey('2026-10-27', MISS), locationId: MISS,
        appends: { cashOut: [{ id: 'e1', amount: 40 }] }, actor: ACTOR, now: NOW,
      });
      expect(w.set.id).toBe('2026-10-27__mississauga');
      expect(w.set.locationId).toBe(MISS);
      // Still a union, not a replacement — the rule the offline path exists for.
      expect(w.union.cashOut).toHaveLength(1);
    });

    it('a queued patch cannot re-point the write at another store', () => {
      const w = buildDrawerMergeWrite({
        date: '2026-10-27', id: drawerKey('2026-10-27', BRAMPTON), locationId: BRAMPTON,
        patch: { locationId: MISS, id: 'anything' } as Partial<CashReconciliation>,
        actor: ACTOR, now: NOW,
      });
      expect(w.set.id).toBe('2026-10-27__brampton');
      expect(w.set.locationId).toBe(BRAMPTON);
      expect(w.clear).not.toContain('locationId');
    });
  });
});

/* ---------------- 4. Who may run which till ---------------- */

const loc = (id: string, p: Partial<Location> = {}): Location =>
  ({ id, name: id[0].toUpperCase() + id.slice(1), active: true, createdAt: 1, ...p });

const user = (p: Partial<AppUser>): AppUser =>
  ({ id: 'u', email: 'u@shop.test', role: 'employee', workspaceId: 'ws', ...p } as AppUser);

describe('which stores somebody may work at', () => {
  const stores = [loc(BRAMPTON, { isDefault: true }), loc(MISS)];

  it('AN EMPTY LIST IS THE DEFAULT STORE, NOT A LOCKOUT', () => {
    // Every account holds this until the owner sets one deliberately. If this
    // ever returns [] the whole shop loses the till on deploy day.
    expect(permittedLocations(user({}), stores).map(l => l.id)).toEqual([BRAMPTON]);
    expect(permittedLocations(user({ locationIds: [] }), stores).map(l => l.id)).toEqual([BRAMPTON]);
  });

  it('the list is honoured when the owner has set one', () => {
    expect(permittedLocations(user({ locationIds: [MISS] }), stores).map(l => l.id)).toEqual([MISS]);
    expect(permittedLocations(user({ locationIds: [BRAMPTON, MISS] }), stores)).toHaveLength(2);
  });

  it('THE OWNER ALWAYS HOLDS EVERY STORE, whatever their list says', () => {
    expect(permittedLocations(user({ role: 'owner', locationIds: [MISS] }), stores)).toHaveLength(2);
  });

  it('a closed store, or one that no longer exists, drops out rather than being pickable', () => {
    const closed = [loc(BRAMPTON, { isDefault: true }), loc(MISS, { active: false })];
    expect(permittedLocations(user({ locationIds: [MISS] }), closed).map(l => l.id)).toEqual([BRAMPTON]);
    expect(permittedLocations(user({ locationIds: ['gone'] }), stores).map(l => l.id)).toEqual([BRAMPTON]);
  });

  it('nobody is pointed at a till they may not write', () => {
    expect(canUseLocation(user({ locationIds: [MISS] }), stores, BRAMPTON)).toBe(false);
    expect(canUseLocation(user({ locationIds: [MISS] }), stores, MISS)).toBe(true);
    expect(canUseLocation(user({ role: 'owner' }), stores, MISS)).toBe(true);
  });

  it('a remembered choice survives only while it is still allowed', () => {
    expect(resolveActiveLocation(user({ locationIds: [BRAMPTON, MISS] }), stores, MISS)!.id).toBe(MISS);
    // Taken off that store since: falls back rather than leaving them aimed at it.
    expect(resolveActiveLocation(user({ locationIds: [BRAMPTON] }), stores, MISS)!.id).toBe(BRAMPTON);
  });

  it('a workspace with no stores yet resolves to nothing, and nothing changes', () => {
    expect(permittedLocations(user({}), [])).toEqual([]);
    expect(resolveActiveLocation(user({}), [])).toBeUndefined();
  });
});
