import { AppUser, BreakReason, TimeEntry, PayPeriodApproval, PayPeriodPaid } from '../types';
import {
  PayPeriod, PaidBreakReasons, payPeriodFor, periodPayFor, paidKey, isPayrollStaff,
  PAY_PERIOD_DAYS, PAY_PERIOD_ANCHOR, toISODate,
} from './timeclock';
import { rateAtFor } from './payRates';

/**
 * What ticking a paid-break reason in Settings actually does to people's pay.
 *
 * Periods that are already PAID are safe: PayPeriodPaid and PayPeriodApproval
 * snapshot hours, gross and rate at sign-off, so nothing recomputes them. But
 * every period that is still open — and every period approved but not yet paid
 * — recalculates the moment the setting changes, silently. This module works
 * out exactly which ones, so the owner is told the real number before the
 * change lands instead of finding out on payday.
 *
 * Pure: no Firestore, no DOM. The confirm dialog and the tests use the same
 * counts.
 */

export type PeriodState = 'open' | 'approved_unpaid' | 'paid';

export interface PeriodImpact {
  userId: string;
  periodStart: string;   // YYYY-MM-DD
  state: PeriodState;
  hoursBefore: number;
  hoursAfter: number;
  grossBefore: number;
  grossAfter: number;
}

export interface PaidBreakImpact {
  /** Periods still open whose figures change. */
  open: PeriodImpact[];
  /** Periods approved but not yet paid whose figures change. */
  approvedUnpaid: PeriodImpact[];
  /** Already-paid periods that WOULD have changed — reported, never altered. */
  paidUnaffected: PeriodImpact[];
}

export interface ImpactInput {
  entries: TimeEntry[];
  users: AppUser[];
  approvals: PayPeriodApproval[];
  paid: PayPeriodPaid[];
  before: PaidBreakReasons;
  after: PaidBreakReasons;
  now: number;
  days?: number;
  anchorISO?: string;
  /** How far back to look. Six periods matches the payroll picker. */
  periodsBack?: number;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Are two reason sets the same, order-insensitively? */
export const sameReasons = (a: PaidBreakReasons = [], b: PaidBreakReasons = []): boolean => {
  if (a.length !== b.length) return false;
  const sorted = (xs: PaidBreakReasons) => [...xs].sort();
  const [x, y] = [sorted(a), sorted(b)];
  return x.every((v, i) => v === y[i]);
};

/**
 * Every (person, period) pair whose hours or gross MOVE under the new setting.
 *
 * A pair whose figures are identical either way is not listed — the confirm
 * message must say what really changes, not how many periods exist.
 */
export const paidBreakChangeImpact = (input: ImpactInput): PaidBreakImpact => {
  const {
    entries, users, approvals, paid, before, after, now,
    days = PAY_PERIOD_DAYS, anchorISO = PAY_PERIOD_ANCHOR, periodsBack = 6,
  } = input;

  if (sameReasons(before, after)) return { open: [], approvedUnpaid: [], paidUnaffected: [] };

  const paidIds = new Set(paid.map(p => p.id));
  const approvedIds = new Set(approvals.map(a => a.id));
  const staff = users.filter(isPayrollStaff);

  // Only periods that actually contain shifts are worth walking. Bounded by
  // periodsBack so an old workspace doesn't scan years of history.
  const current = payPeriodFor(now, days, anchorISO);
  const oldest = current.index - (periodsBack - 1);
  const periods = new Map<number, PayPeriod>();
  for (const e of entries) {
    const p = payPeriodFor(e.clockIn, days, anchorISO);
    if (p.index >= oldest && p.index <= current.index) periods.set(p.index, p);
  }

  const out: PaidBreakImpact = { open: [], approvedUnpaid: [], paidUnaffected: [] };

  for (const period of periods.values()) {
    const periodStart = toISODate(period.start);
    for (const u of staff) {
      // Priced per shift at the rate in force on its clock-in date, so this
      // preview shows the same gross the payroll screen does.
      const rateAt = rateAtFor(u);
      const was = periodPayFor(entries, u.id, u.hourlyRate, period, now, before, rateAt);
      const will = periodPayFor(entries, u.id, u.hourlyRate, period, now, after, rateAt);
      if (was.hours === will.hours && was.gross === will.gross) continue;

      const key = paidKey(u.id, periodStart);
      const state: PeriodState = paidIds.has(key) ? 'paid'
        : approvedIds.has(key) ? 'approved_unpaid' : 'open';

      const impact: PeriodImpact = {
        userId: u.id, periodStart, state,
        hoursBefore: was.hours, hoursAfter: will.hours,
        grossBefore: round2(was.gross), grossAfter: round2(will.gross),
      };
      if (state === 'paid') out.paidUnaffected.push(impact);
      else if (state === 'approved_unpaid') out.approvedUnpaid.push(impact);
      else out.open.push(impact);
    }
  }
  return out;
};

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The confirm shown before the setting is saved, in the owner's words rather
 * than the app's. The counts are computed, never asserted — a message claiming
 * an impact that isn't real is worse than no message.
 */
export const paidBreakChangeMessage = (impact: PaidBreakImpact): string => {
  const n = impact.open.length + impact.approvedUnpaid.length;
  if (n === 0) {
    return 'This changes how breaks are paid from now on. No period that is still open or awaiting payment changes as a result.';
  }
  return [
    'This changes hours for every period not yet paid.',
    `${plural(impact.open.length, 'open period')} and ${plural(impact.approvedUnpaid.length, 'approved-but-unpaid period')} will recalculate.`,
    'Periods already paid are unchanged.',
  ].join(' ');
};

/** The audit payload for the change itself — old reasons → new reasons. */
export const paidBreakChangeAudit = (
  before: PaidBreakReasons, after: PaidBreakReasons, impact: PaidBreakImpact,
): Record<string, unknown> => ({
  before: [...before].sort(),
  after: [...after].sort(),
  openPeriodsAffected: impact.open.length,
  approvedUnpaidPeriodsAffected: impact.approvedUnpaid.length,
  paidPeriodsUnchanged: impact.paidUnaffected.length,
});

/**
 * The note on a pay period whose figures were computed under a DIFFERENT
 * setting than the one now in force.
 *
 * Returns null when there is nothing to say — including for an approval
 * recorded before the setting was captured at all. That is unknown, not
 * different, and guessing would put a false claim on a payroll screen.
 */
export const paidBreakSettingNote = (
  approvalReasons: BreakReason[] | undefined,
  current: PaidBreakReasons,
  changedAt?: number,
): string | null => {
  if (!approvalReasons) return null;
  if (sameReasons(approvalReasons, current)) return null;
  const when = changedAt
    ? new Date(changedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  return when
    ? `Paid-break setting changed on ${when} — figures recalculated.`
    : 'Paid-break setting changed since approval — figures recalculated.';
};
