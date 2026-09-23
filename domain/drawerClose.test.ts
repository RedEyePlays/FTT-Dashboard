import { describe, it, expect } from 'vitest';
import { CashDrawerEntry, CashReconciliation } from '../types';
import {
  CLOSE_REMOVAL_NOTE, cashDrawerSummary, closeDrawerPlan, correctFloatPlan,
  drawerCarryOver, openDrawerPatch, recomputedExpectedCash, recomputedVariance,
  sumCloseRemovals, sumDrawerEntries, sumTillWithdrawals,
} from './reports';
import { shortfallWalk } from './dayLedger';

/**
 * CLOSING THE DRAWER, AND THE FLOAT THAT SNOWBALLED.
 *
 * Two reported faults, one cause. Closing never changed the big number on the
 * till (the panel kept rendering the live EXPECTED figure), and the close
 * never asked how much cash was being TAKEN OUT — so `drawerCarryOver` rolled
 * the entire count into the next morning's float. Every day's takings
 * compounded into it, which is how a phone shop's float reached $11,865.
 */

const recon = (p: Partial<CashReconciliation> & { date: string }): CashReconciliation => ({
  id: p.date, expectedCash: 0, variance: 0, recordedBy: 'u1', recordedAt: 0, ...p,
});

const entry = (p: Partial<CashDrawerEntry> = {}): CashDrawerEntry =>
  ({ id: 'e1', amount: 100, ...p });

describe('closeDrawerPlan — the count, and what stays in for tomorrow', () => {
  it('records an $1,800 withdrawal when $2,000 is counted and $200 left', () => {
    const plan = closeDrawerPlan(2000, 200, undefined, 'entry-1');
    expect(plan.patch.countedCash).toBe(2000);
    expect(plan.patch.leftInDrawer).toBe(200);
    expect(plan.removedAmount).toBe(1800);
    expect(plan.removal).toEqual({
      id: 'entry-1', amount: 1800, note: CLOSE_REMOVAL_NOTE,
      refType: 'manual', adjustment: 'closeRemoval',
    });
  });

  it('writes NO withdrawal when everything is left in — nothing moved', () => {
    const plan = closeDrawerPlan(2000, 2000, undefined, 'entry-1');
    expect(plan.removal).toBeUndefined();
    expect(plan.removedAmount).toBe(0);
    expect(plan.patch.leftInDrawer).toBe(2000);
  });

  it('cannot leave behind more than was counted', () => {
    const plan = closeDrawerPlan(500, 900, undefined, 'e');
    expect(plan.patch.leftInDrawer).toBe(500);
    expect(plan.removedAmount).toBe(0);
  });

  it('keeps the variance note when one was given', () => {
    expect(closeDrawerPlan(100, 50, 'miscounted at open', 'e').patch.note).toBe('miscounted at open');
    expect(closeDrawerPlan(100, 50, undefined, 'e').patch).not.toHaveProperty('note');
  });
});

describe('the removal does not distort the day it closed', () => {
  // The count happens, THEN the money is taken out. Counting the removal
  // against the same day would make a perfectly balanced till read as over by
  // exactly the amount banked.
  const day = recon({
    date: '2026-03-10', openedAt: 1, reconciledAt: 2, openingFloat: 200,
    countedCash: 2000, leftInDrawer: 200,
    withdrawals: [entry({ id: 'w1', amount: 1800, adjustment: 'closeRemoval' })],
  });

  it('a balanced till stays balanced after $1,800 goes to the bank', () => {
    // float 200 + sales 1800 = expected 2000, counted 2000.
    expect(recomputedExpectedCash(day, 1800)).toBe(2000);
    expect(recomputedVariance(day, 1800)).toBe(0);
  });

  it('an ordinary withdrawal still counts against the day, as it always did', () => {
    const withOrdinary = recon({
      ...day, withdrawals: [...day.withdrawals!, entry({ id: 'w2', amount: 50 })],
    });
    expect(recomputedExpectedCash(withOrdinary, 1800)).toBe(1950);
    expect(sumTillWithdrawals(withOrdinary.withdrawals)).toBe(50);
    // Both are still summed in full where the question is "what left the till".
    expect(sumDrawerEntries(withOrdinary.withdrawals)).toBe(1850);
    expect(sumCloseRemovals(withOrdinary.withdrawals)).toBe(1800);
  });

  it('THE MONEY TRAIL WALK STILL BALANCES, and says where the cash went', () => {
    const walk = shortfallWalk(day, 1800);
    const at = (k: string) => walk.steps.find(s => s.key === k)!;
    // The sum to `expected` is untouched by the removal...
    expect(at('openingFloat').amount).toBe(200);
    expect(at('cashSales').amount).toBe(1800);
    expect(at('withdrawals').amount).toBe(0);
    expect(walk.expected).toBe(2000);
    expect(walk.counted).toBe(2000);
    expect(walk.variance).toBe(0);
    // ...and the two lines below it explain what happened next.
    expect(at('closeRemoval').amount).toBe(1800);
    expect(at('leftInDrawer').amount).toBe(200);
    // Float + sales + in − out − withdrawals = expected, to the cent.
    const summed = at('openingFloat').amount + at('cashSales').amount
      + at('cashIn').amount - at('cashOut').amount - at('withdrawals').amount;
    expect(summed).toBe(walk.expected);
  });
});

