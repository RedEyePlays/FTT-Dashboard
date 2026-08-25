import { InventoryItem, Repair, RepairBatch, Customer, SalesTransaction, AppUser, ViewState } from '../types';
import { kindOf } from './inventory';
import { isRepairOpen, REPAIR_STATUS_LABEL } from './repairs';

// Pure, ranked global search over the collections already held in memory (the
// app subscribes to them via realtime listeners), so a search performs ZERO
// extra Firestore reads. Permission enforcement is done by the caller handing us
// only the data the current user may see (empty arrays for disallowed
// categories) plus `canViewCost` for financial subtitles — this module never
// invents access.

export type SearchType = 'inventory' | 'repair' | 'customer' | 'sale' | 'user' | 'page';

export interface SearchResult {
  key: string;               // stable react key
  type: SearchType;
  title: string;
  subtitle?: string;
  status?: string;           // status label → badge
  statusKind?: 'open' | 'sold' | 'ready' | 'warn' | 'neutral';
  score: number;
  // routing payload (consumed by the app)
  itemId?: string;
  view?: ViewState;
  action?: string;
  customerId?: string;
}

export interface SearchPage { id: string; label: string; keywords?: string; view?: ViewState; action?: string; }

export interface SearchData {
  inventory: InventoryItem[];
  repairs: Repair[];
  batches: RepairBatch[];
  customers: Customer[];
  sales: SalesTransaction[];
  users: AppUser[];
  pages: SearchPage[];
}

export interface SearchOpts { canViewCost: boolean; limitPerGroup?: number }

export interface SearchGroup { type: SearchType; label: string; results: SearchResult[]; total: number }

export const MIN_QUERY = 1; // identifiers can be very short; begin at 1 char

