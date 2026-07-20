import React, { useEffect, useId, useRef, useState, useCallback } from 'react';

// A small accessible dropdown used across the header (More, AI, Notifications,
// Profile). Handles: click-outside + Escape to close, focus return to the
// trigger, and roving arrow-key navigation over the menu items. The trigger and
// menu contents are supplied by the caller; menu items should be rendered with
// the exported <MenuItem> so keyboard focus can find them ([role=menuitem]).

interface HeaderMenuProps {
  /** Accessible name for the trigger button. */
  label: string;
  /** Visual content of the trigger. */
  trigger: React.ReactNode;
  triggerClassName?: string;
  /** Panel alignment relative to the trigger. */
  align?: 'left' | 'right';
  /** Tailwind width class for the panel (default w-56). */
  panelClassName?: string;
  /** Render the menu body; call `close` to dismiss after an action. */
  children: (close: () => void) => React.ReactNode;
  /** Optional dot/indicator rendered on the trigger (e.g. notifications). */
}

export const HeaderMenu: React.FC<HeaderMenuProps> = ({
  label, trigger, triggerClassName, align = 'right', panelClassName = 'w-56', children,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  // Close on outside click / focus leaving the menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Focus the first item when opening.
  useEffect(() => {
    if (!open) return;
    const items = panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
    items?.[0]?.focus();
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') || []);
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    else if (e.key === 'Tab') { setOpen(false); }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(o => !o)}
        onKeyDown={(e) => { if ((e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') && !open) { e.preventDefault(); setOpen(true); } }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className={`absolute z-[70] mt-2 ${align === 'right' ? 'right-0' : 'left-0'} ${panelClassName} origin-top rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl shadow-slate-900/10 p-1.5 animate-fadeIn`}
        >
          {children(() => close(true))}
        </div>
      )}
    </div>
  );
};

// A standard menu row. Renders as a button unless `as` overrides the content.
export const MenuItem: React.FC<{
  icon?: React.ReactNode;
  label: string;
  onClick?: () => void;
  active?: boolean;
  danger?: boolean;
  trailing?: React.ReactNode;
  disabled?: boolean;
}> = ({ icon, label, onClick, active, danger, trailing, disabled }) => (
  <button
    role="menuitem"
    tabIndex={-1}
    disabled={disabled}
    onClick={onClick}
    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
      danger
        ? 'text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 focus-visible:bg-rose-50 dark:focus-visible:bg-rose-900/20'
        : active
          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 font-medium'
          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800'
    }`}
  >
    {icon && <span className="shrink-0">{icon}</span>}
    <span className="flex-1 min-w-0 truncate">{label}</span>
    {trailing}
  </button>
);
