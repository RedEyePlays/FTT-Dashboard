// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { InventoryView } from './InventoryView';
import { InventoryItem } from '../types';

// "Add Device" used to open NO FORM: it allocated a SKU and immediately SAVED a
// blank device, then dropped the user into the inline table. Nothing was
// focused, so a wedge scanner (which types the code then sends Enter) typed
// into nothing — and every unfinished click left junk in inventory.
//
// This file guards the replacement: a real form, the code field focused, Enter
// moving on instead of submitting, the duplicate guard firing before save, and
// NOTHING written (and no SKU burned) until Save.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const IMEI = '351234567890123';

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'dev-1', kind: 'device', sku: 'PHN-000001', date: '2026-08-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready', ...p,
});

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const setValue = (el: HTMLInputElement, value: string) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});

const button = (host: HTMLElement, label: string) =>
  Array.from(host.querySelectorAll('button')).find(b => (b.textContent || '').includes(label));
const codeField = (host: HTMLElement) =>
  host.querySelector('input[placeholder="Scan or type IMEI"]') as HTMLInputElement | null;

const view = (props: Partial<React.ComponentProps<typeof InventoryView>> = {}) => (
  <InventoryView
    inventory={[]} deviceBuyers={[]} activity={[]} section="devices"
    onSelectSection={() => {}} onSave={() => {}} onUpdate={() => {}} onDelete={() => {}}
    onGenerateSku={async () => 'PHN-000002'} {...props}
  />
);

beforeEach(() => { localStorage.clear(); });

describe('Add Device opens a form instead of saving a blank row', () => {
  it('writes NOTHING and allocates NO SKU just by opening', async () => {
    const onSave = vi.fn();
    const onGenerateSku = vi.fn(async () => 'PHN-000002');
    const { host, unmount } = mount(view({ onSave, onGenerateSku }));

    click(button(host, 'Add Device')!);
    expect(onSave).not.toHaveBeenCalled();
    expect(onGenerateSku).not.toHaveBeenCalled();
    // ...and the form really is open.
    expect(codeField(host)).toBeTruthy();
    unmount();
  });

  it('focuses the IMEI field the moment it opens — a scan needs zero clicks', () => {
    const { host, unmount } = mount(view());
    click(button(host, 'Add Device')!);
    expect(document.activeElement).toBe(codeField(host));
    unmount();
  });

  it('ENTER IN THE IMEI FIELD DOES NOT SUBMIT OR CLOSE — it moves to the next field', () => {
    const onSave = vi.fn();
    const { host, unmount } = mount(view({ onSave }));
    click(button(host, 'Add Device')!);

    const code = codeField(host)!;
    setValue(code, IMEI);
    act(() => { code.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });

    // Still open, nothing saved, and the caret has moved on.
    expect(codeField(host)).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(code);
    unmount();
  });

  it('flags a duplicate IMEI BEFORE save, naming where the device already is', () => {
    const existing = device({ id: 'have-it', sku: 'PHN-000123', imei: IMEI });
    const onSave = vi.fn();
    const { host, unmount } = mount(view({ inventory: [existing], onSave }));
    click(button(host, 'Add Device')!);
    setValue(codeField(host)!, IMEI);

    expect(host.textContent).toContain('Already in inventory');
    expect(host.textContent).toContain('PHN-000123');
    expect(host.textContent).toContain('In stock');
    // The save is blocked, not merely warned about.
    const save = button(host, 'Save')!;
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(onSave).not.toHaveBeenCalled();
    unmount();
  });

  it('says a duplicate is Sold when that is where it is', () => {
    const sold = device({ id: 'sold', sku: 'PHN-000124', imei: IMEI, soldDate: '2026-09-01', deviceStatus: 'sold' });
    const { host, unmount } = mount(view({ inventory: [sold] }));
    click(button(host, 'Add Device')!);
    setValue(codeField(host)!, IMEI);
    expect(host.textContent).toContain('Sold');
    unmount();
  });

  it('cancelling saves nothing and allocates no SKU', () => {
    const onSave = vi.fn();
    const onGenerateSku = vi.fn(async () => 'PHN-000002');
    const { host, unmount } = mount(view({ onSave, onGenerateSku }));
    click(button(host, 'Add Device')!);
    setValue(codeField(host)!, IMEI);
    click(button(host, 'Cancel')!);

    expect(onSave).not.toHaveBeenCalled();
    expect(onGenerateSku).not.toHaveBeenCalled();
    unmount();
  });

  it('the Quick add row writes nothing until a field is filled in', () => {
    const onSave = vi.fn();
    const onGenerateSku = vi.fn(async () => 'PHN-000002');
    // The quick-add row lives in the table, so this needs a table to be in.
    const { host, unmount } = mount(view({ inventory: [device()], onSave, onGenerateSku }));
    click(button(host, 'Quick add row')!);
    expect(onSave).not.toHaveBeenCalled();
    expect(onGenerateSku).not.toHaveBeenCalled();
    unmount();
  });
});
