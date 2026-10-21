import { describe, it, expect } from 'vitest';
import { AppUser, PayGroupChange, StaffBonus } from '../types';
import {
  bonusPeriodLabel, bonusPeriodMismatch, bonusPeriodMismatches, bonusTotal,
  bonusesForPeriod, canSaveBonus, mismatchLabel, periodPayTotals,
  resolveBonusPeriod,
} from './bonuses';
import { payPeriodsForUser, periodForDate } from './payGroups';
import { toISODate } from './timeclock';

/**
 * A BONUS ATTACHES TO THE DATE'S PERIOD, NOT THE DROPDOWN'S.
 *
 * THE BUG. `payPeriodStart` came from the Pay period summary dropdown — the
 * period the owner happened to be LOOKING AT — and the date they typed never
 * influenced it. So: period ended yesterday, today is a new period, owner opens
 * the bonus box and types yesterday's date. The dropdown is on the new period.
 * The bonus filed against the new period, the old period's payout never moved,
 * and nothing on screen said so.
 *
 * Quiet, and money. domain/bonuses.test.ts already documents a previous
 * version of this same class of failure.
 */

const ANCHOR = '2026-01-05';            // a Monday
const CYCLE = 'biweekly' as const;

const user = (p: Partial<AppUser> = {}): AppUser => ({
  id: 'u1', email: 'sam@shop.test', role: 'employee', workspaceId: 'w1', ...p,
});

const bonus = (p: Partial<StaffBonus> = {}): StaffBonus => ({
  id: 'b1', userId: 'u1', userEmail: 'sam@shop.test', amount: 50,
  date: '2026-03-03', reason: 'busy Saturday', paidFrom: 'store_cash',
  createdBy: 'owner', createdAt: 1, ...p,
});

const at = (dateISO: string, hour = 12): number =>
  new Date(`${dateISO}T${String(hour).padStart(2, '0')}:00:00`).getTime();

/** The two periods the bug straddles: one ended, one current. */
const periodsAround = (dateISO: string, u: AppUser = user({ payGroup: 'A' })) =>
  payPeriodsForUser(u, at(dateISO), CYCLE, ANCHOR, 4).map(p => toISODate(p.start));

describe('the date decides the period', () => {
  // Group A on this anchor: periods start 2026-03-02, 2026-03-16, …
  const CURRENT = periodsAround('2026-03-18')[0];      // the period containing Mar 18
  const ENDED = periodsAround('2026-03-18')[1];        // the one before it

  it('sanity: the two candidate periods are different and adjacent', () => {
    expect(CURRENT).not.toBe(ENDED);
    expect(ENDED < CURRENT).toBe(true);
  });

  it('A BONUS DATED INSIDE AN ENDED PERIOD ATTACHES TO THAT PERIOD', () => {
    // The exact scenario from the report: the owner is looking at the current
    // period and types a date inside the one that already closed.
    const dateInEnded = ENDED;
    const resolved = resolveBonusPeriod(user({ payGroup: 'A' }), dateInEnded, CYCLE, ANCHOR);
    expect(resolved.periodStart).toBe(ENDED);
    expect(resolved.periodStart).not.toBe(CURRENT);
  });

  it('AND THAT PERIOD\'S TOTAL CHANGES', () => {
    // The consequence that was missing. periodPayTotals only counts bonuses
    // attached to the period it is asked about.
    const resolved = resolveBonusPeriod(user({ payGroup: 'A' }), ENDED, CYCLE, ANCHOR);
    const b = bonus({ date: ENDED, amount: 75, payPeriodStart: resolved.periodStart });

    expect(periodPayTotals(1000, [b], 'u1', ENDED).bonus).toBe(75);
    expect(periodPayTotals(1000, [b], 'u1', ENDED).total).toBe(1075);
    // And it is NOT on the period the dropdown was showing.
    expect(periodPayTotals(1000, [b], 'u1', CURRENT).bonus).toBe(0);
    expect(bonusesForPeriod([b], 'u1', ENDED).map(x => x.id)).toEqual(['b1']);
    expect(bonusesForPeriod([b], 'u1', CURRENT)).toEqual([]);
  });

  it('THE SELECTED PERIOD HAS NO EFFECT — resolution does not take one', () => {
    // Structural, and the point of the fix: there is nowhere to pass a
    // selected period into the resolver, so it cannot influence the answer.
    expect(resolveBonusPeriod.length).toBe(4);   // user, date, cycle, anchor
    // Same date, same answer, whatever the owner was looking at.
    const a = resolveBonusPeriod(user({ payGroup: 'A' }), ENDED, CYCLE, ANCHOR);
    const b = resolveBonusPeriod(user({ payGroup: 'A' }), ENDED, CYCLE, ANCHOR);
    expect(a.periodStart).toBe(b.periodStart);
  });

  it('a date inside the current period still lands there', () => {
    expect(resolveBonusPeriod(user({ payGroup: 'A' }), '2026-03-18', CYCLE, ANCHOR).periodStart)
      .toBe(CURRENT);
  });

  it('a date on a period boundary belongs to the period STARTING that day', () => {
    // `end` is exclusive everywhere else in PayPeriod; this follows it.
    expect(resolveBonusPeriod(user({ payGroup: 'A' }), CURRENT, CYCLE, ANCHOR).periodStart)
      .toBe(CURRENT);
  });
});

