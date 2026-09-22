import { describe, it, expect } from 'vitest';
import { BuildPart, PcBuild } from '../types';
import { customerSheet, displayCard } from '../domain/buildSheet';
import { buildSheetHtml, displayCardHtml } from './buildPrint';

/**
 * THE RENDERED OUTPUT, not the data behind it.
 *
 * domain/buildSheet.test.ts already proves the stripping happens at the DATA
 * layer — the private fields are gone from the object, not merely unrendered.
 * This file closes the other half: that nothing puts them BACK on the way to
 * the paper. A print template is a second place a cost could be read from the
 * build, and the whole point of these two pieces is that a customer holds them.
 */

const part = (p: Partial<BuildPart> = {}): BuildPart => ({
  id: 'p1', category: 'CPU', name: 'Ryzen 7 7800X3D', cost: 407,
  condition: 'new', source: 'facebook',
  sourceUrl: 'https://facebook.com/marketplace/item/123',
  serial: 'CPU-SECRET-9911', ...p,
});

const PARTS: BuildPart[] = [
  part({ id: 'p1', category: 'CPU', name: 'Ryzen 7 7800X3D', cost: 407, retailPrice: 480, retailCheckedAt: '2026-03-01' }),
  part({ id: 'p2', category: 'GPU', name: 'RTX 4070 Windforce', cost: 503, condition: 'used', retailPrice: 700, retailCheckedAt: '2026-03-01', serial: 'GPU-SECRET-2211' }),
  part({ id: 'p3', category: 'RAM', name: '32GB DDR5 6000', cost: 91, retailPrice: 120, retailCheckedAt: '2026-03-01' }),
  part({ id: 'p4', category: 'Storage', name: '1TB NVMe', cost: 61, retailPrice: 120, retailCheckedAt: '2026-03-01' }),
];

const build = (p: Partial<PcBuild> = {}): PcBuild => ({
  id: 'b1', name: 'Starter Gaming PC', kind: 'shelf', status: 'ready', parts: PARTS,
  labour: [{ id: 'l1', userId: 'u1', userEmail: 'sam@shop.test', hours: 4, date: '2026-03-01', rate: 17, loggedAt: 1 }],
  targetPrice: 1200, createdBy: 'u1', createdByEmail: 'sam@shop.test',
  createdAt: 1, updatedAt: 1, ...p,
});

/**
 * Markers a customer must never read off the page. Deliberately strings that
 * cannot occur in any legitimate part name, price or date — a bare number like
 * "407" appears inside "RTX 4070", so scanning printed HTML for figures would
 * fire on the product name and teach us to loosen the check.
 */
const PRIVATE_MARKERS = [
  'SECRET',            // every part serial in the fixture
  'facebook',          // where it was bought
  'marketplace',       // the listing link
  'shop.test',         // who worked on it
  'Cost', 'cost',      // a cost column or label
  'Profit', 'profit',
  'Margin', 'margin',
  'Labour', 'labour', 'Labor',
  'Source', 'Seller',
];

const assertClean = (html: string) => {
  for (const marker of PRIVATE_MARKERS) {
    expect({ marker, found: html.includes(marker) }).toEqual({ marker, found: false });
  }
};

describe('the printed spec sheet', () => {
  const html = buildSheetHtml(
    customerSheet({ build: build(), warrantyDays: 90 }),
    { storeName: 'FlipThatTech', storePhone: '416-555-0100' },
  );

  it('shows NOTHING private — no cost, source link, seller, serial, labour or profit', () => {
    assertClean(html);
  });

  it('still says everything a customer needs', () => {
    expect(html).toContain('Starter Gaming PC');
    expect(html).toContain('Ryzen 7 7800X3D');
    expect(html).toContain('RTX 4070 Windforce');
    expect(html).toContain('90-day warranty from FlipThatTech');
    // Retail price never appears without the date it was checked.
    expect(html).toContain('$700.00 (as of 2026-03-01)');
    expect(html).toContain('FlipThatTech');
  });

  it('a customer order prints the quote, deposit and balance and nothing more', () => {
    const order = buildSheetHtml(
      customerSheet({
        build: build({ kind: 'customer', quotePrice: 1500, targetPrice: undefined }),
        warrantyDays: 90, deposit: 375,
      }),
      { storeName: 'FlipThatTech' },
    );
    assertClean(order);
    expect(order).toContain('$1,500.00');
    expect(order).toContain('$375.00');
    expect(order).toContain('$1,125.00');
  });
});

describe('the printed display card', () => {
  const card = displayCard({
    build: build(), warrantyDays: 90, shopName: 'FlipThatTech', shopPhone: '416-555-0100',
  });
  const html = displayCardHtml(card);

  it('shows NOTHING private', () => {
    assertClean(html);
  });

  it('leads with the price', () => {
    expect(html).toContain('$1,200.00');
    expect(html).toContain('90-day warranty');
  });

  it('half-page prints TWO copies on the one sheet', () => {
    const one = displayCardHtml(card).split('Starter Gaming PC').length - 1;
    const two = displayCardHtml(card, { half: true }).split('Starter Gaming PC').length - 1;
    expect(two).toBe(one * 2);
    assertClean(displayCardHtml(card, { half: true }));
  });

  it('stays clean with the comparison and condition badges switched off', () => {
    const plain = displayCard({
      build: build(), warrantyDays: 90, shopName: 'F', shopPhone: 'p',
      showComparison: false, showConditions: false,
    });
    assertClean(displayCardHtml(plain));
  });
});
