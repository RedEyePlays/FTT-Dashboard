import React, { useMemo, useState } from 'react';
import { HandCoins, ArrowLeft, AlertTriangle, Search } from 'lucide-react';
import { SalesTransaction, Customer } from '../types';
import { openLayaways, layawayTotals, layawayAgeDays, isStaleLayaway } from '../domain/layaway';
import { todayISO } from '../domain/dates';
import { CollectBalanceModal } from './CollectBalanceModal';

interface Props {
  salesTransactions: SalesTransaction[];
  customers: Customer[];
  staleThresholdDays: number;
  onBack: () => void;
  onOpenCustomer?: (customerId: string) => void;
  onCollectBalance?: (tx: SalesTransaction, input: { amount: number; paymentMethod: 'cash' | 'card' | 'mixed' | 'etransfer'; cashAmount?: number; cardAmount?: number; etransferAmount?: number; date: string }) => Promise<SalesTransaction>;
}

const money = (n: number) => `$${(n || 0).toFixed(2)}`;

/**
 * Every open layaway, in one place — item 4 of the layaway-completion batch:
 * before this there was no list of active layaways anywhere, no Dashboard
 * tile, no report, no filter. The owner had to remember who had a deposit
 * down. Reachable from the Dashboard's Active Layaways tile and from a
 * customer's own open-balance banner when they have more than one.
 */
export const LayawaysView: React.FC<Props> = ({ salesTransactions, customers, staleThresholdDays, onBack, onOpenCustomer, onCollectBalance }) => {
  const [query, setQuery] = useState('');
  const [staleOnly, setStaleOnly] = useState(false);
  const [collecting, setCollecting] = useState<SalesTransaction | null>(null);
  const today = todayISO();

  const custById = useMemo(() => new Map(customers.map(c => [c.id, c])), [customers]);

  const rows = useMemo(() => {
    const open = openLayaways(salesTransactions);
    return open
      .map(t => ({
        tx: t,
        customer: (t.customerId && custById.get(t.customerId)) || undefined,
        age: layawayAgeDays(t, today),
        stale: isStaleLayaway(t, today, staleThresholdDays),
        deviceNames: t.lines.filter(l => l.kind === 'device').map(l => l.name).join(', ') || t.lines.map(l => l.name).join(', '),
      }))
      .sort((a, b) => b.age - a.age); // oldest (most in need of follow-up) first
  }, [salesTransactions, custById, today, staleThresholdDays]);

  const filtered = rows.filter(r => {
    if (staleOnly && !r.stale) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [r.tx.customerName, r.tx.id, r.deviceNames].some(v => (v || '').toLowerCase().includes(q));
  });

  const totals = layawayTotals(salesTransactions);
  const staleCount = rows.filter(r => r.stale).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"><ArrowLeft className="w-4 h-4" /></button>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2"><HandCoins className="w-5 h-5 text-indigo-500" /> Layaways</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">{totals.count} active · {money(totals.outstanding)} outstanding{staleCount > 0 ? ` · ${staleCount} stale (${staleThresholdDays}+ days)` : ''}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
          <input
            value={query} onChange={e => setQuery(e.target.value)} placeholder="Search customer, sale ID, device…"
            className="w-full pl-8 pr-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <button onClick={() => setStaleOnly(v => !v)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border ${staleOnly ? 'bg-amber-100 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>
          <AlertTriangle className="w-3.5 h-3.5" /> Stale only ({staleCount})
        </button>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400 py-10 text-center">{rows.length === 0 ? 'No active layaways.' : 'No layaways match this filter.'}</p>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-400 bg-slate-50 dark:bg-slate-950/40">
              <tr>
                <th className="text-left py-2.5 px-4">Customer</th>
                <th className="text-left py-2.5 px-4">Device(s)</th>
                <th className="text-right py-2.5 px-4">Deposit Paid</th>
                <th className="text-right py-2.5 px-4">Balance Owing</th>
                <th className="text-left py-2.5 px-4">Started</th>
                <th className="text-right py-2.5 px-4">Age</th>
                <th className="py-2.5 px-4"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map(r => (
                <tr key={r.tx.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${r.stale ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}>
                  <td className="py-2.5 px-4">
                    {onOpenCustomer && r.tx.customerId ? (
                      <button onClick={() => onOpenCustomer(r.tx.customerId!)} className="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">{r.tx.customerName || 'Walk-in'}</button>
                    ) : (
                      <span className="font-medium text-slate-800 dark:text-slate-100">{r.tx.customerName || 'Walk-in'}</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400 truncate max-w-[240px]">{r.deviceNames || '—'}</td>
                  <td className="py-2.5 px-4 text-right text-slate-700 dark:text-slate-200">{money(r.tx.deposit || 0)}</td>
                  <td className="py-2.5 px-4 text-right font-semibold text-sky-600 dark:text-sky-400">{money(r.tx.balanceOwing || 0)}</td>
                  <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">{r.tx.date}</td>
                  <td className="py-2.5 px-4 text-right">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.stale ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
                      {r.age}d{r.stale ? ' · stale' : ''}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {onCollectBalance && (
                      <button onClick={() => setCollecting(r.tx)}
                        className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-900/20 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-900/30">
                        Collect
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {collecting && onCollectBalance && (
        <CollectBalanceModal tx={collecting} onClose={() => setCollecting(null)} onConfirm={input => onCollectBalance(collecting, input)} />
      )}
    </div>
  );
};
