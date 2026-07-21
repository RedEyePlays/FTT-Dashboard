import { describe, it, expect } from 'vitest';
import { kindOf, isDevice, isAccessory, collectionFor, decrementStock, getDeviceDisplayName } from './inventory';
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

describe('decrementStock', () => {
  it('subtracts sold quantity', () => {
    expect(decrementStock(10, 3)).toBe(7);
  });
  it('never returns negative', () => {
    expect(decrementStock(2, 5)).toBe(0);
  });
  it('treats undefined as zero', () => {
    expect(decrementStock(undefined, 3)).toBe(0);
    expect(decrementStock(5, undefined)).toBe(5);
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
