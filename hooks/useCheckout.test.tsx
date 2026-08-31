// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

function Harness({ inventory, onComplete, onGenerateSku, persist, onReady }: {
  inventory: InventoryItem[];
  onComplete: (p: any) => void;
  onGenerateSku?: (t?: any) => Promise<string>;
  persist?: { workspaceId: string; userId: string } | null;
  onReady: (cx: ReturnType<typeof useCheckout>) => void;
}) {
  const cx = useCheckout({ inventory, onComplete, onGenerateSku, persist });
  onReady(cx);
  return null;
}

function mount(props: {
  inventory?: InventoryItem[];
  onComplete: (p: any) => void;
  onGenerateSku?: (t?: any) => Promise<string>;
  persist?: { workspaceId: string; userId: string } | null;
}) {
  let cx!: ReturnType<typeof useCheckout>;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<Harness inventory={props.inventory ?? [device]} onComplete={props.onComplete} onGenerateSku={props.onGenerateSku} persist={props.persist} onReady={c => { cx = c; }} />);
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

// "Keep the cart when navigating away and back": leaving Quick Sale (the view
// unmounting) used to lose the whole in-progress cart. These tests exercise
// the real unmount → sessionStorage save → fresh-hook-instance restore path
// end to end, the same way navigating to Inventory and back to Quick Sale
// actually unmounts/remounts this hook in the app.
describe('useCheckout cart persistence (survive navigating away and back)', () => {
  const persistScope = { workspaceId: 'ws1', userId: 'user1' };
  const device2: InventoryItem = { ...device, id: 'dev-2', sku: 'FTT-0002' };

  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Advances the fake clock and lets the debounced save effect's setTimeout
  // actually fire, wrapped in act() since it triggers no state change here
  // but keeps React's test utilities happy about updates happening outside act.
  const flushDebounce = () => act(() => { vi.advanceTimersByTime(450); });

  it('a cart survives unmounting Quick Sale and mounting it again (leaving and coming back)', () => {
    const onComplete = vi.fn();
    const h1 = mount({ onComplete, persist: persistScope });
    act(() => { h1.cx.addDevice(device); });
    act(() => { h1.cx.setCustomerName('Jane Doe'); });
    flushDebounce();
    h1.unmount(); // simulates navigating away from Quick Sale

    // A fresh hook instance — exactly what remounting Quick Sale produces.
    const h2 = mount({ onComplete, persist: persistScope });
    expect(h2.cx.cart.map(l => l.inventoryId)).toEqual(['dev-1']);
    expect(h2.cx.customerName).toBe('Jane Doe');
    h2.unmount();
  });

  it('is cleared after a completed sale — a sold cart is never restored', async () => {
    const onComplete = vi.fn();
    const h1 = mount({ onComplete, persist: persistScope });
    act(() => { h1.cx.addDevice(device); });
    flushDebounce();
    await act(async () => { await h1.cx.handleCheckout(); });
    h1.unmount();

    const h2 = mount({ onComplete, persist: persistScope });
    expect(h2.cx.cart).toEqual([]);
    h2.unmount();
  });

  it('an explicit reset()/"Clear cart" also clears the persisted save', () => {
    const onComplete = vi.fn();
    const h1 = mount({ onComplete, persist: persistScope });
    act(() => { h1.cx.addDevice(device); });
    flushDebounce();
    act(() => { h1.cx.reset(); });
    h1.unmount();

    const h2 = mount({ onComplete, persist: persistScope });
    expect(h2.cx.cart).toEqual([]);
    h2.unmount();
  });

  it('is never restored for a different user id on the same device (shared terminal)', () => {
    const onComplete = vi.fn();
    const h1 = mount({ onComplete, persist: { workspaceId: 'ws1', userId: 'employeeA' } });
    act(() => { h1.cx.addDevice(device); });
    flushDebounce();
    h1.unmount();

    const h2 = mount({ onComplete, persist: { workspaceId: 'ws1', userId: 'employeeB' } });
    expect(h2.cx.cart).toEqual([]);
    h2.unmount();
  });

  it('is never restored across a workspace mismatch', () => {
    const onComplete = vi.fn();
    const h1 = mount({ onComplete, persist: { workspaceId: 'ws1', userId: 'user1' } });
    act(() => { h1.cx.addDevice(device); });
    flushDebounce();
    h1.unmount();

    const h2 = mount({ onComplete, persist: { workspaceId: 'ws2', userId: 'user1' } });
    expect(h2.cx.cart).toEqual([]);
    h2.unmount();
  });

  it('is not restored when the saved cart has expired (older than the persistence window)', () => {
    const onComplete = vi.fn();
    vi.setSystemTime(1_700_000_000_000);
    const h1 = mount({ onComplete, persist: persistScope });
    act(() => { h1.cx.addDevice(device); });
    flushDebounce();
    h1.unmount();

    // Jump the clock forward past the persistence window before reopening.
    vi.setSystemTime(1_700_000_000_000 + 5 * 60 * 60 * 1000); // +5h > the 4h TTL
    const h2 = mount({ onComplete, persist: persistScope });
    expect(h2.cx.cart).toEqual([]);
    h2.unmount();
  });

  it('a cart within the persistence window (a couple hours later) IS restored', () => {
    const onComplete = vi.fn();
    vi.setSystemTime(1_700_000_000_000);
    const h1 = mount({ onComplete, persist: persistScope });
    act(() => { h1.cx.addDevice(device); });
    flushDebounce();
    h1.unmount();

    vi.setSystemTime(1_700_000_000_000 + 2 * 60 * 60 * 1000); // +2h, still under the 4h TTL
    const h2 = mount({ onComplete, persist: persistScope });
    expect(h2.cx.cart.map(l => l.inventoryId)).toEqual(['dev-1']);
    h2.unmount();
  });

  it('a line whose device was sold in the meantime is dropped on restore, with a clear notice', () => {
    const onComplete = vi.fn();
    const h1 = mount({ onComplete, inventory: [device, device2], persist: persistScope });
    act(() => { h1.cx.addDevice(device); h1.cx.addDevice(device2); });
    flushDebounce();
    h1.unmount();

    // Live data has since changed: `device` was sold elsewhere before this
    // tab reopened Quick Sale; `device2` is still available.
    const soldDevice = { ...device, soldDate: '2026-08-01', deviceStatus: 'sold' as const };
    const h2 = mount({ onComplete, inventory: [soldDevice, device2], persist: persistScope });
    expect(h2.cx.cart.map(l => l.inventoryId)).toEqual(['dev-2']);
    expect(h2.cx.restoreNotice).toBe('1 item is no longer available and was removed: iPhone 13.');
    h2.unmount();
  });

  it('soldDate resets to today on restore, never resurrecting a previously backdated date', () => {
    const onComplete = vi.fn();
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));
    const h1 = mount({ onComplete, persist: persistScope });
    act(() => { h1.cx.addDevice(device); });
    act(() => { h1.cx.setSoldDate('2026-01-01'); }); // an intentionally backdated sale
    flushDebounce();
    h1.unmount();

    // Reopen a couple hours later — still well within the persistence window.
    vi.setSystemTime(new Date('2026-08-20T14:00:00Z'));
    const h2 = mount({ onComplete, persist: persistScope });
    expect(h2.cx.cart.map(l => l.inventoryId)).toEqual(['dev-1']); // cart itself still restored
    expect(h2.cx.soldDate).toBe('2026-08-20'); // but the date is today's, not the backdated 2026-01-01
    h2.unmount();
  });

  it('a restored cart still respects the $0-price checkout block', async () => {
    const onComplete = vi.fn();
    const zeroPriceDevice: InventoryItem = { ...device, id: 'dev-3', sku: 'FTT-0003', targetSalePrice: 0 };
    const h1 = mount({ onComplete, inventory: [zeroPriceDevice], persist: persistScope });
    act(() => { h1.cx.addDevice(zeroPriceDevice); });
    flushDebounce();
    h1.unmount();

    const h2 = mount({ onComplete, inventory: [zeroPriceDevice], persist: persistScope });
    expect(h2.cx.blockedByZeroPrice).toBe(true);
    await act(async () => { await h2.cx.handleCheckout(); });
    expect(onComplete).not.toHaveBeenCalled(); // blocked, exactly like an unrestored $0 cart would be
    h2.unmount();
  });

  it('the double-submit re-entrancy guard still applies to a restored cart', async () => {
    const onComplete = vi.fn();
    const h1 = mount({ onComplete, persist: persistScope });
    act(() => { h1.cx.addDevice(device); });
    flushDebounce();
    h1.unmount();

    const h2 = mount({ onComplete, persist: persistScope });
    await act(async () => {
      const p1 = h2.cx.handleCheckout();
      const p2 = h2.cx.handleCheckout();
      await Promise.all([p1, p2]);
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
    h2.unmount();
  });

  it('an unauthenticated/preview session (persist omitted) never saves or restores anything', () => {
    const onComplete = vi.fn();
    const h1 = mount({ onComplete }); // no persist option at all
    act(() => { h1.cx.addDevice(device); });
    flushDebounce();
    h1.unmount();

    const h2 = mount({ onComplete });
    expect(h2.cx.cart).toEqual([]);
    h2.unmount();
  });
});

