import React, { useState } from 'react';
import {
  Truck, Users, CalendarCheck, Plus, X, Trash2, Phone, User, Package,
  CheckCircle, XCircle, Wallet, ClipboardList, FileText, QrCode, Pencil,
  Archive, Search, ChevronDown, ChevronRight,
} from 'lucide-react';
import { CashReconciliation, DeviceBuyer, DropOff, DropOffStatus, PaidBy, Settlement, SettlementPaymentMethod } from '../types';
import { deviceBuyerOutstanding, settleableDropOffs, settlementTotals, SettlementReviewLine, buildSettlementFromReview, settlementOwedLabel, isLegacySettlement, LEGACY_SETTLEMENT_NOTE, dropOffOwed, PAID_BY_LABEL, groupSettleableByWeek, defaultSettlementWeek, SettlementWeek } from '../domain/dropoffs';
import { formatPhoneInput } from '../domain/phone';
import { printSettlementInvoice } from '../services/settlementInvoice';
import { dropOffLabelContent, printDropOffLabels } from '../services/dropOffLabel';
import { selectedLabelMedia } from '../services/labelLayout';
import { getStoreProfile, getLabelSizes, getLabelSpacing } from './SettingsModal';
import {
  ACTIVE_DROPOFF_STATUSES, activeDropOffs, historyDropOffs, groupSettledBySettlement,
  rejectedHistory, buyerNameFrom, HistoryFilter,
} from '../domain/dropOffHistory';
import { SettlementReviewModal } from './SettlementReviewModal';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { todayISO, weekEndingSaturday } from '../domain/dates';
import { useSubmitGuard, useKeyedSubmitGuard } from '../hooks/useSubmitGuard';

