import React, { useMemo, useState } from 'react';
import { Search, ShieldCheck, ShieldOff, AlertTriangle } from 'lucide-react';
import { InventoryItem, PcBuild, Repair, SalesTransaction } from '../types';
import { WarrantyHit, repeatClaimNote, warrantyLabel, warrantyLookup } from '../domain/warranty';

/**
 * "IS THIS STILL UNDER WARRANTY?" — asked at the counter, answered here.
 *
 * The one place that question gets answered, mounted both at repair intake and
 * behind global search. Whatever the customer can tell you works: an IMEI, a
 * SKU, their phone number, their name — and, for a custom PC, the serial of ANY
 * PART in it, which finds the build. That last one matters: a customer whose
 * graphics card died reads the sticker on the card, not a number the shop gave
 * the machine.
 *
 * Nothing here blocks anything. A repeat claim gets a plain sentence, and the
 * DOLLAR figure in it is cost-visible only (domain/warranty.ts's
 * repeatClaimNote) — an employee sees that it is the third visit, the owner
 * sees what it has cost.
 */

interface Props {
  sales: SalesTransaction[];
  inventory: InventoryItem[];
  repairs: Repair[];
  builds?: PcBuild[];
  canViewCost: boolean;
  /** Start a warranty claim from a hit — links the repair to the exact line. */
  onStartClaim?: (hit: WarrantyHit) => void;
  autoFocus?: boolean;
  placeholder?: string;
}

const STATE_STYLE = {
  covered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  expired: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
  none: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
} as const;

export const WarrantyLookupPanel: React.FC<Props> = ({
  sales, inventory, repairs, builds, canViewCost, onStartClaim, autoFocus, placeholder,
}) => {
  const [query, setQuery] = useState('');
  const hits = useMemo(
    () => warrantyLookup(query, { sales, inventory, repairs, builds }).slice(0, 25),
    [query, sales, inventory, repairs, builds],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder || 'IMEI, SKU, part serial, phone or name…'}
          className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
        />
      </div>

      {query.trim() && hits.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nothing sold matches that. Check the number, or search by the customer's phone or name.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {hits.map(hit => {
          const note = repeatClaimNote(hit.claims, canViewCost);
          return (
            <div
              key={`${hit.sale.id}:${hit.lineIndex}`}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{hit.what}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sold {hit.soldOn}
                    {hit.sale.customerName ? ` · ${hit.sale.customerName}` : ''}
                  </p>
                  {/* The one thing a plain sale line could never tell you. */}
                  {hit.matchedBuild && (
                    <p className="text-xs text-indigo-600 dark:text-indigo-400">
                      Matched the {hit.matchedPartName} in “{hit.matchedBuild.name}”
                    </p>
                  )}
                  {note && (
                    <p className="mt-1 text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> {note}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${STATE_STYLE[hit.state]}`}>
                    {hit.state === 'covered' ? <ShieldCheck className="w-3 h-3" /> : <ShieldOff className="w-3 h-3" />}
                    {warrantyLabel(hit.line)}
                  </span>
                  {onStartClaim && hit.state === 'covered' && (
                    <button
                      type="button"
                      onClick={() => onStartClaim(hit)}
                      className="block mt-2 ml-auto px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold"
                    >
                      Start warranty claim
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
