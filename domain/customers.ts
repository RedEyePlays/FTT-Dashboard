import { Customer, SalesTransaction, Repair, RepairBatch, InventoryItem } from '../types';
import { isRepairOpen, balanceOwing, batchTotals } from './repairs';
import { salesBalanceOwing, isVoided } from './pos';

// All customer statistics are DERIVED from existing documents (salesTransactions
// + repairs + repairBatches + inventory) — nothing is duplicated or stored on the
// customer. This is the CRM's single source of truth: one customer, everything
// linked (purchases → repairs → devices → invoices → warranties).

const dateMs = (ymd?: string): number => {
  if (!ymd) return 0;
  const t = new Date(ymd + 'T00:00:00').getTime();
  return isNaN(t) ? 0 : t;
};

const DAY = 86400000;
const ACTIVE_DAYS = 180; // "active" = seen within the last 6 months

// Normalisers for duplicate detection / linking.
export const normPhone = (p?: string) => (p || '').replace(/\D/g, '');
export const normEmail = (e?: string) => (e || '').trim().toLowerCase();

// Link a transaction/repair to a customer: prefer customerId, fall back to a
// phone/email match (covers legacy records written before ids were linked).
const sameCustomer = (c: Customer, ref: { customerId?: string; customerPhone?: string; customerEmail?: string }): boolean =>
  (!!ref.customerId && ref.customerId === c.id) ||
  (!!c.phone && !!ref.customerPhone && normPhone(ref.customerPhone) === normPhone(c.phone)) ||
  (!!c.email && !!ref.customerEmail && normEmail(ref.customerEmail) === normEmail(c.email));

export interface CustomerData {
  salesTransactions: SalesTransaction[];
  repairs: Repair[];
  batches: RepairBatch[];
  inventory?: InventoryItem[];
}

export interface CustomerStats {
  purchases: SalesTransaction[];
  repairs: Repair[];          // retail + wholesale, newest first
  lifetimeSpent: number;      // Σ totalPaid
  lifetimeProfit: number;     // Σ netProfit (profit-sensitive)
  purchaseCount: number;
  avgPurchase: number;
  repairRevenue: number;      // Σ repairPrice across their repairs
  repairCount: number;
  avgRepair: number;
  activeRepairs: number;      // repairs not in a terminal state
  warrantyClaims: number;     // repairs currently under warranty
  outstandingBalance: number; // unpaid layaway sale balances + repair balances + wholesale remainders
  firstSeen: number;          // epoch ms (0 = unknown)
  lastActivity: number;       // epoch ms (0 = unknown)
  lastPurchase: number;       // epoch ms (0 = none)
  lastRepair: number;         // epoch ms (0 = none)
  isVIP: boolean;
  isActive: boolean;
  hasOpenRepairs: boolean;
}

const underWarranty = (r: Repair, now: number) => !!r.warrantyUntil && dateMs(r.warrantyUntil) >= now;

