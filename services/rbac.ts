import { Role, Permission } from '../types';

// Pure role/permission logic — no Firebase imports, so it's cheap and testable.
const ALL: Permission[] = [
  'inventory.add', 'inventory.edit', 'inventory.delete',
  'sales.complete', 'dropoffs.manage', 'repairs.manage', 'repairs.tech',
  'reports.view', 'reports.profit',
  'users.manage', 'users.tech', 'audit.view', 'backup.export', 'settings.manage',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  manager: [
    'inventory.add', 'inventory.edit',
    'sales.complete', 'dropoffs.manage', 'repairs.manage', 'repairs.tech',
    'reports.view', 'audit.view', 'users.tech',
    // NOTE: 'reports.profit' is intentionally NOT granted by default — managers
    // see financials (profit / margins / analytics) only when an owner enables
    // the per-user allowProfit override. Handled in can() below.
  ],
  employee: [
    'inventory.add', 'sales.complete', 'repairs.manage', 'repairs.tech', 'reports.view',
  ],
  // Technicians get a repair-only, profit-free experience.
  technician: [
    'repairs.tech',
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner', manager: 'Manager', employee: 'Employee', technician: 'Technician',
};

// can(role, permission, { allowProfit }) — only owners see profit-sensitive
// figures by default. Managers and employees see them only when explicitly
// granted the per-user allowProfit override; technicians never.
export const can = (
  role: Role | undefined,
  perm: Permission,
  opts?: { allowProfit?: boolean },
): boolean => {
  if (!role) return false;
  if (perm === 'reports.profit') {
    if (role === 'owner') return true;
    if (role === 'manager' || role === 'employee') return !!opts?.allowProfit;
    return false; // technician
  }
  return ROLE_PERMISSIONS[role].includes(perm);
};
