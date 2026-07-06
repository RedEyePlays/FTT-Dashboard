import { Role, Permission } from '../types';

// Pure role/permission logic — no Firebase imports, so it's cheap and testable.
const ALL: Permission[] = [
  'inventory.add', 'inventory.edit', 'inventory.delete',
  'sales.complete', 'dropoffs.manage', 'repairs.manage',
  'reports.view', 'reports.profit',
  'users.manage', 'audit.view', 'backup.export', 'settings.manage',
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: ALL,
  manager: [
    'inventory.add', 'inventory.edit',
    'sales.complete', 'dropoffs.manage', 'repairs.manage',
    'reports.view', 'reports.profit', 'audit.view',
  ],
  employee: [
    'inventory.add', 'sales.complete', 'repairs.manage', 'reports.view',
  ],
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner', manager: 'Manager', employee: 'Employee',
};

// can(role, permission, { allowProfit }) — employees can only see profit-sensitive
// figures when explicitly granted the per-user override.
export const can = (
  role: Role | undefined,
  perm: Permission,
  opts?: { allowProfit?: boolean },
): boolean => {
  if (!role) return false;
  if (perm === 'reports.profit' && role === 'employee') return !!opts?.allowProfit;
  return ROLE_PERMISSIONS[role].includes(perm);
};
