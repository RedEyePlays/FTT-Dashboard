import { describe, it, expect } from 'vitest';
import { StaffBonus, Expense, SalesTransaction } from '../types';
import {
  bonusDrawerEffect, bonusTotal, bonusesInRange, bonusesForPeriod, bonusesForUser,
  periodPayTotals, canSeeBonus, visibleBonuses, canSaveBonus,
} from './bonuses';
import { profitAndLoss, ProfitLossInput, yearEndSummary } from './reports';
import { DEFAULT_EXPENSE_CATEGORIES } from './expenses';

// THE HOLE THIS CLOSES. Pay-period gross is strictly hours × rate, so a bonus
// had nowhere to live. Logging it as a "Wages" expense looked right and was
// silently wrong: the Wages category is excludeFromPL — it exists for
// visibility, and is excluded so hourly payroll (already subtracted from the
// pay-period records) isn't counted twice. A bonus entered that way therefore
// NEVER reduced net profit. That is real money vanishing from the books.

const bonus = (over: Partial<StaffBonus> = {}): StaffBonus => ({
  id: 'b1', userId: 'u1', userEmail: 'sam@shop.test', amount: 100,
  date: '2026-09-15', reason: 'busy Saturday', paidFrom: 'store_cash',
  createdBy: 'owner', createdAt: 1, ...over,
});

describe('only store cash moves the drawer', () => {
  it('a store-cash bonus is a cash-out', () => {
    expect(bonusDrawerEffect(bonus({ amount: 100, paidFrom: 'store_cash' })))
      .toEqual({ kind: 'cashOut', amount: 100 });
  });

  it("the owner's own pocket never touches the till", () => {
    expect(bonusDrawerEffect(bonus({ paidFrom: 'personal' }))).toBeNull();
  });

  it('e-transfer and other never touch it either', () => {
    expect(bonusDrawerEffect(bonus({ paidFrom: 'etransfer' }))).toBeNull();
    expect(bonusDrawerEffect(bonus({ paidFrom: 'other' }))).toBeNull();
  });

  it('a zero or near-zero bonus produces no entry', () => {
    expect(bonusDrawerEffect(bonus({ amount: 0 }))).toBeNull();
    expect(bonusDrawerEffect(bonus({ amount: 0.001 }))).toBeNull();
  });
});

describe('dating — a bonus belongs to the day it was PAID', () => {
  const list = [
    bonus({ id: 'a', date: '2026-08-31', amount: 50 }),
    bonus({ id: 'b', date: '2026-09-01', amount: 100 }),
    bonus({ id: 'c', date: '2026-09-30', amount: 25 }),
    bonus({ id: 'd', date: '2026-10-01', amount: 999 }),
  ];

  it('an inclusive range takes both endpoints', () => {
    expect(bonusesInRange(list, '2026-09-01', '2026-09-30').map(b => b.id)).toEqual(['b', 'c']);
  });

  it('totals only what falls inside', () => {
    expect(bonusTotal(list, '2026-09-01', '2026-09-30')).toBe(125);
  });

  it('a July bonus handed over in August is an AUGUST cost', () => {
    // Dated by `date`, never by the period it may be attached to — which is
    // what the accountant needs.
    const late = bonus({ date: '2026-08-05', payPeriodStart: '2026-07-01', amount: 200 });
    expect(bonusTotal([late], '2026-08-01', '2026-08-31')).toBe(200);
    expect(bonusTotal([late], '2026-07-01', '2026-07-31')).toBe(0);
  });
});

