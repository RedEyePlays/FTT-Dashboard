import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, X, Package, Smartphone, Wrench, Receipt, Users as UsersIcon, ArrowRight,
  Contact, CornerDownLeft, Clock, Trash2,
} from 'lucide-react';
import { globalSearch, SearchData, SearchResult, SearchType, MIN_QUERY } from '../domain/search';
import { useIsMobile, useLockBodyScroll } from '../hooks/useMediaQuery';

interface Props {
  open: boolean;
  onClose: () => void;
  data: SearchData;
  canViewCost: boolean;
  onSelect: (r: SearchResult) => void;
}

const ICONS: Record<SearchType, React.ReactNode> = {
  inventory: <Package className="w-4 h-4" />, repair: <Wrench className="w-4 h-4" />,
  customer: <Contact className="w-4 h-4" />, sale: <Receipt className="w-4 h-4" />,
  user: <UsersIcon className="w-4 h-4" />, page: <ArrowRight className="w-4 h-4" />,
};
const BADGE: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  sold: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-200',
  ready: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  neutral: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
};

const STORE_KEY = 'ftt_search_v1';
interface Store { terms: string[]; opened: SearchResult[] }
const loadStore = (): Store => { try { const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); return { terms: Array.isArray(s.terms) ? s.terms : [], opened: Array.isArray(s.opened) ? s.opened : [] }; } catch { return { terms: [], opened: [] }; } };
const saveStore = (s: Store) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* ignore */ } };

// Highlight query occurrences in a string.
const Highlight: React.FC<{ text?: string; q: string }> = ({ text, q }) => {
  if (!text) return null;
  const idx = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (idx < 0) return <>{text}</>;
  return <>{text.slice(0, idx)}<mark className="bg-indigo-200/70 dark:bg-indigo-500/40 text-inherit rounded px-0.5">{text.slice(idx, idx + q.length)}</mark>{text.slice(idx + q.length)}</>;
};

