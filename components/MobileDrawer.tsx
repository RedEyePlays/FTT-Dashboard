import React, { useEffect, useRef } from 'react';
import {
  LayoutDashboard, BarChart3, Table, StickyNote, ShoppingCart, Wrench, Contact, Truck,
  ScrollText, Users as UsersIcon, Bot, Search, Settings, Sparkles, Moon, Sun, Lock, X, Clock,
  Receipt,
} from 'lucide-react';
import { ViewState, Permission } from '../types';
import { useLockBodyScroll } from '../hooks/useMediaQuery';

interface Props {
  open: boolean;
  onClose: () => void;
  view: ViewState;
  onNavigate: (v: ViewState) => void;
  allow: (p: Permission) => boolean;
  userRole: string;
  userEmail: string;
  darkMode: boolean;
  onToggleTheme: () => void;
  onOpenFinder: () => void;
  onOpenSettings: () => void;
  onOpenBulk: () => void;
  onLock: () => void;
}

// Slide-out navigation drawer for tablet/phone — the mobile counterpart of the
// desktop top nav. Closes on select, backdrop, or Escape; traps initial focus.
export const MobileDrawer: React.FC<Props> = ({
  open, onClose, view, onNavigate, allow, userRole, userEmail,
  darkMode, onToggleTheme, onOpenFinder, onOpenSettings, onOpenBulk, onLock,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  useLockBodyScroll(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const go = (v: ViewState) => { onNavigate(v); onClose(); };
  const act = (fn: () => void) => { fn(); onClose(); };

  type Item = { label: string; icon: React.ReactNode; on: () => void; active?: boolean; show: boolean };
  const nav: Item[] = [
    { label: 'Dashboard', icon: <LayoutDashboard className="w-5 h-5" />, on: () => go('dashboard'), active: view === 'dashboard', show: true },
    { label: 'Analytics', icon: <BarChart3 className="w-5 h-5" />, on: () => go('analytics'), active: view === 'analytics', show: (userRole === 'owner' || userRole === 'manager') && allow('reports.profit.detailed') },
    { label: 'Reports', icon: <Receipt className="w-5 h-5" />, on: () => go('reports'), active: view === 'reports', show: allow('cash.reconcile') },
    { label: 'Inventory', icon: <Table className="w-5 h-5" />, on: () => go('grid'), active: view === 'grid', show: true },
    { label: 'Quick Sale', icon: <ShoppingCart className="w-5 h-5" />, on: () => go('pos'), active: view === 'pos', show: true },
    { label: 'Repairs', icon: <Wrench className="w-5 h-5" />, on: () => go('repairs'), active: view === 'repairs', show: allow('repairs.tech') },
    { label: 'Customers', icon: <Contact className="w-5 h-5" />, on: () => go('customers'), active: view === 'customers', show: allow('reports.view') },
    { label: 'Time Clock', icon: <Clock className="w-5 h-5" />, on: () => go('timeclock'), active: view === 'timeclock', show: allow('timeclock.use') },
    { label: 'Notes', icon: <StickyNote className="w-5 h-5" />, on: () => go('notes'), active: view === 'notes', show: true },
    { label: 'Drop-Offs', icon: <Truck className="w-5 h-5" />, on: () => go('dropoff'), active: view === 'dropoff', show: allow('dropoffs.manage') },
    { label: 'Audit', icon: <ScrollText className="w-5 h-5" />, on: () => go('audit'), active: view === 'audit', show: allow('audit.view') },
    { label: 'Users', icon: <UsersIcon className="w-5 h-5" />, on: () => go('users'), active: view === 'users', show: allow('users.tech') },
    { label: 'AI Assistant', icon: <Bot className="w-5 h-5" />, on: () => go('ai'), active: view === 'ai', show: true },
  ];
  const actions: Item[] = [
    { label: 'Find item', icon: <Search className="w-5 h-5" />, on: () => act(onOpenFinder), show: true },
    { label: 'AI Bulk Add', icon: <Sparkles className="w-5 h-5" />, on: () => act(onOpenBulk), show: true },
    { label: 'Settings', icon: <Settings className="w-5 h-5" />, on: () => act(onOpenSettings), show: allow('settings.manage') },
    { label: darkMode ? 'Light theme' : 'Dark theme', icon: darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />, on: () => onToggleTheme(), show: true },
    { label: 'Lock app', icon: <Lock className="w-5 h-5" />, on: () => act(onLock), show: true },
  ];

  const row = (it: Item, i: number) => (
    <button key={i} onClick={it.on}
      className={`w-full flex items-center gap-3 px-4 py-3 text-sm rounded-lg tap-target ${it.active ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-medium' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
      {it.icon}{it.label}
    </button>
  );

  return (
    <div className={`md:hidden fixed inset-0 z-[80] ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-black/50 transition-opacity ${open ? 'opacity-100' : 'opacity-0'}`} onClick={onClose} />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={`absolute top-0 left-0 h-full w-[82%] max-w-xs bg-white dark:bg-slate-900 shadow-2xl outline-none flex flex-col transition-transform duration-200 safe-t ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800 dark:text-slate-100">FlipThatTech</p>
            <p className="text-[11px] text-slate-400 truncate">{userEmail.split('@')[0]} · {userRole}</p>
          </div>
          <button onClick={onClose} aria-label="Close menu" className="tap-target flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {nav.filter(i => i.show).map(row)}
          <div className="my-2 border-t border-slate-100 dark:border-slate-800" />
          {actions.filter(i => i.show).map(row)}
        </nav>
      </div>
    </div>
  );
};
