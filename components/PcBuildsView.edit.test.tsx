// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { PcBuildsView } from './PcBuildsView';
import { PcBuild, SalesTransaction } from '../types';

/**
 * PRICING A PC AFTER YOU KNOW WHAT IT COST.
 *
 * The target price and the build name were set once, in the create dialog, and
 * never again — so the number the shop would actually sell at could not be
 * recorded, because a PC is priced AFTER the parts are in. This file covers
 * the three fields that became editable, the deposit warning on a customer
 * order, and Duplicate.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const build = (p: Partial<PcBuild> = {}): PcBuild => ({
  id: 'b1', name: 'REAPER Gaming PC', kind: 'shelf', status: 'assembling',
  parts: [{ id: 'p1', category: 'GPU', name: 'RTX 4070', cost: 500, condition: 'new', source: 'retail' }],
  labour: [], targetPrice: 1800,
  createdBy: 'u1', createdByEmail: 'u@shop.test', createdAt: 1, updatedAt: 1, ...p,
});

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

const setValue = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => act(() => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
// React 17+ delegates onBlur through the bubbling `focusout` event, so a
// plain non-bubbling 'blur' never reaches the handler.
const blur = (el: Element) => act(() => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });

const view = (props: Partial<React.ComponentProps<typeof PcBuildsView>> = {}) => (
  <PcBuildsView
    builds={[build()]} inventory={[]} customers={[]}
    currentUserId="u1" currentUserEmail="u@shop.test"
    labourRate={15} warrantyDays={90}
    onSave={() => {}} onFinishBuild={() => undefined} {...props}
  />
);

/** Open the one build in the list. */
const openBuild = (host: HTMLElement) => {
  const row = Array.from(host.querySelectorAll('button')).find(b => (b.textContent || '').includes('REAPER'));
  click(row!);
};

const priceInput = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('input[type="number"]'))
    .find(i => (i as HTMLInputElement).placeholder === '—') as HTMLInputElement;

const nameInput = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('input')).find(i => i.value === 'REAPER Gaming PC') as HTMLInputElement;

const notesBox = (host: HTMLElement) => host.querySelector('textarea') as HTMLTextAreaElement;

describe('the target price', () => {
  it('is editable on the build and saves what was typed', () => {
    const onSave = vi.fn();
    const { host, unmount } = mount(view({ onSave }));
    openBuild(host);

    const input = priceInput(host);
    expect(input).toBeTruthy();
    expect(input.value).toBe('1800');

    setValue(input, '2150');
    blur(input);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'b1', targetPrice: 2150 });
    unmount();
  });

  it('writes NOTHING per keystroke — one save, on blur', () => {
    // The whole point of the draft pattern: a Firestore write per character was
    // real cost, and the round-trip is what used to throw the caret to the end.
    const onSave = vi.fn();
    const { host, unmount } = mount(view({ onSave }));
    openBuild(host);
    const input = priceInput(host);
    setValue(input, '2');
    setValue(input, '21');
    setValue(input, '215');
    expect(onSave).not.toHaveBeenCalled();
    blur(input);
    expect(onSave).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('is locked once the machine has sold — that cost is already booked', () => {
    // The device sold, so partsEditable is false. The build itself is still in
    // the active list, which is where somebody would go looking to change it.
    const { host, unmount } = mount(view({
      builds: [build({ status: 'ready', inventoryId: 'inv-1' })],
      inventory: [{ id: 'inv-1', kind: 'device', sku: 'FTT-0000777', item: 'Custom PC', date: '2026-09-01',
        imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '2026-09-10', soldTo: 'Dana',
        salePrice: 1800, notes: '', deviceStatus: 'sold' }],
    }));
    openBuild(host);
    expect(priceInput(host).disabled).toBe(true);
    unmount();
  });
});

describe('the build name', () => {
  it('is editable in place and saves', () => {
    const onSave = vi.fn();
    const { host, unmount } = mount(view({ onSave }));
    openBuild(host);
    const input = nameInput(host);
    setValue(input, 'REAPER MK2');
    blur(input);
    expect(onSave.mock.calls[0][0]).toMatchObject({ name: 'REAPER MK2' });
    unmount();
  });

  it('says plainly that renaming the build does not rename the device', () => {
    const { host, unmount } = mount(view({
      builds: [build({ inventoryId: 'inv-1', sku: 'FTT-0000777' })],
      inventory: [{ id: 'inv-1', kind: 'device', sku: 'FTT-0000777', item: 'Custom PC', date: '2026-09-01',
        imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, notes: '' }],
    }));
    openBuild(host);
    expect(host.textContent).toMatch(/does not rename FTT-0000777/);
    unmount();
  });
});

