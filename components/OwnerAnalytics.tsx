import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell,
} from 'recharts';
import {
  BarChart3, DollarSign, TrendingUp, Percent, ShoppingCart, Wrench, Smartphone, CheckCircle2,
  CreditCard, Package, Clock, Users as UsersIcon, Download, FileText, Activity, AlertTriangle,
} from 'lucide-react';
import { SalesTransaction, Repair, InventoryItem, Customer, AuditEntry, ActivityEntry } from '../types';
import { jsPDF } from 'jspdf';
import {
  computeAnalytics, presetRange, RangePreset, eodRows, eodCsv, AnalyticsInput,
} from '../domain/analytics';

interface Props {
  salesTransactions: SalesTransaction[];
  repairs: Repair[];
  inventory: InventoryItem[];
  customers: Customer[];
  auditLogs: AuditEntry[];
  activity: ActivityEntry[];
  darkMode: boolean;
}

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;
const PALETTE = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16'];
const PRESETS: { id: RangePreset; label: string }[] = [
  { id: 'today', label: 'Today' }, { id: 'yesterday', label: 'Yesterday' }, { id: 'last7', label: 'Last 7 Days' },
  { id: 'month', label: 'This Month' }, { id: 'year', label: 'This Year' }, { id: 'custom', label: 'Custom' },
];

const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl';

