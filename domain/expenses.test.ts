import { describe, it, expect } from 'vitest';
import { Expense, RecurringExpense } from '../types';
import {
  DEFAULT_EXPENSE_CATEGORIES, expensesInRange, plExpenseTotal, expenseTotalsByCategory,
  excludedFromPLKeys, duePeriodsFor, buildRecurringExpense,
  isVariableRecurring, amountModeOf, resolveRecurringAmount, lastAmountsForRecurring,
  visibleExpensesFor, canMutateExpense,
} from './expenses';

const exp = (p: Partial<Expense>): Expense => ({
  id: p.id || Math.random().toString(36), date: '2026-03-15', amount: 100, category: 'rent',
  paymentMethod: 'card', enteredBy: 'u1', enteredByEmail: 'u1@shop.test', createdAt: Date.now(), ...p,
});

describe('expensesInRange', () => {
  it('includes only expenses within the inclusive date range', () => {
    const list = [exp({ date: '2026-03-01' }), exp({ date: '2026-03-15' }), exp({ date: '2026-04-01' })];
    expect(expensesInRange(list, '2026-03-01', '2026-03-31')).toHaveLength(2);
  });
  it('normalizes a reversed start/end', () => {
    const list = [exp({ date: '2026-03-15' })];
    expect(expensesInRange(list, '2026-03-31', '2026-03-01')).toHaveLength(1);
  });
});

describe('plExpenseTotal', () => {
  it('sums all expenses in range', () => {
    const list = [exp({ amount: 100, category: 'rent' }), exp({ amount: 50, category: 'utilities' })];
    expect(plExpenseTotal(list, DEFAULT_EXPENSE_CATEGORIES, '2026-03-01', '2026-03-31')).toBe(150);
  });

  it('excludes Wages-category expenses — payroll is already subtracted separately, so this must not double-subtract it', () => {
    const list = [exp({ amount: 100, category: 'rent' }), exp({ amount: 2000, category: 'wages' })];
    expect(plExpenseTotal(list, DEFAULT_EXPENSE_CATEGORIES, '2026-03-01', '2026-03-31')).toBe(100);
  });

  it('respects a custom category list rather than hardcoding "wages"', () => {
    const categories = [{ key: 'rent', label: 'Rent' }, { key: 'contractors', label: 'Contractors', excludeFromPL: true }];
    const list = [exp({ amount: 100, category: 'rent' }), exp({ amount: 300, category: 'contractors' })];
    expect(plExpenseTotal(list, categories, '2026-03-01', '2026-03-31')).toBe(100);
  });
});

describe('excludedFromPLKeys', () => {
  it('collects every category flagged excludeFromPL', () => {
    expect([...excludedFromPLKeys(DEFAULT_EXPENSE_CATEGORIES)]).toEqual(['wages']);
  });
});

describe('expenseTotalsByCategory', () => {
  it('breaks totals out per category, including excluded-from-PL ones, sorted descending', () => {
    const list = [exp({ amount: 100, category: 'rent' }), exp({ amount: 2000, category: 'wages' }), exp({ amount: 50, category: 'utilities' })];
    const totals = expenseTotalsByCategory(list, DEFAULT_EXPENSE_CATEGORIES, '2026-03-01', '2026-03-31');
    expect(totals[0]).toEqual({ category: 'wages', label: 'Wages', total: 2000, excludedFromPL: true });
    expect(totals.find(t => t.category === 'rent')).toEqual({ category: 'rent', label: 'Rent', total: 100, excludedFromPL: false });
  });
});

