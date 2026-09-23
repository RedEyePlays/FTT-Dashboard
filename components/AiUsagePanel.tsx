import React, { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { UsageDay, loadAiUsage } from '../services/aiChats';
import { writeErrorMessage } from '../domain/writeErrors';

/**
 * WHAT THE SHOP IS SPENDING ON AI.
 *
 * Loaded ON DEMAND, never on render: this is a settings panel somebody opens
 * occasionally, and a read that fires every time the Settings page mounts is
 * the same reflex that produced the bug this whole change is about.
 *
 * The figures are counts of REQUESTS, not dollars. The shop's actual bill
 * depends on the provider's pricing and on how long each answer was, and a
 * dollar figure computed here would be a guess wearing a currency symbol.
 */

const OP_LABEL: Record<string, string> = {
  chat: 'Assistant',
  insights: 'Insights',
  bulkParse: 'Bulk entry',
  imeiExtract: 'IMEI scanning',
  listing: 'Listing writer',
  gpuPerformance: 'GPU benchmarks',
};

export const AiUsagePanel: React.FC<{ workspaceId?: string; cap: number }> = ({ workspaceId, cap }) => {
  const [days, setDays] = useState<UsageDay[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      setDays(await loadAiUsage(workspaceId));
    } catch (e) {
      setError(writeErrorMessage(e, 'Could not read the usage counters.'));
    } finally {
      setBusy(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const rows = days || [];
  const todayTotal = rows.find(d => d.day === today)?.total ?? 0;
  const monthRows = rows.filter(d => d.day.startsWith(month));
  const monthTotal = monthRows.reduce((n, d) => n + d.total, 0);
  const byOp: Record<string, number> = {};
  for (const d of monthRows) {
    for (const [op, n] of Object.entries(d.byOp || {})) byOp[op] = (byOp[op] || 0) + n;
  }

  return (
    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-200">AI usage</p>
          <p className="text-xs text-slate-400">Requests made, by day and by feature. Not a dollar figure — see below.</p>
        </div>
        <button onClick={() => void load()} disabled={busy || !workspaceId}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 disabled:opacity-40">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          {days ? 'Refresh' : 'Show usage'}
        </button>
      </div>

      {error && <p className="text-xs text-rose-600 dark:text-rose-400 mt-2">{error}</p>}

      {days && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">Today</p>
              <p className="text-lg font-bold text-slate-900 dark:text-white">
                {todayTotal}<span className="text-sm font-normal text-slate-400"> / {cap}</span>
              </p>
              {todayTotal >= cap && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">Limit reached — resets at midnight UTC.</p>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-400">This month</p>
              <p className="text-lg font-bold text-slate-900 dark:text-white">{monthTotal}</p>
            </div>
          </div>

          {Object.keys(byOp).length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">By feature, this month</p>
              <div className="space-y-1">
                {Object.entries(byOp).sort((a, b) => b[1] - a[1]).map(([op, n]) => (
                  <div key={op} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-300">{OP_LABEL[op] || op}</span>
                    <span className="font-semibold text-slate-900 dark:text-white">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {rows.length === 0 && <p className="text-sm text-slate-400">No AI requests recorded yet.</p>}
          <p className="text-[11px] text-slate-400">
            Counts are per request, not per dollar — what a request costs depends on how much was sent and
            how long the answer was. The daily limit above is what actually stops spending.
          </p>
        </div>
      )}
    </div>
  );
};
