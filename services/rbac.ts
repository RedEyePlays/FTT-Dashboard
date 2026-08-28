import { Role, Permission } from '../types';

// Pure role/permission logic — no Firebase imports, so it's cheap and testable.
const ALL: Permission[] = [
  'inventory.add', 'inventory.edit', 'inventory.delete',
  'sales.complete', 'sales.void', 'sales.return', 'dropoffs.manage', 'repairs.manage', 'repairs.tech', 'repairs.performance',
  'cash.log', 'cash.reconcile',
  'reports.view', 'reports.profit.summary', 'reports.profit.detailed',
  'users.manage', 'users.tech', 'users.pin', 'security.manage', 'timeclock.use', 'payroll.manage', 'closeout.view',
  'audit.view', 'backup.export', 'settings.manage', 'staffNotes.manage',
  'expenses.add', 'expenses.viewAll',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  manager: [
    'inventory.add', 'inventory.edit',
    'sales.complete', 'sales.void', 'sales.return', 'dropoffs.manage', 'repairs.manage', 'repairs.tech', 'repairs.performance',
    'cash.log', 'cash.reconcile',
    'reports.view', 'audit.view', 'users.tech', 'users.pin', 'security.manage',
    'timeclock.use', 'payroll.manage', 'closeout.view',
    // A manager may ENTER an expense but not browse the ledger: 'expenses.add'
    // without 'expenses.viewAll'. Their Expenses tab shows only rows they
    // entered themselves (filtered on the server-stamped `enteredBy`), with no
    // workspace totals, no category breakdown and no recurring-template
    // configuration — those are owner-only.
    'expenses.add',
    // NOTE: the profit permissions are handled specially in can() below, not
    // listed here. Managers get 'reports.profit.summary' by default (daily/weekly
    // totals), but 'reports.profit.detailed' (full history + per-record cost/
    // profit) only when an owner enables the per-user allowProfit override.
  ],
  // Employees run the shop end-to-end. The owner's explicit decision is that
  // the operational actions below are NOT gated behind a manager — oversight
  // comes from attribution + the audit log (every void/return/reconcile/
  // settlement stamps the acting user on the record AND writes an
  // auditLogs entry), not from blocking the action at the counter.
  //
  // What deliberately stays manager/owner-only: inventory.delete, all of
  // users.*, security.manage, settings.manage, payroll.manage, backup.export,
  // staffNotes.manage, audit.view, closeout.view, repairs.performance, BOTH
  // expense permissions (an employee has no expense access at all — no entry,
  // no tab, no read; expense amounts are cost/profit-sensitive), and
  // BOTH profit tiers (see can() below — employees still see no cost, margin
  // or profit figure anywhere without the per-user allowProfit override).
  employee: [
    'inventory.add', 'inventory.edit',
    'sales.complete', 'sales.void', 'sales.return', 'dropoffs.manage',
    'repairs.manage', 'repairs.tech', 'reports.view',
    'cash.log',        // log a cash in/out / withdrawal at the register
    'cash.reconcile',  // count and close the drawer at end of shift
    'timeclock.use',
  ],
  // Technicians get a repair-only, profit-free experience — but still clock in.
  technician: [
    'repairs.tech', 'timeclock.use',
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner', manager: 'Manager', employee: 'Employee', technician: 'Technician',
};

// can(role, permission, { allowProfit }) — profit visibility is split into two
// tiers:
//   • reports.profit.summary  — period revenue/profit totals (Dashboard cards).
//     Owner + manager by default; employees only via the allowProfit override.
//   • reports.profit.detailed — full historical breakdowns and per-record cost/
//     profit (Owner Analytics, checkout cost panel, customer/inventory figures).
//     Owner by default; manager/employee only via the allowProfit override.
// Technicians never see either. The per-user allowProfit override grants a
// manager/employee the tier(s) they lack by default.
export const can = (
  role: Role | undefined,
  perm: Permission,
  opts?: { allowProfit?: boolean },
): boolean => {
  if (!role) return false;
  if (perm === 'reports.profit.summary') {
    if (role === 'owner' || role === 'manager') return true;
    if (role === 'employee') return !!opts?.allowProfit;
    return false; // technician
  }
  if (perm === 'reports.profit.detailed') {
    if (role === 'owner') return true;
    if (role === 'manager' || role === 'employee') return !!opts?.allowProfit;
    return false; // technician
  }
  return ROLE_PERMISSIONS[role].includes(perm);
};

/**
 * Who may print a drop-off device label. Those labels carry the device's
 * purchase price and the store's service fee — profit-sensitive figures — so
 * printing is gated to the same permission that already exposes drop-off
 * financials on screen.
 *
 * It lives HERE, and not next to the label itself in services/dropOffLabel.ts,
 * for a concrete reason: App.tsx needs the gate to decide whether to offer the
 * action, and dropOffLabel.ts pulls in the `qrcode` library. Importing the gate
 * from there would drag QR generation into the main bundle, when it currently
 * only ever loads inside the lazy label/drop-off chunks (measured: +37 kB raw
 * / +14 kB gzip on the main chunk before this was moved).
 */
export const canPrintDropOffLabel = (role: Role | undefined): boolean => can(role, 'dropoffs.manage');
