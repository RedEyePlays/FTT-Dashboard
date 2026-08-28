import React, { useState } from 'react';
import {
  Truck, Users, CalendarCheck, Plus, X, Trash2, Phone, User, Package,
  CheckCircle, XCircle, Wallet, ClipboardList, FileText,
} from 'lucide-react';
import { DeviceBuyer, DropOff, DropOffStatus, PaidBy, Settlement, SettlementPaymentMethod } from '../types';
import { deviceBuyerOutstanding, settleableDropOffs, settlementTotals, SettlementReviewLine, buildSettlementFromReview, settlementOwedLabel, isLegacySettlement, LEGACY_SETTLEMENT_NOTE } from '../domain/dropoffs';
import { formatPhoneInput } from '../domain/phone';
import { printSettlementInvoice } from '../services/settlementInvoice';
import { getStoreProfile } from './SettingsModal';
import { SettlementReviewModal } from './SettlementReviewModal';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { todayISO } from '../domain/dates';
import { useSubmitGuard, useKeyedSubmitGuard } from '../hooks/useSubmitGuard';

interface Props {
  deviceBuyers: DeviceBuyer[];
  dropOffs: DropOff[];
  settlements: Settlement[];
  onDeviceBuyersChange: (r: DeviceBuyer[]) => void;
  onDropOffsChange: (d: DropOff[]) => void;
  // Records one completed settlement (writes the record, marks its drop-offs
  // settled, and — for a cash payment only — logs the cash-drawer effect).
  onSettle: (settlement: Settlement) => void;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => todayISO();
const money = (n: number) => `$${n.toFixed(2)}`;

// How the purchase was funded. The store never buys the device — it either
// advances the money (and is owed it back) or it doesn't (see types.ts's
// PaidBy; 'runner' is the legacy stored value for buyer-funded).
const PAID_BY_LABEL: Record<PaidBy, string> = {
  runner: 'Buyer-funded (own money)', store: 'Store-funded (owed back)', personal: 'Owner-funded (owed back)',
};

const STATUS_META: Record<DropOffStatus, { label: string; cls: string }> = {
  pending:  { label: 'Pending review', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  accepted: { label: 'Accepted',       cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  rejected: { label: 'Rejected',       cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
  paidout:  { label: 'Paid out',       cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  settled:  { label: 'Settled',        cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
};

export const DropOffView: React.FC<Props> = ({
  deviceBuyers, dropOffs, settlements, onDeviceBuyersChange, onDropOffsChange, onSettle,
}) => {
  const [tab, setTab] = useState<'entries' | 'deviceBuyers' | 'settlement'>('entries');

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
      </div>

      {tab === 'entries' && (
        <EntriesTab deviceBuyers={deviceBuyers} dropOffs={dropOffs} onDropOffsChange={onDropOffsChange} />
      )}
      {tab === 'deviceBuyers' && (
        <DeviceBuyersTab deviceBuyers={deviceBuyers} dropOffs={dropOffs} onDeviceBuyersChange={onDeviceBuyersChange} />
      )}
      {tab === 'settlement' && (
        <SettlementTab deviceBuyers={deviceBuyers} dropOffs={dropOffs} settlements={settlements} onSettle={onSettle} />
      )}
    </div>
  );
};

/* ---------------- Drop-off entries ---------------- */

const EntriesTab: React.FC<{
  deviceBuyers: DeviceBuyer[]; dropOffs: DropOff[];
  onDropOffsChange: (d: DropOff[]) => void;
}> = ({ deviceBuyers, dropOffs, onDropOffsChange }) => {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<DropOffStatus | 'all'>('all');
  // Accept moves real cash (dropOffAcceptDrawerEffect, logged in App.tsx's
  // saveDropOffs) — keyed per-row so a double-tap on one drop-off's Accept
  // can't double-log the cash, without freezing every other row's buttons
  // while one is in flight.
  const { isPending: rowPending, run: runRow } = useKeyedSubmitGuard();

  useEscapeKey(() => setShowForm(false), showForm);

  const blank = (): DropOff => ({
    id: uid(), buyerId: deviceBuyers[0]?.id || '', item: '', imei: '',
    sellerName: '', sellerContact: '', purchasePrice: 0, paidBy: 'runner',
    dropOffFee: 0, dateDropped: today(), status: 'pending', notes: '',
  });
  const [form, setForm] = useState<DropOff>(blank());

  const set = <K extends keyof DropOff>(k: K, v: DropOff[K]) => setForm(f => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.buyerId || !form.item) return;
    onDropOffsChange([...dropOffs, form]);
    setForm(blank());
    setShowForm(false);
  };

  const update = (id: string, patch: Partial<DropOff>) =>
    onDropOffsChange(dropOffs.map(d => d.id === id ? { ...d, ...patch } : d));
  const remove = (id: string) => onDropOffsChange(dropOffs.filter(d => d.id !== id));

  const buyerName = (id: string) => deviceBuyers.find(r => r.id === id)?.name || 'Unknown';
  const shown = filter === 'all' ? dropOffs : dropOffs.filter(d => d.status === filter);

  const inp = 'w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500';
  const lbl = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 flex-wrap">
          {(['all', 'pending', 'accepted', 'rejected', 'paidout', 'settled'] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-full text-xs font-medium ${filter === s ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}`}>
              {s === 'all' ? 'All' : STATUS_META[s].label}
            </button>
          ))}
        </div>
        <button onClick={() => { setForm(blank()); setShowForm(true); }} disabled={deviceBuyers.length === 0}
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
        <div className="text-center text-slate-400 text-sm py-8">No drop-offs to show.</div>
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
                  <span className="text-slate-500 dark:text-slate-400">Buyer owes: <b className="text-indigo-600 dark:text-indigo-400">{money((d.paidBy === 'runner' ? 0 : d.purchasePrice || 0) + (d.dropOffFee || 0))}</b></span>
                </div>
                {d.notes && <p className="text-xs text-slate-400 mt-1 italic">{d.notes}</p>}
              </div>
              <button onClick={() => remove(d.id)} className="text-slate-400 hover:text-rose-500 p-1 shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
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

      {/* New drop-off modal */}
      {showForm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowForm(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <h2 className="font-bold text-slate-800 dark:text-slate-100">New Drop-Off</h2>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-slate-400" /></button>
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
                {form.paidBy === 'store' && form.purchasePrice > 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5">Accepting logs a ${form.purchasePrice.toFixed(2)} cash-out today. The buyer owes that back plus the ${form.dropOffFee.toFixed(2)} service fee at settlement.</p>
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
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={save} disabled={!form.buyerId || !form.item} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium">Save Drop-Off</button>
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
}> = ({ deviceBuyers, dropOffs, onDeviceBuyersChange }) => {
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
  onSettle: (settlement: Settlement) => void;
}> = ({ deviceBuyers, dropOffs, settlements, onSettle }) => {
  const [buyerId, setBuyerId] = useState(deviceBuyers[0]?.id || '');
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<SettlementPaymentMethod>('cash');
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

  // Settle everything accepted/paid-out & not yet settled/rejected for this device buyer
  const pending = settleableDropOffs(buyerId, dropOffs);
  const totals = settlementTotals(pending);

  const openReview = () => {
    if (pending.length === 0) return;
    setReviewSettlementId(uid());
    setReviewing(true);
  };

  const confirmSettlement = (lines: SettlementReviewLine[], adjustmentAmount: number, adjustmentNote: string) => {
    run(() => {
      const settlement = buildSettlementFromReview(
        { id: reviewSettlementId, buyerId, date: today(), paymentMethod, notes },
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
      onSettle(settlement);
      setNotes('');
      setReviewing(false);
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

        <div className="border border-slate-100 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto">
          {pending.length === 0 && <p className="text-slate-400 text-sm text-center py-6">Nothing pending to settle.</p>}
          {pending.map(d => (
            <div key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-slate-700 dark:text-slate-200 truncate">{d.item}</p>
                <p className="text-[11px] text-slate-400">{PAID_BY_LABEL[d.paidBy] || 'Store-funded'} · service fee {money(d.dropOffFee)}</p>
              </div>
              <span className="text-slate-500 dark:text-slate-400">{money(d.purchasePrice)}</span>
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
            ? <p className="text-[11px] text-slate-400 mt-1">Adds {money(totals.storeCashIn)} to today's expected cash drawer total (collected from the buyer).</p>
            : <p className="text-[11px] text-slate-400 mt-1">Does not touch the cash drawer.</p>}
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
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{s.date}</p>
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
          date={today()}
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

const Row: React.FC<{ label: string; value: number | string; raw?: boolean }> = ({ label, value, raw }) => (
  <div className="flex items-center justify-between">
    <span className="text-slate-500 dark:text-slate-400">{label}</span>
    <span className="text-slate-700 dark:text-slate-200 font-medium">{raw ? value : money(value as number)}</span>
  </div>
);
