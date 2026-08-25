import { SalesTransaction, Repair, InventoryItem, Customer, AuditEntry, ActivityEntry, DeviceType } from '../types';
import { kindOf } from './inventory';
import { isRepairOpen, repairPartsCost as partsCostOf } from './repairs';
import { customerStats } from './customers';
import { isReversed } from './pos';

// Owner analytics — every figure is DERIVED from existing sales, repairs,
// inventory and customer documents. Nothing is duplicated or stored.

export type RangePreset = 'today' | 'yesterday' | 'last7' | 'month' | 'year' | 'custom';

export interface DateRange { start: number; end: number; label: string } // [start, end)

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const DAY = 86400000;
const ymdMs = (ymd?: string): number => {
  if (!ymd) return 0;
  const t = new Date(ymd + 'T00:00:00').getTime();
  return isNaN(t) ? 0 : t;
};

export function presetRange(preset: RangePreset, now: number = Date.now(), custom?: { start: string; end: string }): DateRange {
  const today = startOfDay(new Date(now));
  switch (preset) {
    case 'today': return { start: today, end: today + DAY, label: 'Today' };
    case 'yesterday': return { start: today - DAY, end: today, label: 'Yesterday' };
    case 'last7': return { start: today - 6 * DAY, end: today + DAY, label: 'Last 7 Days' };
    case 'month': { const d = new Date(now); return { start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), end: today + DAY, label: 'This Month' }; }
    case 'year': { const d = new Date(now); return { start: new Date(d.getFullYear(), 0, 1).getTime(), end: today + DAY, label: 'This Year' }; }
    case 'custom': {
      const s = custom?.start ? ymdMs(custom.start) : today;
      const e = custom?.end ? ymdMs(custom.end) + DAY : today + DAY;
      return { start: s, end: Math.max(e, s + DAY), label: 'Custom' };
    }
  }
}

const inRange = (ts: number, r: DateRange) => ts >= r.start && ts < r.end;

export interface Money2 { revenue: number; profit: number }
export interface NamedStat { name: string; revenue: number; profit: number; count: number }

export interface Analytics {
  // overview
  revenue: number; grossProfit: number; grossMargin: number;
  salesCount: number; repairsCount: number; devicesSold: number; repairsCompleted: number;
  avgSale: number; avgRepair: number;
  // profit calc
  deviceProfit: number; accessoryProfit: number;
  repairRevenue: number; repairPartsCost: number; repairLabourRevenue: number; repairProfit: number;
  // payments
  payments: { cash: number; card: number; etransfer: number; storeCredit: number; other: number };
  // categories
  categories: NamedStat[];
  // top performers
  topDevices: NamedStat[]; topAccessories: NamedStat[]; topRepairTypes: NamedStat[];
  topCustomers: { name: string; spent: number }[]; topTechnicians: { name: string; count: number }[];
  // repair metrics
  repairsCreated: number; repairsCompletedCount: number; repairsWaitingParts: number; repairsReady: number; avgCompletionDays: number;
  // inventory (current snapshot)
  invCost: number; invRetail: number; potentialProfit: number; lowStock: number; outOfStock: number;
  // chart series
  revenueSeries: { date: string; revenue: number; profit: number }[];
  categorySeries: { name: string; value: number }[];
  paymentSeries: { name: string; value: number }[];
  repairStatusSeries: { name: string; value: number }[];
  // recent activity + EOD
  recent: ActivityEntry[];
  eod: EndOfDay;
}

export interface EndOfDay {
  label: string;
  revenue: number; grossProfit: number; sales: number; repairs: number;
  cashReceived: number; cardReceived: number; etransferReceived: number;
  repairsCompleted: number; devicesSold: number; openRepairs: number; devicesWaitingPickup: number;
}

export interface AnalyticsInput {
  salesTransactions: SalesTransaction[];
  repairs: Repair[];
  inventory: InventoryItem[];
  customers: Customer[];
  auditLogs: AuditEntry[];
  activity: ActivityEntry[];
}

const DEVICE_CATEGORY = (t?: DeviceType): string => {
  switch (t) {
    case 'Phone': return 'Phones';
    case 'Tablet': return 'Tablets';
    case 'Laptop': return 'Laptops';
    case 'Watch': return 'Watches';
    default: return 'Other Devices';
  }
};

