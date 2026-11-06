import { describe, it, expect } from 'vitest';
import { tagBody, TAG_STYLE } from './shelfTag';
import { InventoryItem } from '../types';
import { readFileSync } from 'fs';
import { join } from 'path';

const dev = (p: Partial<InventoryItem>): InventoryItem => ({
  id: 'i', kind: 'device', sku: 'FTT-0000029', date: '2026-01-01', item: 'iPhone 14 Pro Max',
  imei: '490154203237518', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', targetSalePrice: 699,
  storage: '256GB', color: 'Silver', batteryHealth: '89%', condition: 'Excellent',
  ...p,
} as InventoryItem);

const rule = (cls: string) => TAG_STYLE.match(new RegExp(`\\${cls}\\s*\\{[^}]*\\}`))?.[0] || '';
const sizeOf = (cls: string) => parseFloat(rule(cls).match(/font-size:\s*([\d.]+)mm/)?.[1] || '0');
const weightOf = (cls: string) => parseInt(rule(cls).match(/font-weight:\s*(\d+)/)?.[1] || '400', 10);

describe('shelf tag styling — bold numbers, price no longer needs to be oversized', () => {
  it('the specs line is bold', () => {
    expect(weightOf('.specs')).toBeGreaterThanOrEqual(700);
  });

  it('the price is still bold but shrunk — no longer the single oversized element on the tag', () => {
    expect(weightOf('.price')).toBe(900); // still the boldest weight
    const priceSizeMm = sizeOf('.price');
    expect(priceSizeMm).toBeLessThan(10); // smaller than the old 10mm
    // Still clearly the largest number on the tag — bold weight signals
    // importance now, but size still gives it visual priority.
    expect(priceSizeMm).toBeGreaterThan(sizeOf('.specs'));
  });

  it('the price has no top/bottom border rule anymore', () => {
    expect(rule('.price')).not.toMatch(/border/);
  });
});

