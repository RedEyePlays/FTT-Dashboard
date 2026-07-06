import React, { useState, useMemo } from 'react';
import {
  Wrench, Plus, Search, X, Trash2, Printer, FileText, Receipt, History as HistoryIcon,
  ArrowLeft, DollarSign, ChevronRight, Building2, User, Package,
} from 'lucide-react';
import { Repair, RepairBatch, Customer, AuditEntry, RepairStatus, RepairType, DeviceType } from '../types';
import {
  REPAIR_STATUSES, REPAIR_STATUS_LABEL, REPAIR_STATUS_CELL, COSMETIC_OPTIONS,
  balanceOwing, batchTotals, matchesRepair, matchesBatch,
} from '../domain/repairs';
import { newId } from '../domain/ids';
import { printRetailReceipt, printBatchIntake, printBatchInvoice, printBatchSummary } from '../services/repairPrint';

interface Props {
  repairs: Repair[];
  batches: RepairBatch[];
  customers: Customer[];
  auditLogs: AuditEntry[];
  canDelete: boolean;
  onGenerateRepairNumber: () => string;
  onGenerateBatchNumber: () => string;
  onSaveRepair: (r: Repair, prev?: Repair) => void;
  onDeleteRepair: (id: string) => void;
  onSaveBatch: (b: RepairBatch, prev?: RepairBatch) => void;
  onDeleteBatch: (id: string) => void;
  onRecordPayment: (b: RepairBatch, amount: number) => void;
  onPrintAudit: (entityType: string, id: string, doc: string) => void;
}

