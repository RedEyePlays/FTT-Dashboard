import React, { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Customer } from '../types';
import { matchCustomer } from '../domain/customers';

// Reusable "find an existing customer" autocomplete. On select it hands back the
// full customer so the caller can autofill name/phone/email and link by id.
interface Props {
  customers: Customer[];
  onSelect: (c: Customer) => void;
  placeholder?: string;
  kind?: 'retail' | 'wholesale'; // optionally limit suggestions
  autoFocus?: boolean; // focus on mount — only when this is genuinely the first field of a freshly-opened form
}

export const CustomerSearchInput: React.FC<Props> = ({ customers, onSelect, placeholder, kind, autoFocus }) => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const results = q.trim()
    ? customers.filter(c => (!kind || (c.kind || 'retail') === kind) && matchCustomer(c, q)).slice(0, 6)
    : [];

  return (
    <div className="relative" ref={boxRef}>
      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
      <input
        autoFocus={autoFocus}
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder || 'Find existing customer…'}
        className="w-full pl-9 pr-8 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      {q && <button onClick={() => { setQ(''); setOpen(false); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
      {open && results.length > 0 && (
        <div className="absolute z-30 mt-1 w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg max-h-60 overflow-y-auto custom-scrollbar">
          {results.map(c => (
            <button key={c.id} type="button"
              onClick={() => { onSelect(c); setQ(''); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-50 dark:border-slate-800/60 last:border-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{c.name || c.company || 'Customer'}{c.kind === 'wholesale' && <span className="ml-2 text-[10px] px-1 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">Wholesale</span>}</p>
              <p className="text-xs text-slate-400 truncate">{[c.phone, c.email].filter(Boolean).join(' · ') || 'no contact info'}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
