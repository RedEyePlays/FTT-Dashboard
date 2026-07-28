import { describe, it, expect } from 'vitest';
import { platformFeeAmount, isZeroPricedDevice, cartHasZeroPricedDevice, PricedLine, salesBalanceOwing, isLayaway } from './pos';
import { platformFeeAmount, isZeroPricedDevice, cartHasZeroPricedDevice, PricedLine, searchCheckoutInventory, canVoidSale, isVoided } from './pos';
import { platformFeeAmount, isZeroPricedDevice, cartHasZeroPricedDevice, PricedLine, salesBalanceOwing, isLayaway, searchCheckoutInventory, canVoidSale, isVoided } from './pos';
import { InventoryItem, SalesTransaction } from '../types';

const item = (p: Partial<InventoryItem>): InventoryItem => ({
  id: 'x', kind: 'device', item: '', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, date: '', notes: '', ...p,
});

describe('platformFeeAmount', () => {
  it('computes the dollar fee for a subtotal and percent', () => {
    expect(platformFeeAmount(100, 13.25)).toBeCloseTo(13.25);
    expect(platformFeeAmount(200, 0)).toBe(0);
  });
  it('never returns a negative fee', () => {
    expect(platformFeeAmount(-50, 10)).toBe(0);
    expect(platformFeeAmount(100, -10)).toBe(0);
  });
});

const dev = (unitPrice: number): PricedLine => ({ kind: 'device', unitPrice });
const acc = (unitPrice: number): PricedLine => ({ kind: 'accessory', unitPrice });

describe('isZeroPricedDevice', () => {
  it('flags a device priced at $0 or less', () => {
    expect(isZeroPricedDevice(dev(0))).toBe(true);
    expect(isZeroPricedDevice(dev(-5))).toBe(true);
    expect(isZeroPricedDevice({ kind: 'device', unitPrice: NaN as any })).toBe(true); // no price set
  });
  it('does not flag a priced device', () => {
    expect(isZeroPricedDevice(dev(199.99))).toBe(false);
  });
  it('never flags an accessory, even at $0 (only devices are guarded)', () => {
    expect(isZeroPricedDevice(acc(0))).toBe(false);
    expect(isZeroPricedDevice(acc(5))).toBe(false);
  });
});

describe('cartHasZeroPricedDevice', () => {
  it('is true when any device line is $0', () => {
    expect(cartHasZeroPricedDevice([dev(150), acc(0), dev(0)])).toBe(true);
  });
  it('is false when every device line has a price', () => {
    expect(cartHasZeroPricedDevice([dev(150), acc(0), acc(20)])).toBe(false);
  });
  it('is false for an empty cart', () => {
    expect(cartHasZeroPricedDevice([])).toBe(false);
  });
});

describe('salesBalanceOwing', () => {
  it('is the total minus the deposit for a partial payment', () => {
    expect(salesBalanceOwing(500, 200)).toBe(300);
    expect(salesBalanceOwing(99.99, 50)).toBeCloseTo(49.99);
  });
  it('owes nothing when paid in full (deposit absent, 0, or >= total)', () => {
    expect(salesBalanceOwing(500)).toBe(0);
    expect(salesBalanceOwing(500, 0)).toBe(0);
    expect(salesBalanceOwing(500, 500)).toBe(0);
    expect(salesBalanceOwing(500, 600)).toBe(0); // overpayment never goes negative
  });
  it('ignores a negative deposit (treated as paid in full)', () => {
    expect(salesBalanceOwing(500, -10)).toBe(0);
  });
});

ts
describe('isLayaway', () => {
  it('is true only when a balance is still owing', () => {
    expect(isLayaway({ balanceOwing: 300 })).toBe(true);
    expect(isLayaway({ balanceOwing: 0 })).toBe(false);
    expect(isLayaway({})).toBe(false);
  });
});

describe('searchCheckoutInventory', () => {
  const inv: InventoryItem[] = [
    item({ id: 'd1', kind: 'device', item: 'Apple iPhone 14', brand: 'Apple', model: 'iPhone 14', sku: 'PHN-001', imei: '111' }),
    item({ id: 'd2', kind: 'device', item: 'Samsung Galaxy S24', brand: 'Samsung', model: 'Galaxy S24', sku: 'PHN-002' }),
    item({ id: 'sold', kind: 'device', item: 'Apple iPhone 13', sku: 'PHN-003', soldDate: '2026-01-01' }), // sold → excluded
    item({ id: 'a1', kind: 'accessory', item: 'Apple USB-C Cable', sku: 'ACC-001', quantity: 5 }),
    item({ id: 'a0', kind: 'accessory', item: 'Apple Case', sku: 'ACC-002', quantity: 0 }), // out of stock → excluded
  ];

  it('substring-matches name/brand/model across unsold devices + in-stock accessories', () => {
    const ids = searchCheckoutInventory(inv, 'apple').map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining(['d1', 'a1']));
    expect(ids).not.toContain('sold'); // sold device excluded
    expect(ids).not.toContain('a0');   // out-of-stock accessory excluded
  });

  it('matches SKU and IMEI too', () => {
    expect(searchCheckoutInventory(inv, 'phn-002').map(i => i.id)).toEqual(['d2']);
    expect(searchCheckoutInventory(inv, '111').map(i => i.id)).toEqual(['d1']);
  });

  it('honours excludeIds (e.g. already in the cart) and the result limit', () => {
    expect(searchCheckoutInventory(inv, 'apple', { excludeIds: new Set(['d1']) }).map(i => i.id)).not.toContain('d1');
    expect(searchCheckoutInventory(inv, 'a', { limit: 1 })).toHaveLength(1);
  });

  it('returns nothing for a blank query', () => {
    expect(searchCheckoutInventory(inv, '   ')).toEqual([]);
  });
});

describe('void eligibility', () => {
  const tx = (p: Partial<SalesTransaction>): SalesTransaction => ({
    id: 't', date: '2026-07-28', customerName: '', subtotal: 0, tax: 0, platformFee: 0,
    purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines: [], ...p,
  });

  it('allows voiding a same-day, not-yet-voided sale', () => {
    expect(canVoidSale(tx({ date: '2026-07-28' }), '2026-07-28')).toBe(true);
  });
  it('blocks voiding once the day has passed', () => {
    expect(canVoidSale(tx({ date: '2026-07-27' }), '2026-07-28')).toBe(false);
  });
  it('blocks voiding an already-voided sale', () => {
    expect(canVoidSale(tx({ date: '2026-07-28', status: 'voided' }), '2026-07-28')).toBe(false);
    expect(isVoided(tx({ status: 'voided' }))).toBe(true);
    expect(isVoided(tx({}))).toBe(false);
  });
});
