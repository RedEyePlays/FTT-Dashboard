import { describe, it, expect } from 'vitest';
import { CashReconciliation } from '../types';
import {
  mergeDrawerRecord, drawerStateChange, changesDrawerState, openDrawerPatch, drawerCarryOver,
} from './reports';
import { stampReconcile } from './attribution';

// The investigation behind "the cash drawer randomly closes".
//
// Every drawer write used to be a FULL-DOCUMENT OVERWRITE (`setDoc`, no
// merge) of a document App.tsx assembled from its own React state. Two
// terminals — the POS tablet and the back-office desktop — or one of them
// flushing writes queued while offline would each rebuild the whole document
// from a snapshot taken before the other's change, and the later write simply
// won. Whatever the other had done was gone: cash entries, the count, and
// `openedAt`, which is what a drawer closing by itself looks like.
//
// mergeDrawerRecord is that write, made pure so the lost update can be
// reproduced and pinned here. In production it runs INSIDE a Firestore
// transaction against the freshly-read server document
// (services/firestoreDb.ts's commitCashReconciliation), which is what makes
// "existing" below actually current.

const ACTOR = { id: 'u1', email: 'till@shop.test' };
const NOW = 1_700_000_000_000;

const base = (p: Partial<CashReconciliation> = {}): CashReconciliation => ({
  id: '2026-03-16', date: '2026-03-16', expectedCash: 0, variance: 0,
  recordedBy: 'u0', recordedAt: 1, ...p,
});

const merge = (
  existing: CashReconciliation | undefined,
  patch: Partial<CashReconciliation>,
  appends?: Parameters<typeof mergeDrawerRecord>[0]['appends'],
  cashSales = 0,
) => mergeDrawerRecord({ date: '2026-03-16', existing, patch, appends, cashSales, carry: null, actor: ACTOR, now: NOW });

describe('the lost update — a second terminal must not wipe the first', () => {
  // The drawer as the tablet left it: opened this morning, one cash-out
  // logged, still open.
  const asStored = base({
    openedAt: 111, openedBy: 'tablet', openedByEmail: 'pos@shop.test', openingFloat: 200,
    cashOut: [{ id: 'e1', amount: 40, note: 'courier COD' }],
  });

  it('a write that says nothing about openedAt LEAVES IT ALONE', () => {
    // The desktop logs an unrelated cash-in from a snapshot that predates the
    // open. Under the old full-overwrite this erased openedAt and the
    // register read as closed.
    const out = merge(asStored, {}, { cashIn: [{ id: 'e2', amount: 25 }] });
    expect(out.openedAt).toBe(111);
    expect(out.openedBy).toBe('tablet');
    expect(out.reconciledAt).toBeUndefined();
  });

  it("a write that says nothing about the other terminal's entries keeps them", () => {
    const out = merge(asStored, { note: 'fixed a typo' });
    expect(out.cashOut).toEqual([{ id: 'e1', amount: 40, note: 'courier COD' }]);
  });

  it('an append lands on the SERVER list, so neither entry is lost', () => {
    const out = merge(asStored, {}, { cashIn: [{ id: 'e2', amount: 25 }] });
    expect(out.cashOut?.map(e => e.id)).toEqual(['e1']);
    expect(out.cashIn?.map(e => e.id)).toEqual(['e2']);
  });

  it('appending twice from two terminals keeps BOTH entries', () => {
    const afterA = merge(asStored, {}, { cashOut: [{ id: 'a', amount: 10 }] });
    const afterB = merge(afterA, {}, { cashOut: [{ id: 'b', amount: 15 }] });
    expect(afterB.cashOut?.map(e => e.id)).toEqual(['e1', 'a', 'b']);
  });

  it('a transaction RETRY cannot double-post the same entry', () => {
    // Firestore re-runs the whole callback on contention. An append already
    // present by id is skipped, so a retried write is idempotent.
    const once = merge(asStored, {}, { cashOut: [{ id: 'dup', amount: 10 }] });
    const twice = merge(once, {}, { cashOut: [{ id: 'dup', amount: 10 }] });
    expect(twice.cashOut?.filter(e => e.id === 'dup')).toHaveLength(1);
  });

  it('a count from one terminal does not erase the other terminal\'s float', () => {
    const out = merge(asStored, { countedCash: 300, ...stampReconcile(ACTOR, NOW) });
    expect(out.openingFloat).toBe(200);
    expect(out.cashOut).toHaveLength(1);
  });
});

describe('the figures are always recomputed, never taken on trust', () => {
  it('expected cash comes from the shared math over the MERGED lists', () => {
    const out = merge(base({ openingFloat: 200, cashOut: [{ id: 'e1', amount: 40 }] }), {}, { cashIn: [{ id: 'e2', amount: 25 }] }, 500);
    // 200 float + 500 cash sales + 25 in − 40 out
    expect(out.expectedCash).toBe(685);
    expect(out.cashSales).toBe(500);
  });

  it('variance is counted − expected once counted, and 0 before that', () => {
    const open = merge(base({ openingFloat: 200 }), {}, undefined, 500);
    expect(open.variance).toBe(0);
    const closed = merge(base({ openingFloat: 200 }), { countedCash: 690 }, undefined, 500);
    expect(closed.expectedCash).toBe(700);
    expect(closed.variance).toBe(-10);
  });

  it('stamps who last touched it on every write', () => {
    const out = merge(base({ recordedBy: 'someone-else' }), { note: 'x' });
    expect(out.recordedBy).toBe('u1');
    expect(out.recordedByEmail).toBe('till@shop.test');
    expect(out.recordedAt).toBe(NOW);
  });
});