describe('a date in no period for that person stays standalone', () => {
  // Their first recorded group starts in March, so February is before they
  // had any periods at all.
  const history: PayGroupChange[] = [
    { group: 'A', effectiveFrom: '2026-03-02', setBy: 'owner', setAt: 1 },
  ];
  const joined = user({ payGroup: 'A', payGroupHistory: history });

  it('resolves to NOTHING, rather than the nearest period', () => {
    const resolved = resolveBonusPeriod(joined, '2026-02-10', CYCLE, ANCHOR);
    expect(resolved.period).toBeNull();
    expect(resolved.periodStart).toBeUndefined();
    expect(periodForDate(joined, '2026-02-10', CYCLE, ANCHOR)).toBeNull();
  });

  it('and the label says so plainly instead of pretending', () => {
    const resolved = resolveBonusPeriod(joined, '2026-02-10', CYCLE, ANCHOR);
    expect(bonusPeriodLabel(resolved)).toMatch(/outside every pay period/);
    expect(bonusPeriodLabel(resolved)).toMatch(/standalone/);
  });

  it('a malformed or empty date is standalone too, not a crash', () => {
    for (const date of ['', 'yesterday', '2026-3-2', '2026-02-31']) {
      const resolved = resolveBonusPeriod(joined, date, CYCLE, ANCHOR);
      expect({ date, period: resolved.periodStart }).toEqual({ date, period: undefined });
    }
  });
});

