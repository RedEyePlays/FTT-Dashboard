import React, { useState } from 'react';
import {
  ShoppingCart, CheckCircle, X, Search, DollarSign, User, Truck,
  Receipt, ChevronRight, QrCode, Phone, FileText, Percent, Banknote,
  CreditCard, Blend,
} from 'lucide-react';
import { InventoryItem } from '../types';
import { QRScanner } from './QRScanner';
import { getPOSSettings } from './SettingsModal';

interface Props {
  inventory: InventoryItem[];
  onSell: (item: InventoryItem) => void;
}

const PLATFORMS: { name: string; fee: number }[] = [
  { name: 'None / In-Store', fee: 0 },
  { name: 'Cash Sale', fee: 0 },
  { name: 'eBay', fee: 13.25 },
  { name: 'Amazon', fee: 15 },
  { name: 'Facebook Marketplace', fee: 5 },
  { name: 'Best Buy', fee: 10 },
  { name: 'Swappa', fee: 3 },
  { name: 'Other', fee: 0 },
];

interface SaleForm {
  salePrice: string;
  soldDate: string;
  shippingCost: string;
  platformName: string;
  platformFeePercent: string;
  // Customer
  customerName: string;
  customerPhone: string;
  customerNotes: string;
  // Payment
  paymentMethod: 'cash' | 'card' | 'mixed';
  taxCollected: string;
  cashAmount: string;
}

const emptyForm = (): SaleForm => ({
  salePrice: '',
  soldDate: new Date().toISOString().split('T')[0],
  shippingCost: '0',
  platformName: 'None / In-Store',
  platformFeePercent: '0',
  customerName: '',
  customerPhone: '',
  customerNotes: '',
  paymentMethod: 'cash',
  taxCollected: '0',
  cashAmount: '',
});

