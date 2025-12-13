import React from 'react';
import { ArrowUpRight, ArrowDownRight, DollarSign, Package, Percent, BarChart } from 'lucide-react';

interface SummaryCardProps {
  title: string;
  value: string;
  subValue?: string;
  trend?: string;
  trendUp?: boolean;
  icon: 'dollar' | 'package' | 'percent' | 'bar-chart';
  color: 'emerald' | 'blue' | 'indigo' | 'violet';
}

export const SummaryCard: React.FC<SummaryCardProps> = ({ title, value, subValue, trend, trendUp, icon, color }) => {
  const getIcon = () => {
    switch (icon) {
      case 'dollar': return <DollarSign className="w-5 h-5 text-white" />;
      case 'package': return <Package className="w-5 h-5 text-white" />;
      case 'percent': return <Percent className="w-5 h-5 text-white" />;
      case 'bar-chart': return <BarChart className="w-5 h-5 text-white" />;
      default: return <DollarSign className="w-5 h-5 text-white" />;
    }
  };

  const getColorClass = () => {
    switch (color) {
      case 'emerald': return 'bg-emerald-500 shadow-emerald-500/30';
      case 'blue': return 'bg-blue-500 shadow-blue-500/30';
      case 'indigo': return 'bg-indigo-500 shadow-indigo-500/30';
      case 'violet': return 'bg-violet-500 shadow-violet-500/30';
      default: return 'bg-slate-500';
    }
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm p-6 border border-slate-100 dark:border-slate-800 flex items-start justify-between transition-all hover:translate-y-[-2px] hover:shadow-md relative overflow-hidden group">
      {/* Background decoration */}
      <div className={`absolute -right-4 -top-4 w-24 h-24 rounded-full opacity-5 ${getColorClass().split(' ')[0]} blur-2xl group-hover:scale-110 transition-transform duration-500`}></div>

      <div className="relative z-10">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">{value}</h3>
        
        <div className="flex items-center gap-3 mt-2">
           {subValue && (
              <span className="text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-2 py-0.5 rounded-md">
                 {subValue}
              </span>
           )}
           {trend && (
            <div className={`flex items-center text-xs font-bold ${trendUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                {trendUp ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                {trend}
            </div>
           )}
        </div>
      </div>
      <div className={`p-3 rounded-xl shadow-lg relative z-10 ${getColorClass()}`}>
        {getIcon()}
      </div>
    </div>
  );
};