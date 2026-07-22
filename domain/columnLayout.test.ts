import { describe, it, expect } from 'vitest';
import { columnWidth, clampWidth, sanitizeWidths, tableWidth, ColSpec } from './columnLayout';

const cols: ColSpec[] = [
  { key: 'date', w: 116, min: 92, max: 140 },
  { key: 'item', w: 200, min: 160, flex: true },   // no max → default 800
  { key: 'imei', w: 156, min: 130, max: 240 },
  { key: 'notes', w: 200, min: 150, flex: true },
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
    expect(clampWidth(cols[2], 10)).toBe(130);
    expect(clampWidth(cols[2], 175)).toBe(175);
  });
});

describe('resizing is independent', () => {
  it('changes only the resized column; others keep their widths', () => {
    const before = cols.map(c => columnWidth(c, {}));
    const stored = { item: 320 };
    const after = cols.map(c => columnWidth(c, stored));
    expect(after[1]).toBe(320);                 // item changed
    expect(after[0]).toBe(before[0]);           // date unchanged
    expect(after[2]).toBe(before[2]);           // imei unchanged
    expect(after[3]).toBe(before[3]);           // notes unchanged
  });
  it('total width grows by exactly the resize delta', () => {
    const t0 = tableWidth(cols, ACT, {});
    const t1 = tableWidth(cols, ACT, { item: 200 + 130 });
    expect(t1 - t0).toBe(130);
  });
});

describe('sanitizeWidths', () => {
  it('drops invalid/unknown values and clamps the rest', () => {
    const out = sanitizeWidths(cols, { date: NaN, imei: 9999, item: 10, notes: 500, bogus: 120 } as any);
    expect(out.date).toBeUndefined();
    expect(out.imei).toBe(240);   // clamped to max
    expect(out.item).toBe(160);   // clamped to min
    expect(out.notes).toBe(500);  // valid (≤ default max 800)
    expect((out as any).bogus).toBeUndefined();
  });
  it('returns empty for missing/invalid data', () => {
    expect(sanitizeWidths(cols, null)).toEqual({});
    expect(sanitizeWidths(cols, undefined)).toEqual({});
  });
});
