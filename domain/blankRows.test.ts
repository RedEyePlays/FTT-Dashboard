import { describe, it, expect } from 'vitest';
import { InventoryItem } from '../types';
import { isBlankRow, blankRows, blankRowsLabel } from './blankRows';

// Exactly what the old addDeviceRow / addAccessoryRow wrote to Firestore the
// moment "Add Device" was clicked.
const abandonedDevice = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'PHN-000001', date: '2026-08-01', item: '', imei: '',
  boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0,
  deviceType: 'Phone', brand: '', model: '', storage: '', color: '', carrier: '',
  batteryHealth: '', condition: 'Good', purchaseSource: '', targetSalePrice: 0,
  deviceStatus: 'ready', notes: '', ...p,
});

const abandonedAccessory = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'a1', kind: 'accessory', sku: 'ACC-000001', date: '2026-08-02', item: '', imei: '',
  boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0,
  manufacturerBarcode: '', category: '', quantity: 1, costPerUnit: 0, sellingPrice: 0,
  lowStockThreshold: 3, notes: '', ...p,
});

describe('what counts as an abandoned row', () => {
  it('flags exactly what the old Add Device button wrote', () => {
    expect(isBlankRow(abandonedDevice())).toBe(true);
    expect(isBlankRow(abandonedAccessory())).toBe(true);
  });

  it('ignores the SKU — a SKU is all these rows ever had', () => {
    expect(isBlankRow(abandonedDevice({ sku: 'PHN-000123' }))).toBe(true);
    expect(isBlankRow(abandonedDevice({ sku: '' }))).toBe(true);
  });

  it('NEVER flags a row with anything actually on it', () => {
    const cases: Partial<InventoryItem>[] = [
      { imei: '351234567890123' },
      { item: 'iPhone 13' },
      { brand: 'Apple' },
      { model: 'iPhone 13' },
      { storage: '128 GB' },
      { color: 'White' },
      { carrier: 'Rogers' },
      { batteryHealth: '92%' },
      { notes: 'back glass cracked' },
      { boughtFrom: 'Marcus' },
      { purchaseCost: 200 },
      { repairCost: 40 },
      { targetSalePrice: 400 },
      { salePrice: 380 },
      { minSalePrice: 250 },
      { soldDate: '2026-09-01' },
      { soldTo: 'Walk-in' },
      { purchaseSource: 'Marketplace' },
    ];
    for (const c of cases) {
      expect({ field: Object.keys(c)[0], blank: isBlankRow(abandonedDevice(c)) })
        .toEqual({ field: Object.keys(c)[0], blank: false });
    }
  });

  it('never flags a row linked to anything else, however empty it looks', () => {
    const links: Partial<InventoryItem>[] = [
      { transactionId: 't1' },
      { dropOffId: 'do1' },
      { sourceTicketId: 'r1' },
      { batchId: 'b1' },
      { boughtFromCustomerId: 'c1' },
      { listedPlatforms: ['ebay'] },
      { autoCreated: true },
    ];
    for (const l of links) {
      expect({ field: Object.keys(l)[0], blank: isBlankRow(abandonedDevice(l)) })
        .toEqual({ field: Object.keys(l)[0], blank: false });
    }
  });

  it('never flags an accessory with a barcode, a category or a cost', () => {
    expect(isBlankRow(abandonedAccessory({ manufacturerBarcode: '012345678905' }))).toBe(false);
    expect(isBlankRow(abandonedAccessory({ category: 'Chargers' }))).toBe(false);
    expect(isBlankRow(abandonedAccessory({ costPerUnit: 4 }))).toBe(false);
    expect(isBlankRow(abandonedAccessory({ sellingPrice: 12 }))).toBe(false);
  });
});

describe('the cleanup list', () => {
  it('collects only the junk, newest first', () => {
    const inv = [
      abandonedDevice({ id: 'old', date: '2026-01-01' }),
      abandonedDevice({ id: 'real', item: 'iPhone 13' }),
      abandonedAccessory({ id: 'new', date: '2026-08-02' }),
    ];
    expect(blankRows(inv).map(i => i.id)).toEqual(['new', 'old']);
  });

  it('labels the count, and says nothing when there is nothing', () => {
    expect(blankRowsLabel(1)).toBe('1 empty row left over from the old Add Device button');
    expect(blankRowsLabel(4)).toBe('4 empty rows left over from the old Add Device button');
    expect(blankRowsLabel(0)).toBeNull();
  });
});
