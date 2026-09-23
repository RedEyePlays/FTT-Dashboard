import { describe, it, expect } from 'vitest';
import { InventoryItem, PcBuild } from '../types';
import {
  BUILD_FACT_KEYS, DEVICE_FACT_KEYS, FORBIDDEN_FACT_FIELDS, PART_FACT_KEYS, PERFORMANCE_FACT_KEYS,
  DEFAULT_LISTING_OPTIONS, NEW_CLAIM_WORDS,
  buildFacts, checkListingOutput, deviceFacts, numbersIn, plainCondition,
} from './listingCopy';

/**
 * The model never sees a record — it sees these facts. So this file's job is
 * to prove that what leaves the building is an allow-list, and that what comes
 * back is checked before anybody sees it.
 */

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'dev-1', kind: 'device', sku: 'PHN-000123', date: '2026-09-01',
  item: 'iPhone 13 Pro', brand: 'Apple', model: 'iPhone 13 Pro',
  storage: '256GB', color: 'Graphite', condition: 'Good', batteryHealth: '92%',
  imei: '356789012340005',
  boughtFrom: 'Dana Wu', purchaseSource: 'Marketplace',
  purchaseCost: 540, repairCost: 60, targetSalePrice: 850,
  soldDate: '', soldTo: '', salePrice: 0, notes: 'seller was late', ...p,
});

const build = (p: Partial<PcBuild> = {}): PcBuild => ({
  id: 'b1', name: 'REAPER Gaming PC', kind: 'shelf', status: 'ready',
  targetPrice: 1800, comparisonStore: 'Canada Computers',
  notes: 'white cables', customerName: 'Dana Wu', shareToken: 'kadamuze',
  createdBy: 'u1', createdByEmail: 'u@shop.test', createdAt: 1, updatedAt: 1,
  labour: [{ id: 'l1', userId: 'u1', userEmail: 'u@shop.test', hours: 4, rate: 17, date: '2026-09-01', loggedAt: 1 }],
  parts: [
    { id: 'p1', category: 'GPU', name: 'RTX 5060 Ti', cost: 503, condition: 'used', source: 'facebook',
      serial: 'GPU-SECRET', retailPrice: 900, altStorePrice: 940 },
    { id: 'p2', category: 'CPU', name: 'Ryzen 9 5900X', cost: 300, condition: 'new', source: 'retail',
      retailPrice: 430, altStorePrice: 450 },
  ],
  ...p,
});

const opts = (over = {}) => ({ ...DEFAULT_LISTING_OPTIONS, ...over });

/** Walk every key of a produced object against its allow-list. */
const assertOnlyAllowedKeys = (facts: Record<string, unknown>, allowed: readonly string[]) => {
  for (const key of Object.keys(facts)) {
    expect({ key, allowed: allowed.includes(key) }).toEqual({ key, allowed: true });
  }
};

