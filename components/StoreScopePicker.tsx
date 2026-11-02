import React from 'react';
import { Building2, Store } from 'lucide-react';
import { Location } from '../types';
import {
  ALL_STORES_SCOPE, SCOPE_CAVEAT, StoreScope, isAllStores, scopeCaveat, scopeLabel,
} from '../domain/storeScope';

/**
 * THE ONE STORE FILTER. MULTI-STORE STAGE 5.
 *
 * The same control on the Dashboard, on Owner Analytics and above the Reports
 * tabs, driving one shared scope (hooks/useReportScope.ts) — so there is
 * exactly one answer to "whose numbers am I looking at?" on any screen.
 *
 * WHY IT IS BUTTONS AND NOT A DROPDOWN. A closed `<select>` showing
 * "Mississauga" is a line of small grey text that the eye reads as a label.
 * The whole hazard this stage introduces is a figure being read as the
 * company's when it is one shop's, so the current scope is a filled, coloured
 * button that cannot be mistaken for a caption, and a single-store scope also
 * puts its caveat on screen in amber. With two stores that is three buttons,
 * which fits anywhere this is used.
 *
 * It renders NOTHING when there is only one scope to choose (a single-store
 * workspace, or someone rostered to one shop with no combined view) — a filter
 * with one option is furniture that implies a choice nobody has.
 */

export const ScopeBadge: React.FC<{ scope: StoreScope; locations: Location[]; className?: string }> = ({
  scope, locations, className = '',
}) => (
  <span
    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold ${
      isAllStores(scope)
        ? 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
        : 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-200'
    } ${className}`}
  >
    {isAllStores(scope) ? <Building2 className="w-3 h-3" /> : <Store className="w-3 h-3" />}
    {scopeLabel(scope, locations)}
  </span>
);

/**
 * The caveat that travels with a single-store figure.
 *
 * Shown for a store scope and not for the combined books, because it is the
 * store figure that is incomplete: it is that shop's profit BEFORE the costs
 * that belong to neither shop, which is why the two stores do not add up to
 * the combined total.
 */
export const ScopeNote: React.FC<{ scope: StoreScope }> = ({ scope }) => {
  if (isAllStores(scope)) return null;
  return (
    <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
      {SCOPE_CAVEAT}
    </p>
  );
};

export const StoreScopePicker: React.FC<{
  scope: StoreScope;
  choices: StoreScope[];
  locations: Location[];
  onChange: (s: StoreScope) => void;
  /** Hide the caveat when the caller shows its own <ScopeNote> lower down. */
  showNote?: boolean;
  className?: string;
}> = ({ scope, choices, locations, onChange, showNote = true, className = '' }) => {
  if ((choices || []).length < 2) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mr-1">Showing</span>
        {choices.map(c => {
          const on = c === scope;
          return (
            <button
              key={c || 'all'}
              onClick={() => onChange(c)}
              aria-pressed={on}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border ${
                on
                  ? 'bg-indigo-600 border-indigo-600 text-white'
                  : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
              }`}
            >
              {c === ALL_STORES_SCOPE ? <Building2 className="w-3.5 h-3.5" /> : <Store className="w-3.5 h-3.5" />}
              {scopeLabel(c, locations)}
            </button>
          );
        })}
      </div>
      {showNote && <ScopeNote scope={scope} />}
    </div>
  );
};

/** The scope line for a printed page or a PDF, as one string. */
export const scopePrintLine = (scope: StoreScope, locations: Location[]): string =>
  `${scopeLabel(scope, locations)} — ${scopeCaveat(scope)}`;
