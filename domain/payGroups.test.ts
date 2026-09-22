import { describe, it, expect } from 'vitest';
import { AppUser } from '../types';
import {
  payGroupsApply, anchorForGroup, payGroupOf, groupOnDate, groupTimeline,
  payPeriodsForUser, catchUpPeriod, nextMoveDate, moveAllowed, applyGroupChange,
  periodRecordKey, userPeriodKey, userPeriodLabel, staffOnPeriod, PAY_GROUP_LABEL,
} from './payGroups';
import { toISODate, payPeriodFor, PAY_CYCLE_DAYS } from './timeclock';

const ANCHOR = '2026-01-05'; // a Monday
const at = (dateISO: string, hour = 12): number => new Date(`${dateISO}T${String(hour).padStart(2, '0')}:00:00`).getTime();

const user = (p: Partial<AppUser> = {}): AppUser => ({
  id: 'u1', email: 'sam@shop.test', role: 'employee', workspaceId: 'w1', ...p,
});

describe('groups only mean something on a bi-weekly cycle', () => {
  it('bi-weekly offsets group B by exactly 7 days; weekly does not offset at all', () => {
    expect(payGroupsApply('biweekly')).toBe(true);
    expect(payGroupsApply('weekly')).toBe(false);
    expect(anchorForGroup(ANCHOR, 'A', 'biweekly')).toBe(ANCHOR);
    expect(anchorForGroup(ANCHOR, 'B', 'biweekly')).toBe('2026-01-12');
    expect(anchorForGroup(ANCHOR, 'B', 'weekly')).toBe(ANCHOR);
  });

  it('a weekly cycle gives both groups the same periods', () => {
    const a = payPeriodsForUser(user({ payGroup: 'A' }), at('2026-03-04'), 'weekly', ANCHOR, 3);
    const b = payPeriodsForUser(user({ payGroup: 'B' }), at('2026-03-04'), 'weekly', ANCHOR, 3);
    expect(a.map(p => p.start)).toEqual(b.map(p => p.start));
    expect(b.every(p => p.group === 'A')).toBe(true); // groups are ignored outright
  });
});

describe('A and B periods alternate', () => {
  it('B\'s periods start a week after A\'s, and the two never share a boundary', () => {
    const now = at('2026-03-04');
    const a = payPeriodsForUser(user({ payGroup: 'A' }), now, 'biweekly', ANCHOR, 4);
    const b = payPeriodsForUser(user({ payGroup: 'B' }), now, 'biweekly', ANCHOR, 4);
    const aStarts = a.map(p => toISODate(p.start));
    const bStarts = b.map(p => toISODate(p.start));
    expect(aStarts).toEqual(['2026-03-02', '2026-02-16', '2026-02-02', '2026-01-19']);
    expect(bStarts).toEqual(['2026-02-23', '2026-02-09', '2026-01-26', '2026-01-12']);
    expect(aStarts.some(s => bStarts.includes(s))).toBe(false);
  });

  it('defaults an unset group to A', () => {
    expect(payGroupOf(user())).toBe('A');
    expect(groupOnDate(user(), '2026-03-04')).toBe('A');
    expect(groupTimeline(user())).toEqual([{ group: 'A', effectiveFrom: '', setBy: '', setAt: 0 }]);
  });
});