export const OwnerAnalytics: React.FC<Props> = ({ salesTransactions, repairs, inventory, customers, auditLogs, activity, darkMode }) => {
  const [preset, setPreset] = useState<RangePreset>('today');
  const [custom, setCustom] = useState({ start: '', end: '' });

  const range = useMemo(() => presetRange(preset, Date.now(), custom), [preset, custom]);
  const input: AnalyticsInput = { salesTransactions, repairs, inventory, customers, auditLogs, activity };
  const a = useMemo(() => computeAnalytics(range, input), [range, salesTransactions, repairs, inventory, customers, auditLogs, activity]);

  const axis = darkMode ? '#94a3b8' : '#64748b';
  const grid = darkMode ? '#1e293b' : '#e2e8f0';

  const exportCsv = () => {
    const blob = new Blob([eodCsv(a.eod)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `ftt-eod-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(url);
  };
  const exportPdf = () => {
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.text('FlipThatTech — End of Day', 40, 54);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.text(`${a.eod.label} · generated ${new Date().toLocaleString()}`, 40, 72);
    let y = 104;
    eodRows(a.eod).forEach(([k, v]) => {
      const val = /^-?\d+\.\d{2}$/.test(v) ? `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : v;
      pdf.setFont('helvetica', 'bold'); pdf.text(k, 40, y);
      pdf.setFont('helvetica', 'normal'); pdf.text(String(val), 300, y); y += 22;
    });
    pdf.save(`ftt-eod-${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header + range */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2"><BarChart3 className="w-6 h-6 text-indigo-500" /> Owner Analytics</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRESETS.map(p => (
            <button key={p.id} onClick={() => setPreset(p.id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${preset === p.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'}`}>{p.label}</button>
          ))}
        </div>
      </div>
      {preset === 'custom' && (
        <div className="flex items-center gap-2 text-sm">
          <input type="date" value={custom.start} onChange={e => setCustom(c => ({ ...c, start: e.target.value }))} className="px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg" />
          <span className="text-slate-400">to</span>
          <input type="date" value={custom.end} onChange={e => setCustom(c => ({ ...c, end: e.target.value }))} className="px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg" />
        </div>
      )}

      {/* Overview cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi icon={<DollarSign className="w-4 h-4" />} label="Revenue" value={money0(a.revenue)} />
        <Kpi icon={<TrendingUp className="w-4 h-4" />} label="Gross Profit" value={money0(a.grossProfit)} accent="text-emerald-600 dark:text-emerald-400" />
        <Kpi icon={<Percent className="w-4 h-4" />} label="Gross Margin" value={`${a.grossMargin.toFixed(1)}%`} />
        <Kpi icon={<ShoppingCart className="w-4 h-4" />} label="Sales" value={String(a.salesCount)} />
        <Kpi icon={<Wrench className="w-4 h-4" />} label="Repairs" value={String(a.repairsCount)} />
        <Kpi icon={<Smartphone className="w-4 h-4" />} label="Devices Sold" value={String(a.devicesSold)} />
        <Kpi icon={<CheckCircle2 className="w-4 h-4" />} label="Repairs Completed" value={String(a.repairsCompleted)} />
        <Kpi icon={<DollarSign className="w-4 h-4" />} label="Avg Sale" value={money0(a.avgSale)} />
        <Kpi icon={<Wrench className="w-4 h-4" />} label="Avg Repair" value={money0(a.avgRepair)} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Panel title="Revenue & Profit over time">
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={a.revenueSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke={grid} />
              <XAxis dataKey="date" stroke={axis} fontSize={11} />
              <YAxis stroke={axis} fontSize={11} />
              <Tooltip contentStyle={{ background: darkMode ? '#0f172a' : '#fff', border: `1px solid ${grid}`, borderRadius: 8 }} />
              <Legend />
              <Line type="monotone" dataKey="revenue" stroke="#6366f1" strokeWidth={2} dot={false} name="Revenue" />
              <Line type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} dot={false} name="Profit" />
            </LineChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Sales by Category">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={a.categorySeries} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(e: any) => e.name}>
                {a.categorySeries.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => money0(Number(v))} contentStyle={{ background: darkMode ? '#0f172a' : '#fff', border: `1px solid ${grid}`, borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Payment Method Breakdown">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={a.paymentSeries} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={80} label={(e: any) => e.name}>
                {a.paymentSeries.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => money0(Number(v))} contentStyle={{ background: darkMode ? '#0f172a' : '#fff', border: `1px solid ${grid}`, borderRadius: 8 }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Repair Status Breakdown">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={a.repairStatusSeries}>
              <CartesianGrid strokeDasharray="3 3" stroke={grid} />
              <XAxis dataKey="name" stroke={axis} fontSize={11} />
              <YAxis stroke={axis} fontSize={11} allowDecimals={false} />
              <Tooltip contentStyle={{ background: darkMode ? '#0f172a' : '#fff', border: `1px solid ${grid}`, borderRadius: 8 }} />
              <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} name="Repairs" />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      {/* Profit breakdown + Payments + Repair/Inventory metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <Panel title="Profit Breakdown">
          <Line2 label="Device Sales Profit" value={money(a.deviceProfit)} />
          <Line2 label="Accessory Profit" value={money(a.accessoryProfit)} />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1.5" />
          <Line2 label="Repair Labour Revenue" value={money(a.repairLabourRevenue)} />
          <Line2 label="Repair Parts Cost" value={money(a.repairPartsCost)} />
          <Line2 label="Repair Profit" value={money(a.repairProfit)} strong />
        </Panel>
        <Panel title="Payments Received">
          <Line2 label="Cash" value={money(a.payments.cash)} />
          <Line2 label="Card" value={money(a.payments.card)} />
          <Line2 label="E-Transfer" value={money(a.payments.etransfer)} />
          <Line2 label="Store Credit" value={money(a.payments.storeCredit)} />
          <Line2 label="Other" value={money(a.payments.other)} />
        </Panel>
        <Panel title="Repair Metrics">
          <Line2 label="Created" value={String(a.repairsCreated)} />
          <Line2 label="Completed" value={String(a.repairsCompletedCount)} />
          <Line2 label="Waiting Parts" value={String(a.repairsWaitingParts)} />
          <Line2 label="Ready for Pickup" value={String(a.repairsReady)} />
          <Line2 label="Avg Completion" value={`${a.avgCompletionDays.toFixed(1)} days`} />
        </Panel>
        <Panel title="Inventory Metrics">
          <Line2 label="Inventory Cost" value={money0(a.invCost)} />
          <Line2 label="Retail Value" value={money0(a.invRetail)} />
          <Line2 label="Potential Profit" value={money0(a.potentialProfit)} strong />
          <Line2 label="Low Stock" value={String(a.lowStock)} />
          <Line2 label="Out of Stock" value={String(a.outOfStock)} />
        </Panel>
      </div>

      {/* Category table */}
      <Panel title="Category Breakdown">
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="text-left py-2">Category</th><th className="text-right py-2">Units</th><th className="text-right py-2">Revenue</th><th className="text-right py-2">Profit</th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {a.categories.length === 0 && <tr><td colSpan={4} className="text-center text-slate-400 py-6">No sales in this range.</td></tr>}
            {a.categories.map(c => (
              <tr key={c.name}>
                <td className="py-2 text-slate-700 dark:text-slate-200">{c.name}</td>
                <td className="py-2 text-right text-slate-500">{c.count}</td>
                <td className="py-2 text-right font-medium text-slate-800 dark:text-slate-100">{money(c.revenue)}</td>
                <td className={`py-2 text-right font-medium ${c.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{money(c.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Panel>

      {/* Top performers */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <TopList title="Top Selling Devices" icon={<Smartphone className="w-4 h-4" />} rows={a.topDevices.map(d => [d.name, money0(d.revenue)])} />
        <TopList title="Top Selling Accessories" icon={<Package className="w-4 h-4" />} rows={a.topAccessories.map(d => [d.name, `${d.count}×`])} />
        <TopList title="Top Repair Types" icon={<Wrench className="w-4 h-4" />} rows={a.topRepairTypes.map(d => [d.name, `${d.count}×`])} />
        <TopList title="Top Customers (Lifetime)" icon={<UsersIcon className="w-4 h-4" />} rows={a.topCustomers.map(d => [d.name, money0(d.spent)])} />
        <TopList title="Most Active Technicians" icon={<Wrench className="w-4 h-4" />} rows={a.topTechnicians.map(d => [d.name, `${d.count} actions`])} />
        <Panel title="Recent Activity">
          {a.recent.length === 0 ? <p className="text-sm text-slate-400 py-4 text-center">No recent activity.</p> : (
            <ul className="space-y-2">
              {a.recent.map(e => (
                <li key={e.id} className="flex items-start gap-2 text-xs">
                  <Activity className="w-3 h-3 text-indigo-400 mt-0.5 shrink-0" />
                  <span className="text-slate-600 dark:text-slate-300">{e.text} <span className="text-slate-400">· {new Date(e.ts).toLocaleString()}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* End of Day summary */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-500" /> End-of-Day Summary <span className="text-xs font-normal text-slate-400">· {a.eod.label}</span></h3>
          <div className="flex gap-2">
            <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:border-indigo-400"><Download className="w-3.5 h-3.5" /> CSV</button>
            <button onClick={exportPdf} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:border-indigo-400"><FileText className="w-3.5 h-3.5" /> PDF</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Eod label="Revenue" value={money0(a.eod.revenue)} />
          <Eod label="Gross Profit" value={money0(a.eod.grossProfit)} />
          <Eod label="Sales" value={String(a.eod.sales)} />
          <Eod label="Repairs" value={String(a.eod.repairs)} />
          <Eod label="Cash" value={money0(a.eod.cashReceived)} />
          <Eod label="Card" value={money0(a.eod.cardReceived)} />
          <Eod label="E-Transfer" value={money0(a.eod.etransferReceived)} />
          <Eod label="Repairs Completed" value={String(a.eod.repairsCompleted)} />
          <Eod label="Devices Sold" value={String(a.eod.devicesSold)} />
          <Eod label="Open Repairs" value={String(a.eod.openRepairs)} />
          <Eod label="Waiting Pickup" value={String(a.eod.devicesWaitingPickup)} />
        </div>
      </div>
    </div>
  );
};

const Kpi: React.FC<{ icon: React.ReactNode; label: string; value: string; accent?: string }> = ({ icon, label, value, accent }) => (
  <div className={`${card} p-3`}>
    <p className="text-[11px] uppercase tracking-wide text-slate-400 flex items-center gap-1">{icon}{label}</p>
    <p className={`text-xl font-bold mt-0.5 ${accent || 'text-slate-900 dark:text-white'}`}>{value}</p>
  </div>
);
const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className={`${card} p-4`}><h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">{title}</h3>{children}</div>
);
const Line2: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div className="flex items-center justify-between py-1 text-sm"><span className="text-slate-500 dark:text-slate-400">{label}</span><span className={`${strong ? 'font-bold' : 'font-medium'} text-slate-800 dark:text-slate-100`}>{value}</span></div>
);
const Eod: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-2.5"><p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p><p className="text-base font-bold text-slate-900 dark:text-white">{value}</p></div>
);
const TopList: React.FC<{ title: string; icon: React.ReactNode; rows: [string, string][] }> = ({ title, icon, rows }) => (
  <div className={`${card} p-4`}>
    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2">{icon}{title}</h3>
    {rows.length === 0 ? <p className="text-sm text-slate-400 py-4 text-center">No data.</p> : (
      <ol className="space-y-1.5">
        {rows.map(([name, value], i) => (
          <li key={i} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 min-w-0"><span className="text-slate-400 w-4 shrink-0">{i + 1}.</span><span className="text-slate-700 dark:text-slate-200 truncate">{name}</span></span>
            <span className="font-medium text-slate-800 dark:text-slate-100 shrink-0 ml-2">{value}</span>
          </li>
        ))}
      </ol>
    )}
  </div>
);
