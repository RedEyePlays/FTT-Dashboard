import { describe, it, expect } from 'vitest';
import { BuildPart, PcBuild } from '../types';
import {
  CARD_CATEGORIES, CARD_ORIENTATIONS, PRIVATE_PART_FIELDS, canHaveDisplayCard,
  cardOrientation, customerPart, customerParts, customerSheet, displayCard, sheetPhoto, truncateName,
} from './buildSheet';

// Costs are deliberately odd numbers that cannot appear inside any public
// figure (a quote of 1500 contains "500"), so the leak check below can be a
// blunt substring search and still mean something.
const part = (p: Partial<BuildPart> = {}): BuildPart => ({
  id: 'p1', category: 'CPU', name: 'Ryzen 7 7800X3D', cost: 407,
  condition: 'new', source: 'facebook', sourceUrl: 'https://facebook.com/marketplace/item/123',
  serial: 'CPU-SECRET-9911', ...p,
});

const FULL_PARTS: BuildPart[] = [
  part({ id: 'p1', category: 'CPU', name: 'Ryzen 7 7800X3D', cost: 407, retailPrice: 480, retailCheckedAt: '2026-03-01' }),
  part({ id: 'p2', category: 'GPU', name: 'RTX 4070 Windforce OC 12GB', cost: 503, condition: 'used', retailPrice: 700, retailCheckedAt: '2026-03-01', mfrWarrantyUntil: '2027-01-01', pcpartpickerUrl: 'https://ca.pcpartpicker.com/product/abc' }),
  part({ id: 'p3', category: 'RAM', name: '32GB DDR5 6000', cost: 91, retailPrice: 120, retailCheckedAt: '2026-03-01' }),
  part({ id: 'p4', category: 'Storage', name: '1TB NVMe', cost: 61, retailPrice: 120, retailCheckedAt: '2026-03-01' }),
];

const build = (p: Partial<PcBuild> = {}): PcBuild => ({
  id: 'b1', name: 'Starter Gaming PC', kind: 'shelf', status: 'ready',
  parts: FULL_PARTS, labour: [{ id: 'l1', userId: 'u1', userEmail: 'sam@shop.test', hours: 4, date: '2026-03-01', rate: 17, loggedAt: 1 }],
  targetPrice: 1200, createdBy: 'u1', createdByEmail: 'sam@shop.test',
  createdAt: 1, updatedAt: 1, ...p,
});

/**
 * The one rule both printed pieces exist under.
 *
 * STRUCTURAL, not a substring search. A part name like "RTX 4070" contains the
 * digits of a $407 cost, so scanning the serialized JSON for numbers produces
 * false alarms and, worse, tempts you into loosening the check until it stops
 * meaning anything. Instead: walk the value, assert no KEY is a private one,
 * assert no NUMBER equals a private figure, and assert no STRING carries a
 * source, a listing link or a serial.
 */
const PRIVATE_KEYS = [
  'cost', 'source', 'sourceUrl', 'serial', 'hours', 'rate', 'labour', 'labourCost',
  'profit', 'margin', 'marginPercent', 'partsCost', 'totalCost', 'createdBy', 'createdByEmail',
];
const PRIVATE_MARKERS = ['facebook', 'marketplace', 'SECRET', 'shop.test'];

