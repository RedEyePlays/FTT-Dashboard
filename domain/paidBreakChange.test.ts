import { describe, it, expect } from 'vitest';
import { AppUser, TimeEntry, TimeBreak, PayPeriodApproval, PayPeriodPaid, BreakReason } from '../types';
import {
  paidBreakChangeImpact, paidBreakChangeMessage, paidBreakChangeAudit,
  paidBreakSettingNote, sameReasons,
} from './paidBreakChange';
import { payPeriodFor, paidKey, toISODate, PAY_PERIOD_DAYS, PAY_PERIOD_ANCHOR } from './timeclock';

// Ticking a paid-break reason in Settings quietly rewrites hours for every
// period that hasn't been paid yet. Already-paid periods are safe — they carry
// a snapshot — but "safe" is not the same as "the owner knew". These tests pin
// down what the confirm message is allowed to claim.

const H = 3_600_000;
const M = 60_000;
const NOW = Date.UTC(2026, 8, 19, 18, 0, 0);

const period = payPeriodFor(NOW, PAY_PERIOD_DAYS, PAY_PERIOD_ANCHOR);
const PERIOD_START = toISODate(period.start);
const dayInPeriod = period.start + 2 * 24 * H + 9 * H;

const user = (id: string, rate = 20): AppUser =>
  ({ id, email: `${id}@shop.test`, role: 'employee', hourlyRate: rate, disabled: false } as AppUser);

const brk = (startMs: number, minutes: number, reason: BreakReason): TimeBreak =>
  ({ id: `b-${startMs}-${reason}`, start: startMs, end: startMs + minutes * M, reason });

const shift = (id: string, userId: string, at: number, hours: number, breaks: TimeBreak[] = []): TimeEntry =>
  ({ id, userId, clockIn: at, clockOut: at + hours * H, breaks, createdAt: at });

const approval = (userId: string, reasons?: BreakReason[]): PayPeriodApproval => ({
  id: paidKey(userId, PERIOD_START), userId, periodStart: PERIOD_START, periodEnd: PERIOD_START,
  approvedBy: 'owner', approvedAt: NOW, hours: 8, gross: 160, rate: 20,
  ...(reasons ? { paidBreakReasons: reasons } : {}),
});
const paidRecord = (userId: string): PayPeriodPaid => ({
  id: paidKey(userId, PERIOD_START), userId, periodStart: PERIOD_START, periodEnd: PERIOD_START,
  markedBy: 'owner', markedAt: NOW, hours: 8, gross: 160, rate: 20,
});

// Three people, one 8-hour shift each, every one with a 30-minute lunch — so
// marking lunch paid moves all three by exactly half an hour.
const users = [user('u1'), user('u2'), user('u3')];
const entries: TimeEntry[] = users.map((u, i) =>
  shift(`e${i}`, u.id, dayInPeriod + i * 24 * H, 8, [brk(dayInPeriod + i * 24 * H + 3 * H, 30, 'lunch')]));

const impactOf = (over: Partial<Parameters<typeof paidBreakChangeImpact>[0]> = {}) =>
  paidBreakChangeImpact({
    entries, users, approvals: [], paid: [],
    before: [], after: ['lunch'], now: NOW, ...over,
  });

