import { describe, it, expect } from 'vitest';
import { InventoryItem } from '../types';
import {
  buildSearchable, queryWords, wordMatches, matchesWords, matchesItemQuery,
  buildSearchIndex, wordScore,
} from './itemSearch';
import { searchCheckoutInventory } from './pos';

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'PHN-000001', date: '2026-08-01', item: '',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '',
  salePrice: 0, deviceStatus: 'ready', notes: '',
  brand: 'Apple', model: 'iPhone 16', storage: '128 GB', color: 'White',
  carrier: 'Rogers', condition: 'Good', batteryHealth: '92%', deviceType: 'Phone', ...p,
});

const accessory = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'a1', kind: 'accessory', sku: 'ACC-000001', date: '2026-08-01', item: 'Braided Cable',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '',
  salePrice: 0, deviceStatus: 'ready', notes: '', category: 'Chargers',
  manufacturerBarcode: '012345678905', quantity: 5, ...p,
});

const m = (i: InventoryItem, q: string) => matchesItemQuery(i, q);

describe('the four words live in four different fields', () => {
  it('"iphone 16 128gb white" finds it — model, storage and colour are separate fields', () => {
    expect(m(device(), 'iphone 16 128gb white')).toBe(true);
  });

  it('word order does not matter', () => {
    expect(m(device(), 'white 128 iphone 16')).toBe(true);
    expect(m(device(), '128gb white apple')).toBe(true);
  });

  it('A MISSING WORD EXCLUDES THE DEVICE — adding a word narrows, never widens', () => {
    expect(m(device(), 'iphone 16 128gb black')).toBe(false);
    expect(m(device(), 'iphone 16 256gb white')).toBe(false);
    expect(m(device(), 'samsung')).toBe(false);
  });

  it('a blank query matches everything', () => {
    expect(m(device(), '')).toBe(true);
    expect(m(device(), '   ')).toBe(true);
    expect(queryWords('  ')).toEqual([]);
  });
});

describe('spacing and the optional "gb"', () => {
  it('"128gb", "128 gb" and "128GB" all match a stored "128 GB"', () => {
    expect(m(device({ storage: '128 GB' }), '128gb')).toBe(true);
    expect(m(device({ storage: '128 GB' }), '128 gb')).toBe(true);
    expect(m(device({ storage: '128 GB' }), '128GB')).toBe(true);
  });

  it('...and the same three match a stored "128GB"', () => {
    expect(m(device({ storage: '128GB' }), '128gb')).toBe(true);
    expect(m(device({ storage: '128GB' }), '128 gb')).toBe(true);
    expect(m(device({ storage: '128GB' }), '128 GB')).toBe(true);
  });

  it('a bare "128" matches 128 GB', () => {
    expect(m(device({ storage: '128GB' }), '128')).toBe(true);
    expect(m(device({ storage: '128 GB' }), '128')).toBe(true);
  });

  it('does NOT fuzzy-match — 128 is not 256, and a typo finds nothing', () => {
    expect(m(device({ storage: '128 GB' }), '256')).toBe(false);
    expect(m(device(), 'iphnoe')).toBe(false);
  });

  it('is case-insensitive throughout', () => {
    expect(m(device(), 'APPLE IPHONE WHITE')).toBe(true);
  });
});

describe('fields that were never searched at all before', () => {
  it('finds a device by carrier, condition, battery health and device type', () => {
    expect(m(device(), 'rogers')).toBe(true);
    expect(m(device(), 'good')).toBe(true);
    expect(m(device(), '92%')).toBe(true);
    expect(m(device(), 'phone')).toBe(true);
  });

  it('finds a device by its notes and by who it was bought from', () => {
    const d = device({ notes: 'Back glass cracked, priced down', boughtFrom: 'Marcus Webb' });
    expect(m(d, 'cracked')).toBe(true);
    expect(m(d, 'marcus')).toBe(true);
    // ...and combined with an attribute.
    expect(m(d, 'marcus iphone white')).toBe(true);
  });

  it('finds an accessory by its category', () => {
    expect(m(accessory(), 'chargers')).toBe(true);
    expect(m(accessory(), 'braided chargers')).toBe(true);
    expect(m(accessory(), 'screens')).toBe(false);
  });

  it('an accessory is not searched on device-only fields', () => {
    // An accessory has no storage/colour/carrier, so those words simply miss.
    expect(m(accessory({ color: 'White' } as Partial<InventoryItem>), 'white')).toBe(false);
  });
});

describe('identifiers still work through the word matcher', () => {
  it('finds a device by SKU or IMEI as one of the words', () => {
    const d = device({ imei: '351234567890123' });
    expect(m(d, 'phn-000001')).toBe(true);
    expect(m(d, '351234567890123')).toBe(true);
    // ...and a punctuated stored IMEI, via the space-squashed form.
    expect(m(device({ imei: '35 123456 789012 3' }), '351234567890123')).toBe(true);
  });
});

describe('the display name is searchable', () => {
  it('matches words that only exist in the computed name', () => {
    const d = device({ brand: '', model: '', item: '' });
    expect(matchesItemQuery(d, 'refurbished special', 'Refurbished Special')).toBe(true);
  });
});

describe('the memoised index', () => {
  it('builds one entry per item and gives the same answer as the direct matcher', () => {
    const items = [device(), accessory()];
    const index = buildSearchIndex(items, () => '');
    expect(index.size).toBe(2);
    const words = queryWords('iphone white');
    expect(matchesWords(index.get('d1')!, words)).toBe(true);
    expect(matchesWords(index.get('a1')!, words)).toBe(false);
  });

  it('keeps both a plain and a space-squashed form', () => {
    const s = buildSearchable(device({ storage: '128 GB' }));
    expect(s.plain).toContain('128 gb');
    expect(s.squashed).toContain('128gb');
    expect(wordMatches('128gb', s)).toBe(true);
  });
});

describe('scoring, for ranked lists', () => {
  it('scores an exact name higher than a scattered word match, and a miss at zero', () => {
    const s = buildSearchable(device(), 'Apple iPhone 16');
    expect(wordScore(s, queryWords('apple iphone 16'), 'Apple iPhone 16')).toBe(900);
    expect(wordScore(s, queryWords('white rogers'), 'Apple iPhone 16')).toBe(350);
    expect(wordScore(s, queryWords('samsung'), 'Apple iPhone 16')).toBe(0);
    expect(wordScore(s, [], 'Apple iPhone 16')).toBe(0);
  });
});

describe('the POS product search uses the same matcher', () => {
  it('finds the phone at the till from a multi-word description', () => {
    const inv = [device({ id: 'sellable' }), device({ id: 'other', model: 'Pixel 7', color: 'Black', storage: '256 GB' })];
    expect(searchCheckoutInventory(inv, 'iphone 16 128gb white').map(i => i.id)).toEqual(['sellable']);
  });

  it('still excludes sold devices and out-of-stock accessories', () => {
    const inv = [
      device({ id: 'sold', soldDate: '2026-09-01' }),
      accessory({ id: 'empty', quantity: 0, item: 'iPhone Case' }),
    ];
    expect(searchCheckoutInventory(inv, 'iphone')).toEqual([]);
  });
});
