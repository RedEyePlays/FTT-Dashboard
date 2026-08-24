import React, { useMemo, useState } from 'react';
import { Wallet, Receipt, Download, Save, AlertTriangle, CheckCircle2, Plus, Trash2, Scale, FileArchive, Truck, DoorOpen } from 'lucide-react';
import { SalesTransaction, CashReconciliation, CashDrawerEntry, InventoryItem, PayPeriodPaid, Settlement, Runner } from '../types';
import {
  expectedCashForDate, expectedEndingCash, sumDrawerEntries, reconcileCash, taxRemittance, taxReportCsvRows, TaxGrouping,
  profitAndLoss, profitLossCsvRows, settlementHistory, yearEndSummary, yearEndCsvRows, ProfitLossInput, ReconciliationInput,
} from '../domain/reports';
import { toCSV, triggerDownload } from '../services/backup';
import { newId } from '../domain/ids';

type SaveReconciliation = (r: ReconciliationInput) => void;

interface Props {
  salesTransactions: SalesTransaction[];
  cashReconciliations: CashReconciliation[];
  inventory: InventoryItem[];
  payPeriods: PayPeriodPaid[];
  settlements: Settlement[];
  runners: Runner[];
  onSaveReconciliation: SaveReconciliation;
  defaultOpeningFloat?: number;
}

type TabId = 'cash' | 'tax' | 'pnl' | 'yearend' | 'settlements';
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'cash', label: 'Cash Reconciliation', icon: <Wallet className="w-4 h-4" /> },
  { id: 'tax', label: 'Sales Tax', icon: <Receipt className="w-4 h-4" /> },
  { id: 'pnl', label: 'Profit & Loss', icon: <Scale className="w-4 h-4" /> },
  { id: 'settlements', label: 'Runner Settlements', icon: <Truck className="w-4 h-4" /> },
  { id: 'yearend', label: 'Year-End Export', icon: <FileArchive className="w-4 h-4" /> },
];

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayISO = () => new Date().toISOString().split('T')[0];
const monthStartISO = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]; };

const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl';
const input = 'px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
const label = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

export const ReportsView: React.FC<Props> = ({ salesTransactions, cashReconciliations, inventory, payPeriods, settlements, runners, onSaveReconciliation }) => {
  const [tab, setTab] = useState<TabId>('cash');
  // Shared input set for the P&L / settlement / year-end reports.
  const plInput: ProfitLossInput = { transactions: salesTransactions, inventory, payPeriods, cashReconciliations, settlements };
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${tab === t.id ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {tab === 'cash' && <CashReconTab salesTransactions={salesTransactions} cashReconciliations={cashReconciliations} onSave={onSaveReconciliation} />}
      {tab === 'tax' && <TaxReportTab salesTransactions={salesTransactions} />}
      {tab === 'pnl' && <ProfitLossTab plInput={plInput} />}
      {tab === 'settlements' && <SettlementsTab settlements={settlements} runners={runners} />}
      {tab === 'yearend' && <YearEndTab plInput={plInput} />}
    </div>
  );
};

/* ---------------- Cash reconciliation ---------------- */
const num = (v: string) => parseFloat(v) || 0;

const BreakdownRow: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
    <span>{label}</span><span>{value < 0 ? `−${money(Math.abs(value))}` : money(value)}</span>
  </div>
);

