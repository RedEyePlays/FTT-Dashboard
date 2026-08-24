import React, { useState } from 'react';
import { InventoryItem } from '../types';
import { parseBulkInventory } from '../services/geminiService';
import { Sparkles, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface BulkEntryModalProps {
  onClose: () => void;
  onImport: (items: InventoryItem[]) => void;
}

export const BulkEntryModal: React.FC<BulkEntryModalProps> = ({ onClose, onImport }) => {
  const [inputText, setInputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [parsedItems, setParsedItems] = useState<InventoryItem[]>([]);
  const [step, setStep] = useState<'input' | 'preview'>('input');
  const [error, setError] = useState<string | null>(null);

  const handleProcess = async () => {
    if (!inputText.trim()) return;
    setIsProcessing(true);
    setError(null);
    try {
      const items = await parseBulkInventory(inputText);
      if (items.length === 0) {
        setError("No items could be identified. Please try providing more detail.");
      } else {
        setParsedItems(items);
        setStep('preview');
      }
    } catch (err) {
      setError("Failed to process text. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const updateItem = (index: number, field: keyof InventoryItem, value: any) => {
    const newItems = [...parsedItems];
    newItems[index] = { ...newItems[index], [field]: value };
    setParsedItems(newItems);
  };

  const handleImport = () => {
    onImport(parsedItems);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh] transition-colors">
        
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800 rounded-t-xl">
          <div className="flex items-center gap-2">
            <div className="bg-gradient-to-br from-indigo-500 to-violet-600 p-1.5 rounded-lg text-white">
              <Sparkles className="w-5 h-5" />
            </div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">AI Bulk Entry</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
          {step === 'input' ? (
            <div className="space-y-4">
              <div className="bg-indigo-50 dark:bg-indigo-900/10 p-4 rounded-lg text-sm text-indigo-800 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/30">
                <p className="font-semibold mb-1">How this works:</p>
                <p>Paste informal text below (e.g., invoices, chat messages, or rough notes). our AI will extract item details, prices, dates, and people automatically.</p>
              </div>
              <textarea
                autoFocus
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={`Example:\nBought 3 iPhone 13s from Mike yesterday for $400 each. Sold one to Sarah today for $600.\nAlso repaired a Samsung S22 screen for $50, bought for $200 from OfferUp.`}
                className="w-full h-64 p-4 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none text-slate-700 dark:text-slate-200 placeholder:text-slate-400 bg-white dark:bg-slate-800"
              />
              {error && (
                <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 text-sm bg-rose-50 dark:bg-rose-900/20 p-3 rounded-lg">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
               <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-lg text-sm font-medium">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5" />
                    Successfully identified {parsedItems.length} items!
                  </div>
                  <span className="text-xs opacity-75">Review and edit below before importing</span>
               </div>
               <div className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                 <table className="w-full text-left text-sm">
                   <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-semibold">
                     <tr>
                       <th className="px-3 py-2 w-32">Date</th>
                       <th className="px-3 py-2">Item</th>
                       <th className="px-3 py-2 w-28 text-right">Cost</th>
                       <th className="px-3 py-2 w-28 text-right">Sale Price</th>
                       <th className="px-3 py-2 w-32">Source</th>
                       <th className="px-3 py-2 w-10"></th>
                     </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900">
                     {parsedItems.map((item, idx) => (
                       <tr key={idx} className="group hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                         <td className="px-3 py-2">
                            <input 
                              type="date" 
                              value={item.date} 
                              onChange={(e) => updateItem(idx, 'date', e.target.value)}
                              className="w-full bg-transparent border-none outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 py-0.5 text-slate-700 dark:text-slate-300 dark:[color-scheme:dark]"
                            />
                         </td>
                         <td className="px-3 py-2">
                           <input 
                              type="text" 
                              value={item.item} 
                              onChange={(e) => updateItem(idx, 'item', e.target.value)}
                              className="w-full bg-transparent border-none outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 py-0.5 text-slate-900 dark:text-white font-medium"
                            />
                         </td>
                         <td className="px-3 py-2 text-right">
                           <input 
                              type="number" 
                              value={item.purchaseCost} 
                              onChange={(e) => updateItem(idx, 'purchaseCost', parseFloat(e.target.value) || 0)}
                              className="w-full bg-transparent border-none outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 py-0.5 text-right text-slate-700 dark:text-slate-300"
                            />
                         </td>
                         <td className="px-3 py-2 text-right">
                           <input 
                              type="number" 
                              value={item.salePrice} 
                              onChange={(e) => updateItem(idx, 'salePrice', parseFloat(e.target.value) || 0)}
                              className="w-full bg-transparent border-none outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 py-0.5 text-right text-emerald-600 dark:text-emerald-400 font-medium"
                            />
                         </td>
                         <td className="px-3 py-2">
                           <input 
                              type="text" 
                              value={item.boughtFrom} 
                              onChange={(e) => updateItem(idx, 'boughtFrom', e.target.value)}
                              className="w-full bg-transparent border-none outline-none focus:ring-1 focus:ring-indigo-500 rounded px-1 py-0.5 text-slate-500 dark:text-slate-500"
                              placeholder="-"
                            />
                         </td>
                         <td className="px-2 py-2 text-center">
                            <button 
                                onClick={() => {
                                    const newItems = parsedItems.filter((_, i) => i !== idx);
                                    setParsedItems(newItems);
                                }}
                                className="text-slate-300 hover:text-rose-500 transition-colors"
                            >
                                <X className="w-4 h-4" />
                            </button>
                         </td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
               </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-800 rounded-b-xl">
          {step === 'input' ? (
            <button
              onClick={handleProcess}
              disabled={isProcessing || !inputText.trim()}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 disabled:bg-indigo-400 text-white px-6 py-2.5 rounded-lg font-medium transition-all shadow-sm"
            >
              {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isProcessing ? 'Processing...' : 'Parse with AI'}
            </button>
          ) : (
            <>
              <button
                onClick={() => setStep('input')}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 font-medium"
              >
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={parsedItems.length === 0}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600 text-white px-6 py-2.5 rounded-lg font-medium transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle className="w-4 h-4" />
                Import {parsedItems.length} Items
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};