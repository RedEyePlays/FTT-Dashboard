
import React, { useState, useEffect, useMemo } from 'react';
import { QrCode, Printer, Camera } from 'lucide-react';
import { InventoryItem, Customer } from '../types';
import { SellerCustomerField } from './SellerCustomerField';
import { CustomerDraft } from '../domain/customers';
import { QRScanner } from './QRScanner';
import { QRLabel } from './QRLabel';
import { ImeiScanner } from './ImeiScanner';
import { selectOnFocus } from '../hooks/selectOnFocus';
import { findDuplicateDevice } from '../domain/autoInventory';
import { todayISO } from '../domain/dates';

interface DataEntryFormProps {
  initialData?: InventoryItem;
  onSave: (item: InventoryItem) => void;
  onCancel: () => void;
  // Existing inventory, for the duplicate IMEI/serial guard (same check the
  // Inventory item modal, Quick Purchase and auto-inventory all use).
  inventory?: InventoryItem[];
  // "Bought From" customer picker — same field, same behaviour, as Quick
  // Purchase and the item modal. Optional: plain free text without them.
  customers?: Customer[];
  onCreateCustomer?: (draft: CustomerDraft) => Customer | undefined;
}

export const DataEntryForm: React.FC<DataEntryFormProps> = ({ initialData, onSave, onCancel, inventory = [], customers, onCreateCustomer }) => {
  // Initialize state with a default structure or from initialData
  const [formData, setFormData] = useState<Omit<InventoryItem, 'id'>>({
    date: todayISO(),
    item: '',
    imei: '',
    boughtFrom: '',
    purchaseCost: 0,
    repairCost: 0,
    soldDate: '',
    soldTo: '',
    salePrice: 0,
    shippingCost: 0,
    platformFees: 0,
    notes: ''
  });

  const [showScanner, setShowScanner] = useState(false);
  const [showImeiScanner, setShowImeiScanner] = useState(false);
  const [showLabel, setShowLabel] = useState(false);

  useEffect(() => {
    // If initialData is provided (for editing), populate the form
    if (initialData) {
      setFormData({
        ...initialData,
        date: initialData.date || todayISO(),
      });
    }
  }, [initialData]);

  // Use a scanned QR / barcode to pull item data where possible.
  // Supports either a raw IMEI/serial string, or a JSON payload with item fields.
  const handleScan = (value: string) => {
    setShowScanner(false);
    let parsed: Partial<InventoryItem> | null = null;
    try {
      const obj = JSON.parse(value);
      if (obj && typeof obj === 'object') parsed = obj;
    } catch {
      /* not JSON — treat as a plain IMEI/serial */
    }
    if (parsed) {
      setFormData(prev => ({
        ...prev,
        item: parsed!.item ?? prev.item,
        imei: parsed!.imei ?? prev.imei,
        boughtFrom: parsed!.boughtFrom ?? prev.boughtFrom,
        purchaseCost: parsed!.purchaseCost ?? prev.purchaseCost,
        notes: parsed!.notes ?? prev.notes,
      }));
    } else {
      setFormData(prev => ({ ...prev, imei: value }));
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    
    setFormData(prev => ({
      ...prev,
      [name]: type === 'number' ? parseFloat(value) || 0 : value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (duplicate) return;
    const finalItem: InventoryItem = {
      id: initialData?.id || Date.now().toString() + Math.random().toString(36).substr(2, 5),
      ...formData,
    };
    onSave(finalItem);
  };
  
  // Blocks entering one physical device twice — reuses the shared identifier
  // matching rather than a second notion of "same device".
  const duplicate = useMemo(
    () => findDuplicateDevice(formData.imei || '', inventory, initialData?.id),
    [formData.imei, inventory, initialData?.id],
  );

  const title = initialData ? 'Edit Item' : 'Add New Item';

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 md:p-8 bg-white dark:bg-slate-900 rounded-2xl shadow-lg">
      <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 dark:text-slate-200 mb-6">{title}</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        
        {/* Purchase Information */}
        <div className="p-5 border border-slate-200 dark:border-slate-700 rounded-lg">
            <h2 className="text-lg font-semibold text-indigo-700 dark:text-indigo-400 mb-4">Purchase Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label htmlFor="item" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Item / Model</label>
                <input type="text" name="item" id="item" value={formData.item} onChange={handleChange} required className="w-full p-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/>
              </div>
              <div>
                <label htmlFor="date" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Purchase Date</label>
                <input type="date" name="date" id="date" value={formData.date} onChange={handleChange} required className="w-full p-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/>
              </div>
              <div>
                <label htmlFor="imei" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">IMEI / Serial</label>
                <div className="flex gap-2">
                  <input type="text" name="imei" id="imei" value={formData.imei} onChange={handleChange} className="flex-1 min-w-0 p-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/>
                  <button type="button" onClick={() => setShowScanner(true)} title="Scan QR / barcode"
                    className="shrink-0 px-3 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-indigo-600 hover:border-indigo-400 transition-colors">
                    <QrCode className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setShowImeiScanner(true)} title="Scan IMEI / serial with camera"
                    className="shrink-0 px-3 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-indigo-600 hover:border-indigo-400 transition-colors">
                    <Camera className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setShowLabel(true)} disabled={!formData.imei} title="Print IMEI QR label"
                    className="shrink-0 px-3 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-indigo-600 hover:border-indigo-400 transition-colors disabled:opacity-40 disabled:hover:text-slate-500 disabled:hover:border-slate-300">
                    <Printer className="w-4 h-4" />
                  </button>
                </div>
                {duplicate && (
                  <p className="mt-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                    Already in inventory as <strong>{duplicate.sku || duplicate.item || duplicate.id}</strong> — open that record instead of adding it twice.
                  </p>
                )}
              </div>
               <SellerCustomerField
                label="Bought From"
                placeholder="Seller name (optional)"
                inputClassName="w-full p-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                labelClassName="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1"
                customers={customers} onCreateCustomer={onCreateCustomer}
                value={{ boughtFrom: formData.boughtFrom || '', boughtFromCustomerId: formData.boughtFromCustomerId, boughtFromPhone: formData.boughtFromPhone }}
                onChange={v => setFormData(prev => ({ ...prev, ...v }))} />
              <div>
                <label htmlFor="purchaseCost" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Purchase Cost ($)</label>
                <input type="number" step="0.01" name="purchaseCost" id="purchaseCost" value={formData.purchaseCost} onChange={handleChange} onFocus={selectOnFocus} required className="w-full p-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/>
              </div>
            </div>
        </div>

        {/* Sale Information */}
        <div className="p-5 border border-slate-200 dark:border-slate-700 rounded-lg">
            <h2 className="text-lg font-semibold text-emerald-700 dark:text-emerald-400 mb-4">Sale Details</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="soldDate" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Sold Date</label>
                <input type="date" name="soldDate" id="soldDate" value={formData.soldDate} onChange={handleChange} className="w-full p-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/>
              </div>
              <div>
                <label htmlFor="soldTo" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Sold To</label>
                <input type="text" name="soldTo" id="soldTo" value={formData.soldTo} onChange={handleChange} className="w-full p-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/>
              </div>
              <div>
                <label htmlFor="salePrice" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Sale Price ($)</label>
                <input type="number" step="0.01" name="salePrice" id="salePrice" value={formData.salePrice} onChange={handleChange} onFocus={selectOnFocus} className="w-full p-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/>
              </div>
            </div>
        </div>
        
        {/* Costs & Notes */}
         <div className="p-5 border border-slate-200 dark:border-slate-700 rounded-lg">
            <h2 className="text-lg font-semibold text-rose-700 dark:text-rose-400 mb-4">Additional Costs & Notes</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
               <div>
                  <label htmlFor="repairCost" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Repair Costs ($)</label>
                  <input type="number" step="0.01" name="repairCost" id="repairCost" value={formData.repairCost} onChange={handleChange} onFocus={selectOnFocus} className="w-full p-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/>
                </div>
                <div>
                  <label htmlFor="shippingCost" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Shipping Costs ($)</label>
                  <input type="number" step="0.01" name="shippingCost" id="shippingCost" value={formData.shippingCost} onChange={handleChange} onFocus={selectOnFocus} className="w-full p-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/>
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="platformFees" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Platform Fees ($)</label>
                  <input type="number" step="0.01" name="platformFees" id="platformFees" value={formData.platformFees} onChange={handleChange} onFocus={selectOnFocus} className="w-full p-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/>
                </div>
              <div className="md:col-span-2">
                <label htmlFor="notes" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Notes</label>
                <textarea name="notes" id="notes" value={formData.notes} onChange={handleChange} rows={4} className="w-full p-2 bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-600 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500"/>
              </div>
            </div>
        </div>

        {/* Action Buttons */}
        <div className="flex justify-end gap-4 pt-4">
          <button type="button" onClick={onCancel} className="px-6 py-2 rounded-lg text-slate-700 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 font-medium transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={!!duplicate} className="px-6 py-2 rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed font-medium transition-colors shadow-sm">
            Save Item
          </button>
        </div>
      </form>

      {showScanner && <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />}
      {showImeiScanner && (
        <ImeiScanner
          onScan={(imei) => { setFormData(prev => ({ ...prev, imei })); setShowImeiScanner(false); }}
          onClose={() => setShowImeiScanner(false)}
        />
      )}
      {showLabel && <QRLabel imei={formData.imei} itemName={formData.item} onClose={() => setShowLabel(false)} />}
    </div>
  );
};
