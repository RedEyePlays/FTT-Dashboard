import React, { useEffect, useRef } from 'react';
import { X, Inbox, Loader2 } from 'lucide-react';
import { useLockBodyScroll } from '../hooks/useMediaQuery';

/** Empty state with an icon, title and optional action. */
export const EmptyState: React.FC<{ icon?: React.ReactNode; title: string; hint?: string; action?: React.ReactNode }> = ({ icon, title, hint, action }) => (
  <div className="flex flex-col items-center justify-center text-center py-12 px-4">
    <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 mb-3">{icon || <Inbox className="w-6 h-6" />}</div>
    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
    {hint && <p className="text-xs text-slate-400 mt-1 max-w-xs">{hint}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>
);

/** Inline loading state (spinner + label). */
export const LoadingState: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm">
    <Loader2 className="w-4 h-4 animate-spin" /> {label}
  </div>
);

/** A compact card used to render a table row on small screens. */
export const MobileDataCard: React.FC<{
  title: React.ReactNode;
  badge?: React.ReactNode;
  onOpen?: () => void;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}> = ({ title, badge, onOpen, actions, children }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
    <div className="flex items-start justify-between gap-2">
      <button onClick={onOpen} className="text-left min-w-0 flex-1" disabled={!onOpen}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">{title}</span>
          {badge}
        </div>
      </button>
      {actions}
    </div>
    {children && <div className="mt-2 text-sm">{children}</div>}
  </div>
);

/** A labelled key/value row for use inside a MobileDataCard. */
export const CardRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-center justify-between gap-3 py-0.5">
    <span className="text-xs text-slate-400 shrink-0">{label}</span>
    <span className="text-sm text-slate-700 dark:text-slate-200 truncate text-right">{children}</span>
  </div>
);

/** Sticky action bar pinned to the bottom on mobile (non-obstructive). */
export const StickyMobileActions: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="sticky bottom-0 -mx-4 sm:mx-0 mt-3 px-4 py-3 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 flex gap-2 safe-b z-10">
    {children}
  </div>
);

/**
 * A dialog that is a centered card on desktop and a bottom sheet on phones.
 * Locks background scroll, closes on Escape / backdrop, traps initial focus.
 */
export const ResponsiveDialog: React.FC<{
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string; // tailwind max-w-* class for desktop
}> = ({ open, onClose, title, footer, children, maxWidth = 'max-w-md' }) => {
  const ref = useRef<HTMLDivElement>(null);
  useLockBodyScroll(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm sm:p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div
        ref={ref}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        className={`bg-white dark:bg-slate-900 w-full ${maxWidth} border border-slate-200 dark:border-slate-700 outline-none flex flex-col
          rounded-t-2xl sm:rounded-2xl max-h-[92vh] sm:max-h-[90vh] shadow-2xl`}
      >
        {title && (
          <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
            <button onClick={onClose} aria-label="Close dialog" className="tap-target flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 -mr-2"><X className="w-5 h-5" /></button>
          </div>
        )}
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 shrink-0 safe-b">{footer}</div>}
      </div>
    </div>
  );
};
