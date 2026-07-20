import { describe, it, expect } from 'vitest';
import { mergeSettings, DEFAULT_SETTINGS } from './settings';

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
});