describe('device facts', () => {
  const facts = () => deviceFacts(device(), { warrantyDays: 90, options: opts() });

  it('carry ONLY allow-listed keys', () => {
    assertOnlyAllowedKeys(facts() as unknown as Record<string, unknown>, DEVICE_FACT_KEYS);
  });

  it('carry NOT ONE forbidden field', () => {
    const f = facts() as unknown as Record<string, unknown>;
    for (const field of FORBIDDEN_FACT_FIELDS) {
      expect({ field, present: field in f }).toEqual({ field, present: false });
    }
  });

  it('say what the advert needs: model, storage, colour, condition, battery, warranty', () => {
    expect(facts()).toMatchObject({
      kind: 'device', brand: 'Apple', model: 'iPhone 13 Pro', storage: '256GB',
      colour: 'Graphite', condition: 'Good — light scratches', batteryHealth: '92%',
      warrantyDays: 90, hasPhotos: false,
    });
  });

  it('use the SAME plain condition wording the counter kiosk uses', () => {
    expect(plainCondition('Good')).toBe('Good — light scratches');
    expect(plainCondition('Like New')).toBe('Like new — no marks');
    // A grade nobody set says nothing at all rather than guessing at one.
    expect(plainCondition('B2')).toBeUndefined();
    expect(deviceFacts(device({ condition: undefined }), { warrantyDays: 90, options: opts() }).condition)
      .toBeUndefined();
  });

  it('leave the price OUT by default — the platform has its own price field', () => {
    expect(facts().price).toBeUndefined();
    expect(deviceFacts(device(), { warrantyDays: 90, options: opts({ includePrice: true }) }).price).toBe(850);
  });

  it('say whether there are photos, never the photos', () => {
    const withPhotos = deviceFacts(
      device({ photos: [{ id: 'p', url: 'https://x/y.jpg', kind: 'real', addedBy: 'u', addedAt: 1 }] }),
      { warrantyDays: 90, options: opts() },
    );
    expect(withPhotos.hasPhotos).toBe(true);
    expect((withPhotos as unknown as Record<string, unknown>).photos).toBeUndefined();
  });

  it('carry the share line when the item has a code', () => {
    const f = deviceFacts(device(), { warrantyDays: 90, options: opts(), shareCode: 'kadamuze' });
    expect(f.shareLine).toContain('flipthat.tech/b/kadamuze');
  });

  it('fall back to the item name when there is no model', () => {
    const f = deviceFacts(device({ model: undefined, item: 'Galaxy S24' }), { warrantyDays: 90, options: opts() });
    expect(f.model).toBe('Galaxy S24');
  });
});

describe('build facts', () => {
  const facts = (over = {}, o = {}) => buildFacts(build(over), { warrantyDays: 90, options: opts(o) });

  it('carry ONLY allow-listed keys, at every level', () => {
    const f = facts();
    assertOnlyAllowedKeys(f as unknown as Record<string, unknown>, BUILD_FACT_KEYS);
    for (const part of f.parts) assertOnlyAllowedKeys(part as unknown as Record<string, unknown>, PART_FACT_KEYS);
  });

  it('carry NOT ONE forbidden field, at either level', () => {
    const f = facts() as unknown as Record<string, unknown>;
    for (const field of FORBIDDEN_FACT_FIELDS) {
      expect({ field, present: field in f }).toEqual({ field, present: false });
      for (const part of facts().parts) {
        expect({ field, part: field in (part as unknown as Record<string, unknown>) }).toEqual({ field, part: false });
      }
    }
  });

  it('list every part with its exact recorded model', () => {
    expect(facts().parts).toEqual([
      { category: 'GPU', name: 'RTX 5060 Ti' },
      { category: 'CPU', name: 'Ryzen 9 5900X' },
    ]);
  });

  it('mark used parts ONLY when asked, and never mark a new one', () => {
    const marked = facts({}, { markUsedParts: true });
    expect(marked.parts[0]).toEqual({ category: 'GPU', name: 'RTX 5060 Ti', condition: 'Used' });
    // A badge on the used part and none on the new one is right; a badge
    // saying "New" beside it would be the implied-new claim backwards.
    expect(marked.parts[1].condition).toBeUndefined();
  });

  it('say whether EVERY part is new — the only thing that unlocks the word', () => {
    expect(facts().allPartsNew).toBe(false);
    const allNew = build({ parts: build().parts.map(p => ({ ...p, condition: 'new' as const })) });
    expect(buildFacts(allNew, { warrantyDays: 90, options: opts() }).allPartsNew).toBe(true);
    // An empty build is not "all new" — it is nothing.
    expect(buildFacts(build({ parts: [] }), { warrantyDays: 90, options: opts() }).allPartsNew).toBe(false);
  });

  it('carry the comparison only when it is complete', () => {
    expect(facts()).toMatchObject({ comparisonTotal: 1390, comparisonStore: 'Canada Computers' });
    const partial = build({ parts: [{ ...build().parts[0], retailPrice: undefined, altStorePrice: undefined }] });
    expect(buildFacts(partial, { warrantyDays: 90, options: opts() }).comparisonTotal).toBeUndefined();
  });

  it('carry no performance rows unless the caller has some', () => {
    expect(facts().performance).toEqual([]);
    const withPerf = buildFacts(build(), {
      warrantyDays: 90, options: opts(),
      performance: [{ game: 'Fortnite', resolution: '1080p', preset: 'High', fpsLow: 120, fpsHigh: 160, measured: false }],
    });
    expect(withPerf.performance).toHaveLength(1);
    for (const row of withPerf.performance) {
      assertOnlyAllowedKeys(row as unknown as Record<string, unknown>, PERFORMANCE_FACT_KEYS);
    }
  });
});

