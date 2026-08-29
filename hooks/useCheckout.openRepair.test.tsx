// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useCheckout } from './useCheckout';
import { InventoryItem, Repair } from '../types';

// A device with an open repair ticket is physically on the bench. It stays
// searchable and addable (as-is sales are legitimate), but it must never be
// sold SILENTLY: checkout is gated on an explicit acknowledgement naming the
// ticket — the same non-blocking pattern as the $0-price and listed-elsewhere
// safeguards already in this hook.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const device: InventoryItem = {
  id: 'dev-1', kind: 'device', sku: 'PHN-000001', date: '2026-08-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 100, repairCost: 0, deviceType: 'Phone',
  targetSalePrice: 300, soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'pending_repair',
};

const openTicket: Repair = {
  id: 'r1', repairNumber: 'RPR-000042', type: 'internal', createdAt: Date.now(), date: '2026-08-20',
  issue: 'screen', repairPrice: 0, status: 'in_repair', inventoryId: 'dev-1',
};

function Harness({ repairs, onComplete, onReady }: {
  repairs: Repair[]; onComplete: (p: any) => void; onReady: (cx: ReturnType<typeof useCheckout>) => void;
}) {
  onReady(useCheckout({ inventory: [device], repairs, onComplete, persist: null }));
  return null;
}

function mount(repairs: Repair[], onComplete: (p: any) => void) {
  let cx!: ReturnType<typeof useCheckout>;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<Harness repairs={repairs} onComplete={onComplete} onReady={c => { cx = c; }} />); });
  return { get cx() { return cx; }, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

describe('useCheckout open-repair safeguard', () => {
  it('blocks checkout on a device with an open ticket until it is acknowledged', async () => {
    const onComplete = vi.fn();
    const h = mount([openTicket], onComplete);

    // Still findable — the device is not hidden from Quick Sale.
    expect(h.cx.availableDevices.map(d => d.id)).toEqual(['dev-1']);

    act(() => { h.cx.addDevice(device); });
    expect(h.cx.hasOpenRepairDevice).toBe(true);
    expect(h.cx.openRepairLines[0].openRepairNumber).toBe('RPR-000042');
    expect(h.cx.blockedByOpenRepair).toBe(true);

    await act(async () => { await h.cx.handleCheckout(); });
    expect(onComplete).not.toHaveBeenCalled();

    act(() => { h.cx.setAllowOpenRepairSale(true); });
    expect(h.cx.blockedByOpenRepair).toBe(false);
    await act(async () => { await h.cx.handleCheckout(); });
    expect(onComplete).toHaveBeenCalledTimes(1);

    h.unmount();
  });

  it('does not gate a device whose ticket is already closed', () => {
    const onComplete = vi.fn();
    const h = mount([{ ...openTicket, status: 'picked_up' }], onComplete);
    act(() => { h.cx.addDevice(device); });
    expect(h.cx.hasOpenRepairDevice).toBe(false);
    expect(h.cx.blockedByOpenRepair).toBe(false);
    h.unmount();
  });
});
