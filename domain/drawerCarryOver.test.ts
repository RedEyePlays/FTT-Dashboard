import { describe, it, expect } from 'vitest';
import { drawerCarryOver, cashDrawerSummary } from './reports';
import { CashReconciliation } from '../types';

// Two reported bugs, both from the drawer being keyed by date with
// nothing joining one day to the next:
//   1. It CLOSED ITSELF at midnight — today had no record, so the drawer
//      read as "never opened" even though nobody had counted or closed it.
//   2. The cash RESET TO ZERO — yesterday's ending till didn't carry into
//      today's opening float, though the money is physically still there.

const recon = (p: Partial<CashReconciliation> & { date: string }): CashReconciliation => ({
  id: p.date, expectedCash: 0, variance: 0,
  recordedBy: 'u1', recordedAt: 0,
  ...p,
});

// A day that was opened, took cash, and was never closed.
const openDay = (date: string, expected: number) =>
  recon({ date, openedAt: 1, openingFloat: 100, expectedCash: expected });

// A day that was opened, counted and closed.
const closedDay = (date: string, counted: number, expected = counted) =>
  recon({ date, openedAt: 1, openingFloat: 100, expectedCash: expected, countedCash: counted, reconciledAt: 2 });

describe('drawerCarryOver — what yesterday leaves behind', () => {
  it('carries the COUNTED cash from a day that was actually counted', () => {
    // What's really in the till beats what was expected to be.
    const c = drawerCarryOver([closedDay('2026-03-09', 480, 500)], '2026-03-10');
    expect(c?.float).toBe(480);
    expect(c?.fromDate).toBe('2026-03-09');
  });

  it('carries the EXPECTED ending when the day was never counted', () => {
    expect(drawerCarryOver([openDay('2026-03-09', 640)], '2026-03-10')?.float).toBe(640);
  });

  it('reports a day that was never closed as STILL OPEN', () => {
    expect(drawerCarryOver([openDay('2026-03-09', 640)], '2026-03-10')?.stillOpen).toBe(true);
  });

  it('reports a day that WAS closed as closed', () => {
    expect(drawerCarryOver([closedDay('2026-03-09', 480)], '2026-03-10')?.stillOpen).toBe(false);
  });

  it('uses the most recent PRIOR day, not merely yesterday', () => {
    // Shop closed Sunday + Monday; Saturday's till still carries forward.
    const c = drawerCarryOver([
      closedDay('2026-03-05', 300), closedDay('2026-03-07', 455),
    ], '2026-03-10');
    expect(c?.float).toBe(455);
    expect(c?.fromDate).toBe('2026-03-07');
  });

  it('ignores today and any future-dated record', () => {
    const c = drawerCarryOver([
      closedDay('2026-03-09', 455), closedDay('2026-03-10', 999), closedDay('2026-03-11', 777),
    ], '2026-03-10');
    expect(c?.float).toBe(455);
  });

  it('carries nothing when there is no prior day at all', () => {
    expect(drawerCarryOver([], '2026-03-10')).toBeNull();
  });

  it('carries nothing from a bare record that was never actually started', () => {
    // Written by some other path, never opened, no float, never counted —
    // there is no till behind it to carry.
    expect(drawerCarryOver([recon({ date: '2026-03-09' })], '2026-03-10')).toBeNull();
  });

  it('never carries a negative float', () => {
    expect(drawerCarryOver([openDay('2026-03-09', -50)], '2026-03-10')?.float).toBe(0);
  });

  it('carries 0 honestly from a day emptied to zero', () => {
    const c = drawerCarryOver([closedDay('2026-03-09', 0, 0)], '2026-03-10');
    expect(c?.float).toBe(0);
    expect(c?.stillOpen).toBe(false);
  });
});

