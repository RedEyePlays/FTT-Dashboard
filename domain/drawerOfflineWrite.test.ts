import { describe, it, expect } from 'vitest';
import { CashReconciliation } from '../types';
import {
  buildDrawerMergeWrite, recomputedExpectedCash, recomputedVariance,
  openDrawerPatch, drawerCarryOver, cashDrawerSummary,
} from './reports';
import { stampReconcile } from './attribution';

// THE FLAW THIS FIXES. Moving drawer writes into a Firestore transaction
// closed the lost update, but transactions REQUIRE A SERVER — unlike setDoc
// they are not queued by the persistent offline cache. So every drawer change
// made while the wifi dropped at the counter was rejected and thrown away:
// cash in/out, withdrawals, refund and expense cash-outs, settlement cash-ins,
// opens and closes. The UI still said "Drawer closed", because the caller
// never waited for the write.
//
// The fallback is a FIELD MERGE, which the cache does queue and which cannot
// reintroduce the lost update because it only ever touches the fields it
// names. buildDrawerMergeWrite is that payload, pure so its three rules can
// be pinned here.

const ACTOR = { id: 'u1', email: 'till@shop.test' };
const NOW = 1_700_000_000_000;
const build = (patch?: Partial<CashReconciliation>, appends?: Parameters<typeof buildDrawerMergeWrite>[0]['appends']) =>
  buildDrawerMergeWrite({ date: '2026-09-16', patch, appends, actor: ACTOR, now: NOW });

describe('rule 1 — appends become arrayUnion, never a whole array', () => {
  it('a cash-out append is a union of just that entry', () => {
    const w = build({}, { cashOut: [{ id: 'e1', amount: 40, note: 'courier COD' }] });
    expect(w.union.cashOut).toEqual([{ id: 'e1', amount: 40, note: 'courier COD' }]);
    expect(w.set.cashOut).toBeUndefined();
  });

  it('each movement list unions independently', () => {
    const w = build({}, {
      cashIn: [{ id: 'i1', amount: 25 }],
      withdrawals: [{ id: 'w1', amount: 300 }],
    });
    expect(w.union.cashIn).toHaveLength(1);
    expect(w.union.withdrawals).toHaveLength(1);
    expect(w.union.cashOut).toBeUndefined();
  });

  it('two terminals that both appended while offline BOTH keep their entry', () => {
    // This is why it must be a union. Each builds a payload naming only its
    // own entry, so neither re-asserts a list and neither erases the other —
    // arrayUnion merges them on the server at reconnect.
    const a = build({}, { cashOut: [{ id: 'tablet', amount: 40 }] });
    const b = build({}, { cashOut: [{ id: 'desktop', amount: 15 }] });
    expect(a.union.cashOut?.map(e => e.id)).toEqual(['tablet']);
    expect(b.union.cashOut?.map(e => e.id)).toEqual(['desktop']);
    expect(a.set.cashOut).toBeUndefined();
    expect(b.set.cashOut).toBeUndefined();
  });

  it('an empty append list produces no union at all', () => {
    expect(build({}, { cashOut: [] }).union.cashOut).toBeUndefined();
    expect(build({}).union).toEqual({});
  });

  it('an explicit whole-list REPLACEMENT still wins over an append of the same list', () => {
    // The Reports cash tab genuinely edits the entries themselves, so it
    // passes the list in `patch`. Unioning on top of that would contradict it.
    const w = build({ cashOut: [{ id: 'kept', amount: 5 }] }, { cashOut: [{ id: 'new', amount: 9 }] });
    expect(w.set.cashOut).toEqual([{ id: 'kept', amount: 5 }]);
    expect(w.union.cashOut).toBeUndefined();
  });
});

describe('rule 2 — undefined becomes a field delete', () => {
  it('reopening a day CLEARS the reconciled stamps rather than leaving them', () => {
    // A field merge ignores a missing key, so "clear this" has to be said.
    // Without the delete, reopening would silently no-op and the day would
    // stay closed — the bug openDrawerPatch exists to prevent.
    const w = build(openDrawerPatch(200, ACTOR, undefined, NOW));
    // `leftInDrawer` clears with them: re-opening undoes the close, and the
    // float being set right now IS what is in the drawer.
    expect(w.clear.sort()).toEqual(['countedCash', 'leftInDrawer', 'reconciledAt', 'reconciledBy', 'reconciledByEmail']);
    expect(w.set.openingFloat).toBe(200);
    expect(w.set.openedAt).toBe(NOW);
  });

  it('a field with a real value is set, not cleared', () => {
    const w = build({ note: 'float miscount', countedCash: 0 });
    expect(w.set.note).toBe('float miscount');
    expect(w.set.countedCash).toBe(0); // $0 counted is a real count, not a clear
    expect(w.clear).toEqual([]);
  });

  it('closing a day sets the reconcile stamps and clears nothing', () => {
    const w = build({ countedCash: 300, ...stampReconcile(ACTOR, NOW) });
    expect(w.set.reconciledAt).toBe(NOW);
    expect(w.set.reconciledBy).toBe('u1');
    expect(w.clear).toEqual([]);
  });
});

