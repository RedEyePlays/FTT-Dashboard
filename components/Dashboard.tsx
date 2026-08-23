import React, { useMemo } from 'react';
import { InventoryItem, SalesTransaction, ActivityEntry, Repair, RepairBatch } from '../types';
import { kindOf } from '../domain/inventory';
import { isInProgress } from '../domain/repairs';
import {
  DollarSign, TrendingUp, CalendarDays, CalendarRange, Calendar, Smartphone, Package,
  Tag, Wrench, ShoppingCart, AlertTriangle, Clock, Receipt, Activity as ActivityIcon,
  Store, BarChart3, ArrowRight, ClipboardCheck, PackageSearch, PackageCheck, Building2, CheckCircle2, CalendarClock,
} from 'lucide-react';

interface DashboardProps {
  data: InventoryItem[];              // devices + accessories (inventory)
  salesTransactions: SalesTransaction[];
  activity: ActivityEntry[];
  repairs?: Repair[];
  repairBatches?: RepairBatch[];
  canViewProfit?: boolean;
  onViewAnalytics?: () => void;
  onViewRepairs?: () => void;
}

// --- date helpers (all comparisons are on local YYYY-MM-DD strings) ---
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const money = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;
const money2 = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const daysAgo = (dateStr: string) => Math.max(0, Math.floor((Date.now() - new Date(dateStr + 'T00:00:00').getTime()) / 86400000));
const relTime = (ts: number) => {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};
const platformLabel = (p?: string) => (p && p !== 'None / In-Store' ? p : 'In-Store');

