import { Customer, SalesTransaction, Repair, RepairBatch, InventoryItem } from '../types';
import { isRepairOpen, balanceOwing, batchTotals } from './repairs';
import { isReversed, isLayaway, collectedOnSale } from './pos';

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

// Devices this person SOLD TO US — inventory rows linked back to them by
// boughtFromCustomerId (Quick Purchase / Add Item's "Bought From" picker).
// Newest first. Legacy rows carry free-text `boughtFrom` only and are never
// matched by text: a wrong auto-link is worse than no link.
export function sellerPurchasesFor(c: Customer, inventory: InventoryItem[] = []): InventoryItem[] {
  return inventory
    .filter(i => !!i.boughtFromCustomerId && i.boughtFromCustomerId === c.id)
    .sort((a, b) => dateMs(b.date) - dateMs(a.date));
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
  activeWarranties: number;   // repairs currently within their warranty window (NOT filed claims)
  outstandingBalance: number; // unpaid layaway sale balances + repair balances + wholesale remainders
  firstSeen: number;          // epoch ms (0 = unknown)
  lastActivity: number;       // epoch ms (0 = unknown)
  lastPurchase: number;       // epoch ms (0 = none)
  lastRepair: number;         // epoch ms (0 = none)
  isVIP: boolean;
  isActive: boolean;
  hasOpenRepairs: boolean;

  // --- Seller side: devices we bought FROM this person ---
  sellerPurchases: InventoryItem[];  // newest first
  sellerPurchaseCount: number;
  sellerPurchaseTotal: number;       // Σ purchaseCost — COST DATA, profit-sensitive
  lastSoldToUs: number;              // epoch ms (0 = never)
  hasBoughtFromUs: boolean;          // has sales and/or repairs with us
  hasSoldToUs: boolean;              // has sold us at least one device
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

  // Reversed sales (voided or returned) stay in the purchase history but must not
  // inflate money totals — the customer didn't ultimately spend that.
  //
  // lifetimeSpent is money actually PAID to date — collectedOnSale (a layaway
  // still open counts its deposit plus any balance payments made since; once
  // fully paid off it counts the full total, same as a sale paid in full at
  // checkout). Using totalPaid here would count a $500 sale on a $150 deposit
  // as $500 spent before the customer had actually paid that much.
  //
  // lifetimeProfit only counts a sale once it's fully recognized (not an open
  // layaway) — mirrors domain/reports.ts's isRecognizedSale, so this and the
  // P&L / Owner Analytics profit figures for the same customer's sales agree.
  const realized = purchases.filter(t => !isReversed(t));
  const lifetimeSpent = realized.reduce((s, t) => s + collectedOnSale(t), 0);
  const lifetimeProfit = realized.filter(t => !isLayaway(t)).reduce((s, t) => s + (t.netProfit || 0), 0);
  const repairRevenue = repairs.reduce((s, r) => s + (r.repairPrice || 0), 0);

  // Outstanding = unpaid layaway sale balances + open-repair balances + wholesale
  // batch remainders. Layaway deposits leave a balance owing on the sale itself
  // (a voided sale owes nothing), so those must be counted here too or a customer
  // who put a deposit down would show $0 outstanding.
  //
  // Reads `t.balanceOwing` directly — the actively-maintained field, updated in
  // place by domain/layaway.ts's applyBalancePayment as balance payments land —
  // rather than recomputing from `t.deposit` (which is intentionally frozen at
  // the original checkout amount and would make this figure ignore every later
  // balance payment, understating what's actually still outstanding).
  const salesOwing = purchases
    .filter(t => !isReversed(t))
    .reduce((s, t) => s + Math.max(0, t.balanceOwing || 0), 0);
  const retailOwing = repairs
    .filter(r => r.type !== 'wholesale' && isRepairOpen(r))
    .reduce((s, r) => s + balanceOwing(r), 0);
  const ownedBatches = data.batches.filter(b => b.businessId === c.id);
  const wholesaleOwing = ownedBatches.reduce((s, b) => s + Math.max(0, batchTotals(b, data.repairs).remaining), 0);

  // Devices bought FROM this person. Their cost is deliberately NOT folded
  // into lifetimeSpent/lifetimeProfit — that's money going out, not customer
  // spend, and mixing the two would misstate both.
  const sellerPurchases = sellerPurchasesFor(c, data.inventory || []);
  const sellerPurchaseTotal = sellerPurchases.reduce((s, i) => s + (i.purchaseCost || 0), 0);
  const sellerTimes = sellerPurchases.map(i => dateMs(i.date)).filter(Boolean);

  const purchaseTimes = purchases.map(t => dateMs(t.date)).filter(Boolean);
  const repairTimes = repairs.map(r => r.createdAt || dateMs(r.date)).filter(Boolean);
  const activityTimes = [...purchaseTimes, ...repairTimes, ...sellerTimes, ...(c.createdAt ? [c.createdAt] : [])].filter(Boolean);
  const lastActivity = activityTimes.length ? Math.max(...activityTimes) : 0;

  return {
    purchases, repairs,
    lifetimeSpent, lifetimeProfit,
    purchaseCount: purchases.length,
    avgPurchase: realized.length ? lifetimeSpent / realized.length : 0,
    repairRevenue,
    repairCount: repairs.length,
    avgRepair: repairs.length ? repairRevenue / repairs.length : 0,
    activeRepairs: repairs.filter(isRepairOpen).length,
    activeWarranties: repairs.filter(r => underWarranty(r, now)).length,
    outstandingBalance: salesOwing + retailOwing + wholesaleOwing,
    firstSeen: activityTimes.length ? Math.min(...activityTimes) : 0,
    lastActivity,
    lastPurchase: purchaseTimes.length ? Math.max(...purchaseTimes) : 0,
    lastRepair: repairTimes.length ? Math.max(...repairTimes) : 0,
    isVIP: (c.tags || []).some(t => t.toLowerCase() === 'vip'),
    isActive: !!lastActivity && now - lastActivity <= ACTIVE_DAYS * DAY,
    hasOpenRepairs: repairs.some(isRepairOpen),
    sellerPurchases,
    sellerPurchaseCount: sellerPurchases.length,
    sellerPurchaseTotal,
    lastSoldToUs: sellerTimes.length ? Math.max(...sellerTimes) : 0,
    hasBoughtFromUs: purchases.length > 0 || repairs.length > 0,
    hasSoldToUs: sellerPurchases.length > 0,
  };
}

