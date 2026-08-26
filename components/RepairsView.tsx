import React, { useState, useMemo, useEffect, lazy, Suspense } from 'react';
import {
  Wrench, Plus, Search, X, Trash2, Printer, FileText, Receipt, History as HistoryIcon,
  ArrowLeft, DollarSign, ChevronRight, Building2, ClipboardCheck, PackageCheck, ScrollText, QrCode, BarChart3, Link as LinkIcon, Check,
} from 'lucide-react';
import { Repair, RepairBatch, Customer, AuditEntry, RepairStatus, RepairType, DeviceType, RepairPart, AppUser, RepairPurchasePaidBy, Note } from '../types';
import { LinkedNotes } from './LinkedNotes';
import {
  REPAIR_STATUSES, REPAIR_STATUS_CELL,
  balanceOwing, batchTotals, matchesRepair, matchesBatch, canSaveRepair,
  partsTotal, repairPartsCost, repairLabor, completeRepair, isRepairOpen, technicianPerformance, dateToEpochMs,
} from '../domain/repairs';
import { newId } from '../domain/ids';
import { printRetailReceipt, printBatchIntake, printBatchInvoice, printBatchSummary, printDeviceSheet, printRepairEstimate } from '../services/repairPrint';
import { getStoreProfile } from './SettingsModal';
import { statusPageUrl } from '../domain/statusLink';
import { formatPhoneInput } from '../domain/phone';
import { usePersistedFilter } from '../hooks/usePersistedFilter';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { selectOnFocus } from '../hooks/selectOnFocus';
import { AutoInventoryNotice, isPrivateBatch } from '../domain/autoInventory';
// Lazy: the repair label modal pulls in jsPDF (~390 kB); load it on demand.
const RepairLabelModal = lazy(() => import('./RepairLabelModal').then(m => ({ default: m.RepairLabelModal })));
import { CustomerSearchInput } from './CustomerSearchInput';
import { toISODate, todayISO } from '../domain/dates';

interface Props {
  repairs: Repair[];
  batches: RepairBatch[];
  customers: Customer[];
  auditLogs: AuditEntry[];
  canDelete: boolean;
  userId?: string; // signed-in user's uid — scopes the remembered status filter so it never leaks between accounts
  onGenerateRepairNumber: () => Promise<string>;
  onGenerateBatchNumber: () => Promise<string>;
  onSaveRepair: (r: Repair, prev?: Repair) => Promise<AutoInventoryNotice | undefined>;
  onDeleteRepair: (id: string) => void;
  onSaveBatch: (b: RepairBatch, prev?: RepairBatch) => void;
  onDeleteBatch: (id: string) => void;
  onRecordPayment: (b: RepairBatch, amount: number) => void;
  onPrintAudit: (entityType: string, id: string, doc: string) => void;
  initialCustomer?: Customer;      // open a new prefilled ticket (CRM quick action)
  initialRepairId?: string;        // open an existing ticket (global search)
  initialNewRepair?: Repair;       // open a new prefilled ticket (e.g. internal repair from Inventory)
  onConsumeInitial?: () => void;
  // Check out a retail repair through Quick Sale (so its revenue/profit land in
  // the sales P&L, cash reconciliation and dashboard totals like any other sale).
  onCheckoutViaSale?: (r: Repair) => void;
  // Owner/manager only: per-technician performance tab (gated by repairs.performance).
  users?: AppUser[];
  canViewPerformance?: boolean;
  notes?: Note[];                        // workspace notes, for the linked-notes panel
  onOpenNote?: (noteId: string) => void; // jump to a linked note in the Notes board
}

const DEVICE_TYPES: DeviceType[] = ['Phone', 'Tablet', 'Laptop', 'Console', 'Watch', 'Other'];
const today = () => todayISO();
const money = (n?: number) => `$${(n || 0).toFixed(2)}`;
const deviceName = (r: Repair) => [r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device';

const inputCls = 'w-full px-2.5 py-1.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100 dark:[color-scheme:dark]';
// Same look as inputCls, minus the baked-in `w-full`. Needed anywhere an
// input sits in a flex row alongside a fixed/flex-grow width of its own
// (e.g. `${inputClsRow} w-24` or `${inputClsRow} flex-1`) — combining
// `w-full` with another width utility is NOT harmless: Tailwind's compiled
// stylesheet orders width utilities with `w-full` after the fixed-size ones
// (w-16, w-24, ...), so at equal specificity `w-full`'s width:100% silently
// wins the cascade and the intended width never applies. That's what made
// the Parts & Labor row's Cost/Qty inputs balloon to ~100% width each and
// left the Name field (flex-basis 0, no shrink share left to claim) at a
// real, DevTools-confirmed 0px.
const inputClsRow = inputCls.replace('w-full ', '');

const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <label className={`block ${className || ''}`}><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</span>{children}</label>
);

