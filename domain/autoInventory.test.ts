import { describe, it, expect } from 'vitest';
import {
  normalizeSerial, luhnValid, normalizeIdentifier, identifierOf,
  findAutoInventoryMatch, decideAutoInventory,
} from './autoInventory';
import { InventoryItem } from '../types';

// A real Luhn-valid 15-digit IMEI (well-known test IMEI) and a couple of
// deliberately-broken variants for the negative cases.
const VALID_IMEI = '490154203237518';
const INVALID_IMEI = '490154203237519'; // last digit flipped — fails Luhn

const dev = (p: Partial<InventoryItem>): InventoryItem => ({
  id: 'i1', kind: 'device', date: '2026-07-01', item: 'iPhone', imei: '', boughtFrom: '',
  purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, notes: '', ...p,
});

describe('luhnValid', () => {
  it('accepts a real Luhn-valid IMEI', () => {
    expect(luhnValid(VALID_IMEI)).toBe(true);
  });
  it('rejects a tampered digit', () => {
    expect(luhnValid(INVALID_IMEI)).toBe(false);
  });
  it('rejects non-digit input', () => {
    expect(luhnValid('49015420323751X')).toBe(false);
  });
});

describe('normalizeSerial', () => {
  it('trims, strips internal whitespace, and uppercases', () => {
    expect(normalizeSerial('  ab cd-12  ')).toBe('ABCD-12');
  });
  it('empty/undefined normalizes to empty string', () => {
    expect(normalizeSerial('')).toBe('');
    expect(normalizeSerial(undefined as any)).toBe('');
  });
});

describe('normalizeIdentifier', () => {
  it('a 15-digit value is treated as an IMEI and Luhn-checked', () => {
    expect(normalizeIdentifier(VALID_IMEI)).toEqual({ normalized: VALID_IMEI, looksLikeImei: true, imeiValid: true });
    expect(normalizeIdentifier(INVALID_IMEI)).toEqual({ normalized: INVALID_IMEI, looksLikeImei: true, imeiValid: false });
  });

  // Test case 4: IMEI entered with dashes/spaces still normalizes to the same
  // digits-only value as one stored without them.
  it('strips non-digit formatting (dashes, spaces) before checking length', () => {
    const dashed = `${VALID_IMEI.slice(0, 2)}-${VALID_IMEI.slice(2, 8)}-${VALID_IMEI.slice(8, 14)}-${VALID_IMEI.slice(14)}`;
    expect(normalizeIdentifier(dashed).normalized).toBe(VALID_IMEI);
    expect(normalizeIdentifier(dashed).looksLikeImei).toBe(true);
  });

  it('anything that is not exactly 15 digits is treated as a serial (no Luhn check)', () => {
    expect(normalizeIdentifier('abc123')).toEqual({ normalized: 'ABC123', looksLikeImei: false, imeiValid: true });
    expect(normalizeIdentifier('12345')).toEqual({ normalized: '12345', looksLikeImei: false, imeiValid: true });
  });

  it('blank input normalizes to an empty string', () => {
    expect(normalizeIdentifier('').normalized).toBe('');
  });
});

describe('identifierOf', () => {
  it('recomputes the same normalized value from an item\'s raw imei', () => {
    expect(identifierOf(dev({ imei: VALID_IMEI }))).toBe(VALID_IMEI);
    expect(identifierOf(dev({ imei: 'sn-001 ' }))).toBe('SN-001');
  });
});

describe('findAutoInventoryMatch', () => {
  it('matches a device by its stored imeiNormalized', () => {
    const inv = [dev({ id: 'a', imeiNormalized: VALID_IMEI }), dev({ id: 'b', imeiNormalized: 'SN-002' })];
    expect(findAutoInventoryMatch(VALID_IMEI, inv)?.id).toBe('a');
    expect(findAutoInventoryMatch('SN-002', inv)?.id).toBe('b');
    expect(findAutoInventoryMatch('SN-999', inv)).toBeUndefined();
  });
  it('ignores accessories and a blank normalized value', () => {
    const inv = [dev({ id: 'a', kind: 'accessory' as any, imeiNormalized: 'X' })];
    expect(findAutoInventoryMatch('X', inv)).toBeUndefined();
    expect(findAutoInventoryMatch('', inv)).toBeUndefined();
  });
});

describe('decideAutoInventory', () => {
  // Test case 9: batch not flagged → no inventory side effects at all.
  it('skips entirely when the batch is not auto_inventory', () => {
    expect(decideAutoInventory({ autoInventory: false }, VALID_IMEI, [])).toEqual({ action: 'skip' });
    expect(decideAutoInventory(undefined, VALID_IMEI, [])).toEqual({ action: 'skip' });
  });

  // Test case 6: blank IMEI and serial → warn, no inventory record.
  it('flags a missing identifier without touching inventory', () => {
    expect(decideAutoInventory({ autoInventory: true }, '', [])).toEqual({ action: 'noIdentifier' });
    expect(decideAutoInventory({ autoInventory: true }, '   ', [])).toEqual({ action: 'noIdentifier' });
    expect(decideAutoInventory({ autoInventory: true }, undefined, [])).toEqual({ action: 'noIdentifier' });
  });

  // Test case 7: IMEI fails Luhn → blocked.
  it('blocks a 15-digit IMEI that fails the Luhn check', () => {
    expect(decideAutoInventory({ autoInventory: true }, INVALID_IMEI, [])).toEqual({ action: 'invalidImei', digits: INVALID_IMEI });
  });

  // Test case 1: new device, valid IMEI → create.
  it('creates a new record when nothing matches (Case A)', () => {
    expect(decideAutoInventory({ autoInventory: true }, VALID_IMEI, [])).toEqual({ action: 'create', normalized: VALID_IMEI });
  });

  // Test case 2: device already in inventory by IMEI → attach, no duplicate.
  it('attaches to an existing record matched by IMEI (Case B)', () => {
    const existing = dev({ id: 'x', imeiNormalized: VALID_IMEI });
    expect(decideAutoInventory({ autoInventory: true }, VALID_IMEI, [existing])).toEqual({ action: 'attach', match: existing, normalized: VALID_IMEI });
  });

  // Test case 3: device already in inventory by serial only → matches.
  it('attaches to an existing record matched by serial (Case B)', () => {
    const existing = dev({ id: 'y', imeiNormalized: 'SN-42' });
    expect(decideAutoInventory({ autoInventory: true }, 'sn-42', [existing])).toEqual({ action: 'attach', match: existing, normalized: 'SN-42' });
  });

  // Test case 4: dashed IMEI matches a record stored without dashes.
  it('matches a dashed IMEI to an existing dash-free record (Case B)', () => {
    const dashed = `${VALID_IMEI.slice(0, 2)}-${VALID_IMEI.slice(2, 8)}-${VALID_IMEI.slice(8, 14)}-${VALID_IMEI.slice(14)}`;
    const existing = dev({ id: 'z', imeiNormalized: VALID_IMEI });
    expect(decideAutoInventory({ autoInventory: true }, dashed, [existing])).toEqual({ action: 'attach', match: existing, normalized: VALID_IMEI });
  });
});
