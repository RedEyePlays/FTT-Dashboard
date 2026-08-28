// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QuickPurchaseView, QuickPurchaseSaveInput } from './QuickPurchaseView';
import { Customer } from '../types';

// Quick Purchase's "Bought From" is a customer picker now: the seller is very
// often already a customer, and one record per person is what makes purchase
// history accumulate. Linking stays OPTIONAL — free text must still work.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const setInput = (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const byPlaceholder = (host: HTMLElement, p: string) =>
  host.querySelector<HTMLInputElement>(`input[placeholder="${p}"]`)!;
const buttonWith = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find(b => (b.textContent || '').includes(text));

const customers: Customer[] = [
  { id: 'c1', name: 'Jane Seller', phone: '(555) 010-0000', email: 'jane@example.com' },
];

const fillRequired = (host: HTMLElement) => {
  setInput(byPlaceholder(host, 'e.g. iPhone 13 Pro 256GB'), 'iPhone 13');
  setInput(byPlaceholder(host, '0.00'), '250');
};

describe('QuickPurchase — Bought From customer picker', () => {
  it('selecting an existing customer stores their customerId on the saved item', () => {
    const onSave = vi.fn();
    const { host, unmount } = mount(<QuickPurchaseView inventory={[]} customers={customers} onSave={onSave} />);
    fillRequired(host);

    // The reused CustomerSearchInput (same picker as checkout / repair intake).
    setInput(byPlaceholder(host, 'Find existing customer…'), 'jane');
    const hit = [...host.querySelectorAll('button')].find(b => (b.textContent || '').includes('Jane Seller'))!;
    act(() => { hit.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    act(() => { buttonWith(host, 'Add to Inventory')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const saved: QuickPurchaseSaveInput = onSave.mock.calls[0][0];
    expect(saved.boughtFromCustomerId).toBe('c1');
    expect(saved.boughtFrom).toBe('Jane Seller');
    expect(saved.boughtFromPhone).toBe('(555) 010-0000'); // seller detail kept on the purchase record
    unmount();
  });

  it('free text alone still works and creates no customer', () => {
    const onSave = vi.fn();
    const onCreateCustomer = vi.fn();
    const { host, unmount } = mount(
      <QuickPurchaseView inventory={[]} customers={customers} onSave={onSave} onCreateCustomer={onCreateCustomer} />,
    );
    fillRequired(host);
    setInput(byPlaceholder(host, 'Seller name (optional)'), 'Guy at the mall');

    act(() => { buttonWith(host, 'Add to Inventory')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    const saved: QuickPurchaseSaveInput = onSave.mock.calls[0][0];
    expect(saved.boughtFrom).toBe('Guy at the mall');
    expect(saved.boughtFromCustomerId).toBeUndefined();
    expect(onCreateCustomer).not.toHaveBeenCalled();
    unmount();
  });

  it('inline creation runs duplicate detection and links the existing record instead of duplicating', () => {
    const onSave = vi.fn();
    // App-side resolver, same contract as App.tsx's handleCreateCustomerInline.
    const onCreateCustomer = vi.fn(() => customers[0]);
    const { host, unmount } = mount(
      <QuickPurchaseView inventory={[]} customers={customers} onSave={onSave} onCreateCustomer={onCreateCustomer} />,
    );
    fillRequired(host);

    act(() => { buttonWith(host, 'Add as a new customer')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    setInput(byPlaceholder(host, 'Name'), 'J. Seller');
    setInput(byPlaceholder(host, 'Phone'), '5550100000');

    // The duplicate warning fires before anything is created, and the CTA
    // changes from "Create & link" to "Link existing customer".
    expect(host.textContent).toContain('already has this phone');
    act(() => { buttonWith(host, 'Link existing customer')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

    act(() => { buttonWith(host, 'Add to Inventory')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onSave.mock.calls[0][0].boughtFromCustomerId).toBe('c1');
    unmount();
  });

  it('hides inline creation when the caller cannot create customers', () => {
    const { host, unmount } = mount(<QuickPurchaseView inventory={[]} customers={customers} onSave={vi.fn()} />);
    expect(buttonWith(host, 'Add as a new customer')).toBeUndefined();
    expect(byPlaceholder(host, 'Seller name (optional)')).toBeTruthy(); // free text always available
    unmount();
  });
});
