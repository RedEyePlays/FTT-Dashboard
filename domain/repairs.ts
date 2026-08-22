import { Repair, RepairBatch, RepairStatus, RepairType, RepairPart } from '../types';

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

// --- Repair type semantics ---
// Only retail tickets involve an external customer. Wholesale devices belong to
// a business batch; internal tickets are shop-owned devices being refurbished
// before resale — neither needs (or shows) a customer.
export const repairNeedsCustomer = (type: RepairType): boolean => type === 'retail';
export const isInternalRepair = (r: Pick<Repair, 'type'>): boolean => r.type === 'internal';

// Form-save validity: a retail ticket requires a customer name; internal and
// wholesale do not. (The customer field is optional on the type either way — this
// is the UI-level requirement the New/Edit form enforces.)
export const canSaveRepair = (r: Pick<Repair, 'type' | 'customerName'>): boolean =>
  !repairNeedsCustomer(r.type) || !!(r.customerName && r.customerName.trim());

// The internal repair (if any) linked to an inventory item — most recent first.
// Cost/price is intentionally NOT synced back to the item; this is link-only.
export const linkedRepairFor = (inventoryId: string, repairs: Repair[]): Repair | undefined =>
  repairs
    .filter(r => r.inventoryId === inventoryId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

// Whole days a repair has been open (received → now).
export const repairAgeDays = (r: Repair, now: number = Date.now()): number =>
  Math.max(0, Math.floor((now - (r.createdAt || now)) / 86400000));

// --- Cosmetic condition checklist ---
export const COSMETIC_OPTIONS = [
  'Scratches', 'Cracked screen', 'Cracked back', 'Dents', 'Water damage',
  'Bent frame', 'Missing parts', 'Screen burn', 'Loose buttons', 'Clean / Good',
];

// --- Parts & repair cost breakdown ---
const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

/** Total cost of a structured parts list: Σ unitCost × quantity (never negative). */
export const partsTotal = (parts?: RepairPart[]): number =>
  round2((parts || []).reduce((s, p) => s + Math.max(0, p.unitCost || 0) * Math.max(0, p.quantity || 0), 0));

/**
 * The repair's parts cost. Prefers the structured `parts` breakdown when present,
 * otherwise falls back to the legacy `partsCost` number — so old records and the
 * technician free-text flow keep working.
 */
export const repairPartsCost = (r: Pick<Repair, 'parts' | 'partsCost'>): number =>
  r.parts && r.parts.length ? partsTotal(r.parts) : round2(r.partsCost || 0);

/** Labor / margin portion of a repair = price − parts cost (never negative). */
export const repairLabor = (r: Pick<Repair, 'repairPrice' | 'parts' | 'partsCost'>): number =>
  round2(Math.max(0, (r.repairPrice || 0) - repairPartsCost(r)));

export interface RepairCheckoutSummary {
  partsCost: number;
  labor: number;        // repairPrice − partsCost
  repairPrice: number;
  deposit: number;
  balanceDue: number;   // repairPrice − deposit
}

/** Everything a tech needs to check a repair out: parts cost, labor, price, deposit, balance. */
export const repairCheckoutSummary = (r: Repair): RepairCheckoutSummary => {
  const partsCost = repairPartsCost(r);
  const repairPrice = round2(r.repairPrice || 0);
  const deposit = round2(r.deposit || 0);
  return { partsCost, labor: round2(Math.max(0, repairPrice - partsCost)), repairPrice, deposit, balanceDue: Math.max(0, round2(repairPrice - deposit)) };
};

/**
 * Complete a repair in one step (the streamlined checkout): stamp the terminal
 * status + completion time, denormalize the parts cost onto `partsCost` so
 * downstream reports read one consistent number, and compute the warranty expiry.
 * Pure — the app persists the returned record.
 */
export const completeRepair = (r: Repair, now: number = Date.now(), status: 'completed' | 'picked_up' = 'completed'): Repair => {
  const completedDate = new Date(now).toISOString().split('T')[0];
  return {
    ...r,
    status,
    completedAt: now,
    partsCost: repairPartsCost(r),
    warrantyUntil: computeWarrantyUntil(completedDate, r.warrantyDays),
  };
};

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
