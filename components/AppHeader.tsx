import React from 'react';
import {
  LayoutDashboard, PlusCircle, Table, Activity, Sparkles, Moon, Sun, Lock, StickyNote,
  Settings, Calculator, Bot, MessageCircle, ShoppingCart, Search, Truck, ScrollText,
  Users as UsersIcon, BarChart3, Wrench, Contact,
} from 'lucide-react';
import { ViewState, Permission } from '../types';
import { NavButton } from './NavButton';

// The desktop header/top navigation. Extracted verbatim from App.tsx; App now
// wires state and handlers in through props.
interface AppHeaderProps {
  view: ViewState;
  onNavigate: (v: ViewState) => void;
  allow: (p: Permission) => boolean;
  isTech?: boolean; // technician = simplified, repair-only header
  userEmail: string;
  userRole: string;
  darkMode: boolean;
  onToggleTheme: () => void;
  isAiSidebarOpen: boolean;
  onToggleAiSidebar: () => void;
  showCalculator: boolean;
  onToggleCalculator: () => void;
  onOpenFinder: () => void;
  onOpenSettings: () => void;
  onOpenBulk: () => void;
  onStartAdd: () => void;
  onLock: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  view, onNavigate, allow, isTech, userEmail, userRole,
  darkMode, onToggleTheme, isAiSidebarOpen, onToggleAiSidebar,
  showCalculator, onToggleCalculator, onOpenFinder, onOpenSettings,
  onOpenBulk, onStartAdd, onLock,
}) => (
  <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-20 shadow-sm shrink-0">
    <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-500/30">
          <Activity className="w-5 h-5 text-white" />
        </div>
        <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-700 to-violet-700 dark:from-indigo-400 dark:to-violet-400">
          FlipThatTech Dashboard
        </h1>
        <span className="hidden sm:inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
           <Lock className="w-3 h-3" /> Secure
        </span>
      </div>
      {isTech ? (
        // Technician: repair-only header — no inventory / sales / settings / users.
        <nav className="flex items-center gap-2">
          <NavButton active icon={<Wrench className="w-4 h-4" />} label="Repairs" onClick={() => onNavigate('repairs')} />
          <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-2"></div>
          <span className="hidden sm:inline text-xs text-slate-400 mr-1" title={userEmail}>{userEmail.split('@')[0]} · {userRole}</span>
          <button onClick={onToggleTheme} className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="Toggle Theme">
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button onClick={onLock} className="p-2 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors" title="Lock App">
            <Lock className="w-4 h-4" />
          </button>
        </nav>
      ) : (
      <nav className="hidden md:flex items-center gap-2">
        <NavButton active={view === 'dashboard'} icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" onClick={() => onNavigate('dashboard')} />
        {allow('reports.view') && (
          <NavButton active={view === 'analytics'} icon={<BarChart3 className="w-4 h-4" />} label="Analytics" onClick={() => onNavigate('analytics')} />
        )}
        <NavButton active={view === 'grid'} icon={<Table className="w-4 h-4" />} label="Inventory" onClick={() => onNavigate('grid')} />
        <NavButton active={view === 'notes'} icon={<StickyNote className="w-4 h-4" />} label="Notes" onClick={() => onNavigate('notes')} />
        <NavButton active={view === 'pos'} icon={<ShoppingCart className="w-4 h-4" />} label="Quick Sale" onClick={() => onNavigate('pos')} />
        {allow('repairs.tech') && (
          <NavButton active={view === 'repairs'} icon={<Wrench className="w-4 h-4" />} label="Repairs" onClick={() => onNavigate('repairs')} />
        )}
        {allow('reports.view') && (
          <NavButton active={view === 'customers'} icon={<Contact className="w-4 h-4" />} label="Customers" onClick={() => onNavigate('customers')} />
        )}
        {allow('dropoffs.manage') && (
          <NavButton active={view === 'dropoff'} icon={<Truck className="w-4 h-4" />} label="Drop-Offs" onClick={() => onNavigate('dropoff')} />
        )}
        {allow('audit.view') && (
          <NavButton active={view === 'audit'} icon={<ScrollText className="w-4 h-4" />} label="Audit" onClick={() => onNavigate('audit')} />
        )}
        {allow('users.tech') && (
          <NavButton active={view === 'users'} icon={<UsersIcon className="w-4 h-4" />} label="Users" onClick={() => onNavigate('users')} />
        )}
        <NavButton active={view === 'ai'} icon={<Bot className="w-4 h-4" />} label="AI Assistant" onClick={() => onNavigate('ai')} />

        <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-2"></div>

        <span className="hidden lg:inline text-xs text-slate-400 mr-1" title={userEmail}>{userEmail.split('@')[0]} · {userRole}</span>

        <button onClick={onOpenFinder} className="p-2 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors" title="Find item (Finder)">
          <Search className="w-4 h-4" />
        </button>

        <button onClick={onToggleTheme} className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors" title="Toggle Theme">
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <button onClick={onToggleAiSidebar} className={`p-2 rounded-lg transition-colors ${isAiSidebarOpen ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' : 'text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'}`} title="Quick AI Chat">
          <MessageCircle className="w-4 h-4" />
        </button>

        <button onClick={onToggleCalculator} className={`p-2 rounded-lg transition-colors ${showCalculator ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' : 'text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'}`} title="Profit Calculator">
          <Calculator className="w-4 h-4" />
        </button>

        <button onClick={onOpenSettings} className="p-2 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors" title="Settings & Backup">
          <Settings className="w-4 h-4" />
        </button>

        <button onClick={onLock} className="p-2 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors" title="Lock App">
          <Lock className="w-4 h-4" />
        </button>

        <button onClick={onOpenBulk} className="flex items-center gap-2 px-3 py-2 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20 rounded-lg text-sm font-medium transition-colors">
          <Sparkles className="w-4 h-4" />
          AI Bulk Add
        </button>
        <button onClick={onStartAdd} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors shadow-sm ml-2">
          <PlusCircle className="w-4 h-4" />
          Add Item
        </button>
      </nav>
      )}
    </div>
  </header>
);
