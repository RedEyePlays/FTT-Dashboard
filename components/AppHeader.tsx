import React from 'react';
import {
  LayoutDashboard, Table, ShoppingCart, ShoppingBag, Wrench, Contact, Activity, BarChart3, StickyNote,
  Truck, ScrollText, Users as UsersIcon, Settings, Bot, Sparkles, MessageCircle,
  Search, PlusCircle, Moon, Sun, Menu, MoreHorizontal, ChevronDown, LogOut, Clock, Receipt, ClipboardCheck, Lock,
} from 'lucide-react';
import { ViewState, Permission, ActivityEntry } from '../types';
import { Alert } from '../domain/alerts';
import { NavButton } from './NavButton';
import { HeaderMenu, MenuItem } from './HeaderMenu';
import { NotificationsMenu } from './NotificationsMenu';
import { useOverflowNav } from '../hooks/useOverflowNav';

// The desktop/tablet header. Priority-based: a small set of primary destinations
// stays inline (folding into "More" automatically as space runs out), with
// secondary pages under More, AI actions under an AI menu, and account controls
// under the profile menu. Search + Add Item stay reachable at every width.
interface AppHeaderProps {
  view: ViewState;
  onNavigate: (v: ViewState) => void;
  allow: (p: Permission) => boolean;
  isTech?: boolean;
  pageTitle?: string;
  onOpenDrawer?: () => void;
  userEmail: string;
  userRole: string;
  darkMode: boolean;
  onToggleTheme: () => void;
  onToggleAiSidebar: () => void;
  onOpenFinder: () => void;
  onOpenSettings: () => void;
  onOpenBulk: () => void;
  onStartAdd: () => void;
  onLock: () => void;
  /** Locks the app overlay without signing out — available to every role. */
  onManualLock: () => void;
  activity?: ActivityEntry[];
  alerts?: Alert[];
  notifSeenTs?: number;
  onMarkNotificationsSeen?: (ts: number) => void;
  /** Notes has no permission of its own — visibility is per note, so App
   *  decides (domain/notes.ts's canOpenNotes) whether this role can reach it. */
  showNotes?: boolean;
}

type NavItem = { key: string; label: string; icon: React.ReactNode; view: ViewState; show: boolean };

// Shared button styling for icon-only header actions (44×44 touch target).
const iconBtn =
  'tap-target flex items-center justify-center rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 ' +
  'dark:text-slate-400 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/20 transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

