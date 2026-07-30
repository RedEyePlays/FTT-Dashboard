import { describe, it, expect } from 'vitest';
import { mergeSettings, DEFAULT_SETTINGS, BUILT_IN_LABEL_SIZES, mergeLabelSizes, LabelSize } from './settings';

describe('mergeSettings', () => {
  it('returns defaults when nothing is stored', () => {
    expect(mergeSettings()).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it('layers a stored partial over the defaults (forward-compatible)', () => {
    const merged = mergeSettings({ general: { storeName: 'My Shop' } as any });
    expect(merged.general.storeName).toBe('My Shop');
    // untouched fields fall back to defaults
    expect(merged.general.currency).toBe(DEFAULT_SETTINGS.general.currency);
    expect(merged.tax).toEqual(DEFAULT_SETTINGS.tax);
  });

  it('deep-merges the dashboard widgets map', () => {
    const merged = mergeSettings({ dashboard: { widgets: { inventory: false } } as any });
    expect(merged.dashboard.widgets.inventory).toBe(false);
    // other widgets keep their default (true)
    expect(merged.dashboard.widgets.repairs).toBe(true);
  });

  it('replaces list fields wholesale when provided', () => {
    const merged = mergeSettings({ customers: { defaultTags: ['A'] } as any });
    expect(merged.customers.defaultTags).toEqual(['A']);
  });

  it('keeps default repair statuses when the stored list is empty', () => {
    const merged = mergeSettings({ repairStatuses: [] });
    expect(merged.repairStatuses).toEqual(DEFAULT_SETTINGS.repairStatuses);
  });

  it('uses a stored repair-status list when present', () => {
    const custom = [{ key: 'received' as const, label: 'Intake', color: 'blue' }];
    const merged = mergeSettings({ repairStatuses: custom });
    expect(merged.repairStatuses).toEqual(custom);
  });

  it('does not mutate DEFAULT_SETTINGS', () => {
    mergeSettings({ tax: { percent: 5 } as any });
    expect(DEFAULT_SETTINGS.tax.percent).toBe(13);
  });

  it('defaults labels to the built-in size id and an empty custom list', () => {
    const m = mergeSettings();
    expect(m.labels.defaultSize).toBe('dymo-36x89');
    expect(m.labels.customSizes).toEqual([]);
  });

  it('preserves stored custom label sizes', () => {
    const custom: LabelSize[] = [{ id: 'custom-3x2', label: '3 × 2 thermal', w: 3, h: 2 }];
    const m = mergeSettings({ labels: { customSizes: custom } as any });
    expect(m.labels.customSizes).toEqual(custom);
    // other label fields still fall back to defaults
    expect(m.labels.barcodeFormat).toBe(DEFAULT_SETTINGS.labels.barcodeFormat);
  });

  it('defaults qrContent to SKU', () => {
    expect(mergeSettings().labels.qrContent).toBe('sku');
  });

  it('preserves each supported qrContent option, including the new imei', () => {
    for (const qr of ['sku', 'id', 'url', 'imei'] as const) {
      const m = mergeSettings({ labels: { qrContent: qr } as any });
      expect(m.labels.qrContent).toBe(qr);
    }
  });

  it('defaults automated backups to off, daily, keep-14', () => {
    const b = mergeSettings().backups;
    expect(b).toEqual({ enabled: false, frequency: 'daily', retention: 14 });
  });

  it('preserves stored backup config over the defaults', () => {
    const b = mergeSettings({ backups: { enabled: true, frequency: 'weekly', retention: 30 } as any }).backups;
    expect(b).toEqual({ enabled: true, frequency: 'weekly', retention: 30 });
    // a partial patch still fills the rest from defaults
    expect(mergeSettings({ backups: { enabled: true } as any }).backups).toEqual({ enabled: true, frequency: 'daily', retention: 14 });
  });

  it('defaults operations to same-day void, no float, no restocking fee, 30-day aging', () => {
    expect(mergeSettings().operations).toEqual({
      openingFloatDefault: 0, voidWindowDays: 0, returnRestockingFeePercent: 0, agingInventoryDays: 30,
    });
  });

  it('merges a partial operations patch over the defaults', () => {
    const o = mergeSettings({ operations: { voidWindowDays: 3, returnRestockingFeePercent: 15 } as any }).operations;
    expect(o).toEqual({ openingFloatDefault: 0, voidWindowDays: 3, returnRestockingFeePercent: 15, agingInventoryDays: 30 });
  });
});

describe('label sizes', () => {
  it('ships the 5 built-in presets with the expected ids (unchanged)', () => {
    expect(BUILT_IN_LABEL_SIZES.map(s => s.id)).toEqual(['dymo-36x89', '2x1', '2x2', '2x3', '4x6']);
    const dymo = BUILT_IN_LABEL_SIZES.find(s => s.id === 'dymo-36x89')!;
    expect(dymo.dymo).toBe(true);
    expect(dymo.w).toBeCloseTo(89 / 25.4);
    expect(dymo.h).toBeCloseTo(36 / 25.4);
    // the inch presets keep their exact inch dimensions
    expect(BUILT_IN_LABEL_SIZES.find(s => s.id === '2x1')).toMatchObject({ w: 2, h: 1 });
    expect(BUILT_IN_LABEL_SIZES.find(s => s.id === '4x6')).toMatchObject({ w: 4, h: 6 });
  });

  describe('mergeLabelSizes', () => {
    it('returns just the built-ins when there are no custom sizes', () => {
      const merged = mergeLabelSizes();
      expect(merged.map(s => s.id)).toEqual(['dymo-36x89', '2x1', '2x2', '2x3', '4x6']);
      expect(merged.every(s => s.custom === false)).toBe(true);
    });

    it('appends valid custom sizes after the built-ins, tagged custom', () => {
      const merged = mergeLabelSizes([{ id: 'custom-3x2', label: '3 × 2', w: 3, h: 2, dymo: true }]);
      expect(merged).toHaveLength(6);
      const c = merged[5];
      expect(c).toMatchObject({ id: 'custom-3x2', label: '3 × 2', w: 3, h: 2, dymo: true, custom: true });
      // the 5 built-ins are unaffected
      expect(merged.slice(0, 5).map(s => s.id)).toEqual(['dymo-36x89', '2x1', '2x2', '2x3', '4x6']);
    });

    it('never lets a custom size override or duplicate a built-in id', () => {
      const merged = mergeLabelSizes([{ id: '2x1', label: 'Hijack', w: 9, h: 9 }]);
      expect(merged).toHaveLength(5);
      expect(merged.find(s => s.id === '2x1')).toMatchObject({ w: 2, h: 1, custom: false });
    });

    it('drops invalid custom entries (missing id or non-positive dimensions)', () => {
      const merged = mergeLabelSizes([
        { id: '', label: 'no id', w: 2, h: 2 } as LabelSize,
        { id: 'bad-w', label: 'bad', w: 0, h: 2 } as LabelSize,
        { id: 'bad-h', label: 'bad', w: 2, h: -1 } as LabelSize,
        { id: 'ok', label: 'Fine', w: 2.5, h: 1.5 },
      ]);
      expect(merged.map(s => s.id)).toEqual(['dymo-36x89', '2x1', '2x2', '2x3', '4x6', 'ok']);
    });

    it('dedupes repeated custom ids (first wins)', () => {
      const merged = mergeLabelSizes([
        { id: 'dup', label: 'First', w: 2, h: 2 },
        { id: 'dup', label: 'Second', w: 3, h: 3 },
      ]);
      expect(merged.filter(s => s.id === 'dup')).toHaveLength(1);
      expect(merged.find(s => s.id === 'dup')).toMatchObject({ label: 'First', w: 2, h: 2 });
    });
  });
});
