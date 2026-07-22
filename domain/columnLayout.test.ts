import { describe, it, expect } from 'vitest';
import { columnWidth, clampWidth, sanitizeWidths, fitWidths, ColSpec } from './columnLayout';

const cols: ColSpec[] = [
  { key: 'date', w: 116, min: 92, max: 140 },
  { key: 'item', w: 200, min: 120, max: 400 },
  { key: 'imei', w: 156, min: 100, max: 240 },
  { key: 'notes', w: 200, min: 100, max: 300 },
];
const ACT = 100;

describe('columnWidth', () => {
  it('uses the default when there is no override', () => {
    expect(columnWidth(cols[0])).toBe(116);
    expect(columnWidth(cols[1], {})).toBe(200);
  });
  it('uses a valid override, clamped to bounds', () => {
    expect(columnWidth(cols[2], { imei: 200 })).toBe(200);
    expect(columnWidth(cols[2], { imei: 999 })).toBe(240);  // > max
    expect(columnWidth(cols[0], { date: 10 })).toBe(92);    // < min
  });
  it('ignores invalid overrides', () => {
    expect(columnWidth(cols[0], { date: NaN } as any)).toBe(116);
    expect(columnWidth(cols[0], { date: -5 })).toBe(116);
  });
});

describe('clampWidth', () => {
  it('clamps to the column min/max', () => {
    expect(clampWidth(cols[2], 500)).toBe(240);
    expect(clampWidth(cols[2], 10)).toBe(100);
    expect(clampWidth(cols[3], 999)).toBe(300);  // notes capped at 300
  });
});

describe('fitWidths — everything fits', () => {
  it('keeps requested widths and exposes the leftover as spacer', () => {
    // sum = 116+200+156+200 = 672; + actions 100 = 772
    const r = fitWidths(cols, ACT, 1000, {});
    expect(r.widths.date).toBe(116);
    expect(r.widths.item).toBe(200);
    expect(r.total).toBe(772);
    expect(r.spacer).toBe(228);            // 1000 - 772
  });
  it('resizing one column does not change the others', () => {
    const base = fitWidths(cols, ACT, 1000, {});
    const grown = fitWidths(cols, ACT, 1000, { item: 320 });
    expect(grown.widths.item).toBe(320);
    expect(grown.widths.date).toBe(base.widths.date);
    expect(grown.widths.imei).toBe(base.widths.imei);
    expect(grown.widths.notes).toBe(base.widths.notes);
    expect(grown.spacer).toBe(base.spacer - 120); // grew into the spacer only
  });
});

describe('fitWidths — bounded to the container', () => {
  it('never exceeds the container: spacer stays ≥ 0 and total ≤ container', () => {
    const r = fitWidths(cols, ACT, 620, {});   // 620 < natural 772
    expect(r.spacer).toBe(0);
    expect(r.total).toBeLessThanOrEqual(620);
  });
  it('shrinks proportionally toward mins, never below them', () => {
    const r = fitWidths(cols, ACT, 620, {});
    for (const c of cols) expect(r.widths[c.key]).toBeGreaterThanOrEqual(c.min!);
    expect(r.total).toBeLessThanOrEqual(620);
  });
  it('clamps stale over-wide saved widths back into the container', () => {
    const r = fitWidths(cols, ACT, 700, { item: 9999, notes: 9999 });
    expect(r.total).toBeLessThanOrEqual(700);
    expect(r.widths.item).toBeLessThanOrEqual(400); // own max first
    expect(r.widths.notes).toBeLessThanOrEqual(300);
  });
  it('falls back to mins when even those overflow (no negative spacer)', () => {
    const r = fitWidths(cols, ACT, 300, {}); // impossibly narrow
    expect(r.spacer).toBe(0);
    for (const c of cols) expect(r.widths[c.key]).toBe(c.min);
  });
});

describe('sanitizeWidths', () => {
  it('drops invalid/unknown values and clamps the rest', () => {
    const out = sanitizeWidths(cols, { date: NaN, imei: 9999, item: 10, notes: 999, bogus: 120 } as any);
    expect(out.date).toBeUndefined();
    expect(out.imei).toBe(240);   // clamped to max
    expect(out.item).toBe(120);   // clamped to min
    expect(out.notes).toBe(300);  // clamped to notes max 300
    expect((out as any).bogus).toBeUndefined();
  });
  it('returns empty for missing/invalid data', () => {
    expect(sanitizeWidths(cols, null)).toEqual({});
    expect(sanitizeWidths(cols, undefined)).toEqual({});
  });
});
