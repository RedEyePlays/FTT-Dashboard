import { describe, it, expect } from 'vitest';
import { can, ROLE_PERMISSIONS } from './rbac';

describe('can()', () => {
  it('owner has every permission', () => {
    for (const p of ROLE_PERMISSIONS.owner) expect(can('owner', p)).toBe(true);
    expect(can('owner', 'users.manage')).toBe(true);
    expect(can('owner', 'inventory.delete')).toBe(true);
  });

  it('manager lacks owner-only permissions', () => {
    expect(can('manager', 'inventory.edit')).toBe(true);
    expect(can('manager', 'reports.profit')).toBe(true);
    expect(can('manager', 'users.manage')).toBe(false);
    expect(can('manager', 'inventory.delete')).toBe(false);
    expect(can('manager', 'backup.export')).toBe(false);
    expect(can('manager', 'settings.manage')).toBe(false);
  });

  it('employee has the minimal set', () => {
    expect(can('employee', 'inventory.add')).toBe(true);
    expect(can('employee', 'sales.complete')).toBe(true);
    expect(can('employee', 'reports.view')).toBe(true);
    expect(can('employee', 'inventory.edit')).toBe(false);
    expect(can('employee', 'dropoffs.manage')).toBe(false);
  });

  it('employee profit visibility requires the allowProfit override', () => {
    expect(can('employee', 'reports.profit')).toBe(false);
    expect(can('employee', 'reports.profit', { allowProfit: false })).toBe(false);
    expect(can('employee', 'reports.profit', { allowProfit: true })).toBe(true);
  });

  it('the allowProfit override does not grant unrelated permissions', () => {
    expect(can('employee', 'inventory.delete', { allowProfit: true })).toBe(false);
  });

  it('an undefined role has no permissions', () => {
    expect(can(undefined, 'reports.view')).toBe(false);
  });
});
