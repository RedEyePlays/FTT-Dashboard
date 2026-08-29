// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { InventoryView } from './InventoryView';
import { InventoryItem, Repair } from '../types';

// Two things this file guards:
//  1. A device with an OPEN repair ticket is flagged on its SKU cell — the
//     owner's device table has no Status column and must not gain one, so the
//     indicator lives on the existing SKU cell, carries the ticket number, and
//     opens that ticket on click.
//  2. Column order: Notes now comes before Customer (`soldTo`).

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'dev-1', kind: 'device', sku: 'PHN-000001', date: '2026-08-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'pending_repair', ...p,
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

const skuCell = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('button')).find(b => b.title?.startsWith('In repair'));

describe('InventoryView in-repair SKU cell', () => {
  it('highlights the SKU cell, names the ticket, and opens it on click', () => {
    const onOpenRepair = vi.fn();
    const { host, unmount } = mount(view({ repairs: [repair()], onOpenRepair }));

    const cell = skuCell(host);
    expect(cell).toBeTruthy();
    expect(cell!.title).toContain('RPR-000042');
    expect(cell!.textContent).toContain('PHN-000001');
    // Reuses the pending_repair orange from STATUS_CELL — not a new colour.
    expect(cell!.className).toContain('bg-orange-100');
    expect(cell!.querySelector('svg')).toBeTruthy(); // wrench icon

    act(() => { cell!.click(); });
    expect(onOpenRepair).toHaveBeenCalledWith('r1');
    unmount();
  });

  it('leaves the SKU cell alone once the ticket is closed', () => {
    const { host, unmount } = mount(view({ repairs: [repair({ status: 'picked_up' })], onOpenRepair: () => {} }));
    expect(skuCell(host)).toBeFalsy();
    unmount();
  });

  it('leaves the SKU cell alone for a device with no ticket at all', () => {
    const { host, unmount } = mount(view({ repairs: [], onOpenRepair: () => {} }));
    expect(skuCell(host)).toBeFalsy();
    unmount();
  });
});

describe('InventoryView device columns', () => {
  const headers = (host: HTMLElement) =>
    Array.from(host.querySelectorAll('th')).map(th => th.textContent?.trim() || '');

  it('adds no Status column to the device table', () => {
    const { host, unmount } = mount(view({ repairs: [repair()] }));
    expect(headers(host).some(h => h === 'Status' || h === 'Device Status')).toBe(false);
    unmount();
  });

  it('renders Customer after Notes', () => {
    const { host, unmount } = mount(view());
    const h = headers(host);
    const notes = h.findIndex(x => x.startsWith('Notes'));
    const customer = h.findIndex(x => x.startsWith('Customer'));
    expect(notes).toBeGreaterThan(-1);
    expect(customer).toBeGreaterThan(notes);
    unmount();
  });

  it('keeps working from a saved column layout stored before the reorder (keyed by column key)', () => {
    // A stored width/hidden layout is keyed by column `key`, never by position,
    // so swapping two entries in DEVICE_COLS can't desync it.
    localStorage.setItem('inv_col_widths_v1', JSON.stringify({ device: { soldTo: 180, notes: 90 }, accessory: {} }));
    localStorage.setItem('inv_hidden_cols_v2', JSON.stringify({ device: ['soldTo'], accessory: [] }));
    const { host, unmount } = mount(view());
    const h = headers(host);
    expect(h.some(x => x.startsWith('Customer'))).toBe(false); // still hidden by key
    expect(h.some(x => x.startsWith('Notes'))).toBe(true);
    localStorage.clear();
    unmount();
  });
});
