import { describe, it, expect } from 'vitest';
import {
  isPersistedStateFresh, CHECKOUT_PERSIST_TTL_MS, checkoutStorageKey,
  revalidateRestoredCart, describeDroppedLines,
} from './checkoutPersistence';
import { CartLine } from '../hooks/useCheckout';
import { InventoryItem } from '../types';

const line = (p: Partial<CartLine>): CartLine => ({
  key: 'k1', inventoryId: '', kind: 'device', name: 'iPhone 13', code: 'FTT-0001',
  quantity: 1, maxQty: 1, unitPrice: 300, purchaseCost: 100, repairCost: 0,
  taxable: true, discount: 0, ...p,
});

const dev = (p: Partial<InventoryItem>): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'FTT-0001', date: '2026-01-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 100, repairCost: 0, soldDate: '', soldTo: '',
  salePrice: 0, notes: '', targetSalePrice: 350, ...p,
} as InventoryItem);

describe('isPersistedStateFresh', () => {
  const now = 1_000_000;

  it('is fresh right when saved', () => {
    expect(isPersistedStateFresh(now, now)).toBe(true);
  });

  it('is fresh just under the TTL', () => {
    expect(isPersistedStateFresh(now - (CHECKOUT_PERSIST_TTL_MS - 1), now)).toBe(true);
  });

  it('is exactly at the TTL boundary — still fresh (boundary is inclusive)', () => {
    expect(isPersistedStateFresh(now - CHECKOUT_PERSIST_TTL_MS, now)).toBe(true);
  });

  it('is stale just past the TTL', () => {
    expect(isPersistedStateFresh(now - CHECKOUT_PERSIST_TTL_MS - 1, now)).toBe(false);
  });

  it('a clock that moved backwards (savedAt in the future) is never treated as fresh', () => {
    expect(isPersistedStateFresh(now + 1000, now)).toBe(false);
  });
});

describe('checkoutStorageKey', () => {
  it('is namespaced by both workspace and user — different user or workspace never collides', () => {
    const a = checkoutStorageKey('ws1', 'user1');
    const b = checkoutStorageKey('ws1', 'user2');
    const c = checkoutStorageKey('ws2', 'user1');
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });

  it('is stable for the same workspace+user', () => {
    expect(checkoutStorageKey('ws1', 'user1')).toBe(checkoutStorageKey('ws1', 'user1'));
  });
});

describe('revalidateRestoredCart', () => {
  it('keeps a device line whose device is still available, refreshing price/cost from the live record', () => {
    const inventory = [dev({ id: 'd1', targetSalePrice: 425, purchaseCost: 150 })];
    const cart = [line({ inventoryId: 'd1', unitPrice: 300, purchaseCost: 100 })];
    const { cart: kept, droppedNames } = revalidateRestoredCart(cart, inventory);
    expect(droppedNames).toEqual([]);
    expect(kept).toHaveLength(1);
    expect(kept[0].unitPrice).toBe(425); // refreshed, not the stale 300
    expect(kept[0].purchaseCost).toBe(150);
  });

  it('drops a device line whose device has since been sold', () => {
    const inventory = [dev({ id: 'd1', soldDate: '2026-08-01', deviceStatus: 'sold' })];
    const cart = [line({ inventoryId: 'd1', name: 'iPhone 13' })];
    const { cart: kept, droppedNames } = revalidateRestoredCart(cart, inventory);
    expect(kept).toEqual([]);
    expect(droppedNames).toEqual(['iPhone 13']);
  });

  it('drops a device line whose device has since been reserved (e.g. put on a layaway elsewhere)', () => {
    const inventory = [dev({ id: 'd1', deviceStatus: 'reserved' })];
    const cart = [line({ inventoryId: 'd1' })];
    expect(revalidateRestoredCart(cart, inventory).cart).toEqual([]);
  });

  it('drops a device line whose device was deleted entirely (no longer in inventory)', () => {
    const cart = [line({ inventoryId: 'd1', name: 'iPhone 13' })];
    const { cart: kept, droppedNames } = revalidateRestoredCart(cart, []);
    expect(kept).toEqual([]);
    expect(droppedNames).toEqual(['iPhone 13']);
  });

  it('clamps (not drops) an accessory whose live stock is lower than the saved quantity', () => {
    const inventory = [dev({ id: 'a1', kind: 'accessory', quantity: 2, sellingPrice: 15, costPerUnit: 5, item: 'USB Cable' } as any)];
    const cart = [line({ inventoryId: 'a1', kind: 'accessory', name: 'USB Cable', quantity: 5, maxQty: 5, unitPrice: 15 })];
    const { cart: kept, droppedNames } = revalidateRestoredCart(cart, inventory);
    expect(droppedNames).toEqual([]);
    expect(kept[0].quantity).toBe(2);
    expect(kept[0].maxQty).toBe(2);
  });

  it('drops an accessory line entirely once live stock hits zero', () => {
    const inventory = [dev({ id: 'a1', kind: 'accessory', quantity: 0 } as any)];
    const cart = [line({ inventoryId: 'a1', kind: 'accessory', name: 'USB Cable', quantity: 2 })];
    expect(revalidateRestoredCart(cart, inventory).droppedNames).toEqual(['USB Cable']);
  });

  it('always keeps a custom line (no inventoryId) — nothing live to check it against', () => {
    const cart = [line({ inventoryId: '', isCustom: true, name: 'Screen protector (custom)' })];
    const { cart: kept, droppedNames } = revalidateRestoredCart(cart, []);
    expect(kept).toEqual(cart);
    expect(droppedNames).toEqual([]);
  });

  it('mixed cart: keeps the still-available lines and reports only the dropped ones', () => {
    const inventory = [dev({ id: 'd1' })]; // d2 missing entirely
    const cart = [
      line({ key: 'k1', inventoryId: 'd1', name: 'Available phone' }),
      line({ key: 'k2', inventoryId: 'd2', name: 'Gone phone' }),
      line({ key: 'k3', inventoryId: '', isCustom: true, name: 'Custom fee' }),
    ];
    const { cart: kept, droppedNames } = revalidateRestoredCart(cart, inventory);
    expect(kept.map(l => l.key)).toEqual(['k1', 'k3']);
    expect(droppedNames).toEqual(['Gone phone']);
  });
});

describe('describeDroppedLines', () => {
  it('is null when nothing was dropped', () => {
    expect(describeDroppedLines([])).toBeNull();
  });

  it('names the single item for exactly one drop', () => {
    expect(describeDroppedLines(['iPhone 14'])).toBe('1 item is no longer available and was removed: iPhone 14.');
  });

  it('names every dropped item for multiple drops', () => {
    expect(describeDroppedLines(['iPhone 14', 'USB Cable'])).toBe('2 items are no longer available and were removed: iPhone 14, USB Cable.');
  });
});
