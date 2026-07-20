import React from 'react';
import { LayoutDashboard, Table, ShoppingCart, Wrench, Menu } from 'lucide-react';
import { ViewState, Permission } from '../types';

// Fixed bottom navigation for phones — the five most-used destinations. "More"
// opens the full slide-out drawer (MobileDrawer) for everything else.
interface MobileNavProps {
  view: ViewState;
  onNavigate: (v: ViewState) => void;
  allow: (p: Permission) => boolean;
  onOpenMore: () => void;
}

const item = (active: boolean) =>
  `flex flex-col items-center justify-center gap-0.5 flex-1 tap-target rounded-lg ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`;

export const MobileNav: React.FC<MobileNavProps> = ({ view, onNavigate, allow, onOpenMore }) => (
  <nav aria-label="Primary" className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-1 pt-1 flex justify-around z-50 safe-b">
    <button aria-label="Dashboard" aria-current={view === 'dashboard'} onClick={() => onNavigate('dashboard')} className={item(view === 'dashboard')}>
      <LayoutDashboard className="w-5 h-5" /><span className="text-[10px]">Dashboard</span>
    </button>
    <button aria-label="Inventory" aria-current={view === 'grid'} onClick={() => onNavigate('grid')} className={item(view === 'grid')}>
      <Table className="w-5 h-5" /><span className="text-[10px]">Inventory</span>
    </button>
    {allow('repairs.tech') && (
      <button aria-label="Repairs" aria-current={view === 'repairs'} onClick={() => onNavigate('repairs')} className={item(view === 'repairs')}>
        <Wrench className="w-5 h-5" /><span className="text-[10px]">Repairs</span>
      </button>
    )}
    <button aria-label="Checkout" aria-current={view === 'pos'} onClick={() => onNavigate('pos')} className={item(view === 'pos')}>
      <ShoppingCart className="w-5 h-5" /><span className="text-[10px]">Checkout</span>
    </button>
    <button aria-label="More menu" onClick={onOpenMore} className={item(false)}>
      <Menu className="w-5 h-5" /><span className="text-[10px]">More</span>
    </button>
  </nav>
);