describe('shelf tag — SKU line removed, color dropped from specs, bigger store/storage text', () => {
  it('the SKU is not rendered on the tag at all (the QR already encodes the item\'s identifier)', () => {
    const html = tagBody(dev({}), 'FlipThatTech');
    expect(html).not.toContain('FTT-0000029');
    expect(html).not.toContain('class="sku"');
  });

  it('the .sku CSS rule no longer exists', () => {
    expect(TAG_STYLE).not.toMatch(/\.sku\s*\{/);
  });

  it('color is left out of the specs line even when set — storage/carrier/battery are kept, condition stays out too', () => {
    const html = tagBody(dev({ storage: '256GB', color: 'Silver', carrier: 'Unlocked', batteryHealth: '89%', condition: 'Excellent' }), 'FlipThatTech');
    expect(html).toContain('256GB');
    expect(html).toContain('Unlocked');
    expect(html).toContain('89%');
    expect(html).not.toContain('Silver');
    expect(html).not.toContain('Excellent');
  });

  it('the store name (.store) is bigger and bold', () => {
    expect(sizeOf('.store')).toBeGreaterThan(3.3); // grew from the prior pass's 3.3mm
    expect(weightOf('.store')).toBeGreaterThanOrEqual(800);
  });

  it('the storage/specs line is bigger than the prior pass', () => {
    expect(sizeOf('.specs')).toBeGreaterThan(3.9); // grew from the prior pass's 3.9mm
  });

  it('renders the price and remaining spec fields (styling change only, content otherwise intact)', () => {
    const html = tagBody(dev({}), 'FlipThatTech');
    expect(html).toContain('$699.00');
    expect(html).toContain('256GB');
    expect(html).toContain('89%');
    expect(html).toContain('FlipThatTech');
    expect(html).toContain('iPhone 14 Pro Max');
  });
});

describe('shelf tag — pushed further down', () => {
  it('top padding grew again from the prior pass, for a more noticeable push-down', () => {
    const bodyRule = TAG_STYLE.match(/\.tag-body\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
    const padMatch = bodyRule.match(/padding:\s*([\d.]+)mm\s+[\d.]+mm\s+([\d.]+)mm\s+[\d.]+mm/);
    const [, top] = padMatch!.map(Number);
    expect(top).toBeGreaterThan(2.4); // grew from the prior pass's 2.4mm
  });

  it('the right padding still reserves room for the 20mm QR so centered text stays clear of it', () => {
    const bodyRule = TAG_STYLE.match(/\.tag-body\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
    const padMatch = bodyRule.match(/padding:\s*[\d.]+mm\s+([\d.]+)mm\s+[\d.]+mm\s+[\d.]+mm/);
    const rightPad = parseFloat(padMatch![1]);
    const qrRule = TAG_STYLE.match(/\.tag-qr\s*\{[^}]*\}/)?.[0] || '';
    const qrWidth = parseFloat(qrRule.match(/width:\s*([\d.]+)mm/)![1]);
    const qrInset = parseFloat(qrRule.match(/right:\s*([\d.]+)mm/)![1]);
    expect(rightPad).toBeGreaterThan(qrWidth + qrInset);
  });
});

describe('shelf tag — the QR is bigger than before (9mm -> 20mm) and stays square', () => {
  it('reads the QR dimensions from the CSS', () => {
    const qrRule = TAG_STYLE.match(/\.tag-qr\s*\{[^}]*\}/)?.[0] || '';
    const widthMm = parseFloat(qrRule.match(/width:\s*([\d.]+)mm/)![1]);
    const heightMm = parseFloat(qrRule.match(/height:\s*([\d.]+)mm/)![1]);
    expect(widthMm).toBeCloseTo(20, 0);
    expect(widthMm).toBe(heightMm);
  });
});

describe('shelf tag — content actually fits the 36mm label (regression: model/storage rows were being cut off in print)', () => {
  const LABEL_HEIGHT_MM = 36;
  const LINES = ['.store', '.name', '.specs', '.price']; // .sku removed entirely

  it('every remaining content line disables flex-shrink, so it can never be silently compressed to fit', () => {
    // The root cause (see services/shelfTag.ts's comment above .store): the
    // flex column's default flex-shrink:1 compresses whichever lines have
    // the least slack once total content height exceeds the label — on a
    // real print that read as rows getting cut off, not a clean crop.
    for (const cls of LINES) {
      expect(rule(cls), `${cls} should set flex-shrink: 0`).toMatch(/flex-shrink:\s*0/);
    }
  });

  it('the estimated total content height fits inside the label with real margin to spare', () => {
    // Analytical estimate (no headless browser here — see labelLayout.ts's
    // maxSafePushDownMm for the same approach elsewhere in this codebase):
    // each line's rendered height is font-size × line-height, plus its
    // margin-top, summed top to bottom, plus the outer vertical padding.
    // 1.2 is a conservative generic line-height for lines that don't set an
    // explicit one (.specs, .price) — real browser "normal" for Inter is
    // typically at or below that, so this over-, not under-, estimates.
    const num = (css: string, prop: string, fallback = 0) => parseFloat(css.match(new RegExp(`${prop}:\\s*([\\d.]+)mm`))?.[1] || String(fallback));

    const store = num(rule('.store'), 'font-size') * num(rule('.store'), 'line-height', 1);
    const name = num(rule('.name'), 'margin-top') + num(rule('.name'), 'font-size') * num(rule('.name'), 'line-height', 1.2);
    const specs = num(rule('.specs'), 'margin-top') + num(rule('.specs'), 'font-size') * 1.2;
    const priceRule = rule('.price');
    const pricePadding = num(priceRule, 'padding') * 2; // shorthand `padding: Xmm 0` — vertical padding is 2×X
    const price = num(priceRule, 'margin-top') + num(priceRule, 'font-size') * 1.2 + pricePadding;

    const bodyRule = TAG_STYLE.match(/\.tag-body\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
    const padMatch = bodyRule.match(/padding:\s*([\d.]+)mm\s+[\d.]+mm\s+([\d.]+)mm\s+[\d.]+mm/);
    const verticalPadding = Number(padMatch![1]) + Number(padMatch![2]);

    const total = store + name + specs + price + verticalPadding;
    expect(total).toBeLessThan(LABEL_HEIGHT_MM);
    // Real margin, not just barely squeaking under.
    expect(LABEL_HEIGHT_MM - total).toBeGreaterThan(0.5);
  });
});

/* ======================================================================== *
 * LAPTOPS GET THEIR OWN PRINTED TAG
 *
 * PR #230 gave laptops spec fields, #232 gave the grid its own columns, and
 * the listings carry the specs. Printing was missed — the third surface, and
 * the one a customer actually reads off a shelf. A laptop tag was building the
 * PHONE spec line, so it printed its storage and nothing else, while reaching
 * for carrier and battery health that a laptop never has.
 *
 * THE DIMENSIONS EVERYTHING HERE IS DESIGNED AGAINST, from the one shared
 * preset (BUILT_IN_LABEL_SIZES' 'dymo-36x89'): a landscape content area of
 * 89 × 36 mm, of which .tag-body's padding leaves 65 mm of text column and
 * 31 mm (phone) / 33.1 mm (laptop) of stack height. Every number in this block
 * was measured in headless Chromium against the real generated markup and CSS
 * at those exact millimetre sizes — the table is in the PR description. The
 * assertions below re-derive the same geometry from the CSS so it cannot drift
 * silently afterwards.
 * ======================================================================== */

const lap = (p: Partial<InventoryItem> = {}): InventoryItem => dev({
  item: 'Dell XPS 15 9520', deviceType: 'Laptop', targetSalePrice: 1899.99,
  cpu: 'i7-12700H', ram: '32GB', storage: '1TB', storageType: 'SSD',
  screenSize: '15.6"', gpu: 'RTX 3050 Ti',
  // Phone fields a real record may still carry (nothing clears them — see
  // domain/deviceSpecs.ts's strandedFields). They must not print.
  carrier: 'Unlocked', batteryHealth: '89%', color: 'Silver',
  ...p,
} as Partial<InventoryItem>);

describe('a laptop shelf tag prints laptop specs', () => {
  it('shows CPU, RAM and storage — the specs ARE the difference on a shelf of laptops', () => {
    const html = tagBody(lap(), 'FlipThatTech');
    expect(html).toContain('i7-12700H · 32GB · 1TB SSD');
    expect(html).toContain('Dell XPS 15 9520');   // the owner's own name, unchanged
    expect(html).toContain('$1899.99');
  });

  it('does NOT print carrier or battery health, even when the record still carries them', () => {
    // The bug this fixes was the code reaching for phone fields on a laptop.
    const html = tagBody(lap(), 'FlipThatTech');
    expect(html).not.toContain('Unlocked');
    expect(html).not.toContain('Battery');
    expect(html).not.toContain('89%');
    // Colour stays out of both layouts, as it already did.
    expect(html).not.toContain('Silver');
  });

  it('prints the GPU on its own line when there is one', () => {
    const html = tagBody(lap(), 'FlipThatTech');
    expect(html).toContain('<div class="specs gpu">RTX 3050 Ti</div>');
  });

  it('prints NO empty slot, no dash and no stray separator when there is no GPU', () => {
    // Most laptops are integrated graphics and the field is blank. An empty
    // slot reads as missing data; an absent line reads as "no discrete GPU".
    const html = tagBody(lap({ gpu: '' }), 'FlipThatTech');
    expect(html).not.toContain('specs gpu');
    expect(html).toContain('i7-12700H · 32GB · 1TB SSD');
    // No orphaned separator anywhere, and nothing standing in for the GPU.
    expect(html).not.toMatch(/·\s*<\//);
    expect(html).not.toMatch(/>\s*·/);
    expect(html).not.toMatch(/>\s*[-–—]\s*</);
  });

  it('a whitespace-only GPU counts as no GPU', () => {
    expect(tagBody(lap({ gpu: '   ' }), 'FlipThatTech')).not.toContain('specs gpu');
  });

  it('a laptop with NO specs at all still prints a readable tag — name and price, nothing orphaned', () => {
    const html = tagBody(lap({ cpu: '', ram: '', storage: '', storageType: undefined, gpu: '', screenSize: '' }), 'FlipThatTech');
    expect(html).toContain('Dell XPS 15 9520');
    expect(html).toContain('$1899.99');
    expect(html).toContain('FlipThatTech');
    // No empty spec line, no empty GPU line, no corner badge, no separators.
    expect(html).not.toContain('class="specs"');
    expect(html).not.toContain('specs gpu');
    expect(html).not.toContain('tag-screen');
    expect(html).not.toContain('·');
  });

  it('partial specs collapse cleanly rather than printing separators around a gap', () => {
    const html = tagBody(lap({ cpu: '', ram: '', gpu: '' }), 'FlipThatTech');
    expect(html).toContain('<div class="specs">1TB SSD</div>');  // storage alone, no leading ·
    expect(html).not.toMatch(/"specs">\s*·/);
  });

  it('storage type rides with the capacity rather than taking a separator of its own', () => {
    expect(tagBody(lap({ storageType: 'HDD' }), 'FlipThatTech')).toContain('1TB HDD');
    // …and a capacity with no type recorded is just the capacity.
    expect(tagBody(lap({ storageType: undefined }), 'FlipThatTech')).toContain('32GB · 1TB<');
  });
});

describe('screen size goes in the corner the QR does not already own', () => {
  it('is printed as a corner badge, not folded into the spec line', () => {
    const html = tagBody(lap(), 'FlipThatTech');
    // esc() escapes only < > & — a quote in a screen size passes through.
    expect(html).toContain('<div class="tag-screen">15.6"</div>');
    // Not on the spec line — that line is CPU/RAM/storage only.
    expect(html).toMatch(/<div class="specs">i7-12700H · 32GB · 1TB SSD<\/div>/);
  });

  it('and is omitted entirely when not recorded', () => {
    expect(tagBody(lap({ screenSize: '' }), 'FlipThatTech')).not.toContain('tag-screen');
  });

  // THE COLLISION QUESTION, answered from the real CSS rather than by eye.
  // The QR owns the TOP-right (load-bearing: it encodes the identifier that
  // gets scanned), so the badge takes the BOTTOM-right. Both sit inside the
  // 22mm right gutter .tag-body reserves, so neither can reach the centred
  // text either.
  it('does not overlap the QR — derived from the CSS, in mm', () => {
    const LABEL_W = 89, LABEL_H = 36;
    const num = (css: string, prop: string) => parseFloat(css.match(new RegExp(`${prop}:\\s*([\\d.]+)mm`))![1]);
    const qr = rule('.tag-qr');
    const scr = TAG_STYLE.match(/\.tag-screen\s*\{[\s\S]*?\n\s*\}/)![0];

    // QR: top-right, square.
    const qrTop = num(qr, 'top'), qrRight = num(qr, 'right');
    const qrW = num(qr, 'width'), qrH = num(qr, 'height');
    const qrBox = { x1: LABEL_W - qrRight - qrW, x2: LABEL_W - qrRight, y1: qrTop, y2: qrTop + qrH };

    // Badge: bottom-right, height = font-size × line-height (both set).
    const scrBottom = num(scr, 'bottom'), scrRight = num(scr, 'right');
    const scrW = num(scr, 'width');
    const scrH = num(scr, 'font-size') * parseFloat(scr.match(/line-height:\s*([\d.]+)/)![1]);
    const scrBox = { x1: LABEL_W - scrRight - scrW, x2: LABEL_W - scrRight, y1: LABEL_H - scrBottom - scrH, y2: LABEL_H - scrBottom };

    const overlaps = scrBox.x1 < qrBox.x2 && scrBox.x2 > qrBox.x1 && scrBox.y1 < qrBox.y2 && scrBox.y2 > qrBox.y1;
    expect(overlaps, `QR ${JSON.stringify(qrBox)} and screen badge ${JSON.stringify(scrBox)} must not overlap`).toBe(false);
    // Real clearance, not a shared edge. Measured at 9.4mm.
    expect(scrBox.y1 - qrBox.y2).toBeGreaterThan(2);
    // Both stay inside the reserved right gutter, so the centred stack is clear.
    const bodyRule = TAG_STYLE.match(/\.tag-body\s*\{[\s\S]*?\n\s*\}/)![0];
    const rightPad = parseFloat(bodyRule.match(/padding:\s*[\d.]+mm\s+([\d.]+)mm/)![1]);
    expect(scrBox.x1).toBeGreaterThanOrEqual(LABEL_W - rightPad);
    // And inside the label.
    expect(scrBox.y2).toBeLessThanOrEqual(LABEL_H);
  });
});

describe('the laptop tag fits the 36mm label too — the second spec line is paid for, not squeezed in', () => {
  const LABEL_HEIGHT_MM = 36;

  it('every laptop line also disables flex-shrink, so nothing can be silently compressed', () => {
    // Same guard the phone lines carry: .specs and .price are shared rules, and
    // the laptop adds no new line class of its own (.specs.gpu re-uses .specs).
    for (const cls of ['.store', '.name', '.specs', '.price']) {
      expect(rule(cls), `${cls} should set flex-shrink: 0`).toMatch(/flex-shrink:\s*0/);
    }
  });

  it('the worst realistic laptop — long CPU, long GPU, both spec lines — still fits with margin', () => {
    // Same analytical model the phone fit test above uses, with the laptop's
    // own overrides applied: a reduced top padding, a smaller spec font and an
    // explicit line-height on both spec lines. Measured in Chromium at
    // 31.04mm of stack in a 33.1mm box (2.06mm spare) — the phone's margin is
    // 2.1mm, so the laptop is no tighter than what already prints correctly.
    const num = (css: string, prop: string, fallback = 0) =>
      parseFloat(css.match(new RegExp(`${prop}:\\s*([\\d.]+)mm`))?.[1] || String(fallback));

    const bodyRule = TAG_STYLE.match(/\.tag-body\s*\{[\s\S]*?\n\s*\}/)![0];
    const padBottom = parseFloat(bodyRule.match(/padding:\s*[\d.]+mm\s+[\d.]+mm\s+([\d.]+)mm/)![1]);
    const lapBody = TAG_STYLE.match(/\.tag-body\.laptop\s*\{[^}]*\}/)![0];
    const padTop = num(lapBody, 'padding-top');
    // The laptop MUST reclaim room rather than just adding a line.
    const phonePadTop = parseFloat(bodyRule.match(/padding:\s*([\d.]+)mm/)![1]);
    expect(padTop).toBeLessThan(phonePadTop);

    const lapSpecs = TAG_STYLE.match(/\.laptop \.specs\s*\{[^}]*\}/)![0];
    const specFont = num(lapSpecs, 'font-size');
    const specLh = parseFloat(lapSpecs.match(/line-height:\s*([\d.]+)/)![1]);
    const gpuRule = TAG_STYLE.match(/\.laptop \.specs\.gpu\s*\{[^}]*\}/)![0];

    const store = num(rule('.store'), 'font-size') * num(rule('.store'), 'line-height', 1);
    const name = num(rule('.name'), 'margin-top') + num(rule('.name'), 'font-size') * num(rule('.name'), 'line-height', 1.2);
    const specs = num(rule('.specs'), 'margin-top') + specFont * specLh;
    const gpu = num(gpuRule, 'margin-top') + specFont * specLh;
    const priceRule = rule('.price');
    const price = num(priceRule, 'margin-top') + num(priceRule, 'font-size') * 1.2 + num(priceRule, 'padding') * 2;

    const total = store + name + specs + gpu + price + padTop + padBottom;
    expect(total).toBeLessThan(LABEL_HEIGHT_MM);
    expect(LABEL_HEIGHT_MM - total).toBeGreaterThan(0.5);
  });

  it('the laptop spec font is smaller than the phone\'s, because its line is far longer', () => {
    // Measured: "Ryzen 7 5800H · 32GB · 1TB SSD" is 73.0mm at the phone's
    // 4.6mm against a 65mm column — 8mm of silent ellipsis. At 3.7mm it is
    // 58.7mm, 6.3mm clear.
    const lapSpecs = TAG_STYLE.match(/\.laptop \.specs\s*\{[^}]*\}/)![0];
    expect(parseFloat(lapSpecs.match(/font-size:\s*([\d.]+)mm/)![1])).toBeLessThan(sizeOf('.specs'));
  });
});

