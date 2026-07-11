import { Customer, SalesTransaction, Repair, RepairBatch } from '../types';

// All customer statistics are DERIVED from existing documents (salesTransactions
// + repairs + repairBatches) — nothing is duplicated or stored on the customer.

const dateMs = (ymd?: string): number => {
  if (!ymd) return 0;
  const t = new Date(ymd + 'T00:00:00').getTime();
  return isNaN(t) ? 0 : t;
};

// Link a transaction/repair to a customer: prefer customerId, fall back to a
// phone match (covers legacy records written before ids were linked).
const sameCustomer = (c: Customer, ref: { customerId?: string; customerPhone?: string }): boolean =>
  (!!ref.customerId && ref.customerId === c.id) ||
  (!!c.phone && !!ref.customerPhone && ref.customerPhone === c.phone);

export interface CustomerData {
  salesTransactions: SalesTransaction[];
  repairs: Repair[];
  batches: RepairBatch[];
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
  firstSeen: number;          // epoch ms (0 = unknown)
  lastActivity: number;       // epoch ms (0 = unknown)
}

export function customerStats(c: Customer, data: CustomerData): CustomerStats {
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

  const activityTimes = [
    ...purchases.map(t => dateMs(t.date)),
    ...repairs.map(r => r.createdAt || dateMs(r.date)),
    ...(c.createdAt ? [c.createdAt] : []),
  ].filter(Boolean);

  return {
    purchases, repairs,
    lifetimeSpent, lifetimeProfit,
    purchaseCount: purchases.length,
    avgPurchase: purchases.length ? lifetimeSpent / purchases.length : 0,
    repairRevenue,
    repairCount: repairs.length,
    avgRepair: repairs.length ? repairRevenue / repairs.length : 0,
    firstSeen: activityTimes.length ? Math.min(...activityTimes) : 0,
    lastActivity: activityTimes.length ? Math.max(...activityTimes) : 0,
  };
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

// --- list search + sort ---
export const matchCustomer = (c: Customer, q: string): boolean => {
  const s = q.toLowerCase().trim();
  if (!s) return true;
  return [c.name, c.phone, c.email, c.company, c.contactPerson].some(v => (v || '').toLowerCase().includes(s));
};

export type CustomerSort = 'recent' | 'name' | 'spent';
