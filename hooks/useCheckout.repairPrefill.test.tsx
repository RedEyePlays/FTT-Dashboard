// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useCheckout, CartLine } from './useCheckout';
import { InventoryItem, Repair } from '../types';
import { repairSalePrefill, repairPartsCost, repairLabor } from '../domain/repairs';
import { checkoutStorageKey, PersistedCheckoutState } from '../domain/checkoutPersistence';

/**
 * CHANGING A REPAIR'S PARTS DID NOT CHANGE THE PROFIT AT CHECKOUT.
 *
 * Reported from the shop: add parts to a retail repair, send it to Quick
 * Sale, go back and change the parts, send it to checkout again — the profit
 * still reflected the OLD parts cost.
 *
 * Two independent faults, both of which had to be fixed for the reported flow
 * to work:
 *
 *  1. THE SAVED CART STOMPED THE FRESH REPAIR LINE. The prefill seed and the
 *     sessionStorage restore both wrote the cart on mount, and the restore
 *     won because it is declared second. Invisible while Quick Sale stayed
 *     mounted (the restore runs once per mount) and certain the moment you
 *     navigate away and back — which is exactly what going to change the
 *     parts does, since App renders the view as `{view === 'pos' && …}`.
 *
 *  2. AN EMPTY `parts` ARRAY FELL BACK TO THE OLD `partsCost`. Deleting every
 *     part was the one edit to a repair that did not take effect.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const WS = 'ws-1';
const USER = 'user-1';
const persist = { workspaceId: WS, userId: USER };

const repair = (p: Partial<Repair> = {}): Repair => ({
  id: 'r-1', repairNumber: 'R-0001', type: 'retail', status: 'ready_pickup',
  deviceType: 'Phone', brand: 'Apple', model: 'iPhone 14', issue: 'Screen',
  customerName: 'Dana', customerPhone: '555', customerEmail: '', customerId: 'c-1',
  repairPrice: 200, deposit: 0, createdAt: 0, parts: [{ id: 'p1', name: 'Screen', unitCost: 80, quantity: 1 }],
  ...p,
} as Repair);

const accessory: InventoryItem = {
  id: 'acc-1', kind: 'accessory', sku: 'ACC-1', date: '2026-01-01', item: 'Case',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0,
  notes: '', quantity: 5, costPerUnit: 3, sellingPrice: 15,
};
const pcBuild: InventoryItem = {
  id: 'pc-1', kind: 'device', sku: 'PC-1', date: '2026-01-01', item: 'Custom PC',
  imei: '', boughtFrom: '', purchaseCost: 400, repairCost: 0, soldDate: '', soldTo: '',
  salePrice: 0, notes: '', deviceType: 'Desktop PC', targetSalePrice: 900,
};

function Harness(props: any) {
  const cx = useCheckout(props.args);
  props.onReady(cx);
  return null;
}
function mount(args: Record<string, unknown>) {
  let cx!: ReturnType<typeof useCheckout>;
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<Harness args={{ inventory: [accessory, pcBuild], onComplete: () => {}, ...args }} onReady={(c: any) => { cx = c; }} />);
  });
  return { get cx() { return cx; }, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

/** A saved cart in sessionStorage, as a previous Quick Sale mount would leave. */
const saveCart = (cart: CartLine[], extra: Partial<PersistedCheckoutState> = {}) => {
  const state: PersistedCheckoutState = {
    savedAt: Date.now(), cart,
    customerName: 'Old Customer', customerPhone: '', customerEmail: '', customerNotes: '',
    selectedCustomerId: 'old-c', linkedRepairId: 'r-1',
    paymentMethod: 'cash', cashTaxStatus: 'none', etransferTaxStatus: 'none', paymentNotes: '',
    cashAmount: '', cardAmount: '', etransferAmount: '', taxCollected: '', deposit: '',
    platformName: '', platformFeePercent: '', shippingCost: '',
    ...extra,
  };
  sessionStorage.setItem(checkoutStorageKey(WS, USER), JSON.stringify(state));
};

const line = (p: Partial<CartLine>): CartLine => ({
  key: `k${Math.random()}`, inventoryId: '', kind: 'accessory', name: 'x', code: '',
  quantity: 1, maxQty: 1, unitPrice: 0, purchaseCost: 0, repairCost: 0,
  taxable: true, discount: 0, ...p,
});
/** The cart line a PREVIOUS checkout of this repair would have saved. */
const stalerepairLine = (partsCost: number) => line({
  name: 'Repair · Apple iPhone 14 — Screen', unitPrice: 200, purchaseCost: partsCost,
  isCustom: true, category: 'service', addToInventory: false, repairId: 'r-1',
});

beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { sessionStorage.clear(); });

