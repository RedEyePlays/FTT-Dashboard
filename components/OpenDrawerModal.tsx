import React, { useState } from 'react';
import { X, DoorOpen } from 'lucide-react';

interface Props {
  onClose: () => void;
  onOpen: (openingFloat: number) => void;
  defaultFloat?: number;   // pre-fills the input (shop's usual starting float)
  alreadyOpen?: boolean;   // drawer was already opened today
  currentFloat?: number;   // the float it was opened with (when alreadyOpen)
}

// Start-of-day step: record the actual starting cash in the drawer, instead of
// the reconciliation screen silently assuming a default. Available to anyone who
// runs the register (cash.log). Re-opening just corrects the recorded float.
const input = 'w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
const money = (n: number) => `$${(n || 0).toFixed(2)}`;

export const OpenDrawerModal: React.FC<Props> = ({ onClose, onOpen, defaultFloat = 0, alreadyOpen, currentFloat }) => {
  const [amount, setAmount] = useState(alreadyOpen ? String(currentFloat ?? '') : (defaultFloat ? String(defaultFloat) : ''));
  const amountNum = parseFloat(amount) || 0;
  const submit = () => { onOpen(Math.round(amountNum * 100) / 100); onClose(); };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><DoorOpen className="w-4 h-4" /> {alreadyOpen ? 'Adjust starting float' : 'Open drawer'}</h2>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-400">
            {alreadyOpen
              ? `The drawer was already opened today with ${money(currentFloat || 0)}. Change the starting float if it was recorded wrong.`
              : 'Count the cash in the drawer at the start of the day and enter it here. This is the float everything else is measured against at close.'}
          </p>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Starting float ($)</label>
            <input autoFocus type="number" min="0" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit(); }} placeholder="0.00" className={input} />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={submit} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white">{alreadyOpen ? 'Update float' : `Open with ${money(amountNum)}`}</button>
        </div>
      </div>
    </div>
  );
};
