// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ReportsView } from './ReportsView';
import { SalesTransaction, Settlement, DeviceBuyer, Expense, RecurringExpense } from '../types';
import { todayISO } from '../domain/dates';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

// Today, not a fixed date — the P&L/tax/settlement tabs default their range
// to "this month through today," so a fixed past date would silently fall
// outside the range on a later test run and make the "profit figure
// actually renders for owner/manager" assertion a false negative.
const today = todayISO();

// A sale with a real, distinctive margin — if any profit figure leaks it'll
// show up as one of these numbers somewhere in the rendered text.
const sale: SalesTransaction = {
  id: 's1', date: today, customerName: 'Walk-in', subtotal: 900, tax: 0, platformFee: 0,
  purchaseCost: 300, repairCost: 0, totalCost: 300, totalPaid: 900, netProfit: 600,
  lines: [{ kind: 'device', name: 'iPhone 13', quantity: 1, unitPrice: 900 }],
};

const buyer: DeviceBuyer = { id: 'b1', name: 'Marcus', phone: '', notes: '' };
const settlement: Settlement = {
  id: 'st1', buyerId: 'b1', date: today, dropOffIds: [], model: 'financing', notes: '',
  principalStoreFunded: 100, principalOwed: 100, totalFees: 47.77, amountOwed: 147.77, storeCashIn: 147.77,
};

const baseProps = {
  salesTransactions: [sale], cashReconciliations: [], inventory: [], payPeriods: [],
  settlements: [settlement], deviceBuyers: [buyer],
  expenses: [], expenseCategories: [{ key: 'rent', label: 'Rent' }], recurringExpenses: [],
  onSaveExpense: () => {}, onDeleteExpense: () => {},
  onSaveRecurringExpense: () => {}, onDeleteRecurringExpense: () => {},
  onGenerateRecurringExpense: () => {}, onSkipRecurringPeriod: () => {},
  onSaveReconciliation: vi.fn(),
  repairs: [], customers: [], auditLogs: [], activity: [], timeEntries: [], users: [],
  currentUserId: 'owner-uid',
};

// Dollar strings that would only appear if a profit/margin/revenue figure
// leaked somewhere in the rendered tree — distinctive enough not to collide
// with an incidental match elsewhere in the page chrome.
const PROFIT_TELLS = ['600.00', '900.00', '47.77', '147.77', 'Gross Profit', 'Gross profit', 'Net profit', 'Cost of goods'];

describe('ReportsView — profit gating is enforced by the component itself, not just its caller', () => {
  it('an employee (cash.reconcile only, no profit) sees only Cash Reconciliation and lands there by default — no profit tab, no profit figure anywhere', () => {
    const { host, unmount } = mount(
      <ReportsView {...baseProps} canReconcile={true} canViewProfit={false} canAddExpense={false} canViewAllExpenses={false} />
    );
    const text = host.textContent || '';

    // No profit-tab labels rendered as tab buttons at all.
    expect(text).not.toContain('Profit & Loss');
    expect(text).not.toContain('Year-End Export');
    expect(text).not.toContain('Daily History');
    expect(text).not.toContain('Sales Tax');
    expect(text).not.toContain('Device Buyer Settlements');

    // Landed on Cash Reconciliation by default, and it actually works.
    expect(text).toContain('Cash Reconciliation');
    expect(host.querySelector('input[type="date"]')).toBeTruthy();

    for (const tell of PROFIT_TELLS) expect(text).not.toContain(tell);
    unmount();
  });

  it('a role granted only expenses.add sees Cash Reconciliation + Expenses, still no profit tab or figure', () => {
    const { host, unmount } = mount(
      <ReportsView {...baseProps} canReconcile={true} canViewProfit={false} canAddExpense={true} canViewAllExpenses={false} />
    );
    const text = host.textContent || '';
    expect(text).toContain('Cash Reconciliation');
    expect(text).toContain('Expenses');
    expect(text).not.toContain('Profit & Loss');
    expect(text).not.toContain('Year-End Export');
    for (const tell of PROFIT_TELLS) expect(text).not.toContain(tell);
    unmount();
  });

  it('clicking a tab button that does not exist for this role is impossible — only allowed tabs are rendered as buttons', () => {
    const { host, unmount } = mount(
      <ReportsView {...baseProps} canReconcile={true} canViewProfit={false} canAddExpense={false} canViewAllExpenses={false} />
    );
    const buttons = Array.from(host.querySelectorAll('button')).map(b => b.textContent);
    expect(buttons.some(b => b?.includes('Profit & Loss'))).toBe(false);
    unmount();
  });

  it('a technician-shaped session (neither cash.reconcile nor profit) renders no tabs and no money figure', () => {
    const { host, unmount } = mount(
      <ReportsView {...baseProps} canReconcile={false} canViewProfit={false} canAddExpense={false} canViewAllExpenses={false} />
    );
    const text = host.textContent || '';
    expect(text).not.toContain('Cash Reconciliation');
    for (const tell of PROFIT_TELLS) expect(text).not.toContain(tell);
    unmount();
  });

  it('owner/manager (full profit + reconcile access) sees every tab, defaults to Daily History, and profit figures render correctly', () => {
    const { host, unmount } = mount(
      <ReportsView {...baseProps} canReconcile={true} canViewProfit={true} canAddExpense={true} canViewAllExpenses={true} />
    );
    const text = host.textContent || '';
    expect(text).toContain('Daily History');
    expect(text).toContain('Cash Reconciliation');
    expect(text).toContain('Sales Tax');
    expect(text).toContain('Profit & Loss');
    expect(text).toContain('Expenses');
    expect(text).toContain('Device Buyer Settlements');
    expect(text).toContain('Year-End Export');
    unmount();
  });

  it('owner/manager can reach the Profit & Loss tab and see the actual net profit figure', () => {
    const { host, unmount } = mount(
      <ReportsView {...baseProps} canReconcile={true} canViewProfit={true} canAddExpense={true} canViewAllExpenses={true} />
    );
    const pnlBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Profit & Loss')) as HTMLButtonElement;
    act(() => { pnlBtn.click(); });
    const text = host.textContent || '';
    expect(text).toContain('Profit & Loss ·');
    expect(text).toContain('600.00'); // this sale's netProfit, proving the tab actually renders real figures for this role
    unmount();
  });
});