describe('drawerCarryOver — tomorrow opens with what was LEFT IN', () => {
  it('carries the left-in figure, not the raw count', () => {
    const day = recon({
      date: '2026-03-10', openedAt: 1, reconciledAt: 2,
      countedCash: 2000, leftInDrawer: 200,
    });
    expect(drawerCarryOver([day], '2026-03-11')?.float).toBe(200);
  });

  it('A LEGACY CLOSED DAY STILL CARRIES ITS COUNT — history does not shift', () => {
    // Closed before `leftInDrawer` existed: no left-in value at all. It must
    // behave exactly as it did before this change.
    const legacy = recon({ date: '2026-03-10', openedAt: 1, reconciledAt: 2, countedCash: 2000 });
    expect(legacy.leftInDrawer).toBeUndefined();
    expect(drawerCarryOver([legacy], '2026-03-11')?.float).toBe(2000);
  });

  it('$0 left in is a real answer, not a missing one', () => {
    const emptied = recon({
      date: '2026-03-10', openedAt: 1, reconciledAt: 2, countedCash: 2000, leftInDrawer: 0,
    });
    expect(drawerCarryOver([emptied], '2026-03-11')?.float).toBe(0);
  });

  it('THE FLOAT NO LONGER SNOWBALLS across a week of trading', () => {
    // Five days, $400 of cash sales each, $200 left in every night. Before
    // this the float climbed 200 → 600 → 1000 → 1400 → 1800; now it is $200
    // every morning, which is what a float is.
    const days: CashReconciliation[] = [];
    let float = 200;
    const floats: number[] = [];
    for (let d = 11; d <= 15; d++) {
      floats.push(float);
      days.push(recon({
        date: `2026-03-${d}`, openedAt: 1, reconciledAt: 2,
        openingFloat: float, countedCash: float + 400, leftInDrawer: 200,
      }));
      float = drawerCarryOver(days, `2026-03-${d + 1}`)!.float;
    }
    expect(floats).toEqual([200, 200, 200, 200, 200]);
  });
});

describe('the panel knows the day is closed', () => {
  const closed = recon({
    date: '2026-03-10', openedAt: 1, reconciledAt: 2, openingFloat: 200,
    countedCash: 1990, leftInDrawer: 200,
    withdrawals: [entry({ id: 'w1', amount: 1790, adjustment: 'closeRemoval' })],
  });

  it('reports the count, what was left, what was taken and the variance', () => {
    const s = cashDrawerSummary(closed, 1800);
    expect(s.closed).toBe(true);
    expect(s.countedCash).toBe(1990);
    expect(s.leftInDrawer).toBe(200);
    expect(s.removedAtClose).toBe(1790);
    expect(s.variance).toBe(-10); // short $10
  });

  it('an open day reports no close state at all', () => {
    const s = cashDrawerSummary(recon({ date: '2026-03-10', openedAt: 1, openingFloat: 200 }), 500);
    expect(s.closed).toBe(false);
    expect(s.countedCash).toBeNull();
    expect(s.leftInDrawer).toBeNull();
    expect(s.variance).toBe(0);
    expect(s.expected).toBe(700);
  });

  it('re-opening clears the close, including the left-in figure', () => {
    const patch = openDrawerPatch(300, { id: 'u1', email: 'o@x.com' }, closed);
    expect(patch.reconciledAt).toBeUndefined();
    expect(patch.countedCash).toBeUndefined();
    expect(patch.leftInDrawer).toBeUndefined();
    expect(patch.openingFloat).toBe(300);
    // The removal entry stays on the record — that cash really did leave —
    // and is excluded from the arithmetic either way, so it cannot land twice.
    const reopened = cashDrawerSummary({ ...closed, ...patch } as CashReconciliation, 500);
    expect(reopened.expected).toBe(800);
  });
});

describe('correctFloatPlan — putting a snowballed float right, once', () => {
  it('sets today\'s float and records the correction with its reason', () => {
    const plan = correctFloatPlan(11865, 300, 'float had been carrying takings forward', 'adj-1');
    expect(plan.patch.openingFloat).toBe(300);
    expect(plan.delta).toBe(11565);
    expect(plan.entry.adjustment).toBe('floatCorrection');
    expect(plan.entry.amount).toBe(11565);
    expect(plan.entry.note).toBe(
      'Float correction: $11865.00 → $300.00 — float had been carrying takings forward',
    );
  });

  it('does NOT subtract twice — the corrected float already carries the effect', () => {
    const plan = correctFloatPlan(11865, 300, 'reason', 'adj-1');
    const corrected = recon({
      date: '2026-03-10', openedAt: 1,
      openingFloat: plan.patch.openingFloat, withdrawals: [plan.entry],
    });
    // $300 float + $500 sales. If the adjustment were treated as a real
    // withdrawal this would read −$11,265.
    expect(cashDrawerSummary(corrected, 500).expected).toBe(800);
    // It is still fully visible as an entry.
    expect(sumDrawerEntries(corrected.withdrawals)).toBe(11565);
  });

  it('handles a float corrected UPWARDS too', () => {
    const plan = correctFloatPlan(50, 200, 'someone under-counted the float', 'adj-1');
    expect(plan.delta).toBe(-150);
    expect(plan.entry.amount).toBe(150);
    expect(plan.patch.openingFloat).toBe(200);
  });
});
