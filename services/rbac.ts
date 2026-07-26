import { Role, Permission } from '../types';

// Pure role/permission logic — no Firebase imports, so it's cheap and testable.
const ALL: Permission[] = [
  'inventory.add', 'inventory.edit', 'inventory.delete',
  'sales.complete', 'dropoffs.manage', 'repairs.manage', 'repairs.tech',
  'reports.view', 'reports.profit.summary', 'reports.profit.detailed',
  'users.manage', 'users.tech', 'timeclock.use', 'payroll.manage',
  'audit.view', 'backup.export', 'settings.manage',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  manager: [
    'inventory.add', 'inventory.edit',
    'sales.complete', 'dropoffs.manage', 'repairs.manage', 'repairs.tech',
    'reports.view', 'audit.view', 'users.tech',
    'timeclock.use', 'payroll.manage',
    // NOTE: the profit permissions are handled specially in can() below, not
    // listed here. Managers get 'reports.profit.summary' by default (daily/weekly
    // totals), but 'reports.profit.detailed' (full history + per-record cost/
    // profit) only when an owner enables the per-user allowProfit override.
  ],
  employee: [
    'inventory.add', 'sales.complete', 'repairs.manage', 'repairs.tech', 'reports.view',
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
