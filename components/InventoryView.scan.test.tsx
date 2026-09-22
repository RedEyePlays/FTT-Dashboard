// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { InventoryView } from './InventoryView';
import { InventoryItem } from '../types';

// Scanning an IMEI in Inventory used to return "Nothing here" for devices that
// were plainly in the shop. This file guards the three reasons it did:
//
//  1. Raw substring matching — a stored IMEI with spaces never matched a
//     scanner's unbroken digits.
//  2. The search only covered the CURRENT page and the CURRENT status filter,
//     so a sold device scanned under an "In stock" filter was simply absent.
//  3. That filter is remembered PER USER, so one employee stayed stuck behind a
//     narrow one.
//
// The fix: an exact normalised identifier hit ignores page and filters and says
// where the item actually is; Enter on a single hit opens it; nothing found is
// said in words. Partial and name searches still respect the filters.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const IMEI = '351234567890123';

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'dev-1', kind: 'device', sku: 'PHN-000001', date: '2026-08-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready', ...p,
});

const accessory = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'acc-1', kind: 'accessory', sku: 'ACC-000001', date: '2026-08-01', item: 'USB-C Cable',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready',
  manufacturerBarcode: '0 12345 67890 5', quantity: 5, ...p,
});

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const view = (props: Partial<React.ComponentProps<typeof InventoryView>> = {}) => (
  <InventoryView
    inventory={[device()]} deviceBuyers={[]} activity={[]} section="devices"
    onSelectSection={() => {}} onSave={() => {}} onUpdate={() => {}} onDelete={() => {}}
    onGenerateSku={async () => 'PHN-000002'} {...props}
  />
);

const searchBox = (host: HTMLElement) =>
  host.querySelector('input[placeholder^="Scan or search"]') as HTMLInputElement;

const type = (host: HTMLElement, value: string) => {
  const box = searchBox(host);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(box, value);
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const pressEnter = (host: HTMLElement) => {
  act(() => {
    searchBox(host).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
};

const noteText = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('span')).map(s => s.textContent || '')
    .find(t => t.includes('outside your current filter'));

beforeEach(() => { localStorage.clear(); });

describe('InventoryView: scanning an IMEI finds the device', () => {
  it('matches a stored IMEI written with spaces from a plain scan', () => {
    const { host, unmount } = mount(view({
      inventory: [device({ imei: '35 123456 789012 3' }), device({ id: 'other', sku: 'PHN-000009', item: 'Pixel 7' })],
    }));
    type(host, IMEI);
    const names = Array.from(host.querySelectorAll('td input')).map(i => (i as HTMLInputElement).value);
    expect(names).toContain('iPhone 13');
    expect(names).not.toContain('Pixel 7');
    unmount();
  });

  it('matches a stored IMEI written with dashes too', () => {
    const { host, unmount } = mount(view({ inventory: [device({ imei: '35-123456-789012-3' })] }));
    type(host, IMEI);
    expect(Array.from(host.querySelectorAll('td input')).map(i => (i as HTMLInputElement).value)).toContain('iPhone 13');
    unmount();
  });

  it('finds a SOLD device scanned from the in-stock Devices page, and says where it is', () => {
    const sold = device({ id: 'sold-1', imei: IMEI, soldDate: '2026-08-10', deviceStatus: 'sold', item: 'iPhone 12' });
    const { host, unmount } = mount(view({ inventory: [device(), sold], section: 'devices' }));

    // Nothing in the Devices table matches — but the device is found anyway.
    type(host, IMEI);
    expect(noteText(host)).toBe('Found in Sold — outside your current filter.');
    expect(host.textContent).toContain('iPhone 12');
    unmount();
  });

  it('finds a DEVICE scanned while the Accessories page is open', () => {
    const { host, unmount } = mount(view({
      inventory: [device({ imei: IMEI }), accessory()], section: 'accessories',
    }));
    type(host, IMEI);
    expect(noteText(host)).toBe('Found in In stock — outside your current filter.');
    unmount();
  });

  it('finds an ACCESSORY by its barcode while the Devices page is open', () => {
    const { host, unmount } = mount(view({
      inventory: [device(), accessory()], section: 'devices',
    }));
    type(host, '012345678905');
    expect(noteText(host)).toBe('Found in Accessories — outside your current filter.');
    unmount();
  });

  it('is not hidden by a narrow persisted status filter', () => {
    // The employee's remembered filter: "ready" only. The scanned device is
    // sold, so the filter would have hidden it.
    localStorage.setItem('inv_status_filter:u1', JSON.stringify('ready'));
    const sold = device({ id: 'sold-1', imei: IMEI, soldDate: '2026-08-10', deviceStatus: 'sold', item: 'iPhone 12' });
    const { host, unmount } = mount(view({ inventory: [sold], section: 'devices', userId: 'u1' }));
    type(host, IMEI);
    expect(host.textContent).toContain('iPhone 12');
    expect(noteText(host)).toContain('outside your current filter');
    unmount();
  });

  it('Enter on a single identifier match opens that item', () => {
    const { host, unmount } = mount(view({ inventory: [device({ imei: IMEI })] }));
    type(host, IMEI);
    pressEnter(host);
    // The item form modal is open on that device.
    expect(host.textContent).toContain('Scan or type IMEI');
    unmount();
  });

  it('Enter on a code that matches nothing says so, instead of an empty table', () => {
    const { host, unmount } = mount(view({ inventory: [device({ imei: IMEI })] }));
    type(host, '999999999999999');
    pressEnter(host);
    expect(host.textContent).toContain('No device with IMEI 9999…');
    unmount();
  });

  it('a NAME search still respects the page — a sold device is not dragged onto Devices', () => {
    const sold = device({ id: 'sold-1', soldDate: '2026-08-10', deviceStatus: 'sold', item: 'iPhone 12' });
    const { host, unmount } = mount(view({ inventory: [device(), sold], section: 'devices' }));
    type(host, 'iphone');
    // No escape-the-filter note, and the sold device stays on the Sold page.
    expect(noteText(host)).toBeUndefined();
    const names = Array.from(host.querySelectorAll('td input')).map(i => (i as HTMLInputElement).value);
    expect(names).toContain('iPhone 13');
    expect(names).not.toContain('iPhone 12');
    unmount();
  });

  it('puts focus in the search box when Inventory opens, so the next scan lands there', () => {
    const { host, unmount } = mount(view());
    expect(document.activeElement).toBe(searchBox(host));
    unmount();
  });
});