/* ---------------------------------------------------------------------------
 * The expenses.add / expenses.viewAll split (this PR).
 *
 * Manager  = expenses.add, no expenses.viewAll → "my submitted expenses" only.
 * Owner    = both → the whole ledger.
 * Employee = neither → no Expenses tab at all.
 * ------------------------------------------------------------------------ */
const MANAGER = 'manager-uid';
const mine: Expense = {
  id: 'x1', date: today, amount: 111.11, category: 'rent', paymentMethod: 'cash',
  payee: 'MyLandlord', enteredBy: MANAGER, enteredByEmail: 'manager@shop.test', createdAt: 1,
};
const theirs: Expense = {
  id: 'x2', date: today, amount: 222.22, category: 'rent', paymentMethod: 'cash',
  payee: 'SomeoneElsesVendor', enteredBy: 'other-uid', enteredByEmail: 'other@shop.test', createdAt: 1,
};
const expenseProps = { ...baseProps, expenses: [mine, theirs] };

const openExpensesTab = (host: HTMLElement) => {
  const btn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Expenses')) as HTMLButtonElement;
  act(() => { btn.click(); });
};

describe('expense permission split — manager sees only their own entries', () => {
  it('a manager (expenses.add, no viewAll) sees ONLY the expense they entered — never another user\'s row or amount', () => {
    const { host, unmount } = mount(
      <ReportsView {...expenseProps} currentUserId={MANAGER} canReconcile={true} canViewProfit={true}
        canAddExpense={true} canViewAllExpenses={false} />
    );
    openExpensesTab(host);
    const text = host.textContent || '';
    expect(text).toContain('My submitted expenses');
    expect(text).toContain('MyLandlord');
    expect(text).toContain('111.11');
    // The other user's expense is absent in every form.
    expect(text).not.toContain('SomeoneElsesVendor');
    expect(text).not.toContain('222.22');
    // …and so is the workspace spend total (111.11 + 222.22).
    expect(text).not.toContain('333.33');
    unmount();
  });

  it('a manager can still ADD an expense — the Add expense entry point is present', () => {
    const { host, unmount } = mount(
      <ReportsView {...expenseProps} currentUserId={MANAGER} canReconcile={true} canViewProfit={true}
        canAddExpense={true} canViewAllExpenses={false} />
    );
    openExpensesTab(host);
    const buttons = Array.from(host.querySelectorAll('button')).map(b => b.textContent || '');
    expect(buttons.some(b => b.includes('Add expense'))).toBe(true);
    unmount();
  });

  it('a manager sees no recurring-expense configuration at all (owner-only)', () => {
    const recurring: RecurringExpense = {
      id: 'r1', category: 'rent', amount: 1500, paymentMethod: 'etransfer', payee: 'Landlord',
      frequency: 'monthly', startDate: today, active: true, createdBy: 'owner-uid', createdByEmail: 'o@x', createdAt: 1,
    };
    const { host, unmount } = mount(
      <ReportsView {...expenseProps} recurringExpenses={[recurring]} currentUserId={MANAGER}
        canReconcile={true} canViewProfit={true} canAddExpense={true} canViewAllExpenses={false} />
    );
    openExpensesTab(host);
    const text = host.textContent || '';
    expect(text).not.toContain('Recurring templates');
    expect(text).not.toContain('Recurring expenses due');
    expect(text).not.toContain('1,500.00');
    unmount();
  });

  it('a manager may edit/delete their OWN row (the buttons are rendered for it)', () => {
    const { host, unmount } = mount(
      <ReportsView {...expenseProps} currentUserId={MANAGER} canReconcile={true} canViewProfit={true}
        canAddExpense={true} canViewAllExpenses={false} />
    );
    openExpensesTab(host);
    // One data row (their own), and it carries its two action buttons.
    const rows = host.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].querySelectorAll('button').length).toBe(2);
    unmount();
  });

  it('an OWNER (viewAll) sees every expense, the workspace total and the recurring config', () => {
    const { host, unmount } = mount(
      <ReportsView {...expenseProps} currentUserId={'owner-uid'} canReconcile={true} canViewProfit={true}
        canAddExpense={true} canViewAllExpenses={true} />
    );
    openExpensesTab(host);
    const text = host.textContent || '';
    expect(text).toContain('MyLandlord');
    expect(text).toContain('SomeoneElsesVendor');
    expect(text).toContain('111.11');
    expect(text).toContain('222.22');
    expect(text).toContain('333.33');            // the full workspace total
    expect(text).toContain('Recurring templates');
    expect(host.querySelectorAll('tbody tr').length).toBe(2);
    unmount();
  });

  it('an employee (neither permission) has NO Expenses tab and no expense figure anywhere', () => {
    const { host, unmount } = mount(
      <ReportsView {...expenseProps} currentUserId={'employee-uid'} canReconcile={true} canViewProfit={false}
        canAddExpense={false} canViewAllExpenses={false} />
    );
    const text = host.textContent || '';
    const buttons = Array.from(host.querySelectorAll('button')).map(b => b.textContent || '');
    expect(buttons.some(b => b.includes('Expenses'))).toBe(false);
    expect(text).not.toContain('111.11');
    expect(text).not.toContain('222.22');
    expect(text).not.toContain('Add expense');
    unmount();
  });
});

