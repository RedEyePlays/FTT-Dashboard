import React, { useState } from 'react';
import { AlertTriangle, ShieldAlert, Loader2, CheckCircle2 } from 'lucide-react';
import { AppData } from '../types';
import { backupSummary } from '../domain/restore';
import { useEscapeKey } from '../hooks/useEscapeKey';

const REPLACE_PHRASE = 'DELETE MY DATA';

const COLLECTION_LABEL: Record<string, string> = {
  inventory: 'inventory items', notes: 'notes', tasks: 'to-do tasks', customers: 'customers',
  salesTransactions: 'sales', repairs: 'repairs', repairBatches: 'repair batches',
  // Key = the Firestore collection name, deliberately still 'runners' (see
  // COLLECTIONS in services/firestoreDb.ts); label = the current UI term.
  runners: 'device buyers', dropOffs: 'drop-offs', settlements: 'settlements',
};

interface Props {
  data: AppData;
  /** Milliseconds since epoch, or undefined for a backup file with no usable timestamp (the simple "Download Backup" shape). */
  exportedAtMs?: number;
  onCancel: () => void;
  /** Performs the safety snapshot + actual write. Rejecting leaves the modal in its error state. */
  onConfirm: (mode: 'merge' | 'replace') => Promise<void>;
}

/**
 * The scary confirmation a destructive restore deserves. Replaces a
 * one-line `confirm()` — trivially reflex-dismissed with the same "OK" a
 * user has muscle-memory for from a hundred harmless dialogs — with a real
 * modal that (a) defaults to the non-destructive merge option, (b) makes the
 * consequence of the destructive option impossible to miss, and (c) gates
 * the destructive option behind typing an exact phrase, not a click.
 */
export const RestoreConfirmModal: React.FC<Props> = ({ data, exportedAtMs, onCancel, onConfirm }) => {
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [typedPhrase, setTypedPhrase] = useState('');
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEscapeKey(() => { if (status !== 'working') onCancel(); });

  const summary = backupSummary(data);
  const summaryEntries = Object.entries(summary);
  const canConfirm = mode === 'merge' || typedPhrase.trim() === REPLACE_PHRASE;

  const handleConfirm = async () => {
    if (!canConfirm || status === 'working') return;
    setStatus('working');
    setError(null);
    try {
      await onConfirm(mode);
    } catch (e: any) {
      setStatus('error');
      setError(e?.message || 'Restore failed. Nothing further was changed.');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-rose-200 dark:border-rose-900/50 max-h-[90vh] overflow-y-auto custom-scrollbar">
        <div className="px-6 py-4 border-b border-rose-100 dark:border-rose-900/30 bg-rose-50 dark:bg-rose-900/20 flex items-center gap-2">
          <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
          <h2 className="text-lg font-bold text-rose-800 dark:text-rose-300">Restore data — read this first</h2>
        </div>

        <div className="p-6 space-y-5">
          <div className="text-sm text-slate-600 dark:text-slate-300 space-y-1.5">
            <p>
              <span className="font-semibold text-slate-800 dark:text-slate-100">Backup taken:</span>{' '}
              {exportedAtMs
                ? new Date(exportedAtMs).toLocaleString()
                : <span className="italic text-slate-400">unknown (this file's format doesn't carry a date)</span>}
            </p>
            {summaryEntries.length > 0 ? (
              <p>
                <span className="font-semibold text-slate-800 dark:text-slate-100">Contains:</span>{' '}
                {summaryEntries.map(([k, n]) => `${n} ${COLLECTION_LABEL[k] || k}`).join(', ')}
              </p>
            ) : (
              <p className="italic text-amber-600 dark:text-amber-400">This file has no records in any recognized collection.</p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700 overflow-hidden">
            <label className={`flex items-start gap-3 p-3 cursor-pointer ${mode === 'merge' ? 'bg-emerald-50 dark:bg-emerald-900/20' : ''}`}>
              <input type="radio" name="restore-mode" className="mt-1" checked={mode === 'merge'} onChange={() => setMode('merge')} />
              <span>
                <span className="block text-sm font-semibold text-emerald-700 dark:text-emerald-400">Merge (recommended)</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Adds and updates records from the backup. Nothing currently in your data is deleted, even if it's missing from the backup.
                </span>
              </span>
            </label>
            <label className={`flex items-start gap-3 p-3 cursor-pointer ${mode === 'replace' ? 'bg-rose-50 dark:bg-rose-900/20' : ''}`}>
              <input type="radio" name="restore-mode" className="mt-1" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span>
                <span className="block text-sm font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" /> Replace all — destructive
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Makes your data match this backup EXACTLY. Any record created since this backup was taken — every sale, repair, customer, inventory item — is permanently deleted. This cannot be undone.
                </span>
              </span>
            </label>
          </div>

          {mode === 'replace' && (
            <div className="rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-900/20 p-3 space-y-2">
              <p className="text-xs font-semibold text-rose-800 dark:text-rose-300">
                To confirm, type <span className="font-mono bg-rose-100 dark:bg-rose-900/50 px-1 rounded">{REPLACE_PHRASE}</span> below:
              </p>
              <input
                autoFocus
                value={typedPhrase}
                onChange={e => setTypedPhrase(e.target.value)}
                placeholder={REPLACE_PHRASE}
                disabled={status === 'working'}
                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-rose-300 dark:border-rose-700 rounded-lg text-sm font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>
          )}

          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-500" />
            Before anything changes, a full backup of your CURRENT data is downloaded automatically — a recovery point if this restore turns out to be a mistake.
          </p>

          {error && (
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 text-xs bg-rose-50 dark:bg-rose-900/20 p-3 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {error}
            </div>
          )}

          {status === 'working' && (
            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 text-xs bg-indigo-50 dark:bg-indigo-900/20 p-3 rounded-lg">
              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" /> Saving a safety backup of current data, then restoring…
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onCancel}
              disabled={status === 'working'}
              className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canConfirm || status === 'working'}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${mode === 'replace' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
            >
              {status === 'working'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : mode === 'replace' ? <AlertTriangle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
              {mode === 'replace' ? 'Permanently replace all data' : 'Merge backup into current data'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
