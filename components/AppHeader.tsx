import React from 'react';
import {
  LayoutDashboard, Table, ShoppingCart, Wrench, Contact, Activity, BarChart3, StickyNote,
  Truck, ScrollText, Users as UsersIcon, Settings, Bot, Sparkles, MessageCircle, Calculator,
  Search, PlusCircle, Moon, Sun, Menu, MoreHorizontal, ChevronDown, LogOut,
} from 'lucide-react';
import { ViewState, Permission, ActivityEntry } from '../types';
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
  onToggleCalculator: () => void;
  onOpenFinder: () => void;
  onOpenSettings: () => void;
  onOpenBulk: () => void;
  onStartAdd: () => void;
  onLock: () => void;
  activity?: ActivityEntry[];
}

type NavItem = { key: string; label: string; icon: React.ReactNode; view: ViewState; show: boolean };

// Shared button styling for icon-only header actions (44×44 touch target).
const iconBtn =
  'tap-target flex items-center justify-center rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 ' +
  'dark:text-slate-400 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/20 transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

export const AppHeader: React.FC<AppHeaderProps> = ({
  view, onNavigate, allow, isTech, pageTitle, onOpenDrawer, userEmail, userRole,
  darkMode, onToggleTheme, onToggleAiSidebar, onToggleCalculator, onOpenFinder,
  onOpenSettings, onOpenBulk, onStartAdd, onLock, activity = [],
}) => {
  const primary: NavItem[] = ([
    { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" />, view: 'dashboard', show: true },
    { key: 'grid', label: 'Inventory', icon: <Table className="w-4 h-4" />, view: 'grid', show: true },
    { key: 'repairs', label: 'Repairs', icon: <Wrench className="w-4 h-4" />, view: 'repairs', show: allow('repairs.tech') },
    { key: 'customers', label: 'Customers', icon: <Contact className="w-4 h-4" />, view: 'customers', show: allow('reports.view') },
    { key: 'pos', label: 'Quick Sale', icon: <ShoppingCart className="w-4 h-4" />, view: 'pos', show: true },
  ] as NavItem[]).filter(i => i.show);

  const more: NavItem[] = ([
    { key: 'analytics', label: 'Analytics', icon: <BarChart3 className="w-4 h-4" />, view: 'analytics', show: (userRole === 'owner' || userRole === 'manager') && allow('reports.profit') },
    { key: 'notes', label: 'Notes', icon: <StickyNote className="w-4 h-4" />, view: 'notes', show: true },
    { key: 'dropoff', label: 'Drop-Offs', icon: <Truck className="w-4 h-4" />, view: 'dropoff', show: allow('dropoffs.manage') },
    { key: 'audit', label: 'Audit', icon: <ScrollText className="w-4 h-4" />, view: 'audit', show: allow('audit.view') },
    { key: 'users', label: 'Users', icon: <UsersIcon className="w-4 h-4" />, view: 'users', show: allow('users.tech') },
    { key: 'settings', label: 'Settings', icon: <Settings className="w-4 h-4" />, view: 'settings', show: allow('settings.manage') },
  ] as NavItem[]).filter(i => i.show);

  const { containerRef, reserveRef, setItemRef, visible } = useOverflowNav(primary.length);
  const shown = primary.slice(0, visible);
  const overflow = primary.slice(visible);
  const moreItems = [...overflow, ...more];
  const moreActive = moreItems.some(i => i.view === view);

      {/* Mobile header actions: search + theme + hamburger (opens the nav drawer). */}
      {!isTech && (
        <div className="flex md:hidden items-center gap-1">
          <button onClick={onOpenFinder} aria-label="Search" className="tap-target flex items-center justify-center text-slate-500 dark:text-slate-400 rounded-lg">
            <Search className="w-5 h-5" />
          </button>
          <button onClick={onToggleTheme} aria-label="Toggle theme" className="tap-target flex items-center justify-center text-slate-500 dark:text-slate-400 rounded-lg">
            {darkMode ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>
          <button onClick={onOpenDrawer} aria-label="Open menu" className="tap-target flex items-center justify-center text-slate-600 dark:text-slate-300 rounded-lg">
            <Menu className="w-6 h-6" />
          </button>
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
        <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
        <MenuItem icon={<LogOut className="w-4 h-4" />} label="Sign out" danger onClick={() => { onLock(); close(); }} />
      </>)}
    </HeaderMenu>
  );

        <button onClick={onOpenFinder} title="Search (Ctrl/Cmd + K)" aria-label="Open global search"
          className="flex items-center gap-2 pl-2.5 pr-2 py-1.5 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-lg hover:border-indigo-400 transition-colors">
          <Search className="w-4 h-4" />
          <span className="hidden lg:inline text-xs">Search</span>
          <kbd className="hidden lg:inline text-[10px] border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5">⌘K</kbd>
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
            <div className="ml-auto flex items-center gap-1 shrink-0">
              <button onClick={onOpenFinder} aria-label="Search" title="Search" className={iconBtn}>
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
                <NotificationsMenu activity={activity} iconClass={iconBtn} />
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