describe('a new day seeds from the till that was carried over', () => {
  const carry = { float: 940, fromDate: '2026-03-15', stillOpen: true };

  it('opens with yesterday\'s cash, not $0', () => {
    const out = mergeDrawerRecord({
      date: '2026-03-16', existing: undefined, patch: {}, cashSales: 0, carry, actor: ACTOR, now: NOW,
    });
    expect(out.openingFloat).toBe(940);
  });

  it('a drawer nobody closed reads as still open today', () => {
    const out = mergeDrawerRecord({
      date: '2026-03-16', existing: undefined, patch: {}, cashSales: 0, carry, actor: ACTOR, now: NOW,
    });
    expect(out.openedAt).toBe(NOW);
    expect(out.openedBy).toBe('u1');
  });

  it('once the day HAS a record, its own float is the truth — the carry is not re-applied', () => {
    const out = mergeDrawerRecord({
      date: '2026-03-16', existing: base({ openingFloat: 100, openedAt: 5 }), patch: {},
      cashSales: 0, carry, actor: ACTOR, now: NOW,
    });
    expect(out.openingFloat).toBe(100);
    expect(out.openedAt).toBe(5);
  });

  it('a carried CLOSED day does not silently reopen today', () => {
    const out = mergeDrawerRecord({
      date: '2026-03-16', existing: undefined, patch: {}, cashSales: 0,
      carry: { float: 500, fromDate: '2026-03-15', stillOpen: false }, actor: ACTOR, now: NOW,
    });
    expect(out.openedAt).toBeUndefined();
    expect(out.openingFloat).toBe(500);
  });

  it('feeds off the real drawerCarryOver, bare records and all', () => {
    const recs = [
      base({ id: '2026-03-13', date: '2026-03-13', openedAt: 1, openingFloat: 100, expectedCash: 940 }),
      base({ id: '2026-03-14', date: '2026-03-14' }), // bare — must not hide the open day
    ];
    const out = mergeDrawerRecord({
      date: '2026-03-16', existing: undefined, patch: {}, cashSales: 0,
      carry: drawerCarryOver(recs, '2026-03-16'), actor: ACTOR, now: NOW,
    });
    expect(out.openingFloat).toBe(940);
    expect(out.openedAt).toBe(NOW);
  });
});

describe('the audit trail for every open/close', () => {
  it('reports opening a day', () => {
    const before = base();
    const after = merge(before, openDrawerPatch(200, ACTOR, undefined, NOW));
    const change = drawerStateChange(before, after);
    expect(change.openedSet).toBe(true);
    expect(change.losesOpenedAt).toBe(false);
    expect(changesDrawerState(change)).toBe(true);
  });

  it('reports closing a day', () => {
    const before = base({ openedAt: 1 });
    const after = merge(before, { countedCash: 300, ...stampReconcile(ACTOR, NOW) });
    const change = drawerStateChange(before, after);
    expect(change.reconciledSet).toBe(true);
    expect(changesDrawerState(change)).toBe(true);
  });

  it('reports REOPENING a closed day — the reconciled stamp being cleared', () => {
    const before = base({ openedAt: 1, reconciledAt: 2, countedCash: 300 });
    const after = merge(before, openDrawerPatch(200, ACTOR, before, NOW));
    const change = drawerStateChange(before, after);
    expect(change.reconciledCleared).toBe(true);
    // Re-opening preserves the original open stamp rather than bumping it.
    expect(after.openedAt).toBe(1);
    expect(change.losesOpenedAt).toBe(false);
  });

  it('flags the specific case worth shouting about — openedAt disappearing', () => {
    const before = base({ openedAt: 1 });
    const after = merge(before, { openedAt: undefined });
    const change = drawerStateChange(before, after);
    expect(change.losesOpenedAt).toBe(true);
    expect(change.openedCleared).toBe(true);
  });

  it('an ordinary cash movement changes no state and raises nothing', () => {
    const before = base({ openedAt: 1 });
    const after = merge(before, {}, { cashOut: [{ id: 'e9', amount: 20 }] });
    expect(changesDrawerState(drawerStateChange(before, after))).toBe(false);
  });
});

describe('saving corrections without a count must never close the day', () => {
  // The accidental close: the Cash tab required a count before it would save
  // anything, and saving always stamped reconciledAt. So fixing a typo in
  // today's cash-out note also closed the live drawer.
  it('a note/entry edit leaves the drawer open', () => {
    const before = base({ openedAt: 1, openingFloat: 200 });
    const after = merge(before, { note: 'fixed the courier note', openingFloat: 200 }, undefined, 100);
    expect(after.reconciledAt).toBeUndefined();
    expect(after.countedCash).toBeUndefined();
    expect(after.openedAt).toBe(1);
    expect(changesDrawerState(drawerStateChange(before, after))).toBe(false);
  });

  it('only a write that actually carries the reconcile stamp closes it', () => {
    const before = base({ openedAt: 1, openingFloat: 200 });
    const after = merge(before, { countedCash: 300, ...stampReconcile(ACTOR, NOW) }, undefined, 100);
    expect(after.reconciledAt).toBe(NOW);
    expect(drawerStateChange(before, after).reconciledSet).toBe(true);
  });
});