const DEVICE_TYPES: DeviceType[] = ['Phone', 'Tablet', 'Laptop', 'Console', 'Watch', 'Other'];
const today = () => new Date().toISOString().split('T')[0];
const money = (n?: number) => `$${(n || 0).toFixed(2)}`;
const deviceName = (r: Repair) => [r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device';

const inputCls = 'w-full px-2.5 py-1.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100 dark:[color-scheme:dark]';

const Field: React.FC<{ label: string; children: React.ReactNode; className?: string }> = ({ label, children, className }) => (
  <label className={`block ${className || ''}`}><span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</span>{children}</label>
);

const StatusPill: React.FC<{ value: RepairStatus; onChange?: (s: RepairStatus) => void }> = ({ value, onChange }) => (
  <select value={value} disabled={!onChange} onClick={e => e.stopPropagation()} onChange={e => onChange?.(e.target.value as RepairStatus)}
    className={`appearance-none cursor-pointer rounded px-2 py-0.5 text-[11px] font-semibold outline-none ${REPAIR_STATUS_CELL[value]}`}>
    {REPAIR_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
  </select>
);

export const RepairsView: React.FC<Props> = (props) => {
  const { repairs, batches, auditLogs, canDelete, onSaveRepair, onDeleteRepair, onSaveBatch, onDeleteBatch, onRecordPayment, onPrintAudit } = props;
  const [tab, setTab] = useState<'tickets' | 'batches'>('tickets');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RepairStatus>('all');
  const [drawer, setDrawer] = useState<{ repair: Repair; isNew: boolean } | null>(null);
  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  const [batchForm, setBatchForm] = useState<{ batch: RepairBatch; isNew: boolean } | null>(null);

  const retail = useMemo(() => repairs.filter(r => r.type === 'retail')
    .filter(r => (statusFilter === 'all' || r.status === statusFilter) && (!query || matchesRepair(r, query)))
    .sort((a, b) => b.createdAt - a.createdAt), [repairs, statusFilter, query]);

  const visibleBatches = useMemo(() => batches
    .filter(b => !query || matchesBatch(b, query))
    .sort((a, b) => b.createdAt - a.createdAt), [batches, query]);

  const openBatch = batches.find(b => b.id === openBatchId) || null;

  // --- creators ---
  const newRetail = (): Repair => ({ id: newId(), repairNumber: '', type: 'retail', createdAt: Date.now(), date: today(), issue: '', repairPrice: 0, status: 'received', warrantyDays: 90, deposit: 0 });
  const newDevice = (batchId: string): Repair => ({ id: newId(), repairNumber: '', type: 'wholesale', batchId, createdAt: Date.now(), date: today(), issue: '', repairPrice: 0, status: 'received' });
  const newBatch = (): RepairBatch => ({ id: newId(), batchNumber: '', createdAt: Date.now(), dateReceived: today(), companyName: '', status: 'active', amountPaid: 0 });

  const saveDrawer = (form: Repair) => {
    let next = form;
    if (drawer?.isNew && !next.repairNumber) next = { ...next, repairNumber: props.onGenerateRepairNumber() };
    onSaveRepair(next, drawer?.isNew ? undefined : drawer?.repair);
    setDrawer(null);
  };
  const saveBatch = (form: RepairBatch, isNew: boolean, prev?: RepairBatch) => {
    let next = form;
    if (isNew && !next.batchNumber) next = { ...next, batchNumber: props.onGenerateBatchNumber() };
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
              {tab === 'tickets'
                ? <button onClick={() => setDrawer({ repair: newRetail(), isNew: true })} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4" /> New Ticket</button>
                : <button onClick={() => setBatchForm({ batch: newBatch(), isNew: true })} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4" /> New Batch</button>}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5">
              {(['tickets', 'batches'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize ${tab === t ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400'}`}>
                  {t === 'tickets' ? 'Retail Tickets' : 'Wholesale Batches'}
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search repair #, customer, company, IMEI, phone, model…"
                className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </div>
            {tab === 'tickets' && (
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200">
                <option value="all">All statuses</option>
                {REPAIR_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            )}
          </div>
        </>
      )}

      {/* Retail tickets list */}
      {!openBatch && tab === 'tickets' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
          {retail.length === 0 ? <p className="text-sm text-slate-400 text-center py-12">No repair tickets.</p> : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {retail.map(r => (
                <div key={r.id} onClick={() => setDrawer({ repair: r, isNew: false })} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{deviceName(r)} <span className="font-mono text-xs text-slate-400 ml-1">{r.repairNumber}</span></p>
                    <p className="text-xs text-slate-400 truncate">{r.customerName || 'Walk-in'}{r.customerPhone ? ` · ${r.customerPhone}` : ''}{r.imei ? ` · ${r.imei}` : ''} · {r.date}</p>
                  </div>
                  <div className="text-right shrink-0"><p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{money(r.repairPrice)}</p>{balanceOwing(r) > 0 && <p className="text-[11px] text-rose-500">bal {money(balanceOwing(r))}</p>}</div>
                  <StatusPill value={r.status} onChange={s => onSaveRepair({ ...r, status: s }, r)} />
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
          onEditBatch={() => setBatchForm({ batch: openBatch, isNew: false })}
          onDeleteBatch={() => { onDeleteBatch(openBatch.id); setOpenBatchId(null); }}
          onRecordPayment={onRecordPayment}
          onPrint={(doc) => {
            const devices = repairs.filter(r => r.batchId === openBatch.id);
            if (doc === 'intake') printBatchIntake(openBatch, devices);
            if (doc === 'invoice') printBatchInvoice(openBatch, devices);
            if (doc === 'summary') printBatchSummary(openBatch, devices);
            onPrintAudit('repairBatch', openBatch.id, doc);
          }} />
      )}

      {/* Repair drawer (retail ticket OR wholesale device) */}
      {drawer && (
        <RepairDrawer key={drawer.repair.id} initial={drawer.repair} isNew={drawer.isNew} canDelete={canDelete}
          auditLogs={auditLogs}
          onClose={() => setDrawer(null)}
          onSave={saveDrawer}
          onDelete={() => { onDeleteRepair(drawer.repair.id); setDrawer(null); }}
          onPrint={(doc) => { printRetailReceipt(drawer.repair, doc); onPrintAudit('repair', drawer.repair.id, doc); }} />
      )}

      {/* Batch create/edit form */}
      {batchForm && (
        <BatchForm initial={batchForm.batch} isNew={batchForm.isNew}
          onClose={() => setBatchForm(null)}
          onSave={(b) => saveBatch(b, batchForm.isNew, batchForm.isNew ? undefined : batchForm.batch)} />
      )}
    </div>
  );
};

/* ---------------- Batch detail ---------------- */
const BatchDetail: React.FC<{
  batch: RepairBatch; repairs: Repair[]; canDelete: boolean;
  onBack: () => void; onAddDevice: () => void; onEditDevice: (r: Repair) => void;
  onStatus: (r: Repair, s: RepairStatus) => void; onEditBatch: () => void; onDeleteBatch: () => void;
  onRecordPayment: (b: RepairBatch, amount: number) => void; onPrint: (doc: 'intake' | 'invoice' | 'summary') => void;
}> = ({ batch, repairs, canDelete, onBack, onAddDevice, onEditDevice, onStatus, onEditBatch, onDeleteBatch, onRecordPayment, onPrint }) => {
  const devices = repairs.filter(r => r.batchId === batch.id).sort((a, b) => a.createdAt - b.createdAt);
  const t = batchTotals(batch, repairs);
  const [pay, setPay] = useState('');

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
        {[['Total Repairs', String(t.count)], ['Total Cost', money(t.totalCost)], ['Amount Paid', money(t.amountPaid)], ['Remaining', money(t.remaining)]].map(([k, v], i) => (
          <div key={k} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{k}</p>
            <p className={`text-lg font-bold ${i === 3 && t.remaining > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{v}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={onAddDevice} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Plus className="w-4 h-4" /> Add Device</button>
        <button onClick={() => onPrint('intake')} className="flex items-center gap-2 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:border-indigo-400"><FileText className="w-4 h-4" /> Intake Sheet</button>
        <button onClick={() => onPrint('invoice')} className="flex items-center gap-2 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:border-indigo-400"><Receipt className="w-4 h-4" /> Invoice</button>
        <button onClick={() => onPrint('summary')} className="flex items-center gap-2 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:border-indigo-400"><Printer className="w-4 h-4" /> Summary</button>
        <div className="flex items-center gap-1 ml-auto">
          <div className="relative"><DollarSign className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" /><input value={pay} onChange={e => setPay(e.target.value)} placeholder="0.00" inputMode="decimal" className="w-24 pl-7 pr-2 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg" /></div>
          <button onClick={() => { const a = parseFloat(pay) || 0; if (a > 0) { onRecordPayment(batch, a); setPay(''); } }} className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium">Record Payment</button>
        </div>
      </div>

      {/* Devices table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            <tr><th className="text-left px-4 py-2">#</th><th className="text-left px-4 py-2">Device</th><th className="text-left px-4 py-2">IMEI/Serial</th><th className="text-left px-4 py-2">Issue</th><th className="text-left px-4 py-2">Status</th><th className="text-right px-4 py-2">Price</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {devices.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">No devices in this batch yet.</td></tr>}
            {devices.map((r, idx) => (
              <tr key={r.id} onClick={() => onEditDevice(r)} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer">
                <td className="px-4 py-2 text-slate-400">{idx + 1}</td>
                <td className="px-4 py-2 font-medium text-slate-800 dark:text-slate-100">{deviceName(r)}</td>
                <td className="px-4 py-2 text-slate-500 dark:text-slate-400 font-mono text-xs">{r.imei || '—'}</td>
                <td className="px-4 py-2 text-slate-500 dark:text-slate-400 truncate max-w-[200px]">{r.issue || '—'}</td>
                <td className="px-4 py-2"><StatusPill value={r.status} onChange={s => onStatus(r, s)} /></td>
                <td className="px-4 py-2 text-right font-medium text-slate-800 dark:text-slate-100">{money(r.repairPrice)}</td>
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
  initial: Repair; isNew: boolean; canDelete: boolean; auditLogs: AuditEntry[];
  onClose: () => void; onSave: (r: Repair) => void; onDelete: () => void; onPrint: (doc: 'intake' | 'repair' | 'pickup') => void;
}> = ({ initial, isNew, canDelete, auditLogs, onClose, onSave, onDelete, onPrint }) => {
  const [f, setF] = useState<Repair>(initial);
  const set = (patch: Partial<Repair>) => setF(prev => ({ ...prev, ...patch }));
  const isRetail = f.type === 'retail';
  const history = auditLogs.filter(a => a.entityId === f.id).slice(0, 20);
  const toggleCosmetic = (opt: string) => set({ cosmetic: { checks: (f.cosmetic?.checks || []).includes(opt) ? (f.cosmetic!.checks).filter(c => c !== opt) : [...(f.cosmetic?.checks || []), opt], notes: f.cosmetic?.notes } });
  const num = (v: string) => parseFloat(v) || 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg h-full bg-white dark:bg-slate-900 shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{isNew ? (isRetail ? 'New Repair Ticket' : 'Add Device') : (isRetail ? 'Repair Ticket' : 'Device')}{f.repairNumber && <span className="font-mono text-xs text-slate-400 ml-2">{f.repairNumber}</span>}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
          {/* Status */}
          <Field label="Status"><div className="mt-1"><StatusPill value={f.status} onChange={s => set({ status: s })} /></div></Field>

          {isRetail && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Customer"><input className={inputCls} value={f.customerName || ''} onChange={e => set({ customerName: e.target.value })} /></Field>
              <Field label="Phone"><input className={inputCls} value={f.customerPhone || ''} onChange={e => set({ customerPhone: e.target.value })} /></Field>
              <Field label="Email (optional)" className="col-span-2"><input className={inputCls} value={f.customerEmail || ''} onChange={e => set({ customerEmail: e.target.value })} /></Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Device Type"><select className={inputCls} value={f.deviceType || ''} onChange={e => set({ deviceType: e.target.value as DeviceType })}><option value="">—</option>{DEVICE_TYPES.map(d => <option key={d} value={d}>{d}</option>)}</select></Field>
            <Field label="Brand"><input className={inputCls} value={f.brand || ''} onChange={e => set({ brand: e.target.value })} /></Field>
            <Field label="Model"><input className={inputCls} value={f.model || ''} onChange={e => set({ model: e.target.value })} /></Field>
            <Field label="IMEI / Serial"><input className={inputCls} value={f.imei || ''} onChange={e => set({ imei: e.target.value })} /></Field>
            {isRetail && <>
              <Field label="Storage"><input className={inputCls} value={f.storage || ''} onChange={e => set({ storage: e.target.value })} /></Field>
              <Field label="Color"><input className={inputCls} value={f.color || ''} onChange={e => set({ color: e.target.value })} /></Field>
              <Field label="Carrier (optional)"><input className={inputCls} value={f.carrier || ''} onChange={e => set({ carrier: e.target.value })} /></Field>
              <Field label="Passcode (optional)"><input className={inputCls} value={f.passcode || ''} onChange={e => set({ passcode: e.target.value })} /></Field>
            </>}
          </div>

          <Field label="Issue Description"><textarea rows={2} className={inputCls} value={f.issue} onChange={e => set({ issue: e.target.value })} /></Field>

          {isRetail && (
            <div>
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">Cosmetic Condition</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {COSMETIC_OPTIONS.map(opt => {
                  const on = (f.cosmetic?.checks || []).includes(opt);
                  return <button key={opt} type="button" onClick={() => toggleCosmetic(opt)} className={`px-2 py-1 rounded-md text-xs border ${on ? 'bg-indigo-100 border-indigo-300 text-indigo-700 dark:bg-indigo-900/40 dark:border-indigo-700 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'}`}>{opt}</button>;
                })}
              </div>
              <input className={`${inputCls} mt-2`} placeholder="Cosmetic notes (optional)" value={f.cosmetic?.notes || ''} onChange={e => set({ cosmetic: { checks: f.cosmetic?.checks || [], notes: e.target.value } })} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Repair Price"><input type="number" min="0" step="0.01" className={inputCls} value={f.repairPrice} onChange={e => set({ repairPrice: num(e.target.value) })} /></Field>
            {isRetail && <Field label="Deposit"><input type="number" min="0" step="0.01" className={inputCls} value={f.deposit ?? 0} onChange={e => set({ deposit: num(e.target.value) })} /></Field>}
            {isRetail && <Field label="Balance Owing"><input readOnly className={`${inputCls} opacity-70`} value={money(balanceOwing(f))} /></Field>}
            {isRetail && <Field label="Warranty (days)"><input type="number" min="0" className={inputCls} value={f.warrantyDays ?? 0} onChange={e => set({ warrantyDays: num(e.target.value) })} /></Field>}
            {isRetail && <Field label="Est. Completion"><input type="date" className={inputCls} value={f.estimatedCompletion || ''} onChange={e => set({ estimatedCompletion: e.target.value })} /></Field>}
          </div>

          <div className="grid grid-cols-1 gap-3">
            <Field label="Internal Notes"><textarea rows={2} className={inputCls} value={f.internalNotes || ''} onChange={e => set({ internalNotes: e.target.value })} /></Field>
            {isRetail && <Field label="Customer Notes"><textarea rows={2} className={inputCls} value={f.customerNotes || ''} onChange={e => set({ customerNotes: e.target.value })} /></Field>}
          </div>

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

        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2">
          <button onClick={() => onSave(f)} className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">Save</button>
          {isRetail && !isNew && (
            <div className="flex items-center gap-1">
              <button onClick={() => onPrint('intake')} title="Intake receipt" className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 hover:border-indigo-400"><FileText className="w-4 h-4" /></button>
              <button onClick={() => onPrint('repair')} title="Repair receipt" className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 hover:border-indigo-400"><Receipt className="w-4 h-4" /></button>
              <button onClick={() => onPrint('pickup')} title="Pickup receipt" className="p-2 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 hover:border-indigo-400"><Printer className="w-4 h-4" /></button>
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
  const set = (patch: Partial<RepairBatch>) => setF(prev => ({ ...prev, ...patch }));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{isNew ? 'New Wholesale Batch' : 'Edit Batch'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <Field label="Company Name"><input className={inputCls} value={f.companyName} onChange={e => set({ companyName: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact Person"><input className={inputCls} value={f.contactPerson || ''} onChange={e => set({ contactPerson: e.target.value })} /></Field>
            <Field label="Phone"><input className={inputCls} value={f.phone || ''} onChange={e => set({ phone: e.target.value })} /></Field>
            <Field label="Email"><input className={inputCls} value={f.email || ''} onChange={e => set({ email: e.target.value })} /></Field>
            <Field label="Date Received"><input type="date" className={inputCls} value={f.dateReceived} onChange={e => set({ dateReceived: e.target.value })} /></Field>
          </div>
          {!isNew && <Field label="Batch Status"><select className={inputCls} value={f.status} onChange={e => set({ status: e.target.value as any })}><option value="active">Active</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></Field>}
          <Field label="Notes"><textarea rows={2} className={inputCls} value={f.notes || ''} onChange={e => set({ notes: e.target.value })} /></Field>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-500">Cancel</button>
          <button onClick={() => f.companyName.trim() && onSave(f)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">Save Batch</button>
        </div>
      </div>
    </div>
  );
};
