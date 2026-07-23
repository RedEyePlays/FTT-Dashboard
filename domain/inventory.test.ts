import { describe, it, expect } from 'vitest';
import { kindOf, isDevice, isAccessory, collectionFor, stockChange, isOversold, getDeviceDisplayName } from './inventory';
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

  it('falls back through legacy fields in priority order', () => {
    expect(getDeviceDisplayName({ item: 'Pixel 7' })).toBe('Pixel 7');
    expect(getDeviceDisplayName({ deviceName: 'Pixel 7' } as any)).toBe('Pixel 7');
    expect(getDeviceDisplayName({ name: 'Pixel 7' } as any)).toBe('Pixel 7');
    expect(getDeviceDisplayName({ modelName: 'Pixel 7' } as any)).toBe('Pixel 7');
    // item wins over other legacy fields
    expect(getDeviceDisplayName({ item: 'From Item', name: 'From Name', modelName: 'From ModelName' } as any)).toBe('From Item');
    // brand/model still win over any legacy field
    expect(getDeviceDisplayName({ brand: 'Sony', model: 'PS5', item: 'Legacy' })).toBe('Sony PS5');
  });

  it('returns an em dash for an empty record', () => {
    expect(getDeviceDisplayName({})).toBe('—');
    expect(getDeviceDisplayName({ brand: '', model: '', item: '' })).toBe('—');
    expect(getDeviceDisplayName(null)).toBe('—');
    expect(getDeviceDisplayName(undefined)).toBe('—');
  });

  it('works on a full InventoryItem', () => {
    const d: InventoryItem = { ...base, brand: 'Apple', model: 'iPhone 13', item: '' };
    expect(getDeviceDisplayName(d)).toBe('Apple iPhone 13');
  });
});