// --- Device history: group a customer's purchased + repaired devices ---
// 'purchase' = they bought it from us; 'sold_to_us' = we bought it from them.
export interface DeviceEvent { kind: 'purchase' | 'repair' | 'sold_to_us'; ts: number; label: string; detail?: string; ref: string; }
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

  // Devices they SOLD US — the same physical device often reappears later as a
  // repair or a resale, so these merge into the same device card by IMEI.
  for (const i of stats.sellerPurchases) {
    const name = i.item || [i.brand, i.model].filter(Boolean).join(' ') || 'Device';
    const key = i.imei || i.sku || name.toLowerCase();
    const d = ensure(key, name, i.imei || undefined, i.imei || undefined);
    const ts = dateMs(i.date);
    d.firstSeen = Math.min(d.firstSeen, ts);
    d.events.push({ kind: 'sold_to_us', ts, label: `Sold to us · ${name}`, detail: i.sku, ref: i.id });
  }

  return [...devices.values()]
    .map(d => ({ ...d, firstSeen: d.firstSeen === Infinity ? 0 : d.firstSeen, events: d.events.sort((a, b) => b.ts - a.ts) }))
    .sort((a, b) => b.firstSeen - a.firstSeen);
}

// A merged, newest-first activity timeline for the profile.
export type TimelineEntry =
  | { kind: 'purchase'; ts: number; tx: SalesTransaction }
  | { kind: 'repair'; ts: number; repair: Repair }
  // We bought a device FROM them — the opposite direction of 'purchase', which
  // is why it's a distinct entry kind rather than a flag on the same one.
  | { kind: 'sold_to_us'; ts: number; item: InventoryItem };