describe('P&L stays complete for a manager — the visibility split never changes the accounting', () => {
  // Revenue 900, COGS 300 → gross 600. Expenses 111.11 + 222.22 = 333.33.
  // Device buyer service fee income +47.77. Net profit must therefore be
  // 600 − 333.33 + 47.77 = 314.44 for BOTH roles: a manager who may only
  // BROWSE their own 111.11 must still have all 333.33 subtracted, or their
  // net profit would be overstated by another user's spend (it would read
  // 536.66 — the exact bug the second assertion pins).
  const netFor = (canViewAllExpenses: boolean, currentUserId: string) => {
    const { host, unmount } = mount(
      <ReportsView {...expenseProps} currentUserId={currentUserId} canReconcile={true} canViewProfit={true}
        canAddExpense={true} canViewAllExpenses={canViewAllExpenses} />
    );
    const pnlBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Profit & Loss')) as HTMLButtonElement;
    act(() => { pnlBtn.click(); });
    const text = host.textContent || '';
    unmount();
    return text;
  };

  it('a manager viewing P&L sees net profit computed from ALL workspace expenses, not just their own', () => {
    const text = netFor(false, MANAGER);
    expect(text).toContain('314.44');     // 600 − (111.11 + 222.22) + 47.77
    expect(text).toContain('333.33');     // the FULL workspace expense total is what's subtracted
    expect(text).not.toContain('536.66'); // 600 − 111.11 + 47.77 — the bug this guards against
    // The aggregate expense line is shown; the per-category browse is not.
    expect(text).toContain('Expenses');
    expect(text).not.toContain('Expense: Rent');
  });

  it('the owner sees the identical net profit, plus the per-category breakdown', () => {
    const text = netFor(true, 'owner-uid');
    expect(text).toContain('314.44');
    expect(text).toContain('Expense: Rent');
  });
});