export function computeAnalytics(range: DateRange, input: AnalyticsInput, now: number = Date.now()): Analytics {
  const { salesTransactions, repairs, inventory, customers, auditLogs, activity } = input;
  const invById = new Map(inventory.map(i => [i.id, i]));
  const invBySku = new Map(inventory.filter(i => i.sku).map(i => [i.sku!, i]));
  const lineCost = (l: { inventoryId?: string; sku?: string }) => {
    const it = (l.inventoryId && invById.get(l.inventoryId)) || (l.sku && invBySku.get(l.sku)) || undefined;
    return it ? (it.purchaseCost || 0) + (it.repairCost || 0) : 0;
  };
  const lineCategory = (l: { inventoryId?: string; sku?: string; kind: string; name: string; deviceType?: DeviceType }) => {
    if (l.kind === 'accessory') return 'Accessories';
    const it = (l.inventoryId && invById.get(l.inventoryId)) || (l.sku && invBySku.get(l.sku)) || undefined;
    // Prefer the resolved inventory item's type; fall back to the type recorded on
    // the line itself (custom device sales have no inventory item to resolve to).
    return DEVICE_CATEGORY(it?.deviceType ?? l.deviceType);
  };

  // --- Sales: POS transactions in range ---
  // A layaway (balance still owing) is captured but NOT yet recognized as
  // revenue/profit — the sale isn't fully settled, so it's excluded until the
  // balance is paid off (at which point balanceOwing clears and it counts).
  // A reversed sale (voided or returned) never counts as revenue/profit, and a
  // layaway with a balance still owing is deferred until it's paid off.
  const txns = salesTransactions.filter(t => inRange(ymdMs(t.date), range) && !isReversed(t) && !((t.balanceOwing || 0) > 0));
  const txnInvIds = new Set<string>();
  salesTransactions.forEach(t => t.lines?.forEach(l => l.inventoryId && txnInvIds.add(l.inventoryId)));

  let revenue = 0, grossProfit = 0, devicesSold = 0, salesCount = 0;
  let deviceRev = 0, deviceProfit = 0, accRev = 0, accessoryProfit = 0;
  const payments = { cash: 0, card: 0, etransfer: 0, storeCredit: 0, other: 0 };
  const cat = new Map<string, NamedStat>();
  const bumpCat = (name: string, rev: number, profit: number, count = 0) => {
    const c = cat.get(name) || { name, revenue: 0, profit: 0, count: 0 };
    c.revenue += rev; c.profit += profit; c.count += count; cat.set(name, c);
  };
  const devAgg = new Map<string, NamedStat>();
  const accAgg = new Map<string, NamedStat>();
  const rtAgg = new Map<string, NamedStat>();
  // Repairs checked out through Quick Sale carry a `repairId` on their sales
  // transaction. Their money is recognized here as a sale (headline revenue /
  // profit / payments), and attributed to the Repairs category + repair
  // aggregates below — NOT to devices/accessories — and the matching repair
  // records are excluded from the independent repair tally to avoid double count.
  const repairById = new Map(repairs.map(r => [r.id, r]));
  let repairTxnRevenue = 0, repairTxnProfit = 0, repairTxnPartsCost = 0;

  for (const t of txns) {
    revenue += t.subtotal || 0;
    grossProfit += t.netProfit || 0;
    salesCount += 1;
    // payment split — prefer explicit amounts, else bucket by method.
    const cash = t.cashAmount || 0, card = t.cardAmount || 0, etr = t.etransferAmount || 0;
    if (cash || card || etr) { payments.cash += cash; payments.card += card; payments.etransfer += etr; payments.other += Math.max(0, (t.totalPaid || 0) - cash - card - etr); }
    else if (t.paymentMethod === 'cash') payments.cash += t.totalPaid || 0;
    else if (t.paymentMethod === 'card') payments.card += t.totalPaid || 0;
    else payments.other += t.totalPaid || 0;

    // Repair checkout: attribute the whole sale to Repairs (its single service
    // line is priced at the repair price, cost = parts), keeping it out of the
    // device/accessory breakdowns.
    if (t.repairId) {
      const rev = t.subtotal || 0, profit = t.netProfit || 0;
      repairTxnRevenue += rev; repairTxnProfit += profit; repairTxnPartsCost += t.purchaseCost || 0;
      bumpCat('Repairs', rev, profit, 1);
      const key = ((repairById.get(t.repairId)?.issue) || 'Repair').trim().slice(0, 40) || 'Repair';
      const a = rtAgg.get(key) || { name: key, revenue: 0, profit: 0, count: 0 };
      a.revenue += rev; a.profit += profit; a.count += 1; rtAgg.set(key, a);
      continue;
    }

    // per-line revenue + proportional profit allocation
    const lineRevs = (t.lines || []).map(l => (l.unitPrice || 0) * (l.quantity || 0));
    const totalLineRev = lineRevs.reduce((a, b) => a + b, 0) || 1;
    (t.lines || []).forEach((l, i) => {
      const rev = lineRevs[i];
      const profit = (t.netProfit || 0) * (rev / totalLineRev);
      const category = lineCategory(l);
      bumpCat(category, rev, profit, l.quantity || 0);
      if (l.kind === 'device') {
        deviceRev += rev; deviceProfit += profit; devicesSold += l.quantity || 0;
        const d = devAgg.get(l.name) || { name: l.name, revenue: 0, profit: 0, count: 0 }; d.revenue += rev; d.profit += profit; d.count += l.quantity || 0; devAgg.set(l.name, d);
      } else {
        accRev += rev; accessoryProfit += profit;
        const a = accAgg.get(l.name) || { name: l.name, revenue: 0, profit: 0, count: 0 }; a.revenue += rev; a.profit += profit; a.count += l.quantity || 0; accAgg.set(l.name, a);
      }
    });
  }

  // --- Standalone sold inventory devices (not captured in a transaction) ---
  for (const i of inventory) {
    if (kindOf(i) !== 'device' || !i.soldDate || txnInvIds.has(i.id)) continue;
    if (!inRange(ymdMs(i.soldDate), range)) continue;
    const rev = i.salePrice || 0;
    const profit = rev - (i.purchaseCost || 0) - (i.repairCost || 0) - (i.platformFees || 0);
    revenue += rev; grossProfit += profit; salesCount += 1; devicesSold += 1;
    deviceRev += rev; deviceProfit += profit;
    bumpCat(DEVICE_CATEGORY(i.deviceType), rev, profit, 1);
    const nm = i.item || [i.brand, i.model].filter(Boolean).join(' ') || 'Device';
    const d = devAgg.get(nm) || { name: nm, revenue: 0, profit: 0, count: 0 }; d.revenue += rev; d.profit += profit; d.count += 1; devAgg.set(nm, d);
    const cash = i.cashAmount || 0;
    if (cash) { payments.cash += cash; payments.other += Math.max(0, rev - cash); }
    else if (i.paymentMethod === 'cash') payments.cash += rev;
    else if (i.paymentMethod === 'card') payments.card += rev;
    else payments.other += rev;
  }

  // --- Repairs ---
  const repairsInRange = repairs.filter(r => inRange(r.createdAt || ymdMs(r.date), range));
  const completedInRange = repairs.filter(r => (r.completedAt && inRange(r.completedAt, range)) || (!r.completedAt && (r.status === 'completed' || r.status === 'picked_up') && inRange(ymdMs(r.date), range)));
  // Repairs whose revenue was recognized through a Quick Sale checkout are already
  // counted above (via their sales transaction). Only the rest — open tickets,
  // legacy completions, wholesale/internal work — are tallied from the records so
  // the money is never counted twice.
  const unlinkedInRange = repairsInRange.filter(r => !r.salesTransactionId);
  const recRepairRevenue = unlinkedInRange.reduce((s, r) => s + (r.repairPrice || 0), 0);
  const recRepairPartsCost = unlinkedInRange.reduce((s, r) => s + partsCostOf(r), 0);
  const repairRevenue = repairTxnRevenue + recRepairRevenue;
  const repairPartsCost = repairTxnPartsCost + recRepairPartsCost;
  const repairProfit = repairTxnProfit + (recRepairRevenue - recRepairPartsCost);
  const repairLabourRevenue = repairRevenue - repairPartsCost; // parts billed at cost → labour = margin
  bumpCat('Repairs', recRepairRevenue, recRepairRevenue - recRepairPartsCost, unlinkedInRange.length);

  // repair types (group by normalized issue) — sale-linked repairs already added
  // to rtAgg in the transaction loop; add the remaining record-based ones here.
  for (const r of unlinkedInRange) {
    const key = (r.issue || 'Repair').trim().slice(0, 40) || 'Repair';
    const a = rtAgg.get(key) || { name: key, revenue: 0, profit: 0, count: 0 };
    a.revenue += r.repairPrice || 0; a.profit += (r.repairPrice || 0) - partsCostOf(r); a.count += 1; rtAgg.set(key, a);
  }

  const completedTimes = completedInRange.filter(r => r.completedAt && r.createdAt).map(r => (r.completedAt! - r.createdAt) / DAY);
  const avgCompletionDays = completedTimes.length ? completedTimes.reduce((a, b) => a + b, 0) / completedTimes.length : 0;

  // Trade-ins: reserved category (0 until a trade-in module lands).
  bumpCat('Trade-Ins', 0, 0, 0);

  // --- Top customers by lifetime spend ---
  const custData = { salesTransactions, repairs, batches: [], inventory };
  const topCustomers = customers
    .map(c => ({ name: c.name || c.company || 'Customer', spent: customerStats(c, custData, now).lifetimeSpent }))
    .filter(c => c.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 5);

  // --- Most active technicians (audit actors on repairs, in range) ---
  const techCount = new Map<string, number>();
  for (const a of auditLogs) {
    if (a.entityType === 'repair' && inRange(a.ts, range) && (a.action.startsWith('repair.tech') || a.action === 'repair.status_change')) {
      techCount.set(a.userEmail, (techCount.get(a.userEmail) || 0) + 1);
    }
  }
  const topTechnicians = [...techCount.entries()].map(([name, count]) => ({ name: name.split('@')[0], count })).sort((a, b) => b.count - a.count).slice(0, 5);

  // --- Inventory snapshot ---
  const held = inventory.filter(i => kindOf(i) === 'device' && !i.soldDate && i.deviceStatus !== 'sold');
  const accessories = inventory.filter(i => kindOf(i) === 'accessory');
  const invCost = held.reduce((a, i) => a + (i.purchaseCost || 0) + (i.repairCost || 0), 0)
    + accessories.reduce((a, i) => a + (i.costPerUnit || 0) * (i.quantity || 0), 0);
  const invRetail = held.reduce((a, i) => a + (i.targetSalePrice || 0), 0)
    + accessories.reduce((a, i) => a + (i.sellingPrice || 0) * (i.quantity || 0), 0);
  // Fallback matches every other low-stock check in the app (InventoryView,
  // Dashboard, domain/alerts.ts) — `?? 0`, not `|| 3`. An accessory with no
  // threshold explicitly set previously showed as low stock here (any
  // quantity 1-3) but nowhere else in the app for the same data.
  const lowStock = accessories.filter(i => (i.quantity || 0) > 0 && (i.quantity || 0) <= (i.lowStockThreshold ?? 0)).length;
  const outOfStock = accessories.filter(i => (i.quantity || 0) <= 0).length;

  // --- Chart series (daily buckets across the range, capped) ---
  const revenueSeries = buildDailySeries(range, txns, inventory, txnInvIds);
  const categories = [...cat.values()].filter(c => c.count > 0 || c.revenue !== 0).sort((a, b) => b.revenue - a.revenue);
  const categorySeries = categories.map(c => ({ name: c.name, value: Math.round(c.revenue) }));
  const paymentSeries = [
    { name: 'Cash', value: Math.round(payments.cash) },
    { name: 'Card', value: Math.round(payments.card) },
    { name: 'E-Transfer', value: Math.round(payments.etransfer) },
    { name: 'Store Credit', value: Math.round(payments.storeCredit) },
    { name: 'Other', value: Math.round(payments.other) },
  ].filter(p => p.value > 0);

  const statusOrder: [string, (r: Repair) => boolean][] = [
    ['Waiting Approval', r => r.status === 'waiting_approval'],
    ['Waiting Parts', r => r.status === 'waiting_parts'],
    ['In Repair', r => r.status === 'in_repair'],
    ['Testing', r => r.status === 'testing'],
    ['Ready', r => r.status === 'ready_pickup'],
  ];
  const repairStatusSeries = statusOrder.map(([name, pred]) => ({ name, value: repairs.filter(pred).length })).filter(x => x.value > 0);

  const eod: EndOfDay = {
    label: range.label,
    revenue, grossProfit, sales: salesCount, repairs: repairsInRange.length,
    cashReceived: payments.cash, cardReceived: payments.card, etransferReceived: payments.etransfer,
    repairsCompleted: completedInRange.length, devicesSold,
    openRepairs: repairs.filter(isRepairOpen).length,
    devicesWaitingPickup: repairs.filter(r => r.status === 'ready_pickup').length,
  };

  return {
    revenue, grossProfit, grossMargin: revenue ? (grossProfit / revenue) * 100 : 0,
    salesCount, repairsCount: repairsInRange.length, devicesSold, repairsCompleted: completedInRange.length,
    avgSale: salesCount ? revenue / salesCount : 0,
    avgRepair: repairsInRange.length ? repairRevenue / repairsInRange.length : 0,
    deviceProfit, accessoryProfit,
    repairRevenue, repairPartsCost, repairLabourRevenue, repairProfit,
    payments, categories,
    topDevices: [...devAgg.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    topAccessories: [...accAgg.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    topRepairTypes: [...rtAgg.values()].sort((a, b) => b.count - a.count).slice(0, 5),
    topCustomers, topTechnicians,
    repairsCreated: repairsInRange.length,
    repairsCompletedCount: completedInRange.length,
    repairsWaitingParts: repairs.filter(r => r.status === 'waiting_parts').length,
    repairsReady: repairs.filter(r => r.status === 'ready_pickup').length,
    avgCompletionDays,
    invCost, invRetail, potentialProfit: invRetail - invCost, lowStock, outOfStock,
    revenueSeries, categorySeries, paymentSeries, repairStatusSeries,
    recent: [...activity].sort((a, b) => b.ts - a.ts).slice(0, 12),
    eod,
  };
}

// Daily revenue/profit series across the range (max ~60 points).
function buildDailySeries(range: DateRange, txns: SalesTransaction[], inventory: InventoryItem[], txnInvIds: Set<string>) {
  const days = Math.min(60, Math.max(1, Math.round((range.end - range.start) / DAY)));
  const buckets = new Map<string, { revenue: number; profit: number }>();
  const keyOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  for (let i = 0; i < days; i++) buckets.set(keyOf(range.start + i * DAY), { revenue: 0, profit: 0 });
  const add = (ymd: string, revenue: number, profit: number) => {
    const b = buckets.get(ymd); if (b) { b.revenue += revenue; b.profit += profit; }
  };
  txns.forEach(t => add(t.date, t.subtotal || 0, t.netProfit || 0));
  inventory.forEach(i => {
    if (kindOf(i) === 'device' && i.soldDate && !txnInvIds.has(i.id) && buckets.has(i.soldDate)) {
      add(i.soldDate, i.salePrice || 0, (i.salePrice || 0) - (i.purchaseCost || 0) - (i.repairCost || 0) - (i.platformFees || 0));
    }
  });
  return [...buckets.entries()].map(([date, v]) => ({ date: date.slice(5), revenue: Math.round(v.revenue), profit: Math.round(v.profit) }));
}

// --- Export helpers (EOD summary) ---
export function eodRows(eod: EndOfDay): [string, string][] {
  const m = (n: number) => n.toFixed(2);
  return [
    ['Period', eod.label],
    ['Revenue', m(eod.revenue)],
    ['Gross Profit', m(eod.grossProfit)],
    ['Sales', String(eod.sales)],
    ['Repairs', String(eod.repairs)],
    ['Cash Received', m(eod.cashReceived)],
    ['Card Received', m(eod.cardReceived)],
    ['E-Transfer Received', m(eod.etransferReceived)],
    ['Repairs Completed', String(eod.repairsCompleted)],
    ['Devices Sold', String(eod.devicesSold)],
    ['Open Repairs', String(eod.openRepairs)],
    ['Devices Waiting Pickup', String(eod.devicesWaitingPickup)],
  ];
}

export const eodCsv = (eod: EndOfDay): string =>
  ['Metric,Value', ...eodRows(eod).map(([k, v]) => `${k},${/[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v}`)].join('\n');
