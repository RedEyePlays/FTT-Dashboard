import { describe, it, expect } from 'vitest';
import { skuPrefix, formatSku, nextSku } from './sku';
import { InventoryItem } from '../types';

const item = (sku: string): InventoryItem =>
  ({ id: sku, sku, item: 'x', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, date: '', notes: '' });

describe('skuPrefix', () => {
  it('maps device types to prefixes and accessories to ACC', () => {
    expect(skuPrefix('device', 'Phone')).toBe('PHN');
    expect(skuPrefix('device', 'Laptop')).toBe('LAP');
    expect(skuPrefix('device', 'Tablet')).toBe('TAB');
    expect(skuPrefix('accessory')).toBe('ACC');
  });
  it('falls back to OTH for unknown/missing device types', () => {
    expect(skuPrefix('device')).toBe('OTH');
  });
});

describe('formatSku', () => {
  it('zero-pads to six digits', () => {
    expect(formatSku('PHN', 1)).toBe('PHN-000001');
    expect(formatSku('ACC', 123456)).toBe('ACC-123456');
  });
});

describe('nextSku', () => {
  it('increments the per-prefix counter', () => {
    const { sku, counters } = nextSku('PHN', { PHN: 4 }, []);
    expect(sku).toBe('PHN-000005');
    expect(counters.PHN).toBe(5);
  });

  it('starts at 1 for an unseen prefix', () => {
    const { sku } = nextSku('LAP', {}, []);
    expect(sku).toBe('LAP-000001');
  });

  it('never reuses a number already present on an existing item', () => {
    // Counter says 0 (next would be 1) but PHN-000001 already exists → skip to 2.
    const { sku, counters } = nextSku('PHN', { PHN: 0 }, [item('PHN-000001')]);
    expect(sku).toBe('PHN-000002');
    expect(counters.PHN).toBe(2);
  });

  it('does not mutate the input counters object', () => {
    const counters = { PHN: 1 };
    nextSku('PHN', counters, []);
    expect(counters.PHN).toBe(1);
  });
});
