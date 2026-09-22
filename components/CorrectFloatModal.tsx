import React, { useState } from 'react';
import { X, Wrench, AlertTriangle } from 'lucide-react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { selectOnFocus } from '../hooks/selectOnFocus';

/**
 * PUTTING A WRONG FLOAT RIGHT — once, on the record.
 *
 * A float that snowballed (every day's takings rolling into the next morning)
 * cannot be fixed by editing history: the past days were closed with the
 * figures they were closed with, and quietly restating them would change
 * totals somebody has already read. So this corrects TODAY, and records the
 * correction as an adjustment entry carrying the reason and both figures.
 *
 * Owner only, and the reason is required — an unexplained $11,565 write-down
 * is exactly the kind of entry that should never be possible to make silently.
 */

interface Props {
  currentFloat: number;
  onClose: () => void;
  onCorrect: (newFloat: number, reason: string) => void;
}

const money = (n: number) => `$${(n || 0).toFixed(2)}`;
const input = 'w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';

export const CorrectFloatModal: React.FC<Props> = ({ currentFloat, onClose, onCorrect }) => {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const num = parseFloat(value);
  const hasValue = value.trim() !== '' && isFinite(num) && num >= 0;
  const canSave = hasValue && !!reason.trim();
  const delta = hasValue ? Math.round((currentFloat - num) * 100) / 100 : 0;

  useEscapeKey(onClose);

  const submit = () => {
    if (!canSave) return;
    onCorrect(Math.round(num * 100) / 100, reason.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Wrench className="w-4 h-4" /> Correct today's float</h2>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            This changes <strong>today's</strong> float only. No past day is altered and no closed figure is restated — the
            correction is written to today's Money Trail with your reason attached.
          </p>

          <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs text-slate-500 dark:text-slate-400 flex justify-between">
            <span>Float now</span><span className="font-bold text-slate-700 dark:text-slate-200">{money(currentFloat)}</span>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">What is actually in the drawer as float ($)</label>
            <input autoFocus type="number" min="0" step="0.01" value={value} onChange={e => setValue(e.target.value)}
              onFocus={selectOnFocus}
              onKeyDown={e => { if (e.key === 'Enter' && canSave) submit(); }} placeholder="0.00" className={input} />
          </div>

          {hasValue && Math.abs(delta) >= 0.005 && (
            <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {delta > 0
                ? `Writing the float down by ${money(delta)}.`
                : `Writing the float up by ${money(Math.abs(delta))}.`}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Reason (required)</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
              placeholder="e.g. float had been carrying daily takings forward since June"
              className={`${input} resize-y ${!reason.trim() ? 'ring-1 ring-amber-300' : ''}`} />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={submit} disabled={!canSave} title={!reason.trim() ? 'A reason is required' : undefined}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">Record correction</button>
        </div>
      </div>
    </div>
  );
};
