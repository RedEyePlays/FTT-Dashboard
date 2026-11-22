// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useCheckout } from './useCheckout';
import { InventoryItem, Offer } from '../types';

/**
 * SELLING A DEVICE IN-STORE WHILE IT IS OUT ON A WHOLESALE QUOTE.
 *
 * This is the reason the offer feature is worth building, and QUICK SALE IS
 * WHERE THE DAMAGE HAPPENS — so this is where it is caught.
 *
 * It does NOT block. A quote is not an agreement: a customer at the counter
 * with cash beats a wholesaler who is still deciding, and the device is
 * neither sold nor reserved. The mistake is doing it unknowingly, so checkout
 * is gated on an acknowledgement that names the buyers — the same
 * acknowledge-don't-block pattern this app already uses for $0 device prices,
 * listed-elsewhere devices and devices with an open repair ticket — and then
 * the sale goes through.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const dev = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'FTT-000101', date: '2026-01-01', item: 'iPhone 14',
  imei: '', boughtFrom: '', purchaseCost: 300, repairCost: 0, soldDate: '', soldTo: '',
  salePrice: 0, notes: '', deviceType: 'Phone', targetSalePrice: 500, deviceStatus: 'ready', ...p,
});

const INV = [dev({ id: 'a' }), dev({ id: 'b', sku: 'FTT-000102', item: 'Pixel 8' })];

const offer = (p: Partial<Offer> = {}): Offer => ({
  id: 'o1', buyerName: 'Rashid', date: '2026-11-20', status: 'open',
  lines: [{ itemId: 'a', outcome: 'pending' }], createdAt: 1, ...p,
});

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
    root.render(<Harness args={{ inventory: INV, onComplete: () => {}, persist: null, ...args }}
      onReady={(c: any) => { cx = c; }} />);
  });
  return { get cx() { return cx; }, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

beforeEach(() => { sessionStorage.clear(); });

describe('a device out on an open offer is flagged at the till', () => {
  it('flags it, names the buyer, and BLOCKS ONLY UNTIL ACKNOWLEDGED', () => {
    const v = mount({ offers: [offer()] });
    act(() => { v.cx.addDevice(INV[0]); });
    expect(v.cx.hasOfferedDevice).toBe(true);
    expect(v.cx.offeredLines[0].warning).toBe('out on an open offer to Rashid');
    expect(v.cx.blockedByOffered).toBe(true);
    act(() => { v.cx.setAllowOfferedSale(true); });
    expect(v.cx.blockedByOffered).toBe(false);
    v.unmount();
  });

  it('AND THE SALE THEN GOES THROUGH — nothing is permanently refused', () => {
    const onComplete = vi.fn();
    const v = mount({ offers: [offer()], onComplete });
    act(() => { v.cx.addDevice(INV[0]); });
    act(() => { v.cx.handleCheckout(); });
    expect(onComplete).not.toHaveBeenCalled();      // gated
    act(() => { v.cx.setAllowOfferedSale(true); });
    act(() => { v.cx.handleCheckout(); });
    expect(onComplete).toHaveBeenCalledTimes(1);    // and through
    const payload = onComplete.mock.calls[0][0];
    expect(payload.transaction).toBeTruthy();        // an ORDINARY salesTransaction
    expect(payload.soldRows.map((r: InventoryItem) => r.id)).toEqual(['a']);
    v.unmount();
  });

  it('names BOTH buyers when two have been quoted the same phone', () => {
    const v = mount({ offers: [offer(), offer({ id: 'o2', buyerName: 'Mo' })] });
    act(() => { v.cx.addDevice(INV[0]); });
    expect(v.cx.offeredLines[0].warning).toBe('out on 2 open offers (Rashid, Mo)');
    v.unmount();
  });

  it('says nothing about a device no offer has quoted', () => {
    const v = mount({ offers: [offer()] });
    act(() => { v.cx.addDevice(INV[1]); });
    expect(v.cx.hasOfferedDevice).toBe(false);
    expect(v.cx.blockedByOffered).toBe(false);
    v.unmount();
  });

  it('says nothing when the offer is closed, or the line declined', () => {
    for (const o of [offer({ status: 'closed' }), offer({ lines: [{ itemId: 'a', outcome: 'declined' }] })]) {
      const v = mount({ offers: [o] });
      act(() => { v.cx.addDevice(INV[0]); });
      expect(v.cx.hasOfferedDevice).toBe(false);
      v.unmount();
    }
  });

  it('says nothing at all when there are no offers — unchanged behaviour', () => {
    const v = mount({});
    act(() => { v.cx.addDevice(INV[0]); });
    expect(v.cx.hasOfferedDevice).toBe(false);
    expect(v.cx.blockedByOffered).toBe(false);
    v.unmount();
  });
});

describe('the offer that seeded this cart does not warn about itself', () => {
  // Otherwise the screen tells the owner that the thing they are doing
  // conflicts with the thing they are doing, which is how a safeguard gets
  // dismissed by reflex and stops working.
  const atTill = offer({ lines: [{ itemId: 'a', outcome: 'pending', sentToSaleAt: 5 }] });

  it('a cart seeded FROM the offer is silent about that offer', () => {
    const v = mount({ offers: [atTill], initialInventoryIds: ['a'], initialOfferId: 'o1' });
    expect(v.cx.cart.map(l => l.inventoryId)).toEqual(['a']);
    expect(v.cx.cart[0].fromOfferId).toBe('o1');
    expect(v.cx.hasOfferedDevice).toBe(false);
    v.unmount();
  });

  it('BUT STILL WARNS about every other open offer on the same device', () => {
    const v = mount({
      offers: [atTill, offer({ id: 'o2', buyerName: 'Mo' })],
      initialInventoryIds: ['a'], initialOfferId: 'o1',
    });
    expect(v.cx.offeredLines[0].warning).toBe('out on an open offer to Mo');
    v.unmount();
  });

  it('and an ORDINARY over-the-counter sale of a device sitting at another till DOES warn', () => {
    // No offer id on the line, so it sees the lot — including the 'at-till'
    // commitment, which is precisely the double-sell in progress.
    const v = mount({ offers: [atTill] });
    act(() => { v.cx.addDevice(INV[0]); });
    expect(v.cx.offeredLines[0].warning).toBe('out on an open offer to Rashid');
    v.unmount();
  });
});

describe('the warning reads LIVE offers, not a snapshot', () => {
  // listedPlatforms and openRepairNumber are snapshots taken at add-to-cart
  // time; this deliberately is not. A cart sits in sessionStorage across a
  // navigation, and in that time an offer can be raised, answered or closed —
  // a snapshot would both miss a quote raised since and keep warning about one
  // the buyer has already declined.
  it('an offer raised after the device was added still warns', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let cx!: ReturnType<typeof useCheckout>;
    const render = (offers: Offer[]) => act(() => {
      root.render(<Harness args={{ inventory: INV, onComplete: () => {}, persist: null, offers }}
        onReady={(c: any) => { cx = c; }} />);
    });
    render([]);
    act(() => { cx.addDevice(INV[0]); });
    expect(cx.hasOfferedDevice).toBe(false);
    render([offer()]);
    expect(cx.hasOfferedDevice).toBe(true);
    // …and stops warning the moment the buyer declines it.
    render([offer({ lines: [{ itemId: 'a', outcome: 'declined' }] })]);
    expect(cx.hasOfferedDevice).toBe(false);
    act(() => { root.unmount(); });
    host.remove();
  });
});