export const GlobalSearch: React.FC<Props> = ({ open, onClose, data, canViewCost, onSelect }) => {
  const isMobile = useIsMobile();
  const [raw, setRaw] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [store, setStore] = useState<Store>(loadStore);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<Element | null>(null);
  useLockBodyScroll(open);

  // Debounce input (ignore stale keystrokes).
  useEffect(() => { const t = setTimeout(() => setDebounced(raw), 140); return () => clearTimeout(t); }, [raw]);

  useEffect(() => {
    if (open) {
      restoreFocus.current = document.activeElement;
      setRaw(''); setDebounced(''); setActive(0);
      setStore(loadStore());
      setTimeout(() => inputRef.current?.focus(), 20);
    } else if (restoreFocus.current instanceof HTMLElement) {
      restoreFocus.current.focus();
    }
  }, [open]);

  const { groups, total } = useMemo(
    () => globalSearch(debounced, data, { canViewCost }),
    [debounced, data, canViewCost],
  );
  const flat = useMemo(() => groups.flatMap(g => g.results), [groups]);
  useEffect(() => { setActive(0); }, [debounced]);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const searching = debounced.trim().length >= MIN_QUERY;

  const commit = (r: SearchResult) => {
    const term = debounced.trim();
    const next: Store = {
      terms: term ? [term, ...store.terms.filter(t => t !== term)].slice(0, 6) : store.terms,
      opened: [r, ...store.opened.filter(o => o.key !== r.key)].slice(0, 6),
    };
    setStore(next); saveStore(next);
    onSelect(r);
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(flat.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (flat[active]) commit(flat[active]); }
  };

  if (!open) return null;

  const clearRecent = () => { const next = { terms: [], opened: [] }; setStore(next); saveStore(next); };

  const Item: React.FC<{ r: SearchResult; idx: number }> = ({ r, idx }) => (
    <button
      data-idx={idx}
      role="option"
      aria-selected={active === idx}
      onMouseEnter={() => setActive(idx)}
      onClick={() => commit(r)}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left ${active === idx ? 'bg-indigo-50 dark:bg-indigo-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
    >
      <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${active === idx ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>{ICONS[r.type]}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-slate-800 dark:text-slate-100 truncate"><Highlight text={r.title} q={debounced.trim()} /></span>
        {r.subtitle && <span className="block text-xs text-slate-400 truncate"><Highlight text={r.subtitle} q={debounced.trim()} /></span>}
      </span>
      {r.status && <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${BADGE[r.statusKind || 'neutral']}`}>{r.status}</span>}
      {active === idx && <CornerDownLeft className="w-3.5 h-3.5 text-slate-300 shrink-0" />}
    </button>
  );

  const shell = isMobile
    ? 'w-full h-full max-h-full rounded-none'
    : 'w-full max-w-xl mt-[10vh] max-h-[75vh] rounded-2xl';

  let runningIdx = -1;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/50 backdrop-blur-sm sm:p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Global search">
      <div className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col overflow-hidden ${shell}`} onClick={e => e.stopPropagation()}>
        {/* Input */}
        <div className="flex items-center gap-2 px-3 py-3 border-b border-slate-100 dark:border-slate-800 safe-t">
          <Search className="w-5 h-5 text-slate-400 shrink-0" />
          <input
            ref={inputRef}
            value={raw}
            onChange={e => setRaw(e.target.value)}
            onKeyDown={onKey}
            role="combobox"
            aria-expanded={searching}
            aria-controls="global-search-list"
            aria-activedescendant={flat[active] ? `gs-${active}` : undefined}
            placeholder="Search inventory, repairs, customers, sales, pages…"
            className="flex-1 bg-transparent text-base sm:text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none"
          />
          {raw && <button onClick={() => { setRaw(''); inputRef.current?.focus(); }} aria-label="Clear search" className="tap-target flex items-center justify-center text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
          <button onClick={onClose} aria-label="Close search" className="tap-target flex items-center justify-center text-slate-400 hover:text-slate-600 sm:hidden"><X className="w-5 h-5" /></button>
          <kbd className="hidden sm:inline text-[10px] text-slate-400 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        {/* Results / states */}
        <div ref={listRef} id="global-search-list" role="listbox" className="flex-1 overflow-y-auto p-2">
          <span className="sr-only" aria-live="polite">{searching ? `${total} results` : ''}</span>

          {!searching && (
            <div className="space-y-4 p-1">
              {store.opened.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 px-2 mb-1 flex items-center gap-1"><Clock className="w-3 h-3" /> Recently opened</p>
                  {store.opened.map((r, i) => { runningIdx++; return <Item key={r.key} r={r} idx={runningIdx} />; })}
                </div>
              )}
              {store.terms.length > 0 && (
                <div>
                  <div className="flex items-center justify-between px-2 mb-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recent searches</p>
                    <button onClick={clearRecent} className="text-[11px] text-slate-400 hover:text-rose-500 flex items-center gap-1"><Trash2 className="w-3 h-3" /> Clear</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 px-2">
                    {store.terms.map(t => <button key={t} onClick={() => setRaw(t)} className="text-xs px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700">{t}</button>)}
                  </div>
                </div>
              )}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 px-2 mb-1">Go to</p>
                {data.pages.map(p => { runningIdx++; const r: SearchResult = { key: `page:${p.id}`, type: 'page', title: p.label, subtitle: 'Open page', score: 1, view: p.view, action: p.action }; return <Item key={r.key} r={r} idx={runningIdx} />; })}
              </div>
            </div>
          )}

          {searching && total === 0 && (
            <div className="text-center py-12 px-4">
              <p className="text-sm font-medium text-slate-600 dark:text-slate-300">No results for “{debounced.trim()}”</p>
              <p className="text-xs text-slate-400 mt-1">Try a SKU, IMEI, repair number, phone, or customer name.</p>
              <div className="flex flex-wrap justify-center gap-1.5 mt-4">
                {data.pages.slice(0, 5).map(p => <button key={p.id} onClick={() => commit({ key: `page:${p.id}`, type: 'page', title: p.label, score: 1, view: p.view, action: p.action })} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400">{p.label}</button>)}
              </div>
            </div>
          )}

          {searching && groups.map(g => (
            <div key={g.type} className="mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 px-2 py-1 sticky top-0 bg-white dark:bg-slate-900">{g.label}{g.total > g.results.length ? <span className="text-slate-300 font-normal"> · {g.results.length} of {g.total}</span> : ''}</p>
              {g.results.map(r => { runningIdx++; return <div id={`gs-${runningIdx}`} key={r.key}><Item r={r} idx={runningIdx} /></div>; })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