const norm = (s?: string) => (s || '').toLowerCase().trim();
const digits = (s?: string) => (s || '').replace(/\D/g, '');
const money = (n?: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Only the one value that doesn't read right just capitalized ('etransfer' →
// 'Etransfer') needs a real label; everything else falls through to the
// generic capitalization below.
const SEARCH_PAYMENT_LABEL: Record<string, string> = { etransfer: 'E-Transfer' };

// exact = 1000, prefix = 700, word-prefix = 600, partial = 400.
function fieldScore(value: string | undefined, q: string): number {
  const v = norm(value);
  if (!v || !q) return 0;
  if (v === q) return 1000;
  if (v.startsWith(q)) return 700;
  if (v.split(/[\s/·,-]+/).some(w => w.startsWith(q))) return 600;
  if (v.includes(q)) return 400;
  return 0;
}
// Phone / numeric identifiers compared on digits only.
function digitScore(value: string | undefined, qDigits: string): number {
  if (!qDigits) return 0;
  const v = digits(value);
  if (!v) return 0;
  if (v === qDigits) return 1000;
  if (v.startsWith(qDigits)) return 700;
  if (v.includes(qDigits)) return 400;
  return 0;
}
const best = (...scores: number[]) => Math.max(0, ...scores);

export function globalSearch(raw: string, data: SearchData, opts: SearchOpts): { groups: SearchGroup[]; total: number } {
  const q = norm(raw);
  const qd = digits(raw);
  const limit = opts.limitPerGroup ?? 6;
  const groups: SearchGroup[] = [];
  if (q.length < MIN_QUERY) return { groups, total: 0 };

  const push = (type: SearchType, label: string, scored: { r: SearchResult }[]) => {
    const sorted = scored.filter(s => s.r.score > 0).sort((a, b) => b.r.score - a.r.score);
    if (sorted.length) groups.push({ type, label, results: sorted.slice(0, limit).map(s => s.r), total: sorted.length });
  };

  // Pages — matched on label + keywords.
  push('page', 'Pages', data.pages.map(p => {
    const score = best(fieldScore(p.label, q), p.keywords ? fieldScore(p.keywords, q) : 0);
    return { r: { key: `page:${p.id}`, type: 'page' as const, title: p.label, subtitle: 'Go to page', score: score ? score + 5 : 0, view: p.view, action: p.action } };
  }));

  // Inventory — SKU / IMEI / serial / barcode / brand / model / name / storage / color.
  push('inventory', 'Inventory', data.inventory.map(i => {
    const name = i.item || [i.brand, i.model].filter(Boolean).join(' ') || 'Item';
    const idScore = best(fieldScore(i.sku, q), fieldScore(i.imei, q), fieldScore(i.manufacturerBarcode, q));
    const textScore = best(fieldScore(name, q), fieldScore(i.brand, q), fieldScore(i.model, q), fieldScore(i.storage, q), fieldScore(i.color, q));
    let score = best(idScore, textScore);
    if (score && kindOf(i) === 'device' && !i.soldDate && i.deviceStatus !== 'sold') score += 30; // in-stock bonus
    const sold = kindOf(i) === 'device' && (!!i.soldDate || i.deviceStatus === 'sold');
    return { r: {
      key: `inv:${i.id}`, type: 'inventory' as const, title: name,
      subtitle: [i.sku && `SKU: ${i.sku}`, i.imei && `IMEI: ${i.imei}`, [i.storage, i.color].filter(Boolean).join(' · ')].filter(Boolean).join(' · ') || undefined,
      status: sold ? 'Sold' : undefined, statusKind: sold ? 'sold' : 'neutral', score, itemId: i.id,
    } };
  }));

  // Repairs — repair #, customer, phone, email, device, IMEI/serial, issue.
  push('repair', 'Repair Tickets', data.repairs.map(r => {
    const device = [r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device';
    const idScore = best(fieldScore(r.repairNumber, q), fieldScore(r.id, q), fieldScore(r.imei, q), digitScore(r.customerPhone, qd));
    const textScore = best(fieldScore(r.customerName, q), fieldScore(r.customerEmail, q), fieldScore(device, q), fieldScore(r.issue, q));
    let score = best(idScore, textScore);
    if (score && isRepairOpen(r)) score += 40; // active repairs first
    return { r: {
      key: `rep:${r.id}`, type: 'repair' as const, title: `Repair ${r.repairNumber}`,
      subtitle: [r.customerName || 'Walk-in', device, r.issue].filter(Boolean).join(' · ') || undefined,
      status: REPAIR_STATUS_LABEL[r.status], statusKind: isRepairOpen(r) ? 'open' : 'neutral', score, itemId: r.id,
    } };
  }));

  // Customers — name / phone / email / id / company.
  push('customer', 'Customers', data.customers.map(c => {
    const score = best(fieldScore(c.name, q), fieldScore(c.email, q), fieldScore(c.company, q), fieldScore(c.id, q), digitScore(c.phone, qd));
    return { r: {
      key: `cus:${c.id}`, type: 'customer' as const, title: c.name || c.company || 'Customer',
      subtitle: [c.phone, c.email].filter(Boolean).join(' · ') || undefined,
      status: (c.tags || []).find(t => t.toLowerCase() === 'vip') ? 'VIP' : undefined, statusKind: 'neutral', score, itemId: c.id,
    } };
  }));

  // Sales — invoice/receipt #, customer, SKU/IMEI on the lines. No profit shown.
  push('sale', 'Sales', data.sales.map(t => {
    const lineHit = best(...t.lines.map(l => best(fieldScore(l.sku, q), fieldScore(l.name, q))));
    const score = best(fieldScore(t.id, q), fieldScore(t.customerName, q), digitScore(t.customerPhone, qd), lineHit);
    return { r: {
      key: `sale:${t.id}`, type: 'sale' as const, title: `Invoice #${t.id.slice(0, 8)}`,
      subtitle: [t.customerName || 'Walk-in', money(t.totalPaid), t.paymentMethod && (SEARCH_PAYMENT_LABEL[t.paymentMethod] || t.paymentMethod[0].toUpperCase() + t.paymentMethod.slice(1))].filter(Boolean).join(' · ') || undefined,
      score, itemId: t.id, customerId: t.customerId,
    } };
  }));

  // Users — name/email/role (owner-only; caller passes [] otherwise).
  push('user', 'Users', data.users.map(u => {
    const score = best(fieldScore(u.email, q), fieldScore(u.role, q));
    return { r: {
      key: `usr:${u.id}`, type: 'user' as const, title: u.email,
      subtitle: `Role: ${u.role}${u.disabled ? ' · disabled' : ''}`, score, itemId: u.id, view: 'users',
    } };
  }));

  const total = groups.reduce((n, g) => n + g.results.length, 0);
  return { groups, total };
}
