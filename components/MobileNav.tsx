import React from 'react';
import { LayoutDashboard, PlusCircle, Table, Calculator, Bot, ShoppingCart } from 'lucide-react';
import { ViewState } from '../types';

// Fixed bottom navigation bar for mobile. Extracted verbatim from App.tsx.
interface MobileNavProps {
  view: ViewState;
  onNavigate: (v: ViewState) => void;
  onStartAdd: () => void;
  onOpenAiSidebar: () => void;
  showCalculator: boolean;
  onToggleCalculator: () => void;
}

const itemClass = (active: boolean) =>
  `flex flex-col items-center p-2 rounded-lg ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`;

export const MobileNav: React.FC<MobileNavProps> = ({
  view, onNavigate, onStartAdd, onOpenAiSidebar, showCalculator, onToggleCalculator,
}) => (
  <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-2 flex justify-around z-50">
    <button onClick={() => onNavigate('dashboard')} className={itemClass(view === 'dashboard')}>
      <LayoutDashboard className="w-6 h-6" />
      <span className="text-[10px] mt-1">Dash</span>
    </button>
    <button onClick={() => onNavigate('grid')} className={itemClass(view === 'grid')}>
      <Table className="w-6 h-6" />
      <span className="text-[10px] mt-1">Sheet</span>
    </button>
    <button onClick={() => onNavigate('pos')} className={itemClass(view === 'pos')}>
      <ShoppingCart className="w-6 h-6" />
      <span className="text-[10px] mt-1">Sell</span>
    </button>
    <button onClick={onStartAdd} className={itemClass(view === 'entry')}>
      <PlusCircle className="w-6 h-6" />
      <span className="text-[10px] mt-1">Add</span>
    </button>
    <button onClick={onOpenAiSidebar} className={itemClass(view === 'ai')}>
      <Bot className="w-6 h-6" />
      <span className="text-[10px] mt-1">AI</span>
    </button>
    <button onClick={onToggleCalculator} className={itemClass(showCalculator)}>
      <Calculator className="w-6 h-6" />
      <span className="text-[10px] mt-1">Calc</span>
    </button>
  </div>
);