describe('a person who changed pay groups', () => {
  /**
   * The move is dated on a boundary (moveAllowed requires it). Group B's
   * periods start a week after A's, so the SAME DATE resolves to a different
   * period depending on which group was in force — which is the whole reason
   * this goes through groupOnDate and payGroupHistory rather than a single
   * schedule.
   */
  const moved = user({
    payGroup: 'B',
    payGroupHistory: [
      { group: 'A', effectiveFrom: '2026-01-05', setBy: 'owner', setAt: 1 },
      { group: 'B', effectiveFrom: '2026-03-16', setBy: 'owner', setAt: 2 },
    ],
  });

  it('resolves the group in force ON THAT DATE, not the current one', () => {
    // Before the move they were in A, after it in B — even though their
    // current group is B for both lookups.
    expect(resolveBonusPeriod(moved, '2026-03-03', CYCLE, ANCHOR).group).toBe('A');
    expect(resolveBonusPeriod(moved, '2026-03-30', CYCLE, ANCHOR).group).toBe('B');
  });

  it('A GROUP CHANGE BETWEEN THE TWO CANDIDATE PERIODS CHANGES THE ANSWER', () => {
    // The assertion that makes this test mean something: the same date, for
    // two people whose only difference is the group history, resolves to
    // DIFFERENT periods.
    const stayedInA = user({
      payGroup: 'A',
      payGroupHistory: [{ group: 'A', effectiveFrom: '2026-01-05', setBy: 'owner', setAt: 1 }],
    });
    const date = '2026-03-30';
    const asA = resolveBonusPeriod(stayedInA, date, CYCLE, ANCHOR);
    const asMoved = resolveBonusPeriod(moved, date, CYCLE, ANCHOR);

    expect(asA.group).toBe('A');
    expect(asMoved.group).toBe('B');
    expect(asMoved.periodStart).not.toBe(asA.periodStart);
    // Both are real periods — this is two correct answers, not one failure.
    expect(asA.period).not.toBeNull();
    expect(asMoved.period).not.toBeNull();
  });

  it('a date inside the catch-up period resolves to it, and says so', () => {
    // The gap a move opens belongs to neither group's regular periods.
    const periods = payPeriodsForUser(moved, at('2026-04-10'), CYCLE, ANCHOR, 6);
    const catchUp = periods.find(p => p.kind === 'catchup');
    expect(catchUp).toBeTruthy();
    const inside = toISODate(catchUp!.start);
    const resolved = resolveBonusPeriod(moved, inside, CYCLE, ANCHOR);
    expect(resolved.periodStart).toBe(inside);
    expect(bonusPeriodLabel(resolved)).toMatch(/catch-up period/);
  });
});

describe('the dialog states the resolved period before saving', () => {
  it('names the period, its end and the group', () => {
    const resolved = resolveBonusPeriod(user({ payGroup: 'A' }), '2026-03-18', CYCLE, ANCHOR);
    const label = bonusPeriodLabel(resolved);
    expect(label).toMatch(/Counts in the pay period 2026-03-16 → 2026-03-29/);
    expect(label).toMatch(/group A/);
  });

  it('CHANGES WHEN THE DATE CHANGES — it is derived, not stored', () => {
    const u = user({ payGroup: 'A' });
    const first = bonusPeriodLabel(resolveBonusPeriod(u, '2026-03-03', CYCLE, ANCHOR));
    const second = bonusPeriodLabel(resolveBonusPeriod(u, '2026-03-18', CYCLE, ANCHOR));
    expect(first).not.toBe(second);
    expect(first).toMatch(/2026-03-02/);
    expect(second).toMatch(/2026-03-16/);
  });
});

describe('unticking attach still gives a standalone bonus', () => {
  it('is what the type already means, and resolution is simply not used', () => {
    // The dialog builds `payPeriodStart: attach ? resolved.periodStart :
    // undefined`, so unticking produces an absent period regardless of what
    // the date resolved to. A standalone bonus is a real case, not an error.
    const resolved = resolveBonusPeriod(user({ payGroup: 'A' }), '2026-03-03', CYCLE, ANCHOR);
    expect(resolved.periodStart).toBeTruthy();   // a period WAS available
    const standalone = bonus({ date: '2026-03-03', payPeriodStart: undefined });
    expect(canSaveBonus(standalone)).toBe(true);
    expect(bonusesForPeriod([standalone], 'u1', resolved.periodStart!)).toEqual([]);
    // And it is never reported as a mismatch — nothing was claimed.
    expect(bonusPeriodMismatch(standalone, user({ payGroup: 'A' }), CYCLE, ANCHOR)).toBeNull();
  });
});