describe('the P&L counts a bonus exactly once', () => {
  const base: ProfitLossInput = {
    transactions: [], inventory: [], payPeriods: [], cashReconciliations: [],
    settlements: [], expenses: [], expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
  };
  const pl = (input: Partial<ProfitLossInput>) =>
    profitAndLoss({ ...base, ...input }, '2026-09-01', '2026-09-30');

  it('a bonus gets its own line and reduces net profit', () => {
    const p = pl({ bonuses: [bonus({ amount: 250 })] });
    expect(p.bonuses).toBe(250);
    expect(p.netProfit).toBe(-250);
  });

  it('it is NOT folded into payroll — that line stays the hourly figure', () => {
    const p = pl({ bonuses: [bonus({ amount: 250 })] });
    expect(p.payroll).toBe(0);
  });

  it('the regression: a WAGES expense still does not reduce net profit', () => {
    // Unchanged on purpose — Wages stays excludeFromPL so hourly payroll
    // isn't double-counted. This is exactly why a bonus needed its own
    // record instead.
    const wagesExpense: Expense = {
      id: 'e1', date: '2026-09-15', amount: 250, category: 'wages',
      paymentMethod: 'cash', enteredBy: 'owner', enteredByEmail: 'owner@shop.test', createdAt: 1,
    } as Expense;
    const p = pl({ expenses: [wagesExpense] });
    expect(p.expenses).toBe(0);
    expect(p.netProfit).toBe(0);
  });

  it('the same $250 counts once as a bonus and zero times as a Wages expense', () => {
    const wagesExpense: Expense = {
      id: 'e1', date: '2026-09-15', amount: 250, category: 'wages',
      paymentMethod: 'cash', enteredBy: 'owner', enteredByEmail: 'owner@shop.test', createdAt: 1,
    } as Expense;
    const p = pl({ bonuses: [bonus({ amount: 250 })], expenses: [wagesExpense] });
    // Not −500: the Wages line is informational and never enters net profit.
    expect(p.netProfit).toBe(-250);
  });

  it('a bonus outside the range does not count', () => {
    expect(pl({ bonuses: [bonus({ date: '2026-08-31' })] }).bonuses).toBe(0);
  });

  it('no bonuses at all behaves exactly as before', () => {
    expect(pl({}).bonuses).toBe(0);
    expect(pl({}).netProfit).toBe(0);
  });

  it('the year-end accountant export carries the same figure', () => {
    const s = yearEndSummary({ ...base, bonuses: [bonus({ amount: 250, date: '2026-09-15' })] }, 2026);
    expect(s.bonuses).toBe(250);
    expect(s.netProfit).toBe(-250);
  });
});

describe('"Hours pay + Bonus = Total" for a period', () => {
  const list = [
    bonus({ id: 'in', userId: 'u1', amount: 100, payPeriodStart: '2026-09-01' }),
    bonus({ id: 'side', userId: 'u1', amount: 75 }),                                   // standalone
    bonus({ id: 'other-period', userId: 'u1', amount: 40, payPeriodStart: '2026-08-01' }),
    bonus({ id: 'other-user', userId: 'u2', amount: 500, payPeriodStart: '2026-09-01' }),
  ];

  it('adds only the bonuses attached to THIS period, for THIS employee', () => {
    expect(periodPayTotals(800, list, 'u1', '2026-09-01'))
      .toEqual({ hoursPay: 800, bonus: 100, total: 900 });
  });

  it('a standalone "on the side" bonus is deliberately excluded from the period', () => {
    // It still counts in profit — it just was not part of this period's
    // payout, and folding it in would misstate the period.
    expect(bonusesForPeriod(list, 'u1', '2026-09-01').map(b => b.id)).toEqual(['in']);
  });

  it('a period with no bonuses reads exactly as the hours pay', () => {
    expect(periodPayTotals(800, [], 'u1', '2026-09-01'))
      .toEqual({ hoursPay: 800, bonus: 0, total: 800 });
  });

  it('every bonus for an employee is still listed, newest first', () => {
    const forUser = bonusesForUser([
      bonus({ id: 'old', userId: 'u1', date: '2026-09-01' }),
      bonus({ id: 'new', userId: 'u1', date: '2026-09-20' }),
      bonus({ id: 'theirs', userId: 'u2', date: '2026-09-20' }),
    ], 'u1');
    expect(forUser.map(b => b.id)).toEqual(['new', 'old']);
  });
});

describe('visibility — a bonus is somebody\'s pay', () => {
  const mine = bonus({ userId: 'u1' });
  const theirs = bonus({ id: 'b2', userId: 'u2' });

  it('the payroll tier sees everyone\'s', () => {
    expect(canSeeBonus(theirs, { id: 'u1', canViewPayroll: true })).toBe(true);
  });

  it('an employee sees their own', () => {
    expect(canSeeBonus(mine, { id: 'u1', canViewPayroll: false })).toBe(true);
  });

  it("an employee NEVER sees a colleague's", () => {
    expect(canSeeBonus(theirs, { id: 'u1', canViewPayroll: false })).toBe(false);
    expect(visibleBonuses([mine, theirs], { id: 'u1', canViewPayroll: false }).map(b => b.id)).toEqual(['b1']);
  });

  it('the payroll tier\'s list is unfiltered', () => {
    expect(visibleBonuses([mine, theirs], { id: 'u1', canViewPayroll: true })).toHaveLength(2);
  });
});

describe('a bonus must name a person, be worth something, and say why', () => {
  it('accepts a complete draft', () => {
    expect(canSaveBonus(bonus())).toBe(true);
  });
  it('rejects a missing amount, person, date or reason', () => {
    expect(canSaveBonus(bonus({ amount: 0 }))).toBe(false);
    expect(canSaveBonus(bonus({ userId: '' }))).toBe(false);
    expect(canSaveBonus(bonus({ date: '' }))).toBe(false);
    expect(canSaveBonus(bonus({ reason: '   ' }))).toBe(false);
  });
});
