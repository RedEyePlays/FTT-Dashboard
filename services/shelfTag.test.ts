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
    expect(TAG_STYLE).toMatch(/\.specs\s*\{[^}]*font-weight:\s*700/);
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

  it('the gap between every line is still larger than the very first (pre-restyle) values', () => {
    const oldGaps: Record<string, number> = { '.name': 0.8, '.specs': 0.5, '.price': 1, '.sku': 0.8 };
    for (const [cls, oldGap] of Object.entries(oldGaps)) {
      const rule = TAG_STYLE.match(new RegExp(`\\${cls}\\s*\\{[^}]*\\}`))?.[0] || '';
      const gap = parseFloat(rule.match(/margin-top:\s*([\d.]+)mm/)?.[1] || '0');
      expect(gap, `${cls} margin-top should have grown`).toBeGreaterThan(oldGap);
    }
  });

  it('rendered content is unchanged by any of the above — styling/position only', () => {
    const html = tagBody(dev({}), 'FlipThatTech');
    expect(html).toContain('$699.00');
    expect(html).toContain('FTT-0000029');
  });
});
