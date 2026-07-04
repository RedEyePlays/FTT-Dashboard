
import React, { useState, useMemo } from 'react';
import { InventoryItem } from '../types';
import { SummaryCard } from './SummaryCard';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import { Sparkles, Loader2, Calendar, Filter, ArrowUpRight, ArrowDownRight, TrendingUp } from 'lucide-react';
import { getFinancialInsights } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';

interface DashboardProps {
  data: InventoryItem[];
  darkMode?: boolean;
  canViewProfit?: boolean;
}

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];
const ROI_GOOD_THRESHOLD = 20; // Used to determine "good" ROI trend

const calculateNetProfit = (item: InventoryItem): number => {
    if (!item.soldDate) return 0;
    return (item.salePrice || 0) - (item.purchaseCost || 0) - (item.repairCost || 0) - (item.shippingCost || 0) - (item.platformFees || 0);
};

const calculateTotalCost = (item: InventoryItem): number => {
    return (item.purchaseCost || 0) + (item.repairCost || 0) + (item.shippingCost || 0) + (item.platformFees || 0);
};

export const Dashboard: React.FC<DashboardProps> = ({ data, darkMode = false, canViewProfit = true }) => {
  const mask = (v: string) => canViewProfit ? v : '•••';
  const [insight, setInsight] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [timeFilter, setTimeFilter] = useState<string>('All');
  
  const years = useMemo(() => {
    const uniqueYears = new Set<string>();
    data.forEach(item => {
      if (item.date) uniqueYears.add(item.date.split('-')[0]);
      if (item.soldDate) uniqueYears.add(item.soldDate.split('-')[0]);
    });
    return Array.from(uniqueYears).sort().reverse();
  }, [data]);

  const filteredData = useMemo(() => {
    if (timeFilter === 'All') return data;
    return data.filter(item => {
      const buyYear = item.date ? item.date.split('-')[0] : '';
      const sellYear = item.soldDate ? item.soldDate.split('-')[0] : '';
      return buyYear === timeFilter || sellYear === timeFilter;
    });
  }, [data, timeFilter]);

  const {
    soldItems,
    unsoldItems,
    totalRevenue,
    cogs,
    totalProfit,
    totalInvestedUnsold,
    roi,
    margin,
    avgDaysToSell
  } = useMemo(() => {
    const sold = filteredData.filter(i => i.soldDate);
    const unsold = filteredData.filter(i => !i.soldDate);

    const revenue = sold.reduce((sum, item) => sum + (item.salePrice || 0), 0);
    const totalCosts = sold.reduce((sum, item) => sum + calculateTotalCost(item), 0);
    const profit = sold.reduce((sum, item) => sum + calculateNetProfit(item), 0);
    
    const investedUnsold = unsold.reduce((sum, item) => sum + (item.purchaseCost || 0) + (item.repairCost || 0), 0);
    
    const returnOnInvestment = totalCosts > 0 ? (profit / totalCosts) * 100 : 0;
    const profitMargin = revenue > 0 ? (profit / revenue) * 100 : 0;

    const totalDays = sold.reduce((sum, item) => {
      const start = new Date(item.date).getTime();
      const end = new Date(item.soldDate!).getTime();
      return sum + ((end - start) / (1000 * 3600 * 24));
    }, 0);
    const averageDays = sold.length > 0 ? Math.round(totalDays / sold.length) : 0;
    
    return {
      soldItems: sold,
      unsoldItems: unsold,
      totalRevenue: revenue,
      cogs: totalCosts,
      totalProfit: profit,
      totalInvestedUnsold: investedUnsold,
      roi: returnOnInvestment,
      margin: profitMargin,
      avgDaysToSell: averageDays,
    };
  }, [filteredData]);

  const monthlyTableData = useMemo(() => {
    const stats: Record<string, { monthStr: string, purchased: number, repair: number, shipping: number, fees: number, sold: number, profit: number, countBought: number, countSold: number }> = {};

    data.forEach(item => {
      const purchaseMonth = item.date.slice(0, 7);
      if (!stats[purchaseMonth]) stats[purchaseMonth] = { monthStr: purchaseMonth, purchased: 0, repair: 0, shipping: 0, fees: 0, sold: 0, profit: 0, countBought: 0, countSold: 0 };
      stats[purchaseMonth].purchased += item.purchaseCost;
      stats[purchaseMonth].repair += item.repairCost;
      stats[purchaseMonth].countBought += 1;

      if (item.soldDate) {
        const saleMonth = item.soldDate.slice(0, 7);
        if (!stats[saleMonth]) stats[saleMonth] = { monthStr: saleMonth, purchased: 0, repair: 0, shipping: 0, fees: 0, sold: 0, profit: 0, countBought: 0, countSold: 0 };
        stats[saleMonth].sold += item.salePrice;
        stats[saleMonth].shipping += item.shippingCost;
        stats[saleMonth].fees += item.platformFees;
        stats[saleMonth].countSold += 1;
        // Allocate profit to the month it was realized (sold)
        stats[saleMonth].profit += calculateNetProfit(item);
      }
    });
    
    let rows = Object.values(stats);

    if (timeFilter !== 'All') {
      rows = rows.filter(r => r.monthStr.startsWith(timeFilter));
    }

    return rows.sort((a, b) => b.monthStr.localeCompare(a.monthStr));
  }, [data, timeFilter]);


  const chartData = useMemo(() => {
    return [...monthlyTableData].reverse().map(row => ({
        name: new Date(row.monthStr + "-02").toLocaleString('default', { month: 'short', year: '2-digit' }),
        profit: row.profit,
        revenue: row.sold,
        spent: row.purchased + row.repair + row.shipping + row.fees,
    }));
  }, [monthlyTableData]);

  const sourcingData = useMemo(() => {
    const sources: Record<string, number> = {};
    filteredData.forEach(item => {
      const source = item.boughtFrom || 'Unknown';
      sources[source] = (sources[source] || 0) + 1;
    });
    return Object.entries(sources).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [filteredData]);

  const topProducts = useMemo(() => {
    const products: Record<string, { count: number, profit: number }> = {};
    soldItems.forEach(item => {
      const name = item.item.split(' ').slice(0, 2).join(' ');
      if (!products[name]) products[name] = { count: 0, profit: 0 };
      products[name].count += 1;
      products[name].profit += calculateNetProfit(item);
    });
    return Object.entries(products).map(([name, stats]) => ({ name, ...stats })).sort((a, b) => b.profit - a.profit).slice(0, 5);
  }, [soldItems]);

  const handleGenerateInsight = async () => {
    setIsLoading(true);
    setInsight(null);
    const result = await getFinancialInsights(filteredData);
    setInsight(result);
    setIsLoading(false);
  };

  const axisColor = darkMode ? '#94a3b8' : '#64748b';
  const gridColor = darkMode ? '#334155' : '#e2e8f0';
  const tooltipBg = darkMode ? '#1e293b' : '#fff';
  const tooltipBorder = darkMode ? '#334155' : '#e2e8f0';
  const tooltipText = darkMode ? '#f1f5f9' : '#0f172a';

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            Dashboard
            <span className="text-xs font-normal px-2.5 py-0.5 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400">{filteredData.length} items</span>
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Performance metrics and financial breakdown.</p>
        </div>
        <div className="flex items-center gap-3">
           <div className="relative">
             <Filter className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
             <select value={timeFilter} onChange={(e) => setTimeFilter(e.target.value)} className="pl-9 pr-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none appearance-none cursor-pointer hover:border-indigo-300 transition-colors shadow-sm">
               <option value="All">All Time</option>
               {years.map(y => <option key={y} value={y}>{y}</option>)}
             </select>
           </div>
          <button onClick={handleGenerateInsight} disabled={isLoading} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-70 disabled:cursor-not-allowed">
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {isLoading ? 'Analyzing...' : 'AI Insights'}
          </button>
        </div>
      </div>

      {isLoading && (
         <div className="bg-slate-100 dark:bg-slate-800/50 p-6 rounded-xl shadow-sm animate-pulse">
            <div className="flex items-center gap-2 mb-4 border-b border-slate-200 dark:border-white/10 pb-2">
               <Sparkles className="w-5 h-5 text-slate-400" />
               <h3 className="font-semibold text-lg text-slate-500">Generating Analysis...</h3>
            </div>
            <div className="space-y-3">
               <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-3/4"></div>
               <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
               <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded w-5/6"></div>
            </div>
         </div>
      )}
      {insight && !isLoading && (
        <div className="bg-gradient-to-r from-slate-900 to-slate-800 dark:from-indigo-950/40 dark:to-slate-900/60 text-slate-100 p-6 rounded-xl shadow-lg border border-slate-700 dark:border-indigo-500/30 animate-fadeIn relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10"><Sparkles className="w-32 h-32" /></div>
          <div className="flex items-center gap-2 mb-4 border-b border-slate-700 dark:border-white/10 pb-2 relative z-10">
            <Sparkles className="w-5 h-5 text-indigo-400" />
            <h3 className="font-semibold text-lg">AI Strategic Analysis</h3>
          </div>
          <div className="prose prose-invert max-w-none text-sm text-slate-300 dark:text-slate-200 relative z-10 leading-relaxed"><ReactMarkdown>{insight}</ReactMarkdown></div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard title="Net Profit" value={mask(`$${totalProfit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`)} trend={canViewProfit && totalProfit > 0 ? "+" : ""} trendUp={totalProfit >= 0} icon="dollar" color="emerald" />
        <SummaryCard title="Total Revenue" value={`$${totalRevenue.toLocaleString()}`} icon="bar-chart" color="blue" />
        <SummaryCard title="Inventory Value" value={`$${totalInvestedUnsold.toLocaleString()}`} subValue={`${unsoldItems.length} items`} icon="package" color="violet" />
        <SummaryCard title="ROI" value={mask(`${roi.toFixed(1)}%`)} subValue={canViewProfit ? `${margin.toFixed(1)}% Margin` : 'Restricted'} icon="percent" color="indigo" trendUp={roi > ROI_GOOD_THRESHOLD} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
             <div>
               <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Avg Days to Sell</p>
               <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{avgDaysToSell} <span className="text-sm font-normal text-slate-400">days</span></h3>
             </div>
             <div className="bg-orange-100 dark:bg-orange-900/30 p-3 rounded-lg text-orange-600 dark:text-orange-400"><TrendingUp className="w-6 h-6" /></div>
          </div>
           <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
             <div>
               <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Sales Velocity</p>
               <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{soldItems.length} <span className="text-sm font-normal text-slate-400">sold / {timeFilter}</span></h3>
             </div>
             <div className="bg-blue-100 dark:bg-blue-900/30 p-3 rounded-lg text-blue-600 dark:text-blue-400"><ArrowUpRight className="w-6 h-6" /></div>
          </div>
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex items-center justify-between">
             <div>
               <p className="text-slate-500 dark:text-slate-400 text-sm font-medium">Avg Profit / Item</p>
               <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{mask(`$${soldItems.length ? (totalProfit / soldItems.length).toFixed(2) : '0.00'}`)}</h3>
             </div>
             <div className="bg-emerald-100 dark:bg-emerald-900/30 p-3 rounded-lg text-emerald-600 dark:text-emerald-400"><ArrowDownRight className="w-6 h-6" /></div>
          </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-500" />Net Profit Trend</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: axisColor, fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: axisColor, fontSize: 12}} tickFormatter={(value) => `$${value}`} />
                <Tooltip contentStyle={{ backgroundColor: tooltipBg, borderRadius: '8px', border: `1px solid ${tooltipBorder}`, color: tooltipText }} formatter={(value: number) => [`$${value.toLocaleString()}`, '']} labelStyle={{ color: axisColor }} />
                <Legend />
                <Line type="monotone" name="Net Profit" dataKey="profit" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: tooltipBg }} />
                <Line type="monotone" name="Revenue" dataKey="revenue" stroke="#3b82f6" strokeWidth={2} dot={false} strokeDasharray="5 5" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6">Top Sources</h3>
          <div className="h-60 w-full relative">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={sourcingData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {sourcingData.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: tooltipBg, borderRadius: '8px', border: `1px solid ${tooltipBorder}`, color: tooltipText }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="text-2xl font-bold text-slate-800 dark:text-slate-100">{filteredData.length}</span>
                <span className="text-xs text-slate-500 uppercase font-medium">Items</span>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {sourcingData.slice(0, 4).map((entry, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                   <div className="w-3 h-3 rounded-full" style={{backgroundColor: COLORS[idx % COLORS.length]}}></div>
                   <span className="text-slate-600 dark:text-slate-300 truncate max-w-[120px]">{entry.name}</span>
                </div>
                <span className="font-medium text-slate-900 dark:text-white">{entry.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6">Money In vs. Money Out</h3>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barGap={8}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: axisColor, fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: axisColor, fontSize: 12}} tickFormatter={(value) => `$${value}`} />
                <Tooltip cursor={{fill: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}} contentStyle={{ backgroundColor: tooltipBg, borderRadius: '8px', border: `1px solid ${tooltipBorder}`, color: tooltipText }} formatter={(value: number) => [`$${value.toLocaleString()}`]} labelStyle={{ color: axisColor }} />
                <Legend iconType="circle" />
                <Bar name="Spent" dataKey="spent" fill="#818cf8" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar name="Revenue" dataKey="revenue" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-6 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-6">Top Performing Models</h3>
          <div className="flex-1 overflow-auto">
             <table className="w-full text-left text-sm">
                <thead>
                   <tr className="text-xs font-semibold text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
                     <th className="pb-3 pl-2">Product Line</th>
                     <th className="pb-3 text-right">Sold</th>
                     <th className="pb-3 text-right pr-2">Net Profit</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {topProducts.map((p, idx) => (
                    <tr key={idx} className="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                      <td className="py-3 pl-2 font-medium text-slate-700 dark:text-slate-200">{p.name}</td>
                      <td className="py-3 text-right text-slate-600 dark:text-slate-400">{p.count}</td>
                      <td className="py-3 text-right pr-2 font-bold text-emerald-600 dark:text-emerald-400">${p.profit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    </tr>
                  ))}
                  {topProducts.length === 0 && ( <tr><td colSpan={3} className="py-8 text-center text-slate-400">No sales data.</td></tr> )}
                </tbody>
             </table>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col overflow-hidden">
         <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
             <div>
               <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Calendar className="w-5 h-5 text-indigo-500" />Monthly Ledger</h3>
               <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Aggregated cash flow of inventory costs and sales revenue per month.</p>
             </div>
         </div>
         <div className="overflow-x-auto">
           <table className="w-full text-left text-sm">
             <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-700">
               <tr>
                 <th className="px-6 py-3">Month</th>
                 <th className="px-6 py-3 text-right">Purchased</th>
                 <th className="px-6 py-3 text-right">Other Costs</th>
                 <th className="px-6 py-3 text-right">Revenue</th>
                 <th className="px-6 py-3 text-right">Net Profit</th>
                 <th className="px-6 py-3 text-center"># Bought</th>
                 <th className="px-6 py-3 text-center"># Sold</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
               {monthlyTableData.map((row) => {
                 const monthLabel = new Date(row.monthStr + "-02").toLocaleString('default', { month: 'long', year: 'numeric' });
                 const otherCosts = row.repair + row.shipping + row.fees;
                 return (
                   <tr key={row.monthStr} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                     <td className="px-6 py-3 font-medium text-slate-800 dark:text-slate-200">{monthLabel}</td>
                     <td className="px-6 py-3 text-right text-slate-600 dark:text-slate-400">${row.purchased.toLocaleString()}</td>
                     <td className="px-6 py-3 text-right text-slate-600 dark:text-slate-400">${otherCosts.toLocaleString()}</td>
                     <td className="px-6 py-3 text-right font-medium text-slate-800 dark:text-slate-200">${row.sold.toLocaleString()}</td>
                     <td className={`px-6 py-3 text-right font-bold ${row.profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                       ${row.profit.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                     </td>
                     <td className="px-6 py-3 text-center text-slate-600 dark:text-slate-400">{row.countBought}</td>
                     <td className="px-6 py-3 text-center text-slate-600 dark:text-slate-400">{row.countSold}</td>
                   </tr>
                 );
               })}
               {monthlyTableData.length === 0 && ( <tr><td colSpan={7} className="px-6 py-12 text-center text-slate-400">No data for this period.</td></tr> )}
             </tbody>
             {monthlyTableData.length > 0 && (
                <tfoot className="bg-slate-50 dark:bg-slate-800/50 font-bold text-slate-800 dark:text-slate-100">
                    <tr>
                    <td className="px-6 py-4">Total</td>
                    <td className="px-6 py-4 text-right">${monthlyTableData.reduce((a, r) => a + r.purchased, 0).toLocaleString()}</td>
                    <td className="px-6 py-4 text-right">${monthlyTableData.reduce((a, r) => a + r.repair + r.shipping + r.fees, 0).toLocaleString()}</td>
                    <td className="px-6 py-4 text-right">${monthlyTableData.reduce((a, r) => a + r.sold, 0).toLocaleString()}</td>
                    <td className={`px-6 py-4 text-right ${monthlyTableData.reduce((a, r) => a + r.profit, 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        ${monthlyTableData.reduce((a, r) => a + r.profit, 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </td>
                    <td className="px-6 py-4 text-center">{monthlyTableData.reduce((a, r) => a + r.countBought, 0)}</td>
                    <td className="px-6 py-4 text-center">{monthlyTableData.reduce((a, r) => a + r.countSold, 0)}</td>
                    </tr>
                </tfoot>
             )}
           </table>
         </div>
      </div>
    </div>
  );
};
