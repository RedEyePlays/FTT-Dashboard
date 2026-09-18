import { StaffBonus, BonusPaidFrom } from '../types';
import { DrawerEffect } from './dropoffs';

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
