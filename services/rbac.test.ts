import { describe, it, expect } from 'vitest';
import { can, ROLE_PERMISSIONS } from './rbac';

describe('can()', () => {
  it('owner has every permission', () => {
    for (const p of ROLE_PERMISSIONS.owner) expect(can('owner', p)).toBe(true);
    expect(can('owner', 'users.manage')).toBe(true);
    expect(can('owner', 'inventory.delete')).toBe(true);
  });

  it('every permission an employee holds is also held by a manager — the roles stay nested', () => {
    // A shape check that outlives any individual grant: widening `employee`
    // past `manager` would be an obvious mistake, and this catches it.
    for (const p of ROLE_PERMISSIONS.employee) {
      expect(ROLE_PERMISSIONS.manager).toContain(p);
    }
  });

  it('manager lacks owner-only permissions', () => {
    expect(can('manager', 'inventory.edit')).toBe(true);
    expect(can('manager', 'users.manage')).toBe(false);
    expect(can('manager', 'backup.export')).toBe(false);
    expect(can('manager', 'settings.manage')).toBe(false);
  });

  it('A MANAGER MAY DELETE INVENTORY — the owner\'s decision', () => {
    // They already add and edit stock; what they could not do was remove a row
    // typed in twice. The oversight is the audit entry, not the block.
    expect(can('manager', 'inventory.delete')).toBe(true);
    // And it stops there: it is a manager-up permission, not an operational one.
    expect(can('employee', 'inventory.delete')).toBe(false);
    expect(can('technician', 'inventory.delete')).toBe(false);
    expect(can('kiosk', 'inventory.delete')).toBe(false);
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

  it('repair technician performance is owner + manager only', () => {
    expect(can('owner', 'repairs.performance')).toBe(true);
    expect(can('manager', 'repairs.performance')).toBe(true);
    expect(can('employee', 'repairs.performance')).toBe(false);
    expect(can('technician', 'repairs.performance')).toBe(false);
  });

  it('the end-of-day close-out summary is owner + manager only', () => {
    expect(can('owner', 'closeout.view')).toBe(true);
    expect(can('manager', 'closeout.view')).toBe(true);
    expect(can('employee', 'closeout.view')).toBe(false);
    expect(can('technician', 'closeout.view')).toBe(false);
  });

  it('assigning PINs (users.pin) and the auto-lock timer (security.manage) are owner + manager only', () => {
    expect(can('owner', 'users.pin')).toBe(true);
    expect(can('manager', 'users.pin')).toBe(true);
    expect(can('employee', 'users.pin')).toBe(false);
    expect(can('technician', 'users.pin')).toBe(false);

    expect(can('owner', 'security.manage')).toBe(true);
    expect(can('manager', 'security.manage')).toBe(true);
    expect(can('employee', 'security.manage')).toBe(false);
    expect(can('technician', 'security.manage')).toBe(false);
  });

  it('the two profit tiers are independent — summary access does not imply detailed', () => {
    // A manager (summary by default, no override) sees period totals but not
    // the deep historical/cost breakdowns.
    expect(can('manager', 'reports.profit.summary')).toBe(true);
    expect(can('manager', 'reports.profit.detailed')).toBe(false);
  });

  it('employee runs the shop end-to-end: the five operational permissions are granted', () => {
    // The grant: an employee can reverse a sale, fix an item they just
    // entered, close the drawer and settle a device buyer without a manager
    // present. Oversight is attribution + audit, not a gate. (Logging an
    // expense was part of this grant originally and has since been REVOKED —
    // expense amounts are cost/profit-sensitive; see the expense-split test.)
    expect(can('employee', 'sales.void')).toBe(true);
    expect(can('employee', 'sales.return')).toBe(true);
    expect(can('employee', 'inventory.edit')).toBe(true);
    expect(can('employee', 'cash.reconcile')).toBe(true);
    expect(can('employee', 'dropoffs.manage')).toBe(true);
    // …on top of what they already had.
    expect(can('employee', 'inventory.add')).toBe(true);
    expect(can('employee', 'sales.complete')).toBe(true);
    expect(can('employee', 'reports.view')).toBe(true);
    expect(can('employee', 'cash.log')).toBe(true);
    expect(can('employee', 'timeclock.use')).toBe(true);
  });

  it('the grant stops exactly where it was meant to — every listed permission stays manager/owner-only', () => {
    // Pinned deliberately: these are the ones the operational grant did NOT
    // include, and a future "just add one more" edit must trip this test.
    const stillRestricted = [
      'inventory.delete', 'users.manage', 'users.tech', 'users.pin',
      'security.manage', 'settings.manage', 'payroll.manage', 'backup.export',
      'staffNotes.manage', 'audit.view', 'closeout.view', 'repairs.performance',
    ] as const;
    for (const p of stillRestricted) {
      expect(can('employee', p)).toBe(false);
      expect(can('technician', p)).toBe(false);
      // …and the financials override doesn't sneak any of them in either.
      expect(can('employee', p, { allowProfit: true })).toBe(false);
    }
  });

  it('INTERACTION CHECK: no employee permission reaches user management or the password-reset function', () => {
    // The setStaffPassword Cloud Function is gated on the CALLER being an
    // owner, read server-side (functions/src/staffPasswordPolicy.ts). The UI
    // that can even reach it is gated on users.manage. Neither is anywhere in
    // the employee set — pin that here so widening the employee role can
    // never quietly open the password-reset path.
    expect(can('employee', 'users.manage')).toBe(false);
    expect(can('employee', 'users.tech')).toBe(false);
    expect(can('employee', 'users.pin')).toBe(false);
    expect(ROLE_PERMISSIONS.employee).not.toContain('users.manage');
    expect(ROLE_PERMISSIONS.employee).not.toContain('users.tech');
    expect(ROLE_PERMISSIONS.employee).not.toContain('users.pin');
    // Managers can manage technicians but still not reach the reset function.
    expect(can('manager', 'users.manage')).toBe(false);
    // canResetPasswordFor (domain/password.ts) is the UI-side mirror; it is
    // owner-only and never targets an owner. Covered in domain/password.test.ts.
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
    // …and PC builds, which is the one general-shop permission they hold.
    expect(can('technician', 'builds.manage')).toBe(true);
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

  it('logging a cash movement (cash.log) is for everyone who handles the register, not technicians', () => {
    // Owner, manager and employee all handle cash day-to-day.
    expect(can('owner', 'cash.log')).toBe(true);
    expect(can('manager', 'cash.log')).toBe(true);
    expect(can('employee', 'cash.log')).toBe(true);
    // Technicians don't touch the till.
    expect(can('technician', 'cash.log')).toBe(false);
    expect(can(undefined, 'cash.log')).toBe(false);
  });

  it('reconciling the cash drawer (cash.reconcile) is for everyone who runs the register; technicians never', () => {
    expect(can('owner', 'cash.reconcile')).toBe(true);
    expect(can('manager', 'cash.reconcile')).toBe(true);
    // Employees close their own drawer at end of shift — the reconciledBy
    // stamp + the 'cash.reconcile' audit entry are the oversight, not a gate.
    expect(can('employee', 'cash.reconcile')).toBe(true);
    expect(can('technician', 'cash.reconcile')).toBe(false);
  });

  it('reviewing the numbers is still separate from closing the drawer', () => {
    // Employees close the drawer, but the end-of-day summary that surfaces
    // variances across days stays owner/manager.
    expect(can('employee', 'cash.reconcile')).toBe(true);
    expect(can('employee', 'closeout.view')).toBe(false);
    expect(can('manager', 'closeout.view')).toBe(true);
  });

  it('an undefined role has no permissions', () => {
    expect(can(undefined, 'reports.view')).toBe(false);
  });

  it('the staff notes log (staffNotes.manage) is owner-only', () => {
    expect(can('owner', 'staffNotes.manage')).toBe(true);
    expect(can('manager', 'staffNotes.manage')).toBe(false);
    expect(can('employee', 'staffNotes.manage')).toBe(false);
    expect(can('technician', 'staffNotes.manage')).toBe(false);
    expect(can(undefined, 'staffNotes.manage')).toBe(false);
  });

  it('expenses.add (enter an expense) is owner + manager only', () => {
    expect(can('owner', 'expenses.add')).toBe(true);
    expect(can('manager', 'expenses.add')).toBe(true);
    expect(can('employee', 'expenses.add')).toBe(false);
    expect(can('technician', 'expenses.add')).toBe(false);
    expect(can(undefined, 'expenses.add')).toBe(false);
  });

  it('expenses.viewAll (browse the whole ledger + totals + recurring config) is OWNER ONLY', () => {
    expect(can('owner', 'expenses.viewAll')).toBe(true);
    expect(can('manager', 'expenses.viewAll')).toBe(false);
    expect(can('employee', 'expenses.viewAll')).toBe(false);
    expect(can('technician', 'expenses.viewAll')).toBe(false);
    expect(can(undefined, 'expenses.viewAll')).toBe(false);
  });

  it('a manager can ADD an expense but not browse the ledger — the whole point of the split', () => {
    expect(can('manager', 'expenses.add')).toBe(true);
    expect(can('manager', 'expenses.viewAll')).toBe(false);
  });

  it('employees have NO expense access anywhere — the old expenses.manage grant is fully revoked', () => {
    // Both halves, and the allowProfit override must not resurrect either:
    // allowProfit only ever moves the two reports.profit.* tiers.
    expect(can('employee', 'expenses.add')).toBe(false);
    expect(can('employee', 'expenses.viewAll')).toBe(false);
    expect(can('employee', 'expenses.add', { allowProfit: true })).toBe(false);
    expect(can('employee', 'expenses.viewAll', { allowProfit: true })).toBe(false);
    expect(can('technician', 'expenses.add', { allowProfit: true })).toBe(false);
    expect(can('technician', 'expenses.viewAll', { allowProfit: true })).toBe(false);
  });

  it('REGRESSION: no cost/margin/profit figure becomes visible to an employee from the operational grant', () => {
    // The grant added six operational permissions and touched NEITHER profit
    // tier. Both still require the per-user allowProfit override, exactly as
    // before — which is what keeps the inventory cost column, the AI
    // insights/chat ops (gated server-side by aiGenerate's
    // requireProfitVisibility) and the Reports profit surfaces closed.
    expect(can('employee', 'reports.profit.summary')).toBe(false);
    expect(can('employee', 'reports.profit.detailed')).toBe(false);
    expect(can('employee', 'reports.profit.summary', { allowProfit: false })).toBe(false);
    expect(can('employee', 'reports.profit.detailed', { allowProfit: false })).toBe(false);
    // The override still works, and still only for the profit tiers.
    expect(can('employee', 'reports.profit.summary', { allowProfit: true })).toBe(true);
    expect(can('employee', 'reports.profit.detailed', { allowProfit: true })).toBe(true);
    // Neither profit permission is baked into the role list itself.
    expect(ROLE_PERMISSIONS.employee).not.toContain('reports.profit.summary');
    expect(ROLE_PERMISSIONS.employee).not.toContain('reports.profit.detailed');
  });
});

/**
 * 'builds.manage' — the PC builds section's own permission.
 *
 * It shipped gated on 'inventory.add', which technicians do not hold, so the
 * people who actually build the machines could not open the section. This
 * block pins both halves of the fix: that they can now, and that it did not
 * quietly widen anything else.
 */
describe('builds.manage', () => {
  it('every human role holds it — a technician included', () => {
    for (const role of ['owner', 'manager', 'employee', 'technician'] as const) {
      expect({ role, can: can(role, 'builds.manage') }).toEqual({ role, can: true });
    }
  });

  it('A KIOSK STILL HAS NOTHING', () => {
    expect(can('kiosk', 'builds.manage')).toBe(false);
    // It holds no permission at all, which is the property this role exists for.
    expect(ROLE_PERMISSIONS.kiosk).toEqual([]);
  });

  it('is NOT inventory.add — a technician still has no general inventory access', () => {
    expect(can('technician', 'builds.manage')).toBe(true);
    expect(can('technician', 'inventory.add')).toBe(false);
    expect(can('technician', 'inventory.edit')).toBe(false);
    expect(can('technician', 'inventory.delete')).toBe(false);
  });

  it('grants a technician NOTHING ELSE they did not already have', () => {
    // The whole technician set, pinned. Adding to it must be deliberate.
    expect([...ROLE_PERMISSIONS.technician].sort())
      .toEqual(['builds.manage', 'repairs.tech', 'timeclock.use']);
  });

  it('does not make a technician financial — costs stay a separate decision', () => {
    // They may ENTER a part cost (write-only, "Recorded" afterwards — that is a
    // UI rule, not a permission). READING costs and margins is unchanged.
    expect(can('technician', 'reports.profit.detailed')).toBe(false);
    expect(can('technician', 'reports.profit.summary')).toBe(false);
    // And not even the per-user Financials override reaches a technician.
    expect(can('technician', 'reports.profit.detailed', { allowProfit: true })).toBe(false);
    expect(can('technician', 'reports.profit.summary', { allowProfit: true })).toBe(false);
  });

  it('a technician still cannot reach Reports, Quick Sale or anything else', () => {
    // The screens whose nav gates are next to the PC Builds one.
    for (const p of ['reports.view', 'sales.complete', 'cash.log', 'cash.reconcile',
      'dropoffs.manage', 'closeout.view', 'audit.view', 'settings.manage'] as const) {
      expect({ p, can: can('technician', p) }).toEqual({ p, can: false });
    }
  });
});