interface Props {
  deviceBuyers: DeviceBuyer[];
  dropOffs: DropOff[];
  settlements: Settlement[];
  onDeviceBuyersChange: (r: DeviceBuyer[]) => void;
  onDropOffsChange: (d: DropOff[]) => void;
  // Records one completed settlement (writes the record, marks its drop-offs
  // settled, and — for a cash payment only — logs the cash-drawer effect).
  onSettle: (settlement: Settlement, opts?: { cashDate?: string }) => void;
  // Read-only: used to warn before a BACKDATED settlement's cash entry lands
  // on a day that has already been counted and closed.
  cashReconciliations?: CashReconciliation[];
  // Whether this user may print drop-off device labels. Those labels carry the
  // purchase price and the service fee, so printing is gated to the same
  // permission that already exposes drop-off financials (services/
  // dropOffLabel.ts's canPrintDropOffLabel → 'dropoffs.manage'). Off by
  // default, so a caller that forgets to pass it shows no button rather than
  // silently leaking cost figures onto paper.
  canPrintLabels?: boolean;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => todayISO();
const money = (n: number) => `$${n.toFixed(2)}`;

// How the purchase was funded (PAID_BY_LABEL, imported from domain/dropoffs.ts):
// the store never buys the device — it either advances the money (and is owed
// it back) or it doesn't (see types.ts's PaidBy; 'runner' is the legacy stored
// value for buyer-funded). The wording lives with the model so this screen, the
// settlement invoice and the printed drop-off label can't drift apart.

// Print labels for the given drop-off devices — one print job, the shared
// label system, the configured label stock and content-spacing settings.
const printLabels = (ds: DropOff[], deviceBuyers: DeviceBuyer[]) => {
  const store = getStoreProfile().storeName;
  const byId = new Map(deviceBuyers.map(b => [b.id, b]));
  const spacing = getLabelSpacing();
  return printDropOffLabels(
    ds.map(d => dropOffLabelContent(d, byId.get(d.buyerId), store)),
    selectedLabelMedia(getLabelSizes()),
    { padMm: spacing.paddingMm, lineGapMm: spacing.lineGapMm },
  );
};

// Devices still on the hook for a buyer — what a batch label run covers.
// Same states settleableDropOffs uses (accepted / paid out), plus 'pending':
// a device that just came through the door is exactly the one that most needs
// a physical tag on it.
const labelableDropOffs = (ds: DropOff[]): DropOff[] =>
  ds.filter(d => d.status === 'pending' || d.status === 'accepted' || d.status === 'paidout');

const STATUS_META: Record<DropOffStatus, { label: string; cls: string }> = {
  pending:  { label: 'Pending review', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  accepted: { label: 'Accepted',       cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  rejected: { label: 'Rejected',       cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
  paidout:  { label: 'Paid out',       cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  settled:  { label: 'Settled',        cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
};

export const DropOffView: React.FC<Props> = ({
  deviceBuyers, dropOffs, settlements, onDeviceBuyersChange, onDropOffsChange, onSettle,
  cashReconciliations, canPrintLabels = false,
}) => {
  const [tab, setTab] = useState<'entries' | 'deviceBuyers' | 'settlement' | 'history'>('entries');

  const tabBtn = (id: typeof tab, icon: React.ReactNode, label: string) => (
    <button
      onClick={() => setTab(id)}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        tab === id
          ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:ring-indigo-700'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800'
      }`}
    >
      {icon}{label}
    </button>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Truck className="w-6 h-6 text-indigo-500" /> Drop-Off / Device Buyers
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">The store finances the device buyer: it advances the purchase money (or doesn't) and charges a service fee. The buyer keeps the device and owes the store principal + fee at settlement.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabBtn('entries', <Package className="w-4 h-4" />, 'Drop-Offs')}
        {tabBtn('deviceBuyers', <Users className="w-4 h-4" />, 'Device Buyers')}
        {tabBtn('settlement', <CalendarCheck className="w-4 h-4" />, 'Saturday Settlement')}
        {/* Closed drop-offs live here, not in the working list — see
            domain/dropOffHistory.ts. Nothing is deleted; this is where it
            goes to be looked up rather than scrolled past. */}
        {tabBtn('history', <Archive className="w-4 h-4" />, 'History')}
      </div>

      {tab === 'entries' && (
        <EntriesTab deviceBuyers={deviceBuyers} dropOffs={dropOffs} onDropOffsChange={onDropOffsChange} canPrintLabels={canPrintLabels} />
      )}
      {tab === 'deviceBuyers' && (
        <DeviceBuyersTab deviceBuyers={deviceBuyers} dropOffs={dropOffs} onDeviceBuyersChange={onDeviceBuyersChange} canPrintLabels={canPrintLabels} />
      )}
      {tab === 'settlement' && (
        <SettlementTab deviceBuyers={deviceBuyers} dropOffs={dropOffs} settlements={settlements} onSettle={onSettle} cashReconciliations={cashReconciliations} />
      )}
      {tab === 'history' && (
        <HistoryTab deviceBuyers={deviceBuyers} dropOffs={dropOffs} settlements={settlements} />
      )}
    </div>
  );
};

/* ---------------- Drop-off entries ---------------- */

const EntriesTab: React.FC<{
  deviceBuyers: DeviceBuyer[]; dropOffs: DropOff[];
  onDropOffsChange: (d: DropOff[]) => void;
  canPrintLabels: boolean;
}> = ({ deviceBuyers, dropOffs, onDropOffsChange, canPrintLabels }) => {
  const [showForm, setShowForm] = useState(false);
  // Set to the drop-off being edited, or null for the "New Drop-Off" case —
  // the same modal/form serves both, since every field a new entry collects
  // is also one that might need correcting later (wrong price, wrong buyer,
  // a typo in the IMEI). App.tsx's saveDropOffs already diffs the whole array
  // and only re-logs a drawer effect on an actual pending→accepted
  // transition, so editing an already-accepted drop-off's other fields never
  // double-logs cash — see its comment.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Only ever an ACTIVE status (or 'all' within them). Settled and rejected
  // drop-offs are not reachable from here at all — they live in the History
  // tab (domain/dropOffHistory.ts). Before this the filter defaulted to 'all'
  // over EVERY status, so closed drop-offs from months back sat in the middle
  // of the ones still owed for.
  const [filter, setFilter] = useState<DropOffStatus | 'all'>('all');
  // Accept moves real cash (dropOffAcceptDrawerEffect, logged in App.tsx's
  // saveDropOffs) — keyed per-row so a double-tap on one drop-off's Accept
  // can't double-log the cash, without freezing every other row's buttons
  // while one is in flight.
  const { isPending: rowPending, run: runRow } = useKeyedSubmitGuard();

  const closeForm = () => { setShowForm(false); setEditingId(null); };
  useEscapeKey(closeForm, showForm);

  const blank = (): DropOff => ({
    id: uid(), buyerId: deviceBuyers[0]?.id || '', item: '', imei: '',
    sellerName: '', sellerContact: '', purchasePrice: 0, paidBy: 'runner',
    dropOffFee: 0, dateDropped: today(), status: 'pending', notes: '',
  });
  const [form, setForm] = useState<DropOff>(blank());

  const set = <K extends keyof DropOff>(k: K, v: DropOff[K]) => setForm(f => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.buyerId || !form.item) return;
    if (editingId) onDropOffsChange(dropOffs.map(d => d.id === editingId ? { ...form, id: editingId } : d));
    else onDropOffsChange([...dropOffs, form]);
    setForm(blank());
    setShowForm(false);
    setEditingId(null);
  };

  const update = (id: string, patch: Partial<DropOff>) =>
    onDropOffsChange(dropOffs.map(d => d.id === id ? { ...d, ...patch } : d));
  const remove = (id: string) => onDropOffsChange(dropOffs.filter(d => d.id !== id));
  const openEdit = (d: DropOff) => { setForm(d); setEditingId(d.id); setShowForm(true); };

  const buyerName = (id: string) => deviceBuyers.find(r => r.id === id)?.name || 'Unknown';
  const active = activeDropOffs(dropOffs);
  const shown = filter === 'all' ? active : active.filter(d => d.status === filter);
  const closedCount = dropOffs.length - active.length;

  const inp = 'w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500';
  const lbl = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 flex-wrap">
          {(['all', ...ACTIVE_DROPOFF_STATUSES] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium ${filter === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
              {s === 'all' ? 'All active' : STATUS_META[s].label}
            </button>
          ))}
        </div>
        <button onClick={() => { setForm(blank()); setEditingId(null); setShowForm(true); }} disabled={deviceBuyers.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium">
          <Plus className="w-4 h-4" /> New Drop-Off
        </button>
      </div>

      {deviceBuyers.length === 0 && (
        <div className="text-center text-slate-400 text-sm py-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          Add a device buyer first (DeviceBuyers tab) before logging drop-offs.
        </div>
      )}

      {deviceBuyers.length > 0 && shown.length === 0 && (
        <div className="text-center text-slate-400 text-sm py-8">
          No active drop-offs to show.
          {closedCount > 0 && <> {closedCount} settled or rejected drop-off{closedCount !== 1 ? 's are' : ' is'} in the History tab.</>}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {shown.map(d => (
          <div key={d.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{d.item}</p>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_META[d.status].cls}`}>{STATUS_META[d.status].label}</span>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {buyerName(d.buyerId)} · {d.imei || 'No IMEI'} · {d.dateDropped}
                  {d.sellerName && ` · seller: ${d.sellerName}`}
                </p>
                <div className="flex gap-4 mt-2 text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Purchase: <b className="text-slate-700 dark:text-slate-200">{money(d.purchasePrice)}</b></span>
                  <span className="text-slate-500 dark:text-slate-400">Paid by: <b className="text-slate-700 dark:text-slate-200">{PAID_BY_LABEL[d.paidBy] || 'Store paid'}</b></span>
                  <span className="text-slate-500 dark:text-slate-400">Service fee: <b className="text-emerald-600">{money(d.dropOffFee)}</b></span>
                  <span className="text-slate-500 dark:text-slate-400">Buyer owes: <b className="text-indigo-600 dark:text-indigo-400">{money(dropOffOwed(d))}</b></span>
                </div>
                {d.notes && <p className="text-xs text-slate-400 mt-1 italic">{d.notes}</p>}
              </div>
              <button onClick={() => remove(d.id)} className="text-slate-400 hover:text-rose-500 p-1 shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              {/* Print this one device's label — the physical tag that goes on
                  the device. Mirrors the inventory row's "Print Shelf Tag"
                  action (components/InventoryView.tsx). Hidden entirely
                  without 'dropoffs.manage': the label prints cost/fee. */}
              {canPrintLabels && (
                <button onClick={() => printLabels([d], deviceBuyers)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700">
                  <QrCode className="w-3.5 h-3.5" /> Print Label
                </button>
              )}
              <button onClick={() => openEdit(d)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </button>
              {d.status === 'pending' && (
                <>
                  <button onClick={() => runRow(`accept:${d.id}`, () => update(d.id, { status: 'accepted' }))}
                    disabled={rowPending(`accept:${d.id}`)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 hover:bg-indigo-100 disabled:opacity-40">
                    <CheckCircle className="w-3.5 h-3.5" /> {rowPending(`accept:${d.id}`) ? 'Accepting…' : 'Accept'}
                  </button>
                  <button onClick={() => update(d.id, { status: 'rejected' })} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 hover:bg-rose-100">
                    <XCircle className="w-3.5 h-3.5" /> Reject / Return
                  </button>
                </>
              )}
              {/* No "Add to Inventory" action: a financed drop-off is the
                  BUYER's device, not store stock — adding it would pollute
                  inventory value, COGS and profit. Devices the store genuinely
                  buys outright go through Quick Purchase instead. Historical
                  drop-offs that were added to stock under the old model keep
                  showing their badge; nothing stored was changed. */}
              {d.inventoryId && (
                <span className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500"
                  title="Added to store stock under the prior model, before drop-offs were understood as financing.">
                  <Package className="w-3.5 h-3.5" /> In inventory (prior model)
                </span>
              )}
              {(d.status === 'accepted' || d.status === 'paidout') && (
                <select value={d.status} onChange={e => update(d.id, { status: e.target.value as DropOffStatus })}
                  className="px-2 py-1.5 rounded-lg text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                  <option value="accepted">Accepted</option>
                  <option value="paidout">Paid out</option>
                </select>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* New / edit drop-off modal — same form serves both (see editingId above). */}
      {showForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={closeForm}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <h2 className="font-bold text-slate-800 dark:text-slate-100">{editingId ? 'Edit Drop-Off' : 'New Drop-Off'}</h2>
              <button onClick={closeForm}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={lbl}>Device Buyer *</label>
                <select autoFocus className={inp} value={form.buyerId} onChange={e => set('buyerId', e.target.value)}>
                  {deviceBuyers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <label className={lbl}>Device / Item *</label>
                <input className={inp} value={form.item} onChange={e => set('item', e.target.value)} placeholder="e.g. iPhone 13 128GB" />
              </div>
              <div>
                <label className={lbl}>IMEI / Serial</label>
                <input className={inp} value={form.imei} onChange={e => set('imei', e.target.value)} />
              </div>
              <div>
                <label className={lbl}>Date Dropped</label>
                <input type="date" className={inp} value={form.dateDropped} onChange={e => set('dateDropped', e.target.value)} />
              </div>
              <div>
                <label className={lbl}>Seller Name</label>
                <input className={inp} value={form.sellerName} onChange={e => set('sellerName', e.target.value)} />
              </div>
              <div>
                <label className={lbl}>Seller Contact</label>
                <input className={inp} value={form.sellerContact} onChange={e => set('sellerContact', e.target.value)} />
              </div>
              <div>
                <label className={lbl}>Purchase Price ($)</label>
                <input type="number" step="0.01" className={inp} value={form.purchasePrice} onChange={e => set('purchasePrice', parseFloat(e.target.value) || 0)} />
              </div>
              <div>
                <label className={lbl}>Service Fee ($)</label>
                <input type="number" step="0.01" className={inp} value={form.dropOffFee} onChange={e => set('dropOffFee', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="col-span-2">
                <label className={lbl}>Who funded the purchase?</label>
                <div className="flex gap-2">
                  {(['runner', 'store', 'personal'] as PaidBy[]).map(p => (
                    <button key={p} type="button" onClick={() => set('paidBy', p)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border ${form.paidBy === p ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                      {PAID_BY_LABEL[p]}
                    </button>
                  ))}
                </div>
                {/* dropOffAcceptDrawerEffect (domain/dropoffs.ts) only logs a
                    cash-out for paidBy === 'store' — buyer-funded and
                    'personal' never touch the drawer. Spelled out here so it
                    doesn't depend on staff already knowing that rule. */}
                {form.paidBy === 'store' && form.purchasePrice > 0 && (!editingId || form.status === 'pending') && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">Accepting logs a ${form.purchasePrice.toFixed(2)} cash-out today. The buyer owes that back plus the ${form.dropOffFee.toFixed(2)} service fee at settlement.</p>
                )}
                {form.paidBy === 'store' && editingId && form.status !== 'pending' && (
                  <p className="text-[11px] text-slate-400 mt-1.5">This drop-off was already accepted — changing the price here does not adjust the cash-out already logged for it.</p>
                )}
                {form.paidBy === 'runner' && (
                  <p className="text-[11px] text-slate-400 mt-1.5">The buyer used his own money for his own device — no drawer movement, and he owes the store the service fee only.</p>
                )}
                {form.paidBy === 'personal' && (
                  <p className="text-[11px] text-slate-400 mt-1.5">Owner paid out of pocket — never touches the store's cash drawer. The buyer still owes the purchase price back (to the owner) plus the service fee (to the store).</p>
                )}
              </div>
              <div className="col-span-2">
                <label className={lbl}>Notes</label>
                <input className={inp} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button onClick={closeForm} className="px-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={save} disabled={!form.buyerId || !form.item} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium">{editingId ? 'Save Changes' : 'Save Drop-Off'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ---------------- DeviceBuyers ---------------- */

const DeviceBuyersTab: React.FC<{
  deviceBuyers: DeviceBuyer[]; dropOffs: DropOff[];
  onDeviceBuyersChange: (r: DeviceBuyer[]) => void;
  canPrintLabels: boolean;
}> = ({ deviceBuyers, dropOffs, onDeviceBuyersChange, canPrintLabels }) => {
  const [form, setForm] = useState<DeviceBuyer>({ id: '', name: '', phone: '', notes: '' });
  const [editing, setEditing] = useState(false);

  const save = () => {
    if (!form.name) return;
    if (editing) onDeviceBuyersChange(deviceBuyers.map(r => r.id === form.id ? form : r));
    else onDeviceBuyersChange([...deviceBuyers, { ...form, id: uid() }]);
    setForm({ id: '', name: '', phone: '', notes: '' });
    setEditing(false);
  };
  const edit = (r: DeviceBuyer) => { setForm(r); setEditing(true); };
  const remove = (id: string) => onDeviceBuyersChange(deviceBuyers.filter(r => r.id !== id));

  const inp = 'w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500';

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Form */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 h-fit">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-3">{editing ? 'Edit DeviceBuyer' : 'Add DeviceBuyer'}</h3>
        <div className="space-y-3">
          <div className="relative">
            <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className={`${inp} pl-9`} placeholder="Device buyer name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="relative">
            <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input type="tel" className={`${inp} pl-9`} placeholder="Phone number" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: formatPhoneInput(e.target.value) }))} />
          </div>
          <textarea className={inp} rows={2} placeholder="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          <div className="flex gap-2">
            <button onClick={save} disabled={!form.name} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium">{editing ? 'Save Changes' : 'Add DeviceBuyer'}</button>
            {editing && <button onClick={() => { setForm({ id: '', name: '', phone: '', notes: '' }); setEditing(false); }} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-sm">Cancel</button>}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {deviceBuyers.length === 0 && <p className="text-slate-400 text-sm text-center py-8">No deviceBuyers yet.</p>}
        {deviceBuyers.map(r => {
          const bal = deviceBuyerOutstanding(r.id, dropOffs);
          return (
            <div key={r.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{r.name}</p>
                  {r.phone && <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3" />{r.phone}</p>}
                  {r.notes && <p className="text-xs text-slate-400 mt-1 italic">{r.notes}</p>}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => edit(r)} className="text-slate-400 hover:text-indigo-500 text-xs px-2 py-1">Edit</button>
                  <button onClick={() => remove(r.id)} className="text-slate-400 hover:text-rose-500 p-1"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
              {/* The outstanding receivable — real money on the street
                  between accepting a drop-off and settling it. Principal and
                  fee stay two separate figures: only the fee is profit. */}
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-center">
                <div><p className="text-[10px] text-slate-400 uppercase">Principal Outstanding</p><p className="font-bold text-slate-700 dark:text-slate-200 text-sm">{money(bal.principalOwed)}</p></div>
                <div><p className="text-[10px] text-slate-400 uppercase">Service Fees Outstanding</p><p className="font-bold text-emerald-600 text-sm">{money(bal.feesOwed)}</p></div>
                <div><p className="text-[10px] text-slate-400 uppercase">Total Owed To Store</p><p className="font-bold text-indigo-600 dark:text-indigo-400 text-sm">{money(bal.totalOwed)}</p></div>
              </div>
              <p className="text-[10px] text-slate-400 text-center mt-1">
                {bal.count} unsettled drop-off{bal.count !== 1 ? 's' : ''}
                {bal.principalPersonalFunded > 0 && ` · ${money(bal.principalPersonalFunded)} of the principal was owner-funded (repays the owner, not the till)`}
              </p>
              {/* Batch: tag every device still on the hook for this buyer in
                  ONE print job (same pattern as InventoryView's bulk
                  "Print Shelf Tags"), rather than one popup per device. */}
              {canPrintLabels && labelableDropOffs(dropOffs.filter(d => d.buyerId === r.id)).length > 0 && (
                <button onClick={() => printLabels(labelableDropOffs(dropOffs.filter(d => d.buyerId === r.id)), deviceBuyers)}
                  className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700">
                  <QrCode className="w-3.5 h-3.5" /> Print Device Labels ({labelableDropOffs(dropOffs.filter(d => d.buyerId === r.id)).length})
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ---------------- Saturday settlement ---------------- */

const PAYMENT_METHODS: { value: SettlementPaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' }, { value: 'etransfer', label: 'E-Transfer' }, { value: 'other', label: 'Other' },
];

const SettlementTab: React.FC<{
  deviceBuyers: DeviceBuyer[]; dropOffs: DropOff[]; settlements: Settlement[];
  onSettle: (settlement: Settlement, opts?: { cashDate?: string }) => void;
  cashReconciliations?: CashReconciliation[];
}> = ({ deviceBuyers, dropOffs, settlements, onSettle, cashReconciliations }) => {
  const [buyerId, setBuyerId] = useState(deviceBuyers[0]?.id || '');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<SettlementPaymentMethod>('cash');
  // Which weeks this run covers. Empty = every pending week (the old
  // behaviour, now an explicit choice rather than the only option).
  const [weekFilter, setWeekFilter] = useState<string>('');
  // The week this settlement is FOR, and the day it is actually being done —
  // two different facts once a Saturday has been missed.
  const [periodEnd, setPeriodEnd] = useState('');
  const [settledOn, setSettledOn] = useState(today());
  // The day the cash physically changed hands, which drives which drawer
  // record the cash-in lands on.
  const [cashDate, setCashDate] = useState(today());
  // A double-tap on "Confirm Settlement" (in the review modal) before
  // `dropOffs` reflects the first settlement (async — the live subscription
  // hasn't refreshed yet) would otherwise settle — and pay — the same device buyer
  // twice for the same batch. This guard wraps the actual commit regardless
  // of whether it's reached via the review modal or (hypothetically) some
  // other path, so reviewing/printing can never create a way around it.
  const { isSubmitting, run } = useSubmitGuard();
  // Review screen state: open + a stable settlement id generated once when
  // opened, reused by both the pre-commit print preview (inside the modal)
  // and the final commit below, so the invoice a device buyer checks before
  // agreeing and the one re-printable from history afterward are the exact
  // same settlement id.
  const [reviewing, setReviewing] = useState(false);
  const [reviewSettlementId, setReviewSettlementId] = useState('');
  const storeName = getStoreProfile().storeName;

  // Everything accepted/paid-out & not yet settled/rejected for this buyer,
  // grouped into the settlement weeks it was dropped in. Before this the
  // pending list lumped every date together, so a missed Saturday simply
  // piled onto the next one with no way to see it or settle it separately.
  const allPending = settleableDropOffs(buyerId, dropOffs);
  const weeks = groupSettleableByWeek(allPending);
  // What this run actually covers: one chosen week, or all of them.
  const pending = weekFilter
    ? (weeks.find(w => w.weekEnding === weekFilter)?.dropOffs || [])
    : allPending;
  const totals = settlementTotals(pending);

  // Reset the week/date fields whenever the buyer changes — another buyer's
  // weeks have nothing to do with this one's.
  const [loadedBuyer, setLoadedBuyer] = useState<string | null>(null);
  if (loadedBuyer !== buyerId) {
    setLoadedBuyer(buyerId);
    setWeekFilter('');
    setPeriodEnd(defaultSettlementWeek(groupSettleableByWeek(settleableDropOffs(buyerId, dropOffs))));
    setSettledOn(today());
    setCashDate(today());
  }

  // Backdating the cash to a day that was already counted and closed changes
  // that day's expected cash after the fact. Allowed — sometimes it is simply
  // what happened — but never silently.
  const cashDayClosed = !!cashReconciliations?.find(r => r.date === cashDate)?.reconciledAt;
  const touchesDrawer = paymentMethod === 'cash' && Math.abs(totals.storeCashIn) >= 0.005;

  const openReview = () => {
    if (pending.length === 0) return;
    setReviewSettlementId(uid());
    setReviewing(true);
  };

  // Settle one week straight from its section: scope the run to that week and
  // pre-fill the week-ending field with it, then open the usual review screen
  // so nothing skips the check-and-confirm step.
  const settleWeek = (w: SettlementWeek) => {
    setWeekFilter(w.weekEnding);
    if (w.weekEnding) setPeriodEnd(w.weekEnding);
    setReviewSettlementId(uid());
    setReviewing(true);
  };

  const confirmSettlement = (lines: SettlementReviewLine[], adjustmentAmount: number, adjustmentNote: string) => {
    if (touchesDrawer && cashDayClosed && !window.confirm(
      `${cashDate} has already been counted and closed.\n\nLogging this settlement's cash against it will CHANGE that closed day's expected cash, and the day will no longer match the count that was signed off on it.\n\nContinue?`,
    )) return;
    run(() => {
      const settlement = buildSettlementFromReview(
        { id: reviewSettlementId, buyerId, date: settledOn, periodEnd: periodEnd || undefined, paymentMethod, notes },
        pending, lines, adjustmentAmount, adjustmentNote,
      );
      // onSettle (App.tsx's handleSettleDeviceBuyer → services/firestoreDb.ts's
      // settleDeviceBuyer) saves the settlement AND flags every drop-off in
      // dropOffIds 'settled' in one atomic batch — a separate onDropOffsChange
      // call here would be a second, untracked write racing the same status
      // transition, exactly the gap that let a device buyer's drop-offs stay eligible
      // for a second settlement. Anything excluded on the review screen is
      // simply never in dropOffIds, so it's untouched by this batch and stays
      // eligible for a later settlement. The live subscription refreshes
      // `dropOffs` once the batch commits, same as every other write in this app.
      onSettle(settlement, { cashDate });
      setNotes('');
      setReviewing(false);
      // Back to "all weeks" so the next run starts from whatever is still
      // pending — which, after settling a missed week, is this week.
      setWeekFilter('');
    });
  };

  const buyerName = (id: string) => deviceBuyers.find(r => r.id === id)?.name || 'Unknown';
  const history = settlements.filter(s => s.buyerId === buyerId).sort((a, b) => b.date.localeCompare(a.date));
  const reviewBuyer = deviceBuyers.find(r => r.id === buyerId);

  if (deviceBuyers.length === 0) {
    return <p className="text-slate-400 text-sm text-center py-8">Add a device buyer to run settlements.</p>;
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <CalendarCheck className="w-5 h-5 text-indigo-500" />
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">Weekly Settlement</h3>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">DeviceBuyer</label>
          <select value={buyerId} onChange={e => setBuyerId(e.target.value)}
            className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm">
            {deviceBuyers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>

        {/* Pending devices, one section per settlement week (oldest first, so
            a missed Saturday is at the top rather than buried under this
            week's). Each week can be settled on its own; "All weeks" is the
            old all-at-once behaviour, now an explicit choice. */}
        {weeks.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setWeekFilter('')}
              className={`px-2.5 py-1 rounded-full text-xs font-medium border ${!weekFilter ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>
              All weeks ({allPending.length})
            </button>
            {weeks.map(w => (
              <button key={w.weekEnding || 'undated'} onClick={() => { setWeekFilter(w.weekEnding); if (w.weekEnding) setPeriodEnd(w.weekEnding); }}
                className={`px-2.5 py-1 rounded-full text-xs font-medium border ${weekFilter === w.weekEnding ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>
                {w.weekEnding ? `Week ending ${w.weekEnding}` : 'No date'} ({w.dropOffs.length})
              </button>
            ))}
          </div>
        )}

        <div className="border border-slate-100 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 max-h-72 overflow-y-auto">
          {allPending.length === 0 && <p className="text-slate-400 text-sm text-center py-6">Nothing pending to settle.</p>}
          {weeks.filter(w => !weekFilter || w.weekEnding === weekFilter).map(w => (
            <div key={w.weekEnding || 'undated'}>
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 sticky top-0">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 truncate">
                    {w.weekEnding ? `Week ending ${w.weekEnding}` : 'No drop-off date recorded'}
                  </p>
                  <p className="text-[11px] text-slate-400">{w.dropOffs.length} device{w.dropOffs.length !== 1 ? 's' : ''} · {money(w.totals.totalOwed)} owed</p>
                </div>
                <button onClick={() => settleWeek(w)} disabled={isSubmitting}
                  className="shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-40">
                  Settle this week
                </button>
              </div>
              {w.dropOffs.map(d => (
                <div key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className="text-slate-700 dark:text-slate-200 truncate">{d.item}</p>
                    <p className="text-[11px] text-slate-400">{d.dateDropped || 'no date'} · {PAID_BY_LABEL[d.paidBy] || 'Store-funded'} · service fee {money(d.dropOffFee)}</p>
                  </div>
                  <span className="text-slate-500 dark:text-slate-400">{money(d.purchasePrice)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="space-y-1.5 text-sm">
          <Row label={`Devices this settlement`} value={`${pending.length}`} raw />
          <Row label="Principal owed (device purchase price)" value={totals.principalOwed} />
          <Row label="Service fees" value={totals.feesOwed} />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1" />
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1"><Wallet className="w-4 h-4" /> Total owed to store</span>
            <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400">{money(totals.totalOwed)}</span>
          </div>
          {totals.principalPersonalFunded > 0 && (
            <p className="text-[11px] text-slate-400">{money(totals.storeCashIn)} of that is store cash; {money(totals.principalPersonalFunded)} repays the owner personally.</p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Paid via</label>
          <div className="flex gap-2">
            {PAYMENT_METHODS.map(m => (
              <button key={m.value} type="button" onClick={() => setPaymentMethod(m.value)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border ${paymentMethod === m.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                {m.label}
              </button>
            ))}
          </div>
          {paymentMethod === 'cash'
            ? <p className="text-[11px] text-slate-400 mt-1">Adds {money(totals.storeCashIn)} to the expected cash drawer total for {cashDate === today() ? 'today' : cashDate} (collected from the buyer).</p>
            : <p className="text-[11px] text-slate-400 mt-1">Does not touch the cash drawer.</p>}
        </div>

        {/* Three dates, because a missed Saturday makes them genuinely
            different: which week this covers, when it was settled, and when
            the money actually changed hands. */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Settlement for week ending</label>
            <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value ? weekEndingSaturday(e.target.value) : '')}
              className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm" />
            <p className="text-[11px] text-slate-400 mt-0.5">Any day in the week works — it snaps to that week's Saturday.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Date settled</label>
            <input type="date" value={settledOn} max={today()} onChange={e => setSettledOn(e.target.value)}
              className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm" />
          </div>
          {paymentMethod === 'cash' && (
            <div className="col-span-2">
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Cash collected on</label>
              <input type="date" value={cashDate} max={today()} onChange={e => setCashDate(e.target.value)}
                className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm" />
              {touchesDrawer && cashDayClosed && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">
                  {cashDate} has already been counted and closed. Logging this cash against it will change that closed day's expected cash — you'll be asked to confirm.
                </p>
              )}
            </div>
          )}
        </div>

        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Settlement notes…"
          className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm" />

        <button onClick={openReview} disabled={pending.length === 0 || isSubmitting}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2">
          <FileText className="w-4 h-4" /> {isSubmitting ? 'Settling…' : 'Review & Settle'}
        </button>
      </div>

      {/* History */}
      <div>
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-3 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-slate-400" /> Settlement History — {buyerName(buyerId)}</h3>
        <div className="space-y-3">
          {history.length === 0 && <p className="text-slate-400 text-sm">No settlements yet.</p>}
          {history.map(s => (
            <div key={s.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{s.date}{s.periodEnd ? <span className="text-xs font-normal text-slate-400"> · week ending {s.periodEnd}</span> : null}</p>
                <span className="font-bold text-emerald-600">{money(isLegacySettlement(s) ? (s.amountPaid || 0) : (s.amountOwed || 0))}</span>
              </div>
              {/* Pre-rework settlements are displayed exactly as they were
                  recorded (store paid the buyer) and labelled as such —
                  nothing stored is reinterpreted. */}
              <p className="text-xs text-slate-400 mt-1">
                {s.dropOffIds.length} device{s.dropOffIds.length !== 1 ? 's' : ''}
                {isLegacySettlement(s)
                  ? ` · fronted ${money(s.totalPurchaseFronted || 0)} · fees ${money(s.totalFees)}`
                  : ` · principal ${money(s.principalOwed || 0)} · service fees ${money(s.totalFees)}`}
                {' · '}{PAYMENT_METHODS.find(m => m.value === (s.paymentMethod || 'cash'))?.label}
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {isLegacySettlement(s) ? LEGACY_SETTLEMENT_NOTE : settlementOwedLabel(s.amountOwed || 0)}
              </p>
              {s.notes && <p className="text-xs text-slate-400 mt-1 italic">{s.notes}</p>}
              {s.adjustmentAmount != null && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                  Adjusted {s.adjustmentAmount < 0 ? '-' : '+'}{money(Math.abs(s.adjustmentAmount))}{s.adjustmentNote ? ` — ${s.adjustmentNote}` : ''}
                </p>
              )}
              {!!s.lineAdjustments?.length && (
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">{s.lineAdjustments.length} device fee{s.lineAdjustments.length !== 1 ? 's' : ''} corrected on review</p>
              )}
              <button onClick={() => printSettlementInvoice(s, deviceBuyers.find(r => r.id === s.buyerId), dropOffs, { storeName })}
                className="mt-2 flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                <FileText className="w-3.5 h-3.5" /> Print Invoice
              </button>
            </div>
          ))}
        </div>
      </div>

      {reviewing && reviewBuyer && (
        <SettlementReviewModal
          buyer={reviewBuyer}
          dropOffs={pending}
          settlementId={reviewSettlementId}
          date={settledOn}
          periodEnd={periodEnd}
          paymentMethod={paymentMethod}
          notes={notes}
          storeName={storeName}
          isSubmitting={isSubmitting}
          onClose={() => setReviewing(false)}
          onConfirm={confirmSettlement}
        />
      )}
    </div>
  );
};

/* ---------------- History ---------------- */

/**
 * Closed drop-offs: settled (grouped under the settlement that closed them)
 * and rejected (their own section).
 *
 * A VIEW ONLY. Nothing here writes, deletes or migrates anything — every
 * drop-off keeps the status it already had; this is just where the ones that
 * are finished with are shown, so the working list stops growing forever.
 * Permissions are unchanged: this tab is inside Drop-Offs, so whoever can open
 * Drop-Offs can open it.
 */
const HistoryTab: React.FC<{
  deviceBuyers: DeviceBuyer[]; dropOffs: DropOff[]; settlements: Settlement[];
}> = ({ deviceBuyers, dropOffs, settlements }) => {
  const [query, setQuery] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const storeName = getStoreProfile().storeName;

  const buyerName = buyerNameFrom(deviceBuyers);
  const filter: HistoryFilter = { query, start: start || undefined, end: end || undefined };
  const closed = historyDropOffs(dropOffs);
  const groups = groupSettledBySettlement(closed, settlements, filter, buyerName);
  const rejected = rejectedHistory(closed, filter, buyerName);

  const toggle = (id: string) => setOpen(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const inp = 'p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm';

  if (closed.length === 0) {
    return <p className="text-slate-400 text-sm text-center py-10">Nothing closed yet — settled and rejected drop-offs appear here.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search by IMEI/serial, device, device buyer, and a date range. The
          IMEI is compared with separators stripped on both sides (see
          domain/dropOffHistory.ts's matchesHistoryQuery), so a scan finds a
          drop-off whose IMEI was typed in with spaces. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search IMEI / serial, device, or device buyer…"
            className={`${inp} w-full pl-9`} />
        </div>
        <div>
          <label className="block text-[11px] text-slate-400 mb-0.5">From</label>
          <input type="date" value={start} onChange={e => setStart(e.target.value)} className={inp} />
        </div>
        <div>
          <label className="block text-[11px] text-slate-400 mb-0.5">To</label>
          <input type="date" value={end} onChange={e => setEnd(e.target.value)} className={inp} />
        </div>
        {(query || start || end) && (
          <button onClick={() => { setQuery(''); setStart(''); setEnd(''); }}
            className="px-3 py-2 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Clear</button>
        )}
      </div>

      {groups.length === 0 && rejected.length === 0 && (
        <p className="text-slate-400 text-sm text-center py-8">Nothing in history matches that search.</p>
      )}

      {/* Settled, grouped by the settlement that closed them, newest first. */}
      {groups.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <CalendarCheck className="w-4 h-4 text-emerald-500" /> Settled ({groups.reduce((n, g) => n + g.dropOffs.length, 0)})
          </h3>
          {groups.map(g => {
            const s = g.settlement;
            const key = g.settlementId || 'unlinked';
            const isOpen = open.has(key);
            return (
              <div key={key} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                <button onClick={() => toggle(key)} className="w-full flex items-start justify-between gap-3 p-4 text-left">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                      {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                      {g.date || 'No date'}
                      {s?.periodEnd && <span className="text-xs font-normal text-slate-400">· week ending {s.periodEnd}</span>}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 pl-6">
                      {s ? buyerName(s.buyerId) : buyerName(g.dropOffs[0].buyerId)}
                      {' · '}{g.dropOffs.length} device{g.dropOffs.length !== 1 ? 's' : ''}
                      {s && <> · {PAYMENT_METHODS.find(m => m.value === (s.paymentMethod || 'cash'))?.label}</>}
                      {!s && ' · settled before settlements were linked to devices'}
                    </p>
                  </div>
                  {s && (
                    <span className="font-bold text-emerald-600 shrink-0">
                      {money(isLegacySettlement(s) ? (s.amountPaid || 0) : (s.amountOwed || 0))}
                    </span>
                  )}
                </button>

                {isOpen && (
                  <div className="border-t border-slate-100 dark:border-slate-800">
                    {g.dropOffs.map(d => (
                      <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm border-b border-slate-50 dark:border-slate-800/60 last:border-0">
                        <div className="min-w-0">
                          <p className="text-slate-700 dark:text-slate-200 truncate">{d.item}</p>
                          <p className="text-[11px] text-slate-400 font-mono truncate">{d.imei || 'No IMEI'}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-slate-500 dark:text-slate-400">{money(d.purchasePrice)}</p>
                          <p className="text-[11px] text-slate-400">dropped {d.dateDropped || '—'} · fee {money(d.dropOffFee)}</p>
                        </div>
                      </div>
                    ))}
                    {/* The same re-print the Settlement tab's history offers —
                        one implementation (services/settlementInvoice.ts), so
                        the slip printed from here is the slip the buyer signed. */}
                    {s && (
                      <div className="px-4 py-2">
                        <button onClick={() => printSettlementInvoice(s, deviceBuyers.find(r => r.id === s.buyerId), dropOffs, { storeName })}
                          className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                          <FileText className="w-3.5 h-3.5" /> Print Invoice
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Rejected — never settled, so they belong to no settlement. */}
      {rejected.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <XCircle className="w-4 h-4 text-rose-500" /> Rejected / returned ({rejected.length})
          </h3>
          {rejected.map(d => (
            <div key={d.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-slate-100">{d.item}</p>
                  <p className="text-xs text-slate-400 mt-1">
                    {buyerName(d.buyerId)} · <span className="font-mono">{d.imei || 'No IMEI'}</span> · {d.dateDropped || 'no date'}
                    {d.sellerName && ` · seller: ${d.sellerName}`}
                  </p>
                  {d.notes && <p className="text-xs text-slate-400 mt-1 italic">{d.notes}</p>}
                </div>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${STATUS_META.rejected.cls}`}>{STATUS_META.rejected.label}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value: number | string; raw?: boolean }> = ({ label, value, raw }) => (
  <div className="flex items-center justify-between">
    <span className="text-slate-500 dark:text-slate-400">{label}</span>
    <span className="text-slate-700 dark:text-slate-200 font-medium">{raw ? value : money(value as number)}</span>
  </div>
);
