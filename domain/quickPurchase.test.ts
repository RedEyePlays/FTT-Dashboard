import { describe, it, expect } from 'vitest';
import { buildQuickPurchaseItem, quickPurchaseDrawerEffect, quickPurchaseImeiError } from './quickPurchase';
import { findInventoryMatchByIdentifier } from './autoInventory';
import { InventoryItem } from '../types';

const VALID_IMEI = '490154203237518';
const INVALID_IMEI = '490154203237519'; // last digit flipped — fails Luhn

const dev = (p: Partial<InventoryItem>): InventoryItem => ({
  id: 'i1', kind: 'device', date: '2026-07-01', item: 'iPhone', imei: '', boughtFrom: '',
  purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, notes: '', ...p,
});

describe('buildQuickPurchaseItem', () => {
  it('builds a device record with status ready — no repair/pending step, same as a normal Add Item save', () => {
    const item = buildQuickPurchaseItem(
      { device: 'iPhone 13', imei: VALID_IMEI, purchaseCost: 250, paidBy: 'store', boughtFrom: 'Jane Doe' },
      { id: 'new-id', sku: 'PHN-000042' },
      '2026-08-25',
    );
    expect(item).toMatchObject({
      id: 'new-id', kind: 'device', sku: 'PHN-000042', date: '2026-08-25',
      item: 'iPhone 13', imei: VALID_IMEI, imeiNormalized: VALID_IMEI,
      boughtFrom: 'Jane Doe', purchaseCost: 250, repairCost: 0,
      soldDate: '', soldTo: '', salePrice: 0, deviceStatus: 'ready',
    });
  });

  it('trims device name and seller, and normalizes+stores a serial (non-IMEI) identifier', () => {
    const item = buildQuickPurchaseItem(
      { device: '  Pixel 8  ', imei: ' sn-001 ', purchaseCost: 100, paidBy: 'personal', boughtFrom: '  Alex  ' },
      { id: 'i2', sku: 'PHN-2' },
      '2026-08-25',
    );
    expect(item.item).toBe('Pixel 8');
    expect(item.boughtFrom).toBe('Alex');
    expect(item.imei).toBe('sn-001');
    expect(item.imeiNormalized).toBe('SN-001');
  });

  it('leaves imeiNormalized undefined when no IMEI/serial was entered', () => {
    const item = buildQuickPurchaseItem(
      { device: 'Unknown phone', purchaseCost: 50, paidBy: 'personal' },
      { id: 'i3', sku: 'PHN-3' },
      '2026-08-25',
    );
    expect(item.imei).toBe('');
    expect(item.imeiNormalized).toBeUndefined();
  });

  it('carries through the optional details (storage, color, battery health, target sale price) when given', () => {
    const item = buildQuickPurchaseItem(
      { device: 'iPhone 13', purchaseCost: 250, paidBy: 'store', storage: '128GB', color: 'Midnight', batteryHealth: '92%', targetSalePrice: 400 },
      { id: 'i5', sku: 'PHN-5' },
      '2026-08-25',
    );
    expect(item.storage).toBe('128GB');
    expect(item.color).toBe('Midnight');
    expect(item.batteryHealth).toBe('92%');
    expect(item.targetSalePrice).toBe(400);
  });

  it('leaves the optional details unset when not given — fillable later, same as a normal Add Item save', () => {
    const item = buildQuickPurchaseItem(
      { device: 'iPhone 13', purchaseCost: 250, paidBy: 'store' },
      { id: 'i6', sku: 'PHN-6' },
      '2026-08-25',
    );
    expect(item.storage).toBeUndefined();
    expect(item.color).toBeUndefined();
    expect(item.batteryHealth).toBeUndefined();
    expect(item.targetSalePrice).toBeUndefined();
  });

  it('never stores a zero/negative target sale price (treated as unset, matching purchaseCost\'s own floor)', () => {
    const item = buildQuickPurchaseItem(
      { device: 'X', purchaseCost: 250, paidBy: 'store', targetSalePrice: 0 },
      { id: 'i7', sku: 'PHN-7' },
      '2026-08-25',
    );
    expect(item.targetSalePrice).toBeUndefined();
  });

  it('never records a negative purchase cost', () => {
    const item = buildQuickPurchaseItem(
      { device: 'X', purchaseCost: -50, paidBy: 'personal' },
      { id: 'i4', sku: 'PHN-4' },
      '2026-08-25',
    );
    expect(item.purchaseCost).toBe(0);
  });
});

describe('quickPurchaseDrawerEffect', () => {
  it('a store-paid purchase logs a cash-out for the correct amount', () => {
    expect(quickPurchaseDrawerEffect(250, 'store')).toEqual({ kind: 'cashOut', amount: 250 });
    expect(quickPurchaseDrawerEffect(99.999, 'store')).toEqual({ kind: 'cashOut', amount: 100 }); // rounds to cents
  });
  it('a personally-paid purchase never touches the drawer', () => {
    expect(quickPurchaseDrawerEffect(250, 'personal')).toBeNull();
  });
  it('an unset paid-by never touches the drawer (defaults safe, not store cash)', () => {
    expect(quickPurchaseDrawerEffect(250, undefined)).toBeNull();
  });
  it('produces no entry for a zero, near-zero, or missing purchase cost even when store-paid', () => {
    expect(quickPurchaseDrawerEffect(0, 'store')).toBeNull();
    expect(quickPurchaseDrawerEffect(0.001, 'store')).toBeNull();
    expect(quickPurchaseDrawerEffect(undefined, 'store')).toBeNull();
  });
});

describe('quickPurchaseImeiError', () => {
  it('blank/undefined IMEI is never an error — optional at this stage', () => {
    expect(quickPurchaseImeiError('')).toBeNull();
    expect(quickPurchaseImeiError('   ')).toBeNull();
    expect(quickPurchaseImeiError(undefined)).toBeNull();
  });
  it('a valid 15-digit IMEI passes', () => {
    expect(quickPurchaseImeiError(VALID_IMEI)).toBeNull();
  });
  it('a plain serial (not 15 digits) is never checksum-validated', () => {
    expect(quickPurchaseImeiError('SN-ABC-123')).toBeNull();
  });
  it('a 15-digit value that fails the Luhn check is blocked', () => {
    expect(quickPurchaseImeiError(INVALID_IMEI)).toContain(INVALID_IMEI);
  });
});

describe('findInventoryMatchByIdentifier (duplicate detection, reused from domain/autoInventory.ts)', () => {
  it('flags an existing device with the same IMEI, even one added through the plain Add Item form (no imeiNormalized set)', () => {
    const existing = dev({ id: 'existing', imei: VALID_IMEI, imeiNormalized: undefined }); // never backfilled
    expect(findInventoryMatchByIdentifier(VALID_IMEI, [existing])?.id).toBe('existing');
  });
  it('flags an existing device by matching serial, case/whitespace-insensitively', () => {
    const existing = dev({ id: 'existing', imei: ' sn-42 ' });
    expect(findInventoryMatchByIdentifier('SN-42', [existing])?.id).toBe('existing');
  });
  it('does not flag when nothing matches', () => {
    const existing = dev({ id: 'existing', imei: VALID_IMEI });
    expect(findInventoryMatchByIdentifier('000000000000000', [existing])).toBeUndefined();
  });
  it('does not flag a blank identifier against anything', () => {
    const existing = dev({ id: 'existing', imei: '' });
    expect(findInventoryMatchByIdentifier('', [existing])).toBeUndefined();
  });
});