export function customerStats(c: Customer, data: CustomerData, now: number = Date.now()): CustomerStats {
  const batchOwner = new Map(data.batches.map(b => [b.id, b.businessId]));

  const purchases = data.salesTransactions
    .filter(t => sameCustomer(c, t))
    .sort((a, b) => dateMs(b.date) - dateMs(a.date));

  const repairs = data.repairs
    .filter(r => {
      if (r.type === 'wholesale') return !!r.batchId && batchOwner.get(r.batchId) === c.id;
      return sameCustomer(c, r);
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const lifetimeSpent = purchases.reduce((s, t) => s + (t.totalPaid || 0), 0);
  const lifetimeProfit = purchases.reduce((s, t) => s + (t.netProfit || 0), 0);
  const repairRevenue = repairs.reduce((s, r) => s + (r.repairPrice || 0), 0);

  // Outstanding = unpaid layaway sale balances + open-repair balances + wholesale
  // batch remainders. Layaway deposits leave a balance owing on the sale itself
  // (a voided sale owes nothing), so those must be counted here too or a customer
  // who put a deposit down would show $0 outstanding.
  const salesOwing = purchases
    .filter(t => !isVoided(t))
    .reduce((s, t) => s + salesBalanceOwing(t.totalPaid || 0, t.deposit), 0);
  const retailOwing = repairs
    .filter(r => r.type !== 'wholesale' && isRepairOpen(r))
    .reduce((s, r) => s + balanceOwing(r), 0);
  const ownedBatches = data.batches.filter(b => b.businessId === c.id);
  const wholesaleOwing = ownedBatches.reduce((s, b) => s + Math.max(0, batchTotals(b, data.repairs).remaining), 0);

  const purchaseTimes = purchases.map(t => dateMs(t.date)).filter(Boolean);
  const repairTimes = repairs.map(r => r.createdAt || dateMs(r.date)).filter(Boolean);
  const activityTimes = [...purchaseTimes, ...repairTimes, ...(c.createdAt ? [c.createdAt] : [])].filter(Boolean);
  const lastActivity = activityTimes.length ? Math.max(...activityTimes) : 0;

  return {
    purchases, repairs,
    lifetimeSpent, lifetimeProfit,
    purchaseCount: purchases.length,
    avgPurchase: purchases.length ? lifetimeSpent / purchases.length : 0,
    repairRevenue,
    repairCount: repairs.length,
    avgRepair: repairs.length ? repairRevenue / repairs.length : 0,
    activeRepairs: repairs.filter(isRepairOpen).length,
    warrantyClaims: repairs.filter(r => underWarranty(r, now)).length,
    outstandingBalance: salesOwing + retailOwing + wholesaleOwing,
    firstSeen: activityTimes.length ? Math.min(...activityTimes) : 0,
    lastActivity,
    lastPurchase: purchaseTimes.length ? Math.max(...purchaseTimes) : 0,
    lastRepair: repairTimes.length ? Math.max(...repairTimes) : 0,
    isVIP: (c.tags || []).some(t => t.toLowerCase() === 'vip'),
    isActive: !!lastActivity && now - lastActivity <= ACTIVE_DAYS * DAY,
    hasOpenRepairs: repairs.some(isRepairOpen),
  };
}

// --- Device history: group a customer's purchased + repaired devices ---
export interface DeviceEvent { kind: 'purchase' | 'repair'; ts: number; label: string; detail?: string; ref: string; }
export interface CustomerDevice {
  key: string;
  name: string;
  imei?: string;
  serial?: string;
  firstSeen: number;
  events: DeviceEvent[]; // newest first
}

export function customerDevices(stats: CustomerStats, inventory: InventoryItem[] = []): CustomerDevice[] {
  const invById = new Map(inventory.map(i => [i.id, i]));
  const invBySku = new Map(inventory.filter(i => i.sku).map(i => [i.sku, i]));
  const devices = new Map<string, CustomerDevice>();

  const ensure = (key: string, name: string, imei?: string, serial?: string): CustomerDevice => {
    let d = devices.get(key);
    if (!d) { d = { key, name, imei, serial, firstSeen: Infinity, events: [] }; devices.set(key, d); }
    if (!d.imei && imei) d.imei = imei;
    if (!d.serial && serial) d.serial = serial;
    return d;
  };

  // Repairs carry IMEI/serial + device name directly.
  for (const r of stats.repairs) {
    const name = [r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device';
    const id = r.imei || `${name}`.toLowerCase();
    const d = ensure(id, name, r.imei, r.imei);
    const ts = r.createdAt || dateMs(r.date);
    d.firstSeen = Math.min(d.firstSeen, ts);
    d.events.push({ kind: 'repair', ts, label: `Repair · ${r.issue || r.repairNumber}`, detail: r.repairNumber, ref: r.id });
  }

  // Device purchases: resolve the inventory item to recover IMEI + name.
  for (const t of stats.purchases) {
    for (const l of t.lines) {
      if (l.kind !== 'device') continue;
      const inv = (l.inventoryId && invById.get(l.inventoryId)) || (l.sku && invBySku.get(l.sku)) || undefined;
      const imei = inv?.imei || undefined;
      const name = inv ? (inv.item || [inv.brand, inv.model].filter(Boolean).join(' ')) : l.name;
      const key = imei || l.sku || name.toLowerCase();
      const d = ensure(key, name || 'Device', imei, imei);
      const ts = dateMs(t.date);
      d.firstSeen = Math.min(d.firstSeen, ts);
      d.events.push({ kind: 'purchase', ts, label: `Purchased · ${name}`, detail: t.id, ref: t.id });
    }
  }

  return [...devices.values()]
    .map(d => ({ ...d, firstSeen: d.firstSeen === Infinity ? 0 : d.firstSeen, events: d.events.sort((a, b) => b.ts - a.ts) }))
    .sort((a, b) => b.firstSeen - a.firstSeen);
}

// A merged, newest-first activity timeline for the profile.
export type TimelineEntry =
  | { kind: 'purchase'; ts: number; tx: SalesTransaction }
  | { kind: 'repair'; ts: number; repair: Repair };

export function customerTimeline(stats: CustomerStats): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...stats.purchases.map(tx => ({ kind: 'purchase' as const, ts: dateMs(tx.date), tx })),
    ...stats.repairs.map(repair => ({ kind: 'repair' as const, ts: repair.createdAt || dateMs(repair.date), repair })),
  ];
  return entries.sort((a, b) => b.ts - a.ts);
}

// --- list search / sort / filter ---
// Basic field match (name/phone/email/company/contact).
export const matchCustomer = (c: Customer, q: string): boolean => {
  const s = q.toLowerCase().trim();
  if (!s) return true;
  return [c.name, c.phone, c.email, c.company, c.contactPerson].some(v => (v || '').toLowerCase().includes(s));
};

// Deep match: also searches the customer's linked records — repair #/id, invoice
// #, IMEI/serial and SKUs — so the list finds people by anything on their record.
export function customerSearchMatch(c: Customer, stats: CustomerStats, q: string): boolean {
  const s = q.toLowerCase().trim();
  if (!s) return true;
  if (matchCustomer(c, q)) return true;
  if (stats.repairs.some(r => [r.repairNumber, r.id, r.imei].some(v => (v || '').toLowerCase().includes(s)))) return true;
  if (stats.purchases.some(t =>
    t.id.toLowerCase().includes(s) || t.lines.some(l => (l.sku || '').toLowerCase().includes(s) || (l.name || '').toLowerCase().includes(s)))) return true;
  return false;
}

export type CustomerSort = 'recent' | 'name' | 'spent' | 'repairs' | 'created';
export type CustomerFilter = 'all' | 'active' | 'open_repairs' | 'vip' | 'balance' | 'warranty';

export function passesFilter(filter: CustomerFilter, s: CustomerStats): boolean {
  switch (filter) {
    case 'active': return s.isActive;
    case 'open_repairs': return s.hasOpenRepairs;
    case 'vip': return s.isVIP;
    case 'balance': return s.outstandingBalance > 0.005;
    case 'warranty': return s.warrantyClaims > 0;
    default: return true;
  }
}

export function sortCustomers<T extends { c: Customer; s: CustomerStats }>(rows: T[], sort: CustomerSort): T[] {
  const name = (c: Customer) => (c.name || c.company || '').toLowerCase();
  return [...rows].sort((a, b) => {
    switch (sort) {
      case 'name': return name(a.c).localeCompare(name(b.c));
      case 'spent': return b.s.lifetimeSpent - a.s.lifetimeSpent;
      case 'repairs': return b.s.repairCount - a.s.repairCount;
      case 'created': return (b.c.createdAt || 0) - (a.c.createdAt || 0);
      default: return b.s.lastActivity - a.s.lastActivity; // recent / last visit
    }
  });
}

// --- Duplicate detection + merge (no duplicate records for same phone/email) ---
export interface DuplicateGroup { key: string; kind: 'phone' | 'email'; customers: Customer[]; }

export function findDuplicateGroups(customers: Customer[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const seen = new Set<string>();
  const index = (kind: 'phone' | 'email', keyOf: (c: Customer) => string) => {
    const map = new Map<string, Customer[]>();
    for (const c of customers) {
      const k = keyOf(c);
      if (!k) continue;
      (map.get(k) || map.set(k, []).get(k)!).push(c);
    }
    for (const [k, list] of map) {
      if (list.length < 2) continue;
      const gid = `${kind}:${k}`;
      if (seen.has(gid)) continue;
      seen.add(gid);
      groups.push({ key: k, kind, customers: list });
    }
  };
  index('phone', c => normPhone(c.phone));
  index('email', c => normEmail(c.email));
  return groups;
}

export interface MergePlan {
  customer: Customer;                 // the surviving (primary) record, enriched
  removeIds: string[];                // duplicate customer ids to delete
  reassignSales: string[];            // sales tx ids to relink to primary
  reassignRepairs: string[];          // repair ids to relink to primary
  reassignBatches: string[];          // batch ids to relink to primary
}

// Build a plan to merge `dups` into `primary`: enrich the primary, relink every
// linked record, and remove the duplicate customer docs. Pure — the app applies it.
export function planMerge(primary: Customer, dups: Customer[], data: CustomerData): MergePlan {
  const merged: Customer = { ...primary };
  merged.email = merged.email || dups.find(d => d.email)?.email;
  merged.phone = merged.phone || dups.find(d => d.phone)?.phone || '';
  merged.tags = Array.from(new Set([...(primary.tags || []), ...dups.flatMap(d => d.tags || [])]));
  const notes = [primary.notes, ...dups.map(d => d.notes)].filter(Boolean).join('\n');
  if (notes) merged.notes = notes;
  merged.createdAt = [primary.createdAt, ...dups.map(d => d.createdAt)].filter(Boolean).sort((a, b) => (a as number) - (b as number))[0] || primary.createdAt;

  const dupIds = new Set(dups.map(d => d.id));
  const reassignSales = data.salesTransactions.filter(t => sameCustomerAny(dups, t)).map(t => t.id);
  const reassignRepairs = data.repairs.filter(r => r.type !== 'wholesale' && sameCustomerAny(dups, r)).map(r => r.id);
  const reassignBatches = data.batches.filter(b => b.businessId && dupIds.has(b.businessId)).map(b => b.id);

  return { customer: merged, removeIds: [...dupIds], reassignSales, reassignRepairs, reassignBatches };
}

const sameCustomerAny = (list: Customer[], ref: { customerId?: string; customerPhone?: string; customerEmail?: string }) =>
  list.some(c => sameCustomer(c, ref));
