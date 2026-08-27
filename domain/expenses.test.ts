import { describe, it, expect } from 'vitest';
import { Expense, RecurringExpense } from '../types';
import {
  DEFAULT_EXPENSE_CATEGORIES, expensesInRange, plExpenseTotal, expenseTotalsByCategory,
  excludedFromPLKeys, duePeriodsFor, buildRecurringExpense,
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
