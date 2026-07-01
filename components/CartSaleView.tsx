import React, { useState } from 'react';
import {
  ShoppingCart, Plus, Trash2, X, Search, QrCode, User, Phone, FileText,
  Banknote, CreditCard, Blend, CheckCircle, Package, Smartphone, Tag,
} from 'lucide-react';
import { InventoryItem } from '../types';
import { QRScanner } from './QRScanner';
import { getPOSSettings } from './SettingsModal';

interface Props {
  inventory: InventoryItem[];
  onCheckout: (items: InventoryItem[]) => void;
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

type Category = 'device' | 'accessory' | 'other';

interface CartLine {
  key: string;
  inventoryId?: string; // set when linked to an existing inventory device
  name: string;
  category: Category;
  code: string;      // IMEI for devices, SKU/barcode/QR for accessories
  quantity: number;
  unitPrice: number;
  unitCost: number;
  taxable: boolean;
  discount: number;  // dollar amount off this line
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const blankAccessory = (): CartLine => ({
  key: uid(), name: '', category: 'accessory', code: '',
  quantity: 1, unitPrice: 0, unitCost: 0, taxable: true, discount: 0,
});

export const CartSaleView: React.FC<Props> = ({ inventory, onCheckout }) => {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const [platformName, setPlatformName] = useState('None / In-Store');
  const [platformFeePercent, setPlatformFeePercent] = useState('0');
  const [soldDate, setSoldDate] = useState(new Date().toISOString().split('T')[0]);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mixed'>('cash');
  const [cashTaxStatus, setCashTaxStatus] = useState<'none' | 'separate' | 'included'>('none');
  const [paymentNotes, setPaymentNotes] = useState('');

  const taxRate = getPOSSettings().taxRate;
  const feePercent = parseFloat(platformFeePercent) || 0;

  const soldIds = new Set(inventory.filter(i => i.soldDate).map(i => i.id));
  const inCart = new Set(cart.map(l => l.inventoryId).filter(Boolean));
  const availableDevices = inventory.filter(i =>
    !soldIds.has(i.id) && !inCart.has(i.id) && (
      i.item.toLowerCase().includes(search.toLowerCase()) ||
      i.imei.toLowerCase().includes(search.toLowerCase())
    )
  );

  // ---- Line math ----
  const lineSubtotal = (l: CartLine) => Math.max(0, l.quantity * l.unitPrice - l.discount);
  const lineCost = (l: CartLine) => l.quantity * l.unitCost;

  const subtotal = cart.reduce((s, l) => s + lineSubtotal(l), 0);
  const totalCost = cart.reduce((s, l) => s + lineCost(l), 0);
  const taxableBase = cart.filter(l => l.taxable).reduce((s, l) => s + lineSubtotal(l), 0);

  // Cash "No tax charged" means no tax at all; otherwise apply the configured rate.
  const taxApplies = !(paymentMethod === 'cash' && cashTaxStatus === 'none');
  const tax = taxApplies ? taxableBase * taxRate / 100 : 0;

  const platformFee = subtotal * feePercent / 100;
  const totalPaid = subtotal + tax;
  const netProfit = subtotal - totalCost - platformFee;

  // ---- Cart mutations ----
  const addDevice = (item: InventoryItem) => {
    setCart(c => [...c, {
      key: uid(),
      inventoryId: item.id,
      name: item.item,
      category: 'device',
      code: item.imei,
      quantity: 1,
      unitPrice: 0,
      unitCost: item.purchaseCost + item.repairCost,
      taxable: true,
      discount: 0,
    }]);
    setShowPicker(false);
    setSearch('');
  };

  const addAccessory = () => setCart(c => [...c, blankAccessory()]);

  const updateLine = (key: string, patch: Partial<CartLine>) =>
    setCart(c => c.map(l => l.key === key ? { ...l, ...patch } : l));

  const removeLine = (key: string) => setCart(c => c.filter(l => l.key !== key));

  const handleQRScan = (value: string) => {
    setShowQR(false);
    const device = inventory.find(i => i.imei === value && !soldIds.has(i.id) && !inCart.has(i.id));
    if (device) {
      addDevice(device);
    } else {
      // Unknown code → start an accessory line pre-filled with the scanned SKU/barcode
      setCart(c => [...c, { ...blankAccessory(), code: value }]);
    }
  };

  const num = (v: string) => parseFloat(v) || 0;

  // ---- Checkout ----
  const handleCheckout = () => {
    if (cart.length === 0 || !customerName) return;
    const transactionId = uid();
    const items: InventoryItem[] = cart.map(l => {
      const saleShare = lineSubtotal(l);
      const feeShare = subtotal > 0 ? platformFee * (saleShare / subtotal) : 0;
      const taxShare = l.taxable && taxableBase > 0 ? tax * (saleShare / taxableBase) : 0;

      const base: Partial<InventoryItem> = {
        soldDate,
        soldTo: customerName,
        salePrice: saleShare,
        platformFees: feeShare,
        platformName,
        platformFeePercent: feePercent,
        shippingCost: 0,
        category: l.category,
        transactionId,
        customerName,
        customerPhone,
        customerNotes,
        paymentMethod,
        taxCollected: taxShare,
        cashTaxStatus: paymentMethod === 'cash' ? cashTaxStatus : undefined,
        paymentNotes: paymentNotes || undefined,
      };

      const existing = l.inventoryId ? inventory.find(i => i.id === l.inventoryId) : undefined;
      if (existing) {
        return { ...existing, ...base } as InventoryItem;
      }
      // New accessory / other line becomes its own sold inventory row
      return {
        id: uid(),
        date: soldDate,
        item: l.name || (l.category === 'accessory' ? 'Accessory' : 'Item'),
        imei: l.code,
        boughtFrom: '',
        purchaseCost: lineCost(l),
        repairCost: 0,
        notes: l.quantity > 1 ? `Qty ${l.quantity} @ $${l.unitPrice.toFixed(2)} each` : '',
        ...base,
      } as InventoryItem;
    });
    onCheckout(items);
    setConfirmed(true);
  };

  const reset = () => {
    setCart([]);
    setCustomerName(''); setCustomerPhone(''); setCustomerNotes('');
    setPaymentNotes(''); setPaymentMethod('cash'); setCashTaxStatus('none');
    setPlatformName('None / In-Store'); setPlatformFeePercent('0');
    setConfirmed(false);
  };

  const inputCls = 'w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

  const catIcon = (c: Category) =>
    c === 'device' ? <Smartphone className="w-4 h-4" /> : c === 'accessory' ? <Package className="w-4 h-4" /> : <Tag className="w-4 h-4" />;

  if (confirmed) {
    return (
      <div className="h-full min-h-[calc(100vh-12rem)] flex flex-col items-center justify-center text-center gap-4">
        <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <CheckCircle className="w-10 h-10 text-emerald-500" />
        </div>
        <div>
          <p className="text-xl font-bold text-slate-800 dark:text-slate-100">Transaction Complete!</p>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
            {cart.length} item{cart.length !== 1 ? 's' : ''} sold to {customerName}
          </p>
        </div>
        <div className="flex gap-6 text-sm">
          <div className="text-center"><p className="text-slate-400 text-xs">Total Paid</p><p className="font-bold text-slate-800 dark:text-slate-100">${totalPaid.toFixed(2)}</p></div>
          <div className="text-center"><p className="text-slate-400 text-xs">Net Profit</p><p className={`font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>${netProfit.toFixed(2)}</p></div>
        </div>
        <button onClick={reset} className="mt-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors">
          New Transaction
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full min-h-[calc(100vh-12rem)]">
      {showQR && <QRScanner onScan={handleQRScan} onClose={() => setShowQR(false)} />}

      {/* Left: cart lines */}
      <div className="flex-1 flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowPicker(true)} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors">
            <Smartphone className="w-4 h-4" /> Add Device
          </button>
          <button onClick={addAccessory} className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400 transition-colors">
            <Plus className="w-4 h-4" /> Add Accessory / Item
          </button>
          <button onClick={() => setShowQR(true)} className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400 transition-colors">
            <QrCode className="w-4 h-4" /> Scan
          </button>
        </div>

        {cart.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 gap-3 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
            <ShoppingCart className="w-10 h-10 text-slate-300" />
            <p className="text-sm font-medium">Cart is empty</p>
            <p className="text-xs">Add a device, accessory, or scan a code to begin</p>
          </div>
        )}

        <div className="flex flex-col gap-3 overflow-y-auto">
          {cart.map(l => (
            <div key={l.key} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className="mt-1 text-indigo-500">{catIcon(l.category)}</div>
                <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <label className={labelCls}>Item Name</label>
                    <input className={inputCls} value={l.name} disabled={!!l.inventoryId}
                      onChange={e => updateLine(l.key, { name: e.target.value })} placeholder="Item name" />
                  </div>
                  <div>
                    <label className={labelCls}>Category</label>
                    <select className={inputCls} value={l.category} disabled={!!l.inventoryId}
                      onChange={e => updateLine(l.key, { category: e.target.value as Category })}>
                      <option value="device">Device</option>
                      <option value="accessory">Accessory</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>{l.category === 'device' ? 'IMEI' : 'SKU / Barcode'}</label>
                    <input className={inputCls} value={l.code}
                      onChange={e => updateLine(l.key, { code: e.target.value })}
                      placeholder={l.category === 'device' ? 'IMEI' : 'SKU'} />
                  </div>
                  <div>
                    <label className={labelCls}>Qty</label>
                    <input type="number" min="1" className={inputCls} value={l.quantity}
                      onChange={e => updateLine(l.key, { quantity: Math.max(1, Math.round(num(e.target.value))) })} />
                  </div>
                  <div>
                    <label className={labelCls}>Unit Price ($)</label>
                    <input type="number" step="0.01" className={inputCls} value={l.unitPrice}
                      onChange={e => updateLine(l.key, { unitPrice: num(e.target.value) })} />
                  </div>
                  <div>
                    <label className={labelCls}>Unit Cost ($)</label>
                    <input type="number" step="0.01" className={inputCls} value={l.unitCost}
                      onChange={e => updateLine(l.key, { unitCost: num(e.target.value) })} />
                  </div>
                  <div>
                    <label className={labelCls}>Discount ($)</label>
                    <input type="number" step="0.01" className={inputCls} value={l.discount}
                      onChange={e => updateLine(l.key, { discount: num(e.target.value) })} />
                  </div>
                </div>
                <button onClick={() => removeLine(l.key)} className="text-slate-400 hover:text-rose-500 p-1 shrink-0" title="Remove">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={l.taxable} onChange={e => updateLine(l.key, { taxable: e.target.checked })} className="rounded" />
                  Taxable
                </label>
                <div className="text-sm">
                  <span className="text-slate-400 text-xs mr-2">Line total</span>
                  <span className="font-bold text-slate-800 dark:text-slate-100">${lineSubtotal(l).toFixed(2)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: checkout panel */}
      <div className="w-full lg:w-96 shrink-0 flex flex-col gap-4">
        {/* Totals */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-2 text-sm">
          <Row label="Subtotal" value={subtotal} />
          <Row label={`Tax${taxApplies ? ` (${taxRate}%)` : ' (none)'}`} value={tax} muted />
          <Row label={`Platform fee${feePercent ? ` (${feePercent}%)` : ''}`} value={-platformFee} muted />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1" />
          <Row label="Total Paid" value={totalPaid} bold />
          <Row label="Total Cost" value={totalCost} muted />
          <div className="flex items-center justify-between pt-1">
            <span className="font-semibold text-slate-700 dark:text-slate-200">Net Profit</span>
            <span className={`text-lg font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>${netProfit.toFixed(2)}</span>
          </div>
        </div>

        {/* Customer */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Customer</p>
          <IconInput icon={<User className="w-4 h-4" />} placeholder="Customer name *" value={customerName} onChange={setCustomerName} />
          <IconInput icon={<Phone className="w-4 h-4" />} placeholder="Phone number" value={customerPhone} onChange={setCustomerPhone} />
          <IconInput icon={<FileText className="w-4 h-4" />} placeholder="Customer notes" value={customerNotes} onChange={setCustomerNotes} />
        </div>

        {/* Payment */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Payment</p>
          <div className="flex gap-2">
            <PayBtn active={paymentMethod === 'cash'} onClick={() => setPaymentMethod('cash')} icon={<Banknote className="w-4 h-4" />} label="Store / Cash" />
            <PayBtn active={paymentMethod === 'card'} onClick={() => setPaymentMethod('card')} icon={<CreditCard className="w-4 h-4" />} label="Card" />
            <PayBtn active={paymentMethod === 'mixed'} onClick={() => setPaymentMethod('mixed')} icon={<Blend className="w-4 h-4" />} label="Mixed" />
          </div>

          {paymentMethod === 'cash' && (
            <div>
              <label className={labelCls}>Cash Sale Tax Status</label>
              <select className={inputCls} value={cashTaxStatus} onChange={e => setCashTaxStatus(e.target.value as any)}>
                <option value="none">No tax charged</option>
                <option value="separate">Tax paid separately</option>
                <option value="included">Tax included in cash amount</option>
              </select>
            </div>
          )}

          {(paymentMethod === 'mixed' || paymentMethod === 'cash') && (
            <IconInput icon={<FileText className="w-4 h-4" />} placeholder="Payment notes, e.g. $200 cash + $15 tax" value={paymentNotes} onChange={setPaymentNotes} />
          )}
        </div>

        {/* Platform */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Platform & Date</p>
          <select
            className={inputCls}
            value={platformName}
            onChange={e => {
              const p = PLATFORMS.find(x => x.name === e.target.value);
              setPlatformName(e.target.value);
              if (p) setPlatformFeePercent(String(p.fee));
            }}
          >
            {PLATFORMS.map(p => <option key={p.name} value={p.name}>{p.name}{p.fee > 0 ? ` (${p.fee}%)` : ''}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Fee %</label>
              <input type="number" className={inputCls} value={platformFeePercent} onChange={e => setPlatformFeePercent(e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Sale Date</label>
              <input type="date" className={inputCls} value={soldDate} onChange={e => setSoldDate(e.target.value)} />
            </div>
          </div>
        </div>

        <button
          onClick={handleCheckout}
          disabled={cart.length === 0 || !customerName}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
        >
          <ShoppingCart className="w-4 h-4" /> Complete Sale · ${totalPaid.toFixed(2)}
        </button>
      </div>

      {/* Device picker modal */}
      {showPicker && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 bg-black/40 backdrop-blur-sm px-4" onClick={() => setShowPicker(false)}>
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <Search className="w-4 h-4 text-slate-400" />
              <input autoFocus className="flex-1 bg-transparent text-sm focus:outline-none text-slate-900 dark:text-slate-100" placeholder="Search unsold devices…" value={search} onChange={e => setSearch(e.target.value)} />
              <button onClick={() => setShowPicker(false)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {availableDevices.length === 0 && <p className="text-center text-slate-400 text-sm py-8">No matching unsold devices</p>}
              {availableDevices.map(item => (
                <button key={item.id} onClick={() => addDevice(item)} className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-50 dark:border-slate-800/60 flex justify-between items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{item.item}</p>
                    <p className="text-xs text-slate-400 truncate">{item.imei || 'No IMEI'}</p>
                  </div>
                  <span className="text-xs text-slate-500 shrink-0 ml-3">${(item.purchaseCost + item.repairCost).toFixed(2)} cost</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value: number; bold?: boolean; muted?: boolean }> = ({ label, value, bold, muted }) => (
  <div className="flex items-center justify-between">
    <span className={`${muted ? 'text-slate-400' : 'text-slate-600 dark:text-slate-300'} ${bold ? 'font-semibold' : ''}`}>{label}</span>
    <span className={`${bold ? 'font-bold text-slate-800 dark:text-slate-100' : muted ? 'text-slate-500 dark:text-slate-400' : 'text-slate-700 dark:text-slate-200'}`}>${value.toFixed(2)}</span>
  </div>
);

const IconInput: React.FC<{ icon: React.ReactNode; placeholder: string; value: string; onChange: (v: string) => void }> = ({ icon, placeholder, value, onChange }) => (
  <div className="relative">
    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">{icon}</div>
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
    />
  </div>
);

const PayBtn: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all border ${
      active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'
    }`}
  >
    {icon}{label}
  </button>
);