const assertNothingPrivate = (value: unknown, privateNumbers: number[] = []) => {
  const walk = (node: unknown, path: string): void => {
    if (node === null || node === undefined) return;
    if (typeof node === 'number') {
      expect({ path, leaked: privateNumbers.includes(node) }).toEqual({ path, leaked: false });
      return;
    }
    if (typeof node === 'string') {
      for (const marker of PRIVATE_MARKERS) {
        expect({ path, marker, leaked: node.toLowerCase().includes(marker.toLowerCase()) })
          .toEqual({ path, marker, leaked: false });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}[${i}]`));
      return;
    }
    if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        expect({ path: `${path}.${key}`, privateKey: PRIVATE_KEYS.includes(key) })
          .toEqual({ path: `${path}.${key}`, privateKey: false });
        walk(child, `${path}.${key}`);
      }
    }
  };
  walk(value, '$');
};

/** Every figure a customer must never see, for the fixture above. */
const PRIVATE_FIGURES = [407, 503, 91, 61, 1062, 68, 17, 4];

describe('a part, stripped to what a customer may see', () => {
  it('keeps only the public fields', () => {
    const p = customerPart(FULL_PARTS[1]);
    expect(Object.keys(p).sort()).toEqual(
      ['category', 'condition', 'mfrWarrantyUntil', 'name', 'pcpartpickerUrl', 'retail'],
    );
    expect(p.name).toBe('RTX 4070 Windforce OC 12GB');
    expect(p.condition).toBe('Used');
    expect(p.retail).toBe('$700.00 (as of 2026-03-01)');
    expect(p.mfrWarrantyUntil).toBe('2027-01-01');
  });

  it('DROPS cost, source, the listing link and the serial — as data, not as markup', () => {
    const p = customerPart(part()) as unknown as Record<string, unknown>;
    for (const field of PRIVATE_PART_FIELDS) {
      expect({ field, present: field in p }).toEqual({ field, present: false });
    }
    assertNothingPrivate(customerParts(FULL_PARTS), PRIVATE_FIGURES);
  });

  it('shows a retail price WITH its date, always', () => {
    expect(customerPart(part({ retailPrice: 100, retailCheckedAt: '2026-03-01' })).retail)
      .toBe('$100.00 (as of 2026-03-01)');
    expect(customerPart(part({ retailPrice: undefined })).retail).toBeNull();
  });
});

describe('the take-home spec sheet', () => {
  const sheet = customerSheet({ build: build(), warrantyDays: 90 });

  it('NEVER contains a cost, a source, a seller, labour or profit', () => {
    assertNothingPrivate(sheet, PRIVATE_FIGURES);
  });

  it('carries the name, the specs, every part and the shop warranty', () => {
    expect(sheet.name).toBe('Starter Gaming PC');
    expect(sheet.specs).toBe('Ryzen 7 7800X3D / RTX 4070 Windforce OC 12GB / 32GB DDR5 6000 / 1TB NVMe');
    expect(sheet.parts).toHaveLength(4);
    expect(sheet.warrantyLine).toBe('90-day warranty from FlipThatTech');
  });

  it('says "sold as-is" rather than inventing a warranty when there is none', () => {
    expect(customerSheet({ build: build(), warrantyDays: 0 }).warrantyLine).toBe('Sold as-is');
  });

  it('shows the value line on a shelf build', () => {
    expect(sheet.valueLine).toBe('Parts at retail $1,420.00 — yours for $1,200.00');
    expect(sheet.order).toBeNull();
  });

  it('shows the quote, deposit and balance on a customer order instead', () => {
    const order = customerSheet({
      build: build({ kind: 'customer', quotePrice: 1500, targetPrice: undefined }),
      warrantyDays: 90, deposit: 375,
    });
    expect(order.order).toEqual({ quote: 1500, deposit: 375, balance: 1125 });
    assertNothingPrivate(order, PRIVATE_FIGURES);
  });

  it('omits the value line when a single part has no retail price', () => {
    const partial = build({ parts: [...FULL_PARTS, part({ id: 'p5', category: 'PSU', name: '750W Gold', retailPrice: undefined })] });
    expect(customerSheet({ build: partial, warrantyDays: 90 }).valueLine).toBeNull();
  });
});

describe('the shelf display card', () => {
  const card = displayCard({
    build: build(), warrantyDays: 90, shopName: 'FlipThatTech', shopPhone: '416-555-0100',
  });

  it('NEVER contains a cost, a source, a seller, labour, profit or margin', () => {
    assertNothingPrivate(card, PRIVATE_FIGURES);
  });

  it('leads with the name, the price and the saving', () => {
    expect(card.name).toBe('Starter Gaming PC');
    expect(card.price).toBe(1200);
    expect(card.priceLabel).toBe('$1,200.00');
    expect(card.comparison).toEqual({ retailTotal: '$1,420.00', saving: '$220.00' });
    expect(card.warrantyBadge).toBe('90-day warranty');
  });

  it('shows the headline specs in reading order, skipping categories with no part', () => {
    expect(CARD_CATEGORIES).toEqual(['CPU', 'GPU', 'RAM', 'Storage', 'PSU', 'Case']);
    // This build has no PSU or Case, so they are simply absent.
    expect(card.specs.map(s => s.category)).toEqual(['CPU', 'GPU', 'RAM', 'Storage']);
  });

  it('badges a condition only where it says something', () => {
    const gpu = card.specs.find(s => s.category === 'GPU')!;
    const cpu = card.specs.find(s => s.category === 'CPU')!;
    expect(gpu.condition).toBe('Used — tested');
    // "New" on every line is noise.
    expect(cpu.condition).toBeNull();
  });

  it('honours the preview toggles', () => {
    const plain = displayCard({
      build: build(), warrantyDays: 90, shopName: 'F', shopPhone: 'p',
      showComparison: false, showConditions: false,
    });
    expect(plain.comparison).toBeNull();
    expect(plain.specs.every(s => s.condition === null)).toBe(true);
  });

  it('omits the comparison when a part has no retail price, rather than misleading', () => {
    const partial = build({ parts: [...FULL_PARTS, part({ id: 'p5', category: 'PSU', name: '750W', retailPrice: undefined })] });
    expect(displayCard({ build: partial, warrantyDays: 90, shopName: 'F', shopPhone: 'p' }).comparison).toBeNull();
  });

  it('takes the device\'s price once one exists', () => {
    const priced = displayCard({
      build: build(), price: 1099, warrantyDays: 90, shopName: 'F', shopPhone: 'p',
    });
    expect(priced.priceLabel).toBe('$1,099.00');
    expect(priced.comparison?.saving).toBe('$321.00');
  });

  it('says "Ask us" rather than showing nothing when no price is set', () => {
    const unpriced = displayCard({
      build: build({ targetPrice: undefined }), warrantyDays: 90, shopName: 'F', shopPhone: 'p',
    });
    expect(unpriced.price).toBeNull();
    expect(unpriced.priceLabel).toBe('Ask us');
  });

  it('A CUSTOMER ORDER GETS NO CARD', () => {
    expect(canHaveDisplayCard({ kind: 'shelf' })).toBe(true);
    expect(canHaveDisplayCard({ kind: 'customer' })).toBe(false);
  });
});

describe('long part names truncate gracefully', () => {
  const LONG = 'ASUS TUF Gaming GeForce RTX 4070 Ti SUPER OC Edition 16GB GDDR6X';

  it('cuts at a word boundary, not mid-word', () => {
    const out = truncateName(LONG);
    expect(out.length).toBeLessThanOrEqual(43);
    expect(out.endsWith('…')).toBe(true);
    const visible = out.replace('…', '').trim();
    // A prefix of the original, ending on a COMPLETE word — the next character
    // in the original is a space, not more of the same word.
    expect(LONG.startsWith(visible)).toBe(true);
    expect(LONG[visible.length]).toBe(' ');
  });

  it('leaves a name that fits completely alone', () => {
    expect(truncateName('RTX 4070')).toBe('RTX 4070');
    expect(truncateName('')).toBe('');
  });

  it('still cuts a single unbroken token', () => {
    const blob = 'A'.repeat(80);
    expect(truncateName(blob).length).toBeLessThanOrEqual(43);
  });

  it('a card built from long names carries them, ready to truncate at render', () => {
    const longBuild = build({ parts: [part({ category: 'GPU', name: LONG, retailPrice: undefined })] });
    const card = displayCard({ build: longBuild, warrantyDays: 90, shopName: 'F', shopPhone: 'p' });
    expect(card.specs[0].name).toBe(LONG);
    expect(truncateName(card.specs[0].name).length).toBeLessThanOrEqual(43);
  });
});

/**
 * "BUILD IT YOURSELF AT CANADA COMPUTERS: $1,330."
 *
 * The argument the shop actually makes. It is a number a customer can check,
 * so it must never be a partial total wearing a complete label.
 */
describe('the DIY comparison on the card', () => {
  const priced = (over: Partial<PcBuild> = {}) => build({
    targetPrice: 1200, comparisonStore: 'Canada Computers',
    parts: [
      part({ id: 'p1', category: 'CPU', name: 'Ryzen 7', cost: 407, retailPrice: 480, altStorePrice: 510 }),
      // Retail above the asking price, so the plain retail line is available
      // too — both comparisons can then be checked independently.
      part({ id: 'p2', category: 'GPU', name: 'RTX 4070', cost: 503, retailPrice: 900, altStorePrice: 740 }),
    ],
    ...over,
  });
  const card = (b: PcBuild, over: Record<string, unknown> = {}) =>
    displayCard({ build: b, warrantyDays: 90, shopName: 'FlipThatTech', shopPhone: 'p', ...over });

  it('names the store, the total and the saving', () => {
    const c = card(priced());
    expect(c.diyComparison).toEqual({ store: 'Canada Computers', total: '$1,250.00', saving: '$50.00' });
    // The plain retail line stands alongside it; the renderer prefers the DIY
    // one, which services/buildPrint.test.ts checks against the real HTML.
    expect(c.comparison).toEqual({ retailTotal: '$1,380.00', saving: '$180.00' });
  });

  it('is ABSENT when a part has no price at that store and none to fall back on', () => {
    const c = card(priced({
      parts: [
        part({ id: 'p1', cost: 407, retailPrice: 480, altStorePrice: 510 }),
        part({ id: 'p2', cost: 503 }),
      ],
    }));
    expect(c.diyComparison).toBeNull();
  });

  it('is absent when no comparison store is set — the retail line carries on', () => {
    const c = card(priced({ comparisonStore: undefined }));
    expect(c.diyComparison).toBeNull();
    expect(c.comparison).not.toBeNull();
  });

  it('omits an UNFLATTERING saving rather than printing a negative one', () => {
    const c = card(priced({ targetPrice: 1400 }));
    expect(c.diyComparison?.total).toBe('$1,250.00');
    expect(c.diyComparison?.saving).toBeNull();
  });

  it('honours the preview toggles: the comparison off, or the name off', () => {
    expect(card(priced(), { showComparison: false }).diyComparison).toBeNull();
    const noName = card(priced(), { showStoreName: false });
    expect(noName.diyComparison).toEqual({ store: '', total: '$1,250.00', saving: '$50.00' });
  });

  it('LEAKS NOTHING — same rule as everything else on this card', () => {
    assertNothingPrivate(card(priced()), [407, 503, 910, 17, 4]);
  });
});

describe('card orientation', () => {
  it('is landscape or portrait, and landscape is the default', () => {
    expect(CARD_ORIENTATIONS).toEqual(['landscape', 'portrait']);
    expect(cardOrientation(undefined)).toBe('landscape');
    expect(cardOrientation('landscape')).toBe('landscape');
    expect(cardOrientation('portrait')).toBe('portrait');
  });

  it('a stored value that means nothing falls back rather than breaking the print', () => {
    // It comes out of localStorage, so it can be anything at all.
    for (const v of ['', 'sideways', null, 7, {}]) {
      expect({ v, o: cardOrientation(v) }).toEqual({ v, o: 'landscape' });
    }
  });
});

describe('sheetPhoto', () => {
  const real = { id: 'ph1', url: 'https://cdn.test/real.jpg', kind: 'real' as const, addedBy: 'u1', addedAt: 1 };
  const stock = { id: 'ph0', url: 'https://cdn.test/stock.jpg', kind: 'stock' as const, credit: 'Jane Doe, CC BY-SA 4.0', sourceUrl: 'https://commons.wikimedia.org/x', addedBy: 'system', addedAt: 1 };

  it('is null when the shop has no photo', () => {
    expect(sheetPhoto()).toBeNull();
    expect(sheetPhoto([])).toBeNull();
  });

  it('prefers a REAL photo over a stock one, wherever it sits in the list', () => {
    expect(sheetPhoto([stock, real])?.url).toBe('https://cdn.test/real.jpg');
    expect(sheetPhoto([stock, real])?.stock).toBe(false);
  });

  it('flags a stock photo and keeps its credit', () => {
    const p = sheetPhoto([stock]);
    expect(p).toEqual({ url: 'https://cdn.test/stock.jpg', stock: true, credit: 'Jane Doe, CC BY-SA 4.0' });
  });

  it('carries nothing about who took it or where it came from', () => {
    const p = sheetPhoto([real]) as unknown as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(['credit', 'stock', 'url']);
  });
});
