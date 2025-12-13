import React, { useState, useRef, useEffect, useMemo } from 'react';
import { InventoryItem } from '../types';
import { Trash2, Plus, ChevronLeft, ChevronRight, Calendar, Filter, Rows, Search, Download, Clock, X, DollarSign, Check, ExternalLink } from 'lucide-react';

interface DataGridProps {
  data: InventoryItem[];
  onDelete: (id: string) => void;
  onUpdate: (id: string, field: keyof InventoryItem, value: any) => void;
  onUpdateRow?: (item: InventoryItem) => void;
  onAddEmpty: () => void;
}

// Helper component for auto-expanding textarea
const AutoResizeTextarea: React.FC<{
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
}> = ({ value, onChange, placeholder, className }) => {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [value, className]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      rows={1}
      className={className}
      style={{ overflow: 'hidden', resize: 'none' }}
    />
  );
};

export const DataGrid: React.FC<DataGridProps> = ({ data, onDelete, onUpdate, onUpdateRow, onAddEmpty }) => {
  const [density, setDensity] = useState<'compact' | 'standard' | 'comfortable'>('standard');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'stock' | 'sold'>('all');

  const cycleDensity = () => {
    setDensity(current => {
      if (current === 'compact') return 'standard';
      if (current === 'standard') return 'comfortable';
      return 'compact';
    });
  };

  const d = {
    compact: { 
      headerPy: 'py-2', 
      rowPy: 'py-0.5', 
      text: 'text-xs', 
      inputPy: 'py-1',
      iconSize: 'w-3 h-3',
      label: 'Compact'
    },
    standard: { 
      headerPy: 'py-3', 
      rowPy: 'py-1.5', 
      text: 'text-sm', 
      inputPy: 'py-2.5',
      iconSize: 'w-4 h-4',
      label: 'Standard'
    },
    comfortable: { 
      headerPy: 'py-4', 
      rowPy: 'py-3', 
      text: 'text-base', 
      inputPy: 'py-3.5',
      iconSize: 'w-5 h-5',
      label: 'Comfortable'
    }
  }[density];

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const currentMonth = `${year}-${month}`;
    return currentMonth < '2025-09' ? '2025-09' : currentMonth;
  });

  const [colWidths, setColWidths] = useState({
    date: 110,
    item: 200,
    imei: 140,
    boughtFrom: 140,
    purchaseCost: 100,
    repairCost: 100,
    soldDate: 110,
    soldTo: 110,
    salePrice: 100,
    profit: 100,
    notes: 250
  });

  const visibleData = useMemo(() => {
    let filtered = data;

    // 1. Search (Overrides everything)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return filtered.filter(item => 
        item.item.toLowerCase().includes(q) || 
        item.imei.toLowerCase().includes(q) ||
        item.boughtFrom.toLowerCase().includes(q) ||
        item.soldTo.toLowerCase().includes(q) || 
        item.notes.toLowerCase().includes(q)
      ).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    // 2. Status Filter Logic
    if (statusFilter === 'stock') {
        // Show ALL in-stock items, regardless of month (you want to see all current inventory)
        return filtered.filter(item => !item.soldDate)
               .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    
    if (statusFilter === 'sold') {
        filtered = filtered.filter(item => !!item.soldDate);
        // Apply Month Filter to sold items
        return filtered.filter(item => item.soldDate.startsWith(selectedMonth))
               .sort((a, b) => new Date(b.soldDate).getTime() - new Date(a.soldDate).getTime());
    }

    // 3. Default (All) - Respect Month Filter
    return filtered.filter(item => {
      if (!item.soldDate) return true; // Always show active inventory
      if (item.soldDate.startsWith(selectedMonth)) return true; // Show sold in this month
      if (item.date.startsWith(selectedMonth)) return true; // Show bought in this month
      return false; 
    }).sort((a, b) => {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
  }, [data, selectedMonth, searchQuery, statusFilter]);

  const resizingRef = useRef<{ startX: number, startWidth: number, colKey: keyof typeof colWidths } | null>(null);

  const startResize = (e: React.MouseEvent, key: keyof typeof colWidths) => {
    e.preventDefault();
    e.stopPropagation();
    resizingRef.current = {
      startX: e.pageX,
      startWidth: colWidths[key],
      colKey: key
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!resizingRef.current) return;
    const { startX, startWidth, colKey } = resizingRef.current;
    const diff = e.pageX - startX;
    setColWidths(prev => ({ ...prev, [colKey]: Math.max(50, startWidth + diff) }));
  };

  const handleMouseUp = () => {
    resizingRef.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'default';
  };

  const ResizeHandle = ({ colKey }: { colKey: keyof typeof colWidths }) => (
    <div
      onMouseDown={(e) => startResize(e, colKey)}
      className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400/50 z-20 transition-colors"
      onClick={(e) => e.stopPropagation()}
    />
  );

  const handleMonthChange = (offset: number) => {
     const [y, m] = selectedMonth.split('-').map(Number);
     const date = new Date(Date.UTC(y, m - 1 + offset, 1));
     const newMonth = date.toISOString().slice(0, 7);
     if (newMonth < '2025-09') return;
     setSelectedMonth(newMonth);
  };

  const handleExportCSV = () => {
    const headers = ['Date In', 'Item', 'IMEI', 'Bought From', 'Purchase Cost', 'Repair Cost', 'Date Out', 'Sold To', 'Sale Price', 'Profit', 'Notes'];
    const csvContent = [
      headers.join(','),
      ...data.map(item => {
        const profit = item.salePrice ? (item.salePrice - item.purchaseCost - item.repairCost) : 0;
        return [
          item.date,
          `"${item.item.replace(/"/g, '""')}"`,
          `"${item.imei}"`,
          `"${item.boughtFrom}"`,
          item.purchaseCost,
          item.repairCost,
          item.soldDate,
          `"${item.soldTo}"`,
          item.salePrice,
          profit,
          `"${item.notes.replace(/"/g, '""')}"`
        ].join(',');
      })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    if (link.download !== undefined) {
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `biztrack_export_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const isAging = (dateStr: string) => {
    const diffTime = Math.abs(new Date().getTime() - new Date(dateStr).getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
    return diffDays > 45;
  };

  const handleCheckSickw = (imei: string) => {
    if (!imei) return;
    const cleanImei = imei.replace(/[^a-zA-Z0-9]/g, '');
    navigator.clipboard.writeText(cleanImei);
    window.open(`https://sickw.com/?imei=${cleanImei}`, '_blank');
  };

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-100 dark:border-slate-800 flex flex-col h-full transition-colors duration-200">
      <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-4 flex-wrap">
            <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            Inventory Sheet
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400 bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded-full">{visibleData.length} visible</span>
            </h2>
            
            {/* Search Bar */}
            <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                <Search className="w-4 h-4 text-slate-400" />
              </div>
              <input 
                type="text" 
                placeholder="Search..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-8 py-1.5 w-32 focus:w-48 transition-all bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:text-slate-200"
              />
               {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-1 hidden md:block"></div>

            {/* Status Filter */}
            <div className="flex bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 shadow-sm">
                {(['all', 'stock', 'sold'] as const).map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-colors ${statusFilter === s ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'}`}
                  >
                    {s === 'stock' ? 'In Stock' : s}
                  </button>
                ))}
            </div>

            {/* Month Filter Controls (Only if NOT searching AND NOT viewing Stock Only) */}
            {!searchQuery && statusFilter !== 'stock' && (
              <div className="flex items-center gap-2 bg-white dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 shadow-sm">
                  <button 
                    onClick={() => handleMonthChange(-1)} 
                    disabled={selectedMonth <= '2025-09'}
                    className={`p-1 rounded ${selectedMonth <= '2025-09' ? 'text-slate-300 dark:text-slate-600 cursor-not-allowed' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400'}`}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="relative">
                    <input 
                      type="month" 
                      value={selectedMonth}
                      min="2025-09"
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val && val >= '2025-09') {
                          setSelectedMonth(val);
                        }
                      }}
                      className="bg-transparent border-none outline-none text-sm font-medium text-slate-700 dark:text-slate-200 cursor-pointer w-[120px] text-center dark:[color-scheme:dark]"
                    />
                  </div>
                  <button onClick={() => handleMonthChange(1)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded text-slate-500 dark:text-slate-400">
                    <ChevronRight className="w-4 h-4" />
                  </button>
              </div>
            )}
            
             {/* Density Toggle */}
             <button 
                onClick={cycleDensity}
                className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm ml-auto md:ml-0"
                title="Change Table Density"
             >
                <Rows className="w-4 h-4" />
                <span className="text-xs font-medium hidden sm:inline">{d.label}</span>
             </button>

             {/* Export Button */}
             <button 
                onClick={handleExportCSV}
                className="flex items-center gap-2 px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
                title="Export to CSV"
             >
                <Download className="w-4 h-4" />
             </button>
        </div>
      </div>
      
      <div className="overflow-auto flex-1 custom-scrollbar pb-20">
        <table className="w-full text-left border-collapse table-fixed">
          <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10 shadow-sm backdrop-blur-sm">
            <tr className={`text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold ${d.text} text-[10px]`}>
              <th className={`${d.headerPy} px-2 border-b border-slate-200 dark:border-slate-700 w-10 text-center`}></th>
              
              <th style={{ width: colWidths.date }} className={`${d.headerPy} px-2 border-b border-slate-200 dark:border-slate-700 relative group`}>
                Date In <ResizeHandle colKey="date" />
              </th>
              <th style={{ width: colWidths.item }} className={`${d.headerPy} px-2 border-b border-slate-200 dark:border-slate-700 relative group`}>
                Item Name <ResizeHandle colKey="item" />
              </th>
              <th style={{ width: colWidths.imei }} className={`${d.headerPy} px-2 border-b border-slate-200 dark:border-slate-700 relative group`}>
                IMEI <ResizeHandle colKey="imei" />
              </th>
              <th style={{ width: colWidths.boughtFrom }} className={`${d.headerPy} px-2 border-b border-slate-200 dark:border-slate-700 relative group`}>
                Bought From <ResizeHandle colKey="boughtFrom" />
              </th>
              <th style={{ width: colWidths.purchaseCost }} className={`${d.headerPy} px-2 border-b border-slate-200 dark:border-slate-700 text-right relative group`}>
                Cost <ResizeHandle colKey="purchaseCost" />
              </th>
              <th style={{ width: colWidths.repairCost }} className={`${d.headerPy} px-2 border-b border-slate-200 dark:border-slate-700 text-right relative group`}>
                Repair <ResizeHandle colKey="repairCost" />
              </th>
              <th style={{ width: colWidths.soldDate }} className={`${d.headerPy} px-2 border-b border-slate-200 dark:border-slate-700 text-center relative group`}>
                Date Out <ResizeHandle colKey="soldDate" />
              </th>
              <th style={{ width: colWidths.soldTo }} className={`${d.headerPy} px-2 border-b border-slate-200 dark:border-slate-700 relative group`}>
                Sold To <ResizeHandle colKey="soldTo" />
              </th>
              <th style={{ width: colWidths.salePrice }} className={`${d.headerPy} px-2 border-b border-slate-200 dark:border-slate-700 text-right relative group`}>
                Price <ResizeHandle colKey="salePrice" />
              </th>
              <th style={{ width: colWidths.profit }} className={`${d.headerPy} px-4 border-b border-slate-200 dark:border-slate-700 text-right relative group`}>
                Profit <ResizeHandle colKey="profit" />
              </th>
              <th style={{ width: colWidths.notes }} className={`${d.headerPy} px-2 border-b border-slate-200 dark:border-slate-700 relative group`}>
                Notes <ResizeHandle colKey="notes" />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
            {visibleData.map((item) => {
              const profit = item.salePrice ? (item.salePrice - item.purchaseCost - item.repairCost) : 0;
              const isSold = !!item.soldDate;
              const isOldStock = !isSold && isAging(item.date);

              return (
                <tr key={item.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group ${!isSold ? 'bg-indigo-50/10 dark:bg-indigo-900/10' : ''}`}>
                  <td className={`px-2 text-center align-top ${d.rowPy} pt-2`}>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(item.id);
                      }}
                      className="text-slate-400 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-400 p-1.5 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                      title="Delete Row"
                    >
                      <Trash2 className={d.iconSize} />
                    </button>
                  </td>
                  
                  {/* Date In */}
                  <td className="p-0 border-r border-transparent hover:border-slate-200 dark:hover:border-slate-700 align-top relative">
                    <input 
                      type="date"
                      min="2025-09-01"
                      value={item.date}
                      onChange={(e) => onUpdate(item.id, 'date', e.target.value)}
                      className={`w-full px-2 bg-transparent outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:z-10 dark:text-slate-200 dark:[color-scheme:dark] ${d.inputPy} ${d.text}`}
                    />
                    {isOldStock && (
                      <div className="absolute top-1 right-1" title="High aging inventory (45+ days)">
                        <Clock className="w-3 h-3 text-amber-500" />
                      </div>
                    )}
                  </td>

                  {/* Item Name */}
                  <td className="p-0 border-r border-transparent hover:border-slate-200 dark:hover:border-slate-700 align-top">
                    <AutoResizeTextarea 
                      value={item.item}
                      onChange={(e) => onUpdate(item.id, 'item', e.target.value)}
                      className={`w-full px-2 bg-transparent outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:z-10 font-medium text-slate-900 dark:text-slate-100 min-h-[30px] ${d.inputPy} ${d.text}`}
                    />
                  </td>

                  {/* IMEI */}
                  <td className="p-0 border-r border-transparent hover:border-slate-200 dark:hover:border-slate-700 align-top relative group/imei">
                    <input 
                      type="text"
                      value={item.imei}
                      onChange={(e) => onUpdate(item.id, 'imei', e.target.value)}
                      placeholder="-"
                      className={`w-full px-2 bg-transparent outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:z-10 font-mono text-slate-500 dark:text-slate-400 pr-6 ${d.inputPy} ${d.text}`}
                    />
                    {item.imei && (
                      <button 
                        onClick={() => handleCheckSickw(item.imei)}
                        className="absolute right-1 top-1.5 opacity-0 group-hover/imei:opacity-100 p-1 text-slate-400 hover:text-rose-500 transition-opacity z-20"
                        title="Copy & Check SickW"
                      >
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    )}
                  </td>

                  {/* Bought From */}
                  <td className="p-0 border-r border-transparent hover:border-slate-200 dark:hover:border-slate-700 align-top">
                     <AutoResizeTextarea
                      value={item.boughtFrom}
                      onChange={(e) => onUpdate(item.id, 'boughtFrom', e.target.value)}
                      placeholder="-"
                      className={`w-full px-2 bg-transparent outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:z-10 dark:text-slate-300 min-h-[30px] ${d.inputPy} ${d.text}`}
                    />
                  </td>

                  {/* Purchase Cost */}
                  <td className="p-0 border-r border-transparent hover:border-slate-200 dark:hover:border-slate-700 align-top">
                    <input 
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.purchaseCost}
                      onChange={(e) => onUpdate(item.id, 'purchaseCost', parseFloat(e.target.value) || 0)}
                      className={`w-full px-2 bg-transparent outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:z-10 text-right font-mono dark:text-slate-200 ${d.inputPy} ${d.text}`}
                    />
                  </td>

                  {/* Repair Cost */}
                  <td className="p-0 border-r border-transparent hover:border-slate-200 dark:hover:border-slate-700 align-top">
                    <input 
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.repairCost}
                      onChange={(e) => onUpdate(item.id, 'repairCost', parseFloat(e.target.value) || 0)}
                      className={`w-full px-2 bg-transparent outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:z-10 text-right font-mono text-slate-500 dark:text-slate-400 ${d.inputPy} ${d.text}`}
                    />
                  </td>

                  {/* Date Out */}
                  <td className="p-0 border-r border-transparent hover:border-slate-200 dark:hover:border-slate-700 text-center align-top">
                     <div className="relative w-full h-full">
                       <input 
                        type="date"
                        min="2025-09-01"
                        value={item.soldDate}
                        onChange={(e) => onUpdate(item.id, 'soldDate', e.target.value)}
                        className={`w-full px-2 bg-transparent outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:z-10 text-center dark:[color-scheme:dark] ${d.inputPy} ${d.text} ${!item.soldDate ? 'text-transparent focus:text-slate-900 dark:focus:text-slate-100' : 'dark:text-slate-200'}`}
                      />
                      {!item.soldDate && <span className={`pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-indigo-400 dark:text-indigo-400 opacity-50 ${d.inputPy}`}>In Stock</span>}
                     </div>
                  </td>

                   {/* Sold To */}
                   <td className="p-0 border-r border-transparent hover:border-slate-200 dark:hover:border-slate-700 align-top">
                     <AutoResizeTextarea
                      value={item.soldTo}
                      onChange={(e) => onUpdate(item.id, 'soldTo', e.target.value)}
                      placeholder="-"
                      className={`w-full px-2 bg-transparent outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:z-10 dark:text-slate-300 min-h-[30px] ${d.inputPy} ${d.text}`}
                    />
                  </td>

                  {/* Sale Price */}
                  <td className="p-0 border-r border-transparent hover:border-slate-200 dark:hover:border-slate-700 align-top">
                    <input 
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.salePrice}
                      onChange={(e) => onUpdate(item.id, 'salePrice', parseFloat(e.target.value) || 0)}
                      className={`w-full px-2 bg-transparent outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:z-10 text-right font-mono dark:text-slate-200 ${d.inputPy} ${d.text}`}
                    />
                  </td>

                  {/* Profit (Read Only) */}
                  <td className={`px-4 text-right font-mono font-medium align-top ${d.inputPy} ${d.text} ${isSold ? (profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400') : 'text-slate-300 dark:text-slate-600'}`}>
                    {isSold ? `$${profit.toLocaleString()}` : '-'}
                  </td>

                  {/* Notes */}
                  <td className="p-0 border-r border-transparent hover:border-slate-200 dark:hover:border-slate-700 align-top">
                    <AutoResizeTextarea
                      value={item.notes}
                      onChange={(e) => onUpdate(item.id, 'notes', e.target.value)}
                      placeholder="Add notes..."
                      className={`w-full px-2 bg-transparent outline-none focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-600 focus:z-10 text-slate-500 dark:text-slate-500 italic min-h-[30px] ${d.inputPy} ${d.text}`}
                    />
                  </td>
                </tr>
              );
            })}
            
            {/* Add New Row Button Area */}
             <tr>
                <td colSpan={12} className="px-2 py-2">
                   <button 
                     onClick={onAddEmpty}
                     className="w-full py-3 flex items-center justify-center gap-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-indigo-300 dark:hover:border-indigo-700 rounded-lg transition-all font-medium text-sm group"
                   >
                     <Plus className="w-4 h-4 group-hover:scale-110 transition-transform" />
                     Add Row
                   </button>
                </td>
             </tr>

          </tbody>
        </table>
      </div>
    </div>
  );
};