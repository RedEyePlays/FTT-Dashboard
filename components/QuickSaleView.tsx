import React, { useState } from 'react';
import { ShoppingCart, CheckCircle, X, Search, DollarSign, User, Truck, Receipt, ChevronRight, Package } from 'lucide-react';
import { InventoryItem } from '../types';

interface Props {
  inventory: InventoryItem[];
  onSell: (item: InventoryItem) => void;
}

interface SaleForm {
  salePrice: string;
  soldTo: string;
  soldDate: string;
  shippingCost: string;
  platformFees: string;
}

const emptyForm = (): SaleForm => ({
  salePrice: '',
  soldTo: '',
  soldDate: new Date().toISOString().split('T')[0],
  shippingCost: '0',
  platformFees: '0',
});

export const QuickSaleView: React.FC<Props> = ({ inventory, onSell }) => {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<SaleForm>(emptyForm());
  const [confirmed, setConfirmed] = useState(false);

  const unsold = inventory.filter(i => !i.soldDate);
  const filtered = unsold.filter(i =>
    i.item.toLowerCase().includes(search.toLowerCase()) ||
    i.imei.toLowerCase().includes(search.toLowerCase()) ||
    i.boughtFrom.toLowerCase().includes(search.toLowerCase())
  );

  const totalCost = selected ? selected.purchaseCost + selected.repairCost : 0;
  const salePrice = parseFloat(form.salePrice) || 0;
  const shipping = parseFloat(form.shippingCost) || 0;
  const fees = parseFloat(form.platformFees) || 0;
  const netProfit = salePrice - totalCost - shipping - fees;

  const handleSelect = (item: InventoryItem) => {
    setSelected(item);
    setForm(emptyForm());
    setConfirmed(false);
  };

  const handleConfirm = () => {
    if (!selected || !form.salePrice || !form.soldTo) return;
    const sold: InventoryItem = {
      ...selected,
      salePrice,
      soldTo: form.soldTo,
      soldDate: form.soldDate,
      shippingCost: shipping,
      platformFees: fees,
    };
    onSell(sold);
    setConfirmed(true);
  };

  const handleNext = () => {
    setSelected(null);
    setForm(emptyForm());
    setConfirmed(false);
  };

  const field = (
    label: string,
    icon: React.ReactNode,
    key: keyof SaleForm,
    type = 'text',
    placeholder = ''
  ) => (
    <div>
      <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{label}</label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
          {icon}
        </div>
        <input
          type={type}
          value={form[key]}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          placeholder={placeholder}
          className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>
    </div>
  );

  return (
    <div className="flex gap-6 h-full min-h-[calc(100vh-12rem)]">
      {/* Left — item picker */}
      <div className="w-80 shrink-0 flex flex-col gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search inventory…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="text-xs text-slate-400 font-medium">{filtered.length} unsold item{filtered.length !== 1 ? 's' : ''}</div>

        <div className="flex flex-col gap-2 overflow-y-auto flex-1 pr-1">
          {filtered.length === 0 && (
            <div className="text-center text-slate-400 text-sm py-10">No unsold items found</div>
          )}
          {filtered.map(item => (
            <button
              key={item.id}
              onClick={() => handleSelect(item)}
              className={`text-left p-3 rounded-xl border transition-all ${
                selected?.id === item.id
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 shadow-sm'
                  : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/10'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{item.item}</p>
                  <p className="text-xs text-slate-400 mt-0.5 truncate">{item.imei || 'No IMEI'}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Cost: <span className="font-medium text-slate-700 dark:text-slate-300">${(item.purchaseCost + item.repairCost).toFixed(2)}</span>
                  </p>
                </div>
                <ChevronRight className={`w-4 h-4 shrink-0 mt-0.5 ${selected?.id === item.id ? 'text-indigo-500' : 'text-slate-300'}`} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right — sale form */}
      <div className="flex-1">
        {!selected && (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <ShoppingCart className="w-8 h-8 text-slate-300" />
            </div>
            <p className="text-sm font-medium">Select an item to sell</p>
            <p className="text-xs">Pick from the unsold inventory on the left</p>
          </div>
        )}

        {selected && confirmed && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4">
            <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-emerald-500" />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100">Sale Recorded!</p>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{selected.item} sold to {form.soldTo}</p>
            </div>
            <div className="flex gap-4 text-sm">
              <div className="text-center">
                <p className="text-slate-400">Sale Price</p>
                <p className="font-bold text-slate-800 dark:text-slate-100">${salePrice.toFixed(2)}</p>
              </div>
              <div className="text-center">
                <p className="text-slate-400">Net Profit</p>
                <p className={`font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>${netProfit.toFixed(2)}</p>
              </div>
            </div>
            <button
              onClick={handleNext}
              className="mt-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
            >
              Sell Another Item
            </button>
          </div>
        )}

        {selected && !confirmed && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col gap-5">
            {/* Item summary */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{selected.item}</h2>
                <p className="text-sm text-slate-400 mt-0.5">{selected.imei || 'No IMEI'} · from {selected.boughtFrom}</p>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-3 text-sm">
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-400 text-xs">Purchase Cost</p>
                <p className="font-semibold text-slate-800 dark:text-slate-100">${selected.purchaseCost.toFixed(2)}</p>
              </div>
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-400 text-xs">Repair Cost</p>
                <p className="font-semibold text-slate-800 dark:text-slate-100">${selected.repairCost.toFixed(2)}</p>
              </div>
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-400 text-xs">Total Cost In</p>
                <p className="font-semibold text-slate-800 dark:text-slate-100">${totalCost.toFixed(2)}</p>
              </div>
            </div>

            <hr className="border-slate-100 dark:border-slate-800" />

            {/* Sale fields */}
            <div className="grid grid-cols-2 gap-4">
              {field('Sale Price *', <DollarSign className="w-4 h-4" />, 'salePrice', 'number', '0.00')}
              {field('Sold To *', <User className="w-4 h-4" />, 'soldTo', 'text', 'Buyer name')}
              {field('Sale Date', <Receipt className="w-4 h-4" />, 'soldDate', 'date')}
              {field('Shipping Cost', <Truck className="w-4 h-4" />, 'shippingCost', 'number', '0.00')}
              {field('Platform Fees', <Package className="w-4 h-4" />, 'platformFees', 'number', '0.00')}
            </div>

            {/* Profit preview */}
            {form.salePrice && (
              <div className={`rounded-xl p-4 flex items-center justify-between ${netProfit >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-rose-50 dark:bg-rose-900/20'}`}>
                <div className="text-sm text-slate-600 dark:text-slate-300">
                  Net Profit = ${salePrice.toFixed(2)} − ${totalCost.toFixed(2)} cost − ${shipping.toFixed(2)} shipping − ${fees.toFixed(2)} fees
                </div>
                <div className={`text-xl font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  ${netProfit.toFixed(2)}
                </div>
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={!form.salePrice || !form.soldTo}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              <ShoppingCart className="w-4 h-4" />
              Confirm Sale
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