const StatusPill: React.FC<{ value: RepairStatus; onChange?: (s: RepairStatus) => void }> = ({ value, onChange }) => (
  <select value={value} disabled={!onChange} onClick={e => e.stopPropagation()} onChange={e => onChange?.(e.target.value as RepairStatus)}
    className={`appearance-none cursor-pointer rounded px-2 py-0.5 text-[11px] font-semibold outline-none ${REPAIR_STATUS_CELL[value]}`}>
    {REPAIR_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
  </select>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2 pb-1 border-b border-slate-100 dark:border-slate-800">{title}</h3>
    {children}
  </div>
);

const ACCENTS: Record<string, string> = {
  blue: 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
  emerald: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400',
  amber: 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400',
  violet: 'bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400',
};
const SummaryCard: React.FC<{ icon: React.ReactNode; accent: string; label: string; value: number }> = ({ icon, accent, label, value }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex items-center gap-3">
    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${ACCENTS[accent] || ACCENTS.blue}`}>{icon}</div>
    <div className="min-w-0"><p className="text-[11px] uppercase tracking-wide text-slate-400 truncate">{label}</p><p className="text-xl font-bold text-slate-900 dark:text-white leading-tight">{value}</p></div>
  </div>
);

export const RepairsView: React.FC<Props> = (props) => {
  const { repairs, batches, auditLogs, canDelete, userId, onSaveRepair, onDeleteRepair, onSaveBatch, onDeleteBatch, onRecordPayment, onPrintAudit } = props;
  type Filter = 'all' | 'active' | 'overdue' | RepairStatus;
  const { users = [], canViewPerformance = false } = props;
  const [tab, setTab] = useState<'tickets' | 'batches' | 'performance'>('tickets');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = usePersistedFilter<Filter>('repairs_status_filter', userId, 'all');
  const [drawer, setDrawer] = useState<{ repair: Repair; isNew: boolean } | null>(null);
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  const [batchForm, setBatchForm] = useState<{ batch: RepairBatch; isNew: boolean } | null>(null);
  const [labelTarget, setLabelTarget] = useState<{ repair: Repair; context?: { batchNumber?: string; lineNumber?: number } } | null>(null);
  // Performance tab date range — defaults to the last 30 days (inclusive of today).
  const [perfFrom, setPerfFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return toISODate(d); });
  const [perfTo, setPerfTo] = useState(() => today());

  // If the caller loses performance access (role change), never leave the tab stuck open.
  useEffect(() => { if (tab === 'performance' && !canViewPerformance) setTab('tickets'); }, [tab, canViewPerformance]);

  const userName = (uid: string) => {
    if (!uid) return 'Unattributed';
    const u = users.find(x => x.id === uid);
    return u ? (u.email?.split('@')[0] || u.email || 'Unknown user') : 'Unknown user';
  };
  const perfRows = useMemo(() => {
    if (!canViewPerformance) return [];
    const startMs = new Date(`${perfFrom}T00:00:00`).getTime();
    const endMs = new Date(`${perfTo}T23:59:59.999`).getTime();
    return technicianPerformance(repairs, startMs, endMs);
  }, [repairs, perfFrom, perfTo, canViewPerformance]);
  const fmtDuration = (ms: number) => {
    if (ms <= 0) return '—';
    const h = ms / 3_600_000;
    if (h < 1) return `${Math.round(ms / 60_000)}m`;
    if (h < 48) return `${h.toFixed(1)}h`;
    return `${(h / 24).toFixed(1)}d`;
  };

  const isOverdue = (r: Repair) => r.status !== 'completed' && r.status !== 'cancelled' && !!r.estimatedCompletion && r.estimatedCompletion < today();
  const matchFilter = (r: Repair): boolean => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'active') return r.status !== 'completed' && r.status !== 'cancelled';
    if (statusFilter === 'overdue') return isOverdue(r);
    return r.status === statusFilter;
  };

  // "Tickets" = standalone repairs (retail + internal). Wholesale devices live
  // under their batches, not in this list.
  // Default order: open (active) tickets first, oldest → newest, so the ticket
  // that has waited longest is at the top and nothing active sits forgotten at
  // the bottom; completed/cancelled tickets sink below (also oldest-first). The
  // status filter and search remain the manual controls.
  const retail = useMemo(() => repairs.filter(r => r.type !== 'wholesale')
    .filter(r => matchFilter(r) && (!query || matchesRepair(r, query)))
    .sort((a, b) => {
      const ao = isRepairOpen(a) ? 0 : 1, bo = isRepairOpen(b) ? 0 : 1;
      return ao !== bo ? ao - bo : a.createdAt - b.createdAt;
    }), [repairs, statusFilter, query]);

  const visibleBatches = useMemo(() => batches
    .filter(b => !query || matchesBatch(b, query) || repairs.some(r => r.batchId === b.id && matchesRepair(r, query)))
    .sort((a, b) => b.createdAt - a.createdAt), [batches, repairs, query]);

  const openBatch = batches.find(b => b.id === openBatchId) || null;

  // Open the QR label modal, resolving batch context for wholesale devices.
  const openLabel = (r: Repair) => {
    if (r.batchId) {
      const b = batches.find(x => x.id === r.batchId);
      const devs = repairs.filter(x => x.batchId === r.batchId).sort((a, c) => a.createdAt - c.createdAt);
      setLabelTarget({ repair: r, context: { batchNumber: b?.batchNumber, lineNumber: devs.findIndex(x => x.id === r.id) + 1 } });
    } else {
      setLabelTarget({ repair: r });
    }
  };

  // Print a device sheet, resolving the parent batch (for wholesale context).
  const printSheet = (r: Repair) => {
    const b = r.batchId ? batches.find(x => x.id === r.batchId) : undefined;
    printDeviceSheet(r, { companyName: b?.companyName, batchNumber: b?.batchNumber, storeName: getStoreProfile().storeName });
    onPrintAudit('repair', r.id, 'device_sheet');
  };

  const summary = useMemo(() => ({
    active: repairs.filter(r => r.status !== 'completed' && r.status !== 'cancelled').length,
    ready: repairs.filter(r => r.status === 'ready_pickup').length,
    approval: repairs.filter(r => r.status === 'waiting_approval').length,
    batchesActive: batches.filter(b => b.status === 'active').length,
  }), [repairs, batches]);

  // --- creators ---
  const newRetail = (): Repair => ({ id: newId(), repairNumber: '', type: 'retail', createdAt: Date.now(), date: today(), issue: '', repairPrice: 0, status: 'received', warrantyDays: 90, deposit: 0 });

  // Open a new prefilled ticket when arriving from a CRM "Create Repair" action.
  useEffect(() => {
    const c = props.initialCustomer;
    if (!c) return;
    setTab('tickets');
    setDrawer({ repair: { ...newRetail(), customerId: c.id, customerName: c.name, customerPhone: c.phone, customerEmail: c.email }, isNew: true });
    props.onConsumeInitial?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialCustomer?.id]);

  // Open an existing ticket by id (from global search).
  useEffect(() => {
    const id = props.initialRepairId;
    if (!id) return;
    const r = props.repairs.find(x => x.id === id);
    if (r) { setTab('tickets'); setDrawer({ repair: r, isNew: false }); }
    props.onConsumeInitial?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialRepairId]);

  // Open a new prefilled ticket handed in from elsewhere (e.g. "Create repair
  // ticket" on an inventory device → an internal repair prefilled + linked).
  useEffect(() => {
    const r = props.initialNewRepair;
    if (!r) return;
    setTab('tickets');
    setDrawer({ repair: r, isNew: true });
    props.onConsumeInitial?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialNewRepair?.id]);
  const newDevice = (batchId: string): Repair => ({ id: newId(), repairNumber: '', type: 'wholesale', batchId, createdAt: Date.now(), date: today(), issue: '', repairPrice: 0, status: 'received' });
  const newBatch = (): RepairBatch => ({ id: newId(), batchNumber: '', createdAt: Date.now(), dateReceived: today(), companyName: '', status: 'active', amountPaid: 0 });

  const saveDrawer = async (form: Repair) => {
    // Keep partsCost in sync with the structured parts breakdown on every save,
    // so analytics/reports read one consistent number.
    let next: Repair = { ...form, partsCost: repairPartsCost(form) };
    if (drawer?.isNew && !next.repairNumber) next = { ...next, repairNumber: await props.onGenerateRepairNumber() };
    const notice = await onSaveRepair(next, drawer?.isNew ? undefined : drawer?.repair);
    // A Luhn-invalid IMEI blocks the save entirely (no ticket created) — keep the
    // drawer open so the user can fix or clear the field, rather than silently
    // losing their in-progress edits.
    if (notice?.kind === 'blocked') { window.alert(notice.message); return; }
    setDrawer(null);
    if (notice?.kind === 'warning') window.alert(notice.message);
    else if (notice?.kind === 'created') window.alert(`Added to inventory as SKU ${notice.sku}.`);
    else if (notice?.kind === 'attached') {
      const was = notice.previousStatus ? `, was: ${notice.previousStatus.replace(/_/g, ' ')}` : '';
      window.alert(`Already in inventory — SKU ${notice.sku}${was}. Repair attached to existing record.`);
    }
  };
  const saveBatch = async (form: RepairBatch, isNew: boolean, prev?: RepairBatch) => {
    let next = form;
    if (isNew && !next.batchNumber) next = { ...next, batchNumber: await props.onGenerateBatchNumber() };
    onSaveBatch(next, isNew ? undefined : prev);
    setBatchForm(null);
    if (isNew) setOpenBatchId(next.id);
  };

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header + tabs */}
      {!openBatch && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2"><Wrench className="w-6 h-6 text-indigo-500" /> Repairs</h2>
            <div className="flex items-center gap-2">
              {tab === 'tickets' && <button onClick={() => setDrawer({ repair: newRetail(), isNew: true })} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4" /> New Ticket</button>}
              {tab === 'batches' && <button onClick={() => setBatchForm({ batch: newBatch(), isNew: true })} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4" /> New Batch</button>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
              {([['tickets', 'Retail Tickets'], ['batches', 'Wholesale Batches'], ...(canViewPerformance ? [['performance', 'Performance'] as const] : [])] as const).map(([t, label]) => (
                <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-md text-sm font-medium ${tab === t ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}`}>
                  {label}
                </button>
              ))}
            </div>
            {tab !== 'performance' && (
              <div className="relative flex-1 min-w-[220px]">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tab === 'tickets' ? 'Search repair #, customer, phone, IMEI/serial, model, issue…' : 'Search batch #, company, contact, phone, email…'}
                  className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
            )}
            {tab === 'tickets' && (
              <select value={REPAIR_STATUSES.some(s => s.value === statusFilter) ? statusFilter : 'all'} onChange={e => setStatusFilter(e.target.value as any)} className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200">
                <option value="all">Any status…</option>
                {REPAIR_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            )}
          </div>

          {/* Quick filters (tickets) */}
          {tab === 'tickets' && (
            <div className="flex flex-wrap gap-1.5">
              {(([['all', 'All'], ['active', 'Active'], ['ready_pickup', 'Ready for Pickup'], ['waiting_approval', 'Waiting Approval'], ['overdue', 'Overdue']]) as [Filter, string][]).map(([v, label]) => (
                <button key={v} onClick={() => setStatusFilter(v)} className={`px-2.5 py-1 rounded-full text-xs font-medium border ${statusFilter === v ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'}`}>{label}</button>
              ))}
            </div>
          )}

          {/* Summary cards */}
          {tab !== 'performance' && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <SummaryCard icon={<Wrench className="w-4 h-4" />} accent="blue" label="Active Repairs" value={summary.active} />
              <SummaryCard icon={<PackageCheck className="w-4 h-4" />} accent="emerald" label="Ready for Pickup" value={summary.ready} />
              <SummaryCard icon={<ClipboardCheck className="w-4 h-4" />} accent="amber" label="Waiting Approval" value={summary.approval} />
              <SummaryCard icon={<Building2 className="w-4 h-4" />} accent="violet" label="Active Batches" value={summary.batchesActive} />
            </div>
          )}
        </>
      )}

      {/* Technician performance (owner/manager only) */}
      {!openBatch && tab === 'performance' && canViewPerformance && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <Field label="From"><input type="date" value={perfFrom} max={perfTo} onChange={e => setPerfFrom(e.target.value)} className={inputCls} /></Field>
            <Field label="To"><input type="date" value={perfTo} min={perfFrom} max={today()} onChange={e => setPerfTo(e.target.value)} className={inputCls} /></Field>
            <div className="flex gap-1.5">
              {(([[7, '7d'], [30, '30d'], [90, '90d']]) as [number, string][]).map(([days, label]) => (
                <button key={days} onClick={() => { const d = new Date(); d.setDate(d.getDate() - (days - 1)); setPerfFrom(toISODate(d)); setPerfTo(today()); }}
                  className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400">Last {label}</button>
              ))}
            </div>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-500" />
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Repairs completed by technician</h3>
              <span className="text-xs text-slate-400">· intake → completed</span>
            </div>
            {perfRows.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-12">No repairs completed in this date range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 border-b border-slate-100 dark:border-slate-800">
                      <th className="px-4 py-2 font-medium">Technician</th>
                      <th className="px-4 py-2 font-medium text-right">Completed</th>
                      <th className="px-4 py-2 font-medium text-right">Avg turnaround</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {perfRows.map(row => (
                      <tr key={row.userId || '_unattributed'} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100">{userName(row.userId)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-900 dark:text-slate-100">{row.completed}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtDuration(row.avgTurnaroundMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-xs text-slate-400">Attribution is by who marked each repair complete. Repairs completed before this was tracked show as “Unattributed.”</p>
        </div>
      )}

      {/* Retail tickets list */}
      {!openBatch && tab === 'tickets' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          {retail.length === 0 ? <p className="text-sm text-slate-400 text-center py-12">No repair tickets.</p> : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {retail.map(r => (
                <div key={r.id} onClick={() => setDrawer({ repair: r, isNew: false })} className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer">
                  <div className="min-w-0 flex-1 basis-full sm:basis-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{deviceName(r)} <span className="font-mono text-xs text-slate-400 ml-1">{r.repairNumber}</span></p>
                    <p className="text-xs text-slate-400 truncate">{r.type === 'internal' ? 'Internal · refurb' : (r.customerName || 'Walk-in')}{r.customerPhone ? ` · ${r.customerPhone}` : ''}{r.imei ? ` · ${r.imei}` : ''} · {r.date}</p>
                  </div>
                  {isOverdue(r) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 shrink-0">Overdue</span>}
                  <div className="text-right shrink-0 ml-auto sm:ml-0"><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{money(r.repairPrice)}</p>{balanceOwing(r) > 0 && <p className="text-[11px] text-rose-500">bal {money(balanceOwing(r))}</p>}</div>
                  <StatusPill value={r.status} onChange={s => onSaveRepair({ ...r, status: s }, r)} />
                  <button onClick={e => { e.stopPropagation(); openLabel(r); }} title="Print QR label" aria-label="Print QR label" className="tap-target flex items-center justify-center text-slate-400 hover:text-indigo-600 shrink-0"><QrCode className="w-4 h-4" /></button>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Wholesale batches list */}
      {!openBatch && tab === 'batches' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          {visibleBatches.length === 0 ? <p className="text-sm text-slate-400 text-center py-12">No wholesale batches.</p> : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleBatches.map(b => {
                const t = batchTotals(b, repairs);
                return (
                  <div key={b.id} onClick={() => setOpenBatchId(b.id)} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer">
                    <div className="w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0"><Building2 className="w-4 h-4 text-violet-600 dark:text-violet-400" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{b.companyName} <span className="font-mono text-xs text-slate-400 ml-1">{b.batchNumber}</span></p>
                      <p className="text-xs text-slate-400 truncate">{t.count} device{t.count !== 1 ? 's' : ''} · {b.dateReceived}{b.contactPerson ? ` · ${b.contactPerson}` : ''}</p>
                    </div>
                    <div className="text-right shrink-0"><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{money(t.totalCost)}</p>{t.remaining > 0 ? <p className="text-[11px] text-rose-500">bal {money(t.remaining)}</p> : <p className="text-[11px] text-emerald-500">paid</p>}</div>
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${b.status === 'active' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' : b.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'}`}>{b.status}</span>
                    <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Batch detail */}
      {openBatch && (
        <BatchDetail batch={openBatch} repairs={repairs} canDelete={canDelete}
          onBack={() => setOpenBatchId(null)}
          onAddDevice={() => setDrawer({ repair: newDevice(openBatch.id), isNew: true })}
          onEditDevice={(r) => setDrawer({ repair: r, isNew: false })}
          onStatus={(r, s) => onSaveRepair({ ...r, status: s }, r)}
          onPrintDevice={printSheet}
          onPrintLabel={openLabel}
          onRemoveDevice={(r) => onDeleteRepair(r.id)}
          onEditBatch={() => setBatchForm({ batch: openBatch, isNew: false })}
          onDeleteBatch={() => { onDeleteBatch(openBatch.id); setOpenBatchId(null); }}
          onRecordPayment={onRecordPayment}
          onPrint={(doc, justPaid) => {
            const devices = repairs.filter(r => r.batchId === openBatch.id);
            // Printing right after Record Payment races the Firestore round-trip —
            // openBatch.amountPaid won't reflect this payment yet. justPaid lets the
            // caller fold it in locally so the invoice shows the correct running total.
            const forPrint = justPaid ? { ...openBatch, amountPaid: (openBatch.amountPaid || 0) + justPaid } : openBatch;
            const storeName = getStoreProfile().storeName;
            if (doc === 'intake') printBatchIntake(forPrint, devices, { storeName });
            if (doc === 'invoice') printBatchInvoice(forPrint, devices, { storeName });
            if (doc === 'summary') printBatchSummary(forPrint, devices, { storeName });
            onPrintAudit('repairBatch', openBatch.id, doc);
          }} />
      )}

      {/* Repair drawer (retail ticket OR wholesale device) */}
      {drawer && (
        <RepairDrawer key={drawer.repair.id} initial={drawer.repair} isNew={drawer.isNew} canDelete={canDelete}
          auditLogs={auditLogs} customers={props.customers}
          privateBatch={isPrivateBatch(drawer.repair.batchId ? batches.find(b => b.id === drawer.repair.batchId) : undefined)}
          notes={props.notes} onOpenNote={props.onOpenNote}
          onClose={() => setDrawer(null)}
          onSave={saveDrawer}
          onCheckoutViaSale={props.onCheckoutViaSale}
          onDelete={() => { onDeleteRepair(drawer.repair.id); setDrawer(null); }}
          onPrint={(doc) => { printRetailReceipt(drawer.repair, doc, { storeName: getStoreProfile().storeName }); onPrintAudit('repair', drawer.repair.id, doc); }}
          onPrintSheet={() => printSheet(drawer.repair)}
          onPrintLabel={() => openLabel(drawer.repair)}
          onPrintEstimate={() => { printRepairEstimate(drawer.repair, { storeName: getStoreProfile().storeName }); onPrintAudit('repair', drawer.repair.id, 'estimate'); }} />
      )}

      {/* Batch create/edit form */}
      {batchForm && (
        <BatchForm initial={batchForm.batch} isNew={batchForm.isNew}
          onClose={() => setBatchForm(null)}
          onSave={(b) => saveBatch(b, batchForm.isNew, batchForm.isNew ? undefined : batchForm.batch)} />
      )}

      {/* Repair QR label */}
      {labelTarget && (
        <Suspense fallback={null}>
          <RepairLabelModal repair={labelTarget.repair} context={labelTarget.context}
            onClose={() => setLabelTarget(null)}
            onPrinted={() => onPrintAudit('repair', labelTarget.repair.id, 'qr_label')} />
        </Suspense>
      )}
    </div>
  );
};

/* ---------------- Batch detail ---------------- */
const BatchDetail: React.FC<{
  batch: RepairBatch; repairs: Repair[]; canDelete: boolean;
  onBack: () => void; onAddDevice: () => void; onEditDevice: (r: Repair) => void;
  onStatus: (r: Repair, s: RepairStatus) => void; onPrintDevice: (r: Repair) => void; onPrintLabel: (r: Repair) => void; onRemoveDevice: (r: Repair) => void;
  onEditBatch: () => void; onDeleteBatch: () => void;
  onRecordPayment: (b: RepairBatch, amount: number) => void; onPrint: (doc: 'intake' | 'invoice' | 'summary', justPaid?: number) => void;
}> = ({ batch, repairs, canDelete, onBack, onAddDevice, onEditDevice, onStatus, onPrintDevice, onPrintLabel, onRemoveDevice, onEditBatch, onDeleteBatch, onRecordPayment, onPrint }) => {
  const devices = repairs.filter(r => r.batchId === batch.id).sort((a, b) => a.createdAt - b.createdAt);
  const t = batchTotals(batch, repairs);
  const [pay, setPay] = useState('');
  // Optional: print the invoice right at checkout (recording a payment) rather
  // than only afterward via the standalone Invoice button above.
  const [printOnPay, setPrintOnPay] = useState(false);
  const statusCounts = REPAIR_STATUSES
    .map(s => ({ ...s, n: devices.filter(d => d.status === s.value).length }))
    .filter(s => s.n > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"><ArrowLeft className="w-4 h-4" /></button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white truncate">{batch.companyName} <span className="font-mono text-sm text-slate-400">{batch.batchNumber}</span></h2>
          <p className="text-xs text-slate-400">{batch.dateReceived}{batch.contactPerson ? ` · ${batch.contactPerson}` : ''}{batch.phone ? ` · ${batch.phone}` : ''}</p>
        </div>
        <button onClick={onEditBatch} className="px-3 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:border-indigo-400">Edit</button>
        {canDelete && <button onClick={onDeleteBatch} className="p-2 text-slate-400 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[['Total Devices', String(t.count)], ['Total Repair Amount', money(t.totalCost)], ['Amount Paid', money(t.amountPaid)], ['Remaining Balance', money(t.remaining)]].map(([k, v], i) => (
          <div key={k} className={`rounded-xl p-3 border ${i === 3 ? (t.remaining > 0 ? 'bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800' : 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800') : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'}`}>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{k}</p>
            <p className={`text-lg font-bold ${i === 3 ? (t.remaining > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400') : 'text-slate-900 dark:text-white'}`}>{v}</p>
          </div>
        ))}
      </div>

      {/* Status counts */}
      {statusCounts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {statusCounts.map(s => (
            <span key={s.value} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ${REPAIR_STATUS_CELL[s.value]}`}>{s.label}<span className="opacity-70">· {s.n}</span></span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onAddDevice} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4" /> Add Device</button>
        <button onClick={() => onPrint('intake')} className="flex items-center gap-2 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:border-indigo-400"><FileText className="w-4 h-4" /> Intake Sheet</button>
        <button onClick={() => onPrint('invoice')} className="flex items-center gap-2 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:border-indigo-400"><Receipt className="w-4 h-4" /> Invoice</button>
        <button onClick={() => onPrint('summary')} className="flex items-center gap-2 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:border-indigo-400"><Printer className="w-4 h-4" /> Summary</button>
        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 cursor-pointer" title="Also print the invoice when this payment is recorded">
            <input type="checkbox" checked={printOnPay} onChange={e => setPrintOnPay(e.target.checked)} className="rounded" /> Print invoice
          </label>
          <div className="relative"><DollarSign className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" /><input value={pay} onChange={e => setPay(e.target.value)} onFocus={selectOnFocus} placeholder="0.00" inputMode="decimal" className="w-24 pl-7 pr-2 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg" /></div>
          <button onClick={() => { const a = parseFloat(pay) || 0; if (a > 0) { onRecordPayment(batch, a); setPay(''); if (printOnPay) onPrint('invoice', a); } }} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium">Record Payment</button>
        </div>
      </div>

      {/* Devices table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <tr><th className="text-left px-4 py-2">#</th><th className="text-left px-4 py-2">Device</th><th className="text-left px-4 py-2">IMEI/Serial</th><th className="text-left px-4 py-2">Issue</th><th className="text-left px-4 py-2">Status</th><th className="text-right px-4 py-2">Price</th><th className="text-right px-4 py-2">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {devices.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-8">No devices in this batch yet.</td></tr>}
            {devices.map((r, idx) => (
              <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-4 py-2 text-slate-400">{idx + 1}</td>
                <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100 cursor-pointer" onClick={() => onEditDevice(r)}>{deviceName(r)}</td>
                <td className="px-4 py-2 text-slate-500 dark:text-slate-400 font-mono text-xs">{r.imei || '—'}</td>
                <td className="px-4 py-2 text-slate-500 dark:text-slate-400 truncate max-w-[200px]">{r.issue || '—'}</td>
                <td className="px-4 py-2"><StatusPill value={r.status} onChange={s => onStatus(r, s)} /></td>
                <td className="px-4 py-2 text-right font-medium text-slate-800 dark:text-slate-100">{money(r.repairPrice)}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => onEditDevice(r)} title="Edit" className="p-1 text-slate-400 hover:text-indigo-600"><FileText className="w-4 h-4" /></button>
                    <button onClick={() => onPrintDevice(r)} title="Print device sheet" className="p-1 text-slate-400 hover:text-indigo-600"><Printer className="w-4 h-4" /></button>
                    <button onClick={() => onPrintLabel(r)} title="Print QR label" className="p-1 text-slate-400 hover:text-indigo-600"><QrCode className="w-4 h-4" /></button>
                    {canDelete && <button onClick={() => onRemoveDevice(r)} title="Remove" className="p-1 text-slate-400 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ---------------- Repair drawer ---------------- */
const RepairDrawer: React.FC<{
  initial: Repair; isNew: boolean; canDelete: boolean; auditLogs: AuditEntry[]; customers: Customer[];
  // Whether this ticket's wholesale batch is flagged private — gates the
  // per-device "Add this device to inventory" toggle (Repair.wantsAutoInventory),
  // which in turn gates the Purchase Cost / Paid By fields. See App.tsx's
  // handleSaveRepair and domain/autoInventory.ts's isPrivateBatch.
  privateBatch: boolean;
  notes?: Note[]; onOpenNote?: (noteId: string) => void;
  onClose: () => void; onSave: (r: Repair) => void; onCheckoutViaSale?: (r: Repair) => void; onDelete: () => void; onPrint: (doc: 'intake' | 'repair' | 'pickup') => void; onPrintSheet: () => void; onPrintLabel: () => void; onPrintEstimate: () => void;
}> = ({ initial, isNew, canDelete, auditLogs, customers, privateBatch, notes, onOpenNote, onClose, onSave, onCheckoutViaSale, onDelete, onPrint, onPrintSheet, onPrintLabel, onPrintEstimate }) => {
  const [f, setF] = useState<Repair>(initial);
  const [linkCopied, setLinkCopied] = useState(false);
  // Snapshot the form state at mount for a dirty check, so a stray backdrop/X
  // click doesn't silently discard typed changes.
  const [snapshot] = useState(() => JSON.stringify(initial));
  const set = (patch: Partial<Repair>) => setF(prev => ({ ...prev, ...patch }));
  // Structured parts editor.
  const addPart = () => set({ parts: [...(f.parts || []), { id: newId(), name: '', unitCost: 0, quantity: 1 }] });
  const updatePart = (id: string, patch: Partial<RepairPart>) => set({ parts: (f.parts || []).map(p => p.id === id ? { ...p, ...patch } : p) });
  const removePart = (id: string) => set({ parts: (f.parts || []).filter(p => p.id !== id) });
  const isRetail = f.type === 'retail';
  const isInternal = f.type === 'internal';
  const showDeviceDetail = isRetail || isInternal; // full device fields; wholesale keeps the minimal set
  const history = auditLogs.filter(a => a.entityId === f.id).slice(0, 20);
  const num = (v: string) => parseFloat(v) || 0;
  const canSave = canSaveRepair(f);
  const isTerminal = f.status === 'completed' || f.status === 'picked_up' || f.status === 'cancelled';
  const dirty = JSON.stringify(f) !== snapshot;
  const requestClose = () => { if (!dirty || window.confirm('Discard unsaved changes to this repair?')) onClose(); };
  useEscapeKey(requestClose);

  // Check out: retail repairs go through the shared Quick Sale flow (so the money
  // lands in the sales P&L / cash reconciliation / dashboard totals like any sale
  // — the app links the sale back and marks the repair complete on commit).
  // Internal refurbs and wholesale devices have no customer sale here, so they're
  // simply stamped complete.
  // Backdatable completion date for the direct-complete path (internal/wholesale
  // — no customer sale here to carry a date of its own). Retail completion date
  // instead comes from the Quick Sale's own Sale Date field (see App.tsx's
  // handleSellCart), since that's what recognizes the money.
  const [completionDate, setCompletionDate] = useState(today());

  const checkOut = () => {
    if (!canSave) return;
    if (isRetail && onCheckoutViaSale) { onSave(f); onCheckoutViaSale(f); }
    else onSave(completeRepair(f, dateToEpochMs(completionDate), 'completed'));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={requestClose}>
      <div className="w-full max-w-xl max-h-[90vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{isNew ? (isInternal ? 'New Internal Repair' : isRetail ? 'New Repair Ticket' : 'Add Device') : (isInternal ? 'Internal Repair' : isRetail ? 'Repair Ticket' : 'Device')}{f.repairNumber && <span className="font-mono text-xs text-slate-400 ml-2">{f.repairNumber}</span>}</h2>
            <StatusPill value={f.status} onChange={s => set({ status: s })} />
          </div>
          <div className="flex items-center gap-3">
            {isRetail && f.repairNumber && (
              <button
                onClick={() => { navigator.clipboard.writeText(statusPageUrl(f.repairNumber)); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500); }}
                title="Copy the customer status-lookup link for this ticket"
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
              >
                {linkCopied ? <><Check className="w-3.5 h-3.5" /> Copied</> : <><LinkIcon className="w-3.5 h-3.5" /> Copy Link</>}
              </button>
            )}
            <button onClick={requestClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-4 h-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-5">
          {isInternal && (
            <div className="flex items-start gap-2 text-xs text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/40 rounded-lg px-3 py-2">
              <Wrench className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Internal refurbishment of a shop-owned device — no customer. Linked to the inventory item; the repair cost stays separate and is set on the item manually after review.</span>
            </div>
          )}
          {isRetail && (
            <Section title="Customer">
              {customers.length > 0 && (
                <div className="mb-3">
                  <CustomerSearchInput customers={customers} kind="retail" placeholder="Find existing customer…" autoFocus={isNew}
                    onSelect={c => set({ customerId: c.id, customerName: c.name, customerPhone: c.phone || '', customerEmail: c.email || '' })} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Customer (required)"><input autoFocus={isNew && customers.length === 0} className={inputCls} value={f.customerName || ''} onChange={e => set({ customerName: e.target.value, customerId: undefined })} /></Field>
                <Field label="Phone"><input type="tel" className={inputCls} value={f.customerPhone || ''} onChange={e => set({ customerPhone: formatPhoneInput(e.target.value) })} /></Field>
                <Field label="Email (optional)" className="col-span-2"><input className={inputCls} value={f.customerEmail || ''} onChange={e => set({ customerEmail: e.target.value })} /></Field>
              </div>
            </Section>
          )}

          <Section title="Device">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Intake Date" className="col-span-2">
                <input type="date" max={today()} className={inputCls} value={f.date}
                  onChange={e => set({ date: e.target.value, createdAt: dateToEpochMs(e.target.value) })} />
              </Field>
              <Field label="Device Type"><select autoFocus={isNew && !isRetail} className={inputCls} value={f.deviceType || ''} onChange={e => set({ deviceType: e.target.value as DeviceType })}><option value="">—</option>{DEVICE_TYPES.map(d => <option key={d} value={d}>{d}</option>)}</select></Field>
              <Field label="IMEI / Serial"><input className={inputCls} value={f.imei || ''} onChange={e => set({ imei: e.target.value })} /></Field>
              <Field label="Brand / Model" className="col-span-2"><input className={inputCls} placeholder="e.g. Apple iPhone 14 Pro" value={[f.brand, f.model].filter(Boolean).join(' ')} onChange={e => set({ brand: '', model: e.target.value })} /></Field>
              {showDeviceDetail && <>
                <Field label="Storage"><input className={inputCls} value={f.storage || ''} onChange={e => set({ storage: e.target.value })} /></Field>
                <Field label="Color"><input className={inputCls} value={f.color || ''} onChange={e => set({ color: e.target.value })} /></Field>
                <Field label="Carrier (optional)"><input className={inputCls} value={f.carrier || ''} onChange={e => set({ carrier: e.target.value })} /></Field>
                <Field label="Passcode (optional)"><input className={inputCls} value={f.passcode || ''} onChange={e => set({ passcode: e.target.value })} /></Field>
              </>}
            </div>
          </Section>

          <Section title="Issue / Condition">
            <Field label="Issue Description"><textarea rows={2} className={inputCls} value={f.issue} onChange={e => set({ issue: e.target.value })} /></Field>
            {isRetail && (
              <Field label="Cosmetic Condition" className="mt-3"><textarea rows={2} className={inputCls} placeholder="e.g. Cracked screen, scratches on back, minor dents…" value={f.cosmetic?.notes || ''} onChange={e => set({ cosmetic: { checks: [], notes: e.target.value } })} /></Field>
            )}
          </Section>

          <Section title="Payment / Warranty">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Repair Price"><input type="number" min="0" step="0.01" className={inputCls} value={f.repairPrice} onChange={e => set({ repairPrice: num(e.target.value) })} onFocus={selectOnFocus} /></Field>
              {isRetail && <Field label="Deposit"><input type="number" min="0" step="0.01" className={inputCls} value={f.deposit ?? 0} onChange={e => set({ deposit: num(e.target.value) })} onFocus={selectOnFocus} /></Field>}
              {isRetail && <Field label="Balance Owing"><input readOnly className={`${inputCls} opacity-70`} value={money(balanceOwing(f))} /></Field>}
              {isRetail && <Field label="Warranty (days)"><input type="number" min="0" className={inputCls} value={f.warrantyDays ?? 0} onChange={e => set({ warrantyDays: num(e.target.value) })} /></Field>}
              {isRetail && <Field label="Est. Completion" className="col-span-2"><input type="date" className={inputCls} value={f.estimatedCompletion || ''} onChange={e => set({ estimatedCompletion: e.target.value })} /></Field>}
            </div>
            {isNew && privateBatch && (
              <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" className="mt-0.5" checked={!!f.wantsAutoInventory} onChange={e => set({ wantsAutoInventory: e.target.checked })} />
                  <span>Add this device to inventory — adds it automatically (or attaches to an existing IMEI/serial match), and makes it available for sale once this repair completes.</span>
                </label>
                {f.wantsAutoInventory && (
                  <div className="mt-3">
                    <p className="text-xs text-slate-400 mb-2">What this device cost flows into its inventory record so profit reflects the real cost, not just $0.</p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Purchase Cost (optional)"><input type="number" min="0" step="0.01" placeholder="0.00" className={inputCls} value={f.purchaseCost ?? ''} onChange={e => set({ purchaseCost: e.target.value === '' ? undefined : num(e.target.value) })} onFocus={selectOnFocus} /></Field>
                      <Field label="Paid From">
                        <select className={inputCls} value={f.purchasePaidBy || 'personal'} onChange={e => set({ purchasePaidBy: e.target.value as RepairPurchasePaidBy })}>
                          <option value="personal">Paid personally / outside store cash</option>
                          <option value="store">Paid from store cash</option>
                        </select>
                      </Field>
                    </div>
                    {!!f.purchaseCost && f.purchasePaidBy === 'store' && (
                      <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">Saving will log a ${f.purchaseCost.toFixed(2)} cash-out against today's drawer.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </Section>

          <Section title="Parts & Labor">
            <p className="text-xs text-slate-400 mb-2">Log each part used and its cost — the parts total feeds repair margin, separate from the price you charge.</p>
            {(f.parts || []).map(p => (
              <div key={p.id} className="flex items-center gap-2 mb-2">
                <input className={`${inputClsRow} flex-1 min-w-0`} placeholder="Part (e.g. OLED screen)" value={p.name} onChange={e => updatePart(p.id, { name: e.target.value })} />
                <input type="number" min="0" step="0.01" className={`${inputClsRow} w-24 shrink-0`} placeholder="Cost" value={p.unitCost || ''} onChange={e => updatePart(p.id, { unitCost: num(e.target.value) })} onFocus={selectOnFocus} />
                <input type="number" min="1" step="1" className={`${inputClsRow} w-16 shrink-0`} placeholder="Qty" value={p.quantity || ''} onChange={e => updatePart(p.id, { quantity: Math.max(1, Math.round(num(e.target.value)) || 1) })} />
                <button type="button" onClick={() => removePart(p.id)} className="p-1.5 text-slate-400 hover:text-rose-500 shrink-0" aria-label="Remove part"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <button type="button" onClick={addPart} className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"><Plus className="w-3.5 h-3.5" /> Add part</button>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60"><span className="text-slate-500 dark:text-slate-400">Parts cost</span><span className="font-semibold text-slate-800 dark:text-slate-100">{money(partsTotal(f.parts))}</span></div>
              <div className="flex justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/60"><span className="text-slate-500 dark:text-slate-400">Labor (margin)</span><span className="font-semibold text-slate-800 dark:text-slate-100">{money(repairLabor(f))}</span></div>
            </div>
          </Section>

          <Section title="Notes">
            <div className="grid grid-cols-1 gap-3">
              <Field label="Internal Notes"><textarea rows={2} className={inputCls} value={f.internalNotes || ''} onChange={e => set({ internalNotes: e.target.value })} /></Field>
              {isRetail && <Field label="Customer Notes"><textarea rows={2} className={inputCls} value={f.customerNotes || ''} onChange={e => set({ customerNotes: e.target.value })} /></Field>}
            </div>
            <LinkedNotes notes={notes} linkType="repair" linkId={f.id} onOpenNote={onOpenNote} className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800" />
          </Section>

          {/* Audit history */}
          {!isNew && (
            <div>
              <h3 className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 mb-2"><HistoryIcon className="w-3.5 h-3.5 text-indigo-500" /> Audit History</h3>
              {history.length === 0 ? <p className="text-xs text-slate-400">No history yet.</p> : (
                <ul className="space-y-1.5">
                  {history.map(a => <li key={a.id} className="text-xs text-slate-500 dark:text-slate-400 border-l-2 border-indigo-200 dark:border-indigo-800 pl-2 flex justify-between gap-2"><span>{a.action}</span><span className="text-slate-400 shrink-0">{new Date(a.ts).toLocaleString()}</span></li>)}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 flex-wrap">
          <button onClick={() => canSave && onSave(f)} disabled={!canSave}
            title={canSave ? undefined : (f.parts || []).some(p => !p.name?.trim()) ? 'Name every part before saving' : 'Enter a customer name first'}
            className="flex-1 min-w-[110px] px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium">Save</button>
          {!isTerminal && !isRetail && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400" title="Backdate if this repair was already finished before it got entered">
              Completed
              <input type="date" max={today()} value={completionDate} onChange={e => setCompletionDate(e.target.value)}
                className="px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs" />
            </label>
          )}
          {!isTerminal && (
            <button onClick={checkOut} disabled={!canSave}
              className="flex-1 min-w-[110px] px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-1.5"><ClipboardCheck className="w-4 h-4" /> {isRetail && onCheckoutViaSale ? 'Check Out' : 'Mark Complete'}</button>
          )}
          {!isNew && (
            <div className="flex items-center gap-1">
              <button onClick={onPrintLabel} title="Print QR label" className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 hover:border-indigo-400"><QrCode className="w-4 h-4" /></button>
              <button onClick={onPrintSheet} title="Print device sheet" className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 hover:border-indigo-400"><ScrollText className="w-4 h-4" /></button>
              {isRetail && <>
                <button onClick={onPrintEstimate} title="Print estimate (before work begins — not a final bill)" className="p-2 border border-amber-300 dark:border-amber-700 rounded-lg text-amber-600 dark:text-amber-400 hover:border-amber-400"><DollarSign className="w-4 h-4" /></button>
                <button onClick={() => onPrint('intake')} title="Intake receipt" className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 hover:border-indigo-400"><FileText className="w-4 h-4" /></button>
                <button onClick={() => onPrint('repair')} title="Repair receipt" className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 hover:border-indigo-400"><Receipt className="w-4 h-4" /></button>
                <button onClick={() => onPrint('pickup')} title="Pickup receipt" className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 hover:border-indigo-400"><Printer className="w-4 h-4" /></button>
              </>}
            </div>
          )}
          {canDelete && !isNew && <button onClick={onDelete} className="p-2 text-slate-400 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>}
        </div>
      </div>
    </div>
  );
};

/* ---------------- Batch create/edit form ---------------- */
const BatchForm: React.FC<{ initial: RepairBatch; isNew: boolean; onClose: () => void; onSave: (b: RepairBatch) => void }> = ({ initial, isNew, onClose, onSave }) => {
  const [f, setF] = useState<RepairBatch>(initial);
  const [snapshot] = useState(() => JSON.stringify(initial));
  const set = (patch: Partial<RepairBatch>) => setF(prev => ({ ...prev, ...patch }));
  const dirty = JSON.stringify(f) !== snapshot;
  const requestClose = () => { if (!dirty || window.confirm('Discard unsaved changes to this batch?')) onClose(); };
  useEscapeKey(requestClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={requestClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{isNew ? 'New Wholesale Batch' : 'Edit Batch'}</h2>
          <button onClick={requestClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Company Name"><input autoFocus className={inputCls} value={f.companyName} onChange={e => set({ companyName: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact Person"><input className={inputCls} value={f.contactPerson || ''} onChange={e => set({ contactPerson: e.target.value })} /></Field>
            <Field label="Phone"><input type="tel" className={inputCls} value={f.phone || ''} onChange={e => set({ phone: formatPhoneInput(e.target.value) })} /></Field>
            <Field label="Email"><input className={inputCls} value={f.email || ''} onChange={e => set({ email: e.target.value })} /></Field>
            <Field label="Date Received"><input type="date" className={inputCls} value={f.dateReceived} onChange={e => set({ dateReceived: e.target.value })} /></Field>
          </div>
          {!isNew && <Field label="Batch Status"><select className={inputCls} value={f.status} onChange={e => set({ status: e.target.value as any })}><option value="active">Active</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></Field>}
          <label className="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300 pt-1">
            <input type="checkbox" className="mt-0.5" checked={isPrivateBatch(f)} onChange={e => set({ private: e.target.checked })} />
            <span>Private batch — for store/personal repairs, not a wholesale client. Each device ticket under a private batch can individually opt in to being added to inventory.</span>
          </label>
          <Field label="Notes"><textarea rows={2} className={inputCls} value={f.notes || ''} onChange={e => set({ notes: e.target.value })} /></Field>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={requestClose} className="px-4 py-2 text-sm text-slate-500">Cancel</button>
          <button onClick={() => f.companyName.trim() && onSave(f)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">Save Batch</button>
        </div>
      </div>
    </div>
  );
};
