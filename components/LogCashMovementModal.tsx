import React, { useState } from 'react';
import { X, Wallet, ArrowUpFromLine, ArrowDownToLine, Banknote } from 'lucide-react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { selectOnFocus } from '../hooks/selectOnFocus';

export type CashMovementKind = 'cashIn' | 'cashOut' | 'withdrawal';

interface Props {
  onClose: () => void;
  onLog: (m: { kind: CashMovementKind; amount: number; note?: string }) => void;
  initialKind?: CashMovementKind;
  // Today's expected cash right now, so the person logging sees the running total
  // update as they go (computed once by the app from the shared drawer summary).
  expectedBefore?: number;
}

// Quick, in-the-moment logging of a cash movement in the register drawer —
// cash added (top-up / tip / off-sale payment), a paid cash expense, or an owner
// till-pull/deposit — available to anyone who handles the drawer (gated by
// cash.log). It records a single movement against today's drawer; the full
// reconciliation (variance review) is a separate, manager-only screen.
const input = 'w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';

const KINDS: { value: CashMovementKind; label: string; icon: React.ReactNode; help: string; sign: 1 | -1 }[] = [
  { value: 'cashIn', label: 'Cash in', icon: <ArrowDownToLine className="w-4 h-4" />, sign: 1,
    help: 'Cash added to the drawer — a change-fund top-up, a tip, or a cash payment taken outside a normal sale. Adds to expected cash.' },
  { value: 'cashOut', label: 'Cash out', icon: <Banknote className="w-4 h-4" />, sign: -1,
    help: 'A cash expense paid out of the drawer (e.g. paid a courier COD, bought supplies). Subtracts from expected cash.' },
  { value: 'withdrawal', label: 'Withdrawal', icon: <ArrowUpFromLine className="w-4 h-4" />, sign: -1,
    help: 'An owner till-pull or bank deposit — cash moved out of the drawer to the safe or bank (not an expense). Subtracts from expected cash.' },
];

const money = (n: number) => `$${(n || 0).toFixed(2)}`;

export const LogCashMovementModal: React.FC<Props> = ({ onClose, onLog, initialKind = 'cashOut', expectedBefore }) => {
  const [kind, setKind] = useState<CashMovementKind>(initialKind);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const amountNum = parseFloat(amount) || 0;
  const active = KINDS.find(k => k.value === kind)!;
  const expectedAfter = expectedBefore != null ? expectedBefore + active.sign * amountNum : undefined;

  useEscapeKey(onClose);

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
          <div className="grid grid-cols-3 gap-2">
            {KINDS.map(k => (
              <button key={k.value} onClick={() => setKind(k.value)}
                className={`flex flex-col items-center justify-center gap-1 py-2.5 rounded-lg text-xs font-medium border ${kind === k.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
                {k.icon} {k.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-400 -mt-2">{active.help}</p>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Amount ($)</label>
            <input autoFocus type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              onFocus={selectOnFocus}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }} placeholder="0.00" className={input} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{kind === 'cashOut' ? 'Reason' : 'Note'} (optional)</label>
            <input value={note} onChange={e => setNote(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }}
              placeholder={kind === 'cashIn' ? 'e.g. change top-up' : kind === 'cashOut' ? 'e.g. paid device buyer COD' : 'e.g. bank deposit'} className={input} />
          </div>
          {expectedBefore != null && (
            <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
              <span>Expected in drawer</span>
              <span className="tabular-nums">{money(expectedBefore)}{amountNum > 0 && expectedAfter != null ? <span className="text-slate-700 dark:text-slate-200 font-semibold"> → {money(expectedAfter)}</span> : ''}</span>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={submit} disabled={amountNum <= 0} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">Log {money(amountNum)}</button>
        </div>
      </div>
    </div>
  );
};
