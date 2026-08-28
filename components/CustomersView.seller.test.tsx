// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CustomersView } from './CustomersView';
import { Customer, InventoryItem, SalesTransaction } from '../types';

// The payoff of linking "Bought From": devices bought FROM a person show on
// their record, with what we paid gated behind the same profit-visibility
// permission as every other piece of cost data.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const buttonWith = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find(b => (b.textContent || '').includes(text));

const customers: Customer[] = [
  { id: 'c1', name: 'Jane Seller', phone: '555-0100' },
  { id: 'c2', name: 'Bob Buyer', phone: '555-0200' },
  { id: 'c3', name: 'Cara Both', phone: '555-0300' },
];

const tx = (p: Partial<SalesTransaction>): SalesTransaction =>
  ({ id: 't', date: '2026-07-01', customerName: '', subtotal: 0, tax: 0, platformFee: 0, purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines: [], ...p });
const item = (p: Partial<InventoryItem>): InventoryItem =>
  ({ id: 'i', kind: 'device', date: '2026-07-01', item: 'iPhone 13', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, notes: '', ...p });

const inventory: InventoryItem[] = [
  item({ id: 'i1', item: 'Pixel 8', imei: '356789012340001', boughtFrom: 'Jane Seller', boughtFromCustomerId: 'c1', purchaseCost: 275, date: '2026-07-20' }),
  item({ id: 'i2', item: 'iPhone 12', boughtFromCustomerId: 'c3', purchaseCost: 310 }),
  // Legacy row: free text only, no id. Must never be auto-attributed.
  item({ id: 'legacy', item: 'Galaxy S22', boughtFrom: 'Jane Seller', purchaseCost: 400 }),
];
const salesTransactions = [
  tx({ id: 't1', customerId: 'c2', totalPaid: 100 }),
  tx({ id: 't2', customerId: 'c3', totalPaid: 200 }),
];

const view = (props: Partial<React.ComponentProps<typeof CustomersView>> = {}) => mount(
  <CustomersView
    customers={customers} salesTransactions={salesTransactions} repairs={[]} batches={[]}
    inventory={inventory} auditLogs={[]} canViewProfit canEdit
    onSaveCustomer={vi.fn()} {...props}
  />,
);

const openProfile = (host: HTMLElement, name: string) => {
  const row = [...host.querySelectorAll('tr')].find(r => (r.textContent || '').includes(name))!;
  click(row);
  const tab = buttonWith(host, 'Sold To Us');
  if (tab) click(tab);
};

describe('CustomersView — devices sold to us', () => {
  it('shows the purchase on the seller record with date, device, IMEI and what we paid', () => {
    const { host, unmount } = view();
    openProfile(host, 'Jane Seller');
    expect(host.textContent).toContain('Pixel 8');
    expect(host.textContent).toContain('356789012340001');
    expect(host.textContent).toContain('2026-07-20');
    expect(host.textContent).toContain('$275.00');
    unmount();
  });

  it('masks what we paid for roles without profit visibility', () => {
    const { host, unmount } = view({ canViewProfit: false });
    openProfile(host, 'Jane Seller');
    expect(host.textContent).toContain('Pixel 8');       // the relationship is visible…
    expect(host.textContent).not.toContain('$275.00');   // …the cost is not
    expect(host.textContent).toContain('•••');
    unmount();
  });

  it('never attributes a legacy free-text boughtFrom row to a customer', () => {
    const { host, unmount } = view();
    openProfile(host, 'Jane Seller');
    expect(host.textContent).toContain('Sold To Us (1)');
    expect(host.textContent).not.toContain('Galaxy S22');
    unmount();
  });

  it('shows a plain empty state for someone who has never sold us anything', () => {
    const { host, unmount } = view();
    openProfile(host, 'Bob Buyer');
    expect(host.textContent).toContain('No devices bought from this person yet.');
    unmount();
  });
});

describe('CustomersView — relationship filter', () => {
  const names = (host: HTMLElement) =>
    [...host.querySelectorAll('tbody tr')].map(r => (r.textContent || '').match(/Jane Seller|Bob Buyer|Cara Both/)?.[0]).filter(Boolean);

  it('separates bought-from-us, sold-to-us and both, and defaults to all', () => {
    const { host, unmount } = view();
    expect(names(host)).toHaveLength(3);

    click(buttonWith(host, 'Bought From Us')!);
    expect(names(host)).toEqual(['Bob Buyer']);

    click(buttonWith(host, 'Sold To Us')!);
    expect(new Set(names(host))).toEqual(new Set(['Jane Seller', 'Cara Both']));

    click(buttonWith(host, 'Both Ways')!);
    expect(names(host)).toEqual(['Cara Both']);
    unmount();
  });

  it('works alongside search and says why the list looks short', () => {
    const { host, unmount } = view();
    click(buttonWith(host, 'Sold To Us')!);
    const search = host.querySelector<HTMLInputElement>('input[type="search"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => { setter.call(search, 'jane'); search.dispatchEvent(new Event('input', { bubbles: true })); });

    expect(names(host)).toEqual(['Jane Seller']);
    expect(host.textContent).toContain('Showing');
    expect(host.textContent).toContain('Sold To Us');
    unmount();
  });

  it('is available regardless of profit visibility (a relationship is not money)', () => {
    const { host, unmount } = view({ canViewProfit: false });
    click(buttonWith(host, 'Sold To Us')!);
    expect(new Set(names(host))).toEqual(new Set(['Jane Seller', 'Cara Both']));
    unmount();
  });
});
