import { describe, it, expect } from 'vitest';
import { InventoryItem } from '../types';
import {
  MAX_SELL_BATCH, SELL_BLOCK_NOTE, describeSellBatch, planSellBatch,
  sellBatchTooLargeMessage, targetTotalOf,
} from './sellBatch';

/**
 * SELLING A WHOLESALE LOT THROUGH THE TILL.
 *
 * Putting thirty devices in the POS cart meant searching the picker for each
 * one, thirty times. The rule this plan follows is that it must be NEITHER
 * STRICTER NOR LOOSER than that picker: `availableDevices` in
 * hooks/useCheckout.ts excludes a sold device and one already in the cart, and
 * offers everything else.
 */

const dev = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'FTT-000101', date: '2026-01-01', item: 'iPhone 14',
  imei: '', boughtFrom: '', purchaseCost: 300, repairCost: 0, soldDate: '', soldTo: '',
  salePrice: 0, notes: '', deviceType: 'Phone', condition: 'Good', deviceStatus: 'ready',
  targetSalePrice: 500, ...p,
});

describe('what goes to the cart and what does not', () => {
  it('an ordinary in-stock device goes', () => {
    const p = planSellBatch([dev({ id: 'a' })]);
    expect(p.sellable.map(i => i.id)).toEqual(['a']);
    expect(p.blocked).toEqual([]);
    expect(p.flagged).toEqual([]);
  });

  it('A SOLD DEVICE DOES NOT — and that is not an override anybody is offered', () => {
    // Two sales of one phone is not a judgement call.
    const p = planSellBatch([dev({ id: 'a' }), dev({ id: 's', soldDate: '2026-05-05', deviceStatus: 'sold' })]);
    expect(p.sellable.map(i => i.id)).toEqual(['a']);
    expect(p.blocked.map(b => [b.item.id, b.reason])).toEqual([['s', 'sold']]);
    expect(SELL_BLOCK_NOTE.sold).toMatch(/not sent/);
  });

  it('a device already in the cart does not — it is already in the cart', () => {
    const p = planSellBatch([dev({ id: 'a' }), dev({ id: 'b' })], ['b']);
    expect(p.sellable.map(i => i.id)).toEqual(['a']);
    expect(p.blocked.map(b => b.reason)).toEqual(['in-cart']);
  });

  it('an accessory does not, and is named rather than vanishing', () => {
    const p = planSellBatch([dev({ id: 'a' }), dev({ id: 'c', kind: 'accessory' })]);
    expect(p.sellable.map(i => i.id)).toEqual(['a']);
    expect(p.blocked.map(b => b.reason)).toEqual(['accessory']);
    expect(SELL_BLOCK_NOTE.accessory).toMatch(/devices only/);
  });

  it('RESERVED, ON THE BENCH, NOT BOUGHT YET and IN TRANSIT all GO — named, not blocked', () => {
    // Exactly what the POS picker offers today. A reserved device whose
    // customer never came back is the stock that ends up in a wholesale lot.
    const items = [
      dev({ id: 'r', deviceStatus: 'reserved' }),
      dev({ id: 'b', deviceStatus: 'pending_repair' }),
      dev({ id: 'p', deviceStatus: 'pending_purchase' }),
      dev({ id: 't', inTransferId: 'tr1' }),
    ];
    const plan = planSellBatch(items);
    expect(plan.sellable.map(i => i.id)).toEqual(['r', 'b', 'p', 't']);
    expect(plan.blocked).toEqual([]);
    expect(plan.flagged.map(f => [f.item.id, f.flag])).toEqual([
      ['r', 'reserved'], ['b', 'pending-repair'], ['p', 'pending-purchase'], ['t', 'in-transit'],
    ]);
  });

  it('selection order is cart order', () => {
    const p = planSellBatch([dev({ id: 'c' }), dev({ id: 'a' }), dev({ id: 'b' })]);
    expect(p.sellable.map(i => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('says in one line what it will do', () => {
    const p = planSellBatch([dev({ id: 'a' }), dev({ id: 's', deviceStatus: 'sold', soldDate: '2026-01-01' })]);
    expect(describeSellBatch(p)).toBe('1 device to the cart · 1 not sent');
    expect(describeSellBatch(planSellBatch([dev({ id: 'a' }), dev({ id: 'b' })])))
      .toBe('2 devices to the cart');
  });
});

/* ======================================================================== *
 * THIRTY TARGET PRICES, ONE AGREED LOT PRICE
 * ======================================================================== */

describe('the lot total is shown, and no price is invented', () => {
  it('sums the target prices of what is actually going', () => {
    const p = planSellBatch([
      dev({ id: 'a', targetSalePrice: 500 }),
      dev({ id: 'b', targetSalePrice: 249.99 }),
      dev({ id: 's', targetSalePrice: 9999, deviceStatus: 'sold', soldDate: '2026-01-01' }),
    ]);
    expect(p.targetTotal).toBe(749.99);   // the sold one is not in the lot
  });

  it('a device with no target price contributes nothing rather than NaN', () => {
    expect(targetTotalOf([dev({ targetSalePrice: undefined }), dev({ targetSalePrice: 100 })])).toBe(100);
    expect(targetTotalOf([])).toBe(0);
  });

  it('rounds to cents, so the figure on screen is the figure', () => {
    expect(targetTotalOf([dev({ targetSalePrice: 0.1 }), dev({ targetSalePrice: 0.2 })])).toBe(0.3);
  });
});

/* ======================================================================== *
 * THE CAP
 * ======================================================================== */

describe('one cart has a ceiling', () => {
  it('names the limit and refuses rather than truncating', () => {
    // A truncated cart looks correct and the missing devices stay on the books.
    const msg = sellBatchTooLargeMessage(220);
    expect(msg).toContain('220');
    expect(msg).toContain(String(MAX_SELL_BATCH));
    expect(msg).toMatch(/split|narrow/);
  });

  it('the cap counts only what would actually be sent', () => {
    const sold = Array.from({ length: 100 }, (_, k) =>
      dev({ id: `s${k}`, deviceStatus: 'sold', soldDate: '2026-01-01' }));
    const p = planSellBatch([...sold, dev({ id: 'a' })]);
    expect(p.sellable).toHaveLength(1);
    expect(p.sellable.length > MAX_SELL_BATCH).toBe(false);
  });
});