describe('numbersIn', () => {
  it('finds every number, ignoring thousands separators', () => {
    expect(numbersIn('$1,800 for 32GB and 1TB')).toEqual(['1800', '32', '1']);
  });
});

describe('checkListingOutput', () => {
  const facts = buildFacts(build(), { warrantyDays: 90, options: opts() });
  const ok = (description: string, title = 'REAPER Gaming PC — RTX 5060 Ti / Ryzen 9 5900X') =>
    checkListingOutput(facts, { title, description });

  it('passes a listing built only from the facts it was given', () => {
    expect(ok('RTX 5060 Ti, Ryzen 9 5900X. 90-day warranty from the shop.').ok).toBe(true);
  });

  it('REJECTS a number nobody gave it — an invented storage size', () => {
    const r = ok('Comes with 2TB of storage and 64GB of RAM.');
    expect(r.ok).toBe(false);
    expect(r.invented).toContain('64');
  });

  it('rejects an invented battery percentage on a device', () => {
    const d = deviceFacts(device({ batteryHealth: undefined }), { warrantyDays: 90, options: opts() });
    const r = checkListingOutput(d, { title: 'iPhone 13 Pro', description: 'Battery health 98%.' });
    expect(r.ok).toBe(false);
    expect(r.invented).toContain('98');
  });

  it('allows a number that IS in the facts, wherever it appears', () => {
    const d = deviceFacts(device(), { warrantyDays: 90, options: opts() });
    expect(checkListingOutput(d, {
      title: 'iPhone 13 Pro 256GB — Graphite',
      description: 'Battery health 92%. 90-day warranty from the shop.',
    }).ok).toBe(true);
  });

  it('does not trip over list numbering or a year', () => {
    expect(ok('1. RTX 5060 Ti\n2. Ryzen 9 5900X\nBuilt in 2026.').ok).toBe(true);
  });

  it('REJECTS "brand new" on a machine with a used part', () => {
    const r = ok('Brand new gaming PC, ready to go.');
    expect(r.ok).toBe(false);
    expect(r.impliedNew).toBe('brand new');
  });

  it('rejects "sealed" and "unopened" the same way', () => {
    expect(ok('Sealed and ready.').impliedNew).toBe('sealed');
    expect(ok('Unopened, straight from the box.').impliedNew).toBe('unopened');
  });

  it('allows those words when EVERY part really is new', () => {
    const allNew = buildFacts(
      build({ parts: build().parts.map(p => ({ ...p, condition: 'new' as const })) }),
      { warrantyDays: 90, options: opts() },
    );
    expect(checkListingOutput(allNew, { title: 'x', description: 'Brand new, sealed parts throughout.' }).ok).toBe(true);
  });

  it('does not fire on a word that merely contains one', () => {
    // "Newegg" and "renewed" are not claims that the goods are new.
    expect(ok('Priced against Newegg. Fully renewed thermal paste.').impliedNew).toBeUndefined();
  });

  it('allows the neutral framing on a machine with used parts', () => {
    expect(ok('Custom built and tested in-shop.').ok).toBe(true);
  });

  it('checks the TITLE as well as the description', () => {
    const r = ok('Solid machine.', 'Brand new REAPER Gaming PC');
    expect(r.ok).toBe(false);
  });

  for (const word of NEW_CLAIM_WORDS) {
    it(`treats "${word}" as a claim that the goods are new`, () => {
      expect(ok(`This is ${word} honestly.`).ok).toBe(false);
    });
  }
});
