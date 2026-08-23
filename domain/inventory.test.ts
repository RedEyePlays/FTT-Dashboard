import { describe, it, expect } from 'vitest';
import { kindOf, isDevice, isAccessory, collectionFor, stockChange, isOversold, getDeviceDisplayName, applyDirectSale } from './inventory';
import { InventoryItem } from '../types';

const base: InventoryItem =
  { id: '1', item: 'x', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, date: '', notes: '' };

describe('kindOf', () => {
  it('treats a missing kind as a device (legacy rows)', () => {
    expect(kindOf({})).toBe('device');
    expect(kindOf({ kind: 'accessory' })).toBe('accessory');
  });
});

describe('guards', () => {
  it('classify devices and accessories', () => {
    expect(isDevice(base)).toBe(true);
    expect(isAccessory(base)).toBe(false);
    expect(isAccessory({ ...base, kind: 'accessory' })).toBe(true);
  });
});

describe('applyDirectSale', () => {
  const NOW = new Date('2026-08-23T12:00:00Z').getTime();
  it('stamps soldDate (today) + marks sold when an Actual price is entered', () => {
    const out = applyDirectSale({ ...base, kind: 'device', salePrice: 300, soldDate: '' }, NOW);
    expect(out.soldDate).toBe('2026-08-23');
    expect(out.deviceStatus).toBe('sold');
    expect(out.salePrice).toBe(300);
  });
  it('preserves an explicit soldDate the user picked', () => {
    const out = applyDirectSale({ ...base, kind: 'device', salePrice: 300, soldDate: '2026-08-01' }, NOW);
    expect(out.soldDate).toBe('2026-08-01');
    expect(out.deviceStatus).toBe('sold');
  });
  it('leaves unpriced devices untouched (no phantom sale)', () => {
    const item = { ...base, kind: 'device' as const, salePrice: 0, soldDate: '' };
    expect(applyDirectSale(item, NOW)).toEqual(item);
  });
  it('never touches accessories', () => {
    const acc = { ...base, kind: 'accessory' as const, salePrice: 50, soldDate: '' };
    expect(applyDirectSale(acc, NOW)).toEqual(acc);
  });
});

describe('collectionFor', () => {
  it('routes items to the right Firestore collection', () => {
    expect(collectionFor(base)).toBe('inventory');
    expect(collectionFor({ ...base, kind: 'accessory' })).toBe('accessories');
    expect(collectionFor({ ...base, kind: 'device' })).toBe('inventory');
  });
});

describe('stockChange', () => {
  it('is a signed decrement of the sold quantity', () => {
    expect(stockChange(3)).toBe(-3);
    expect(stockChange(1)).toBe(-1);
  });
  it('treats undefined/zero as no change', () => {
    expect(stockChange(undefined)).toBe(0);
    expect(stockChange(0)).toBe(0);
  });
  it('never sells a negative quantity (guarded to a non-positive delta)', () => {
    expect(stockChange(-5)).toBe(0);
  });

  it('concurrent decrements sum correctly regardless of write order', () => {
    // Model Firestore increment(): each concurrent sale contributes a delta to the
    // same server value; the final is start + Σdeltas whatever order they land in.
    // (The old absolute-write path returned 9 here — one write clobbered the other.)
    const start = 10;
    const deltas = [stockChange(1), stockChange(1)]; // two concurrent single-unit sales
    const apply = (order: number[]) => order.reduce((q, i) => q + deltas[i], start);
    expect(apply([0, 1])).toBe(8);
    expect(apply([1, 0])).toBe(8);
  });
});

describe('isOversold', () => {
  it('on-hand goes negative as a real oversell signal (not clamped away)', () => {
    // One in stock, two sold concurrently → -1 on hand: a genuine oversell.
    const onHand = [stockChange(1), stockChange(1)].reduce((q, d) => q + d, 1);
    expect(onHand).toBe(-1);
    expect(isOversold(onHand)).toBe(true);
  });
  it('is false for non-negative stock', () => {
    expect(isOversold(0)).toBe(false);
    expect(isOversold(5)).toBe(false);
    expect(isOversold(undefined)).toBe(false);
  });
});

