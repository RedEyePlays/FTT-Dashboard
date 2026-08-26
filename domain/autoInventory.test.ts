import { describe, it, expect } from 'vitest';
import {
  normalizeSerial, luhnValid, normalizeIdentifier, identifierOf,
  findAutoInventoryMatch, decideAutoInventory, findDuplicateDevice, autoInventoryPurchaseDrawerEffect, isPrivateBatch,
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

describe('isPrivateBatch', () => {
  it('reads the new `private` flag', () => {
    expect(isPrivateBatch({ private: true })).toBe(true);
    expect(isPrivateBatch({ private: false })).toBe(false);
  });
  it('falls back to the legacy `autoInventory` flag when `private` is unset — a batch saved before this change (e.g. an old FTT Personal batch) still reads as private with no data migration', () => {
    expect(isPrivateBatch({ autoInventory: true })).toBe(true);
    expect(isPrivateBatch({ autoInventory: false })).toBe(false);
  });
  it('`private` wins when both are set', () => {
    expect(isPrivateBatch({ private: false, autoInventory: true })).toBe(false);
    expect(isPrivateBatch({ private: true, autoInventory: false })).toBe(true);
  });
  it('is false for an undefined batch or neither flag set', () => {
    expect(isPrivateBatch(undefined)).toBe(false);
    expect(isPrivateBatch({})).toBe(false);
  });
});

describe('decideAutoInventory', () => {
  // Non-private batch → no inventory side effects at all, regardless of the
  // per-device toggle (which the UI wouldn't even show, but the domain layer
  // must still refuse to act on it).
  it('skips entirely when the batch is not private, even if wantsAutoInventory is somehow true', () => {
    expect(decideAutoInventory({ private: false }, true, VALID_IMEI, [])).toEqual({ action: 'skip' });
    expect(decideAutoInventory(undefined, true, VALID_IMEI, [])).toEqual({ action: 'skip' });
  });

  // The core of the redesign: a private batch alone auto-adds nothing — the
  // per-device toggle must also be on. Same VALID_IMEI that produces 'create'
  // below when the toggle is on, produces 'skip' when it's off.
  it('skips a private batch\'s device ticket when the per-device toggle is off (default)', () => {
    expect(decideAutoInventory({ private: true }, false, VALID_IMEI, [])).toEqual({ action: 'skip' });
    expect(decideAutoInventory({ private: true }, undefined, VALID_IMEI, [])).toEqual({ action: 'skip' });
  });

  // A batch saved before this change (autoInventory: true, no `private`) is
  // still private via the fallback, but a NEW ticket under it still needs the
  // per-device toggle — the old "every device auto-added" behavior is gone.
  it('a legacy autoInventory:true batch is private, but still requires the per-device toggle', () => {
    expect(decideAutoInventory({ autoInventory: true }, false, VALID_IMEI, [])).toEqual({ action: 'skip' });
    expect(decideAutoInventory({ autoInventory: true }, true, VALID_IMEI, [])).toEqual({ action: 'create', normalized: VALID_IMEI });
  });

  // Blank IMEI and serial → warn, no inventory record.
  it('flags a missing identifier without touching inventory', () => {
    expect(decideAutoInventory({ private: true }, true, '', [])).toEqual({ action: 'noIdentifier' });
    expect(decideAutoInventory({ private: true }, true, '   ', [])).toEqual({ action: 'noIdentifier' });
    expect(decideAutoInventory({ private: true }, true, undefined, [])).toEqual({ action: 'noIdentifier' });
  });

  // IMEI fails Luhn → blocked.
  it('blocks a 15-digit IMEI that fails the Luhn check', () => {
    expect(decideAutoInventory({ private: true }, true, INVALID_IMEI, [])).toEqual({ action: 'invalidImei', digits: INVALID_IMEI });
  });

  // New device, valid IMEI, toggle on → create.
  it('creates a new record when nothing matches (Case A)', () => {
    expect(decideAutoInventory({ private: true }, true, VALID_IMEI, [])).toEqual({ action: 'create', normalized: VALID_IMEI });
  });

  // Device already in inventory by IMEI → attach, no duplicate.
  it('attaches to an existing record matched by IMEI (Case B)', () => {
    const existing = dev({ id: 'x', imeiNormalized: VALID_IMEI });
    expect(decideAutoInventory({ private: true }, true, VALID_IMEI, [existing])).toEqual({ action: 'attach', match: existing, normalized: VALID_IMEI });
  });

  // Device already in inventory by serial only → matches.
  it('attaches to an existing record matched by serial (Case B)', () => {
    const existing = dev({ id: 'y', imeiNormalized: 'SN-42' });
    expect(decideAutoInventory({ private: true }, true, 'sn-42', [existing])).toEqual({ action: 'attach', match: existing, normalized: 'SN-42' });
  });

  // Dashed IMEI matches a record stored without dashes.
  it('matches a dashed IMEI to an existing dash-free record (Case B)', () => {
    const dashed = `${VALID_IMEI.slice(0, 2)}-${VALID_IMEI.slice(2, 8)}-${VALID_IMEI.slice(8, 14)}-${VALID_IMEI.slice(14)}`;
    const existing = dev({ id: 'z', imeiNormalized: VALID_IMEI });
    expect(decideAutoInventory({ private: true }, true, dashed, [existing])).toEqual({ action: 'attach', match: existing, normalized: VALID_IMEI });
  });

  // A device already reserved for (or sold to) a customer must never be
  // silently repurposed by an unrelated repair ticket sharing its IMEI.
  it('refuses to attach to a reserved device — blockedClaimed, not attach', () => {
    const existing = dev({ id: 'r1', imeiNormalized: VALID_IMEI, deviceStatus: 'reserved' });
    expect(decideAutoInventory({ private: true }, true, VALID_IMEI, [existing])).toEqual({ action: 'blockedClaimed', match: existing, normalized: VALID_IMEI });
  });

  it('refuses to attach to an already-sold device — blockedClaimed, not attach', () => {
    const existing = dev({ id: 's1', imeiNormalized: VALID_IMEI, deviceStatus: 'sold' });
    expect(decideAutoInventory({ private: true }, true, VALID_IMEI, [existing])).toEqual({ action: 'blockedClaimed', match: existing, normalized: VALID_IMEI });
  });

  // Toggle off means NO inventory side effects at all, even with a device that
  // has a perfectly valid IMEI that would otherwise create a new record.
  it('toggle off produces zero inventory side effects even for a device with a valid IMEI', () => {
    const decision = decideAutoInventory({ private: true }, false, VALID_IMEI, []);
    expect(decision).toEqual({ action: 'skip' });
  });
});

describe('autoInventoryPurchaseDrawerEffect', () => {
  it('a store-paid device purchase reduces expected drawer cash by the entered amount', () => {
    expect(autoInventoryPurchaseDrawerEffect({ purchaseCost: 340, purchasePaidBy: 'store' })).toEqual({ kind: 'cashOut', amount: 340 });
  });

  it('a personally-paid device purchase never touches the drawer', () => {
    expect(autoInventoryPurchaseDrawerEffect({ purchaseCost: 340, purchasePaidBy: 'personal' })).toBeNull();
  });

  it('an unset payment source never touches the drawer (defaults safe, not store cash)', () => {
    expect(autoInventoryPurchaseDrawerEffect({ purchaseCost: 340 })).toBeNull();
  });

  it('produces no entry for a zero, near-zero, or missing purchase cost even when store-paid', () => {
    expect(autoInventoryPurchaseDrawerEffect({ purchaseCost: 0, purchasePaidBy: 'store' })).toBeNull();
    expect(autoInventoryPurchaseDrawerEffect({ purchaseCost: 0.001, purchasePaidBy: 'store' })).toBeNull();
    expect(autoInventoryPurchaseDrawerEffect({ purchasePaidBy: 'store' })).toBeNull();
  });
});

// --- Manual Add/Edit Item duplicate guard ------------------------------------
describe('findDuplicateDevice', () => {
  const dev = (id: string, imei: string, sku?: string): InventoryItem => ({
    id, kind: 'device', sku, date: '2026-01-01', item: 'Phone', imei,
    boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, notes: '',
  });

  it('finds an existing device with the same IMEI, ignoring spacing and case', () => {
    const inv = [dev('a', '35 3915 0987 6543 2', 'PHN-1')];
    expect(findDuplicateDevice('353915098765432', inv)?.sku).toBe('PHN-1');
    expect(findDuplicateDevice(' 353915098765432 ', inv)?.sku).toBe('PHN-1');
  });

  it('matches serials case-insensitively', () => {
    const inv = [dev('a', 'c02xk1abcdef', 'MAC-1')];
    expect(findDuplicateDevice('C02XK1ABCDEF', inv)?.sku).toBe('MAC-1');
  });

  it('returns nothing when the identifier is new', () => {
    expect(findDuplicateDevice('353915098765432', [dev('a', '111111111111111')])).toBeUndefined();
  });

  it('never treats a blank identifier as a duplicate, however many blanks exist', () => {
    const inv = [dev('a', ''), dev('b', ''), dev('c', '   ')];
    expect(findDuplicateDevice('', inv)).toBeUndefined();
    expect(findDuplicateDevice('   ', inv)).toBeUndefined();
  });

  it('excludes the row being edited — an item is not a duplicate of itself', () => {
    const inv = [dev('a', '353915098765432', 'PHN-1')];
    expect(findDuplicateDevice('353915098765432', inv, 'a')).toBeUndefined();
    // …but a DIFFERENT row with the same identifier still trips it.
    expect(findDuplicateDevice('353915098765432', [...inv, dev('b', '353915098765432', 'PHN-2')], 'b')?.sku).toBe('PHN-1');
  });

  it('matches rows that predate imeiNormalized (recomputed live, not index-only)', () => {
    const legacy = dev('a', '353915098765432', 'PHN-1');
    delete (legacy as Partial<InventoryItem>).imeiNormalized;
    expect(findDuplicateDevice('353915098765432', [legacy])?.sku).toBe('PHN-1');
  });

  it('ignores accessories — only serialized devices have an identity to collide', () => {
    const acc: InventoryItem = { ...dev('x', '353915098765432'), kind: 'accessory' };
    expect(findDuplicateDevice('353915098765432', [acc])).toBeUndefined();
  });
});
