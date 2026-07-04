import React, { useState } from 'react';
import { DatabaseBackup, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react';

interface Props {
  lastBackup?: number;
  onExportJson: () => Promise<void>;
  onExportCsv: () => Promise<void>;
}

// Owner-only Firestore backup/export section (rendered inside Settings).
export const BackupPanel: React.FC<Props> = ({ lastBackup, onExportJson, onExportCsv }) => {
  const [busy, setBusy] = useState<null | 'json' | 'csv'>(null);
  const run = async (kind: 'json' | 'csv', fn: () => Promise<void>) => {
    setBusy(kind);
    try { await fn(); } finally { setBusy(null); }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 rounded-lg"><DatabaseBackup className="w-5 h-5" /></div>
        <div>
          <h3 className="font-medium text-slate-900 dark:text-white">Backups (Firestore)</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Export the full database. Last backup: {lastBackup ? new Date(lastBackup).toLocaleString() : 'never'}
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => run('json', onExportJson)} disabled={!!busy}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm font-medium disabled:opacity-50">
          {busy === 'json' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileJson className="w-4 h-4" />} Export JSON
        </button>
        <button onClick={() => run('csv', onExportCsv)} disabled={!!busy}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm font-medium disabled:opacity-50">
          {busy === 'csv' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} Export CSVs
        </button>
      </div>
      <div className="bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg border border-amber-100 dark:border-amber-900/20">
        <p className="text-xs text-amber-800 dark:text-amber-500">
          Automatic scheduled backups aren't included: they require a server-side runner (Cloud Functions + Cloud Scheduler, or GCP's managed Firestore export). Doing it from the browser would need privileged credentials, which must never ship in frontend code.
        </p>
      </div>
    </div>
  );
};