/* ======================================================================== *
 * FAULT 2 — the parts cost itself
 * ======================================================================== */

describe('a repair whose parts were deleted', () => {
  it('reports ZERO parts — the stale denormalized total no longer wins', () => {
    // The exact shape from the report: parts emptied, partsCost left at 80.
    const emptied = repair({ parts: [], partsCost: 80 });
    expect(repairPartsCost(emptied)).toBe(0);
    // …and labour and the checkout prefill follow it.
    expect(repairLabor(emptied)).toBe(200);
    expect(repairSalePrefill(emptied).partsCost).toBe(0);
  });

  it('a LEGACY repair — a typed total and no parts array — still reports that total', () => {
    // The fallback exists for these and must keep working. `parts` was never
    // written on this record, which is what tells it apart from an emptied one.
    const legacy = repair({ partsCost: 50 });
    delete (legacy as Partial<Repair>).parts;
    expect(repairPartsCost(legacy)).toBe(50);
    expect(repairLabor(legacy)).toBe(150);
  });

  it('a repair that never had parts at all reports zero', () => {
    const blank = repair({ parts: [] });
    delete (blank as Partial<Repair>).partsCost;
    expect(repairPartsCost(blank)).toBe(0);
    const neverItemised = repair({});
    delete (neverItemised as Partial<Repair>).parts;
    delete (neverItemised as Partial<Repair>).partsCost;
    expect(repairPartsCost(neverItemised)).toBe(0);
  });

  it('still prefers real parts over the denormalized number, as it always did', () => {
    expect(repairPartsCost(repair({ parts: [{ id: 'p1', name: 'Screen', unitCost: 80, quantity: 1 }], partsCost: 50 }))).toBe(80);
    expect(repairPartsCost(repair({ parts: [{ id: 'p1', name: 'Screen', unitCost: 120, quantity: 1 }], partsCost: 80 }))).toBe(120);
    expect(repairPartsCost(repair({ parts: [{ id: 'p1', name: 'S', unitCost: 10, quantity: 3 }] }))).toBe(30);
  });
});

/* ======================================================================== *
 * FAULT 1 — the fresh line must survive the restore
 * ======================================================================== */

describe('sending a repair to checkout when a cart was already saved', () => {
  // THE REGRESSION ITSELF. A saved cart is present, and it holds this very
  // repair at its OLD parts cost — which is what the previous checkout of it
  // persisted. The fresh prefill must win.
  it('prices the line from the repair\'s CURRENT parts, not the saved cart\'s', () => {
    saveCart([stalerepairLine(80)]);
    const edited = repair({ parts: [{ id: 'p1', name: 'Screen', unitCost: 120, quantity: 1 }], partsCost: 80 });
    const v = mount({ persist, initialRepair: repairSalePrefill(edited) });
    const repairLines = v.cx.cart.filter((l: CartLine) => l.repairId === 'r-1');
    expect(repairLines).toHaveLength(1);           // not two, at two prices
    expect(repairLines[0].purchaseCost).toBe(120); // the NEW parts
    v.unmount();
  });

  it('and the profit on screen follows it', () => {
    saveCart([stalerepairLine(80)]);
    const edited = repair({ parts: [{ id: 'p1', name: 'Screen', unitCost: 120, quantity: 1 }], partsCost: 80 });
    const v = mount({ persist, initialRepair: repairSalePrefill(edited) });
    // price 200 − parts 120. The profit maths is untouched; it was being fed
    // a stale number.
    expect(v.cx.purchaseCostTotal).toBe(120);
    expect(v.cx.netProfit).toBe(80);
    v.unmount();
  });

  it('DELETING every part reaches the cart too — the two faults compose', () => {
    saveCart([stalerepairLine(80)]);
    const emptied = repair({ parts: [], partsCost: 80 });
    const v = mount({ persist, initialRepair: repairSalePrefill(emptied) });
    expect(v.cx.cart.filter((l: CartLine) => l.repairId === 'r-1')[0].purchaseCost).toBe(0);
    expect(v.cx.netProfit).toBe(200);   // all labour now
    v.unmount();
  });

  /**
   * WHAT HAPPENS TO THE REST OF THE SAVED CART: it is kept.
   *
   * Somebody halfway through ringing up a case who then sends a repair to
   * checkout keeps the case. Dropping it to make the repair line correct
   * would trade one bug for another.
   */
  it('keeps unrelated in-progress items, and replaces only the repair line', () => {
    saveCart([
      line({ inventoryId: 'acc-1', name: 'Case', unitPrice: 15, purchaseCost: 3, maxQty: 5 }),
      stalerepairLine(80),
    ]);
    const edited = repair({ parts: [{ id: 'p1', name: 'Screen', unitCost: 120, quantity: 1 }], partsCost: 80 });
    const v = mount({ persist, initialRepair: repairSalePrefill(edited) });
    const names = v.cx.cart.map((l: CartLine) => l.name);
    expect(names).toContain('Case');
    expect(v.cx.cart.filter((l: CartLine) => l.repairId === 'r-1')).toHaveLength(1);
    expect(v.cx.cart.find((l: CartLine) => l.repairId === 'r-1')!.purchaseCost).toBe(120);
    v.unmount();
  });

  it('the repair\'s own customer wins over the saved cart\'s', () => {
    saveCart([stalerepairLine(80)]);
    const v = mount({ persist, initialRepair: repairSalePrefill(repair({})) });
    expect(v.cx.customerName).toBe('Dana');       // not 'Old Customer'
    expect(v.cx.selectedCustomerId).toBe('c-1');  // not 'old-c'
    v.unmount();
  });

  it('a saved cart with NO repair in it still restores in full beside the prefill', () => {
    saveCart([line({ inventoryId: 'acc-1', name: 'Case', unitPrice: 15, purchaseCost: 3, maxQty: 5 })]);
    const v = mount({ persist, initialRepair: repairSalePrefill(repair({})) });
    expect(v.cx.cart.map((l: CartLine) => l.name).sort()).toEqual(['Case', 'Repair · Apple iPhone 14 — Screen']);
    v.unmount();
  });
});

