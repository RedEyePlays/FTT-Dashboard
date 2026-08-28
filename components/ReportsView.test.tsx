// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ReportsView } from './ReportsView';
import { SalesTransaction, Settlement, DeviceBuyer } from '../types';
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
};

// Dollar strings that would only appear if a profit/margin/revenue figure
// leaked somewhere in the rendered tree — distinctive enough not to collide
// with an incidental match elsewhere in the page chrome.
const PROFIT_TELLS = ['600.00', '900.00', '47.77', '147.77', 'Gross Profit', 'Gross profit', 'Net profit', 'Cost of goods'];

describe('ReportsView — profit gating is enforced by the component itself, not just its caller', () => {
  it('an employee (cash.reconcile only, no profit) sees only Cash Reconciliation and lands there by default — no profit tab, no profit figure anywhere', () => {
    const { host, unmount } = mount(
      <ReportsView {...baseProps} canReconcile={true} canViewProfit={false} canManageExpenses={false} />
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

  it('an employee also granted expenses.manage sees Cash Reconciliation + Expenses, still no profit tab or figure', () => {
    const { host, unmount } = mount(
      <ReportsView {...baseProps} canReconcile={true} canViewProfit={false} canManageExpenses={true} />
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
      <ReportsView {...baseProps} canReconcile={true} canViewProfit={false} canManageExpenses={false} />
    );
    const buttons = Array.from(host.querySelectorAll('button')).map(b => b.textContent);
    expect(buttons.some(b => b?.includes('Profit & Loss'))).toBe(false);
    unmount();
  });

  it('a technician-shaped session (neither cash.reconcile nor profit) renders no tabs and no money figure', () => {
    const { host, unmount } = mount(
      <ReportsView {...baseProps} canReconcile={false} canViewProfit={false} canManageExpenses={false} />
    );
    const text = host.textContent || '';
    expect(text).not.toContain('Cash Reconciliation');
    for (const tell of PROFIT_TELLS) expect(text).not.toContain(tell);
    unmount();
  });

  it('owner/manager (full profit + reconcile access) sees every tab, defaults to Daily History, and profit figures render correctly', () => {
    const { host, unmount } = mount(
      <ReportsView {...baseProps} canReconcile={true} canViewProfit={true} canManageExpenses={true} />
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
      <ReportsView {...baseProps} canReconcile={true} canViewProfit={true} canManageExpenses={true} />
    );
    const pnlBtn = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Profit & Loss')) as HTMLButtonElement;
    act(() => { pnlBtn.click(); });
    const text = host.textContent || '';
    expect(text).toContain('Profit & Loss ·');
    expect(text).toContain('600.00'); // this sale's netProfit, proving the tab actually renders real figures for this role
    unmount();
  });
});