describe('what the confirm message is allowed to claim', () => {
  it('counts the periods that really move, split by state', () => {
    const impact = impactOf({ approvals: [approval('u2')], paid: [paidRecord('u3')] });
    expect(impact.open.map(p => p.userId)).toEqual(['u1']);
    expect(impact.approvedUnpaid.map(p => p.userId)).toEqual(['u2']);
    expect(impact.paidUnaffected.map(p => p.userId)).toEqual(['u3']);
  });

  it('an already-PAID period is reported but never counted as recalculating', () => {
    const impact = impactOf({ paid: users.map(u => paidRecord(u.id)) });
    expect(impact.open).toHaveLength(0);
    expect(impact.approvedUnpaid).toHaveLength(0);
    expect(impact.paidUnaffected).toHaveLength(3);
    expect(paidBreakChangeMessage(impact)).toContain('No period that is still open');
  });

  it('an approved-but-unpaid period DOES recalculate — that is the hazard', () => {
    const impact = impactOf({ approvals: users.map(u => approval(u.id)) });
    expect(impact.approvedUnpaid).toHaveLength(3);
    expect(impact.open).toHaveLength(0);
    const moved = impact.approvedUnpaid[0];
    expect(moved.hoursBefore).toBe(7.5);
    expect(moved.hoursAfter).toBe(8);
    expect(moved.grossAfter - moved.grossBefore).toBe(10); // 0.5h × $20
  });

  it('the sentence carries the REAL numbers, not a hardcoded one', () => {
    const impact = impactOf({ approvals: [approval('u2'), approval('u3')] });
    expect(paidBreakChangeMessage(impact))
      .toBe('This changes hours for every period not yet paid. 1 open period and 2 approved-but-unpaid periods will recalculate. Periods already paid are unchanged.');
  });

  it('says nothing alarming when nothing actually moves', () => {
    // Nobody took a bank-run break, so marking bank paid changes no figure.
    const impact = impactOf({ after: ['bank'] });
    expect(impact.open).toHaveLength(0);
    expect(paidBreakChangeMessage(impact)).toContain('No period that is still open');
  });

  it('a period with no shifts in it is not counted at all', () => {
    expect(impactOf({ entries: [] }).open).toHaveLength(0);
  });

  it('a no-op change (same reasons, different order) is not a change', () => {
    expect(sameReasons(['lunch', 'bank'], ['bank', 'lunch'])).toBe(true);
    const impact = paidBreakChangeImpact({
      entries, users, approvals: [], paid: [],
      before: ['lunch', 'bank'], after: ['bank', 'lunch'], now: NOW,
    });
    expect(impact.open).toHaveLength(0);
  });

  it('the KIOSK device account is never counted as an employee', () => {
    const withKiosk = [...users, { ...user('ipad'), role: 'kiosk' } as AppUser];
    expect(impactOf({ users: withKiosk }).open.map(p => p.userId)).not.toContain('ipad');
  });

  it('UN-ticking a reason is counted the same way — the change runs both ways', () => {
    const impact = impactOf({ before: ['lunch'], after: [] });
    expect(impact.open).toHaveLength(3);
    expect(impact.open[0].hoursBefore).toBe(8);
    expect(impact.open[0].hoursAfter).toBe(7.5);
  });
});

describe('the change is recorded', () => {
  it('the audit payload carries old reasons, new reasons and the counts', () => {
    const impact = impactOf({ approvals: [approval('u2')], paid: [paidRecord('u3')] });
    expect(paidBreakChangeAudit([], ['lunch'], impact)).toEqual({
      before: [], after: ['lunch'],
      openPeriodsAffected: 1,
      approvedUnpaidPeriodsAffected: 1,
      paidPeriodsUnchanged: 1,
    });
  });
});

describe('the note on a period computed under a different setting', () => {
  const CHANGED = Date.UTC(2026, 8, 15, 12, 0, 0);

  it('says so, and dates it', () => {
    expect(paidBreakSettingNote([], ['lunch'], CHANGED))
      .toMatch(/^Paid-break setting changed on .+ — figures recalculated\.$/);
  });

  it('says nothing when the setting is the one the figures were computed under', () => {
    expect(paidBreakSettingNote(['lunch'], ['lunch'], CHANGED)).toBeNull();
    expect(paidBreakSettingNote(['lunch', 'bank'], ['bank', 'lunch'], CHANGED)).toBeNull();
  });

  it('says nothing for an approval written before the setting was captured', () => {
    // Undefined is UNKNOWN, not different. Claiming a recalculation that may
    // never have happened would put a false statement on a payroll screen.
    expect(paidBreakSettingNote(undefined, ['lunch'], CHANGED)).toBeNull();
  });

  it('still says so when the change was never dated', () => {
    expect(paidBreakSettingNote([], ['lunch'])).toBe('Paid-break setting changed since approval — figures recalculated.');
  });
});
