// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ReportsView } from './ReportsView';
import { COMPANY_LOCATION_ID, Expense, Location, SalesTransaction } from '../types';
import { todayISO } from '../domain/dates';

/**
 * MULTI-STORE STAGE 5, ON THE SCREEN.
 *
 * The domain guarantees are pinned in domain/storeScope.test.ts. What is
 * tested here is the part a user can get wrong:
 *
 *  • the scope is NAMED on the report, not just on the control;
 *  • picking a store actually changes the figures;
 *  • an expense cannot be saved without being told where it belongs;
 *  • untagged expenses are findable and retaggable whatever scope is picked;
 *  • a single-store workspace sees none of it.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const click = (el: Element | null | undefined) => {
  if (!el) throw new Error('nothing to click');
  act(() => { (el as HTMLElement).click(); });
};
const buttons = (host: HTMLElement) => [...host.querySelectorAll('button')];
const byText = (host: HTMLElement, text: string) =>
  buttons(host).find(b => (b.textContent || '').trim() === text);

const BRAMPTON = 'loc-bram';
const MISSY = 'loc-missy';
const locations: Location[] = [
  { id: BRAMPTON, name: 'Brampton', active: true, isDefault: true, createdAt: 1 },
  { id: MISSY, name: 'Mississauga', active: true, createdAt: 1 },
];

const today = todayISO();
const sale = (p: Partial<SalesTransaction>): SalesTransaction => ({
  id: 's', date: today, customerName: 'Walk-in', subtotal: 0, tax: 0, platformFee: 0,
  purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines: [], ...p,
});
const expense = (p: Partial<Expense>): Expense => ({
  id: 'e', date: today, amount: 0, category: 'rent', paymentMethod: 'card',
  enteredBy: 'owner-uid', enteredByEmail: 'o@shop.test', createdAt: 0, ...p,
});

// Distinctive figures, so "whose revenue is on screen" is unambiguous.
const sales = [
  sale({ id: 'b1', subtotal: 1111, locationId: BRAMPTON }),
  sale({ id: 'm1', subtotal: 2222, locationId: MISSY }),
];

const baseProps = {
  salesTransactions: sales, cashReconciliations: [], inventory: [], payPeriods: [],
  settlements: [], deviceBuyers: [],
  expenses: [] as Expense[], expenseCategories: [{ key: 'rent', label: 'Rent' }], recurringExpenses: [],
  onSaveExpense: () => {}, onDeleteExpense: () => {},
  onSaveRecurringExpense: () => {}, onDeleteRecurringExpense: () => {},
  onGenerateRecurringExpense: () => {}, onSkipRecurringPeriod: () => {},
  onSaveReconciliation: vi.fn(),
  repairs: [], customers: [], auditLogs: [], activity: [], timeEntries: [], users: [],
  currentUserId: 'owner-uid',
  canReconcile: true, canViewProfit: true, canAddExpense: true, canViewAllExpenses: true,
};

const scopeProps = (scope: string, onChangeScope = () => {}) => ({
  locations,
  reportScope: scope,
  scopeChoices: ['', BRAMPTON, MISSY],
  onChangeScope,
});

describe('the store filter on the Reports screen', () => {
  it('offers one control for every scope, and marks the current one', () => {
    const { host, unmount } = mount(<ReportsView {...baseProps} {...scopeProps(MISSY)} />);
    const all = byText(host, 'All stores (combined)');
    const missy = byText(host, 'Mississauga only');
    expect(all).toBeTruthy();
    expect(missy).toBeTruthy();
    // Not a dropdown whose closed state reads as a caption: the current scope
    // is a pressed button.
    expect(missy!.getAttribute('aria-pressed')).toBe('true');
    expect(all!.getAttribute('aria-pressed')).toBe('false');
    unmount();
  });

  it('renders nothing at all in a single-store workspace', () => {
    const { host, unmount } = mount(<ReportsView {...baseProps} locations={[]} />);
    expect(byText(host, 'All stores (combined)')).toBeUndefined();
    expect(host.textContent).not.toMatch(/Showing/);
    unmount();
  });

  it('a store scope shows that store\'s revenue, and the combined scope shows both', () => {
    const onPnl = (host: HTMLElement) => click(byText(host, 'Profit & Loss'));

    const a = mount(<ReportsView {...baseProps} {...scopeProps(BRAMPTON)} />);
    onPnl(a.host);
    expect(a.host.textContent).toContain('1,111.00');
    expect(a.host.textContent).not.toContain('2,222.00');
    a.unmount();

    const b = mount(<ReportsView {...baseProps} {...scopeProps(MISSY)} />);
    onPnl(b.host);
    expect(b.host.textContent).toContain('2,222.00');
    expect(b.host.textContent).not.toContain('1,111.00');
    b.unmount();

    const c = mount(<ReportsView {...baseProps} {...scopeProps('')} />);
    onPnl(c.host);
    expect(c.host.textContent).toContain('3,333.00');
    c.unmount();
  });

  it('NAMES THE SCOPE ON THE P&L ITSELF, and warns that a store excludes company costs', () => {
    const { host, unmount } = mount(<ReportsView {...baseProps} {...scopeProps(BRAMPTON)} />);
    click(byText(host, 'Profit & Loss'));
    // The badge sits beside the report heading, not only on the picker — this
    // is the block that gets screenshotted and forwarded.
    expect(host.textContent).toContain('Brampton only');
    expect(host.textContent).toMatch(/BEFORE company overhead/);
    expect(host.textContent).toMatch(/do not add up/i);
    // And the two lines that are deliberately empty under a store scope say
    // why, rather than reading as a quiet month.
    expect(host.textContent).toMatch(/Staff bonuses \(company/);
    expect(host.textContent).toMatch(/Payroll \(this store's stamped shifts\)/);
    unmount();
  });

  it('the combined P&L carries no single-store warning', () => {
    const { host, unmount } = mount(<ReportsView {...baseProps} {...scopeProps('')} />);
    click(byText(host, 'Profit & Loss'));
    expect(host.textContent).toContain('All stores (combined)');
    expect(host.textContent).not.toMatch(/BEFORE company overhead/);
    unmount();
  });

  it('switching the scope calls back to the SHARED scope, never a local copy', () => {
    // The filter is lifted to App.tsx on purpose: three screens, one answer.
    const onChangeScope = vi.fn();
    const { host, unmount } = mount(<ReportsView {...baseProps} {...scopeProps('', onChangeScope)} />);
    click(byText(host, 'Mississauga only'));
    expect(onChangeScope).toHaveBeenCalledWith(MISSY);
    unmount();
  });
});

describe('an expense has to be told which store it belongs to', () => {
  const open = (props: Partial<typeof baseProps> = {}) => {
    const m = mount(<ReportsView {...baseProps} {...props} {...scopeProps('')} />);
    click(byText(m.host, 'Expenses'));
    click(byText(m.host, 'Add expense'));
    return m;
  };
  const amountInput = (host: HTMLElement) =>
    [...host.querySelectorAll('input[type="number"]')].pop() as HTMLInputElement;
  const storeSelect = (host: HTMLElement) =>
    [...host.querySelectorAll('select')].find(sel =>
      [...sel.options].some(o => o.textContent === 'Mississauga')) as HTMLSelectElement;

  // React keeps its own value tracker on the DOM node, so assigning `.value`
  // directly is swallowed as "no change". Go through the native setter.
  const setNative = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
    const proto = el instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  };
  const type = (el: HTMLInputElement, value: string) => {
    act(() => {
      setNative(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const choose = (el: HTMLSelectElement, value: string) => {
    act(() => {
      setNative(el, value);
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  };

  it('starts with NO store pre-selected — a defaulted tag is how rent lands on the wrong store', () => {
    const { host, unmount } = open();
    const sel = storeSelect(host);
    expect(sel).toBeTruthy();
    expect(sel.value).toBe('');
    // The default store is NOT quietly chosen for them.
    expect(sel.value).not.toBe(BRAMPTON);
    expect(host.textContent).toMatch(/Pick which store this cost belongs to/);
    unmount();
  });

  it('will not save until the question is answered, then will', () => {
    const onSaveExpense = vi.fn();
    const { host, unmount } = open({ onSaveExpense });
    type(amountInput(host), '400');
    const save = byText(host, 'Save')!;
    expect(save.hasAttribute('disabled')).toBe(true);
    click(save);
    expect(onSaveExpense).not.toHaveBeenCalled();

    choose(storeSelect(host), MISSY);
    const save2 = byText(host, 'Save')!;
    expect(save2.hasAttribute('disabled')).toBe(false);
    click(save2);
    expect(onSaveExpense).toHaveBeenCalledTimes(1);
    expect(onSaveExpense.mock.calls[0][0].locationId).toBe(MISSY);
    unmount();
  });

  it('Company is an option, and says what choosing it means', () => {
    const { host, unmount } = open();
    const sel = storeSelect(host);
    expect([...sel.options].map(o => o.value))
      .toEqual(['', BRAMPTON, MISSY, COMPANY_LOCATION_ID]);
    choose(sel, COMPANY_LOCATION_ID);
    expect(host.textContent).toMatch(/combined P&L only/);
    unmount();
  });

  it('asks nothing in a single-store workspace', () => {
    const m = mount(<ReportsView {...baseProps} locations={[]} />);
    click(byText(m.host, 'Expenses'));
    click(byText(m.host, 'Add expense'));
    expect(m.host.textContent).not.toMatch(/Pick which store this cost belongs to/);
    // An amount is all it ever needed, exactly as before this stage.
    type(amountInput(m.host), '400');
    expect(byText(m.host, 'Save')!.hasAttribute('disabled')).toBe(false);
    m.unmount();
  });
});

describe('expenses that have not been told where they belong', () => {
  const rows = [
    expense({ id: 'untagged', amount: 90, payee: 'Overseas parts' }),
    expense({ id: 'tagged', amount: 2000, locationId: BRAMPTON, payee: 'Landlord' }),
  ];

  it('are listed with a one-tap retag, and the panel says what it will change', () => {
    const onRetagExpense = vi.fn();
    const { host, unmount } = mount(
      <ReportsView {...baseProps} expenses={rows} onRetagExpense={onRetagExpense} {...scopeProps('')} />,
    );
    click(byText(host, 'Expenses'));
    expect(host.textContent).toMatch(/1 expense with no store/);
    expect(host.textContent).toMatch(/Brampton's/);
    const tagger = [...host.querySelectorAll('select')]
      .find(s => s.getAttribute('aria-label')?.startsWith('Tag the')) as HTMLSelectElement;
    expect(tagger).toBeTruthy();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
        .call(tagger, COMPANY_LOCATION_ID);
      tagger.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onRetagExpense).toHaveBeenCalledTimes(1);
    expect(onRetagExpense.mock.calls[0][0].id).toBe('untagged');
    expect(onRetagExpense.mock.calls[0][1]).toBe(COMPANY_LOCATION_ID);
    unmount();
  });

  // The row that needs attention must not be hidden by the filter that makes
  // it matter — the panel reads the UNSCOPED array on purpose.
  it('stay visible under a store scope, even one they are not in', () => {
    const { host, unmount } = mount(
      <ReportsView {...baseProps} expenses={rows} onRetagExpense={vi.fn()} {...scopeProps(MISSY)} />,
    );
    click(byText(host, 'Expenses'));
    expect(host.textContent).toMatch(/1 expense with no store/);
    // …while the ledger below it shows only Mississauga's, which is none.
    expect(host.textContent).toContain('Mississauga only');
    unmount();
  });

  it('the ledger names each row\'s store, and flags the ones with none', () => {
    const { host, unmount } = mount(
      <ReportsView {...baseProps} expenses={rows} {...scopeProps('')} />,
    );
    click(byText(host, 'Expenses'));
    const table = host.querySelector('table')!;
    expect([...table.querySelectorAll('th')].map(th => th.textContent)).toContain('Store');
    expect(table.textContent).toContain('Brampton');
    expect(table.textContent).toContain('Not set');
    unmount();
  });
});
