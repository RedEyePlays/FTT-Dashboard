import { describe, it, expect } from 'vitest';
import { tagBody, TAG_STYLE } from './shelfTag';
import { InventoryItem } from '../types';

const dev = (p: Partial<InventoryItem>): InventoryItem => ({
  id: 'i', kind: 'device', sku: 'FTT-0000029', date: '2026-01-01', item: 'iPhone 14 Pro Max',
  imei: '490154203237518', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', targetSalePrice: 699,
  storage: '256GB', color: 'Silver', batteryHealth: '89%', condition: 'Excellent',
  ...p,
} as InventoryItem);

describe('shelf tag styling — bold numbers, price no longer needs to be oversized', () => {
  it('the numeric lines (specs and SKU) are bold', () => {
    expect(TAG_STYLE).toMatch(/\.specs\s*\{[^}]*font-weight:\s*[78]00/);
    expect(TAG_STYLE).toMatch(/\.sku\s*\{[^}]*font-weight:\s*700/);
  });

  it('the price is still bold but shrunk — no longer the single oversized element on the tag', () => {
    const priceRule = TAG_STYLE.match(/\.price\s*\{[^}]*\}/)?.[0] || '';
    expect(priceRule).toMatch(/font-weight:\s*900/); // still the boldest weight
    const sizeMatch = priceRule.match(/font-size:\s*([\d.]+)mm/);
    expect(sizeMatch).toBeTruthy();
    const priceSizeMm = parseFloat(sizeMatch![1]);
    expect(priceSizeMm).toBeLessThan(10); // smaller than the old 10mm
    // Still clearly the largest number on the tag — bold weight signals
    // importance now, but size still gives it visual priority.
    const specsSize = parseFloat(TAG_STYLE.match(/\.specs\s*\{[^}]*font-size:\s*([\d.]+)mm/)![1]);
    const skuSize = parseFloat(TAG_STYLE.match(/\.sku\s*\{[^}]*font-size:\s*([\d.]+)mm/)![1]);
    expect(priceSizeMm).toBeGreaterThan(specsSize);
    expect(priceSizeMm).toBeGreaterThan(skuSize);
  });

  it('renders the price, spec numbers, and SKU into the tag body unchanged in content (styling change only)', () => {
    const html = tagBody(dev({}), 'FlipThatTech');
    expect(html).toContain('$699.00');
    expect(html).toContain('256GB');
    expect(html).toContain('89%');
    expect(html).toContain('FTT-0000029');
  });
});

describe('shelf tag — no rule around the price, condition dropped, bigger specs/SKU text', () => {
  it('the price has no top/bottom border rule anymore', () => {
    const priceRule = TAG_STYLE.match(/\.price\s*\{[^}]*\}/)?.[0] || '';
    expect(priceRule).not.toMatch(/border/);
  });

  it('condition is left out of the specs line even when set — storage/color/battery are kept', () => {
    const html = tagBody(dev({ storage: '256GB', color: 'Silver', batteryHealth: '89%', condition: 'Excellent' }), 'FlipThatTech');
    expect(html).toContain('256GB');
    expect(html).toContain('Silver');
    expect(html).toContain('89%');
    expect(html).not.toContain('Excellent');
  });

  it('specs and SKU font-size grew again from the previous pass', () => {
    const specsSize = parseFloat(TAG_STYLE.match(/\.specs\s*\{[^}]*font-size:\s*([\d.]+)mm/)![1]);
    const skuSize = parseFloat(TAG_STYLE.match(/\.sku\s*\{[^}]*font-size:\s*([\d.]+)mm/)![1]);
    expect(specsSize).toBeGreaterThan(3.4);
    expect(skuSize).toBeGreaterThan(3.2);
  });
});

