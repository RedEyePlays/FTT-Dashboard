import { describe, it, expect } from 'vitest';
import { skuPrefix, formatSku, nextSku } from './sku';
import { InventoryItem } from '../types';

const item = (sku: string): InventoryItem =>
  ({ id: sku, sku, item: 'x', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, date: '', notes: '' });

describe('skuPrefix', () => {
  it('returns the neutral FTT prefix for every kind and device type', () => {
    expect(skuPrefix('device', 'Phone')).toBe('FTT');
    expect(skuPrefix('device', 'Laptop')).toBe('FTT');
    expect(skuPrefix('device', 'Tablet')).toBe('FTT');
    expect(skuPrefix('accessory')).toBe('FTT');
    expect(skuPrefix('device')).toBe('FTT');
  });
});

describe('formatSku', () => {
  it('zero-pads to six digits', () => {
    expect(formatSku('FTT', 1)).toBe('FTT-000001');
    expect(formatSku('FTT', 123456)).toBe('FTT-123456');
  });
});

describe('nextSku', () => {
  it('increments the shared counter sequentially', () => {
    const { sku, counters } = nextSku('FTT', { FTT: 4 }, []);
    expect(sku).toBe('FTT-000005');
    expect(counters.FTT).toBe(5);
  });

  it('starts at 1 for an unseen prefix', () => {
    const { sku } = nextSku('FTT', {}, []);
    expect(sku).toBe('FTT-000001');
  });

  it('numbers new items sequentially across devices and accessories', () => {
    // Both a device and an accessory drawn from the same FTT counter.
    let counters: Record<string, number> = {};
    const a = nextSku('FTT', counters, []); counters = a.counters;
    const b = nextSku('FTT', counters, []); counters = b.counters;
    expect(a.sku).toBe('FTT-000001');
    expect(b.sku).toBe('FTT-000002');
  });

  it('never reuses a number already present on an existing item', () => {
    // Counter says 0 (next would be 1) but FTT-000001 already exists → skip to 2.
    const { sku, counters } = nextSku('FTT', { FTT: 0 }, [item('FTT-000001')]);
    expect(sku).toBe('FTT-000002');
    expect(counters.FTT).toBe(2);
  });

  it('skips legacy-prefixed SKUs without collision (they are left unchanged)', () => {
    // Existing legacy SKUs use other prefixes and never clash with FTT numbers.
    const { sku } = nextSku('FTT', {}, [item('PHN-000001'), item('ACC-000009')]);
    expect(sku).toBe('FTT-000001');
  });

  it('does not mutate the input counters object', () => {
    const counters = { FTT: 1 };
    nextSku('FTT', counters, []);
    expect(counters.FTT).toBe(1);
  });
});
