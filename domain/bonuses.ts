import { AppUser, PayGroup, StaffBonus, BonusPaidFrom } from '../types';
import { DrawerEffect } from './dropoffs';
import { UserPayPeriod, groupOnDate, periodForDate } from './payGroups';
import { PayCycle, periodEndInclusive, toISODate } from './timeclock';

const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// Staff bonuses — one-off payments on top of hours.
//
// THE HOLE THIS CLOSES. Pay-period gross is strictly hours × rate, so a bonus
// had nowhere to live. Logging it as a "Wages" expense looked right and was
// silently wrong: the Wages category is excludeFromPL (it exists for
// visibility, and is excluded so hourly payroll — already subtracted from the
// pay-period records — isn't counted twice). A bonus entered that way
// therefore NEVER reduced net profit. Bonuses now have their own record and
// their own P&L line, counted exactly once.
//
// Pure, like every other money module here, so each rule is testable without
// Firestore or a component.

/** How each bonus payment source is worded, everywhere it is shown. */
export const BONUS_PAID_FROM_LABEL: Record<BonusPaidFrom, string> = {
  store_cash: 'Store cash',
  personal: "Owner's personal cash",
  etransfer: 'E-Transfer',
  other: 'Other',
};

/** The order the sources are offered in — till first, since it is the default. */
export const BONUS_PAID_FROM_OPTIONS: BonusPaidFrom[] =
  ['store_cash', 'personal', 'etransfer', 'other'];

/**
 * A bonus's effect on the cash drawer for the day it was paid.
 *
 * ONLY `store_cash` moves the till, exactly as with a refund
 * (domain/pos.ts's refundDrawerEffect) and a store-funded drop-off. Paying a
 * bonus out of the owner's own pocket leaves no trace on the store's books,
 * so 'personal' never touches the drawer; e-transfer and 'other' never did.
 */
export const bonusDrawerEffect = (b: Pick<StaffBonus, 'amount' | 'paidFrom'>): DrawerEffect | null => {
  if (b.paidFrom !== 'store_cash') return null;
  const amount = round2(b.amount);
  if (amount < 0.005) return null;
  return { kind: 'cashOut', amount };
};

/**
 * Bonuses paid inside an inclusive [lo, hi] date range, dated by `date` — the
 * day the money actually changed hands, not the period it might be attached
 * to. A bonus for July paid in August is an August cost, which is what the
 * accountant needs.
 */
export const bonusesInRange = (bonuses: StaffBonus[], lo: string, hi: string): StaffBonus[] =>
  bonuses.filter(b => !!b.date && b.date >= lo && b.date <= hi);

/** Total bonus money paid in an inclusive range — the P&L's "Bonuses" line. */
export const bonusTotal = (bonuses: StaffBonus[], lo: string, hi: string): number =>
  round2(bonusesInRange(bonuses, lo, hi).reduce((s, b) => s + (b.amount || 0), 0));

/** One employee's bonuses, newest first. */
export const bonusesForUser = (bonuses: StaffBonus[], userId: string): StaffBonus[] =>
  bonuses.filter(b => b.userId === userId).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

/**
 * One employee's bonuses ATTACHED to a given pay period. A standalone bonus
 * (no payPeriodStart) is deliberately excluded: it was paid on the side and
 * folding it into a period would misstate that period's payout.
 */
export const bonusesForPeriod = (
  bonuses: StaffBonus[], userId: string, periodStart: string,
): StaffBonus[] =>
  bonuses.filter(b => b.userId === userId && b.payPeriodStart === periodStart);

export interface PeriodPayTotals {
  hoursPay: number;
  bonus: number;
  total: number;
}

/**
 * "Hours pay + Bonus = Total" for one employee's pay period — the figure the
 * payroll screen and the printable summary both show, derived once here so
 * they cannot disagree.
 */
export const periodPayTotals = (
  hoursPay: number, bonuses: StaffBonus[], userId: string, periodStart: string,
): PeriodPayTotals => {
  const bonus = round2(bonusesForPeriod(bonuses, userId, periodStart).reduce((s, b) => s + (b.amount || 0), 0));
  const pay = round2(hoursPay);
  return { hoursPay: pay, bonus, total: round2(pay + bonus) };
};

/**
 * May this viewer see `bonus`?
 *
 * A bonus is somebody's pay. Anyone with payroll visibility already sees
 * everyone's wages, so they see bonuses too; everybody else sees only their
 * own, and never a colleague's. Expressed here rather than as a filter
 * scattered through the view so there is one rule to check.
 */
export const canSeeBonus = (
  bonus: Pick<StaffBonus, 'userId'>,
  viewer: { id: string; canViewPayroll: boolean },
): boolean => viewer.canViewPayroll || bonus.userId === viewer.id;

/** Every bonus this viewer may see, under the same rule. */
export const visibleBonuses = (
  bonuses: StaffBonus[], viewer: { id: string; canViewPayroll: boolean },
): StaffBonus[] => bonuses.filter(b => canSeeBonus(b, viewer));

/** A bonus must name a person, be worth something, and say why. */
export const canSaveBonus = (b: Partial<StaffBonus>): boolean =>
  !!b.userId && !!b.date && (b.amount || 0) > 0 && !!(b.reason || '').trim();

/* ---------------- Which period a bonus belongs to ---------------- */

