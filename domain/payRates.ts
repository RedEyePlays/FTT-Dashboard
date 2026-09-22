import { AppUser, PayPeriodPaid, RateChange } from '../types';
import { toISODate, PayPeriod, RateAt, RateSegment } from './timeclock';

/**
 * A PAY RATE IS A THING THAT CHANGES, AND THE OLD HOURS KEEP THE OLD RATE.
 *
 * THE BUG: AppUser.hourlyRate was a single number with no history, and a
 * period's gross was hours × the CURRENT rate. So giving somebody a raise
 * halfway through a period silently repriced every unpaid hour in it —
 * including the hours they worked the week before, at the old rate. The shop
 * either overpaid the back half of the period or the employee noticed and had
 * to be talked through why the number moved.
 *
 * Already-PAID periods were never affected, because PayPeriodPaid and
 * PayPeriodApproval snapshot hours, rate and gross at sign-off. That discipline
 * is left exactly as it was — this module only fixes what happens BEFORE
 * sign-off.
 *
 * The rule, and it is the only rule: A SHIFT IS PAID AT THE RATE IN EFFECT ON
 * THE DAY IT WAS CLOCKED IN, in local time. Not the day it ended (a shift
 * crossing midnight is one shift at one rate), not the period's rate (there may
 * be two), and never toISOString, which would move a late-evening shift onto
 * the next day for anyone west of UTC and quietly pay it at the new rate a day
 * early.
 *
 * NO MIGRATION. `hourlyRate` stays the current rate and every existing reader
 * keeps working; a user with no `rateHistory` is treated as one entry effective
 * from the beginning of time, which prices exactly as it did before.
 *
 * Pure: no DOM, no Firestore.
 */

/** The whole rate timeline, oldest first. */
export const rateTimeline = (
  u: Pick<AppUser, 'hourlyRate' | 'rateHistory'>,
): RateChange[] => {
  const history = (u.rateHistory || []).filter(r => !!r && typeof r.rate === 'number');
  if (history.length === 0) {
    // A legacy user: one rate, effective from the beginning. '' sorts before
    // every real YYYY-MM-DD, so it is genuinely "always has been".
    return u.hourlyRate == null ? [] : [{ rate: u.hourlyRate, effectiveFrom: '', setBy: '', setAt: 0 }];
  }
  return [...history].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.setAt - b.setAt);
};

/**
 * The rate in force on a local calendar date.
 *
 * The LAST entry whose effectiveFrom is on or before that date wins, so two
 * changes made for the same day resolve to the later one rather than to
 * whichever happened to be stored first.
 *
 * Returns undefined when nothing applies — the person had no rate then. That is
 * deliberately distinct from 0: "not set" is what the payroll screen warns
 * about, and collapsing it to zero is how hours silently become $0.
 */
export const rateOnDate = (
  u: Pick<AppUser, 'hourlyRate' | 'rateHistory'>,
  dateISO: string,
): number | undefined => {
  const timeline = rateTimeline(u);
  let found: number | undefined;
  for (const r of timeline) {
    if (r.effectiveFrom <= dateISO) found = r.rate;
    else break;
  }
  // Before the first entry there is no rate. A legacy user's single entry is
  // effective from '', so this never strands them.
  return found;
};

/** The rate a shift is paid at: the rate in force on its CLOCK-IN local date. */
export const rateForShift = (
  u: Pick<AppUser, 'hourlyRate' | 'rateHistory'>,
  clockInMs: number,
): number | undefined => rateOnDate(u, toISODate(clockInMs));

/* ---------------- Splitting a period across a raise ---------------- */

/**
 * The pricing callback domain/timeclock.ts's periodPayFor takes.
 *
 * The segmentation itself lives in timeclock.ts (segmentShifts) so there is ONE
 * implementation of "hours grouped by the rate they were earned at"; this
 * module only answers "what was this person on that day".
 */
export const rateAtFor = (
  u: Pick<AppUser, 'hourlyRate' | 'rateHistory'>,
): RateAt => (clockInMs: number) => rateForShift(u, clockInMs);

/** "8.00 hrs × $16.00 + 12.50 hrs × $17.00". Empty when nothing was worked. */
export const segmentsLabel = (segments: RateSegment[]): string =>
  segments.map(s => `${s.hours.toFixed(2)} hrs × $${s.rate.toFixed(2)}`).join(' + ');

