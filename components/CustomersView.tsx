import React, { useState, useMemo } from 'react';
import {
  Users, Search, ArrowLeft, Phone, Mail, ShoppingCart, Wrench, Calendar, DollarSign,
  ChevronRight, Tag, Receipt, Star, Pencil, X, Clock,
} from 'lucide-react';
import { Customer, SalesTransaction, Repair, RepairBatch } from '../types';
import { customerStats, customerTimeline, matchCustomer, CustomerSort, CustomerData } from '../domain/customers';
import { REPAIR_STATUS_CELL, REPAIR_STATUS_LABEL } from '../domain/repairs';

interface Props {
  customers: Customer[];
  salesTransactions: SalesTransaction[];
  repairs: Repair[];
  batches: RepairBatch[];
  canViewProfit: boolean;
  canEdit: boolean;
  onSaveCustomer: (c: Customer, prev?: Customer) => void;
}

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;
const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleDateString() : '—');
const TAG_SUGGESTIONS = ['VIP', 'Wholesale', 'Business', 'Regular'];

export const CustomersView: React.FC<Props> = ({ customers, salesTransactions, repairs, batches, canViewProfit, canEdit, onSaveCustomer }) => {
  const data: CustomerData = { salesTransactions, repairs, batches };
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CustomerSort>('recent');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mask = (v: string) => (canViewProfit ? v : '•••');

  // Light stats for the list (derived; customers list is small).
  const rows = useMemo(() => {
    const withStats = customers.map(c => ({ c, s: customerStats(c, data) }));
    const filtered = withStats.filter(({ c }) => matchCustomer(c, query));
    filtered.sort((a, b) => {
      if (sort === 'name') return (a.c.name || a.c.company || '').localeCompare(b.c.name || b.c.company || '');
      if (sort === 'spent') return b.s.lifetimeSpent - a.s.lifetimeSpent;
      return b.s.lastActivity - a.s.lastActivity; // recent
    });
    return filtered;
  }, [customers, salesTransactions, repairs, batches, query, sort]);

  const selected = customers.find(c => c.id === selectedId) || null;

  if (selected) {
    return <CustomerProfile customer={selected} data={data} canViewProfit={canViewProfit} canEdit={canEdit}
      onBack={() => setSelectedId(null)} onSave={onSaveCustomer} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2"><Users className="w-6 h-6 text-indigo-500" /> Customers <span className="text-sm font-normal text-slate-400">{customers.length}</span></h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, phone, email…" className="w-64 pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value as CustomerSort)} className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200">
            <option value="recent">Most recent</option>
            <option value="name">Name</option>
            <option value="spent">Lifetime spent</option>
          </select>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <tr>
              <th className="text-left px-4 py-2.5">Customer</th>
              <th className="text-left px-4 py-2.5">Contact</th>
              <th className="text-right px-4 py-2.5">Purchases</th>
              <th className="text-right px-4 py-2.5">Repairs</th>
              <th className="text-right px-4 py-2.5">Lifetime</th>
              <th className="text-right px-4 py-2.5">Last Visit</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-12">No customers found.</td></tr>}
            {rows.map(({ c, s }) => (
              <tr key={c.id} onClick={() => setSelectedId(c.id)} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-800 dark:text-slate-100">{c.name || c.company || 'Customer'}</span>
                    {(c.tags || []).slice(0, 2).map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{t}</span>)}
                    {c.kind === 'wholesale' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Wholesale</span>}
                  </div>
                </td>
                <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 text-xs">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</td>
                <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-200">{s.purchaseCount}</td>
                <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-200">{s.repairCount}</td>
                <td className="px-4 py-2.5 text-right font-medium text-slate-900 dark:text-slate-100">{money0(s.lifetimeSpent)}</td>
                <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400 text-xs">{fmtDate(s.lastActivity)}</td>
                <td className="px-2 py-2.5"><ChevronRight className="w-4 h-4 text-slate-300" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ---------------- Profile ---------------- */
const CustomerProfile: React.FC<{
  customer: Customer; data: CustomerData; canViewProfit: boolean; canEdit: boolean;
  onBack: () => void; onSave: (c: Customer, prev?: Customer) => void;
}> = ({ customer, data, canViewProfit, canEdit, onBack, onSave }) => {
  const s = useMemo(() => customerStats(customer, data), [customer, data]);
  const timeline = useMemo(() => customerTimeline(s), [s]);
  const [tab, setTab] = useState<'overview' | 'purchases' | 'repairs' | 'activity'>('overview');
  const [editing, setEditing] = useState(false);
  const mask = (v: string) => (canViewProfit ? v : '•••');
  const name = customer.name || customer.company || 'Customer';

  const Stat = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${accent || 'text-slate-900 dark:text-white'}`}>{value}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"><ArrowLeft className="w-4 h-4" /></button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white truncate flex items-center gap-2">
            {name}
            {(customer.tags || []).map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{t}</span>)}
            {customer.kind === 'wholesale' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Wholesale</span>}
          </h2>
          <p className="text-xs text-slate-400 flex items-center gap-3 mt-0.5">
            {customer.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{customer.phone}</span>}
            {customer.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{customer.email}</span>}
          </p>
        </div>
        {canEdit && <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:border-indigo-400"><Pencil className="w-4 h-4" /> Edit</button>}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Lifetime Spent" value={money0(s.lifetimeSpent)} />
        <Stat label="Repair Revenue" value={money0(s.repairRevenue)} />
        <Stat label="Purchases" value={String(s.purchaseCount)} />
        <Stat label="Repairs" value={String(s.repairCount)} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {(['overview', 'purchases', 'repairs', 'activity'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px ${tab === t ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}>{t}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Panel title="Contact">
            <Row label="Name" value={name} />
            <Row label="Phone" value={customer.phone || '—'} />
            <Row label="Email" value={customer.email || '—'} />
            <Row label="Preferred contact" value={customer.preferredContact ? customer.preferredContact[0].toUpperCase() + customer.preferredContact.slice(1) : '—'} />
            <Row label="First seen" value={fmtDate(s.firstSeen)} />
            <Row label="Last activity" value={fmtDate(s.lastActivity)} />
          </Panel>
          <Panel title="Lifetime value">
            <Row label="Lifetime spent" value={money(s.lifetimeSpent)} />
            <Row label="Repair revenue" value={money(s.repairRevenue)} />
            <Row label="Profit generated" value={mask(money(s.lifetimeProfit))} />
            <Row label="Avg purchase" value={money(s.avgPurchase)} />
            <Row label="Avg repair" value={money(s.avgRepair)} />
          </Panel>
          {customer.notes && <Panel title="Internal notes" className="md:col-span-2"><p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{customer.notes}</p></Panel>}
        </div>
      )}

      {tab === 'purchases' && (
        <Panel title={`Purchases (${s.purchaseCount})`}>
          {s.purchases.length === 0 ? <Empty text="No purchases yet." /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="text-left py-2">Date</th><th className="text-left py-2">Receipt</th><th className="text-left py-2">Items</th><th className="text-right py-2">Total</th><th className="text-right py-2">Profit</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {s.purchases.map(t => (
                  <tr key={t.id}>
                    <td className="py-2 text-slate-600 dark:text-slate-300">{t.date}</td>
                    <td className="py-2 font-mono text-xs text-slate-500">{t.id.slice(0, 8)}</td>
                    <td className="py-2 text-slate-500 dark:text-slate-400 truncate max-w-[240px]">{t.lines.map(l => `${l.quantity}× ${l.name}`).join(', ')}</td>
                    <td className="py-2 text-right font-medium text-slate-800 dark:text-slate-100">{money(t.totalPaid)}</td>
                    <td className={`py-2 text-right font-medium ${(t.netProfit || 0) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>{mask(money(t.netProfit))}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Panel>
      )}

      {tab === 'repairs' && (
        <Panel title={`Repairs (${s.repairCount})`}>
          {s.repairs.length === 0 ? <Empty text="No repairs yet." /> : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {s.repairs.map(r => (
                <div key={r.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{[r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device'} <span className="font-mono text-xs text-slate-400 ml-1">{r.repairNumber}</span>{r.type === 'wholesale' && <span className="ml-1 text-[10px] px-1 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Wholesale</span>}</p>
                    <p className="text-xs text-slate-400">{r.date}{r.warrantyUntil ? ` · warranty to ${r.warrantyUntil}` : ''}</p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${REPAIR_STATUS_CELL[r.status]}`}>{REPAIR_STATUS_LABEL[r.status]}</span>
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 w-16 text-right">{money(r.repairPrice)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}

      {tab === 'activity' && (
        <Panel title="Activity Timeline">
          {timeline.length === 0 ? <Empty text="No activity yet." /> : (
            <ul className="space-y-3">
              {timeline.map((e, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${e.kind === 'purchase' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'}`}>
                    {e.kind === 'purchase' ? <ShoppingCart className="w-3.5 h-3.5" /> : <Wrench className="w-3.5 h-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {e.kind === 'purchase'
                      ? <p className="text-sm text-slate-700 dark:text-slate-200">Purchase · {money(e.tx.totalPaid)} <span className="text-slate-400">({e.tx.lines.length} item{e.tx.lines.length !== 1 ? 's' : ''})</span></p>
                      : <p className="text-sm text-slate-700 dark:text-slate-200">Repair {e.repair.repairNumber} · {[e.repair.brand, e.repair.model].filter(Boolean).join(' ') || e.repair.deviceType} <span className="text-slate-400">({REPAIR_STATUS_LABEL[e.repair.status]})</span></p>}
                    <p className="text-xs text-slate-400 flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDate(e.ts)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {editing && <EditModal customer={customer} onClose={() => setEditing(false)} onSave={c => { onSave(c, customer); setEditing(false); }} />}
    </div>
  );
};

const Panel: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
  <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 ${className || ''}`}>
    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">{title}</h3>
    {children}
  </div>
);
const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between py-1 text-sm"><span className="text-slate-400">{label}</span><span className="text-slate-800 dark:text-slate-100 font-medium">{value}</span></div>
);
const Empty: React.FC<{ text: string }> = ({ text }) => <p className="text-sm text-slate-400 py-6 text-center">{text}</p>;

/* ---------------- Edit modal (notes / tags / preferred contact) ---------------- */
const EditModal: React.FC<{ customer: Customer; onClose: () => void; onSave: (c: Customer) => void }> = ({ customer, onClose, onSave }) => {
  const [f, setF] = useState<Customer>(customer);
  const set = (patch: Partial<Customer>) => setF(prev => ({ ...prev, ...patch }));
  const [tagInput, setTagInput] = useState('');
  const inputCls = 'w-full px-2.5 py-1.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100';
  const tags = f.tags || [];
  const addTag = (t: string) => { const v = t.trim(); if (v && !tags.includes(v)) set({ tags: [...tags, v] }); setTagInput(''); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Edit Customer</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Name</span><input className={inputCls} value={f.name} onChange={e => set({ name: e.target.value })} /></label>
            <label className="block"><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Phone</span><input className={inputCls} value={f.phone} onChange={e => set({ phone: e.target.value })} /></label>
            <label className="block col-span-2"><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Email</span><input className={inputCls} value={f.email || ''} onChange={e => set({ email: e.target.value })} /></label>
          </div>
          <label className="block"><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Preferred contact method</span>
            <select className={inputCls} value={f.preferredContact || ''} onChange={e => set({ preferredContact: (e.target.value || undefined) as any })}>
              <option value="">—</option><option value="phone">Phone</option><option value="email">Email</option><option value="text">Text</option>
            </select>
          </label>
          <div>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Tags</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {tags.map(t => <span key={t} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{t}<button onClick={() => set({ tags: tags.filter(x => x !== t) })}><X className="w-3 h-3" /></button></span>)}
            </div>
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {TAG_SUGGESTIONS.filter(t => !tags.includes(t)).map(t => <button key={t} onClick={() => addTag(t)} className="text-xs px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-500 hover:border-indigo-400">+ {t}</button>)}
            </div>
            <input className={`${inputCls} mt-2`} placeholder="Add a tag and press Enter" value={tagInput} onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); } }} />
          </div>
          <label className="block"><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Internal Notes</span><textarea rows={3} className={inputCls} value={f.notes || ''} onChange={e => set({ notes: e.target.value })} /></label>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500">Cancel</button>
          <button onClick={() => onSave(f)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">Save</button>
        </div>
      </div>
    </div>
  );
};