describe('rule 3 — a stale total is never written', () => {
  it('expectedCash, variance and cashSales are refused even if a caller passes them', () => {
    // This write cannot see the merged document, so any total it carried
    // would be a guess that overwrites a correct stored one.
    const w = build({ expectedCash: 999, variance: -50, cashSales: 123, note: 'x' } as Partial<CashReconciliation>);
    expect(w.set.expectedCash).toBeUndefined();
    expect(w.set.variance).toBeUndefined();
    expect(w.set.cashSales).toBeUndefined();
    expect(w.clear).not.toContain('expectedCash');
    expect(w.set.note).toBe('x');
  });
});

describe('the write always identifies itself', () => {
  it('stamps the document id, date and who touched it', () => {
    const w = build({});
    expect(w.set).toMatchObject({
      id: '2026-09-16', date: '2026-09-16',
      recordedBy: 'u1', recordedByEmail: 'till@shop.test', recordedAt: NOW,
    });
  });
});

/* ---------------- Reads derive the totals ---------------- */
//
// Because the offline write deliberately leaves expectedCash/variance alone,
// every read has to derive them or a queued cash-out would be invisible in
// the expected total until the next online write.

const recon = (p: Partial<CashReconciliation> & { date: string }): CashReconciliation => ({
  id: p.date, expectedCash: 0, variance: 0, recordedBy: 'u1', recordedAt: 0, ...p,
});

describe('recomputedExpectedCash', () => {
  it('derives from the float, entries and cash sales — not the stored total', () => {
    // The stored figure is deliberately wrong here: that is exactly the state
    // an offline append leaves behind.
    const r = recon({
      date: '2026-09-16', openingFloat: 200, expectedCash: 200,
      cashOut: [{ id: 'e1', amount: 40 }], cashIn: [{ id: 'i1', amount: 25 }],
    });
    expect(recomputedExpectedCash(r, 500)).toBe(685);
    expect(r.expectedCash).toBe(200); // untouched — only the READ is corrected
  });

  it('a queued offline cash-out shows up in the expected total immediately', () => {
    const before = recon({ date: '2026-09-16', openingFloat: 200, expectedCash: 700 });
    const afterQueuedWrite = { ...before, cashOut: [{ id: 'e1', amount: 40 }] };
    expect(recomputedExpectedCash(afterQueuedWrite, 500)).toBe(660);
  });

  it('falls back to the record\'s own stored cashSales when none is supplied', () => {
    const r = recon({ date: '2026-09-16', openingFloat: 200, cashSales: 500, expectedCash: 0 });
    expect(recomputedExpectedCash(r)).toBe(700);
  });

  it('falls back to the stored total only when there is nothing to derive from', () => {
    expect(recomputedExpectedCash(recon({ date: '2026-09-16', expectedCash: 123 }))).toBe(123);
    expect(recomputedExpectedCash(undefined)).toBe(0);
  });
});

describe('recomputedVariance', () => {
  it('is counted minus the DERIVED expected, not the stored one', () => {
    const r = recon({
      date: '2026-09-16', openingFloat: 200, countedCash: 650,
      cashOut: [{ id: 'e1', amount: 40 }], expectedCash: 700, variance: -50,
    });
    // Derived expected = 200 + 500 − 40 = 660, so the real variance is −10.
    expect(recomputedVariance(r, 500)).toBe(-10);
    expect(r.variance).toBe(-50); // the stale stored value, correctly ignored
  });

  it('is 0 while the day has not been counted', () => {
    expect(recomputedVariance(recon({ date: '2026-09-16', openingFloat: 200 }), 500)).toBe(0);
  });
});

describe('the carried-forward float is derived too', () => {
  it('a stale stored expectedCash does not carry a wrong float into today', () => {
    const yesterday = recon({
      date: '2026-09-15', openedAt: 1, openingFloat: 200,
      expectedCash: 700,                         // stale: written before the offline cash-out
      cashOut: [{ id: 'e1', amount: 40 }],       // arrived via a queued merge write
    });
    const carry = drawerCarryOver([yesterday], '2026-09-16', () => 500);
    expect(carry!.float).toBe(660);   // 200 + 500 − 40, not the stored 700
    expect(carry!.stillOpen).toBe(true);
  });

  it('a COUNTED day still carries its count — what was really in the till beats any total', () => {
    const yesterday = recon({ date: '2026-09-15', openedAt: 1, countedCash: 655, expectedCash: 700, reconciledAt: 2 });
    expect(drawerCarryOver([yesterday], '2026-09-16', () => 500)!.float).toBe(655);
  });

  it('without a cash-sales lookup it falls back to the stored figure, as before', () => {
    const yesterday = recon({ date: '2026-09-15', openedAt: 1, openingFloat: 200, expectedCash: 700 });
    expect(drawerCarryOver([yesterday], '2026-09-16')!.float).toBe(700);
  });

  it('the derived float flows through to today\'s opening float', () => {
    const yesterday = recon({
      date: '2026-09-15', openedAt: 1, openingFloat: 200, expectedCash: 700,
      cashOut: [{ id: 'e1', amount: 40 }],
    });
    const summary = cashDrawerSummary(undefined, 0, drawerCarryOver([yesterday], '2026-09-16', () => 500));
    expect(summary.openingFloat).toBe(660);
    expect(summary.opened).toBe(true);
  });
});
