import React, { useState } from 'react';
import { X, Lock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { CashDrawerSummary, reconcileCash } from '../domain/reports';

interface Props {
  onClose: () => void;
  onCloseDrawer: (countedCash: number, note?: string) => void;
  summary: CashDrawerSummary;              // today's live expected-cash breakdown
  alreadyReconciled?: { countedCash: number; variance: number; byEmail?: string; at: number };
}

const money = (n: number) => `$${(n || 0).toFixed(2)}`;
const input = 'w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';

// End-of-day close, right from the register (not buried in Reports). Counts the
// drawer against the same expected figure the POS panel already shows, and
// reconciles in one step — the full history/edit form stays in Reports > Cash
// for anyone who needs to revisit a past day. Owner/manager only (cash.reconcile),
// rendered from CashDrawerPanel only when that permission is present.
export const CloseDrawerModal: React.FC<Props> = ({ onClose, onCloseDrawer, summary, alreadyReconciled }) => {
  const [counted, setCounted] = useState(alreadyReconciled ? String(alreadyReconciled.countedCash) : '');
  const [note, setNote] = useState('');
  const countedNum = parseFloat(counted);
  const hasCount = counted.trim() !== '' && isFinite(countedNum);
  const { variance, direction } = reconcileCash(hasCount ? countedNum : 0, summary.expected);
  const needsNote = hasCount && direction !== 'balanced' && !note.trim();
  const canSave = hasCount && !needsNote;

  const submit = () => {
    if (!canSave) return;
    onCloseDrawer(Math.round(countedNum * 100) / 100, note.trim() || undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Lock className="w-4 h-4" /> Close drawer</h2>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          {!summary.opened && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> The drawer was never opened today, so no starting float was recorded — closing now assumes a $0 float.
            </div>
          )}
          {alreadyReconciled && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
              Already closed today by {alreadyReconciled.byEmail || 'someone'} at {new Date(alreadyReconciled.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — saving again updates that record.
            </div>
          )}

          <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <div className="flex justify-between"><span>Float</span><span>{money(summary.openingFloat)}</span></div>
            <div className="flex justify-between"><span>+ Cash sales</span><span>{money(summary.cashSales)}</span></div>
            {summary.cashIn > 0 && <div className="flex justify-between"><span>+ Cash in</span><span>{money(summary.cashIn)}</span></div>}
            {summary.cashOut > 0 && <div className="flex justify-between"><span>− Cash out</span><span>{money(summary.cashOut)}</span></div>}
            {summary.withdrawals > 0 && <div className="flex justify-between"><span>− Withdrawn</span><span>{money(summary.withdrawals)}</span></div>}
            <div className="flex justify-between pt-1 border-t border-slate-200 dark:border-slate-700 font-bold text-slate-700 dark:text-slate-200"><span>Expected</span><span>{money(summary.expected)}</span></div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Counted cash in till ($)</label>
            <input autoFocus type="number" min="0" step="0.01" value={counted} onChange={e => setCounted(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canSave) submit(); }} placeholder="0.00" className={input} />
          </div>

          {hasCount && (
            <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
              direction === 'balanced' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'}`}>
              {direction === 'balanced'
                ? <><CheckCircle2 className="w-4 h-4" /> Balanced.</>
                : <><AlertTriangle className="w-4 h-4" /> {direction === 'over' ? 'Over' : 'Short'} by {money(Math.abs(variance))}.</>}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Note {hasCount && direction !== 'balanced' ? '(required — explain the variance)' : '(optional)'}</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. $5 miscounted at open"
              className={`${input} resize-y ${needsNote ? 'ring-2 ring-amber-400 border-amber-400' : ''}`} />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={submit} disabled={!canSave} title={needsNote ? 'Add a note explaining the variance first' : undefined}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">Close drawer</button>
        </div>
      </div>
    </div>
  );
};
