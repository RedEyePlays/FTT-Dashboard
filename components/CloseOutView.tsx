import React, { useMemo } from 'react';
import {
  ClipboardCheck, DollarSign, TrendingUp, Wrench, LockOpen, AlertTriangle, CheckCircle2, ArrowRight,
} from 'lucide-react';
import {
  SalesTransaction, Repair, InventoryItem, Customer, AuditEntry, ActivityEntry,
  TimeEntry, AppUser, CashReconciliation, ViewState,
} from '../types';
import { computeAnalytics, presetRange } from '../domain/analytics';
import { CashDrawerSummary } from '../domain/reports';
import { missedClockOuts } from '../domain/timeclock';
import { Alert } from '../domain/alerts';

interface Props {
  salesTransactions: SalesTransaction[];
  repairs: Repair[];
  inventory: InventoryItem[];
  customers: Customer[];
  auditLogs: AuditEntry[];
  activity: ActivityEntry[];
  timeEntries: TimeEntry[];
  users: AppUser[];
  // Reused, not recomputed: the same alert set the notifications bell already
  // shows (low stock, overdue/awaiting-pickup repairs, aging inventory), and the
  // same live drawer figures the POS panel and cash reconciliation screen use.
  alerts: Alert[];
  todayDrawer: CashDrawerSummary;
  todayRecon?: CashReconciliation;
  onNavigate: (v: ViewState) => void;
}

const money = (n: number) => `$${(n || 0).toFixed(2)}`;
const nameOf = (u: AppUser) => u.email.split('@')[0];

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 ${className || ''}`}>{children}</div>
);

export const CloseOutView: React.FC<Props> = ({
  salesTransactions, repairs, inventory, customers, auditLogs, activity, timeEntries, users,
  alerts, todayDrawer, todayRecon, onNavigate,
}) => {
  const now = Date.now();

  // Today's sales + profit + repairs completed — the exact same end-of-day
  // figures Owner Analytics computes, not a second calculation of them.
  const range = useMemo(() => presetRange('today', now), [now]);
  const a = useMemo(
    () => computeAnalytics(range, { salesTransactions, repairs, inventory, customers, auditLogs, activity }, now),
    [range, salesTransactions, repairs, inventory, customers, auditLogs, activity, now],
  );
  const eod = a.eod;

  const missed = useMemo(() => missedClockOuts(timeEntries, now), [timeEntries, now]);
  const nameById = useMemo(() => new Map(users.map(u => [u.id, nameOf(u)])), [users]);

  const reconciled = !!todayRecon?.reconciledAt;
  const variance = todayRecon?.variance || 0;
  const varianceOk = Math.abs(variance) < 0.005;

  // Every open-loop item worth a glance before locking up: the standing alert
  // set already shown elsewhere, plus the two close-out-specific ones (missed
  // clock-outs, an unreconciled drawer).
  const flags: { text: string; severity: 'warning' | 'info'; view: ViewState }[] = [
    ...missed.map(e => ({ text: `${nameById.get(e.userId) || e.userId} never clocked out (${new Date(e.clockIn).toLocaleDateString()})`, severity: 'warning' as const, view: 'timeclock' as ViewState })),
    ...(todayDrawer.opened && !reconciled ? [{ text: 'Cash drawer not reconciled yet today', severity: 'warning' as const, view: 'reports' as ViewState }] : []),
    ...(!todayDrawer.opened ? [{ text: 'Cash drawer was never opened today', severity: 'info' as const, view: 'pos' as ViewState }] : []),
    ...alerts.map(al => ({ text: al.text, severity: al.severity, view: al.view })),
  ];

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-indigo-500" /> Close Out
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          A one-glance summary of today before locking up — {eod.label.toLowerCase()}, {new Date(now).toLocaleDateString()}.
        </p>
      </div>

      {/* --- Today's sales -------------------------------------------------- */}
      <Card>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4 text-indigo-500" /> Today's Sales</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Sales" value={String(eod.sales)} />
          <Stat label="Revenue" value={money(eod.revenue)} />
          <Stat label="Gross Profit" value={money(eod.grossProfit)} tone={eod.grossProfit >= 0 ? 'good' : 'bad'} />
          <Stat label="Repairs Completed" value={String(eod.repairsCompleted)} />
        </div>
      </Card>

      {/* --- Cash reconciliation -------------------------------------------- */}
      <Card>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-3"><DollarSign className="w-4 h-4 text-indigo-500" /> Cash Drawer</h3>
        {!todayDrawer.opened ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" /> Drawer was never opened today.
          </div>
        ) : reconciled ? (
          <div className="flex flex-wrap items-center gap-4">
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${varianceOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {varianceOk ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              Reconciled{varianceOk ? ' — balanced' : ` — ${variance > 0 ? 'over' : 'short'} ${money(Math.abs(variance))}`}
            </span>
            <span className="text-xs text-slate-400">Expected {money(todayDrawer.expected)} · Counted {money(todayRecon?.countedCash || 0)}</span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400"><LockOpen className="w-4 h-4" /> Not reconciled yet — expected {money(todayDrawer.expected)}</span>
            <button onClick={() => onNavigate('reports')} className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">Reconcile now <ArrowRight className="w-3.5 h-3.5" /></button>
          </div>
        )}
      </Card>

      {/* --- Flags needing attention ------------------------------------------ */}
      <Card>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-3"><AlertTriangle className="w-4 h-4 text-indigo-500" /> Before You Lock Up</h3>
        {flags.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="w-4 h-4" /> Nothing needs attention. Good to close.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {flags.map((f, i) => (
              <li key={i}>
                <button onClick={() => onNavigate(f.view)}
                  className={`w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60 ${f.severity === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300'}`}>
                  {f.severity === 'warning' ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : <Wrench className="w-3.5 h-3.5 shrink-0 text-slate-400" />}
                  <span className="flex-1 min-w-0 truncate">{f.text}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; tone?: 'good' | 'bad' }> = ({ label, value, tone }) => (
  <div>
    <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
    <p className={`text-xl font-bold tabular-nums ${tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'bad' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{value}</p>
  </div>
);
