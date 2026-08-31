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
//  2. It is a TINY BLUE ICON with no text at all, so it takes almost no
//     column width however many platforms are set — the site names are
//     in the hover title (and aria-label), which leads with them.
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

// The desktop indicator is the <span> whose title carries the shared
// hint. The title now LEADS with the platform names (the badge is
// icon-only), so match on the hint anywhere in it, not at the start.
const listedBadge = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('span')).find(s => s.title?.includes('Also listed elsewhere'));
const skuCell = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('button')).find(b => b.title?.startsWith('In repair'));

describe('InventoryView desktop listed-elsewhere indicator', () => {
  it('flags a listed device on the Item cell, as a tiny BLUE icon with no text', () => {
    const { host, unmount } = mount(view({ inventory: [device({ listedPlatforms: ['bestbuy'] })] }));

    const badge = listedBadge(host);
    expect(badge).toBeTruthy();
    // Icon only — the platform name is in the hover label, not the cell.
    expect(badge!.textContent).toBe('');
    expect(badge!.className).toContain('bg-blue-100');
    expect(badge!.className).not.toContain('bg-amber-100');
    expect(badge!.querySelector('svg')).toBeTruthy(); // tag icon

    // It really is in the Item cell: the same <td> holds the `item` text input.
    const cell = badge!.closest('td')!;
    expect((cell.querySelector('input') as HTMLInputElement).value).toBe('iPhone 13');
    unmount();
  });

  it('says WHICH SITE on hover — the platform names lead the label', () => {
    const { host, unmount } = mount(view({ inventory: [device({ listedPlatforms: ['bestbuy'] })] }));
    const badge = listedBadge(host)!;
    // Hovering must answer "which site?" at once, since nothing is
    // written in the cell itself.
    expect(badge.title.startsWith('Best Buy')).toBe(true);
    expect(badge.title).toContain('Also listed elsewhere — Quick Sale will warn before selling this in-store');
    // Screen readers get the same answer rather than a bare icon.
    expect(badge.getAttribute('aria-label')).toBe(badge.title);
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

  it('stays the same tiny size however many platforms are set', () => {
    const { host, unmount } = mount(view({
      inventory: [device({ listedPlatforms: ['bestbuy', 'kijiji', 'facebook', 'ebay'] })],
    }));
    const badge = listedBadge(host)!;
    // Nothing is written in the cell at all, so four platforms take
    // exactly as much column width as one.
    expect(badge.textContent).toBe('');
    // ...and every one of them is named on hover.
    expect(badge.title).toContain('Best Buy, Kijiji, Facebook Marketplace, eBay');
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
    expect(badge!.className).toContain('bg-blue-100');
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
