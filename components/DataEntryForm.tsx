import React, { useState, useEffect, useRef } from 'react';
import { InventoryItem } from '../types';
import { PlusCircle, Save, X, Calculator, Camera, ExternalLink, Copy, Mic, MicOff, ClipboardPaste } from 'lucide-react';
import { ImeiScanner } from './ImeiScanner';

interface DataEntryFormProps {
  initialData?: InventoryItem;
  onSave: (record: InventoryItem) => void;
  onCancel: () => void;
}

const BLANK_FORM: Omit<InventoryItem, 'id'> = {
    date: new Date().toISOString().split('T')[0] < '2025-09-01' ? '2025-09-01' : new Date().toISOString().split('T')[0],
    item: '',
    imei: '',
    boughtFrom: '',
    purchaseCost: '',
    repairCost: '',
    soldDate: '',
    soldTo: '',
    salePrice: '',
    shippingCost: '',
    platformFees: '',
    notes: ''
};

export const DataEntryForm: React.FC<DataEntryFormProps> = ({ initialData, onSave, onCancel }) => {
  const [formData, setFormData] = useState<Omit<InventoryItem, 'id'>>(BLANK_FORM);
  const [showScanner, setShowScanner] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    if (initialData) {
      setFormData({
        date: initialData.date || '',
        item: initialData.item || '',
        imei: initialData.imei || '',
        boughtFrom: initialData.boughtFrom || '',
        purchaseCost: initialData.purchaseCost?.toString() || '',
        repairCost: initialData.repairCost?.toString() || '',
        soldDate: initialData.soldDate || '',
        soldTo: initialData.soldTo || '',
        salePrice: initialData.salePrice?.toString() || '',
        shippingCost: initialData.shippingCost?.toString() || '',
        platformFees: initialData.platformFees?.toString() || '',
        notes: initialData.notes || ''
      });
    } else {
        setFormData(BLANK_FORM);
    }
  }, [initialData]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => e.target.select();

  const toggleListening = () => {
    if (isListening) {
        recognitionRef.current?.stop();
        return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
        alert("Voice recognition not supported. Try Chrome or Safari.");
        return;
    }
    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setFormData(prev => ({ ...prev, notes: prev.notes ? `${prev.notes} ${transcript}` : transcript }));
    };
    recognition.onerror = (event: any) => console.error("Speech error", event);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const newRecord: InventoryItem = {
      id: initialData ? initialData.id : Date.now().toString(),
      date: formData.date,
      item: formData.item,
      imei: formData.imei,
      boughtFrom: formData.boughtFrom,
      purchaseCost: parseFloat(formData.purchaseCost as string) || 0,
      repairCost: parseFloat(formData.repairCost as string) || 0,
      soldDate: formData.soldDate,
      soldTo: formData.soldTo,
      salePrice: parseFloat(formData.salePrice as string) || 0,
      shippingCost: parseFloat(formData.shippingCost as string) || 0,
      platformFees: parseFloat(formData.platformFees as string) || 0,
      notes: formData.notes
    };

    onSave(newRecord);
  };
  
  const handleScanResult = (scannedImei: string) => {
    setFormData(prev => ({ ...prev, imei: scannedImei }));
    setShowScanner(false);
  };

  const handleCheckSickw = () => {
    if (!formData.imei) return;
    const cleanImei = formData.imei.replace(/[^a-zA-Z0-9]/g, '');
    navigator.clipboard.writeText(cleanImei);
    window.open(`https://sickw.com/?imei=${cleanImei}`, '_blank');
  };

  const handleCopyPurchaseDate = () => {
    navigator.clipboard.writeText(formData.date);
  };

  const handlePasteDate = async () => {
    const text = await navigator.clipboard.readText();
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (dateRegex.test(text)) {
      setFormData(prev => ({...prev, soldDate: text}));
    } else {
      alert("Invalid date format in clipboard. Please copy a date in YYYY-MM-DD format.");
    }
  };

  const profit = (parseFloat(formData.salePrice as string) || 0) 
                 - (parseFloat(formData.purchaseCost as string) || 0) 
                 - (parseFloat(formData.repairCost as string) || 0)
                 - (parseFloat(formData.shippingCost as string) || 0)
                 - (parseFloat(formData.platformFees as string) || 0);

  return (
    <div className="max-w-4xl mx-auto bg-white dark:bg-slate-900 rounded-xl shadow-lg border border-slate-100 dark:border-slate-800 overflow-hidden my-4 transition-colors">
      <div className="bg-slate-50 dark:bg-slate-800 px-6 py-4 border-b border-slate-100 dark:border-slate-700 flex justify-between items-center">
        <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-2">
          {initialData ? 'Edit Item' : 'Add New Item'}
        </h2>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
      </div>
      
      <form onSubmit={handleSubmit} className="p-6 space-y-6">
        {/* Acquisition Section */}
        <div className="bg-indigo-50/50 dark:bg-indigo-900/10 p-4 rounded-xl border border-indigo-100 dark:border-indigo-900/30">
           <h3 className="text-xs font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider mb-4 flex items-center gap-2">
             <PlusCircle className="w-4 h-4" /> Acquisition Details
           </h3>
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Purchase Date</label>
                <div className="flex gap-2">
                  <input type="text" placeholder="YYYY-MM-DD" name="date" required pattern="\d{4}-\d{2}-\d{2}" value={formData.date} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm dark:text-slate-100" />
                  <button type="button" onClick={handleCopyPurchaseDate} className="p-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" title="Copy Date"><Copy className="w-5 h-5" /></button>
                </div>
            </div>
            <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Item Name / Model</label>
                <input type="text" name="item" required placeholder="e.g. iPhone 14 Pro Max 256GB" value={formData.item} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm dark:text-slate-100" />
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">IMEI / Serial</label>
                <div className="flex gap-2">
                  <input type="text" name="imei" placeholder="Scan or type..." value={formData.imei} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm font-mono dark:text-slate-100" />
                  <button type="button" onClick={() => setShowScanner(true)} className="p-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" title="Scan with Camera"><Camera className="w-5 h-5" /></button>
                  {formData.imei && <button type="button" onClick={handleCheckSickw} className="p-2 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/50 text-rose-600 dark:text-rose-400 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors" title="Copy & Check SickW"><ExternalLink className="w-5 h-5" /></button>}
                </div>
                {formData.imei && <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1"><Copy className="w-3 h-3" /> Copied to clipboard on click</p>}
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Bought From</label>
                <input type="text" name="boughtFrom" placeholder="e.g. John Doe" value={formData.boughtFrom} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm dark:text-slate-100" />
            </div>
             <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Purchase Cost ($)</label>
                <input type="number" name="purchaseCost" required min="0" step="0.01" value={formData.purchaseCost} onFocus={handleFocus} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm dark:text-slate-100" />
            </div>
           </div>
        </div>

        {/* Repair & Sales Section */}
        <div className="bg-emerald-50/50 dark:bg-emerald-900/10 p-4 rounded-xl border border-emerald-100 dark:border-emerald-900/30">
           <h3 className="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-4 flex items-center gap-2"><Calculator className="w-4 h-4" /> Repairs & Sales</h3>
           <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
             <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Repair Cost ($)</label>
                <input type="number" name="repairCost" min="0" step="0.01" value={formData.repairCost} onFocus={handleFocus} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm dark:text-slate-100" />
            </div>
             <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Shipping Cost ($)</label>
                <input type="number" name="shippingCost" min="0" step="0.01" value={formData.shippingCost} onFocus={handleFocus} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm dark:text-slate-100" />
            </div>
             <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Platform Fees ($)</label>
                <input type="number" name="platformFees" min="0" step="0.01" value={formData.platformFees} onFocus={handleFocus} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm dark:text-slate-100" />
            </div>
            <div className="md:col-span-1"></div>

            <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Date Sold</label>
                <div className="flex gap-2">
                  <input type="text" placeholder="YYYY-MM-DD" name="soldDate" pattern="\d{4}-\d{2}-\d{2}" value={formData.soldDate} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm dark:text-slate-100" />
                  <button type="button" onClick={handlePasteDate} className="p-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors" title="Paste Date"><ClipboardPaste className="w-5 h-5" /></button>
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Sold To</label>
                <input type="text" name="soldTo" placeholder="e.g. Buyer Name" value={formData.soldTo} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm dark:text-slate-100" />
            </div>
            <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Sale Price ($)</label>
                <input type="number" name="salePrice" min="0" step="0.01" value={formData.salePrice} onFocus={handleFocus} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-sm dark:text-slate-100" />
            </div>
           </div>
        </div>
        
        <div>
           <div className="flex justify-between items-center mb-1">
             <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">Notes</label>
             <button type="button" onClick={toggleListening} className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-all ${isListening ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 animate-pulse' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'}`}>\n               {isListening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}\n               {isListening ? 'Listening...' : 'Voice Note'}\n             </button>\n           </div>\n           <textarea name="notes" rows={3} value={formData.notes} onChange={handleChange} className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm resize-none dark:text-slate-100" placeholder={isListening ? "Listening... speak now..." : "Condition notes, defects, etc."} />\n        </div>\n\n        <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-700">\n           <div className="flex flex-col">\n             <span className="text-xs font-bold text-slate-400 uppercase">Net Profit</span>\n             <span className={`text-2xl font-bold ${profit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>\n               ${profit.toFixed(2)}\n             </span>\n           </div>\n          <button type="submit" className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white px-8 py-3 rounded-lg font-medium transition-colors shadow-sm">\n            <Save className="w-4 h-4" />\n            Save Item\n          </button>\n        </div>\n      </form>\n      \n      {showScanner && <ImeiScanner onScan={handleScanResult} onClose={() => setShowScanner(false)} />}\n    </div>\n  );\n};\n