describe('moving somebody between groups', () => {
  const moveDate = '2026-03-02'; // an A boundary

  it('the default move date is the end of their current period', () => {
    expect(nextMoveDate(user({ payGroup: 'A' }), at('2026-02-20'), 'biweekly', ANCHOR)).toBe('2026-03-02');
  });

  it('produces exactly ONE catch-up period, 7 days long, bridging the gap', () => {
    const gap = catchUpPeriod(moveDate, 'A', 'B', 'biweekly', ANCHOR)!;
    expect(gap).toBeTruthy();
    expect(toISODate(gap.start)).toBe('2026-03-02');
    expect(toISODate(gap.end)).toBe('2026-03-09');
    expect(gap.kind).toBe('catchup');
    expect(gap.group).toBe('B');
    // 7 days exactly.
    expect(Math.round((gap.end - gap.start) / 86_400_000)).toBe(7);
  });

  it('bridges B → A the same way', () => {
    const gap = catchUpPeriod('2026-02-23', 'B', 'A', 'biweekly', ANCHOR)!;
    expect(toISODate(gap.start)).toBe('2026-02-23');
    expect(toISODate(gap.end)).toBe('2026-03-02');
    expect(gap.group).toBe('A');
  });

  it('bridges nothing on a weekly cycle or a no-op move', () => {
    expect(catchUpPeriod(moveDate, 'A', 'B', 'weekly', ANCHOR)).toBeNull();
    expect(catchUpPeriod(moveDate, 'A', 'A', 'biweekly', ANCHOR)).toBeNull();
  });

  it('NO HOURS ARE LOST OR DOUBLED across the move', () => {
    const moved = applyGroupChange(user({ payGroup: 'A' }), { group: 'B', effectiveFrom: moveDate, setBy: 'o', setAt: 1 }, '2026-03-20');
    const u = user(moved);
    const periods = payPeriodsForUser(u, at('2026-03-20'), 'biweekly', ANCHOR, 8);

    // Every day from well before the move up to today lands in EXACTLY one of
    // this person's periods — never both, never neither. (Days after today have
    // no period yet, which is correct and not what this is checking.)
    const lastDay = at('2026-03-20');
    for (let d = 0; at('2026-01-19') + d * 86_400_000 <= lastDay; d++) {
      const ms = at('2026-01-19') + d * 86_400_000;
      const hits = periods.filter(p => ms >= p.start && ms < p.end);
      expect({ day: toISODate(ms), hits: hits.length }).toEqual({ day: toISODate(ms), hits: 1 });
    }
  });

  it('the catch-up period sits between the last old period and the first new one', () => {
    const moved = applyGroupChange(user({ payGroup: 'A' }), { group: 'B', effectiveFrom: moveDate, setBy: 'o', setAt: 1 }, '2026-03-20');
    const periods = payPeriodsForUser(user(moved), at('2026-03-20'), 'biweekly', ANCHOR, 8);
    const catchups = periods.filter(p => p.kind === 'catchup');
    expect(catchups).toHaveLength(1);
    expect(toISODate(catchups[0].start)).toBe('2026-03-02');

    const before = periods.filter(p => p.end <= catchups[0].start);
    const after = periods.filter(p => p.start >= catchups[0].end);
    expect(before.every(p => p.group === 'A')).toBe(true);
    expect(after.every(p => p.group === 'B')).toBe(true);
  });

  it('refuses a move that reaches into an already-paid period, and a no-op move', () => {
    const paid = [{ userId: 'u1', periodStart: '2026-02-16', periodEnd: '2026-03-01' }];
    expect(moveAllowed(user({ payGroup: 'A' }), 'B', '2026-02-20', paid, 'u1'))
      .toEqual({ ok: false, reason: 'inside_paid_period', periodStart: '2026-02-16' });
    expect(moveAllowed(user({ payGroup: 'A' }), 'B', moveDate, paid, 'u1')).toEqual({ ok: true, effectiveFrom: moveDate });
    expect(moveAllowed(user({ payGroup: 'A' }), 'A', moveDate, [], 'u1')).toEqual({ ok: false, reason: 'same_group' });
  });

  it('keeps payGroup as TODAY\'s group when the move is dated into the future', () => {
    const next = applyGroupChange(user({ payGroup: 'A' }), { group: 'B', effectiveFrom: '2026-06-01', setBy: 'o', setAt: 1 }, '2026-03-20');
    expect(next.payGroup).toBe('A');
    expect(groupOnDate(next, '2026-06-01')).toBe('B');
  });
});

