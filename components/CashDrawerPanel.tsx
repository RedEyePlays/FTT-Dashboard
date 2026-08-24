import React from 'react';
import { Wallet, DoorOpen, ArrowDownToLine, Banknote, ArrowUpFromLine, AlertTriangle } from 'lucide-react';
import { CashDrawerSummary } from '../domain/reports';
import type { CashMovementKind } from './LogCashMovementModal';

interface Props {
  summary: CashDrawerSummary;         // today's live drawer (shared math)
  onOpenDrawer: () => void;
  onLog: (kind: CashMovementKind) => void;
}

const money = (n: number) => `$${(n || 0).toFixed(2)}`;

// The register-side cash panel, shown right on the POS/checkout screen where cash
// is actually handled (not buried in a header menu). Shows the live expected
// drawer total and the quick actions: open drawer, cash in, cash out, withdrawal.
export const CashDrawerPanel: React.FC<Props> = ({ summary, onOpenDrawer, onLog }) => {
  const btn = 'flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-medium border bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400';
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0"><Wallet className="w-4 h-4" /></div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-slate-400 leading-none">Expected in drawer</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white leading-tight tabular-nums">{money(summary.expected)}</p>
          </div>
          {!summary.opened && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              <AlertTriangle className="w-3 h-3" /> Drawer not opened
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={onOpenDrawer} className={`${btn} ${!summary.opened ? '!bg-indigo-600 !text-white !border-indigo-600 hover:!bg-indigo-700' : ''}`}><DoorOpen className="w-3.5 h-3.5" /> {summary.opened ? 'Float' : 'Open drawer'}</button>
          <button onClick={() => onLog('cashIn')} className={btn}><ArrowDownToLine className="w-3.5 h-3.5" /> Cash in</button>
          <button onClick={() => onLog('cashOut')} className={btn}><Banknote className="w-3.5 h-3.5" /> Cash out</button>
          <button onClick={() => onLog('withdrawal')} className={btn}><ArrowUpFromLine className="w-3.5 h-3.5" /> Withdrawal</button>
        </div>
      </div>
      {/* Compact breakdown so the number is trusted, not a black box. */}
      <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        <span>Float {money(summary.openingFloat)}</span>
        <span>+ Sales {money(summary.cashSales)}</span>
        {summary.cashIn > 0 && <span>+ In {money(summary.cashIn)}</span>}
        {summary.cashOut > 0 && <span>− Out {money(summary.cashOut)}</span>}
        {summary.withdrawals > 0 && <span>− Withdrawn {money(summary.withdrawals)}</span>}
      </div>
    </div>
  );
};