// --- Shipping cost -----------------------------------------------------------
// Online sales carry two distinct costs: the marketplace's commission and
// shipping. Shipping is a COST, never a price reduction — absorbing it by
// discounting the sale price would misstate revenue and sales tax, which is
// exactly what this field exists to avoid.

const device2: InventoryItem = {
  ...device, id: 'dev-2', sku: 'FTT-0002', item: 'Pixel 8',
  purchaseCost: 100, targetSalePrice: 100,
};

describe('useCheckout shipping cost', () => {
  it('reduces profit by EXACTLY the shipping amount, leaving subtotal/tax/total alone', () => {
    const onComplete = vi.fn();
    const h = mount({ onComplete });
    act(() => { h.cx.addDevice(device); });
    act(() => { h.cx.updateLine(h.cx.cart[0].key, { unitPrice: 500 }); });

    const before = {
      subtotal: h.cx.subtotal, tax: h.cx.tax, totalPaid: h.cx.totalPaid, netProfit: h.cx.netProfit,
    };

    act(() => { h.cx.setShippingCost('20'); });

    // The three customer-facing figures are untouched...
    expect(h.cx.subtotal).toBe(before.subtotal);
    expect(h.cx.tax).toBe(before.tax);
    expect(h.cx.totalPaid).toBe(before.totalPaid);
    // ...and profit is down by exactly 20.
    expect(before.netProfit - h.cx.netProfit).toBe(20);
    expect(h.cx.shippingAmount).toBe(20);
    h.unmount();
  });

  it('an in-store sale with no shipping behaves exactly as before', () => {
    const onComplete = vi.fn();
    const h = mount({ onComplete });
    act(() => { h.cx.addDevice(device); });
    act(() => { h.cx.updateLine(h.cx.cart[0].key, { unitPrice: 500 }); });

    expect(h.cx.shippingAmount).toBe(0);
    expect(h.cx.netProfit).toBe(500 - 100);   // subtotal − cost, nothing else
    h.unmount();
  });

  it('stores it on the transaction and gives the WHOLE amount to a single-device sale', async () => {
    const onComplete = vi.fn();
    const h = mount({ onComplete });
    act(() => { h.cx.addDevice(device); });
    act(() => { h.cx.updateLine(h.cx.cart[0].key, { unitPrice: 500 }); });
    act(() => { h.cx.setShippingCost('20'); });
    await act(async () => { await h.cx.handleCheckout(); });

    const { transaction, soldRows } = onComplete.mock.calls[0][0];
    expect(transaction.shippingCost).toBe(20);
    expect(transaction.subtotal).toBe(500);        // recorded sale price unchanged
    expect(transaction.netProfit).toBe(500 - 100 - 20);
    // Per-device margin reflects it: the one device carries all of it.
    expect(soldRows[0].shippingCost).toBe(20);
    h.unmount();
  });

  it('apportions across a multi-line cart the SAME way the platform fee is', async () => {
    const onComplete = vi.fn();
    const h = mount({ onComplete, inventory: [device, device2] });
    act(() => { h.cx.addDevice(device); h.cx.addDevice(device2); });
    // A $1000 cart: 750 + 250.
    act(() => {
      h.cx.updateLine(h.cx.cart[0].key, { unitPrice: 750 });
      h.cx.updateLine(h.cx.cart[1].key, { unitPrice: 250 });
    });
    act(() => { h.cx.setPlatformFeePercent('10'); h.cx.setShippingCost('20'); });
    await act(async () => { await h.cx.handleCheckout(); });

    const { soldRows } = onComplete.mock.calls[0][0];
    const byId = Object.fromEntries(soldRows.map((r: InventoryItem) => [r.id, r]));
    // 75/25 split, identical for both costs.
    expect(byId['dev-1'].shippingCost).toBeCloseTo(15, 6);
    expect(byId['dev-2'].shippingCost).toBeCloseTo(5, 6);
    expect(byId['dev-1'].platformFees).toBeCloseTo(75, 6);
    expect(byId['dev-2'].platformFees).toBeCloseTo(25, 6);
    // The same ratio drove both — one apportionment, not two schemes.
    expect(byId['dev-1'].shippingCost / 20).toBeCloseTo(byId['dev-1'].platformFees / 100, 10);
    // Nothing is lost in the split.
    expect(byId['dev-1'].shippingCost + byId['dev-2'].shippingCost).toBeCloseTo(20, 6);
    h.unmount();
  });

  it('omits shippingCost entirely from an in-store transaction', async () => {
    const onComplete = vi.fn();
    const h = mount({ onComplete });
    act(() => { h.cx.addDevice(device); });
    act(() => { h.cx.updateLine(h.cx.cart[0].key, { unitPrice: 500 }); });
    await act(async () => { await h.cx.handleCheckout(); });

    const { transaction } = onComplete.mock.calls[0][0];
    expect(transaction.shippingCost).toBeUndefined();
    expect(transaction.netProfit).toBe(400);
    h.unmount();
  });

  it('ignores a negative or junk entry rather than inflating profit', () => {
    const onComplete = vi.fn();
    const h = mount({ onComplete });
    act(() => { h.cx.addDevice(device); });
    act(() => { h.cx.updateLine(h.cx.cart[0].key, { unitPrice: 500 }); });

    act(() => { h.cx.setShippingCost('-50'); });
    expect(h.cx.shippingAmount).toBe(0);     // a negative "cost" is not income
    expect(h.cx.netProfit).toBe(400);

    act(() => { h.cx.setShippingCost('abc'); });
    expect(h.cx.shippingAmount).toBe(0);
    h.unmount();
  });
});
