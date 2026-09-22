import { describe, it, expect } from 'vitest';
import { InventoryItem } from '../types';
import {
  normalizeForLookup, sameIdentifier, matchesItemIdentifier, identifierHits,
  matchesRepairIdentifier, locationOf, outsideFilterNote, noIdentifierMatchMessage,
} from './identifierSearch';

const IMEI = '351234567890123';

const dev = (o: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'FTT-0001', date: '2026-01-01', item: 'iPhone 13',
  imei: IMEI, boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '',
  salePrice: 0, deviceStatus: 'ready', ...o,
} as InventoryItem);

const acc = (o: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'a1', kind: 'accessory', sku: 'ACC-9', date: '2026-01-01', item: 'Case',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '',
  salePrice: 0, deviceStatus: 'ready', manufacturerBarcode: '0 12345 67890 5', quantity: 4, ...o,
} as InventoryItem);

describe('normalizeForLookup', () => {
  it('strips spaces, dashes and other separators and uppercases', () => {
    expect(normalizeForLookup('35 123456 789012 3')).toBe(IMEI);
    expect(normalizeForLookup('35-123456-789012-3')).toBe(IMEI);
    expect(normalizeForLookup('35/123456.789012_3')).toBe(IMEI);
    expect(normalizeForLookup('ftt-0142')).toBe('FTT0142');
  });

  it('treats blank and undefined as empty', () => {
    expect(normalizeForLookup(undefined)).toBe('');
    expect(normalizeForLookup('   ')).toBe('');
  });
});

describe('sameIdentifier', () => {
  it('matches across punctuation and case', () => {
    expect(sameIdentifier('35 123456 789012 3', IMEI)).toBe(true);
    expect(sameIdentifier('ftt-0142', 'FTT 0142')).toBe(true);
  });
  it('never matches a blank against anything, including another blank', () => {
    expect(sameIdentifier('', '')).toBe(false);
    expect(sameIdentifier('-', IMEI)).toBe(false);
  });
  it('is not a substring match', () => {
    expect(sameIdentifier('3512', IMEI)).toBe(false);
  });
});

describe('matchesItemIdentifier', () => {
  it('finds a device whose stored IMEI has spaces from a plain scan', () => {
    expect(matchesItemIdentifier(dev({ imei: '35 123456 789012 3' }), IMEI)).toBe(true);
  });
  it('finds a device whose stored IMEI has dashes from a plain scan', () => {
    expect(matchesItemIdentifier(dev({ imei: '35-123456-789012-3' }), IMEI)).toBe(true);
  });
  it('finds a device by SKU regardless of punctuation', () => {
    expect(matchesItemIdentifier(dev({ sku: 'FTT-0142' }), 'ftt0142')).toBe(true);
  });
  it('finds an accessory by its manufacturer barcode', () => {
    expect(matchesItemIdentifier(acc(), '012345678905')).toBe(true);
  });
  it('does not match a partial code', () => {
    expect(matchesItemIdentifier(dev(), '3512345')).toBe(false);
  });
});

describe('identifierHits', () => {
  const inv = [
    dev({ id: 'in-stock', imei: '35 123456 789012 3' }),
    dev({ id: 'sold', sku: 'FTT-0002', imei: '990000862471854', soldDate: '2026-02-02', deviceStatus: 'sold' }),
    acc({ id: 'case' }),
  ];

  it('finds a device wherever it is, ignoring page and status filter', () => {
    expect(identifierHits(inv, IMEI).map(i => i.id)).toEqual(['in-stock']);
    expect(identifierHits(inv, '990000862471854').map(i => i.id)).toEqual(['sold']);
  });

  it('finds an accessory from a device-page query', () => {
    expect(identifierHits(inv, '0-12345-67890-5').map(i => i.id)).toEqual(['case']);
  });

  it('returns nothing for a blank or unmatched query', () => {
    expect(identifierHits(inv, '')).toEqual([]);
    expect(identifierHits(inv, '000000000000000')).toEqual([]);
  });

  it('a NAME search is not an identifier hit, so it keeps respecting the page and filters', () => {
    // Every row here is called "iPhone 13" / "Case"; none of them comes back,
    // because only an exact identifier match is allowed to escape the filters.
    expect(identifierHits(inv, 'iphone')).toEqual([]);
    expect(identifierHits(inv, 'case')).toEqual([]);
  });
});

describe('locationOf / outsideFilterNote', () => {
  it('names where a sold device actually is', () => {
    const sold = dev({ soldDate: '2026-02-02', deviceStatus: 'sold' });
    expect(locationOf(sold)).toBe('sold');
    expect(outsideFilterNote(sold, false)).toBe('Found in Sold — outside your current filter.');
  });
  it('names the accessories page', () => {
    expect(outsideFilterNote(acc(), false)).toBe('Found in Accessories — outside your current filter.');
  });
  it('says nothing when the item is already on screen', () => {
    expect(outsideFilterNote(dev(), true)).toBeNull();
  });
});

describe('matchesRepairIdentifier', () => {
  const r = { id: 'r1', repairNumber: 'RPR-0042', imei: '35 123456 789012 3' };
  it('matches the ticket number and the device IMEI across punctuation', () => {
    expect(matchesRepairIdentifier(r, 'rpr0042')).toBe(true);
    expect(matchesRepairIdentifier(r, IMEI)).toBe(true);
  });
  it('does not match an unrelated code', () => {
    expect(matchesRepairIdentifier(r, '999')).toBe(false);
  });
});

describe('noIdentifierMatchMessage', () => {
  it('names the IMEI it could not find, truncated', () => {
    expect(noIdentifierMatchMessage(IMEI)).toContain('No device with IMEI 3512…');
  });
  it('quotes a non-numeric code back instead of calling it an IMEI', () => {
    const msg = noIdentifierMatchMessage('FTT-0142XYZ');
    expect(msg).toContain('No item with the code');
    expect(msg).not.toContain('IMEI');
  });
  it('shows a short code in full', () => {
    expect(noIdentifierMatchMessage('12345')).toContain('12345');
  });
});
