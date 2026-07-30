import React, { useState } from 'react';
import { X, Wallet, ArrowUpFromLine, Banknote } from 'lucide-react';

export type CashMovementKind = 'cashOut' | 'withdrawal';

interface Props {
  onClose: () => void;
  onLog: (m: { kind: CashMovementKind; amount: number; note?: string }) => void;
}

// Quick, in-the-moment logging of cash leaving the register — a paid cash expense
// or an owner till-pull/deposit — available to anyone who handles the drawer
// (gated by cash.log). It records a single movement against today's drawer; the
// full reconciliation report (variance review) is a separate, manager-only screen.
const input = 'w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';

export const LogCashMovementModal: React.FC<Props> = ({ onClose, onLog }) => {
  const [kind, setKind] = useState<CashMovementKind>('cashOut');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const amountNum = parseFloat(amount) || 0;

  const submit = () => {
    if (amountNum <= 0) return;
    onLog({ kind, amount: Math.round(amountNum * 100) / 100, note: note.trim() || undefined });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Wallet className="w-4 h-4" /> Log cash movement</h2>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setKind('cashOut')}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border ${kind === 'cashOut' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
              <Banknote className="w-4 h-4" /> Cash out
            </button>
            <button onClick={() => setKind('withdrawal')}
              className={`flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border ${kind === 'withdrawal' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
              <ArrowUpFromLine className="w-4 h-4" /> Withdrawal
            </button>
          </div>
          <p className="text-xs text-slate-400 -mt-2">
            {kind === 'cashOut' ? 'A cash expense paid out of the drawer (e.g. paid a runner).' : 'An owner till-pull or bank deposit.'}
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Amount ($)</label>
            <input autoFocus type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }} placeholder="0.00" className={input} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{kind === 'cashOut' ? 'Reason' : 'Note'} (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              placeholder={kind === 'cashOut' ? 'e.g. paid runner COD' : 'e.g. bank deposit'} className={input} />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={submit} disabled={amountNum <= 0} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">Log ${amountNum.toFixed(2)}</button>
        </div>
      </div>
    </div>
  );
};