describe('notes', () => {
  it('save, and are labelled as internal', () => {
    const onSave = vi.fn();
    const { host, unmount } = mount(view({ onSave }));
    openBuild(host);
    const box = notesBox(host);
    expect(box).toBeTruthy();
    setValue(box, 'waiting on the GPU');
    blur(box);
    expect(onSave.mock.calls[0][0]).toMatchObject({ notes: 'waiting on the GPU' });
    expect(host.textContent).toMatch(/never shown to a customer/i);
    unmount();
  });
});

describe('changing a quote after a deposit', () => {
  const order = build({ kind: 'customer', targetPrice: undefined, quotePrice: 1500, inventoryId: 'inv-1' });
  const layaway = {
    id: 's1', date: '2026-09-01', customerName: 'Dana', subtotal: 1500, tax: 0, platformFee: 0,
    totalPaid: 375, deposit: 375, balanceOwing: 1125, balancePayments: [],
    lines: [{ inventoryId: 'inv-1', kind: 'device', name: 'Custom PC', quantity: 1, unitPrice: 1500 }],
  } as unknown as SalesTransaction;

  it('warns, naming the deposit and the new balance', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onSave = vi.fn();
    const { host, unmount } = mount(view({ builds: [order], sales: [layaway], onSave }));
    openBuild(host);
    const input = priceInput(host);
    setValue(input, '1700');
    blur(input);

    expect(confirm).toHaveBeenCalled();
    const message = confirm.mock.calls[0][0] as string;
    expect(message).toContain('$375.00 deposit');
    expect(message).toContain('$1325.00');                    // the new balance
    expect(message).toMatch(/deposit itself is not touched/i);
    expect(onSave.mock.calls[0][0]).toMatchObject({ quotePrice: 1700 });
    confirm.mockRestore();
    unmount();
  });

  it('leaves the quote alone when the warning is declined', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onSave = vi.fn();
    const { host, unmount } = mount(view({ builds: [order], sales: [layaway], onSave }));
    openBuild(host);
    setValue(priceInput(host), '1700');
    blur(priceInput(host));
    expect(onSave).not.toHaveBeenCalled();
    confirm.mockRestore();
    unmount();
  });

  it('does not warn on a shelf build — that price is the shop talking to itself', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { host, unmount } = mount(view({ onSave: () => {} }));
    openBuild(host);
    setValue(priceInput(host), '1900');
    blur(priceInput(host));
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
    unmount();
  });
});

describe('Duplicate', () => {
  it('hands back a copy of the recipe with none of the machine', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onDuplicate = vi.fn();
    const source = build({
      status: 'ready', notes: 'white cables',
      parts: [{
        id: 'p1', category: 'GPU', name: 'RTX 4070', cost: 500, condition: 'used', source: 'facebook',
        serial: 'GPU-SERIAL-1', mfrWarrantyUntil: '2029-01-01', retailPrice: 900,
      }],
      labour: [{ id: 'l1', userId: 'u1', userEmail: 'u@shop.test', hours: 3, rate: 15, date: '2026-09-01', loggedAt: 1 }],
      customerName: 'Dana Wu', inventoryId: 'inv-1', shareToken: 'kadamuze',
    });
    const { host, unmount } = mount(view({ builds: [source], onDuplicate }));
    openBuild(host);
    click(Array.from(host.querySelectorAll('button')).find(b => (b.textContent || '').includes('Duplicate'))!);

    expect(onDuplicate).toHaveBeenCalledTimes(1);
    const [from, copy] = onDuplicate.mock.calls[0];
    expect(from.id).toBe('b1');
    expect(copy.name).toBe('REAPER Gaming PC copy');
    expect(copy.status).toBe('planning');
    expect(copy.labour).toEqual([]);
    expect(copy.parts[0]).toMatchObject({ name: 'RTX 4070', cost: 500, retailPrice: 900, costFromCopy: true });
    expect(copy.parts[0].serial).toBeUndefined();
    expect(copy.parts[0].id).not.toBe('p1');
    expect(copy.customerName).toBeUndefined();
    expect(copy.shareToken).toBeUndefined();
    expect(copy.duplicatedFrom).toBe('b1');
    confirm.mockRestore();
    unmount();
  });

  it('is not offered when the caller cannot create builds', () => {
    const { host, unmount } = mount(view({}));
    openBuild(host);
    expect(Array.from(host.querySelectorAll('button')).some(b => (b.textContent || '').includes('Duplicate'))).toBe(false);
    unmount();
  });

  it('marks a copied cost on the row so it is not mistaken for a receipt', () => {
    const { host, unmount } = mount(view({
      builds: [build({ parts: [{ id: 'p1', category: 'GPU', name: 'RTX 4070', cost: 500, condition: 'new', source: 'retail', costFromCopy: true }] })],
    }));
    openBuild(host);
    expect(host.textContent).toContain('Copied');
    unmount();
  });
});