describe('the paths that were already working stay working', () => {
  it('a repair sent to checkout with NO saved cart gives exactly one line', () => {
    const v = mount({ persist, initialRepair: repairSalePrefill(repair({})) });
    expect(v.cx.cart).toHaveLength(1);
    expect(v.cx.cart[0].purchaseCost).toBe(80);
    expect(v.cx.customerName).toBe('Dana');
    v.unmount();
  });

  it('an ordinary saved cart with no prefill restores exactly as before', () => {
    saveCart([line({ inventoryId: 'acc-1', name: 'Case', unitPrice: 15, purchaseCost: 3, maxQty: 5 })], {
      customerName: 'Old Customer', linkedRepairId: '',
    });
    const v = mount({ persist });
    expect(v.cx.cart).toHaveLength(1);
    expect(v.cx.cart[0].name).toBe('Case');
    expect(v.cx.customerName).toBe('Old Customer');   // nothing seeded, so the save wins
    v.unmount();
  });

  it('adding the same repair twice from Quick Sale search re-prices rather than duplicating', () => {
    const v = mount({ persist: null, repairs: [repair({})] });
    act(() => { v.cx.addRepair(repair({})); });
    act(() => { v.cx.addRepair(repair({ parts: [{ id: 'p1', name: 'Screen', unitCost: 120, quantity: 1 }] })); });
    expect(v.cx.cart.filter((l: CartLine) => l.repairId === 'r-1')).toHaveLength(1);
    expect(v.cx.cart.find((l: CartLine) => l.repairId === 'r-1')!.purchaseCost).toBe(120);
    v.unmount();
  });
});

/* ======================================================================== *
 * THE SYMMETRIC SEED — the PC-order deposit path
 * ======================================================================== */

describe('the initialInventoryId seed', () => {
  // It does NOT have the repair prefill's race: its effect is declared AFTER
  // the restore and appends functionally, so nothing of its is stomped.
  it('is not stomped by a restored cart', () => {
    saveCart([line({ inventoryId: 'acc-1', name: 'Case', unitPrice: 15, purchaseCost: 3, maxQty: 5 })]);
    const v = mount({ persist, initialInventoryId: 'pc-1' });
    const names = v.cx.cart.map((l: CartLine) => l.name);
    expect(names).toContain('Case');
    expect(names).toContain('Custom PC');
    v.unmount();
  });

  // It did have a quieter version of the same problem: its duplicate guard
  // read the render-time `cart`, which on mount is still [] even though the
  // restore has just queued one containing this very device.
  it('does not add a second line for a device the restored cart already holds', () => {
    saveCart([line({ inventoryId: 'pc-1', kind: 'device', name: 'Custom PC', unitPrice: 900, purchaseCost: 400 })]);
    const v = mount({ persist, initialInventoryId: 'pc-1' });
    expect(v.cx.cart.filter((l: CartLine) => l.inventoryId === 'pc-1')).toHaveLength(1);
    v.unmount();
  });

  it('still seeds normally with no saved cart', () => {
    const v = mount({ persist, initialInventoryId: 'pc-1' });
    expect(v.cx.cart).toHaveLength(1);
    expect(v.cx.cart[0].inventoryId).toBe('pc-1');
    expect(v.cx.cart[0].purchaseCost).toBe(400);
    v.unmount();
  });
});

/* ======================================================================== *
 * THE BATCH SEED — a wholesale lot sent over from Inventory
 * ======================================================================== */

