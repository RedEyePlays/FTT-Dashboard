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
