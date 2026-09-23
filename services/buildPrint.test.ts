import { describe, it, expect } from 'vitest';
import { BuildPart, PcBuild } from '../types';
import { customerSheet, displayCard } from '../domain/buildSheet';
import { buildSheetHtml, cardPrintStyle, displayCardHtml } from './buildPrint';

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

  it('prints the machine\u2019s photo, and labels a STOCK one with its credit', () => {
    const withStock = buildSheetHtml(
      customerSheet({
        build: build(), warrantyDays: 90,
        photos: [{
          id: 'ph0', url: 'https://cdn.test/stock.jpg', kind: 'stock',
          credit: 'Jane Doe, CC BY-SA 4.0', addedBy: 'system', addedAt: 1,
        }],
      }),
      { storeName: 'FlipThatTech' },
    );
    expect(withStock).toContain('https://cdn.test/stock.jpg');
    expect(withStock).toContain('Stock photo \u2014 actual device may vary');
    expect(withStock).toContain('Jane Doe, CC BY-SA 4.0');
    assertClean(withStock);
  });

  it('labels a REAL photo nothing \u2014 a caption under an actual picture only invites doubt', () => {
    const withReal = buildSheetHtml(
      customerSheet({
        build: build(), warrantyDays: 90,
        photos: [{ id: 'ph1', url: 'https://cdn.test/real.jpg', kind: 'real', addedBy: 'u1', addedAt: 1 }],
      }),
      { storeName: 'FlipThatTech' },
    );
    expect(withReal).toContain('https://cdn.test/real.jpg');
    expect(withReal).not.toContain('Stock photo');
  });

  it('prints no photo block at all when the shop has not taken one', () => {
    expect(html).not.toContain('<figure class="photo">');
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

/**
 * ORIENTATION AND THE COMPARISON LINE, against the real HTML.
 *
 * The leak rule applies to every variant, not just the default one — a new
 * print path is a new place a cost could reach the paper.
 */
describe('the card prints both ways up', () => {
  // 510 + 740 + 130 + 130 = $1,510 at the store, against a $1,200 price.
  const ALT = [510, 740, 130, 130];
  const card = (over: Record<string, unknown> = {}) => displayCard({
    build: build({
      comparisonStore: 'Canada Computers',
      parts: PARTS.map((p, i) => ({ ...p, altStorePrice: ALT[i] })),
    }),
    warrantyDays: 90, shopName: 'FlipThatTech', shopPhone: '416-555-0100', ...over,
  });

  it('sets the page orientation it was asked for', () => {
    // The page box is what actually decides which way the paper comes out.
    expect(cardPrintStyle(false, 'landscape')).toContain('size:letter landscape');
    expect(cardPrintStyle(false, 'portrait')).toContain('size:letter portrait');
    expect(cardPrintStyle(false)).toContain('size:letter landscape');
  });

  it('LAYS PORTRAIT OUT DIFFERENTLY — not the landscape design squeezed in', () => {
    const land = cardPrintStyle(false, 'landscape');
    const port = cardPrintStyle(false, 'portrait');
    // A single spec column, because two at 7.5in clips every part name.
    expect(port).toContain('grid-template-columns:repeat(1,');
    expect(land).toContain('grid-template-columns:repeat(2,');
    // And a stacked head rather than name-beside-price.
    expect(port).toContain('flex-direction:column');
    expect(port).toContain('width:7.5in');
    expect(land).toContain('width:10in');
  });

  it('still prints TWO copies per sheet on half-page, in either orientation', () => {
    for (const orientation of ['landscape', 'portrait'] as const) {
      const one = displayCardHtml(card(), { orientation }).split('Starter Gaming PC').length - 1;
      const two = displayCardHtml(card(), { orientation, half: true }).split('Starter Gaming PC').length - 1;
      expect({ orientation, two }).toEqual({ orientation, two: one * 2 });
    }
  });

  it('prints the DIY comparison, preferring it over the plain retail line', () => {
    const html = displayCardHtml(card());
    expect(html).toContain('Build it yourself at Canada Computers');
    expect(html).toContain('$1,510.00');
    // The strike-through retail line steps aside; two comparisons is noise.
    expect(html).not.toContain('Parts at retail');
  });

  it('drops the store NAME when the preview says so, keeping the figure', () => {
    const html = displayCardHtml(card({ showStoreName: false }));
    expect(html).toContain('Build it yourself:');
    expect(html).not.toContain('Canada Computers');
    expect(html).toContain('$1,510.00');
  });

  it('falls back to the plain retail line with no comparison store', () => {
    const html = displayCardHtml(displayCard({
      build: build(), warrantyDays: 90, shopName: 'FlipThatTech', shopPhone: 'p',
    }));
    expect(html).toContain('Parts at retail');
    expect(html).not.toContain('Build it yourself');
  });

  it('LEAKS NOTHING in any orientation, half-page or whole', () => {
    for (const orientation of ['landscape', 'portrait'] as const) {
      for (const half of [false, true]) {
        assertClean(displayCardHtml(card(), { orientation, half }));
      }
    }
  });
});

describe('the QR on the display card', () => {
  const card = displayCard({
    build: build(), warrantyDays: 90, shopName: 'FlipThatTech', shopPhone: '416-555-0100',
  });
  const QR = 'data:image/png;base64,AAAA';

  it('prints the QR with a caption — a bare QR on a shelf card is furniture', () => {
    const html = displayCardHtml(card, { qrDataUrl: QR, qrLabel: 'flipthat.tech/b/kadamuze' });
    expect(html).toContain(QR);
    expect(html).toContain('Scan for full specs and photos');
    expect(html).toContain('flipthat.tech/b/kadamuze');
  });

  it('prints NO QR block at all when the build has no share link', () => {
    // A square that goes nowhere is worse than no square.
    const html = displayCardHtml(card, {});
    expect(html).not.toContain('class="qr"');
    expect(html).not.toContain('Scan for full specs');
  });

  it('puts the QR on BOTH copies of a half-page sheet', () => {
    const html = displayCardHtml(card, { half: true, qrDataUrl: QR });
    expect(html.split('Scan for full specs and photos')).toHaveLength(3);   // two occurrences
  });

  it('leaks nothing private alongside it', () => {
    assertClean(displayCardHtml(card, { qrDataUrl: QR, qrLabel: 'flipthat.tech/b/kadamuze' }));
  });
});

describe('performance on the display card', () => {
  const perf = [
    { game: 'Fortnite', resolution: '1080p', preset: 'High', fpsLow: 120, fpsHigh: 160, measured: false },
    { game: 'Cyberpunk 2077', resolution: '1440p', preset: 'Ultra', fpsLow: 45, fpsHigh: 62, measured: true },
    { game: 'CS2', resolution: '1080p', preset: 'Competitive', fpsLow: 280, fpsHigh: 360, measured: false },
    { game: 'Warzone', resolution: '1440p', preset: 'High', fpsLow: 90, fpsHigh: 120, measured: false },
  ];
  const withPerf = () => displayCard({
    build: build(), warrantyDays: 90, shopName: 'FlipThatTech', shopPhone: '416-555-0100',
    performance: perf,
  });

  it('prints each figure as a range with its settings', () => {
    const html = displayCardHtml(withPerf());
    expect(html).toContain('Fortnite');
    expect(html).toContain('120–160 fps');
    expect(html).toContain('1080p · High');
  });

  it('marks what was tested in-shop', () => {
    expect(displayCardHtml(withPerf())).toContain('tested in-shop');
  });

  it('keeps the card readable — only the first few lines, 1080p first', () => {
    const card = withPerf();
    expect(card.performance).toHaveLength(3);
    expect(card.performance[0].detail.startsWith('1080p')).toBe(true);
  });

  it('carries the caveat', () => {
    expect(displayCardHtml(withPerf())).toContain('Estimates based on published benchmarks');
  });

  it('prints no performance block at all when there are no figures', () => {
    const card = displayCard({ build: build(), warrantyDays: 90, shopName: 'FlipThatTech', shopPhone: '' });
    expect(card.performance).toEqual([]);
    expect(displayCardHtml(card)).not.toContain('class="perf"');
  });

  it('leaks nothing private alongside it', () => {
    assertClean(displayCardHtml(withPerf()));
  });
});