export const Dashboard: React.FC<DashboardProps> = ({ data, salesTransactions, activity, repairs = [], repairBatches = [], canViewProfit = true, onViewAnalytics, onViewRepairs }) => {
  const mask = (v: string) => (canViewProfit ? v : '•••');

  const rep = useMemo(() => {
    const todayStr = ymd(new Date());
    const count = (pred: (r: Repair) => boolean) => repairs.filter(pred).length;
    return {
      inProgress: count(isInProgress),
      waitingApproval: count(r => r.status === 'waiting_approval'),
      waitingParts: count(r => r.status === 'waiting_parts'),
      readyPickup: count(r => r.status === 'ready_pickup'),
      batchesActive: repairBatches.filter(b => b.status === 'active').length,
      completedToday: count(r => r.status === 'completed' && !!r.completedAt && ymd(new Date(r.completedAt)) === todayStr),
      dueToday: count(r => r.status !== 'completed' && r.status !== 'cancelled' && r.estimatedCompletion === todayStr),
    };
  }, [repairs, repairBatches]);
  const anyRepairs = repairs.length > 0 || repairBatches.length > 0;

  const m = useMemo(() => {
    const now = new Date();
    const todayStr = ymd(now);
    const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 6);
    const weekAgoStr = ymd(weekAgo);
    const monthPrefix = todayStr.slice(0, 7);

    // Sales events, unioned & de-duplicated: every transaction, plus any device
    // sold directly on its inventory row that isn't already in a transaction.
    const txnInvIds = new Set<string>();
    salesTransactions.forEach(t => t.lines?.forEach(l => { if (l.inventoryId) txnInvIds.add(l.inventoryId); }));
    const events: { date: string; revenue: number; profit: number }[] = [];
    salesTransactions.forEach(t => events.push({ date: t.date, revenue: t.subtotal || 0, profit: t.netProfit || 0 }));
    data.forEach(i => {
      if (kindOf(i) === 'device' && i.soldDate && !txnInvIds.has(i.id)) {
        const revenue = i.salePrice || 0;
        const profit = revenue - (i.purchaseCost || 0) - (i.repairCost || 0) - (i.shippingCost || 0) - (i.platformFees || 0);
        events.push({ date: i.soldDate, revenue, profit });
      }
    });
    const bucket = (pred: (d: string) => boolean) =>
      events.filter(e => pred(e.date)).reduce((a, e) => ({ revenue: a.revenue + e.revenue, profit: a.profit + e.profit }), { revenue: 0, profit: 0 });

    // Inventory snapshot
    const devices = data.filter(i => kindOf(i) === 'device');
    const accessories = data.filter(i => kindOf(i) === 'accessory');
    const soldDev = (i: InventoryItem) => !!i.soldDate || i.deviceStatus === 'sold';
    const held = devices.filter(i => !soldDev(i) && i.deviceStatus !== 'returned');
    const deviceCost = (i: InventoryItem) => (i.purchaseCost || 0) + (i.repairCost || 0);
    // Expected resale value. When an item has no sale price set yet (incomplete
    // data), fall back to its cost so it nets $0 in Expected Gross Profit rather
    // than counting as a full loss — while Inventory Cost still reflects all the
    // capital tied up, and the tiles stay reconciled (Value − Cost).
    const deviceValue = (i: InventoryItem) => (i.targetSalePrice || 0) > 0 ? i.targetSalePrice! : deviceCost(i);
    const accValue = (i: InventoryItem) => ((i.sellingPrice || 0) > 0 ? i.sellingPrice! : (i.costPerUnit || 0)) * (i.quantity || 0);
    const invCost = held.reduce((a, i) => a + deviceCost(i), 0)
      + accessories.reduce((a, i) => a + (i.costPerUnit || 0) * (i.quantity || 0), 0);
    const invValue = held.reduce((a, i) => a + deviceValue(i), 0)
      + accessories.reduce((a, i) => a + accValue(i), 0);

    const pendingRepairsList = devices.filter(i => i.deviceStatus === 'pending_repair');
    const oldestRepair = pendingRepairsList.reduce<string>((min, i) => (i.date && (!min || i.date < min) ? i.date : min), '');
    const lowStockList = accessories.filter(i => (i.quantity ?? 0) <= (i.lowStockThreshold ?? 0))
      .sort((a, b) => (a.quantity ?? 0) - (b.quantity ?? 0));

    // Recent sales (transactions only — they carry customer/platform/profit)
    const recentSales = [...salesTransactions]
      .sort((a, b) => (a.date !== b.date ? b.date.localeCompare(a.date) : b.id.localeCompare(a.id)))
      .slice(0, 6);

    // Top-selling accessories (from transaction line items)
    const accAgg = new Map<string, { name: string; units: number; revenue: number }>();
    salesTransactions.forEach(t => t.lines?.forEach(l => {
      if (l.kind !== 'accessory') return;
      const key = l.sku || l.name;
      const cur = accAgg.get(key) || { name: l.name, units: 0, revenue: 0 };
      cur.units += l.quantity || 0;
      cur.revenue += (l.quantity || 0) * (l.unitPrice || 0);
      accAgg.set(key, cur);
    }));
    const topAccessories = [...accAgg.values()].sort((a, b) => b.units - a.units).slice(0, 5);

    // Best platforms
    const platAgg = new Map<string, { name: string; count: number; revenue: number; profit: number }>();
    salesTransactions.forEach(t => {
      const name = platformLabel(t.platformName);
      const cur = platAgg.get(name) || { name, count: 0, revenue: 0, profit: 0 };
      cur.count += 1; cur.revenue += t.subtotal || 0; cur.profit += t.netProfit || 0;
      platAgg.set(name, cur);
    });
    const bestPlatforms = [...platAgg.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5);

    return {
      today: bucket(d => d === todayStr),
      week: bucket(d => d >= weekAgoStr && d <= todayStr),
      month: bucket(d => d.startsWith(monthPrefix)),
      devicesInStock: held.length,
      accessoryUnits: accessories.reduce((a, i) => a + (i.quantity || 0), 0),
      accessorySkus: accessories.length,
      invCost, invValue, expectedGross: invValue - invCost,
      pendingRepairs: pendingRepairsList.length, oldestRepair,
      pendingPurchases: devices.filter(i => i.deviceStatus === 'pending_purchase').length,
      lowStockList,
      recentSales, topAccessories, bestPlatforms,
      maxPlatRev: Math.max(1, ...bestPlatforms.map(p => p.revenue)),
    };
  }, [data, salesTransactions]);

  const recentActivity = useMemo(() => [...activity].sort((a, b) => b.ts - a.ts).slice(0, 8), [activity]);

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Dashboard</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Your store at a glance.</p>
        </div>
        {onViewAnalytics && (
          <button onClick={onViewAnalytics} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-indigo-400 transition-colors shadow-sm">
            <BarChart3 className="w-4 h-4 text-indigo-500" /> Full Analytics <ArrowRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Period performance */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <PeriodCard icon={<CalendarDays className="w-5 h-5" />} title="Today" revenue={m.today.revenue} profit={m.today.profit} mask={mask} />
        <PeriodCard icon={<CalendarRange className="w-5 h-5" />} title="Last 7 Days" revenue={m.week.revenue} profit={m.week.profit} mask={mask} />
        <PeriodCard icon={<Calendar className="w-5 h-5" />} title="This Month" revenue={m.month.revenue} profit={m.month.profit} mask={mask} />
      </div>

      {/* Inventory snapshot */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile icon={<Smartphone className="w-5 h-5" />} accent="indigo" label="Devices in Stock" value={String(m.devicesInStock)} />
        <Tile icon={<Package className="w-5 h-5" />} accent="violet" label="Accessories in Stock" value={String(m.accessoryUnits)} sub={`${m.accessorySkus} SKUs`} />
        <Tile icon={<DollarSign className="w-5 h-5" />} accent="slate" label="Inventory Cost" value={money(m.invCost)} />
        <Tile icon={<Tag className="w-5 h-5" />} accent="blue" label="Inventory Value" value={money(m.invValue)} />
      </div>

      {/* Attention + expected profit */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile icon={<TrendingUp className="w-5 h-5" />} accent="emerald" label="Expected Gross Profit"
          value={mask(money(m.expectedGross))} sub="Value − Cost" valueClass={m.expectedGross >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} />
        <Tile icon={<Wrench className="w-5 h-5" />} accent="orange" label="Pending Repairs" value={String(m.pendingRepairs)}
          sub={m.oldestRepair ? `oldest ${daysAgo(m.oldestRepair)}d (${m.oldestRepair})` : undefined} />
        <Tile icon={<ShoppingCart className="w-5 h-5" />} accent="amber" label="Pending Purchases" value={String(m.pendingPurchases)} />
        <Tile icon={<AlertTriangle className="w-5 h-5" />} accent="rose" label="Low-Stock Accessories" value={String(m.lowStockList.length)} />
      </div>

      {/* Repairs */}
      {anyRepairs && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2"><Wrench className="w-4 h-4 text-indigo-500" /> Repairs</h3>
            {onViewRepairs && <button onClick={onViewRepairs} className="text-xs text-indigo-600 dark:text-indigo-400 flex items-center gap-1 hover:underline">Open Repairs <ArrowRight className="w-3 h-3" /></button>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-4">
            <Tile icon={<Wrench className="w-5 h-5" />} accent="blue" label="In Progress" value={String(rep.inProgress)} />
            <Tile icon={<ClipboardCheck className="w-5 h-5" />} accent="amber" label="Waiting Approval" value={String(rep.waitingApproval)} />
            <Tile icon={<PackageSearch className="w-5 h-5" />} accent="orange" label="Waiting on Parts" value={String(rep.waitingParts)} />
            <Tile icon={<PackageCheck className="w-5 h-5" />} accent="emerald" label="Ready for Pickup" value={String(rep.readyPickup)} />
            <Tile icon={<Building2 className="w-5 h-5" />} accent="violet" label="Active Batches" value={String(rep.batchesActive)} />
            <Tile icon={<CalendarClock className="w-5 h-5" />} accent="rose" label="Due Today" value={String(rep.dueToday)} />
            <Tile icon={<CheckCircle2 className="w-5 h-5" />} accent="slate" label="Completed Today" value={String(rep.completedToday)} />
          </div>
        </div>
      )}

      {/* Recent sales + recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel icon={<Receipt className="w-4 h-4 text-indigo-500" />} title="Recent Sales">
          {m.recentSales.length === 0 ? <Empty text="No sales yet." /> : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {m.recentSales.map(t => (
                <div key={t.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{t.customerName || 'Walk-in'}</p>
                    <p className="text-xs text-slate-400 flex items-center gap-1.5">
                      <span>{t.date}</span>·<span className="inline-flex items-center gap-1"><Store className="w-3 h-3" />{platformLabel(t.platformName)}</span>·<span>{t.lines?.length || 0} item{(t.lines?.length || 0) !== 1 ? 's' : ''}</span>
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{money2(t.totalPaid)}</p>
                    <p className={`text-xs font-medium ${(t.netProfit || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{mask(`${(t.netProfit || 0) >= 0 ? '+' : ''}${money2(t.netProfit)}`)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel icon={<ActivityIcon className="w-4 h-4 text-indigo-500" />} title="Recent Activity">
          {recentActivity.length === 0 ? <Empty text="No activity yet." /> : (
            <ul className="space-y-2">
              {recentActivity.map(a => (
                <li key={a.id} className="flex items-start justify-between gap-3 text-sm">
                  <span className="text-slate-600 dark:text-slate-300 border-l-2 border-indigo-200 dark:border-indigo-800 pl-2">{a.text}</span>
                  <span className="text-xs text-slate-400 shrink-0">{relTime(a.ts)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Top accessories + best platforms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel icon={<Package className="w-4 h-4 text-indigo-500" />} title="Top-Selling Accessories">
          {m.topAccessories.length === 0 ? <Empty text="No accessory sales yet." /> : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {m.topAccessories.map((a, idx) => (
                <div key={idx} className="py-2 flex items-center justify-between gap-3">
                  <span className="text-sm text-slate-700 dark:text-slate-200 truncate">{a.name}</span>
                  <div className="text-right shrink-0">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{a.units}</span>
                    <span className="text-xs text-slate-400"> sold · {money(a.revenue)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel icon={<Store className="w-4 h-4 text-indigo-500" />} title="Best Sales Platforms">
          {m.bestPlatforms.length === 0 ? <Empty text="No sales yet." /> : (
            <div className="space-y-3">
              {m.bestPlatforms.map((p, idx) => (
                <div key={idx}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{p.name}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {money(p.revenue)} · <span className={`${p.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{mask(money(p.profit))}</span> · {p.count} sale{p.count !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round((p.revenue / m.maxPlatRev) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* Low-stock list (only when there is something to flag) */}
      {m.lowStockList.length > 0 && (
        <Panel icon={<AlertTriangle className="w-4 h-4 text-rose-500" />} title="Low-Stock Accessories">
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {m.lowStockList.slice(0, 12).map(i => (
              <div key={i.id} className="py-2 flex items-center justify-between text-sm">
                <span className="text-slate-700 dark:text-slate-200 truncate">{i.item || i.sku}</span>
                <span className="font-semibold text-rose-600 dark:text-rose-400 shrink-0">{i.quantity ?? 0} / {i.lowStockThreshold ?? 0}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
};

/* ---------------- small presentational helpers ---------------- */

const ACCENTS: Record<string, string> = {
  indigo: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400',
  violet: 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
  blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  emerald: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  orange: 'bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400',
  amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  rose: 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

const PeriodCard: React.FC<{ icon: React.ReactNode; title: string; revenue: number; profit: number; mask: (v: string) => string }> = ({ icon, title, revenue, profit, mask }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm">
    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400 text-sm font-medium">
      <span className="text-indigo-500">{icon}</span>{title}
    </div>
    <div className="mt-2 flex items-end justify-between">
      <div>
        <p className="text-2xl font-bold text-slate-900 dark:text-white leading-tight">{money2(revenue)}</p>
        <p className="text-xs text-slate-400">Revenue</p>
      </div>
      <div className="text-right">
        <p className={`text-lg font-semibold ${profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{mask(money2(profit))}</p>
        <p className="text-xs text-slate-400">Profit</p>
      </div>
    </div>
  </div>
);

const Tile: React.FC<{ icon: React.ReactNode; accent: string; label: string; value: string; sub?: string; valueClass?: string }> = ({ icon, accent, label, value, sub, valueClass }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 shadow-sm flex items-center gap-3">
    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${ACCENTS[accent] || ACCENTS.slate}`}>{icon}</div>
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-slate-400 truncate">{label}</p>
      <p className={`text-lg font-bold leading-tight ${valueClass || 'text-slate-900 dark:text-white'}`}>{value}</p>
      {sub && <p className="text-[11px] text-slate-400 truncate">{sub}</p>}
    </div>
  </div>
);

const Panel: React.FC<{ icon: React.ReactNode; title: string; children: React.ReactNode }> = ({ icon, title, children }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm p-5">
    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-3">{icon}{title}</h3>
    {children}
  </div>
);

const Empty: React.FC<{ text: string }> = ({ text }) => <p className="text-sm text-slate-400 py-4 text-center">{text}</p>;
