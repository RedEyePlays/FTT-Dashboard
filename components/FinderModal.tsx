import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Package, CheckCircle, Clock, DollarSign, ChevronRight } from 'lucide-react';
import { InventoryItem } from '../types';

interface Props {
  inventory: InventoryItem[];
  onClose: () => void;
  onEdit?: (item: InventoryItem) => void;
}

export const FinderModal: React.FC<Props> = ({ inventory, onClose, onEdit }) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const q = query.toLowerCase().trim();
  const results = q.length < 1 ? [] : inventory.filter(i =>
    i.item.toLowerCase().includes(q) ||
    i.imei.toLowerCase().includes(q) ||
    i.boughtFrom.toLowerCase().includes(q) ||
    i.soldTo?.toLowerCase().includes(q) ||
    i.customerName?.toLowerCase().includes(q) ||
    i.customerPhone?.includes(q) ||
    i.notes.toLowerCase().includes(q) ||
    i.date.includes(q) ||
    i.soldDate?.includes(q)
  ).slice(0, 20);

  const profit = (item: InventoryItem) =>
    item.salePrice - item.purchaseCost - item.repairCost - (item.shippingCost ?? 0) - (item.platformFees ?? 0);

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-20 bg-black/40 backdrop-blur-sm px-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-fadeIn"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search by name, IMEI, buyer, phone, notes…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="flex-1 bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 text-base focus:outline-none"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center px-2 py-0.5 rounded border border-slate-200 dark:border-slate-700 text-slate-400 text-xs font-mono">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
          {q.length === 0 && (
            <div className="py-12 text-center text-slate-400">
              <Search className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Start typing to search inventory</p>
            </div>
          )}

          {q.length > 0 && results.length === 0 && (
            <div className="py-12 text-center text-slate-400">
              <p className="text-sm">No items found for "<span className="font-medium">{query}</span>"</p>
            </div>
          )}

          {results.map(item => {
            const isSold = !!item.soldDate;
            const p = isSold ? profit(item) : null;
            return (
              <button
                key={item.id}
                onClick={() => { onEdit?.(item); onClose(); }}
                className="w-full text-left flex items-center gap-4 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-b border-slate-50 dark:border-slate-800/60 last:border-0"
              >
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${isSold ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-indigo-100 dark:bg-indigo-900/30'}`}>
                  {isSold
                    ? <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    : <Clock className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{item.item}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400 flex-wrap">
                    <span>{item.imei || 'No IMEI'}</span>
                    {item.boughtFrom && <><span>·</span><span>from {item.boughtFrom}</span></>}
                    {isSold && item.soldTo && <><span>·</span><span>→ {item.customerName || item.soldTo}</span></>}
                    {item.customerPhone && <><span>·</span><span>{item.customerPhone}</span></>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {isSold && p !== null ? (
                    <>
                      <p className={`text-sm font-bold ${p >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        ${p.toFixed(2)}
                      </p>
                      <p className="text-xs text-slate-400">profit</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                        ${(item.purchaseCost + item.repairCost).toFixed(2)}
                      </p>
                      <p className="text-xs text-slate-400">cost in</p>
                    </>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
              </button>
            );
          })}
        </div>

        {results.length > 0 && (
          <div className="px-4 py-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-400 flex justify-between">
            <span>{results.length} result{results.length !== 1 ? 's' : ''}</span>
            <span>Click to open item</span>
          </div>
        )}
      </div>
    </div>
  );
};
