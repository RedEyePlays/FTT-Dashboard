import { Repair, RepairBatch, RepairStatus } from '../types';

// --- Numbering prefixes (reuse the meta.skuCounters mechanism) ---
export const REPAIR_PREFIX = 'RPR';
export const BATCH_PREFIX = 'WB';

// --- Statuses ---
export const REPAIR_STATUSES: { value: RepairStatus; label: string }[] = [
  { value: 'received', label: 'Received' },
  { value: 'diagnosing', label: 'Diagnosing' },
  { value: 'waiting_approval', label: 'Waiting for Approval' },
  { value: 'waiting_parts', label: 'Waiting for Parts' },
  { value: 'in_repair', label: 'In Repair' },
  { value: 'testing', label: 'Testing' },
  { value: 'ready_pickup', label: 'Ready for Pickup' },
  { value: 'completed', label: 'Completed' },
  { value: 'picked_up', label: 'Picked Up' },
  { value: 'cancelled', label: 'Cancelled' },
];

// The status set technicians may set (per spec). Excludes the legacy
// 'completed' status in favour of the explicit 'picked_up' terminal.
export const TECH_STATUSES: RepairStatus[] = [
  'received', 'diagnosing', 'waiting_approval', 'waiting_parts',
  'in_repair', 'testing', 'ready_pickup', 'picked_up', 'cancelled',
];

export const REPAIR_STATUS_LABEL: Record<RepairStatus, string> =
  REPAIR_STATUSES.reduce((m, s) => { m[s.value] = s.label; return m; }, {} as Record<RepairStatus, string>);

export const REPAIR_STATUS_CELL: Record<RepairStatus, string> = {
  received: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  diagnosing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  waiting_approval: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  waiting_parts: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  in_repair: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  testing: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  ready_pickup: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  completed: 'bg-emerald-600 text-white dark:bg-emerald-700',
  picked_up: 'bg-teal-600 text-white dark:bg-teal-700',
  cancelled: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
};

// Terminal states — the repair no longer occupies the shop.
const TERMINAL: RepairStatus[] = ['completed', 'picked_up', 'cancelled'];
export const isRepairOpen = (r: Repair) => !TERMINAL.includes(r.status);
// "In progress" grouping for the dashboard.
const IN_PROGRESS: RepairStatus[] = ['received', 'diagnosing', 'in_repair', 'testing'];
export const isInProgress = (r: Repair) => IN_PROGRESS.includes(r.status);

// --- Technician editing guard ---
// The only repair fields a technician is authorised to change. Enforced in the
// app write path (applyTechEdit) AND mirrored in firestore.rules server-side.
export const TECH_EDITABLE_FIELDS = [
  'status', 'techNotes', 'diagnostics', 'workPerformed',
  'partsUsed', 'testingResults', 'testChecks',
] as const;
export type TechEditableField = typeof TECH_EDITABLE_FIELDS[number];

/**
 * Build the repair to persist for a technician edit: start from the stored
 * record and overlay ONLY the whitelisted fields from the incoming draft, so a
 * technician can never change price, customer, device, etc. `status` is further
 * constrained to the technician-allowed set. Returns the guarded next repair.
 */
export function applyTechEdit(stored: Repair, draft: Partial<Repair>): Repair {
  const next: Repair = { ...stored };
  for (const key of TECH_EDITABLE_FIELDS) {
    if (key === 'status') {
      if (draft.status && TECH_STATUSES.includes(draft.status)) next.status = draft.status;
    } else if (key in draft) {
      (next as any)[key] = (draft as any)[key];
    }
  }
  return next;
}

// Whole days a repair has been open (received → now).
export const repairAgeDays = (r: Repair, now: number = Date.now()): number =>
  Math.max(0, Math.floor((now - (r.createdAt || now)) / 86400000));

// --- Cosmetic condition checklist ---
export const COSMETIC_OPTIONS = [
  'Scratches', 'Cracked screen', 'Cracked back', 'Dents', 'Water damage',
  'Bent frame', 'Missing parts', 'Screen burn', 'Loose buttons', 'Clean / Good',
];

// --- Money ---
export const balanceOwing = (r: Repair): number => Math.max(0, (r.repairPrice || 0) - (r.deposit || 0));

export interface BatchTotals { count: number; totalCost: number; amountPaid: number; remaining: number; }
export const batchTotals = (batch: RepairBatch, repairs: Repair[]): BatchTotals => {
  const devices = repairs.filter(r => r.batchId === batch.id && r.status !== 'cancelled');
  const totalCost = devices.reduce((s, r) => s + (r.repairPrice || 0), 0);
  const amountPaid = batch.amountPaid || 0;
  return { count: devices.length, totalCost, amountPaid, remaining: totalCost - amountPaid };
};

// A batch is "done" when it has devices and all non-cancelled ones are completed.
export const batchDevicesComplete = (batch: RepairBatch, repairs: Repair[]): boolean => {
  const devices = repairs.filter(r => r.batchId === batch.id && r.status !== 'cancelled');
  return devices.length > 0 && devices.every(r => r.status === 'completed');
};

// --- Warranty ---
export const addDays = (isoDate: string, days: number): string => {
  const d = new Date(isoDate + 'T00:00:00');
  if (isNaN(d.getTime())) return '';
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
// Warranty expiry = completion date + warrantyDays (empty when either is missing).
export const computeWarrantyUntil = (completedDate: string, warrantyDays?: number): string =>
  warrantyDays && warrantyDays > 0 && completedDate ? addDays(completedDate, warrantyDays) : '';

// --- Global search (repair number, customer, company, IMEI/serial, phone, model) ---
export const matchesRepair = (r: Repair, q: string): boolean => {
  const s = q.toLowerCase().trim();
  if (!s) return false;
  return [r.id, r.repairNumber, r.customerName, r.customerPhone, r.imei, r.model, r.brand, r.issue]
    .some(v => (v || '').toLowerCase().includes(s));
};

export const matchesBatch = (b: RepairBatch, q: string): boolean => {
  const s = q.toLowerCase().trim();
  if (!s) return false;
  return [b.batchNumber, b.companyName, b.contactPerson, b.phone, b.email]
    .some(v => (v || '').toLowerCase().includes(s));
};