export const AppHeader: React.FC<AppHeaderProps> = ({
  view, onNavigate, allow, isTech, pageTitle, onOpenDrawer, userEmail, userRole,
  darkMode, onToggleTheme, onToggleAiSidebar, onOpenFinder,
  onOpenSettings, onOpenBulk, onStartAdd, onLock, onManualLock, activity = [],
  alerts = [], notifSeenTs = 0, onMarkNotificationsSeen = () => {}, showNotes = true,
}) => {
  // Keyboard hint for the global-search bar (⌘K on Mac, Ctrl K elsewhere).
  const modKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl ';
  const primary: NavItem[] = ([
    { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" />, view: 'dashboard', show: true },
    { key: 'grid', label: 'Inventory', icon: <Table className="w-4 h-4" />, view: 'grid', show: true },
    { key: 'repairs', label: 'Repairs', icon: <Wrench className="w-4 h-4" />, view: 'repairs', show: allow('repairs.tech') },
    { key: 'customers', label: 'Customers', icon: <Contact className="w-4 h-4" />, view: 'customers', show: allow('reports.view') },
    { key: 'pos', label: 'Quick Sale', icon: <ShoppingCart className="w-4 h-4" />, view: 'pos', show: true },
    { key: 'quickpurchase', label: 'Quick Purchase', icon: <ShoppingBag className="w-4 h-4" />, view: 'quickpurchase', show: allow('inventory.add') },
    // Kept immediately next to Quick Purchase — both are "acquiring stock at
    // the counter" actions, so they belong beside each other in the primary
    // bar rather than Drop-Offs being buried a click deeper in "More".
    { key: 'dropoff', label: 'Drop-Offs', icon: <Truck className="w-4 h-4" />, view: 'dropoff', show: allow('dropoffs.manage') },
    { key: 'notes', label: 'Notes', icon: <StickyNote className="w-4 h-4" />, view: 'notes', show: showNotes },
  ] as NavItem[]).filter(i => i.show);

  const more: NavItem[] = ([
    { key: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" />, view: 'analytics', show: (userRole === 'owner' || userRole === 'manager') && allow('reports.profit.detailed') },
    { key: 'reports', label: 'Reports', icon: <Receipt className="w-4 h-4" />, view: 'reports', show: allow('cash.reconcile') || allow('reports.profit.summary') },
    { key: 'timeclock', label: 'Time Clock', icon: <Clock className="w-4 h-4" />, view: 'timeclock', show: allow('timeclock.use') },
    { key: 'closeout', label: 'Close Out', icon: <ClipboardCheck className="w-4 h-4" />, view: 'closeout', show: allow('closeout.view') },
    { key: 'audit', label: 'Audit', icon: <ScrollText className="w-4 h-4" />, view: 'audit', show: allow('audit.view') },
    { key: 'users', label: 'Users', icon: <UsersIcon className="w-4 h-4" />, view: 'users', show: allow('users.tech') },
    { key: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" />, view: 'settings', show: allow('settings.manage') },
  ] as NavItem[]).filter(i => i.show);

  const { containerRef, reserveRef, setItemRef, visible } = useOverflowNav(primary.length);
  const shown = primary.slice(0, visible);
  const overflow = primary.slice(visible);
  const moreItems = [...overflow, ...more];
  const moreActive = moreItems.some(i => i.view === view);

  const initials = (userEmail.split('@')[0] || 'U').slice(0, 2).toUpperCase();

  // AI Assistant / Quick AI Chat can surface real profit/margin figures (they
  // send the full inventory, including purchaseCost/salePrice/repairCost, to
  // Gemini) — gated the same as every other profit-surfacing view
  // (reports.profit.summary; enforced server-side too, see functions/src/
  // index.ts's requireProfitVisibility). AI Bulk Add only adds inventory
  // items and never touches profit data, so it stays gated on inventory.add
  // instead. The whole menu disappears if neither is available.
  const canAiInsights = allow('reports.profit.summary');
  const canBulkAdd = allow('inventory.add');
  const AiMenu = (canAiInsights || canBulkAdd) ? (
    <HeaderMenu
      label="AI tools"
      align="right"
      panelClassName="w-52"
      triggerClassName="flex items-center gap-1.5 px-3 h-10 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      trigger={<><Bot className="w-4 h-4" /><span>AI</span><ChevronDown className="w-3.5 h-3.5 opacity-60" /></>}
    >
      {(close) => (<>
        {canAiInsights && <MenuItem icon={<Bot className="w-4 h-4" />} label="AI Assistant" active={view === 'ai'} onClick={() => { onNavigate('ai'); close(); }} />}
        {canAiInsights && <MenuItem icon={<MessageCircle className="w-4 h-4" />} label="Quick AI Chat" onClick={() => { onToggleAiSidebar(); close(); }} />}
        {canBulkAdd && <MenuItem icon={<Sparkles className="w-4 h-4" />} label="AI Bulk Add" onClick={() => { onOpenBulk(); close(); }} />}
      </>)}
    </HeaderMenu>
  ) : null;

  const MoreMenu = (
    <HeaderMenu
      label="More"
      align="right"
      panelClassName="w-56"
      triggerClassName={`flex items-center gap-1.5 px-3 h-10 rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        moreActive
          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100'
      }`}
      trigger={<><MoreHorizontal className="w-4 h-4" /><span>More</span><ChevronDown className="w-3.5 h-3.5 opacity-60" /></>}
    >
      {(close) => (<>
        {moreItems.map(i => (
          <MenuItem key={i.key} icon={i.icon} label={i.label} active={i.view === view} onClick={() => { onNavigate(i.view); close(); }} />
        ))}
      </>)}
    </HeaderMenu>
  );

  const ProfileMenu = (
    <HeaderMenu
      label="Account menu"
      align="right"
      panelClassName="w-60"
      triggerClassName="tap-target flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      trigger={
        <span className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-white text-xs font-bold flex items-center justify-center shadow-sm">
          {initials}
        </span>
      }
    >
      {(close) => (<>
        <div className="px-3 py-2 mb-1 border-b border-slate-100 dark:border-slate-800">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{userEmail.split('@')[0]}</p>
          <p className="text-xs text-slate-400 capitalize">{userRole}</p>
        </div>
        <MenuItem
          icon={darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          label={darkMode ? 'Light theme' : 'Dark theme'}
          onClick={onToggleTheme}
        />
        {allow('settings.manage') && (
          <MenuItem icon={<Settings className="w-4 h-4" />} label="Settings" active={view === 'settings'} onClick={() => { onOpenSettings(); close(); }} />
        )}
        {allow('users.tech') && (
          <MenuItem icon={<UsersIcon className="w-4 h-4" />} label="Manage users" active={view === 'users'} onClick={() => { onNavigate('users'); close(); }} />
        )}
        {allow('audit.view') && (
          <MenuItem icon={<ScrollText className="w-4 h-4" />} label="Audit log" active={view === 'audit'} onClick={() => { onNavigate('audit'); close(); }} />
        )}
        <MenuItem icon={<Lock className="w-4 h-4" />} label="Lock app" onClick={() => { onManualLock(); close(); }} />
        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
        <MenuItem icon={<LogOut className="w-4 h-4" />} label="Sign out" danger onClick={() => { onLock(); close(); }} />
      </>)}
    </HeaderMenu>
  );

  return (
    <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-30 shadow-sm shrink-0 safe-t">
      <div className="w-full px-3 sm:px-4 lg:px-6 h-16 flex items-center gap-2 sm:gap-4">
        {/* Brand */}
        <button onClick={() => onNavigate(isTech ? 'repairs' : 'dashboard')} className="flex items-center gap-2 min-w-0 shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500" aria-label="FlipThatTech home">
          <span className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-500/30 shrink-0">
            <Activity className="w-5 h-5 text-white" />
          </span>
          <span className="hidden sm:block text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-700 to-violet-700 dark:from-indigo-400 dark:to-violet-400 whitespace-nowrap">
            FlipThatTech
          </span>
          {/* Phones: show the current page title instead of the brand. */}
          {!isTech && <span className="sm:hidden text-base font-bold text-slate-800 dark:text-slate-100 truncate">{pageTitle || 'FlipThatTech'}</span>}
        </button>

        {isTech ? (
          // Technician: repair-only header.
          <nav className="ml-auto flex items-center gap-1 sm:gap-2">
            <NavButton active icon={<Wrench className="w-4 h-4" />} label="Repairs" onClick={() => onNavigate('repairs')} />
            {ProfileMenu}
          </nav>
        ) : (
          <>
            {/* Primary navigation with automatic overflow (desktop/tablet ≥ md). */}
            <div ref={containerRef} className="hidden md:flex flex-1 min-w-0 items-center relative">
              {/* Hidden measurer: full-width copies used to compute how many fit. */}
              <div aria-hidden className="invisible pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1">
                {primary.map((i, idx) => (
                  <span key={i.key} ref={setItemRef(idx)}>
                    <NavButton active={false} icon={i.icon} label={i.label} onClick={() => {}} />
                  </span>
                ))}
              </div>
              <nav aria-label="Primary" className="flex items-center gap-1 min-w-0">
                {shown.map(i => (
                  <NavButton key={i.key} active={view === i.view} icon={i.icon} label={i.label} onClick={() => onNavigate(i.view)} />
                ))}
                <div ref={reserveRef} className="flex items-center gap-1">
                  {moreItems.length > 0 && MoreMenu}
                  {AiMenu}
                </div>
              </nav>
            </div>

            {/* Right actions — present at every width. */}
            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              {/* Global search — one bar across Inventory, Repairs, Customers &
                  Sales (opens the finder; ⌘/Ctrl-K also works). Shown as a bar on
                  ≥lg, icon-only below to save room. */}
              <button onClick={onOpenFinder} title="Search everything" aria-label="Search everything"
                className="hidden lg:flex items-center gap-2 h-10 w-56 xl:w-72 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-400 hover:border-indigo-400 hover:text-slate-500 dark:hover:text-slate-300 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                <Search className="w-4 h-4 shrink-0" />
                <span className="flex-1 text-left truncate">Search everything…</span>
                <kbd className="hidden xl:inline text-[10px] font-mono px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">{modKey}K</kbd>
              </button>
              <button onClick={onOpenFinder} aria-label="Search" title="Search" className={`lg:hidden ${iconBtn}`}>
                <Search className="w-5 h-5" />
              </button>

              {/* Add Item: labelled button on ≥lg, icon-only below. */}
              <button onClick={onStartAdd} aria-label="Add item" title="Add item"
                className="hidden lg:flex items-center gap-2 px-3.5 h-10 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white rounded-lg text-sm font-medium shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900">
                <PlusCircle className="w-4 h-4" /> Add Item
              </button>
              <button onClick={onStartAdd} aria-label="Add item" title="Add item"
                className="lg:hidden tap-target flex items-center justify-center rounded-lg bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
                <PlusCircle className="w-5 h-5" />
              </button>

              {/* Notifications + profile (desktop/tablet). */}
              <div className="hidden md:flex items-center gap-1">
                <NotificationsMenu activity={activity} alerts={alerts} seenTs={notifSeenTs} onMarkSeen={onMarkNotificationsSeen} onNavigate={onNavigate} iconClass={iconBtn} />
                {ProfileMenu}
              </div>

              {/* Phones: hamburger opens the full drawer (theme, settings, sign out, all pages). */}
              <button onClick={onOpenDrawer} aria-label="Open menu" title="Menu" className={`md:hidden ${iconBtn}`}>
                <Menu className="w-6 h-6" />
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
};
