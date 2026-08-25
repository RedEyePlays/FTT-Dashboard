import React, { useState, useMemo } from 'react';
import {
  Users, Search, ArrowLeft, Phone, Mail, ShoppingCart, Wrench, DollarSign,
  ChevronRight, Receipt, Pencil, X, Clock, Smartphone, ShieldCheck, AlertTriangle,
  Copy, PlusCircle, Printer, FileText, Merge, Hash, Check, Ban, RotateCcw,
} from 'lucide-react';
import { Customer, SalesTransaction, Repair, RepairBatch, InventoryItem, AuditEntry } from '../types';
import {
  customerStats, customerTimeline, customerDevices, customerSearchMatch,
  passesFilter, sortCustomers, findDuplicateGroups, planMerge,
  CustomerSort, CustomerFilter, CustomerData, CustomerStats, MergePlan,
} from '../domain/customers';
import { REPAIR_STATUS_CELL, REPAIR_STATUS_LABEL, partName } from '../domain/repairs';
import { statusPageUrl } from '../domain/statusLink';
import { formatPhoneInput } from '../domain/phone';
import { PRINT_PREVIEW_BAR_STYLE, PRINT_PREVIEW_BAR_HTML } from '../services/printPreview';
import { printRetailReceipt } from '../services/repairPrint';
import { printSalesReceipt } from '../services/salesReceipt';
import { getStoreProfile } from './SettingsModal';
import { useIsMobile } from '../hooks/useMediaQuery';
import { MobileDataCard, CardRow, EmptyState } from './responsive';

interface Props {
  customers: Customer[];
  salesTransactions: SalesTransaction[];
  repairs: Repair[];
  batches: RepairBatch[];
  inventory: InventoryItem[];
  auditLogs: AuditEntry[];
  canViewProfit: boolean;
  canEdit: boolean;
  initialCustomerId?: string;   // open this customer's profile (from global search)
  onConsumeInitial?: () => void;
  onSaveCustomer: (c: Customer, prev?: Customer) => void;
  onMergeCustomers?: (plan: MergePlan) => void;
  onStartSale?: (c: Customer) => void;
  onCreateRepair?: (c: Customer) => void;
  onVoidSale?: (tx: SalesTransaction) => void;         // owner/manager: reverse a same-day sale
  canVoidSale?: (tx: SalesTransaction) => boolean;     // within-window + permission check
  onReturnSale?: (tx: SalesTransaction, opts: { restockingFee?: number; disposition: 'resell' | 'defective' }) => void; // owner/manager: process a return
  canReturnSale?: (tx: SalesTransaction) => boolean;   // after-void-window + permission check
  defaultRestockingFeePercent?: number;                // pre-filled restocking fee % when processing a return
}

export type ReturnDisposition = 'resell' | 'defective';

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n: number) => `$${Math.round(n || 0).toLocaleString()}`;
const fmtDate = (ms: number) => (ms ? new Date(ms).toLocaleDateString() : '—');
const PAYMENT_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', mixed: 'Mixed' };
const TAG_SUGGESTIONS = ['VIP', 'Wholesale', 'Business', 'Student', 'Repeat Customer', 'Walk-In', 'Referral'];
const FILTERS: { id: CustomerFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'open_repairs', label: 'Open Repairs' },
  { id: 'vip', label: 'VIP' },
  { id: 'balance', label: 'Outstanding Balance' },
  { id: 'warranty', label: 'Warranty Claims' },
];

const cardStyle = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl';