describe('THE REGRESSION THAT MATTERS: a phone tag prints exactly what it printed before', () => {
  // Pinned as the literal expected markup, not a set of toContain() checks:
  // this stage is additive, and the only way to prove a shared template was
  // not disturbed is to compare the whole thing.
  const PHONE_TAG = `
    <div class="tag-page-inner">
      <div class="tag-body">
        <div class="store">FlipThatTech</div>
        <div class="name">iPhone 14 Pro Max</div>
        <div class="specs">256GB · Unlocked · Battery 89%</div>
        <div class="price">$699.00</div>
      </div>
      <img class="tag-qr" src="QRDATA" alt="" />
    </div>`;

  it('byte for byte, for a phone', () => {
    expect(tagBody(dev({ deviceType: 'Phone', carrier: 'Unlocked' }), 'FlipThatTech', 'QRDATA')).toBe(PHONE_TAG);
  });

  it('byte for byte, for an UNTYPED legacy record (deviceType absent reads as a phone)', () => {
    expect(tagBody(dev({ carrier: 'Unlocked' }), 'FlipThatTech', 'QRDATA')).toBe(PHONE_TAG);
  });

  it('an accessory keeps the phone layout and never takes the laptop path', () => {
    // An accessory has no deviceType, so a naive `=== 'Laptop'` check would be
    // fine — but a stray value on one must not change its layout either.
    const html = tagBody(dev({ kind: 'accessory', item: 'USB-C Cable', sellingPrice: 19.99, deviceType: 'Laptop' } as Partial<InventoryItem>), 'FlipThatTech');
    expect(html).toContain('class="tag-body"');
    expect(html).not.toContain('laptop');
    expect(html).toContain('$19.99');
  });

  it('every laptop CSS rule is scoped, so no phone tag can pick one up', () => {
    // The new rules are APPENDED to TAG_STYLE and every one of them is scoped
    // to .laptop or .tag-screen; none of the pre-existing rules was touched.
    const newRules = TAG_STYLE.split(/\n/).filter(l => /^\s*\.[\w.\- ]+\s*\{/.test(l) || /^\s*\.tag-(body\.laptop|screen)/.test(l));
    for (const line of newRules) {
      const sel = line.trim().split('{')[0].trim();
      if (sel === '.store' || sel === '.name' || sel === '.specs' || sel === '.price'
        || sel === '.tag-qr' || sel === '.tag-page-inner' || sel === '.tag-body') continue;
      expect(sel, `${sel} must be scoped to the laptop tag`).toMatch(/\.laptop|\.tag-screen/);
    }
  });
});

describe('the single print and the batch print cannot drift', () => {
  it('both go through tagBody, so a laptop prints identically either way', () => {
    // printShelfTag and printShelfTagsBatch each call tagBody and differ only
    // in how many pages they chain — asserted on the source so the shared
    // template cannot quietly be forked later.
    const src = readFileSync(join(__dirname, 'shelfTag.ts'), 'utf8');
    const single = src.match(/export async function printShelfTag\b[\s\S]*?\n\}/)![0];
    const batch = src.match(/export async function printShelfTagsBatch\b[\s\S]*?\n\}/)![0];
    expect(single).toMatch(/tagBody\(/);
    expect(batch).toMatch(/tagBody\(/);
    // Neither builds its own markup.
    for (const fn of [single, batch]) {
      expect(fn).not.toMatch(/class="(store|name|specs|price|tag-screen)"/);
    }
  });
});