export const QuickSaleView: React.FC<Props> = ({ inventory, onSell }) => {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [form, setForm] = useState<SaleForm>(emptyForm());
  const [confirmed, setConfirmed] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const taxRate = getPOSSettings().taxRate;

  const unsold = inventory.filter(i => !i.soldDate);
  const filtered = unsold.filter(i =>
    i.item.toLowerCase().includes(search.toLowerCase()) ||
    i.imei.toLowerCase().includes(search.toLowerCase()) ||
    i.boughtFrom.toLowerCase().includes(search.toLowerCase())
  );

  const salePrice = parseFloat(form.salePrice) || 0;
  const shipping = parseFloat(form.shippingCost) || 0;
  const feePercent = parseFloat(form.platformFeePercent) || 0;
  const feeAmount = salePrice * feePercent / 100;
  const tax = form.paymentMethod === 'cash' ? 0 : parseFloat(form.taxCollected) || 0;
  const totalCost = selected ? selected.purchaseCost + selected.repairCost : 0;
  const netProfit = salePrice - totalCost - shipping - feeAmount;

  const set = (key: keyof SaleForm, value: string) =>
    setForm(f => {
      const next = { ...f, [key]: value };
      // Auto-compute tax when price changes and method isn't cash
      if (key === 'salePrice' && f.paymentMethod !== 'cash') {
        const price = parseFloat(value) || 0;
        next.taxCollected = (price * taxRate / 100).toFixed(2);
      }
      return next;
    });

  const handleSelect = (item: InventoryItem) => {
    setSelected(item);
    setForm(emptyForm());
    setConfirmed(false);
  };

  const handlePlatformChange = (name: string) => {
    const preset = PLATFORMS.find(p => p.name === name);
    setForm(f => ({
      ...f,
      platformName: name,
      platformFeePercent: preset ? String(preset.fee) : f.platformFeePercent,
    }));
  };

  const handleQRScan = (value: string) => {
    setSearch(value);
    // Auto-select if exactly one match
    const matches = unsold.filter(i =>
      i.imei === value || i.item.toLowerCase().includes(value.toLowerCase())
    );
    if (matches.length === 1) handleSelect(matches[0]);
  };

  const handleConfirm = () => {
    if (!selected || !form.salePrice || !form.customerName) return;
    const sold: InventoryItem = {
      ...selected,
      salePrice,
      soldTo: form.customerName,
      soldDate: form.soldDate,
      shippingCost: shipping,
      platformFees: feeAmount,
      platformName: form.platformName,
      platformFeePercent: feePercent,
      customerName: form.customerName,
      customerPhone: form.customerPhone,
      customerNotes: form.customerNotes,
      paymentMethod: form.paymentMethod,
      taxCollected: tax,
      cashAmount: form.paymentMethod === 'mixed' ? parseFloat(form.cashAmount) || 0 : undefined,
    };
    onSell(sold);
    setConfirmed(true);
  };

  const handleNext = () => {
    setSelected(null);
    setForm(emptyForm());
    setConfirmed(false);
    setSearch('');
  };

  const inputCls = 'w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

  const Field = ({
    label, icon, value, onChange, type = 'text', placeholder = '', readOnly = false
  }: {
    label: string; icon: React.ReactNode; value: string;
    onChange: (v: string) => void; type?: string; placeholder?: string; readOnly?: boolean;
  }) => (
    <div>
      <label className={labelCls}>{label}</label>
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">{icon}</div>
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          readOnly={readOnly}
          className={`${inputCls} ${readOnly ? 'opacity-60 cursor-default' : ''}`}
        />
      </div>
    </div>
  );

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500">{children}</p>
  );

  const setPaymentMethod = (method: 'cash' | 'card' | 'mixed') => {
    setForm(f => ({
      ...f,
      paymentMethod: method,
      taxCollected: method === 'cash' ? '0'
        : (( parseFloat(f.salePrice) || 0) * taxRate / 100).toFixed(2),
    }));
  };

  const payBtn = (method: 'cash' | 'card' | 'mixed', icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={() => setPaymentMethod(method)}
      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all border ${
        form.paymentMethod === method
          ? 'bg-indigo-600 text-white border-indigo-600 shadow-sm'
          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
      }`}
    >
      {icon}{label}
    </button>
  );

  return (
    <div className="flex gap-6 h-full min-h-[calc(100vh-12rem)]">
      {showQR && <QRScanner onScan={handleQRScan} onClose={() => setShowQR(false)} />}

      {/* Left — item picker */}
      <div className="w-72 shrink-0 flex flex-col gap-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search inventory…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button
            onClick={() => setShowQR(true)}
            className="px-3 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 hover:text-indigo-600 hover:border-indigo-400 transition-colors"
            title="Scan QR / Barcode"
          >
            <QrCode className="w-4 h-4" />
          </button>
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
                    Cost in: <span className="font-medium text-slate-700 dark:text-slate-300">${(item.purchaseCost + item.repairCost).toFixed(2)}</span>
                  </p>
                </div>
                <ChevronRight className={`w-4 h-4 shrink-0 mt-0.5 ${selected?.id === item.id ? 'text-indigo-500' : 'text-slate-300'}`} />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right — sale form */}
      <div className="flex-1 overflow-y-auto">
        {!selected && (
          <div className="h-full flex flex-col items-center justify-center text-center text-slate-400 gap-3">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <ShoppingCart className="w-8 h-8 text-slate-300" />
            </div>
            <p className="text-sm font-medium">Select an item to sell</p>
            <p className="text-xs">Search or scan a QR code to find the item</p>
          </div>
        )}

        {selected && confirmed && (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4">
            <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-emerald-500" />
            </div>
            <div>
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100">Sale Recorded!</p>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{selected.item} sold to {form.customerName}</p>
              {form.customerPhone && <p className="text-slate-400 text-xs mt-0.5">{form.customerPhone}</p>}
            </div>
            <div className="flex gap-6 text-sm">
              <div className="text-center">
                <p className="text-slate-400 text-xs">Sale Price</p>
                <p className="font-bold text-slate-800 dark:text-slate-100">${salePrice.toFixed(2)}</p>
              </div>
              {tax > 0 && (
                <div className="text-center">
                  <p className="text-slate-400 text-xs">Tax Collected</p>
                  <p className="font-bold text-slate-700 dark:text-slate-200">${tax.toFixed(2)}</p>
                </div>
              )}
              <div className="text-center">
                <p className="text-slate-400 text-xs">Net Profit</p>
                <p className={`font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>${netProfit.toFixed(2)}</p>
              </div>
            </div>
            <button onClick={handleNext} className="mt-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
              Sell Another Item
            </button>
          </div>
        )}

        {selected && !confirmed && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-6 flex flex-col gap-6">
            {/* Item header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{selected.item}</h2>
                <p className="text-sm text-slate-400 mt-0.5">{selected.imei || 'No IMEI'} · from {selected.boughtFrom}</p>
              </div>
              <button onClick={() => setSelected(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-3 text-sm">
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-400 text-xs">Purchase</p>
                <p className="font-semibold text-slate-800 dark:text-slate-100">${selected.purchaseCost.toFixed(2)}</p>
              </div>
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-400 text-xs">Repair</p>
                <p className="font-semibold text-slate-800 dark:text-slate-100">${selected.repairCost.toFixed(2)}</p>
              </div>
              <div className="flex-1 bg-slate-50 dark:bg-slate-800 rounded-lg p-3">
                <p className="text-slate-400 text-xs">Total Cost In</p>
                <p className="font-semibold text-slate-800 dark:text-slate-100">${totalCost.toFixed(2)}</p>
              </div>
            </div>

            <hr className="border-slate-100 dark:border-slate-800" />

            {/* Customer Details */}
            <div className="flex flex-col gap-3">
              <SectionTitle>Customer Details</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Customer Name *" icon={<User className="w-4 h-4" />} value={form.customerName} onChange={v => set('customerName', v)} placeholder="Full name" />
                <Field label="Phone Number" icon={<Phone className="w-4 h-4" />} value={form.customerPhone} onChange={v => set('customerPhone', v)} placeholder="(555) 000-0000" type="tel" />
              </div>
              <Field label="Customer Notes" icon={<FileText className="w-4 h-4" />} value={form.customerNotes} onChange={v => set('customerNotes', v)} placeholder="Any notes about the customer or sale…" />
            </div>

            <hr className="border-slate-100 dark:border-slate-800" />

            {/* Payment Method */}
            <div className="flex flex-col gap-3">
              <SectionTitle>Payment Method</SectionTitle>
              <div className="flex gap-2">
                {payBtn('cash', <Banknote className="w-4 h-4" />, 'Cash')}
                {payBtn('card', <CreditCard className="w-4 h-4" />, 'Card')}
                {payBtn('mixed', <Blend className="w-4 h-4" />, 'Mixed')}
              </div>

              {form.paymentMethod === 'cash' && (
                <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-xs font-medium px-3 py-2 rounded-lg">
                  <Banknote className="w-4 h-4 shrink-0" />
                  Cash sale — no tax charged to customer
                </div>
              )}

              {form.paymentMethod === 'card' && (
                <Field label="Tax Collected ($)" icon={<Receipt className="w-4 h-4" />} value={form.taxCollected} onChange={v => set('taxCollected', v)} type="number" placeholder="0.00" />
              )}

              {form.paymentMethod === 'mixed' && (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Cash Amount ($)" icon={<Banknote className="w-4 h-4" />} value={form.cashAmount} onChange={v => set('cashAmount', v)} type="number" placeholder="0.00" />
                  <Field label="Tax Collected ($)" icon={<Receipt className="w-4 h-4" />} value={form.taxCollected} onChange={v => set('taxCollected', v)} type="number" placeholder="0.00" />
                </div>
              )}
            </div>

            <hr className="border-slate-100 dark:border-slate-800" />

            {/* Sale Details */}
            <div className="flex flex-col gap-3">
              <SectionTitle>Sale Details</SectionTitle>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Sale Price *" icon={<DollarSign className="w-4 h-4" />} value={form.salePrice} onChange={v => set('salePrice', v)} type="number" placeholder="0.00" />
                <Field label="Sale Date" icon={<Receipt className="w-4 h-4" />} value={form.soldDate} onChange={v => set('soldDate', v)} type="date" />
                <Field label="Shipping Cost ($)" icon={<Truck className="w-4 h-4" />} value={form.shippingCost} onChange={v => set('shippingCost', v)} type="number" placeholder="0.00" />
              </div>
            </div>

            <hr className="border-slate-100 dark:border-slate-800" />

            {/* Platform & Fees */}
            <div className="flex flex-col gap-3">
              <SectionTitle>Platform & Fees</SectionTitle>
              <div>
                <label className={labelCls}>Platform</label>
                <select
                  value={form.platformName}
                  onChange={e => handlePlatformChange(e.target.value)}
                  className="w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {PLATFORMS.map(p => (
                    <option key={p.name} value={p.name}>{p.name}{p.fee > 0 ? ` (${p.fee}%)` : ''}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Platform Fee %" icon={<Percent className="w-4 h-4" />} value={form.platformFeePercent} onChange={v => set('platformFeePercent', v)} type="number" placeholder="0" />
                <div>
                  <label className={labelCls}>Fee Amount (computed)</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <DollarSign className="w-4 h-4" />
                    </div>
                    <input readOnly value={feeAmount.toFixed(2)} className={`${inputCls} opacity-60 cursor-default`} />
                  </div>
                </div>
              </div>
            </div>

            {/* Profit preview */}
            {form.salePrice && (
              <div className={`rounded-xl p-4 ${netProfit >= 0 ? 'bg-emerald-50 dark:bg-emerald-900/20' : 'bg-rose-50 dark:bg-rose-900/20'}`}>
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
                    <p>${salePrice.toFixed(2)} sale − ${totalCost.toFixed(2)} cost − ${shipping.toFixed(2)} shipping − ${feeAmount.toFixed(2)} fees</p>
                    {tax > 0 && <p className="text-slate-400">+ ${tax.toFixed(2)} tax collected (not your profit)</p>}
                  </div>
                  <div className={`text-2xl font-bold ml-4 ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    ${netProfit.toFixed(2)}
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={handleConfirm}
              disabled={!form.salePrice || !form.customerName}
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
