// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useCheckout } from './useCheckout';
import { InventoryItem } from '../types';

// The bug this guards against: handleCheckout writes the whole sale
// (transaction, device sold-marking, accessory stock decrement, cash-drawer
// effect via App.tsx's onComplete) with no re-entrancy guard, so a second
// call while the first is still in flight — an awaited custom-device SKU
// generation is the deterministic case, a laggy double-tap is the everyday
// one — runs the entire sale twice. onComplete firing exactly once is the
// hook's actual contract: App.tsx's handleSellCart (the real DB write, cash
// movement, and stock decrement) runs once per onComplete call, so "onComplete
// called once" is equivalent to "exactly one transaction, one cash movement,
// one stock decrement."

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const device: InventoryItem = {
  id: 'dev-1', kind: 'device', sku: 'FTT-0001', date: '2026-01-01', item: 'iPhone 13',
  imei: '123456789012345', boughtFrom: '', purchaseCost: 100, repairCost: 0,
  deviceType: 'Phone', condition: 'Good', targetSalePrice: 300,
  soldDate: '', soldTo: '', salePrice: 0, notes: '',
};

function Harness({ onComplete, onGenerateSku, onReady }: {
  onComplete: (p: any) => void;
  onGenerateSku?: (t?: any) => Promise<string>;
  onReady: (cx: ReturnType<typeof useCheckout>) => void;
}) {
  const cx = useCheckout({ inventory: [device], onComplete, onGenerateSku });
  onReady(cx);
  return null;
}

function mount(props: { onComplete: (p: any) => void; onGenerateSku?: (t?: any) => Promise<string> }) {
  let cx!: ReturnType<typeof useCheckout>;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<Harness onComplete={props.onComplete} onGenerateSku={props.onGenerateSku} onReady={c => { cx = c; }} />);
  });
  return { get cx() { return cx; }, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

describe('useCheckout Quick Sale search', () => {
  it('finds the same device typing either the short (prefix-stripped label) or full SKU form', () => {
    // device.sku is 'FTT-0001'; the printed shelf label shows just '0001'
    // (services/labelLayout.ts's shortLabelSku, display-only) — staff need to
    // be able to type either off the shelf and land on the same device.
    const onComplete = vi.fn();
    const h = mount({ onComplete });

    act(() => { h.cx.setSearch('0001'); });
    expect(h.cx.availableDevices.map(d => d.id)).toEqual(['dev-1']);

    act(() => { h.cx.setSearch('FTT-0001'); });
    expect(h.cx.availableDevices.map(d => d.id)).toEqual(['dev-1']);

    h.unmount();
  });
});

describe('useCheckout re-entrancy guard', () => {
  it('two overlapping handleCheckout calls (racing an awaited SKU generation) complete the sale only once', async () => {
    // A custom device flagged addToInventory is the one deterministic async
    // gap inside handleCheckout itself (await onGenerateSku) — the exact
    // window a second call could slip through before the ref guard existed.
    const onComplete = vi.fn();
    let resolveSku!: (v: string) => void;
    const onGenerateSku = vi.fn(() => new Promise<string>(res => { resolveSku = res; }));
    const h = mount({ onComplete, onGenerateSku });

    act(() => {
      h.cx.setCustom({ ...h.cx.custom, name: 'Custom iPhone', category: 'device', unitPrice: '250', addToInventory: true });
    });
    act(() => { h.cx.addCustomItem(); });

    let p1!: Promise<void>;
    let p2!: Promise<void>;
    await act(async () => {
      p1 = h.cx.handleCheckout();
      // Fired while p1 is still awaiting onGenerateSku — exactly the race.
      p2 = h.cx.handleCheckout();
      resolveSku('SKU-DUP-1');
      await Promise.all([p1, p2]);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onGenerateSku).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it('a rapid double-invocation with no internal await also completes the sale only once', async () => {
    const onComplete = vi.fn();
    const h = mount({ onComplete });

    act(() => { h.cx.addDevice(device); });

    await act(async () => {
      const p1 = h.cx.handleCheckout();
      const p2 = h.cx.handleCheckout();
      await Promise.all([p1, p2]);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it('the guard releases after a completed checkout, so a genuinely separate later sale still works', async () => {
    const onComplete = vi.fn();
    const h = mount({ onComplete });

    act(() => { h.cx.addDevice(device); });
    await act(async () => { await h.cx.handleCheckout(); });
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(h.cx.isSubmitting).toBe(false);

    // A second, distinct device — simulating the next real sale of the day.
    const device2 = { ...device, id: 'dev-2', sku: 'FTT-0002' };
    act(() => { h.cx.addDevice(device2); });
    await act(async () => { await h.cx.handleCheckout(); });

    expect(onComplete).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  it('exposes isSubmitting so the UI can disable the button and show a processing state', async () => {
    const onComplete = vi.fn();
    let resolveSku!: (v: string) => void;
    const onGenerateSku = vi.fn(() => new Promise<string>(res => { resolveSku = res; }));
    const h = mount({ onComplete, onGenerateSku });

    act(() => {
      h.cx.setCustom({ ...h.cx.custom, name: 'Custom iPhone', category: 'device', unitPrice: '250', addToInventory: true });
    });
    act(() => { h.cx.addCustomItem(); });

    expect(h.cx.isSubmitting).toBe(false);
    let checkoutPromise!: Promise<void>;
    act(() => { checkoutPromise = h.cx.handleCheckout(); });
    expect(h.cx.isSubmitting).toBe(true);

    await act(async () => { resolveSku('SKU-1'); await checkoutPromise; });
    expect(h.cx.isSubmitting).toBe(false);
    h.unmount();
  });
});