describe('bonuses already saved against the wrong period are FLAGGED, not rewritten', () => {
  const u = user({ payGroup: 'A' });
  // Dated in the period starting 2026-03-02, filed against 2026-03-16 — the
  // bug, as it exists in saved data.
  const wrong = bonus({ id: 'bad', date: '2026-03-03', payPeriodStart: '2026-03-16', amount: 60 });
  const right = bonus({ id: 'good', date: '2026-03-18', payPeriodStart: '2026-03-16' });

  it('spots the disagreement and names where it should have gone', () => {
    const m = bonusPeriodMismatch(wrong, u, CYCLE, ANCHOR);
    expect(m).toBeTruthy();
    expect(m!.attachedTo).toBe('2026-03-16');
    expect(m!.expected).toBe('2026-03-02');
  });

  it('leaves a correctly-filed bonus alone', () => {
    expect(bonusPeriodMismatch(right, u, CYCLE, ANCHOR)).toBeNull();
  });

  it('DOES NOT CHANGE THE BONUS — it only reports', () => {
    const before = JSON.stringify(wrong);
    const m = bonusPeriodMismatch(wrong, u, CYCLE, ANCHOR)!;
    // The flag carries the bonus by reference and alters nothing on it.
    expect(JSON.stringify(wrong)).toBe(before);
    expect(m.bonus.payPeriodStart).toBe('2026-03-16');
    expect(m.bonus).toBe(wrong);
  });

  it('lists them oldest date first, and skips standalone ones', () => {
    const standalone = bonus({ id: 'side', date: '2026-01-09', payPeriodStart: undefined });
    const older = bonus({ id: 'older', date: '2026-02-17', payPeriodStart: '2026-03-16' });
    const found = bonusPeriodMismatches([wrong, right, standalone, older], [u], CYCLE, ANCHOR);
    expect(found.map(m => m.bonus.id)).toEqual(['older', 'bad']);
  });

  it('does not cry wolf on a bonus whose user no longer exists', () => {
    // No user record means no group history to resolve against. Reporting a
    // mismatch nobody can substantiate would flag exactly the rows nobody can
    // fix.
    expect(bonusPeriodMismatch(wrong, undefined, CYCLE, ANCHOR)).toBeNull();
    expect(bonusPeriodMismatches([wrong], [], CYCLE, ANCHOR)).toEqual([]);
  });

  it('reads as a sentence the owner can act on', () => {
    const m = bonusPeriodMismatch(wrong, u, CYCLE, ANCHOR)!;
    const label = mismatchLabel(m);
    expect(label).toMatch(/sam — \$60\.00 dated 2026-03-03/);
    expect(label).toMatch(/counted in the period starting 2026-03-16/);
    expect(label).toMatch(/that date falls in 2026-03-02/);
  });

  it('a bonus dated outside every period is flagged with no expected period', () => {
    const joined = user({
      payGroupHistory: [{ group: 'A', effectiveFrom: '2026-03-02', setBy: 'o', setAt: 1 }],
    });
    const early = bonus({ date: '2026-02-10', payPeriodStart: '2026-03-02' });
    const m = bonusPeriodMismatch(early, joined, CYCLE, ANCHOR)!;
    expect(m.expected).toBeUndefined();
    expect(mismatchLabel(m)).toMatch(/that date is in no pay period for them/);
  });

  it('A FLAGGED BONUS DOES NOT BLOCK APPROVAL', () => {
    // There is no blocking signal to find: the mismatch is a list of records
    // for a human to read, and nothing in it is consulted by approval. The
    // shape carries no flag an approval path could branch on.
    const m = bonusPeriodMismatch(wrong, u, CYCLE, ANCHOR)!;
    expect(Object.keys(m).sort()).toEqual(['attachedTo', 'bonus', 'expected']);
    expect('blocks' in m).toBe(false);
    expect('blocksApproval' in m).toBe(false);
    // And the period's own figures are unaffected by the flag existing.
    expect(periodPayTotals(1000, [wrong], 'u1', '2026-03-16').bonus).toBe(60);
  });
});

describe('the P&L still dates bonuses by `date`', () => {
  it('is unchanged by any of this', () => {
    // types.ts: "the day it was paid; what the P&L dates it by". A bonus filed
    // against a different period must still hit profit on its own date.
    const b = bonus({ date: '2026-03-03', payPeriodStart: '2026-03-16', amount: 60 });
    // In range by DATE, regardless of the period it is attached to.
    expect(bonusTotal([b], '2026-03-01', '2026-03-10')).toBe(60);
    // And out of range by date, even though its period starts inside it.
    expect(bonusTotal([b], '2026-03-16', '2026-03-29')).toBe(0);
  });
});
