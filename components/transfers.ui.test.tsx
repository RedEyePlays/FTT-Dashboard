// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { TransferModal } from './TransferModal';
import { InTransitPanel } from './InTransitPanel';
import { AppUser, InventoryItem, InventoryTransfer, Location } from '../types';
import { TRANSFER_STALE_DAYS } from '../domain/transfers';

/**
 * THE TWO SCREENS A TRANSFER IS MADE AND CLOSED ON — multi-store stage 4.
 *
 * domain/transfers.test.ts pins the rules; these pin what a person meets:
 *
 *  • a reserved device takes a deliberate tick, never a blanket "send anyway";
 *  • what will NOT go is listed with its reason rather than silently dropped;
 *  • the receive button belongs to the DESTINATION and never to the sender;
 *  • a transfer nobody has confirmed is flagged, loudly, after three days.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const BRAM = 'brampton';
const MISS = 'mississauga';
const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

const loc = (id: string, name: string): Location => ({ id, name, active: true, createdAt: 1 });
const STORES = [loc(BRAM, 'Brampton'), loc(MISS, 'Mississauga')];

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'INV-000001', date: '2026-10-01', item: 'iPhone 14',
  imei: '', boughtFrom: '', purchaseCost: 200, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready', locationId: BRAM,
  ...p,
});

const user = (p: Partial<AppUser> = {}): AppUser =>
  ({ id: 'u1', email: 'u1@shop.test', role: 'employee', workspaceId: 'ws', ...p } as AppUser);

const transfer = (p: Partial<InventoryTransfer> = {}): InventoryTransfer => ({
  id: 't1', itemIds: ['d1'], fromLocationId: BRAM, toLocationId: MISS,
  status: 'in_transit', sentAt: NOW, sentBy: 'sender', sentByEmail: 'sender@shop.test',
  ...p,
});

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    host,
    text: () => host.textContent || '',
    button: (label: string) => Array.from(host.querySelectorAll('button')).find(b => (b.textContent || '').includes(label)),
    checkboxes: () => Array.from(host.querySelectorAll('input[type=checkbox]')) as HTMLInputElement[],
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}
const click = (el: Element | undefined) => {
  if (!el) throw new Error('no such element');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const pickStore = (host: HTMLElement, id: string) => {
  const sel = host.querySelector('select[aria-label="Destination store"]') as HTMLSelectElement;
  act(() => { sel.value = id; sel.dispatchEvent(new Event('change', { bubbles: true })); });
};

describe('sending stock to the other store', () => {
  const open = (items: InventoryItem[], onSend = vi.fn()) => ({
    onSend,
    ...mount(
      <TransferModal items={items} fromLocationId={BRAM} locations={STORES}
        destinations={STORES} onClose={vi.fn()} onSend={onSend} />,
    ),
  });

  it('offers the OTHER store, never the one it is already at', () => {
    const v = open([device()]);
    const sel = v.host.querySelector('select[aria-label="Destination store"]') as HTMLSelectElement;
    const values = Array.from(sel.options).map(o => o.value);
    expect(values).toContain(MISS);
    expect(values).not.toContain(BRAM);
    v.unmount();
  });

  it('will not send until a destination is chosen', () => {
    const v = open([device()]);
    expect(v.button('Send')?.hasAttribute('disabled')).toBe(true);
    pickStore(v.host, MISS);
    expect(v.button('Send')?.hasAttribute('disabled')).toBe(false);
    v.unmount();
  });

  it('sends the devices, and says so in plain terms', async () => {
    const v = open([device({ id: 'a' }), device({ id: 'b', sku: 'INV-2' })]);
    pickStore(v.host, MISS);
    await act(async () => { click(v.button('Send')); });
    expect(v.onSend).toHaveBeenCalledTimes(1);
    const arg = v.onSend.mock.calls[0][0];
    expect(arg.toLocationId).toBe(MISS);
    expect(arg.items.map((i: InventoryItem) => i.id)).toEqual(['a', 'b']);
    expect(arg.overriddenIds).toEqual([]);
    v.unmount();
  });

  it('A RESERVED DEVICE IS HELD BACK until it is deliberately ticked', async () => {
    const reserved = device({ id: 'r1', deviceStatus: 'reserved' });
    const v = open([reserved]);
    pickStore(v.host, MISS);
    // Nothing to send yet: a deposit has been paid on it.
    expect(v.text()).toMatch(/Reserved for a layaway/i);
    expect(v.text()).toMatch(/paid a deposit/i);
    expect(v.button('Send')?.hasAttribute('disabled')).toBe(true);

    const box = v.checkboxes()[0];
    act(() => { box.click(); });
    await act(async () => { click(v.button('Send')); });
    const arg = v.onSend.mock.calls[0][0];
    expect(arg.items.map((i: InventoryItem) => i.id)).toEqual(['r1']);
    // THE OVERRIDE IS RECORDED, not left as an untraceable decision.
    expect(arg.overriddenIds).toEqual(['r1']);
    v.unmount();
  });

  it('LISTS WHAT IS STAYING AND WHY — a batch that quietly sent four of five loses the fifth', async () => {
    const v = open([device({ id: 'ok' }), device({ id: 'sold', soldDate: '2026-10-05' })]);
    expect(v.text()).toMatch(/Staying here/i);
    expect(v.text()).toMatch(/Already sold/i);
    pickStore(v.host, MISS);
    await act(async () => { click(v.button('Send')); });
    expect(v.onSend.mock.calls[0][0].items.map((i: InventoryItem) => i.id)).toEqual(['ok']);
    v.unmount();
  });

  it('says what in transit means, so nobody expects it on a shelf', () => {
    const v = open([device()]);
    expect(v.text()).toMatch(/sellable at neither/i);
    expect(v.text()).toMatch(/nothing about them changes but where they are/i);
    v.unmount();
  });
});

describe('what is in transit', () => {
  const panel = (opts: {
    me: AppUser; transfers?: InventoryTransfer[]; now?: number;
    onReceive?: () => void; onCancel?: () => void;
  }) => {
    const onReceive = opts.onReceive || vi.fn();
    const onCancel = opts.onCancel || vi.fn();
    return {
      onReceive, onCancel,
      ...mount(
        <InTransitPanel transfers={opts.transfers ?? [transfer()]} inventory={[device()]}
          locations={STORES} me={opts.me} now={opts.now ?? NOW}
          onReceive={onReceive} onCancel={onCancel} />,
      ),
    };
  };

  it('BOTH STORES AND THE OWNER SEE IT — in transit is where things get lost', () => {
    for (const me of [user({ id: 'b', locationIds: [BRAM] }), user({ id: 'm', locationIds: [MISS] }), user({ id: 'o', role: 'owner' })]) {
      const v = panel({ me });
      expect(v.text()).toContain('Brampton');
      expect(v.text()).toContain('Mississauga');
      expect(v.text()).toContain('iPhone 14');
      v.unmount();
    }
  });

  it('THE DESTINATION CONFIRMS IT ARRIVED', () => {
    const v = panel({ me: user({ id: 'm', locationIds: [MISS] }) });
    click(v.button('Confirm arrived'));
    expect(v.onReceive).toHaveBeenCalledTimes(1);
    v.unmount();
  });

  it('THE SENDER CANNOT — and the row says who it is waiting on', () => {
    const v = panel({ me: user({ id: 'sender', locationIds: [BRAM, MISS] }) });
    expect(v.button('Confirm arrived')).toBeUndefined();
    expect(v.text()).toMatch(/waiting on Mississauga to confirm/i);
    v.unmount();
  });

  it('the sender may CANCEL, the receiving store may not', () => {
    const asSender = panel({ me: user({ id: 'sender', locationIds: [BRAM] }) });
    expect(asSender.button('Cancel')).toBeTruthy();
    asSender.unmount();

    const asReceiver = panel({ me: user({ id: 'm', locationIds: [MISS] }) });
    expect(asReceiver.button('Cancel')).toBeUndefined();
    asReceiver.unmount();
  });

  it('FLAGS ONE NOBODY HAS CONFIRMED after three days', () => {
    const late = transfer({ sentAt: NOW - (TRANSFER_STALE_DAYS + 1) * DAY });
    const v = panel({ me: user({ id: 'o', role: 'owner' }), transfers: [late] });
    expect(v.text()).toMatch(/Not confirmed after 4 days/i);
    expect(v.text()).toMatch(/check it actually arrived at Mississauga/i);
    v.unmount();
  });

  it('does not nag about one sent today', () => {
    const v = panel({ me: user({ id: 'o', role: 'owner' }) });
    expect(v.text()).not.toMatch(/Not confirmed after/i);
    expect(v.text()).toMatch(/sent today/i);
    v.unmount();
  });

  it('shows a received or cancelled transfer nowhere — this is the live list', () => {
    const v = panel({ me: user({ id: 'o', role: 'owner' }), transfers: [transfer({ status: 'received' })] });
    expect(v.text()).toMatch(/Nothing is in transit/i);
    v.unmount();
  });

  it('names a layaway override on the device it was used for', () => {
    const v = panel({ me: user({ id: 'o', role: 'owner' }), transfers: [transfer({ reservedOverrides: ['d1'] })] });
    expect(v.text()).toMatch(/layaway override/i);
    v.unmount();
  });

  it('says plainly when a device in a transfer is no longer in inventory', () => {
    // Deleted while in transit. Worth seeing rather than silently skipping.
    const v = panel({ me: user({ id: 'o', role: 'owner' }), transfers: [transfer({ itemIds: ['gone-1234'] })] });
    expect(v.text()).toMatch(/no longer in inventory/i);
    v.unmount();
  });
});
