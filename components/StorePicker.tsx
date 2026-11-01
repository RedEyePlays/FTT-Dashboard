import React from 'react';
import { Store } from 'lucide-react';
import { Location } from '../types';

/**
 * WHICH STORE THIS TERMINAL IS WORKING AT, in the header, on every screen.
 *
 * Multi-store stage 2. Most staff hold exactly one store, so they get a
 * read-only badge: there is nothing to choose, and a dropdown with one option
 * is an invitation to wonder whether it matters. The owner — and anyone the
 * owner has put on both — gets a picker.
 *
 * SWITCHING STORES IS NOT A PERMISSION CHANGE. It changes whose till the cash
 * screens are about, and nothing else: no figure anybody could not already
 * see becomes visible, and firestore.rules still has the final say on which
 * store's drawer this person may write (see the cashReconciliations block).
 *
 * Renders nothing at all in a single-store workspace.
 */
export const StorePicker: React.FC<{
  active?: Location;
  permitted: Location[];
  onPick: (id: string) => void;
}> = ({ active, permitted, onPick }) => {
  if (!active || permitted.length === 0) return null;
  if (permitted.length === 1) {
    return (
      <span
        title="The store this terminal is working at"
        className="hidden sm:inline-flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 shrink-0"
      >
        <Store className="w-3.5 h-3.5" /> {active.name}
      </span>
    );
  }
  return (
    <label className="inline-flex items-center gap-1.5 shrink-0" title="The store this terminal is working at — changes which drawer the cash screens show">
      <Store className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
      <span className="sr-only">Store</span>
      <select
        aria-label="Store"
        value={active.id}
        onChange={e => onPick(e.target.value)}
        className="h-8 px-2 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        {permitted.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
    </label>
  );
};
