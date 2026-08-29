// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { InventoryView } from './InventoryView';
import { InventoryItem, Repair } from '../types';

// A device also listed on an external marketplace (`listedPlatforms`) used to
// be flagged ONLY on the mobile item card — on desktop it looked identical to
// an unlisted one. This file guards the desktop indicator:
//  1. It lives on the existing Item cell (no new column — the owner's device
//     table has no Status column and must not gain a "Listed" one either).
//  2. It stays compact with several platforms set, so it can't blow out the
//     column: one platform shows its (short) name, 2+ collapse to a count,
//     with the full list always in the hover title.
//  3. It coexists with the in-repair SKU highlight — a device can be both.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'dev-1', kind: 'device', sku: 'PHN-000001', date: '2026-08-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready', ...p,
});

const repair = (p: Partial<Repair> = {}): Repair => ({
  id: 'r1', repairNumber: 'RPR-000042', type: 'internal', createdAt: Date.now(), date: '2026-08-20',
  issue: 'screen', repairPrice: 0, status: 'in_repair', inventoryId: 'dev-1', ...p,
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

// The desktop indicator is the <span> whose title carries the shared hint.
const listedBadge = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('span')).find(s => s.title?.startsWith('Also listed elsewhere'));
const skuCell = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('button')).find(b => b.title?.startsWith('In repair'));

describe('InventoryView desktop listed-elsewhere indicator', () => {
  it('flags a listed device on the Item cell, in the same amber the mobile badge uses', () => {
    const { host, unmount } = mount(view({ inventory: [device({ listedPlatforms: ['bestbuy'] })] }));

    const badge = listedBadge(host);
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toContain('Best Buy');
    expect(badge!.className).toContain('bg-amber-100');
    expect(badge!.querySelector('svg')).toBeTruthy(); // tag icon

    // It really is in the Item cell: the same <td> holds the `item` text input.
    const cell = badge!.closest('td')!;
    expect((cell.querySelector('input') as HTMLInputElement).value).toBe('iPhone 13');
    unmount();
  });

  it('carries the same explanation the mobile badge does, plus the full platform list', () => {
    const { host, unmount } = mount(view({ inventory: [device({ listedPlatforms: ['bestbuy', 'ebay'] })] }));
    const title = listedBadge(host)!.title;
    expect(title).toContain('Also listed elsewhere — Quick Sale will warn before selling this in-store');
    expect(title).toContain('Best Buy, eBay'); // the full list, even though the badge is compact
    unmount();
  });

  it('shows nothing at all for a device with no listings', () => {
    const { host, unmount } = mount(view({ inventory: [device()] }));
    expect(listedBadge(host)).toBeFalsy();
    unmount();
  });

  it('shows nothing for an empty listedPlatforms array (e.g. cleared after a sale)', () => {
    const { host, unmount } = mount(view({ inventory: [device({ listedPlatforms: [] })] }));
    expect(listedBadge(host)).toBeFalsy();
    unmount();
  });

  it('stays compact with several platforms — a count, not a run-on list that overflows the column', () => {
    const { host, unmount } = mount(view({
      inventory: [device({ listedPlatforms: ['bestbuy', 'kijiji', 'facebook', 'ebay'] })],
    }));
    const badge = listedBadge(host)!;
    expect(badge.textContent).toContain('4 sites');
    // The long-form list is NOT rendered into the cell (that's what overflows).
    expect(badge.textContent).not.toContain('Facebook Marketplace');
    expect(badge.textContent!.trim().length).toBeLessThan(12);
    // It yields width rather than taking it: the badge never shrinks, the
    // editable name input beside it does.
    expect(badge.className).toContain('shrink-0');
    const input = badge.closest('td')!.querySelector('input')!;
    expect(input.className).toContain('min-w-0');
    unmount();
  });

  it('renders BOTH indicators for a device that is in repair AND listed elsewhere, on their own cells', () => {
    const { host, unmount } = mount(view({
      inventory: [device({ deviceStatus: 'pending_repair', listedPlatforms: ['kijiji'] })],
      repairs: [repair()], onOpenRepair: () => {},
    }));

    const badge = listedBadge(host);
    const sku = skuCell(host);
    expect(badge).toBeTruthy();
    expect(sku).toBeTruthy();
    // Different cells, so neither can truncate or overlap the other...
    expect(badge!.closest('td')).not.toBe(sku!.closest('td'));
    // ...and different colours, so the two states stay tellable apart.
    expect(badge!.className).toContain('bg-amber-100');
    expect(sku!.className).toContain('bg-orange-100');
    expect(sku!.textContent).toContain('PHN-000001'); // SKU still readable
    unmount();
  });

  it('adds no new column to the device table — the flag rides an existing cell', () => {
    const { host, unmount } = mount(view({ inventory: [device({ listedPlatforms: ['ebay'] })] }));
    const headers = Array.from(host.querySelectorAll('th')).map(th => th.textContent?.trim() || '');
    expect(headers.some(h => /^Listed/.test(h) || h === 'Platforms' || h === 'Status')).toBe(false);
    unmount();
  });

  it('leaves the name editable — the indicator sits beside the input, it does not replace it', () => {
    const { host, unmount } = mount(view({ inventory: [device({ listedPlatforms: ['ebay'] })] }));
    const input = listedBadge(host)!.closest('td')!.querySelector('input') as HTMLInputElement;
    expect(input.disabled).toBe(false);
    expect(input.readOnly).toBe(false);
    unmount();
  });
});
