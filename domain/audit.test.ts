import { describe, it, expect } from 'vitest';
import { auditActionLabel, AUDIT_ACTION_LABELS, changedSettingsSections, CRITICAL_AUDIT_ACTIONS, isCriticalAuditAction, auditChangeSummary, auditExportRows } from './audit';
import { mergeSettings } from './settings';
import { AppSettings } from './settings';
import { AuditEntry } from '../types';

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

describe('isCriticalAuditAction', () => {
  it('flags every action in the confirmed critical list', () => {
    for (const a of CRITICAL_AUDIT_ACTIONS) expect(isCriticalAuditAction(a)).toBe(true);
  });
  it('flags the specific sensitive actions named in spec: voids/returns, PIN/role/profit-access, drawer reconcile, settings', () => {
    expect(isCriticalAuditAction('sale.void')).toBe(true);
    expect(isCriticalAuditAction('sale.return')).toBe(true);
    expect(isCriticalAuditAction('user.set_pin')).toBe(true);
    expect(isCriticalAuditAction('user.role_change')).toBe(true);
    expect(isCriticalAuditAction('user.allow_profit')).toBe(true);
    expect(isCriticalAuditAction('cash.reconcile')).toBe(true);
    expect(isCriticalAuditAction('settings.update')).toBe(true);
  });
  it('does not flag routine, non-sensitive actions', () => {
    expect(isCriticalAuditAction('inventory.add')).toBe(false);
    expect(isCriticalAuditAction('sale.complete')).toBe(false);
    expect(isCriticalAuditAction('repair.edit')).toBe(false);
    expect(isCriticalAuditAction('timeclock.clock_in')).toBe(false);
  });
});

describe('auditChangeSummary', () => {
  it('renders a clean one-line diff for a simple field change', () => {
    expect(auditChangeSummary({ status: 'in_repair' }, { status: 'picked_up' })).toBe('status: in_repair → picked_up');
  });
  it('renders multiple changed fields, sorted by key', () => {
    expect(auditChangeSummary({ b: 1, a: 1 }, { b: 2, a: 2 })).toBe('a: 1 → 2, b: 1 → 2');
  });
  it('handles a create (after only) and a value-only after, not requiring a before', () => {
    expect(auditChangeSummary(undefined, { repairNumber: 'RPR-1', status: 'received' })).toBe('repairNumber: RPR-1, status: received');
  });
  it('renders empty/null/undefined values as an em dash', () => {
    expect(auditChangeSummary({ notes: '' }, { notes: 'now has notes' })).toBe('notes: — → now has notes');
    expect(auditChangeSummary({ x: undefined }, { x: null })).toBe('x: — → —');
  });
  it('returns null for both sides missing', () => {
    expect(auditChangeSummary(undefined, undefined)).toBeNull();
  });
  it('falls back to null (raw JSON view) for a nested/complex value — not a misleading one-liner', () => {
    expect(auditChangeSummary({ testChecks: ['a'] }, { testChecks: ['a', 'b'] })).toBeNull();
    expect(auditChangeSummary({ address: { city: 'X' } }, { address: { city: 'Y' } })).toBeNull();
  });
});

describe('auditExportRows', () => {
  const entry = (p: Partial<AuditEntry>): AuditEntry => ({
    id: 'e1', ts: Date.parse('2026-08-25T12:00:00Z'), userId: 'u1', userEmail: 'owner@shop.com',
    action: 'repair.status_change', entityType: 'repair', entityId: 'r1',
    before: { status: 'in_repair' }, after: { status: 'picked_up' }, ...p,
  });

  it('produces one CSV-ready row per entry with a readable action label and change summary', () => {
    const rows = auditExportRows([entry({})]);
    expect(rows).toHaveLength(1);
    expect(rows[0].Action).toBe('Repair status changed');
    expect(rows[0].User).toBe('owner@shop.com');
    expect(rows[0].Entity).toBe('repair');
    expect(rows[0]['Entity ID']).toBe('r1');
    expect(rows[0].Change).toBe('status: in_repair → picked_up');
  });

  it('falls back to raw before/after JSON in the Change column for a complex change', () => {
    const rows = auditExportRows([entry({ before: { testChecks: ['a'] }, after: { testChecks: ['a', 'b'] } })]);
    expect(rows[0].Change).toContain('before:');
    expect(rows[0].Change).toContain('after:');
  });

  it('respects whatever set it is given — export always matches the caller\'s filtered list', () => {
    const all = [entry({ id: '1', action: 'sale.void' }), entry({ id: '2', action: 'inventory.add' })];
    const filtered = all.filter(e => e.action === 'sale.void');
    expect(auditExportRows(filtered)).toHaveLength(1);
    expect(auditExportRows(all)).toHaveLength(2);
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