export const CustomersView: React.FC<Props> = (props) => {
  const { customers, salesTransactions, repairs, batches, inventory, canViewProfit } = props;
  const data: CustomerData = { salesTransactions, repairs, batches, inventory };
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<CustomerSort>('recent');
  const [filter, setFilter] = useState<CustomerFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mergeGroup, setMergeGroup] = useState<Customer[] | null>(null);

  const rows = useMemo(() => {
    const withStats = customers.map(c => ({ c, s: customerStats(c, data) }));
    const filtered = withStats.filter(({ c, s }) => customerSearchMatch(c, s, query) && passesFilter(filter, s));
    return sortCustomers(filtered, sort);
  }, [customers, salesTransactions, repairs, batches, inventory, query, sort, filter]);

  const duplicates = useMemo(() => findDuplicateGroups(customers), [customers]);

  const isMobile = useIsMobile();

  // Deep-link: open a specific customer's profile (from global search).
  React.useEffect(() => {
    if (props.initialCustomerId) { setSelectedId(props.initialCustomerId); props.onConsumeInitial?.(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialCustomerId]);

  const selected = customers.find(c => c.id === selectedId) || null;
  if (selected) {
    return <CustomerProfile {...props} customer={selected} data={data} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2"><Users className="w-6 h-6 text-indigo-500" /> Customers <span className="text-sm font-normal text-slate-400">{customers.length}</span></h2>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="relative flex-1 min-w-0 sm:min-w-[16rem]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="search" inputMode="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name, phone, email, Repair ID, SKU, IMEI…" className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          <select value={sort} onChange={e => setSort(e.target.value as CustomerSort)} className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 shrink-0">
            <option value="recent">Last Visit</option>
            <option value="spent">Lifetime Spend</option>
            <option value="repairs">Number of Repairs</option>
            <option value="name">Name</option>
            <option value="created">Date Created</option>
          </select>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${filter === f.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'}`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Duplicate warning */}
      {duplicates.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-xl px-4 py-3 text-sm">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-amber-800 dark:text-amber-300">
            {duplicates.length} possible duplicate {duplicates.length === 1 ? 'customer' : 'customers'} (same phone/email).
          </span>
          {duplicates.slice(0, 3).map(g => (
            <button key={`${g.kind}:${g.key}`} onClick={() => setMergeGroup(g.customers)}
              className="text-xs font-medium px-2 py-1 rounded bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-200 hover:bg-amber-200">
              Review “{g.customers[0].name || g.customers[0].company || g.key}” ×{g.customers.length}
            </button>
          ))}
        </div>
      )}

      {rows.length === 0 ? (
        <div className={cardStyle}><EmptyState icon={<Users className="w-6 h-6" />} title="No customers found" hint="Try a different search or filter." /></div>
      ) : isMobile ? (
        /* Mobile: compact cards (name, phone, open repairs, lifetime, last visit) */
        <div className="flex flex-col gap-2">
          {rows.map(({ c, s }) => (
            <MobileDataCard key={c.id} onOpen={() => setSelectedId(c.id)}
              title={c.name || c.company || 'Customer'}
              badge={<>
                {s.hasOpenRepairs && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Open repair</span>}
                {c.kind === 'wholesale' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Wholesale</span>}
              </>}
              actions={<ChevronRight className="w-5 h-5 text-slate-300 shrink-0" />}>
              {c.phone && <CardRow label="Phone"><a href={`tel:${c.phone}`} onClick={e => e.stopPropagation()} className="text-indigo-600 dark:text-indigo-400">{c.phone}</a></CardRow>}
              <CardRow label="Open repairs">{s.activeRepairs}</CardRow>
              {canViewProfit && <CardRow label="Lifetime">{money0(s.lifetimeSpent)}</CardRow>}
              {s.outstandingBalance > 0.005 && <CardRow label="Balance"><span className="text-rose-600 dark:text-rose-400">{money0(s.outstandingBalance)}</span></CardRow>}
              <CardRow label="Last visit">{fmtDate(s.lastActivity)}</CardRow>
            </MobileDataCard>
          ))}
        </div>
      ) : (
        <div className={`${cardStyle} overflow-x-auto`}>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2.5">Customer</th>
                <th className="text-left px-4 py-2.5">Contact</th>
                <th className="text-right px-4 py-2.5">Purchases</th>
                <th className="text-right px-4 py-2.5">Repairs</th>
                <th className="text-right px-4 py-2.5">Lifetime</th>
                <th className="text-right px-4 py-2.5">Balance</th>
                <th className="text-right px-4 py-2.5">Last Visit</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map(({ c, s }) => (
                <tr key={c.id} onClick={() => setSelectedId(c.id)} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-800 dark:text-slate-100">{c.name || c.company || 'Customer'}</span>
                      {s.hasOpenRepairs && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Open repair</span>}
                      {(c.tags || []).slice(0, 2).map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{t}</span>)}
                      {c.kind === 'wholesale' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Wholesale</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400 text-xs">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-200">{s.purchaseCount}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700 dark:text-slate-200">{s.repairCount}</td>
                  <td className="px-4 py-2.5 text-right font-medium text-slate-900 dark:text-slate-100">{canViewProfit ? money0(s.lifetimeSpent) : '•••'}</td>
                  <td className={`px-4 py-2.5 text-right text-xs font-medium ${s.outstandingBalance > 0.005 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'}`}>{s.outstandingBalance > 0.005 ? money0(s.outstandingBalance) : '—'}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500 dark:text-slate-400 text-xs">{fmtDate(s.lastActivity)}</td>
                  <td className="px-2 py-2.5"><ChevronRight className="w-4 h-4 text-slate-300" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mergeGroup && <MergeModal group={mergeGroup} data={data} onClose={() => setMergeGroup(null)} onMerge={props.onMergeCustomers} />}
    </div>
  );
};

/* ---------------- Profile ---------------- */
const CustomerProfile: React.FC<Props & { customer: Customer; data: CustomerData; onBack: () => void }> = (
  { customer, data, canViewProfit, canEdit, auditLogs, inventory, onBack, onSaveCustomer, onStartSale, onCreateRepair, onVoidSale, canVoidSale, onReturnSale, canReturnSale, defaultRestockingFeePercent },
) => {
  const s = useMemo(() => customerStats(customer, data), [customer, data]);
  const timeline = useMemo(() => customerTimeline(s), [s]);
  const devices = useMemo(() => customerDevices(s, inventory), [s, inventory]);
  const [tab, setTab] = useState<'overview' | 'purchases' | 'repairs' | 'devices' | 'activity'>('overview');
  const [editing, setEditing] = useState(false);
  const [invoice, setInvoice] = useState<SalesTransaction | null>(null);
  const [ticket, setTicket] = useState<Repair | null>(null);
  const [copied, setCopied] = useState(false);
  const mask = (v: string) => (canViewProfit ? v : '•••');
  const name = customer.name || customer.company || 'Customer';

  // Technician = last person who touched the repair (from the audit trail).
  const techFor = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of auditLogs) {
      if (a.entityType === 'repair' && a.entityId && (a.action.startsWith('repair.tech') || a.action === 'repair.status_change' || a.action === 'repair.edit')) {
        if (!m.has(a.entityId)) m.set(a.entityId, a.userEmail); // auditLogs newest-first assumed; first seen = latest
      }
    }
    return m;
  }, [auditLogs]);

  const copyInfo = () => {
    const text = [name, customer.phone, customer.email, customer.id].filter(Boolean).join('\n');
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };
  const lastInvoice = s.purchases[0];
  const lastWarrantyRepair = s.repairs.find(r => r.warrantyUntil);

  const Stat = ({ label, value, accent }: { label: string; value: string; accent?: string }) => (
    <div className={`${cardStyle} p-3`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${accent || 'text-slate-900 dark:text-white'}`}>{value}</p>
    </div>
  );
  const Action = ({ icon, label, onClick, href, disabled }: { icon: React.ReactNode; label: string; onClick?: () => void; href?: string; disabled?: boolean }) => {
    const cls = `flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border ${disabled ? 'opacity-40 cursor-not-allowed border-slate-200 dark:border-slate-700 text-slate-400' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400'}`;
    if (href && !disabled) return <a href={href} className={cls}>{icon}{label}</a>;
    return <button onClick={onClick} disabled={disabled} className={cls}>{icon}{label}</button>;
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start gap-2">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 mt-0.5"><ArrowLeft className="w-4 h-4" /></button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white truncate flex items-center gap-2 flex-wrap">
            {name}
            {(customer.tags || []).map(t => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{t}</span>)}
            {customer.kind === 'wholesale' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Wholesale</span>}
          </h2>
          <p className="text-xs text-slate-400 flex items-center gap-3 mt-0.5 flex-wrap">
            {customer.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{customer.phone}</span>}
            {customer.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{customer.email}</span>}
            {customer.preferredContact && <span>Prefers {customer.preferredContact}</span>}
            <span className="flex items-center gap-1"><Hash className="w-3 h-3" />{customer.id.slice(0, 10)}</span>
            <span>Created {fmtDate(customer.createdAt || s.firstSeen)}</span>
            <span>Last visit {fmtDate(s.lastActivity)}</span>
          </p>
        </div>
        {canEdit && <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:border-indigo-400"><Pencil className="w-4 h-4" /> Edit</button>}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-1.5">
        {onCreateRepair && canEdit && <Action icon={<Wrench className="w-3.5 h-3.5" />} label="Create Repair" onClick={() => onCreateRepair(customer)} />}
        {onStartSale && canEdit && <Action icon={<ShoppingCart className="w-3.5 h-3.5" />} label="Start Sale" onClick={() => onStartSale(customer)} />}
        <Action icon={<Receipt className="w-3.5 h-3.5" />} label="Print Receipt" onClick={() => lastInvoice && printInvoice(lastInvoice, customer)} disabled={!lastInvoice} />
        <Action icon={<ShieldCheck className="w-3.5 h-3.5" />} label="Print Warranty" onClick={() => lastWarrantyRepair && printWarranty(lastWarrantyRepair, customer)} disabled={!lastWarrantyRepair} />
        <Action icon={<Smartphone className="w-3.5 h-3.5" />} label="View Devices" onClick={() => setTab('devices')} />
        <Action icon={<Phone className="w-3.5 h-3.5" />} label="Call" href={customer.phone ? `tel:${customer.phone}` : undefined} disabled={!customer.phone} />
        <Action icon={<Mail className="w-3.5 h-3.5" />} label="Email" href={customer.email ? `mailto:${customer.email}` : undefined} disabled={!customer.email} />
        <Action icon={copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} label={copied ? 'Copied' : 'Copy Info'} onClick={copyInfo} />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Stat label="Lifetime Spend" value={mask(money0(s.lifetimeSpent))} />
        <Stat label="Total Purchases" value={String(s.purchaseCount)} />
        <Stat label="Total Repairs" value={String(s.repairCount)} />
        <Stat label="Active Repairs" value={String(s.activeRepairs)} accent={s.activeRepairs ? 'text-blue-600 dark:text-blue-400' : undefined} />
        <Stat label="Active Warranties" value={String(s.activeWarranties)} />
        <Stat label="Last Purchase" value={fmtDate(s.lastPurchase)} />
        <Stat label="Last Repair" value={fmtDate(s.lastRepair)} />
      </div>
      {s.outstandingBalance > 0.005 && (
        <div className="flex items-center gap-2 text-sm bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-lg px-3 py-2 text-rose-700 dark:text-rose-300">
          <DollarSign className="w-4 h-4" /> Outstanding balance: <span className="font-semibold">{money(s.outstandingBalance)}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {(['overview', 'purchases', 'repairs', 'devices', 'activity'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px ${tab === t ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}>{t}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Panel title="Contact">
            <Row label="Full name" value={name} />
            <Row label="Phone" value={customer.phone || '—'} />
            <Row label="Email" value={customer.email || '—'} />
            <Row label="Preferred contact" value={customer.preferredContact ? customer.preferredContact[0].toUpperCase() + customer.preferredContact.slice(1) : '—'} />
            <Row label="Customer ID" value={customer.id} />
            <Row label="Created" value={fmtDate(customer.createdAt || s.firstSeen)} />
            <Row label="Last visit" value={fmtDate(s.lastActivity)} />
          </Panel>
          <Panel title="Lifetime value">
            <Row label="Lifetime spend" value={mask(money(s.lifetimeSpent))} />
            <Row label="Repair revenue" value={money(s.repairRevenue)} />
            <Row label="Profit generated" value={mask(money(s.lifetimeProfit))} />
            <Row label="Avg purchase" value={mask(money(s.avgPurchase))} />
            <Row label="Avg repair" value={money(s.avgRepair)} />
            <Row label="Outstanding balance" value={money(s.outstandingBalance)} />
          </Panel>
          <Panel title="Internal notes" className="md:col-span-2">
            {customer.notes ? <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{customer.notes}</p> : <Empty text="No notes. Use Edit to add internal notes." />}
          </Panel>
        </div>
      )}

      {tab === 'purchases' && (
        <Panel title={`Purchase History (${s.purchaseCount})`}>
          {s.purchases.length === 0 ? <Empty text="No purchases yet." /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="text-left py-2">Invoice #</th><th className="text-left py-2">Date</th><th className="text-left py-2">Items</th><th className="text-left py-2">Payment</th><th className="text-left py-2">Warranty</th><th className="text-right py-2">Total</th><th></th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {s.purchases.map(t => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer" onClick={() => setInvoice(t)}>
                    <td className="py-2 font-mono text-xs text-slate-500">{t.id.slice(0, 8)}{t.status === 'voided' && <span className="ml-1 text-[9px] font-sans font-semibold px-1 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 align-middle">VOID</span>}{t.status === 'returned' && <span className="ml-1 text-[9px] font-sans font-semibold px-1 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 align-middle">RETURNED</span>}</td>
                    <td className={`py-2 text-slate-600 dark:text-slate-300 ${t.status === 'voided' || t.status === 'returned' ? 'line-through opacity-60' : ''}`}>{t.date}</td>
                    <td className="py-2 text-slate-500 dark:text-slate-400 truncate max-w-[220px]">{t.lines.map(l => `${l.quantity}× ${l.name}`).join(', ')}</td>
                    <td className="py-2 text-slate-500 dark:text-slate-400">{PAYMENT_LABEL[t.paymentMethod || ''] || '—'}</td>
                    <td className="py-2">{warrantyBadge(t, s, inventory)}</td>
                    <td className="py-2 text-right font-medium text-slate-800 dark:text-slate-100">{money(t.totalPaid)}</td>
                    <td className="py-2 text-right"><ChevronRight className="w-4 h-4 text-slate-300 inline" /></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Panel>
      )}

      {tab === 'repairs' && (
        <Panel title={`Repair History (${s.repairCount})`}>
          {s.repairs.length === 0 ? <Empty text="No repairs yet." /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="text-left py-2">Repair ID</th><th className="text-left py-2">Device</th><th className="text-left py-2">IMEI</th><th className="text-left py-2">Issue</th><th className="text-left py-2">Status</th><th className="text-left py-2">Technician</th><th className="text-left py-2">Date</th><th className="text-right py-2">Cost</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {s.repairs.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer" onClick={() => setTicket(r)}>
                    <td className="py-2 font-mono text-xs text-slate-600 dark:text-slate-300">{r.repairNumber}</td>
                    <td className="py-2 text-slate-700 dark:text-slate-200">{[r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device'}</td>
                    <td className="py-2 font-mono text-xs text-slate-400">{r.imei || '—'}</td>
                    <td className="py-2 text-slate-500 dark:text-slate-400 truncate max-w-[160px]">{r.issue || '—'}</td>
                    <td className="py-2"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${REPAIR_STATUS_CELL[r.status]}`}>{REPAIR_STATUS_LABEL[r.status]}</span></td>
                    <td className="py-2 text-xs text-slate-500 dark:text-slate-400">{(techFor.get(r.id) || '').split('@')[0] || '—'}</td>
                    <td className="py-2 text-slate-500 dark:text-slate-400 text-xs">{r.date}</td>
                    <td className="py-2 text-right font-medium text-slate-800 dark:text-slate-100">{money(r.repairPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </Panel>
      )}

      {tab === 'devices' && (
        <Panel title={`Devices (${devices.length})`}>
          {devices.length === 0 ? <Empty text="No devices linked yet." /> : (
            <div className="space-y-3">
              {devices.map(d => (
                <div key={d.key} className="border border-slate-100 dark:border-slate-800 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-slate-400" />
                    <span className="font-semibold text-slate-800 dark:text-slate-100">{d.name}</span>
                    {d.imei && <span className="font-mono text-[11px] text-slate-400">{d.imei}</span>}
                  </div>
                  <ul className="mt-2 space-y-1 pl-6">
                    {d.events.map((e, i) => (
                      <li key={i} className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${e.kind === 'purchase' ? 'bg-emerald-500' : 'bg-indigo-500'}`} />
                        {e.label} <span className="text-slate-300 dark:text-slate-600">· {fmtDate(e.ts)}</span>
                      </li>
                    ))}
                  </ul>
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
                      ? <p className="text-sm text-slate-700 dark:text-slate-200">Purchase · {mask(money(e.tx.totalPaid))} <span className="text-slate-400">({e.tx.lines.length} item{e.tx.lines.length !== 1 ? 's' : ''})</span></p>
                      : <p className="text-sm text-slate-700 dark:text-slate-200">Repair {e.repair.repairNumber} · {[e.repair.brand, e.repair.model].filter(Boolean).join(' ') || e.repair.deviceType} <span className="text-slate-400">({REPAIR_STATUS_LABEL[e.repair.status]})</span></p>}
                    <p className="text-xs text-slate-400 flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDate(e.ts)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {editing && <EditModal customer={customer} onClose={() => setEditing(false)} onSave={c => { onSaveCustomer(c, customer); setEditing(false); }} />}
      {invoice && <InvoiceModal tx={invoice} customer={customer} canViewProfit={canViewProfit} onClose={() => setInvoice(null)}
        onVoid={onVoidSale && canVoidSale && canVoidSale(invoice) ? () => { onVoidSale(invoice); setInvoice(null); } : undefined}
        onReturn={onReturnSale && canReturnSale && canReturnSale(invoice) ? (opts) => { onReturnSale(invoice, opts); setInvoice(null); } : undefined}
        defaultRestockingFeePercent={defaultRestockingFeePercent} />}
      {ticket && <TicketModal repair={ticket} tech={techFor.get(ticket.id)} customer={customer} onClose={() => setTicket(null)} />}
    </div>
  );
};

// Warranty status for a purchase: if a device on the invoice (by IMEI) has an
// active warranty from a repair, surface it; otherwise none is stored.
function warrantyBadge(t: SalesTransaction, s: CustomerStats, inventory: InventoryItem[]) {
  const invById = new Map(inventory.map(i => [i.id, i]));
  const imeis = t.lines.map(l => (l.inventoryId && invById.get(l.inventoryId)?.imei) || undefined).filter(Boolean) as string[];
  const now = Date.now();
  const match = s.repairs.find(r => r.imei && imeis.includes(r.imei) && r.warrantyUntil && new Date(r.warrantyUntil + 'T00:00:00').getTime() >= now);
  if (match) return <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Under warranty</span>;
  return <span className="text-xs text-slate-400">—</span>;
}

const Panel: React.FC<{ title: string; children: React.ReactNode; className?: string }> = ({ title, children, className }) => (
  <div className={`${cardStyle} p-4 ${className || ''}`}>
    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">{title}</h3>
    {children}
  </div>
);
const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-center justify-between py-1 text-sm gap-4"><span className="text-slate-400 shrink-0">{label}</span><span className="text-slate-800 dark:text-slate-100 font-medium truncate">{value}</span></div>
);
const Empty: React.FC<{ text: string }> = ({ text }) => <p className="text-sm text-slate-400 py-6 text-center">{text}</p>;

/* ---------------- Invoice modal ---------------- */
const InvoiceModal: React.FC<{ tx: SalesTransaction; customer: Customer; canViewProfit: boolean; onClose: () => void; onVoid?: () => void; onReturn?: (opts: { restockingFee?: number; disposition: ReturnDisposition }) => void; defaultRestockingFeePercent?: number }> = ({ tx, customer, canViewProfit, onClose, onVoid, onReturn, defaultRestockingFeePercent }) => (
  <Modal title={`Invoice ${tx.id.slice(0, 8)}`} onClose={onClose} onPrint={() => printInvoice(tx, customer)}>
    <div className="space-y-2 text-sm">
      {tx.status === 'voided' && (
        <div className="flex items-center gap-2 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg px-3 py-2">
          VOIDED{tx.voidedAt ? ` · ${new Date(tx.voidedAt).toLocaleString()}` : ''} — stock and devices were reversed; the record is kept for history.
        </div>
      )}
      {tx.status === 'returned' && (
        <div className="text-xs font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg px-3 py-2">
          RETURNED{tx.returnedAt ? ` · ${new Date(tx.returnedAt).toLocaleString()}` : ''} — refunded {money(tx.refundAmount || 0)}{tx.restockingFee ? ` (restocking fee ${money(tx.restockingFee)})` : ''}. Kept for history.
        </div>
      )}
      <Row label="Date" value={tx.date} />
      <Row label="Customer" value={customer.name || customer.company || tx.customerName || '—'} />
      <Row label="Payment" value={PAYMENT_LABEL[tx.paymentMethod || ''] || '—'} />
      {tx.platformName && <Row label="Platform" value={tx.platformName} />}
      <div className="border-t border-slate-100 dark:border-slate-800 my-2" />
      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase text-slate-400"><tr><th className="text-left py-1">Item</th><th className="text-right py-1">Qty</th><th className="text-right py-1">Price</th></tr></thead>
        <tbody>
          {tx.lines.map((l, i) => (
            <tr key={i}><td className="py-1 text-slate-700 dark:text-slate-200">{l.name}{l.sku ? <span className="text-slate-400 font-mono text-xs"> · {l.sku}</span> : ''}</td><td className="py-1 text-right">{l.quantity}</td><td className="py-1 text-right">{money(l.unitPrice)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-slate-100 dark:border-slate-800 my-2" />
      <Row label="Subtotal" value={money(tx.subtotal)} />
      {tx.tax ? <Row label="Tax" value={money(tx.tax)} /> : null}
      <div className="flex items-center justify-between py-1 text-base font-bold"><span>Total</span><span>{money(tx.totalPaid)}</span></div>
      {canViewProfit && <Row label="Profit" value={money(tx.netProfit)} />}
      <button onClick={() => printSalesReceipt(tx, { storeName: getStoreProfile().storeName })}
        className="w-full mt-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700">
        <Printer className="w-4 h-4" /> Print Receipt
      </button>
      {onVoid && (
        <div className="pt-2 mt-1 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={() => { if (window.confirm('Void this sale? Sold devices return to stock, accessory quantities are restored, and the sale is flagged voided (kept for history).')) onVoid(); }}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/40 hover:bg-rose-100 dark:hover:bg-rose-900/30">
            <Ban className="w-4 h-4" /> Void Sale
          </button>
        </div>
      )}
      {onReturn && <ReturnSection total={tx.totalPaid} onReturn={onReturn} defaultFeePercent={defaultRestockingFeePercent} />}
    </div>
  </Modal>
);

/* ---------------- Return processing ---------------- */
// Restocking fee (optional) + device disposition, then confirm. Refund is the
// sale total minus the fee; the fee is clamped so the refund never goes negative.
const ReturnSection: React.FC<{ total: number; onReturn: (opts: { restockingFee?: number; disposition: ReturnDisposition }) => void; defaultFeePercent?: number }> = ({ total, onReturn, defaultFeePercent }) => {
  // Pre-fill the configured default restocking fee (a % of the sale total), still
  // fully editable per return.
  const prefill = defaultFeePercent && defaultFeePercent > 0 ? (Math.round(total * defaultFeePercent) / 100).toFixed(2) : '';
  const [fee, setFee] = useState(prefill);
  const [disposition, setDisposition] = useState<ReturnDisposition>('resell');
  const feeNum = Math.min(Math.max(parseFloat(fee) || 0, 0), Math.max(0, total));
  const refund = Math.max(0, Math.round((total - feeNum) * 100) / 100);
  const submit = () => {
    if (!window.confirm(`Process this return? Refund ${money(refund)}${feeNum > 0 ? ` (after a ${money(feeNum)} restocking fee)` : ''}. ${disposition === 'resell' ? 'Device(s) return to sellable stock' : 'Device(s) are marked not-for-resale'}; accessory stock is restored. The sale is flagged returned (kept for history).`)) return;
    onReturn({ restockingFee: feeNum > 0 ? feeNum : undefined, disposition });
  };
  return (
    <div className="pt-3 mt-1 border-t border-slate-100 dark:border-slate-800 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Process Return</p>
      <label className="flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
        <span>Restocking fee (optional)</span>
        <span className="flex items-center gap-1">$<input type="number" min="0" step="0.01" value={fee} onChange={e => setFee(e.target.value)} placeholder="0.00"
          className="w-24 px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-right text-sm focus:outline-none focus:ring-2 focus:ring-amber-500" /></span>
      </label>
      <div className="flex items-center justify-between text-sm"><span className="text-slate-400">Refund amount</span><span className="font-bold text-slate-800 dark:text-slate-100">{money(refund)}</span></div>
      <div className="grid grid-cols-2 gap-2 pt-1">
        {([['resell', 'Return to stock'], ['defective', 'Not for resale']] as [ReturnDisposition, string][]).map(([val, label]) => (
          <button key={val} onClick={() => setDisposition(val)}
            className={`py-1.5 rounded-lg text-xs font-medium border ${disposition === val ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border-amber-300 dark:border-amber-700' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>
            {label}
          </button>
        ))}
      </div>
      <button onClick={submit}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white">
        <RotateCcw className="w-4 h-4" /> Process Return · refund {money(refund)}
      </button>
    </div>
  );
};

/* ---------------- Repair ticket modal ---------------- */
const TicketModal: React.FC<{ repair: Repair; tech?: string; customer: Customer; onClose: () => void }> = ({ repair: r, tech, customer, onClose }) => (
  <Modal title={`Repair ${r.repairNumber}`} onClose={onClose} onPrint={() => printRetailReceipt(r, 'repair', { storeName: getStoreProfile().storeName })} onCopyLink={() => navigator.clipboard.writeText(statusPageUrl(r.repairNumber))}>
    <div className="space-y-1.5 text-sm">
      <Row label="Device" value={[r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device'} />
      <Row label="IMEI / Serial" value={r.imei || '—'} />
      <Row label="Issue" value={r.issue || '—'} />
      <Row label="Status" value={REPAIR_STATUS_LABEL[r.status]} />
      <Row label="Technician" value={(tech || '').split('@')[0] || '—'} />
      <Row label="Date" value={r.date} />
      <Row label="Repair price" value={money(r.repairPrice)} />
      {r.deposit ? <Row label="Deposit" value={money(r.deposit)} /> : null}
      {r.warrantyUntil && <Row label="Warranty until" value={r.warrantyUntil} />}
      {r.diagnostics && <div className="pt-2"><p className="text-[11px] uppercase text-slate-400">Diagnostics</p><p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{r.diagnostics}</p></div>}
      {r.workPerformed && <div className="pt-1"><p className="text-[11px] uppercase text-slate-400">Work performed</p><p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{r.workPerformed}</p></div>}
      {r.parts && r.parts.length > 0 ? (
        <div className="pt-1">
          <p className="text-[11px] uppercase text-slate-400 mb-1">Parts used</p>
          <table className="w-full text-xs">
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {r.parts.map(p => (
                <tr key={p.id}>
                  <td className="py-1 text-slate-600 dark:text-slate-300">{partName(p)}</td>
                  <td className="py-1 text-right text-slate-400">×{p.quantity || 1}</td>
                  <td className="py-1 text-right text-slate-700 dark:text-slate-200">{money((p.unitCost || 0) * (p.quantity || 1))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : r.partsUsed ? (
        <div className="pt-1"><p className="text-[11px] uppercase text-slate-400">Parts used</p><p className="text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{r.partsUsed}</p></div>
      ) : null}
    </div>
  </Modal>
);

const Modal: React.FC<{ title: string; onClose: () => void; onPrint?: () => void; onCopyLink?: () => void; children: React.ReactNode }> = ({ title, onClose, onPrint, onCopyLink, children }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-white dark:bg-slate-900">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-500" />{title}</h2>
          <div className="flex items-center gap-1">
            {onCopyLink && (
              <button onClick={() => { onCopyLink(); setCopied(true); setTimeout(() => setCopied(false), 1500); }} title="Copy customer status-lookup link" className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            )}
            {onPrint && <button onClick={onPrint} className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600"><Printer className="w-4 h-4" /></button>}
            <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
};

/* ---------------- Merge modal ---------------- */
const MergeModal: React.FC<{ group: Customer[]; data: CustomerData; onClose: () => void; onMerge?: (plan: MergePlan) => void }> = ({ group, data, onClose, onMerge }) => {
  const [primaryId, setPrimaryId] = useState(group[0].id);
  const primary = group.find(c => c.id === primaryId)!;
  const dups = group.filter(c => c.id !== primaryId);
  const plan = useMemo(() => planMerge(primary, dups, data), [primary, dups, data]);
  const linked = plan.reassignSales.length + plan.reassignRepairs.length + plan.reassignBatches.length;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Merge className="w-4 h-4 text-indigo-500" /> Merge duplicate customers</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3 text-sm">
          <p className="text-slate-500 dark:text-slate-400">These records share a phone/email. Choose the one to keep — the others merge into it and all linked records are relinked.</p>
          {group.map(c => (
            <label key={c.id} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer ${c.id === primaryId ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-200 dark:border-slate-700'}`}>
              <input type="radio" checked={c.id === primaryId} onChange={() => setPrimaryId(c.id)} />
              <span className="font-medium text-slate-800 dark:text-slate-100">{c.name || c.company || 'Customer'}</span>
              <span className="text-xs text-slate-400">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>
            </label>
          ))}
          <p className="text-xs text-slate-500 dark:text-slate-400">Keeping <span className="font-semibold">{primary.name || primary.company}</span>; merging {dups.length} record{dups.length !== 1 ? 's' : ''} and relinking {linked} linked item{linked !== 1 ? 's' : ''}.</p>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500">Cancel</button>
          <button onClick={() => { onMerge?.(plan); onClose(); }} disabled={!onMerge || dups.length === 0} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium">Merge</button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- Print helpers ---------------- */
const printDoc = (title: string, body: string) => {
  const win = window.open('', '_blank', 'width=420,height=640');
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title>
    <style>body{font-family:-apple-system,Arial,sans-serif;color:#111;margin:24px;font-size:13px}h1{font-size:18px;margin:0 0 2px}h2{font-size:13px;margin:16px 0 4px;text-transform:uppercase;letter-spacing:.5px;color:#555}table{width:100%;border-collapse:collapse}td{padding:3px 0}.r{text-align:right}.tot{font-weight:700;border-top:1px solid #000;padding-top:6px}.muted{color:#666}
    ${PRINT_PREVIEW_BAR_STYLE}</style>
    </head><body>${PRINT_PREVIEW_BAR_HTML}${body}</body></html>`);
  win.document.close();
};
const esc = (s?: string) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

function printInvoice(t: SalesTransaction, c: Customer) {
  const lines = t.lines.map(l => `<tr><td>${esc(l.name)}</td><td class="r">${l.quantity}× ${money(l.unitPrice)}</td></tr>`).join('');
  printDoc(`Invoice ${t.id.slice(0, 8)}`, `
    <h1>FlipThatTech</h1><div class="muted">Receipt · ${esc(t.date)}</div>
    <h2>Customer</h2>${esc(c.name || c.company || t.customerName)}${c.phone ? ` · ${esc(c.phone)}` : ''}
    <h2>Items</h2><table>${lines}</table>
    <table><tr><td>Subtotal</td><td class="r">${money(t.subtotal)}</td></tr>${t.tax ? `<tr><td>Tax</td><td class="r">${money(t.tax)}</td></tr>` : ''}<tr><td class="tot">Total</td><td class="r tot">${money(t.totalPaid)}</td></tr></table>
    <div class="muted" style="margin-top:8px">Payment: ${PAYMENT_LABEL[t.paymentMethod || ''] || '—'} · Invoice ${esc(t.id)}</div>`);
}

function printWarranty(r: Repair, c: Customer) {
  printDoc(`Warranty ${r.repairNumber}`, `
    <h1>FlipThatTech</h1><div class="muted">Warranty Certificate</div>
    <h2>Customer</h2>${esc(c.name || c.company || '')}${c.phone ? ` · ${esc(c.phone)}` : ''}
    <h2>Device</h2>${esc([r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device')}${r.imei ? `<br><span class="muted">IMEI/Serial: ${esc(r.imei)}</span>` : ''}
    <h2>Repair</h2>${esc(r.repairNumber)} · ${esc(r.issue || '')}<br><span class="muted">Completed: ${esc(r.warrantyUntil ? r.date : r.date)}</span>
    <h2>Warranty</h2>${r.warrantyDays ? `${r.warrantyDays} days` : 'Standard'} · valid until <b>${esc(r.warrantyUntil || '—')}</b>
    <p class="muted" style="margin-top:12px">This warranty covers the repair performed above against defects in workmanship. Physical or liquid damage after pickup is not covered.</p>`);
}

/* ---------------- Edit modal (notes / tags / preferred contact) ---------------- */
const EditModal: React.FC<{ customer: Customer; onClose: () => void; onSave: (c: Customer) => void }> = ({ customer, onClose, onSave }) => {
  const [f, setF] = useState<Customer>(customer);
  const set = (patch: Partial<Customer>) => setF(prev => ({ ...prev, ...patch }));
  const [tagInput, setTagInput] = useState('');
  const [snapshot] = useState(() => JSON.stringify(customer));
  const dirty = JSON.stringify(f) !== snapshot;
  const requestClose = () => { if (!dirty || window.confirm('Discard unsaved changes to this customer?')) onClose(); };
  const inputCls = 'w-full px-2.5 py-1.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100';
  const tags = f.tags || [];
  const addTag = (t: string) => { const v = t.trim(); if (v && !tags.includes(v)) set({ tags: [...tags, v] }); setTagInput(''); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={requestClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">Edit Customer</h2>
          <button onClick={requestClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Name</span><input className={inputCls} value={f.name} onChange={e => set({ name: e.target.value })} /></label>
            <label className="block"><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Phone</span><input className={inputCls} type="tel" value={f.phone} onChange={e => set({ phone: formatPhoneInput(e.target.value) })} /></label>
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
          <label className="block"><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Internal Notes</span><textarea rows={3} className={inputCls} value={f.notes || ''} onChange={e => set({ notes: e.target.value })} placeholder="Prefers text · Usually picks up same day · Wants OEM parts only" /></label>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={requestClose} className="px-4 py-2 text-sm text-slate-500">Cancel</button>
          <button onClick={() => onSave(f)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">Save</button>
        </div>
      </div>
    </div>
  );
};