export function customerTimeline(stats: CustomerStats): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    ...stats.purchases.map(tx => ({ kind: 'purchase' as const, ts: dateMs(tx.date), tx })),
    ...stats.repairs.map(repair => ({ kind: 'repair' as const, ts: repair.createdAt || dateMs(repair.date), repair })),
    ...stats.sellerPurchases.map(item => ({ kind: 'sold_to_us' as const, ts: dateMs(item.date), item })),
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
  // Devices they sold us are part of their record too — find a seller by the
  // IMEI/SKU/model of the device they brought in.
  if (stats.sellerPurchases.some(i => [i.imei, i.sku, i.item].some(v => (v || '').toLowerCase().includes(s)))) return true;
  return false;
}

export type CustomerSort = 'recent' | 'name' | 'spent' | 'repairs' | 'created';
export type CustomerFilter =
  | 'all' | 'active' | 'open_repairs' | 'vip' | 'balance' | 'warranty'
  // Relationship filters (see passesFilter for the exact semantics).
  | 'bought_from_us' | 'sold_to_us' | 'both_ways';

// Relationship semantics, chosen deliberately:
//  - 'bought_from_us' is EXCLUSIVE (sales/repairs only, never sold us a
//    device) — it answers "who are purely customers".
//  - 'sold_to_us' is INCLUSIVE (anyone we've bought a device from, whether or
//    not they also buy from us) — it's the device-source list, and dropping
//    repeat sellers just because they also shop here would defeat its purpose.
//  - 'both_ways' is the overlap.
// So bought_from_us and sold_to_us are disjoint, together cover everyone with
// any relationship, and both_ways is the subset of sold_to_us that also buys.
export function passesFilter(filter: CustomerFilter, s: CustomerStats): boolean {
  switch (filter) {
    case 'active': return s.isActive;
    case 'open_repairs': return s.hasOpenRepairs;
    case 'vip': return s.isVIP;
    case 'balance': return s.outstandingBalance > 0.005;
    case 'warranty': return s.activeWarranties > 0;
    case 'bought_from_us': return s.hasBoughtFromUs && !s.hasSoldToUs;
    case 'sold_to_us': return s.hasSoldToUs;
    case 'both_ways': return s.hasBoughtFromUs && s.hasSoldToUs;
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

// Existing customer matching a phone/email, using the SAME normalisers
// findDuplicateGroups uses — so "would this create a duplicate?" is answered
// by the same rule that later flags one. Phone wins over email when both
// match different people (phone is the primary identifier at the counter).
export function findCustomerByContact(
  customers: Customer[],
  contact: { phone?: string; email?: string },
): { customer: Customer; matchedOn: 'phone' | 'email' } | undefined {
  const phone = normPhone(contact.phone);
  const email = normEmail(contact.email);
  if (phone) {
    const hit = customers.find(c => normPhone(c.phone) === phone);
    if (hit) return { customer: hit, matchedOn: 'phone' };
  }
  if (email) {
    const hit = customers.find(c => normEmail(c.email) === email);
    if (hit) return { customer: hit, matchedOn: 'email' };
  }
  return undefined;
}

export interface CustomerDraft { name: string; phone?: string; email?: string; }
export interface CustomerLinkResult {
  customer: Customer;
  created: boolean;                    // true = a genuinely new record to persist
  matchedOn?: 'phone' | 'email';       // set when an existing record was reused
}

/**
 * Resolve "create this customer inline" without ever blindly adding a second
 * record for someone already in the system: an existing phone/email match is
 * reused (and enriched with any detail the draft adds that it was missing)
 * instead of duplicated. Pure — the caller persists `customer` when
 * `created` is true, or when `matchedOn` is set and the record changed.
 */
export function resolveCustomerForDraft(
  customers: Customer[],
  draft: CustomerDraft,
  newId: string,
  now: number = Date.now(),
): CustomerLinkResult {
  const name = (draft.name || '').trim();
  const phone = (draft.phone || '').trim();
  const email = (draft.email || '').trim();
  const existing = findCustomerByContact(customers, { phone, email });
  if (existing) {
    // Enrich, never overwrite: an existing record's own details win.
    const merged: Customer = {
      ...existing.customer,
      phone: existing.customer.phone || phone,
      email: existing.customer.email || email || undefined,
      name: existing.customer.name || name,
    };
    return { customer: merged, created: false, matchedOn: existing.matchedOn };
  }
  return {
    customer: { id: newId, name, phone, email: email || undefined, kind: 'retail', createdAt: now },
    created: true,
  };
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