const lot: InventoryItem[] = [
  { ...pcBuild, id: 'w1', sku: 'FTT-000101', item: 'iPhone 14', deviceType: 'Phone', purchaseCost: 300, targetSalePrice: 500 },
  { ...pcBuild, id: 'w2', sku: 'FTT-000102', item: 'iPhone 15', deviceType: 'Phone', purchaseCost: 400, targetSalePrice: 700 },
  { ...pcBuild, id: 'w3', sku: 'FTT-000103', item: 'Pixel 8', deviceType: 'Phone', purchaseCost: 200, targetSalePrice: 350 },
];

describe('the initialInventoryIds batch seed', () => {
  const withLot = (args: Record<string, unknown>) =>
    mount({ inventory: [accessory, pcBuild, ...lot], ...args });

  it('seeds one ordinary device line per id, in order, at each target price', () => {
    const v = withLot({ persist: null, initialInventoryIds: ['w1', 'w2', 'w3'] });
    expect(v.cx.cart.map((l: CartLine) => l.inventoryId)).toEqual(['w1', 'w2', 'w3']);
    expect(v.cx.cart.map((l: CartLine) => l.unitPrice)).toEqual([500, 700, 350]);
    // The SAME line the picker builds — nothing bespoke about a lot line.
    expect(v.cx.cart.every((l: CartLine) => l.kind === 'device' && l.quantity === 1 && l.maxQty === 1)).toBe(true);
    expect(v.cx.cart.map((l: CartLine) => l.purchaseCost)).toEqual([300, 400, 200]);
    v.unmount();
  });

  // Declared AFTER the restore and appends functionally, like the single seed.
  it('is not stomped by a restored cart, and does not stomp it', () => {
    saveCart([line({ inventoryId: 'acc-1', name: 'Case', unitPrice: 15, purchaseCost: 3, maxQty: 5 })]);
    const v = withLot({ persist, initialInventoryIds: ['w1', 'w2'] });
    expect(v.cx.cart.map((l: CartLine) => l.inventoryId)).toEqual(['acc-1', 'w1', 'w2']);
    v.unmount();
  });

  // THE GUARD THAT HAS TO BE INSIDE THE UPDATER: on mount the render-time
  // `cart` is still [] even though the restore has queued one holding these
  // very devices. Read from outside, a restored lot is added a second time —
  // at full price, thirty lines over.
  it('adds no second line for a device the RESTORED cart already holds', () => {
    saveCart([
      line({ inventoryId: 'w1', kind: 'device', name: 'iPhone 14', unitPrice: 500, purchaseCost: 300 }),
      line({ inventoryId: 'w3', kind: 'device', name: 'Pixel 8', unitPrice: 350, purchaseCost: 200 }),
    ]);
    const v = withLot({ persist, initialInventoryIds: ['w1', 'w2', 'w3'] });
    expect(v.cx.cart.map((l: CartLine) => l.inventoryId)).toEqual(['w1', 'w3', 'w2']);
    for (const id of ['w1', 'w2', 'w3']) {
      expect(v.cx.cart.filter((l: CartLine) => l.inventoryId === id), id).toHaveLength(1);
    }
    v.unmount();
  });

  it('guards WITHIN the batch: the same device twice is one line', () => {
    const v = withLot({ persist: null, initialInventoryIds: ['w1', 'w2', 'w1'] });
    expect(v.cx.cart.map((l: CartLine) => l.inventoryId)).toEqual(['w1', 'w2']);
    v.unmount();
  });

  it('an id naming nothing is skipped, and the rest still go', () => {
    const v = withLot({ persist: null, initialInventoryIds: ['w1', 'gone', 'w2'] });
    expect(v.cx.cart.map((l: CartLine) => l.inventoryId)).toEqual(['w1', 'w2']);
    v.unmount();
  });

  it('does nothing at all when there is no batch', () => {
    expect(withLot({ persist: null }).cx.cart).toEqual([]);
    expect(withLot({ persist: null, initialInventoryIds: [] }).cx.cart).toEqual([]);
  });

  it('leaves the single-device seed working alongside it', () => {
    const v = withLot({ persist: null, initialInventoryId: 'pc-1', initialInventoryIds: ['w1'] });
    expect(v.cx.cart.map((l: CartLine) => l.inventoryId).sort()).toEqual(['pc-1', 'w1']);
    v.unmount();
  });

  it('tells the caller it has consumed the batch, so navigating back does not re-seed', () => {
    const onConsumeInitialInventoryBatch = vi.fn();
    const v = withLot({ persist: null, initialInventoryIds: ['w1'], onConsumeInitialInventoryBatch });
    expect(onConsumeInitialInventoryBatch).toHaveBeenCalled();
    v.unmount();
  });
});
