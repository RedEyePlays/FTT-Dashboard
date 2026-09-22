// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QuickPurchaseView, QuickPurchaseSaveInput } from './QuickPurchaseView';
import { Customer } from '../types';

// Typing a name into "Bought From" used to set free text and CLEAR any customer
// link. A record was created only by clicking "Add as a new customer" and then
// "Create & link" — two clicks, at a counter, with somebody waiting. Nobody
// does, so sellers never reached the customer database.
//
// This file guards the replacement: the phone sits right there, a typed name
// becomes a customer on save through the EXISTING path, and an ambiguous name
// asks rather than guessing.

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
  act(() => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const byPlaceholder = (host: HTMLElement, p: string) =>
  host.querySelector<HTMLInputElement>(`input[placeholder="${p}"]`);
const byPlaceholderStart = (host: HTMLElement, p: string) =>
  host.querySelector<HTMLInputElement>(`input[placeholder^="${p}"]`);
const buttonWith = (host: HTMLElement, text: string) =>
  [...host.querySelectorAll('button')].find(b => (b.textContent || '').includes(text));
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

const fillRequired = (host: HTMLElement) => {
  setInput(byPlaceholder(host, 'e.g. iPhone 13 Pro 256GB')!, 'iPhone 13');
  setInput(byPlaceholder(host, '0.00')!, '250');
};

const ali = { id: 'c-ali', name: 'Ali', phone: '(416) 555-0100', kind: 'retail' } as Customer;
const aliNoPhone = { id: 'c-ali2', name: 'Ali', phone: '', kind: 'retail' } as Customer;

describe('a seller typed in Quick Purchase becomes a customer', () => {
  it('offers the phone field right there, with no extra click', () => {
    const { host, unmount } = mount(
      <QuickPurchaseView inventory={[]} customers={[]} onSave={vi.fn()} onCreateCustomer={vi.fn()} />,
    );
    // Hidden until there is a name to attach it to, then present inline.
    expect(byPlaceholderStart(host, 'Phone (optional')).toBeNull();
    setInput(byPlaceholder(host, 'Seller name (optional)')!, 'Marcus');
    expect(byPlaceholderStart(host, 'Phone (optional')).toBeTruthy();
    unmount();
  });

  it('links to an existing customer by PHONE instead of creating a duplicate', () => {
    const onSave = vi.fn();
    // The App-side resolver: resolveCustomerForDraft matches on phone.
    const onCreateCustomer = vi.fn(() => ali);
    const { host, unmount } = mount(
      <QuickPurchaseView inventory={[]} customers={[ali]} onSave={onSave} onCreateCustomer={onCreateCustomer} />,
    );
    fillRequired(host);
    setInput(byPlaceholder(host, 'Seller name (optional)')!, 'Ali B');
    setInput(byPlaceholderStart(host, 'Phone (optional')!, '4165550100');

    click(buttonWith(host, 'Add to Inventory')!);
    const saved: QuickPurchaseSaveInput = onSave.mock.calls[0][0];
    expect(saved.boughtFromCustomerId).toBe('c-ali');
    unmount();
  });

  it('ASKS when the name is ambiguous — it does not guess', () => {
    const onSave = vi.fn();
    const onCreateCustomer = vi.fn();
    const { host, unmount } = mount(
      <QuickPurchaseView inventory={[]} customers={[aliNoPhone]} onSave={onSave} onCreateCustomer={onCreateCustomer} />,
    );
    fillRequired(host);
    setInput(byPlaceholder(host, 'Seller name (optional)')!, 'Ali');
    click(buttonWith(host, 'Add to Inventory')!);

    // Nothing saved and nothing created until the question is answered.
    expect(onSave).not.toHaveBeenCalled();
    expect(onCreateCustomer).not.toHaveBeenCalled();
    expect(host.textContent).toContain('There is already a customer called Ali');
    unmount();
  });

  it('linking to the existing one on the prompt saves with that id', () => {
    const onSave = vi.fn();
    const { host, unmount } = mount(
      <QuickPurchaseView inventory={[]} customers={[aliNoPhone]} onSave={onSave} onCreateCustomer={vi.fn()} />,
    );
    fillRequired(host);
    setInput(byPlaceholder(host, 'Seller name (optional)')!, 'Ali');
    click(buttonWith(host, 'Add to Inventory')!);
    click(buttonWith(host, 'Ali')!);

    expect(onSave.mock.calls[0][0].boughtFromCustomerId).toBe('c-ali2');
    unmount();
  });

  it('choosing "create a new customer" on the prompt runs the SAME create path', () => {
    const onSave = vi.fn();
    const made = { id: 'c-new', name: 'Ali', phone: '', kind: 'retail' } as Customer;
    const onCreateCustomer = vi.fn(() => made);
    const { host, unmount } = mount(
      <QuickPurchaseView inventory={[]} customers={[aliNoPhone]} onSave={onSave} onCreateCustomer={onCreateCustomer} />,
    );
    fillRequired(host);
    setInput(byPlaceholder(host, 'Seller name (optional)')!, 'Ali');
    click(buttonWith(host, 'Add to Inventory')!);
    click(buttonWith(host, 'Create a new customer called Ali')!);

    expect(onCreateCustomer).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ali' }));
    expect(onSave.mock.calls[0][0].boughtFromCustomerId).toBe('c-new');
    unmount();
  });

  it('declining still saves the purchase with the typed name — linking is never a gate', () => {
    const onSave = vi.fn();
    const { host, unmount } = mount(
      <QuickPurchaseView inventory={[]} customers={[aliNoPhone]} onSave={onSave} onCreateCustomer={vi.fn()} />,
    );
    fillRequired(host);
    setInput(byPlaceholder(host, 'Seller name (optional)')!, 'Ali');
    click(buttonWith(host, 'Add to Inventory')!);
    click(buttonWith(host, 'just keep the name')!);

    const saved: QuickPurchaseSaveInput = onSave.mock.calls[0][0];
    expect(saved.boughtFrom).toBe('Ali');
    expect(saved.boughtFromCustomerId).toBeUndefined();
    unmount();
  });
});