describe('getDeviceDisplayName', () => {
  it('combines brand and model', () => {
    expect(getDeviceDisplayName({ brand: 'Apple', model: 'iPhone 14 Pro' })).toBe('Apple iPhone 14 Pro');
    expect(getDeviceDisplayName({ brand: 'Nintendo', model: 'Switch OLED' })).toBe('Nintendo Switch OLED');
  });

  it('does not duplicate the brand when the model already contains it', () => {
    expect(getDeviceDisplayName({ brand: 'Apple', model: 'Apple iPhone 14 Pro' })).toBe('Apple iPhone 14 Pro');
    expect(getDeviceDisplayName({ brand: 'Samsung', model: 'Samsung Galaxy S24 Ultra' })).toBe('Samsung Galaxy S24 Ultra');
    // case-insensitive
    expect(getDeviceDisplayName({ brand: 'apple', model: 'Apple iPhone 12' })).toBe('Apple iPhone 12');
  });

  it('trims and collapses extra whitespace', () => {
    expect(getDeviceDisplayName({ brand: '  Apple  ', model: '  iPhone 14   Pro ' })).toBe('Apple iPhone 14 Pro');
  });

  it('handles brand only', () => {
    expect(getDeviceDisplayName({ brand: 'Apple' })).toBe('Apple');
    expect(getDeviceDisplayName({ brand: 'Apple', model: '   ' })).toBe('Apple');
  });

  it('handles model only', () => {
    expect(getDeviceDisplayName({ model: 'iPhone 14 Pro' })).toBe('iPhone 14 Pro');
  });

  it('prefers the item field — the single, directly-edited name', () => {
    // `item` is what the user types straight into the Item cell, so it wins.
    expect(getDeviceDisplayName({ item: 'Apple iPhone 12' })).toBe('Apple iPhone 12');
    // item beats brand+model (a row edited via the new single field, whose old
    // brand/model still linger, shows the typed item value).
    expect(getDeviceDisplayName({ brand: 'Sony', model: 'PS5', item: 'Legacy' })).toBe('Legacy');
    // item beats every other legacy field too.
    expect(getDeviceDisplayName({ item: 'From Item', name: 'From Name', modelName: 'From ModelName' } as any)).toBe('From Item');
  });

  it('keeps showing brand+model for existing rows that have no item set', () => {
    // Don't break legacy rows: an empty/whitespace item falls through to the
    // brand+model combination they displayed before.
    expect(getDeviceDisplayName({ brand: 'Apple', model: 'iPhone 12' })).toBe('Apple iPhone 12');
    expect(getDeviceDisplayName({ brand: 'Apple', model: 'iPhone 12', item: '' })).toBe('Apple iPhone 12');
    expect(getDeviceDisplayName({ brand: 'Apple', model: 'iPhone 12', item: '   ' })).toBe('Apple iPhone 12');
  });

  it('falls back through the older legacy name fields when there is no item/brand/model', () => {
    expect(getDeviceDisplayName({ deviceName: 'Pixel 7' } as any)).toBe('Pixel 7');
    expect(getDeviceDisplayName({ name: 'Pixel 7' } as any)).toBe('Pixel 7');
    expect(getDeviceDisplayName({ modelName: 'Pixel 7' } as any)).toBe('Pixel 7');
  });

  it('falls back to device type, then SKU, when no name is set', () => {
    // No name at all → lead with the device type so it's identifiable.
    expect(getDeviceDisplayName({ deviceType: 'Phone' } as any)).toBe('Phone');
    // Type wins over SKU when both are present.
    expect(getDeviceDisplayName({ deviceType: 'Laptop', sku: 'FTT-000123' } as any)).toBe('Laptop');
    // SKU is the last resort when there's no type either.
    expect(getDeviceDisplayName({ sku: 'FTT-000123' } as any)).toBe('FTT-000123');
    // A real name still wins over the type/SKU fallback.
    expect(getDeviceDisplayName({ item: 'Pixel 7', deviceType: 'Phone', sku: 'FTT-1' } as any)).toBe('Pixel 7');
    expect(getDeviceDisplayName({ brand: 'Apple', model: 'iPhone 15', deviceType: 'Phone', sku: 'FTT-1' })).toBe('Apple iPhone 15');
  });

  it('returns an em dash for an empty record', () => {
    expect(getDeviceDisplayName({})).toBe('—');
    expect(getDeviceDisplayName({ brand: '', model: '', item: '' })).toBe('—');
    // Still an em dash when even the fallback fields are blank.
    expect(getDeviceDisplayName({ deviceType: '', sku: '' } as any)).toBe('—');
    expect(getDeviceDisplayName(null)).toBe('—');
    expect(getDeviceDisplayName(undefined)).toBe('—');
  });

  it('works on a full InventoryItem', () => {
    const d: InventoryItem = { ...base, brand: 'Apple', model: 'iPhone 13', item: '' };
    expect(getDeviceDisplayName(d)).toBe('Apple iPhone 13');
  });
});