// Editable list of cash-drawer entries (amount + note). Its date + who-logged-it
// come from the parent reconciliation record, so each row is just money leaving.
const EntryList: React.FC<{ title: string; entries: CashDrawerEntry[]; onChange: (e: CashDrawerEntry[]) => void; notePlaceholder: string }> = ({ title, entries, onChange, notePlaceholder }) => {
  const set = (id: string, patch: Partial<CashDrawerEntry>) => onChange(entries.map(e => e.id === id ? { ...e, ...patch } : e));
  const total = sumDrawerEntries(entries);
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</span>
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{money(total)}</span>
      </div>
      {entries.map(e => (
        <div key={e.id} className="flex items-center gap-2">
          <input type="number" step="0.01" min="0" value={e.amount || ''} onChange={ev => set(e.id, { amount: num(ev.target.value) })} placeholder="0.00" className={`${input} w-24`} />
          <input value={e.note || ''} onChange={ev => set(e.id, { note: ev.target.value })} placeholder={notePlaceholder} className={`${input} flex-1 min-w-0`} />
          <button onClick={() => onChange(entries.filter(x => x.id !== e.id))} className="p-1.5 text-slate-400 hover:text-rose-500" aria-label="Remove entry"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      <button onClick={() => onChange([...entries, { id: newId(), amount: 0 }])} className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
        <Plus className="w-3.5 h-3.5" /> Add entry
      </button>
    </div>
  );
};

const CashReconTab: React.FC<{
  salesTransactions: SalesTransaction[];
  cashReconciliations: CashReconciliation[];
  onSave: SaveReconciliation;
}> = ({ salesTransactions, cashReconciliations, onSave }) => {
  const [date, setDate] = useState(todayISO());
  const cashSales = useMemo(() => expectedCashForDate(salesTransactions, date), [salesTransactions, date]);
  const saved = cashReconciliations.find(r => r.date === date);
  // The drawer must have been explicitly opened for this day; otherwise we flag
  // it rather than silently assuming a starting float.
  const wasOpened = !!saved?.openedAt;

  const [openingFloat, setOpeningFloat] = useState('');
  const [cashIn, setCashIn] = useState<CashDrawerEntry[]>([]);
  const [cashOut, setCashOut] = useState<CashDrawerEntry[]>([]);
  const [withdrawals, setWithdrawals] = useState<CashDrawerEntry[]>([]);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  // Reload the editable fields whenever the selected day (or its saved record) changes.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (loadedFor !== date) {
    setLoadedFor(date);
    // Only prefill the float from a real open/save — never a silent default.
    setOpeningFloat(saved?.openingFloat != null ? String(saved.openingFloat) : '');
    setCashIn(saved?.cashIn ? saved.cashIn.map(e => ({ ...e })) : []);
    setCashOut(saved?.cashOut ? saved.cashOut.map(e => ({ ...e })) : []);
    setWithdrawals(saved?.withdrawals ? saved.withdrawals.map(e => ({ ...e })) : []);
    // A day may already have cash movements logged but not yet been counted —
    // leave the count blank in that case so it still reads as un-reconciled.
    setCounted(saved && saved.countedCash != null ? String(saved.countedCash) : '');
    setNote(saved?.note || '');
  }

  const openingNum = num(openingFloat);
  const cashInTotal = sumDrawerEntries(cashIn);
  const cashOutTotal = sumDrawerEntries(cashOut);
  const withdrawalTotal = sumDrawerEntries(withdrawals);
  const expected = expectedEndingCash({ openingFloat: openingNum, cashSales, cashIn: cashInTotal, cashOut: cashOutTotal, withdrawals: withdrawalTotal });
  const countedNum = num(counted);
  const { variance, direction } = reconcileCash(countedNum, expected);
  const hasCount = counted.trim() !== '';
  // A discrepancy (over/short) must be explained before it can be saved.
  const needsNote = hasCount && direction !== 'balanced' && !note.trim();
  const canSave = hasCount && !needsNote;

  const cleanEntries = (list: CashDrawerEntry[]) => list.filter(e => (e.amount || 0) > 0).map(e => ({ id: e.id, amount: e.amount, note: e.note?.trim() || undefined }));

  const save = () => {
    if (!canSave) return;
    onSave({
      date,
      openingFloat: openingNum,
      cashIn: cleanEntries(cashIn), cashOut: cleanEntries(cashOut), withdrawals: cleanEntries(withdrawals),
      countedCash: countedNum,
      note: note.trim() || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className={`${card} p-5 space-y-4`}>
        {!wasOpened && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40">
            <DoorOpen className="w-4 h-4 shrink-0 mt-0.5" />
            <span>The drawer wasn't opened for this day, so no starting float was recorded. Enter the float you started with below before reconciling — don't leave it assumed.</span>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className={label}>Date</label>
            <input type="date" max={todayISO()} value={date} onChange={e => setDate(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Opening float{wasOpened ? '' : ' (not opened)'}</label>
            <input type="number" step="0.01" min="0" value={openingFloat} onChange={e => setOpeningFloat(e.target.value)} placeholder="0.00" className={input} />
          </div>
          <div>
            <label className={label}>Counted cash in till</label>
            <input type="number" step="0.01" min="0" value={counted} onChange={e => setCounted(e.target.value)} placeholder="0.00" className={input} />
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <EntryList title="Cash in (top-ups / tips)" entries={cashIn} onChange={setCashIn} notePlaceholder="Reason, e.g. change top-up" />
          <EntryList title="Cash paid out (expenses)" entries={cashOut} onChange={setCashOut} notePlaceholder="Reason, e.g. courier COD" />
          <EntryList title="Withdrawals to owner (pulls / deposits)" entries={withdrawals} onChange={setWithdrawals} notePlaceholder="Note, e.g. bank deposit" />
        </div>

        {/* Expected-ending breakdown */}
        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm space-y-1">
          <BreakdownRow label="Opening float" value={openingNum} />
          <BreakdownRow label="+ Cash sales" value={cashSales} />
          {cashInTotal > 0 && <BreakdownRow label="+ Cash in (manual)" value={cashInTotal} />}
          <BreakdownRow label="− Cash paid out" value={-cashOutTotal} />
          <BreakdownRow label="− Withdrawals to owner" value={-withdrawalTotal} />
          <div className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-100">
            <span>Expected ending cash</span><span>{money(expected)}</span>
          </div>
        </div>

        {hasCount && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
            direction === 'balanced' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
            : 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'}`}>
            {direction === 'balanced'
              ? <><CheckCircle2 className="w-4 h-4" /> Balanced — till matches expected cash.</>
              : <><AlertTriangle className="w-4 h-4" /> {direction === 'over' ? 'Over' : 'Short'} by {money(Math.abs(variance))} (counted {money(countedNum)} vs expected {money(expected)}).</>}
          </div>
        )}

        <div>
          <label className={label}>Note {hasCount && direction !== 'balanced' ? '(required — explain the variance)' : '(optional)'}</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. $5 float miscount; card tip paid out in cash"
            className={`${input} w-full resize-y ${needsNote ? 'ring-2 ring-amber-400 border-amber-400' : ''}`} />
          {needsNote && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">A note is required to save an over/short count.</p>}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">
            {saved?.reconciledAt
              ? `Reconciled by ${saved.reconciledByEmail || saved.reconciledBy} · ${new Date(saved.reconciledAt).toLocaleString()}`
              : saved
                ? 'Open — cash movements logged, not yet reconciled.'
                : 'Not yet reconciled for this day.'}
          </p>
          <button onClick={save} disabled={!canSave} title={needsNote ? 'Add a note explaining the variance first' : undefined} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">
            <Save className="w-4 h-4" /> {saved?.reconciledAt ? 'Update' : 'Save'} reconciliation
          </button>
        </div>
      </div>

      <CashHistory cashReconciliations={cashReconciliations} onPick={setDate} />
    </div>
  );
};

// Owner/manager cash history (this whole Reports view is gated by cash.reconcile).
// Full audit trail per day: opening float, cash in / out / withdrawals, closing
// count, variance and the variance note. Defaults to the last 30 days with a
// control to widen the window (90 / 365 / all).
const RANGES: { days: number; label: string }[] = [
  { days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: '1 year' }, { days: 0, label: 'All' },
];
const CashHistory: React.FC<{ cashReconciliations: CashReconciliation[]; onPick: (date: string) => void }> = ({ cashReconciliations, onPick }) => {
  const [days, setDays] = useState(30);
  const cutoff = useMemo(() => {
    if (!days) return '';
    const d = new Date(); d.setDate(d.getDate() - (days - 1));
    return d.toISOString().split('T')[0];
  }, [days]);
  const rows = useMemo(
    () => [...cashReconciliations].filter(r => !cutoff || r.date >= cutoff).sort((a, b) => b.date.localeCompare(a.date)),
    [cashReconciliations, cutoff],
  );
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Cash history</h3>
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
          {RANGES.map(r => (
            <button key={r.days} onClick={() => setDays(r.days)}
              className={`px-2.5 py-1 font-medium ${days === r.days ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>{r.label}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 py-4 text-center">No cash records in this range.</p>
      ) : (
        <div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
          <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr>
            <th className="text-left py-2">Date</th><th className="text-right py-2">Opening</th><th className="text-right py-2">Cash in</th><th className="text-right py-2">Cash out</th><th className="text-right py-2">Withdrawn</th><th className="text-right py-2">Counted</th><th className="text-right py-2">Variance</th><th className="text-left py-2 pl-4">Note</th><th className="text-left py-2">Status</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map(r => {
              const reconciled = !!r.reconciledAt;
              return (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => onPick(r.date)}>
                  <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{r.date}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{r.openedAt || r.openingFloat != null ? money(r.openingFloat || 0) : <span className="text-amber-500" title="Drawer not opened">—</span>}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(sumDrawerEntries(r.cashIn))}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(sumDrawerEntries(r.cashOut))}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(sumDrawerEntries(r.withdrawals))}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{reconciled && r.countedCash != null ? money(r.countedCash) : <span className="text-slate-400">—</span>}</td>
                  {reconciled && r.countedCash != null
                    ? <td className={`py-2 text-right font-semibold ${Math.abs(r.variance) < 0.005 ? 'text-emerald-600' : 'text-amber-600 dark:text-amber-400'}`}>{r.variance > 0 ? '+' : ''}{money(r.variance)}</td>
                    : <td className="py-2 text-right text-slate-400">—</td>}
                  <td className="py-2 pl-4 text-slate-500 dark:text-slate-400 truncate max-w-[220px]">{r.note || '—'}</td>
                  <td className="py-2">
                    {reconciled
                      ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Reconciled</span>
                      : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">Open</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </div>
  );
};

/* ---------------- Sales tax remittance ---------------- */
const TaxReportTab: React.FC<{ salesTransactions: SalesTransaction[] }> = ({ salesTransactions }) => {
  const [start, setStart] = useState(monthStartISO());
  const [end, setEnd] = useState(todayISO());
  const [grouping, setGrouping] = useState<TaxGrouping>('month');
  const report = useMemo(() => taxRemittance(salesTransactions, start, end, grouping), [salesTransactions, start, end, grouping]);

  const exportCsv = () => {
    const csv = toCSV(taxReportCsvRows(report));
    triggerDownload(`tax-remittance_${report.start}_to_${report.end}.csv`, csv, 'text/csv;charset=utf-8;');
  };

  return (
    <div className="space-y-6">
      <div className={`${card} p-5 space-y-4`}>
        <div className="flex flex-wrap items-end gap-4">
          <div><label className={label}>From</label><input type="date" value={start} onChange={e => setStart(e.target.value)} className={input} /></div>
          <div><label className={label}>To</label><input type="date" value={end} onChange={e => setEnd(e.target.value)} className={input} /></div>
          <div>
            <label className={label}>Group by</label>
            <div className="flex gap-1">
              {(['month', 'quarter'] as TaxGrouping[]).map(g => (
                <button key={g} onClick={() => setGrouping(g)} className={`px-3 py-2 rounded-lg text-sm font-medium capitalize ${grouping === g ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>{g}</button>
              ))}
            </div>
          </div>
          <button onClick={exportCsv} disabled={report.rows.length === 0} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Tax collected on recognized sales only — voided, returned and not-yet-settled layaway sales are excluded. Repairs don't collect sales tax separately, so all remittable tax comes from sales.
        </p>
      </div>

      <div className={`${card} p-5`}>
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Tax collected · {report.start} → {report.end}</h3>
          <div className="text-right">
            <p className="text-xs text-slate-400">Total tax collected</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{money(report.totalTaxCollected)}</p>
          </div>
        </div>
        {report.rows.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">No sales with tax in this range.</p>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr>
              <th className="text-left py-2">Period</th><th className="text-right py-2">Taxable sales</th><th className="text-right py-2">Tax collected</th><th className="text-right py-2">Sales</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.rows.map(r => (
                <tr key={r.key}>
                  <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{r.label}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(r.taxableSales)}</td>
                  <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{money(r.taxCollected)}</td>
                  <td className="py-2 text-right text-slate-400">{r.salesCount}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-slate-200 dark:border-slate-700 font-bold">
              <td className="py-2 text-slate-800 dark:text-slate-100">Total</td>
              <td className="py-2 text-right text-slate-800 dark:text-slate-100">{money(report.totalTaxableSales)}</td>
              <td className="py-2 text-right text-slate-800 dark:text-slate-100">{money(report.totalTaxCollected)}</td>
              <td className="py-2 text-right text-slate-500 dark:text-slate-400">{report.totalSalesCount}</td>
            </tr></tfoot>
          </table></div>
        )}
      </div>
    </div>
  );
};

/* ---------------- Date-range picker (shared) ---------------- */
const RangeControls: React.FC<{ start: string; end: string; setStart: (v: string) => void; setEnd: (v: string) => void; children?: React.ReactNode }> = ({ start, end, setStart, setEnd, children }) => (
  <div className="flex flex-wrap items-end gap-4">
    <div><label className={label}>From</label><input type="date" value={start} onChange={e => setStart(e.target.value)} className={input} /></div>
    <div><label className={label}>To</label><input type="date" value={end} onChange={e => setEnd(e.target.value)} className={input} /></div>
    {children}
  </div>
);

const PLRow: React.FC<{ label: string; value: number; negative?: boolean; bold?: boolean; total?: boolean }> = ({ label, value, negative, bold, total }) => (
  <div className={`flex items-center justify-between py-1.5 ${total ? 'border-t-2 border-slate-200 dark:border-slate-700 mt-1 pt-2' : ''}`}>
    <span className={`${bold || total ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>{label}</span>
    <span className={`tabular-nums ${bold || total ? 'font-bold' : ''} ${negative ? 'text-rose-600 dark:text-rose-400' : total && value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}>
      {negative ? `(${money(value)})` : money(value)}
    </span>
  </div>
);

/* ---------------- Profit & Loss ---------------- */
const ProfitLossTab: React.FC<{ plInput: ProfitLossInput }> = ({ plInput }) => {
  const [start, setStart] = useState(monthStartISO());
  const [end, setEnd] = useState(todayISO());
  const pl = useMemo(() => profitAndLoss(plInput, start, end), [plInput, start, end]);
  const exportCsv = () => triggerDownload(`profit-loss_${pl.start}_to_${pl.end}.csv`, toCSV(profitLossCsvRows(pl)), 'text/csv;charset=utf-8;');

  return (
    <div className="space-y-6">
      <div className={`${card} p-5`}>
        <RangeControls start={start} end={end} setStart={setStart} setEnd={setEnd}>
          <button onClick={exportCsv} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </RangeControls>
      </div>
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">Profit &amp; Loss · {pl.start} → {pl.end}</h3>
        <div className="text-sm">
          <PLRow label="Revenue" value={pl.revenue} />
          <PLRow label="Cost of goods sold" value={pl.costOfGoods} negative />
          <PLRow label="Gross profit" value={pl.grossProfit} bold />
          <PLRow label="Payroll" value={pl.payroll} negative />
          <PLRow label="Cash expenses" value={pl.cashExpenses} negative />
          <PLRow label="Runner commissions" value={pl.runnerCommissions} negative />
          <PLRow label="Net profit" value={pl.netProfit} total />
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Recognized sales only (voided, returned and not-yet-settled layaway sales excluded). Runner commissions are settlement fees only — the seller-purchase reimbursement is already in cost of goods.
        </p>
      </div>
    </div>
  );
};

/* ---------------- Runner settlement history ---------------- */
const SettlementsTab: React.FC<{ settlements: Settlement[]; runners: Runner[] }> = ({ settlements, runners }) => {
  const [start, setStart] = useState(monthStartISO());
  const [end, setEnd] = useState(todayISO());
  const h = useMemo(() => settlementHistory(settlements, runners, start, end), [settlements, runners, start, end]);
  const exportCsv = () => {
    const rows = h.lines.map(l => ({ Date: l.date, Runner: l.runnerName, 'Commission': l.totalFees.toFixed(2), 'Purchase reimbursed': l.totalFronted.toFixed(2), 'Total paid': l.amountPaid.toFixed(2) }));
    rows.push({ Date: 'Total', Runner: '', 'Commission': h.totalFees.toFixed(2), 'Purchase reimbursed': h.totalFronted.toFixed(2), 'Total paid': h.totalPaid.toFixed(2) });
    triggerDownload(`runner-settlements_${h.start}_to_${h.end}.csv`, toCSV(rows), 'text/csv;charset=utf-8;');
  };

  return (
    <div className="space-y-6">
      <div className={`${card} p-5`}>
        <RangeControls start={start} end={end} setStart={setStart} setEnd={setEnd}>
          <button onClick={exportCsv} disabled={h.count === 0} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </RangeControls>
      </div>

      <div className={`${card} p-5`}>
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Paid to runners · {h.start} → {h.end}</h3>
          <div className="text-right"><p className="text-xs text-slate-400">Total paid</p><p className="text-2xl font-bold text-slate-900 dark:text-white">{money(h.totalPaid)}</p></div>
        </div>
        {h.perRunner.length === 0 ? <p className="text-sm text-slate-400 py-6 text-center">No settlements in this range.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr>
              <th className="text-left py-2">Runner</th><th className="text-right py-2">Settlements</th><th className="text-right py-2">Commission</th><th className="text-right py-2">Reimbursed</th><th className="text-right py-2">Total paid</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {h.perRunner.map(r => (
                <tr key={r.runnerId}>
                  <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{r.runnerName}</td>
                  <td className="py-2 text-right text-slate-400">{r.settlementCount}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(r.totalFees)}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(r.totalFronted)}</td>
                  <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{money(r.totalPaid)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-slate-200 dark:border-slate-700 font-bold">
              <td className="py-2 text-slate-800 dark:text-slate-100">Total</td><td></td>
              <td className="py-2 text-right text-slate-800 dark:text-slate-100">{money(h.totalFees)}</td>
              <td className="py-2 text-right text-slate-800 dark:text-slate-100">{money(h.totalFronted)}</td>
              <td className="py-2 text-right text-slate-800 dark:text-slate-100">{money(h.totalPaid)}</td>
            </tr></tfoot>
          </table></div>
        )}
      </div>

      {h.lines.length > 0 && (
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">Individual settlements</h3>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr>
              <th className="text-left py-2">Date</th><th className="text-left py-2">Runner</th><th className="text-right py-2">Commission</th><th className="text-right py-2">Reimbursed</th><th className="text-right py-2">Total paid</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {h.lines.map(l => (
                <tr key={l.id}>
                  <td className="py-2 text-slate-500 dark:text-slate-400">{l.date}</td>
                  <td className="py-2 text-slate-700 dark:text-slate-200">{l.runnerName}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(l.totalFees)}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(l.totalFronted)}</td>
                  <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{money(l.amountPaid)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
};

/* ---------------- Year-end accountant export ---------------- */
const YearEndTab: React.FC<{ plInput: ProfitLossInput }> = ({ plInput }) => {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const summary = useMemo(() => yearEndSummary(plInput, year), [plInput, year]);
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);
  const exportCsv = () => triggerDownload(`year-end-summary_${year}.csv`, toCSV(yearEndCsvRows(summary)), 'text/csv;charset=utf-8;');

  const rows: { label: string; value: number; strong?: boolean }[] = [
    { label: 'Revenue', value: summary.revenue },
    { label: 'Cost of goods sold', value: summary.costOfGoods },
    { label: 'Gross profit', value: summary.grossProfit, strong: true },
    { label: 'Payroll paid', value: summary.payrollPaid },
    { label: 'Cash expenses', value: summary.cashExpenses },
    { label: 'Runner commissions', value: summary.runnerCommissions },
    { label: 'Net profit', value: summary.netProfit, strong: true },
    { label: 'Sales tax collected', value: summary.salesTaxCollected },
  ];

  return (
    <div className="space-y-6">
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className={label}>Year</label>
            <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))} className={input}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button onClick={exportCsv} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-400">One consolidated annual summary to hand to your accountant — revenue, profit, payroll, cash expenses, runner commissions and sales tax collected for {year}.</p>
      </div>
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">{year} year-end summary</h3>
        <div className="text-sm">
          {rows.map(r => (
            <div key={r.label} className="flex items-center justify-between py-1.5">
              <span className={r.strong ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}>{r.label}</span>
              <span className={`tabular-nums ${r.strong ? 'font-bold' : ''} text-slate-800 dark:text-slate-100`}>{money(r.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
