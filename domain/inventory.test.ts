import { describe, it, expect } from 'vitest';
import { kindOf, isDevice, isAccessory, collectionFor, decrementStock } from './inventory';
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
