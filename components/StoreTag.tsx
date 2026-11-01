import React from 'react';
import { Store } from 'lucide-react';

/**
 * WHOSE TILL THIS IS, said on the screen itself.
 *
 * Multi-store stage 2. Every cash screen now shows one store's drawer, and a
 * cash figure with no store against it is exactly the figure that gets counted
 * into the wrong day — somebody standing in Mississauga closing Brampton's
 * drawer because the screen looked the same as it always did. So the store is
 * named on every one of them, in the same badge everywhere, deliberately not a
 * subtle grey footnote.
 *
 * Renders NOTHING when there is no store list — a single-shop workspace is not
 * made clearer by being told it is in its only shop.
 */
export const StoreTag: React.FC<{ storeLabel?: string; className?: string }> = ({ storeLabel, className }) => {
  if (!storeLabel) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 ${className || ''}`}>
      <Store className="w-3 h-3 shrink-0" /> {storeLabel}
    </span>
  );
};

/** The same statement with room to breathe, for the top of a cash screen. */
export const StoreBanner: React.FC<{ storeLabel?: string; what: string }> = ({ storeLabel, what }) => {
  if (!storeLabel) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 text-sm text-indigo-800 dark:text-indigo-200">
      <Store className="w-4 h-4 shrink-0" />
      <span><span className="font-bold">{storeLabel}</span> — {what}</span>
    </div>
  );
};