describe('shelf tag — bigger QR, all-bold text, pushed-down content, and larger line gaps', () => {
  it('the QR is bigger than before (9mm → 20mm)', () => {
    const rule = TAG_STYLE.match(/\.tag-qr\s*\{[^}]*\}/)?.[0] || '';
    const widthMm = parseFloat(rule.match(/width:\s*([\d.]+)mm/)![1]);
    const heightMm = parseFloat(rule.match(/height:\s*([\d.]+)mm/)![1]);
    expect(widthMm).toBeGreaterThan(9);
    expect(heightMm).toBeGreaterThan(9);
    expect(widthMm).toBeCloseTo(20, 0);
    expect(widthMm).toBe(heightMm); // stays square
  });

  it('every text line on the tag is bold, not just the numeric ones', () => {
    for (const cls of ['.store', '.name', '.specs', '.price', '.sku']) {
      const rule = TAG_STYLE.match(new RegExp(`\\${cls}\\s*\\{[^}]*\\}`))?.[0] || '';
      const weight = parseInt(rule.match(/font-weight:\s*(\d+)/)?.[1] || '400', 10);
      expect(weight, `${cls} should be bold`).toBeGreaterThanOrEqual(700);
    }
  });

  it('content is nudged down (asymmetric top/bottom padding), without changing the vertical total — a pure position shift, not a resize', () => {
    const rule = TAG_STYLE.match(/\.tag-body\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
    // 4-value shorthand now (top, right, bottom, left) — right grew to make
    // room for the bigger QR (see the next test), which is a real size
    // change on that one side, but top vs. bottom is still the pure
    // "nudged down" position shift from the prior pass.
    const padMatch = rule.match(/padding:\s*([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm/);
    expect(padMatch).toBeTruthy();
    const [, top, , bottom] = padMatch!.map(Number);
    expect(top).toBeGreaterThan(bottom); // shifted down: more room reserved above than below
  });

  it('the right padding reserves room for the bigger QR so centered text stays clear of it', () => {
    const bodyRule = TAG_STYLE.match(/\.tag-body\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
    const padMatch = bodyRule.match(/padding:\s*[\d.]+mm\s+([\d.]+)mm\s+[\d.]+mm\s+[\d.]+mm/);
    const rightPad = parseFloat(padMatch![1]);
    const qrRule = TAG_STYLE.match(/\.tag-qr\s*\{[^}]*\}/)?.[0] || '';
    const qrWidth = parseFloat(qrRule.match(/width:\s*([\d.]+)mm/)![1]);
    const qrInset = parseFloat(qrRule.match(/right:\s*([\d.]+)mm/)![1]);
    // The reserved zone must cover at least the QR's full footprint from the
    // label's right edge (its width + its own inset from that edge) — with
    // some margin, not just exactly touching it.
    expect(rightPad).toBeGreaterThan(qrWidth + qrInset);
  });

  it('every font-size grew from the previous pass ("make the scale a bit bigger")', () => {
    const oldSizes: Record<string, number> = { '.store': 3, '.name': 5.2, '.specs': 3.1, '.price': 7.5, '.sku': 2.9 };
    for (const [cls, oldSize] of Object.entries(oldSizes)) {
      const rule = TAG_STYLE.match(new RegExp(`\\${cls}\\s*\\{[^}]*\\}`))?.[0] || '';
      const size = parseFloat(rule.match(/font-size:\s*([\d.]+)mm/)?.[1] || '0');
      expect(size, `${cls} font-size should have grown`).toBeGreaterThan(oldSize);
    }
  });

  it('the price is still the biggest, boldest number on the tag after the size bump', () => {
    const sizeOf = (cls: string) => parseFloat(TAG_STYLE.match(new RegExp(`\\${cls}\\s*\\{[^}]*font-size:\\s*([\\d.]+)mm`))![1]);
    const priceSize = sizeOf('.price');
    expect(priceSize).toBeGreaterThan(sizeOf('.specs'));
    expect(priceSize).toBeGreaterThan(sizeOf('.sku'));
    expect(priceSize).toBeLessThan(10); // still not back to the original oversized 10mm
  });

  it('rendered content is unchanged by any of the above — styling/position only', () => {
    const html = tagBody(dev({}), 'FlipThatTech');
    expect(html).toContain('$699.00');
    expect(html).toContain('FTT-0000029');
  });
});

describe('shelf tag — pushed text down a bit further, storage line extra-bold', () => {
  it('the storage/color/battery (.specs) line is even bolder than before (700 → 800)', () => {
    const rule = TAG_STYLE.match(/\.specs\s*\{[^}]*\}/)?.[0] || '';
    const weight = parseInt(rule.match(/font-weight:\s*(\d+)/)![1], 10);
    expect(weight).toBeGreaterThanOrEqual(800);
  });

  it('the text stack was pushed down further — top padding grew, bottom shrank, same total', () => {
    const rule = TAG_STYLE.match(/\.tag-body\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
    const padMatch = rule.match(/padding:\s*([\d.]+)mm\s+[\d.]+mm\s+([\d.]+)mm\s+[\d.]+mm/);
    const [, top, bottom] = padMatch!.map(Number);
    expect(top).toBeGreaterThan(2); // grew from the prior pass's 2mm
    expect(bottom).toBeLessThan(0.5); // shrank from the prior pass's 0.5mm
    expect(top + bottom).toBeCloseTo(2.5, 1); // same total — pure position shift
  });
});

describe('shelf tag — content actually fits the 36mm label (regression: model/storage rows were being cut off in print)', () => {
  const LABEL_HEIGHT_MM = 36;

  it('every content line disables flex-shrink, so it can never be silently compressed to fit', () => {
    // The root cause: without this, the flex column's default flex-shrink:1
    // compresses whichever lines have the least slack once total content
    // height exceeds the label — on a real print that read as the model
    // (.name) and storage (.specs) rows getting cut off, not a clean crop.
    for (const cls of ['.store', '.name', '.specs', '.price', '.sku']) {
      const rule = TAG_STYLE.match(new RegExp(`\\${cls}\\s*\\{[^}]*\\}`))?.[0] || '';
      expect(rule, `${cls} should set flex-shrink: 0`).toMatch(/flex-shrink:\s*0/);
    }
  });

  it('the estimated total content height fits inside the label with real margin to spare', () => {
    // Analytical estimate (no headless browser here — see labelLayout.ts's
    // maxSafePushDownMm for the same approach elsewhere in this codebase):
    // each line's rendered height is font-size × line-height, plus its
    // margin-top, summed top to bottom, plus the outer vertical padding.
    // 1.2 is a conservative generic line-height for lines that don't set an
    // explicit one (.specs, .sku, .price) — real browser "normal" for Inter
    // is typically at or below that, so this over-, not under-, estimates.
    const rule = (cls: string) => TAG_STYLE.match(new RegExp(`\\${cls}\\s*\\{[^}]*\\}`))?.[0] || '';
    const num = (css: string, prop: string, fallback = 0) => parseFloat(css.match(new RegExp(`${prop}:\\s*([\\d.]+)mm`))?.[1] || String(fallback));

    const store = num(rule('.store'), 'font-size') * num(rule('.store'), 'line-height', 1);
    const name = num(rule('.name'), 'margin-top') + num(rule('.name'), 'font-size') * num(rule('.name'), 'line-height', 1.2);
    const specs = num(rule('.specs'), 'margin-top') + num(rule('.specs'), 'font-size') * 1.2;
    const priceRule = rule('.price');
    const pricePadding = num(priceRule, 'padding') * 2; // shorthand `padding: Xmm 0` — vertical padding is 2×X
    const price = num(priceRule, 'margin-top') + num(priceRule, 'font-size') * 1.2 + pricePadding;
    const sku = num(rule('.sku'), 'margin-top') + num(rule('.sku'), 'font-size') * 1.2;

    const bodyRule = TAG_STYLE.match(/\.tag-body\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
    const padMatch = bodyRule.match(/padding:\s*([\d.]+)mm\s+[\d.]+mm\s+([\d.]+)mm\s+[\d.]+mm/);
    const verticalPadding = Number(padMatch![1]) + Number(padMatch![2]);

    const total = store + name + specs + price + sku + verticalPadding;
    expect(total).toBeLessThan(LABEL_HEIGHT_MM);
    // Real margin, not just barely squeaking under — the whole point is to
    // never be this close to the edge again after three straight size bumps.
    expect(LABEL_HEIGHT_MM - total).toBeGreaterThan(0.5);
  });
});