describe('record keys stay unique across groups', () => {
  it('group A regulars keep the LEGACY key verbatim, so existing records resolve', () => {
    expect(periodRecordKey('u1', '2026-03-02')).toBe('u1__2026-03-02');
    expect(periodRecordKey('u1', '2026-03-02', 'A', 'regular')).toBe('u1__2026-03-02');
  });

  it('a catch-up never collides with the regular period starting the same day', () => {
    // The move lands on an A boundary, which is also an A period start — the
    // exact collision a start-only key would have had.
    const regular = periodRecordKey('u1', '2026-03-02', 'A', 'regular');
    const catchup = periodRecordKey('u1', '2026-03-02', 'B', 'catchup');
    expect(catchup).toBe('u1__2026-03-02__catchup');
    expect(catchup).not.toBe(regular);
  });

  it('group B regulars are keyed apart from group A', () => {
    expect(periodRecordKey('u1', '2026-02-23', 'B')).toBe('u1__2026-02-23__B');
  });

  it('userPeriodKey uses the period\'s own group and kind', () => {
    const gap = catchUpPeriod('2026-03-02', 'A', 'B', 'biweekly', ANCHOR)!;
    expect(userPeriodKey('u1', gap)).toBe('u1__2026-03-02__catchup');
    const regular = { ...payPeriodFor(at('2026-03-04'), PAY_CYCLE_DAYS.biweekly, ANCHOR), group: 'A' as const, kind: 'regular' as const };
    expect(userPeriodKey('u1', regular)).toBe('u1__2026-03-02');
  });
});

describe('who is shown on a period', () => {
  const a = user({ id: 'a1', payGroup: 'A' });
  const b = user({ id: 'b1', payGroup: 'B' });
  const legacy = user({ id: 'l1' }); // no payGroup at all

  it('each period shows only its own group\'s people, and legacy users are group A', () => {
    const periodA = { ...payPeriodFor(at('2026-03-04'), 14, ANCHOR), group: 'A' as const, kind: 'regular' as const };
    const periodB = { ...payPeriodFor(at('2026-03-04'), 14, anchorForGroup(ANCHOR, 'B', 'biweekly')), group: 'B' as const, kind: 'regular' as const };
    expect(staffOnPeriod([a, b, legacy], periodA, 'biweekly').map(u => u.id)).toEqual(['a1', 'l1']);
    expect(staffOnPeriod([a, b, legacy], periodB, 'biweekly').map(u => u.id)).toEqual(['b1']);
  });

  it('a weekly cycle shows everybody on every period', () => {
    const p = { ...payPeriodFor(at('2026-03-04'), 7, ANCHOR), group: 'A' as const, kind: 'regular' as const };
    expect(staffOnPeriod([a, b, legacy], p, 'weekly')).toHaveLength(3);
  });

  it('a catch-up period shows only the person who actually moved', () => {
    const moved = user({ id: 'm1', ...applyGroupChange(user({ payGroup: 'A' }), { group: 'B', effectiveFrom: '2026-03-02', setBy: 'o', setAt: 1 }, '2026-03-20') });
    const gap = catchUpPeriod('2026-03-02', 'A', 'B', 'biweekly', ANCHOR)!;
    expect(staffOnPeriod([a, b, legacy, moved], gap, 'biweekly').map(u => u.id)).toEqual(['m1']);
  });
});

describe('labels', () => {
  it('names the group and the range, and marks a catch-up as one', () => {
    const p = { ...payPeriodFor(at('2026-03-04'), 14, ANCHOR), group: 'A' as const, kind: 'regular' as const };
    expect(userPeriodLabel(p)).toContain(PAY_GROUP_LABEL.A);
    expect(userPeriodLabel(p, false)).not.toContain('Group');
    const gap = catchUpPeriod('2026-03-02', 'A', 'B', 'biweekly', ANCHOR)!;
    expect(userPeriodLabel(gap)).toMatch(/^Catch-up · /);
  });
});