describe('cashDrawerSummary — the till is continuous across midnight', () => {
  const carryOpen = drawerCarryOver([openDay('2026-03-09', 640)], '2026-03-10');
  const carryClosed = drawerCarryOver([closedDay('2026-03-09', 480)], '2026-03-10');

  it('a drawer nobody closed is STILL OPEN today, with no record of its own', () => {
    const d = cashDrawerSummary(undefined, 0, carryOpen);
    expect(d.opened).toBe(true);   // the bug: this used to be false at 00:00
    expect(d.openingFloat).toBe(640);
  });

  it("yesterday's ending cash IS today's opening float", () => {
    expect(cashDrawerSummary(undefined, 0, carryClosed).openingFloat).toBe(480);
    // ...and it flows straight into the expected ending.
    expect(cashDrawerSummary(undefined, 250, carryClosed).expected).toBe(730);
  });

  it('a day carried from a CLOSED day is not open until someone opens it', () => {
    expect(cashDrawerSummary(undefined, 0, carryClosed).opened).toBe(false);
  });

  it('once today has its own record, ITS float wins over the carry-over', () => {
    // Someone counted the till this morning and it was 500, not 640.
    const today = recon({ date: '2026-03-10', openedAt: 9, openingFloat: 500 });
    const d = cashDrawerSummary(today, 0, carryOpen);
    expect(d.openingFloat).toBe(500);
    expect(d.opened).toBe(true);
  });

  it('a day CLOSED today is never re-opened by the carry-over', () => {
    // `opened` means "was opened" — the pre-existing contract, since
    // callers read `reconciledAt` separately for closed-ness. What
    // matters here is that the carry-over clause can't resurrect a
    // day that WAS closed: a record with its own reconciledAt stays
    // closed even though the day it would inherit from is still open.
    const closedToday = recon({
      date: '2026-03-10', openingFloat: 500, countedCash: 505, reconciledAt: 20,
    });
    expect(cashDrawerSummary(closedToday, 0, carryOpen).opened).toBe(false);
    // ...and its own counted float wins over the carry-over.
    expect(cashDrawerSummary(closedToday, 0, carryOpen).openingFloat).toBe(500);
  });

  it('behaves exactly as before when no carry-over is supplied', () => {
    // Every existing caller/test that passes two arguments is unchanged.
    expect(cashDrawerSummary(undefined, 0)).toEqual(cashDrawerSummary(undefined, 0, null));
    const d = cashDrawerSummary(undefined, 120);
    expect(d.opened).toBe(false);
    expect(d.openingFloat).toBe(0);
    expect(d.expected).toBe(120);
  });

  it("a carried-open drawer keeps counting the day's own movement", () => {
    const withMovement = recon({
      date: '2026-03-10',
      cashIn: [{ id: 'a', amount: 40 }],
      cashOut: [{ id: 'b', amount: 15 }],
      withdrawals: [{ id: 'c', amount: 200 }],
    });
    const d = cashDrawerSummary(withMovement, 300, carryOpen);
    expect(d.openingFloat).toBe(640);   // carried, since today set no float of its own
    expect(d.expected).toBe(765);      // 640 + 300 + 40 − 15 − 200
    expect(d.opened).toBe(true);       // still open — nobody closed it
  });
});

/* ---------------- A bare record must not hide the real drawer ---------------- */
//
// Investigated as part of the "drawer randomly closing" report, and real.
//
// The carry-over used to look at the single most recent PRIOR record and
// bail if that record was bare. But bare records get written by paths that
// touch a date without anyone running a till: a void/return refund cash-out,
// a device-buyer settlement's cash-in. So a drawer opened Friday and never
// closed, followed by a bare Saturday record, made Monday read as "never
// opened" with a $0 float — the till's cash AND its open state both vanished.
describe('a bare record cannot hide an older open drawer behind it', () => {
  // Never opened, never counted, no float — written by some other cash path.
  const bareDay = (date: string, cashOut?: number) =>
    recon({ date, expectedCash: -(cashOut || 0), cashOut: cashOut ? [{ id: 'x', amount: cashOut }] : undefined });

  it('looks PAST a bare day to the open drawer behind it', () => {
    const carry = drawerCarryOver([openDay('2026-03-13', 940), bareDay('2026-03-14', 50)], '2026-03-16');
    expect(carry).not.toBeNull();
    expect(carry!.fromDate).toBe('2026-03-13');
    expect(carry!.float).toBe(940);
    expect(carry!.stillOpen).toBe(true);
  });

  it('the day after a bare record therefore still reads as OPEN, not closed', () => {
    // This is the symptom: without the skip, `opened` came back false and the
    // register looked shut mid-shift.
    const recs = [openDay('2026-03-13', 940), bareDay('2026-03-14', 50)];
    const summary = cashDrawerSummary(undefined, 0, drawerCarryOver(recs, '2026-03-16'));
    expect(summary.opened).toBe(true);
    expect(summary.openingFloat).toBe(940);
  });

  it('skips SEVERAL bare days in a row', () => {
    const carry = drawerCarryOver(
      [openDay('2026-03-13', 940), bareDay('2026-03-14'), bareDay('2026-03-15')],
      '2026-03-16',
    );
    expect(carry!.fromDate).toBe('2026-03-13');
    expect(carry!.float).toBe(940);
  });

  it('still returns null when every prior day is bare — there is genuinely no till', () => {
    expect(drawerCarryOver([bareDay('2026-03-14'), bareDay('2026-03-15')], '2026-03-16')).toBeNull();
  });

  it('a real CLOSED day behind a bare one correctly reads as closed, not open', () => {
    // The skip must not turn every carried day into an open one — it looks
    // for the real drawer and then reports that drawer honestly.
    const carry = drawerCarryOver([closedDay('2026-03-13', 500), bareDay('2026-03-14')], '2026-03-16');
    expect(carry!.fromDate).toBe('2026-03-13');
    expect(carry!.float).toBe(500);
    expect(carry!.stillOpen).toBe(false);
  });

  it('a nearer REAL day still wins over an older one — only bare days are skipped', () => {
    const carry = drawerCarryOver([openDay('2026-03-12', 940), closedDay('2026-03-14', 300)], '2026-03-16');
    expect(carry!.fromDate).toBe('2026-03-14');
    expect(carry!.float).toBe(300);
  });

  it('a day counted at exactly $0 is a real count, and stops the search there', () => {
    const emptied = recon({ date: '2026-03-14', openedAt: 1, countedCash: 0, expectedCash: 0, reconciledAt: 2 });
    const carry = drawerCarryOver([openDay('2026-03-13', 940), emptied], '2026-03-16');
    expect(carry!.fromDate).toBe('2026-03-14');
    expect(carry!.float).toBe(0);
    expect(carry!.stillOpen).toBe(false);
  });
});
