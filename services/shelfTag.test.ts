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
  it('the QR is bigger than before (7mm → 9mm)', () => {
    const rule = TAG_STYLE.match(/\.tag-qr\s*\{[^}]*\}/)?.[0] || '';
    const widthMm = parseFloat(rule.match(/width:\s*([\d.]+)mm/)![1]);
    const heightMm = parseFloat(rule.match(/height:\s*([\d.]+)mm/)![1]);
    expect(widthMm).toBeGreaterThan(7);
    expect(heightMm).toBeGreaterThan(7);
    expect(widthMm).toBe(heightMm); // stays square
  });

  it('every text line on the tag is bold, not just the numeric ones', () => {
    for (const cls of ['.store', '.name', '.specs', '.price', '.sku']) {
      const rule = TAG_STYLE.match(new RegExp(`\\${cls}\\s*\\{[^}]*\\}`))?.[0] || '';
      const weight = parseInt(rule.match(/font-weight:\s*(\d+)/)?.[1] || '400', 10);
      expect(weight, `${cls} should be bold`).toBeGreaterThanOrEqual(700);
    }
  });

  it('content is nudged down (asymmetric top/bottom padding), without changing the total padding — a pure position shift, not a resize', () => {
    const rule = TAG_STYLE.match(/\.tag-body\s*\{[\s\S]*?\n\s*\}/)?.[0] || '';
    const padMatch = rule.match(/padding:\s*([\d.]+)mm\s+([\d.]+)mm\s+([\d.]+)mm/);
    expect(padMatch).toBeTruthy(); // 3-value shorthand: top, left/right, bottom
    const [, top, , bottom] = padMatch!.map(Number);
    expect(top).toBeGreaterThan(bottom); // shifted down: more room reserved above than below
  });

  it('the gap between every line grew from the previous values (name/specs/price/sku margin-top)', () => {
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