describe('duePeriodsFor', () => {
  const user = { id: 'u1', email: 'u1@shop.test' };

  it('produces monthly periods from startDate through now', () => {
    const r: RecurringExpense = {
      id: 'r1', category: 'rent', amount: 1500, paymentMethod: 'etransfer', frequency: 'monthly',
      startDate: '2026-01-01', active: true, createdBy: 'u1', createdByEmail: 'u1@shop.test', createdAt: 0,
    };
    const due = duePeriodsFor(r, new Date('2026-03-15T00:00:00').getTime());
    expect(due.map(d => d.key)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('does not re-offer a period already generated or explicitly skipped', () => {
    const r: RecurringExpense = {
      id: 'r1', category: 'rent', amount: 1500, paymentMethod: 'etransfer', frequency: 'monthly',
      startDate: '2026-01-01', active: true, createdBy: 'u1', createdByEmail: 'u1@shop.test', createdAt: 0,
      generatedPeriods: ['2026-01'], skippedPeriods: ['2026-02'],
    };
    const due = duePeriodsFor(r, new Date('2026-03-15T00:00:00').getTime());
    expect(due.map(d => d.key)).toEqual(['2026-03']);
  });

  it('inactive recurring expenses never produce due periods', () => {
    const r: RecurringExpense = {
      id: 'r1', category: 'rent', amount: 1500, paymentMethod: 'etransfer', frequency: 'monthly',
      startDate: '2026-01-01', active: false, createdBy: 'u1', createdByEmail: 'u1@shop.test', createdAt: 0,
    };
    expect(duePeriodsFor(r, new Date('2026-06-01T00:00:00').getTime())).toHaveLength(0);
  });

  it('a future startDate produces no due periods yet', () => {
    const r: RecurringExpense = {
      id: 'r1', category: 'rent', amount: 1500, paymentMethod: 'etransfer', frequency: 'monthly',
      startDate: '2026-12-01', active: true, createdBy: 'u1', createdByEmail: 'u1@shop.test', createdAt: 0,
    };
    expect(duePeriodsFor(r, new Date('2026-03-15T00:00:00').getTime())).toHaveLength(0);
  });

  it('weekly periods step exactly 7 days apart', () => {
    const r: RecurringExpense = {
      id: 'r1', category: 'software', amount: 20, paymentMethod: 'card', frequency: 'weekly',
      startDate: '2026-03-01', active: true, createdBy: 'u1', createdByEmail: 'u1@shop.test', createdAt: 0,
    };
    const due = duePeriodsFor(r, new Date('2026-03-22T00:00:00').getTime());
    expect(due.map(d => d.date)).toEqual(['2026-03-01', '2026-03-08', '2026-03-15', '2026-03-22']);
  });

  it('yearly periods clamp Feb 29 on a non-leap year instead of rolling into March', () => {
    const r: RecurringExpense = {
      id: 'r1', category: 'insurance', amount: 1200, paymentMethod: 'card', frequency: 'yearly',
      startDate: '2024-02-29', active: true, createdBy: 'u1', createdByEmail: 'u1@shop.test', createdAt: 0,
    };
    const due = duePeriodsFor(r, new Date('2026-06-01T00:00:00').getTime());
    // 2024 (leap, exact), 2025 (clamped to Feb 28), 2026 (clamped to Feb 28)
    expect(due.map(d => d.date)).toEqual(['2024-02-29', '2025-02-28', '2026-02-28']);
  });

  it('buildRecurringExpense produces a draft tagged with the recurring id and period, ready to save', () => {
    const r: RecurringExpense = {
      id: 'r1', category: 'rent', amount: 1500, paymentMethod: 'etransfer', payee: 'Landlord Co', frequency: 'monthly',
      startDate: '2026-01-01', active: true, createdBy: 'u1', createdByEmail: 'u1@shop.test', createdAt: 0,
    };
    const draft = buildRecurringExpense(r, { key: '2026-03', date: '2026-03-01' }, user, 12345);
    expect(draft).toMatchObject({
      date: '2026-03-01', amount: 1500, category: 'rent', paymentMethod: 'etransfer', payee: 'Landlord Co',
      enteredBy: 'u1', enteredByEmail: 'u1@shop.test', createdAt: 12345, recurringId: 'r1', recurringPeriod: '2026-03',
    });
  });
});

/* ---------------------------------------------------------------------------
 * Variable-amount recurring expenses (utilities, phone, card fees).
 * ------------------------------------------------------------------------ */
const user = { id: 'u1', email: 'u1@shop.test' };
const fixedTpl: RecurringExpense = {
  id: 'r-fixed', category: 'rent', amount: 1500, paymentMethod: 'etransfer', payee: 'Landlord Co',
  frequency: 'monthly', startDate: '2026-01-01', active: true, createdBy: 'u1', createdByEmail: 'u1@shop.test', createdAt: 0,
};
const variableTpl: RecurringExpense = {
  id: 'r-var', category: 'utilities', amount: 0, amountMode: 'variable', estimatedAmount: 140,
  paymentMethod: 'etransfer', payee: 'Hydro', frequency: 'monthly', startDate: '2026-01-01',
  active: true, createdBy: 'u1', createdByEmail: 'u1@shop.test', createdAt: 0,
};
const period = { key: '2026-03', date: '2026-03-01' };

describe('recurring amount mode', () => {
  it('a template with no amountMode is FIXED — every pre-existing template keeps its behavior', () => {
    expect(amountModeOf(fixedTpl)).toBe('fixed');
    expect(isVariableRecurring(fixedTpl)).toBe(false);
    expect(isVariableRecurring({ amountMode: 'variable' })).toBe(true);
  });

  it('a FIXED template generates with its stored amount, no entry needed', () => {
    expect(resolveRecurringAmount(fixedTpl)).toBe(1500);
    const draft = buildRecurringExpense(fixedTpl, period, user, 999);
    expect(draft.amount).toBe(1500);
    expect(draft.recurringId).toBe('r-fixed');
    expect(draft.recurringPeriod).toBe('2026-03');
  });

  it('a VARIABLE template does NOT auto-post: with no entered amount it has none, and building throws', () => {
    expect(resolveRecurringAmount(variableTpl)).toBeNull();
    expect(() => buildRecurringExpense(variableTpl, period, user, 999)).toThrow();
  });

  it('the stored estimate is a PREFILL HINT ONLY — it never becomes the posted amount on its own', () => {
    // This is the P&L-corruption guard: 140 is on the template, but nothing
    // resolves to 140 unless a person actually typed it.
    expect(variableTpl.estimatedAmount).toBe(140);
    expect(resolveRecurringAmount(variableTpl)).toBeNull();
    expect(resolveRecurringAmount(variableTpl, 0)).toBeNull();
    expect(resolveRecurringAmount(variableTpl, -5)).toBeNull();
  });

  it('once a real amount is entered, a variable period builds an ordinary Expense like any other', () => {
    const draft = buildRecurringExpense(variableTpl, period, user, 999, 151.5);
    expect(draft).toMatchObject({
      date: '2026-03-01', amount: 151.5, category: 'utilities', paymentMethod: 'etransfer', payee: 'Hydro',
      enteredBy: 'u1', enteredByEmail: 'u1@shop.test', createdAt: 999, recurringId: 'r-var', recurringPeriod: '2026-03',
    });
  });

  it('SKIPPING works identically for both modes — one shared skippedPeriods path, never forked', () => {
    const now = new Date('2026-03-15T00:00:00').getTime();
    for (const tpl of [fixedTpl, variableTpl]) {
      expect(duePeriodsFor(tpl, now).map(d => d.key)).toEqual(['2026-01', '2026-02', '2026-03']);
      const skipped = { ...tpl, skippedPeriods: ['2026-02'] };
      expect(duePeriodsFor(skipped, now).map(d => d.key)).toEqual(['2026-01', '2026-03']);
      // …and generating still removes a period the same way for both.
      const both = { ...tpl, skippedPeriods: ['2026-02'], generatedPeriods: ['2026-01'] };
      expect(duePeriodsFor(both, now).map(d => d.key)).toEqual(['2026-03']);
    }
  });

  it('lastAmountsForRecurring surfaces the last few posted amounts, newest first', () => {
    const ledger = [
      exp({ id: 'a', date: '2026-01-05', amount: 142, recurringId: 'r-var' }),
      exp({ id: 'b', date: '2026-02-05', amount: 138, recurringId: 'r-var' }),
      exp({ id: 'c', date: '2026-03-05', amount: 151, recurringId: 'r-var' }),
      exp({ id: 'd', date: '2025-12-05', amount: 999, recurringId: 'r-var' }),
      exp({ id: 'e', date: '2026-03-06', amount: 5000, recurringId: 'other' }),  // different template
      exp({ id: 'f', date: '2026-03-07', amount: 6000 }),                        // not recurring at all
    ];
    expect(lastAmountsForRecurring(ledger, 'r-var')).toEqual([151, 138, 142]);
    expect(lastAmountsForRecurring(ledger, 'r-var', 2)).toEqual([151, 138]);
    expect(lastAmountsForRecurring(ledger, 'nope')).toEqual([]);
  });
});

describe('expense browse visibility (expenses.add vs expenses.viewAll)', () => {
  const mine = exp({ id: 'm', amount: 10, enteredBy: 'manager-uid' });
  const theirs = exp({ id: 't', amount: 20, enteredBy: 'other-uid' });
  const ledger = [mine, theirs];

  it('an owner (viewAll) browses the whole ledger', () => {
    expect(visibleExpensesFor(ledger, { id: 'owner-uid', canViewAll: true })).toEqual(ledger);
  });

  it('a manager browses only entries stamped with their own enteredBy', () => {
    expect(visibleExpensesFor(ledger, { id: 'manager-uid', canViewAll: false })).toEqual([mine]);
    expect(visibleExpensesFor(ledger, { id: 'nobody', canViewAll: false })).toEqual([]);
  });

  it('a manager may mutate only their own entry; an owner may mutate any', () => {
    expect(canMutateExpense(mine, { id: 'manager-uid', canViewAll: false })).toBe(true);
    expect(canMutateExpense(theirs, { id: 'manager-uid', canViewAll: false })).toBe(false);
    expect(canMutateExpense(theirs, { id: 'owner-uid', canViewAll: true })).toBe(true);
  });

  it('the browse filter is NOT the P&L filter: plExpenseTotal still sums every workspace expense', () => {
    // The regression this pins: if anyone ever routes ProfitLossInput.expenses
    // through visibleExpensesFor, a manager's net profit would silently omit
    // other people's spend. The P&L total must stay 30, not 10.
    const cats = [{ key: 'rent', label: 'Rent' }];
    expect(plExpenseTotal(ledger, cats, '2026-01-01', '2026-12-31')).toBe(30);
    const browsed = visibleExpensesFor(ledger, { id: 'manager-uid', canViewAll: false });
    expect(plExpenseTotal(browsed, cats, '2026-01-01', '2026-12-31')).toBe(10);
  });
});
