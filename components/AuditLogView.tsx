import React, { useMemo, useState } from 'react';
import { ScrollText, Search, X, Download, ShieldAlert } from 'lucide-react';
import { AuditEntry, AppUser } from '../types';
import { auditActionLabel, auditChangeSummary, auditExportRows, isCriticalAuditAction } from '../domain/audit';
import { toCSV, triggerDownload } from '../services/backup';

interface Props {
  logs: AuditEntry[];
  users: AppUser[];
  onLoadMore?: () => void;   // widen the fetch to include older entries
  hasMore?: boolean;         // more older entries exist beyond what's loaded
}

export const AuditLogView: React.FC<Props> = ({ logs, users, onLoadMore, hasMore }) => {
  const [q, setQ] = useState('');
  const [userId, setUserId] = useState('all');
  const [action, setAction] = useState('all');
  const [entity, setEntity] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);

  const actions = useMemo(() => Array.from(new Set(logs.map(l => l.action))).sort(), [logs]);
  const entities = useMemo(() => Array.from(new Set(logs.map(l => l.entityType))).sort(), [logs]);

  const filtered = useMemo(() => {
    const term = q.toLowerCase().trim();
    const fromTs = from ? new Date(from).getTime() : -Infinity;
    const toTs = to ? new Date(to).getTime() + 86400000 : Infinity;
    return logs
      .filter(l => userId === 'all' || l.userId === userId)
      .filter(l => action === 'all' || l.action === action)
      .filter(l => entity === 'all' || l.entityType === entity)
      .filter(l => !criticalOnly || isCriticalAuditAction(l.action))
      .filter(l => l.ts >= fromTs && l.ts <= toTs)
      .filter(l => !term || [l.userEmail, l.action, auditActionLabel(l.action), l.entityType, l.entityId].some(v => (v || '').toLowerCase().includes(term)))
      .sort((a, b) => b.ts - a.ts);
  }, [logs, q, userId, action, entity, criticalOnly, from, to]);

  const exportCsv = () => {
    triggerDownload(`audit-log-${new Date().toISOString().split('T')[0]}.csv`, toCSV(auditExportRows(filtered)), 'text/csv;charset=utf-8;');
  };

  const sel = 'p-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm';
  const fmt = (ts: number) => new Date(ts).toLocaleString();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><ScrollText className="w-6 h-6 text-indigo-500" /> Audit Logs</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Every important action, who did it, and when.</p>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search email, action, entity…"
            className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
        </div>
        <select value={userId} onChange={e => setUserId(e.target.value)} className={sel}>
          <option value="all">All users</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
        </select>
        <select value={action} onChange={e => setAction(e.target.value)} className={sel}>
          <option value="all">All actions</option>
          {actions.map(a => <option key={a} value={a}>{auditActionLabel(a)}</option>)}
        </select>
        <select value={entity} onChange={e => setEntity(e.target.value)} className={sel}>
          <option value="all">All entities</option>
          {entities.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={sel} title="From date" />
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={sel} title="To date" />
        <button onClick={() => setCriticalOnly(v => !v)} title="Sensitive actions only: voids/returns, PIN/role/profit-access changes, drawer reconciliation, settings changes"
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border ${criticalOnly ? 'bg-amber-500 text-white border-amber-500' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-amber-400'}`}>
          <ShieldAlert className="w-4 h-4" /> Critical actions
        </button>
        {(q || userId !== 'all' || action !== 'all' || entity !== 'all' || criticalOnly || from || to) && (
          <button onClick={() => { setQ(''); setUserId('all'); setAction('all'); setEntity('all'); setCriticalOnly(false); setFrom(''); setTo(''); }}
            className="flex items-center gap-1 px-2 py-2 text-slate-400 hover:text-slate-600 text-sm"><X className="w-4 h-4" /> Clear</button>
        )}
        <button onClick={exportCsv} disabled={filtered.length === 0}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed ml-auto">
          <Download className="w-4 h-4" /> Export CSV
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar max-h-[65vh]">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0 z-10">
              <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold text-left">
                <th className="px-3 py-2.5">When</th>
                <th className="px-3 py-2.5">User</th>
                <th className="px-3 py-2.5">Action</th>
                <th className="px-3 py-2.5">Entity</th>
                <th className="px-3 py-2.5">Entity ID</th>
                <th className="px-3 py-2.5">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.length === 0 && <tr><td colSpan={6} className="text-center text-slate-400 py-8">No audit entries.</td></tr>}
              {filtered.slice(0, 500).map(l => (
                <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500 dark:text-slate-400">{fmt(l.ts)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-700 dark:text-slate-200">{l.userEmail}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><span title={l.action} className="px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{auditActionLabel(l.action)}</span></td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600 dark:text-slate-300">{l.entityType}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-slate-400">{l.entityId || '—'}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400 max-w-xs truncate" title={auditChangeSummary(l.before, l.after) ?? [l.before && `before: ${JSON.stringify(l.before)}`, l.after && `after: ${JSON.stringify(l.after)}`].filter(Boolean).join('  ')}>
                    {auditChangeSummary(l.before, l.after) ?? (l.before || l.after ? [l.before && 'before', l.after && 'after'].filter(Boolean).join(' + ') + ' (complex — hover for JSON)' : '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {onLoadMore && hasMore && (
          <div className="pt-3 text-center">
            <button onClick={onLoadMore} className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300">
              Load older entries
            </button>
            <p className="mt-1 text-[11px] text-slate-400">Recent entries load first; older audit history loads on demand.</p>
          </div>
        )}
      </div>
    </div>
  );
};
