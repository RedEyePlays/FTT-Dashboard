import { Repair, RepairBatch, RepairStatus } from '../types';

// --- Numbering prefixes (reuse the meta.skuCounters mechanism) ---
export const REPAIR_PREFIX = 'RPR';
export const BATCH_PREFIX = 'WB';

// --- Statuses (simplified set) ---
export const REPAIR_STATUSES: { value: RepairStatus; label: string }[] = [
  { value: 'received', label: 'Received' },
  { value: 'diagnosing', label: 'Diagnosing' },
  { value: 'waiting_approval', label: 'Waiting for Approval' },
  { value: 'waiting_parts', label: 'Waiting on Parts' },
  { value: 'in_repair', label: 'In Repair' },
  { value: 'ready_pickup', label: 'Ready for Pickup' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const REPAIR_STATUS_LABEL: Record<RepairStatus, string> =
  REPAIR_STATUSES.reduce((m, s) => { m[s.value] = s.label; return m; }, {} as Record<RepairStatus, string>);

export const REPAIR_STATUS_CELL: Record<RepairStatus, string> = {
  received: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  diagnosing: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  waiting_approval: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  waiting_parts: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  in_repair: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  ready_pickup: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  completed: 'bg-emerald-600 text-white dark:bg-emerald-700',
  cancelled: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
};

// Open = actively occupying the shop (everything except terminal states).
export const isRepairOpen = (r: Repair) => r.status !== 'completed' && r.status !== 'cancelled';
// "In progress" grouping for the dashboard.
const IN_PROGRESS: RepairStatus[] = ['received', 'diagnosing', 'in_repair'];
export const isInProgress = (r: Repair) => IN_PROGRESS.includes(r.status);

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
