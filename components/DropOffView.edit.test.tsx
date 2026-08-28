// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { DropOffView } from './DropOffView';
import { DropOff, DeviceBuyer, PaidBy, DropOffStatus } from '../types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const d = (p: Partial<DropOff>): DropOff => ({
  id: 'do-1', buyerId: 'b1', item: 'iPhone 13', imei: '356789012345678', sellerName: '', sellerContact: '',
  purchasePrice: 100, paidBy: 'store' as PaidBy, dropOffFee: 20, dateDropped: '2026-08-20',
  status: 'accepted' as DropOffStatus, notes: '', ...p,
});
const buyers: DeviceBuyer[] = [{ id: 'b1', name: 'Marcus Webb', phone: '', notes: '' }];

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const typeInto = (el: HTMLInputElement, value: string) => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const buttons = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll('button')).filter(b => (b.textContent || '').includes(label));

describe('editing an existing drop-off', () => {
  it('offers an Edit action on every drop-off row', () => {
    const dropOffs = [d({}), d({ id: 'do-2', item: 'Pixel 8', status: 'pending' })];
    const { host, unmount } = mount(
      <DropOffView deviceBuyers={buyers} dropOffs={dropOffs} settlements={[]}
        onDeviceBuyersChange={() => {}} onDropOffsChange={() => {}} onSettle={() => {}} />
    );
    expect(buttons(host, 'Edit').length).toBe(dropOffs.length);
    unmount();
  });

  it('opens pre-filled with the existing values and saves an edited field back through onDropOffsChange', () => {
    const dropOffs = [d({ item: 'iPhone 13', purchasePrice: 100, dropOffFee: 20 })];
    const onDropOffsChange = vi.fn();
    const { host, unmount } = mount(
      <DropOffView deviceBuyers={buyers} dropOffs={dropOffs} settlements={[]}
        onDeviceBuyersChange={() => {}} onDropOffsChange={onDropOffsChange} onSettle={() => {}} />
    );
    click(buttons(host, 'Edit')[0]);
    expect(host.textContent).toContain('Edit Drop-Off');

    const priceInput = Array.from(host.querySelectorAll('input[type="number"]'))[0] as HTMLInputElement;
    expect(priceInput.value).toBe('100'); // pre-filled from the existing record
    typeInto(priceInput, '150');

    click(buttons(host, 'Save Changes')[0]);

    expect(onDropOffsChange).toHaveBeenCalledTimes(1);
    const saved = onDropOffsChange.mock.calls[0][0] as DropOff[];
    expect(saved).toHaveLength(1); // edits in place — doesn't append a new row
    expect(saved[0].id).toBe('do-1');
    expect(saved[0].purchasePrice).toBe(150);
    expect(saved[0].item).toBe('iPhone 13'); // untouched fields survive
  });

  it('the "New Drop-Off" button still creates a fresh blank record, unaffected by any prior edit', () => {
    const dropOffs = [d({})];
    const onDropOffsChange = vi.fn();
    const { host, unmount } = mount(
      <DropOffView deviceBuyers={buyers} dropOffs={dropOffs} settlements={[]}
        onDeviceBuyersChange={() => {}} onDropOffsChange={onDropOffsChange} onSettle={() => {}} />
    );
    // Open and cancel an edit first, to make sure it doesn't leak into New.
    click(buttons(host, 'Edit')[0]);
    click(buttons(host, 'Cancel')[0]);

    click(buttons(host, 'New Drop-Off')[0]);
    expect(host.textContent).toContain('New Drop-Off');
    const itemInput = host.querySelector('input[placeholder="e.g. iPhone 13 128GB"]') as HTMLInputElement;
    typeInto(itemInput, 'Galaxy S23');
    click(buttons(host, 'Save Drop-Off')[0]);

    expect(onDropOffsChange).toHaveBeenCalledTimes(1);
    const saved = onDropOffsChange.mock.calls[0][0] as DropOff[];
    expect(saved).toHaveLength(2); // appended, not replaced
    expect(saved.some(x => x.item === 'Galaxy S23')).toBe(true);
    expect(saved.find(x => x.id === 'do-1')?.purchasePrice).toBe(100); // original untouched
    unmount();
  });
});