/**
 * WHERE A BONUS LANDS, decided by its own DATE.
 *
 * THE BUG. `payPeriodStart` was taken from the Pay period summary dropdown —
 * the period the owner happened to be LOOKING AT — and the `date` field they
 * filled in never influenced it. The two were independent and nothing said so,
 * so a bonus dated into an ended period was filed against the current one: the
 * old period's payout never moved and the owner got no indication.
 *
 * The date is what the owner actually stated. The dropdown is scenery.
 *
 * Resolved for THE BONUS'S OWN USER, not the selected one and not the viewer —
 * somebody who changed pay groups has different boundaries, which is what
 * groupOnDate and payGroupHistory exist for (domain/payGroups.ts).
 *
 * A date in no period that person has stays STANDALONE: `payPeriodStart`
 * absent, which the type already means ("Absent = a standalone bonus, not tied
 * to any period"). It is never snapped to the nearest.
 */
export interface ResolvedBonusPeriod {
  /** The period's start as stored on the bonus, or undefined for standalone. */
  periodStart?: string;
  /** The period itself, for showing the owner what they are about to do. */
  period: UserPayPeriod | null;
  /** The group in force on that date — a group move changes the boundaries. */
  group: PayGroup;
}

export const resolveBonusPeriod = (
  user: Pick<AppUser, 'payGroup' | 'payGroupHistory'>,
  dateISO: string,
  cycle: PayCycle,
  anchorISO: string,
): ResolvedBonusPeriod => {
  const period = periodForDate(user, dateISO, cycle, anchorISO);
  return {
    ...(period ? { periodStart: toISODate(period.start) } : {}),
    period,
    group: groupOnDate(user, dateISO),
  };
};

/**
 * What the dialog says BEFORE saving, so the owner never has to work out which
 * period a date belongs to.
 *
 * The resolved period stated plainly, not a warning after the fact.
 */
export const bonusPeriodLabel = (resolved: ResolvedBonusPeriod): string => {
  if (!resolved.period) {
    return 'That date is outside every pay period for this person, so this will be saved as a standalone bonus — it still counts in profit, just not in any period total.';
  }
  const start = toISODate(resolved.period.start);
  const end = toISODate(periodEndInclusive(resolved.period));
  const kind = resolved.period.kind === 'catchup' ? ' (catch-up period)' : '';
  return `Counts in the pay period ${start} → ${end}${kind}, group ${resolved.group}.`;
};

/* ---------------- Bonuses already saved against the wrong period ---------------- */

/**
 * A saved bonus whose `date` and `payPeriodStart` disagree.
 *
 * SURFACED, NEVER REWRITTEN. Some bonuses are already attached to the wrong
 * period — at least one in this shop's live data. A migration that silently
 * re-attached them would change what a historical period paid out without
 * being asked, which is worse than the bug: the owner may have reconciled or
 * paid from the figure as it stands. So this reports the mismatch and the
 * owner decides; deleting and re-adding is the remedy.
 *
 * INFORMATIONAL. Nothing here blocks approval or alters a bonus.
 *
 * A STANDALONE bonus is never a mismatch. No period was claimed, so there is
 * nothing to disagree with — unticking "count this in the pay period" is a
 * real and common case, not an error.
 */
export interface BonusPeriodMismatch {
  bonus: StaffBonus;
  /** What it is filed against today. */
  attachedTo: string;
  /** Where its own date says it belongs — absent when the date is in no period. */
  expected?: string;
}

export const bonusPeriodMismatch = (
  bonus: StaffBonus,
  user: Pick<AppUser, 'payGroup' | 'payGroupHistory'> | undefined,
  cycle: PayCycle,
  anchorISO: string,
): BonusPeriodMismatch | null => {
  const attachedTo = bonus.payPeriodStart;
  // Standalone: nothing was claimed, so nothing can disagree.
  if (!attachedTo) return null;
  // No user record (a deleted account) means no group history to resolve
  // against. Reporting a mismatch we cannot substantiate would be a false
  // alarm on exactly the rows nobody can fix.
  if (!user) return null;

  const resolved = resolveBonusPeriod(user, bonus.date, cycle, anchorISO);
  if (resolved.periodStart === attachedTo) return null;
  return {
    bonus,
    attachedTo,
    ...(resolved.periodStart ? { expected: resolved.periodStart } : {}),
  };
};

/** Every saved bonus whose date and period disagree, oldest date first. */
export const bonusPeriodMismatches = (
  bonuses: StaffBonus[],
  users: Pick<AppUser, 'id' | 'payGroup' | 'payGroupHistory'>[],
  cycle: PayCycle,
  anchorISO: string,
): BonusPeriodMismatch[] => {
  const byId = new Map(users.map(u => [u.id, u]));
  return (bonuses || [])
    .map(b => bonusPeriodMismatch(b, byId.get(b.userId), cycle, anchorISO))
    .filter((m): m is BonusPeriodMismatch => m !== null)
    .sort((a, b) => a.bonus.date.localeCompare(b.bonus.date));
};

/** The line the review screen shows for one mismatch. */
export const mismatchLabel = (m: BonusPeriodMismatch): string =>
  `${m.bonus.userEmail.split('@')[0]} — $${(m.bonus.amount || 0).toFixed(2)} dated ${m.bonus.date}`
  + ` is counted in the period starting ${m.attachedTo}`
  + (m.expected
    ? `, but that date falls in ${m.expected}.`
    : ', but that date is in no pay period for them.');
