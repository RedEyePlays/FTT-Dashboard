import { describe, it, expect } from 'vitest';
import { auditActionLabel, AUDIT_ACTION_LABELS, changedSettingsSections } from './audit';
import { mergeSettings } from './settings';
import { AppSettings } from './settings';

describe('auditActionLabel', () => {
  it('maps known actions to readable labels', () => {
    expect(auditActionLabel('user.role_change')).toBe('Role changed');
    expect(auditActionLabel('sale.complete')).toBe('Sale completed');
    expect(auditActionLabel('inventory.delete')).toBe('Item deleted');
    expect(auditActionLabel('settings.update')).toBe('Settings updated');
    expect(auditActionLabel('backup.export')).toBe('Backup exported');
    expect(auditActionLabel('user.invite_revoke')).toBe('Invite revoked');
  });

  it('never returns the raw dotted token — falls back to a prettified label', () => {
    // Dynamic per-field tech actions have no explicit entry.
    const label = auditActionLabel('repair.tech.diagnostics');
    expect(label).toBe('Repair tech diagnostics');
    expect(label).not.toContain('.');
    // A totally unknown action still reads as a sentence, not a token.
    expect(auditActionLabel('some.new_action')).toBe('Some new action');
    expect(auditActionLabel('mystery')).toBe('Mystery');
  });

  it('has a label for every user-management, deletion, settings and backup action in scope', () => {
    for (const a of [
      'user.role_change', 'user.disable', 'user.enable', 'user.set_rate', 'user.invite', 'user.invite_revoke',
      'inventory.delete', 'repair.delete', 'batch.delete', 'customer.merge',
      'settings.update', 'sale.complete', 'backup.export',
    ]) {
      expect(AUDIT_ACTION_LABELS[a]).toBeTruthy();
    }
  });
});

describe('changedSettingsSections', () => {
  const base: AppSettings = mergeSettings();

  it('returns nothing when settings are unchanged', () => {
    expect(changedSettingsSections(base, mergeSettings())).toEqual([]);
  });

  it('reports only the sections that actually changed, sorted', () => {
    const next: AppSettings = {
      ...base,
      tax: { ...base.tax, percent: 15 },
      labels: { ...base.labels, defaultSize: 'dymo-11x54' },
    };
    expect(changedSettingsSections(base, next)).toEqual(['labels', 'tax']);
  });

  it('detects a single-section change', () => {
    const next: AppSettings = { ...base, appearance: { ...base.appearance, theme: 'dark' } };
    expect(changedSettingsSections(base, next)).toEqual(['appearance']);
  });

  it('handles missing snapshots without throwing', () => {
    expect(changedSettingsSections(undefined, undefined)).toEqual([]);
    // Every populated section shows as changed when there was no prior value.
    expect(changedSettingsSections(undefined, base).length).toBeGreaterThan(0);
  });
});
