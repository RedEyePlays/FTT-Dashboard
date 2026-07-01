import React, { useState } from 'react';
import {
  Truck, Users, CalendarCheck, Plus, X, Trash2, Phone, User, Package,
  CheckCircle, XCircle, DollarSign, ArrowRight, Wallet, ClipboardList,
} from 'lucide-react';
import { Runner, DropOff, DropOffStatus, PaidBy, Settlement, InventoryItem } from '../types';

interface Props {
  runners: Runner[];
  dropOffs: DropOff[];
  settlements: Settlement[];
  onRunnersChange: (r: Runner[]) => void;
  onDropOffsChange: (d: DropOff[]) => void;
  onSettlementsChange: (s: Settlement[]) => void;
  onAddToInventory: (d: DropOff) => void;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().split('T')[0];

const STATUS_META: Record<DropOffStatus, { label: string; cls: string }> = {
  pending:  { label: 'Pending review', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  accepted: { label: 'Accepted',       cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  rejected: { label: 'Rejected',       cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
  paidout:  { label: 'Paid out',       cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  settled:  { label: 'Settled',        cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
};

// Runner balance: cash the runner fronted (paidBy runner) + fees owed, minus
// anything already settled. Positive = we owe the runner; negative = runner owes store.
export const runnerBalance = (runnerId: string, dropOffs: DropOff[]) => {
  const active = dropOffs.filter(d =>
    d.runnerId === runnerId && d.status !== 'rejected' && d.status !== 'settled'
  );
  const cashFronted = active.filter(d => d.paidBy === 'runner').reduce((s, d) => s + d.purchasePrice, 0);
  const feesOwed = active.reduce((s, d) => s + d.dropOffFee, 0);
  // Devices where the store paid but runner holds cash/owes back would be negative;
  // here store-paid devices simply don't add to what we owe. Net owed to runner:
  const net = cashFronted + feesOwed;
  return { cashFronted, feesOwed, net, count: active.length };
};

export const DropOffView: React.FC<Props> = ({
  runners, dropOffs, settlements, onRunnersChange, onDropOffsChange, onSettlementsChange, onAddToInventory,
}) => {
  const [tab, setTab] = useState<'entries' | 'runners' | 'settlement'>('entries');

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
          <Truck className="w-6 h-6 text-indigo-500" /> Drop-Off / Runners
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Track runner drop-offs, balances, and weekly settlements.</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabBtn('entries', <Package className="w-4 h-4" />, 'Drop-Offs')}
        {tabBtn('runners', <Users className="w-4 h-4" />, 'Runners')}
        {tabBtn('settlement', <CalendarCheck className="w-4 h-4" />, 'Saturday Settlement')}
      </div>

      {tab === 'entries' && (
        <EntriesTab runners={runners} dropOffs={dropOffs} onDropOffsChange={onDropOffsChange} onAddToInventory={onAddToInventory} />
      )}
      {tab === 'runners' && (
        <RunnersTab runners={runners} dropOffs={dropOffs} onRunnersChange={onRunnersChange} />
      )}
      {tab === 'settlement' && (
        <SettlementTab runners={runners} dropOffs={dropOffs} settlements={settlements}
          onDropOffsChange={onDropOffsChange} onSettlementsChange={onSettlementsChange} />
      )}
    </div>
  );
};

/* ---------------- Drop-off entries ---------------- */

const EntriesTab: React.FC<{
  runners: Runner[]; dropOffs: DropOff[];
  onDropOffsChange: (d: DropOff[]) => void;
  onAddToInventory: (d: DropOff) => void;
}> = ({ runners, dropOffs, onDropOffsChange, onAddToInventory }) => {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<DropOffStatus | 'all'>('all');

  const blank = (): DropOff => ({
    id: uid(), runnerId: runners[0]?.id || '', item: '', imei: '',
    sellerName: '', sellerContact: '', purchasePrice: 0, paidBy: 'runner',
    dropOffFee: 0, dateDropped: today(), status: 'pending', notes: '',
  });
  const [form, setForm] = useState<DropOff>(blank());

  const set = <K extends keyof DropOff>(k: K, v: DropOff[K]) => setForm(f => ({ ...f, [k]: v }));

  const save = () => {
    if (!form.runnerId || !form.item) return;
    onDropOffsChange([...dropOffs, form]);
    setForm(blank());
    setShowForm(false);
  };

  const update = (id: string, patch: Partial<DropOff>) =>
    onDropOffsChange(dropOffs.map(d => d.id === id ? { ...d, ...patch } : d));
  const remove = (id: string) => onDropOffsChange(dropOffs.filter(d => d.id !== id));

  const runnerName = (id: string) => runners.find(r => r.id === id)?.name || 'Unknown';
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
        <button onClick={() => { setForm(blank()); setShowForm(true); }} disabled={runners.length === 0}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium">
          <Plus className="w-4 h-4" /> New Drop-Off
        </button>
      </div>

      {runners.length === 0 && (
        <div className="text-center text-slate-400 text-sm py-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          Add a runner first (Runners tab) before logging drop-offs.
        </div>
      )}

      {runners.length > 0 && shown.length === 0 && (
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
                  {runnerName(d.runnerId)} · {d.imei || 'No IMEI'} · {d.dateDropped}
                  {d.sellerName && ` · seller: ${d.sellerName}`}
                </p>
                <div className="flex gap-4 mt-2 text-xs">
                  <span className="text-slate-500 dark:text-slate-400">Purchase: <b className="text-slate-700 dark:text-slate-200">${d.purchasePrice.toFixed(2)}</b></span>
                  <span className="text-slate-500 dark:text-slate-400">Paid by: <b className="text-slate-700 dark:text-slate-200">{d.paidBy === 'runner' ? 'Runner' : 'Store'}</b></span>
                  <span className="text-slate-500 dark:text-slate-400">Fee: <b className="text-emerald-600">${d.dropOffFee.toFixed(2)}</b></span>
                </div>
                {d.notes && <p className="text-xs text-slate-400 mt-1 italic">{d.notes}</p>}
              </div>
              <button onClick={() => remove(d.id)} className="text-slate-400 hover:text-rose-500 p-1 shrink-0"><Trash2 className="w-4 h-4" /></button>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              {d.status === 'pending' && (
                <>
                  <button onClick={() => update(d.id, { status: 'accepted' })} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 hover:bg-indigo-100">
                    <CheckCircle className="w-3.5 h-3.5" /> Accept
                  </button>
                  <button onClick={() => update(d.id, { status: 'rejected' })} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300 hover:bg-rose-100">
                    <XCircle className="w-3.5 h-3.5" /> Reject / Return
                  </button>
                </>
              )}
              {d.status === 'accepted' && !d.inventoryId && (
                <button onClick={() => onAddToInventory(d)} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 hover:bg-emerald-100">
                  <ArrowRight className="w-3.5 h-3.5" /> Add to Inventory
                </button>
              )}
              {d.inventoryId && (
                <span className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-500">
                  <Package className="w-3.5 h-3.5" /> In inventory
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
                <label className={lbl}>Runner *</label>
                <select className={inp} value={form.runnerId} onChange={e => set('runnerId', e.target.value)}>
                  {runners.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
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
                <label className={lbl}>Drop-Off Fee ($)</label>
                <input type="number" step="0.01" className={inp} value={form.dropOffFee} onChange={e => set('dropOffFee', parseFloat(e.target.value) || 0)} />
              </div>
              <div className="col-span-2">
                <label className={lbl}>Who paid the seller?</label>
                <div className="flex gap-2">
                  {(['runner', 'store'] as PaidBy[]).map(p => (
                    <button key={p} type="button" onClick={() => set('paidBy', p)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border ${form.paidBy === p ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                      {p === 'runner' ? 'Runner paid' : 'Store paid'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="col-span-2">
                <label className={lbl}>Notes</label>
                <input className={inp} value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={save} disabled={!form.runnerId || !form.item} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium">Save Drop-Off</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ---------------- Runners ---------------- */

const RunnersTab: React.FC<{
  runners: Runner[]; dropOffs: DropOff[];
  onRunnersChange: (r: Runner[]) => void;
}> = ({ runners, dropOffs, onRunnersChange }) => {
  const [form, setForm] = useState<Runner>({ id: '', name: '', phone: '', notes: '' });
  const [editing, setEditing] = useState(false);

  const save = () => {
    if (!form.name) return;
    if (editing) onRunnersChange(runners.map(r => r.id === form.id ? form : r));
    else onRunnersChange([...runners, { ...form, id: uid() }]);
    setForm({ id: '', name: '', phone: '', notes: '' });
    setEditing(false);
  };
  const edit = (r: Runner) => { setForm(r); setEditing(true); };
  const remove = (id: string) => onRunnersChange(runners.filter(r => r.id !== id));

  const inp = 'w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500';

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Form */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 h-fit">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-3">{editing ? 'Edit Runner' : 'Add Runner'}</h3>
        <div className="space-y-3">
          <div className="relative">
            <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className={`${inp} pl-9`} placeholder="Runner name *" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="relative">
            <Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input className={`${inp} pl-9`} placeholder="Phone number" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
          </div>
          <textarea className={inp} rows={2} placeholder="Notes" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          <div className="flex gap-2">
            <button onClick={save} disabled={!form.name} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium">{editing ? 'Save Changes' : 'Add Runner'}</button>
            {editing && <button onClick={() => { setForm({ id: '', name: '', phone: '', notes: '' }); setEditing(false); }} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-sm">Cancel</button>}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {runners.length === 0 && <p className="text-slate-400 text-sm text-center py-8">No runners yet.</p>}
        {runners.map(r => {
          const bal = runnerBalance(r.id, dropOffs);
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
              <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-center">
                <div><p className="text-[10px] text-slate-400 uppercase">Cash Fronted</p><p className="font-bold text-slate-700 dark:text-slate-200 text-sm">${bal.cashFronted.toFixed(2)}</p></div>
                <div><p className="text-[10px] text-slate-400 uppercase">Fees Owed</p><p className="font-bold text-emerald-600 text-sm">${bal.feesOwed.toFixed(2)}</p></div>
                <div><p className="text-[10px] text-slate-400 uppercase">Net Owed</p><p className="font-bold text-indigo-600 dark:text-indigo-400 text-sm">${bal.net.toFixed(2)}</p></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ---------------- Saturday settlement ---------------- */

const SettlementTab: React.FC<{
  runners: Runner[]; dropOffs: DropOff[]; settlements: Settlement[];
  onDropOffsChange: (d: DropOff[]) => void;
  onSettlementsChange: (s: Settlement[]) => void;
}> = ({ runners, dropOffs, settlements, onDropOffsChange, onSettlementsChange }) => {
  const [runnerId, setRunnerId] = useState(runners[0]?.id || '');
  const [notes, setNotes] = useState('');

  // Settle everything accepted/paid-out & not yet settled/rejected for this runner
  const pending = dropOffs.filter(d =>
    d.runnerId === runnerId && (d.status === 'accepted' || d.status === 'paidout')
  );
  const cashFronted = pending.filter(d => d.paidBy === 'runner').reduce((s, d) => s + d.purchasePrice, 0);
  const totalFees = pending.reduce((s, d) => s + d.dropOffFee, 0);
  const amountToPay = cashFronted + totalFees;

  const settle = () => {
    if (pending.length === 0) return;
    const settlement: Settlement = {
      id: uid(), runnerId, date: today(),
      dropOffIds: pending.map(d => d.id),
      totalPurchaseFronted: cashFronted, totalFees, amountPaid: amountToPay, notes,
    };
    onSettlementsChange([...settlements, settlement]);
    onDropOffsChange(dropOffs.map(d =>
      pending.some(p => p.id === d.id) ? { ...d, status: 'settled', settlementId: settlement.id } : d
    ));
    setNotes('');
  };

  const runnerName = (id: string) => runners.find(r => r.id === id)?.name || 'Unknown';
  const history = settlements.filter(s => s.runnerId === runnerId).sort((a, b) => b.date.localeCompare(a.date));

  if (runners.length === 0) {
    return <p className="text-slate-400 text-sm text-center py-8">Add a runner to run settlements.</p>;
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <CalendarCheck className="w-5 h-5 text-indigo-500" />
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">Weekly Settlement</h3>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Runner</label>
          <select value={runnerId} onChange={e => setRunnerId(e.target.value)}
            className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm">
            {runners.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>

        <div className="border border-slate-100 dark:border-slate-800 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 max-h-56 overflow-y-auto">
          {pending.length === 0 && <p className="text-slate-400 text-sm text-center py-6">Nothing pending to settle.</p>}
          {pending.map(d => (
            <div key={d.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-slate-700 dark:text-slate-200 truncate">{d.item}</p>
                <p className="text-[11px] text-slate-400">{d.paidBy === 'runner' ? 'Runner paid' : 'Store paid'} · fee ${d.dropOffFee.toFixed(2)}</p>
              </div>
              <span className="text-slate-500 dark:text-slate-400">${d.purchasePrice.toFixed(2)}</span>
            </div>
          ))}
        </div>

        <div className="space-y-1.5 text-sm">
          <Row label={`Devices this settlement`} value={`${pending.length}`} raw />
          <Row label="Purchase cash fronted by runner" value={cashFronted} />
          <Row label="Total drop-off fees" value={totalFees} />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1" />
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1"><Wallet className="w-4 h-4" /> Total to pay runner</span>
            <span className="text-lg font-bold text-indigo-600 dark:text-indigo-400">${amountToPay.toFixed(2)}</span>
          </div>
        </div>

        <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Settlement notes…"
          className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm" />

        <button onClick={settle} disabled={pending.length === 0}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-2">
          <CheckCircle className="w-4 h-4" /> Mark as Settled
        </button>
      </div>

      {/* History */}
      <div>
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-3 flex items-center gap-2"><ClipboardList className="w-4 h-4 text-slate-400" /> Settlement History — {runnerName(runnerId)}</h3>
        <div className="space-y-3">
          {history.length === 0 && <p className="text-slate-400 text-sm">No settlements yet.</p>}
          {history.map(s => (
            <div key={s.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{s.date}</p>
                <span className="font-bold text-emerald-600">${s.amountPaid.toFixed(2)}</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {s.dropOffIds.length} device{s.dropOffIds.length !== 1 ? 's' : ''} · fronted ${s.totalPurchaseFronted.toFixed(2)} · fees ${s.totalFees.toFixed(2)}
              </p>
              {s.notes && <p className="text-xs text-slate-400 mt-1 italic">{s.notes}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Row: React.FC<{ label: string; value: number | string; raw?: boolean }> = ({ label, value, raw }) => (
  <div className="flex items-center justify-between">
    <span className="text-slate-500 dark:text-slate-400">{label}</span>
    <span className="text-slate-700 dark:text-slate-200 font-medium">{raw ? value : `$${(value as number).toFixed(2)}`}</span>
  </div>
);