/* ---------------- Changing a rate ---------------- */

/**
 * The default effective date for a rate change: the start of the NEXT pay
 * period.
 *
 * Defaulting to "today" would split the period in progress every single time,
 * which is technically correct and practically annoying — the common case is
 * "from the next period he's on $17". Backdating stays available, with a
 * confirmation, for the case where the raise was agreed a fortnight ago.
 */
export const defaultEffectiveFrom = (currentPeriod: PayPeriod): string =>
  toISODate(currentPeriod.end);

/**
 * Pay periods a backdated change would REPRICE — every unpaid period the new
 * effective date reaches back into.
 *
 * Named in the confirmation, because "this changes what you owe for work
 * already done" is exactly the sentence somebody needs to read before agreeing
 * to it.
 */
export const periodsRepricedBy = (
  effectiveFrom: string,
  periods: PayPeriod[],
  isPaid: (p: PayPeriod) => boolean,
): PayPeriod[] =>
  periods.filter(p => !isPaid(p) && toISODate(p.end) > effectiveFrom);

/**
 * A period is PAID for this user when a PayPeriodPaid record exists for it.
 *
 * Approval alone is not enough: an approved-but-unpaid period can legitimately
 * be repriced and re-approved, and refusing that would leave the owner with no
 * way to fix a rate he got wrong before the money moved.
 */
export const paidPeriodStarts = (paid: PayPeriodPaid[], userId: string): Set<string> =>
  new Set(paid.filter(p => p.userId === userId).map(p => p.periodStart));

export type RateChangeRefusal =
  | { ok: true }
  | { ok: false; reason: 'inside_paid_period'; periodStart: string };

/**
 * May this rate change take effect on this date?
 *
 * The ONE hard refusal: a date inside a period that has already been PAID.
 * Those figures were signed off and the cash has left the till; repricing them
 * would make the stored snapshot disagree with the screen forever, with no
 * record of which one was real. Everything else is allowed, with a warning.
 */
export const rateChangeAllowed = (
  effectiveFrom: string,
  paid: PayPeriodPaid[],
  userId: string,
): RateChangeRefusal => {
  const hit = paid.find(p =>
    p.userId === userId && effectiveFrom >= p.periodStart && effectiveFrom <= p.periodEnd);
  return hit ? { ok: false, reason: 'inside_paid_period', periodStart: hit.periodStart } : { ok: true };
};

export const RATE_IN_PAID_PERIOD_MESSAGE =
  'That date falls inside a pay period that has already been paid out. Those figures were signed off and the cash has gone — pick a date after it.';

/**
 * Apply a rate change to a user, keeping `hourlyRate` and `rateHistory` in step.
 *
 * `hourlyRate` remains the CURRENT rate (the rate in force today) rather than
 * simply the newest entry, so a change dated into the future does not make
 * today's rate read as next month's. Every existing reader of `hourlyRate`
 * keeps giving the right answer without knowing this module exists.
 */
export const applyRateChange = (
  u: Pick<AppUser, 'hourlyRate' | 'rateHistory'>,
  change: RateChange,
  todayISO: string,
): { hourlyRate: number; rateHistory: RateChange[] } => {
  // A legacy user's synthetic "always has been" entry is MATERIALISED on the
  // first real change, so the old rate keeps applying to the old hours instead
  // of being overwritten by the new one. This is the only moment any of this is
  // written down, which is why no migration was needed.
  const seeded = rateTimeline(u);
  const rateHistory = [...seeded.filter(r => r.effectiveFrom !== change.effectiveFrom), change]
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.setAt - b.setAt);
  return { hourlyRate: rateOnDate({ rateHistory }, todayISO) ?? change.rate, rateHistory };
};

/* ---------------- Display ---------------- */

/** Rate history newest first, for the owner's view of a person. */
export const rateHistoryForDisplay = (
  u: Pick<AppUser, 'hourlyRate' | 'rateHistory'>,
): RateChange[] => [...rateTimeline(u)].reverse();

export const effectiveFromLabel = (r: RateChange): string =>
  r.effectiveFrom ? `from ${r.effectiveFrom}` : 'from the start';
