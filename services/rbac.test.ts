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
    expect(can('manager', 'users.manage')).toBe(false);
    expect(can('manager', 'inventory.delete')).toBe(false);
    expect(can('manager', 'backup.export')).toBe(false);
    expect(can('manager', 'settings.manage')).toBe(false);
  });

  it('profit summary (period totals) is an owner + manager default; employees need the override', () => {
    expect(can('owner', 'reports.profit.summary')).toBe(true);
    // Managers now see the daily/weekly Dashboard totals by default.
    expect(can('manager', 'reports.profit.summary')).toBe(true);
    expect(can('manager', 'reports.profit.summary', { allowProfit: false })).toBe(true);
    // Employees only via the per-user allowProfit override.
    expect(can('employee', 'reports.profit.summary')).toBe(false);
    expect(can('employee', 'reports.profit.summary', { allowProfit: true })).toBe(true);
    // Technicians never.
    expect(can('technician', 'reports.profit.summary', { allowProfit: true })).toBe(false);
  });

  it('detailed profit (full history & costs) is owner-default; manager/employee need the override', () => {
    expect(can('owner', 'reports.profit.detailed')).toBe(true);
    expect(can('manager', 'reports.profit.detailed')).toBe(false);
    expect(can('manager', 'reports.profit.detailed', { allowProfit: true })).toBe(true);
    expect(can('employee', 'reports.profit.detailed')).toBe(false);
    expect(can('employee', 'reports.profit.detailed', { allowProfit: true })).toBe(true);
    expect(can('technician', 'reports.profit.detailed', { allowProfit: true })).toBe(false);
  });

  it('the two profit tiers are independent — summary access does not imply detailed', () => {
    // A manager (summary by default, no override) sees period totals but not
    // the deep historical/cost breakdowns.
    expect(can('manager', 'reports.profit.summary')).toBe(true);
    expect(can('manager', 'reports.profit.detailed')).toBe(false);
  });

  it('employee has the minimal set', () => {
    expect(can('employee', 'inventory.add')).toBe(true);
    expect(can('employee', 'sales.complete')).toBe(true);
    expect(can('employee', 'reports.view')).toBe(true);
    expect(can('employee', 'inventory.edit')).toBe(false);
    expect(can('employee', 'dropoffs.manage')).toBe(false);
  });

  it('employee profit visibility (both tiers) requires the allowProfit override', () => {
    expect(can('employee', 'reports.profit.summary')).toBe(false);
    expect(can('employee', 'reports.profit.summary', { allowProfit: false })).toBe(false);
    expect(can('employee', 'reports.profit.summary', { allowProfit: true })).toBe(true);
    expect(can('employee', 'reports.profit.detailed')).toBe(false);
    expect(can('employee', 'reports.profit.detailed', { allowProfit: false })).toBe(false);
    expect(can('employee', 'reports.profit.detailed', { allowProfit: true })).toBe(true);
  });

  it('the allowProfit override does not grant unrelated permissions', () => {
    expect(can('employee', 'inventory.delete', { allowProfit: true })).toBe(false);
  });

  it('technician is repair-scoped and profit-free', () => {
    // Can do the repair work…
    expect(can('technician', 'repairs.tech')).toBe(true);
    // …but not full repair management, financials, inventory, users, or settings.
    expect(can('technician', 'repairs.manage')).toBe(false);
    expect(can('technician', 'reports.profit.summary')).toBe(false);
    expect(can('technician', 'reports.profit.detailed')).toBe(false);
    expect(can('technician', 'reports.view')).toBe(false);
    expect(can('technician', 'inventory.add')).toBe(false);
    expect(can('technician', 'inventory.delete')).toBe(false);
    expect(can('technician', 'sales.complete')).toBe(false);
    expect(can('technician', 'users.manage')).toBe(false);
    expect(can('technician', 'users.tech')).toBe(false);
    expect(can('technician', 'settings.manage')).toBe(false);
  });

  it('owner and manager can manage technician accounts; employees cannot', () => {
    expect(can('owner', 'users.tech')).toBe(true);
    expect(can('manager', 'users.tech')).toBe(true);
    expect(can('employee', 'users.tech')).toBe(false);
    // Full user management stays owner-only.
    expect(can('manager', 'users.manage')).toBe(false);
  });

  it('all roles that touch repairs have repairs.tech', () => {
    for (const role of ['owner', 'manager', 'employee', 'technician'] as const) {
      expect(can(role, 'repairs.tech')).toBe(true);
    }
  });

  it('every active role can use the time clock', () => {
    for (const role of ['owner', 'manager', 'employee', 'technician'] as const) {
      expect(can(role, 'timeclock.use')).toBe(true);
    }
    expect(can(undefined, 'timeclock.use')).toBe(false);
  });

  it('payroll summary is owner + manager only', () => {
    expect(can('owner', 'payroll.manage')).toBe(true);
    expect(can('manager', 'payroll.manage')).toBe(true);
    expect(can('employee', 'payroll.manage')).toBe(false);
    expect(can('technician', 'payroll.manage')).toBe(false);
    // The override for financials does not unlock payroll.
    expect(can('employee', 'payroll.manage', { allowProfit: true })).toBe(false);
  });

  it('an undefined role has no permissions', () => {
    expect(can(undefined, 'reports.view')).toBe(false);
  });
});
