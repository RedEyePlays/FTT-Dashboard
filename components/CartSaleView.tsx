import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ShoppingCart, Trash2, X, Search, User, Phone, FileText, Mail,
  Banknote, CreditCard, Blend, CheckCircle, Package, Smartphone, ScanLine, History,
  Printer, Eye, RotateCcw, QrCode, Sparkles,
} from 'lucide-react';
import { InventoryItem, ItemKind, SalesTransaction, Customer } from '../types';
import { getPOSSettings } from './SettingsModal';
import { LabelModal } from './LabelModal';
import { newId } from '../domain/ids';
import { kindOf } from '../domain/inventory';
import { PLATFORMS } from '../domain/pos';
import { CustomerSearchInput } from './CustomerSearchInput';

export interface CartCheckout {
  soldRows: InventoryItem[];              // device rows to mark sold (replace by id)
  accessoryQtys: Record<string, number>; // accessoryId -> qty to decrement
  transaction: SalesTransaction;         // sales record to persist
  customer?: Customer;                   // customer to upsert
  newInventoryItems?: InventoryItem[];   // custom items to add to inventory (SKU filled by caller)
}

interface Props {
  inventory: InventoryItem[];
  customers?: Customer[];
  initialCustomer?: Customer;   // pre-seed the sale customer (CRM quick action)
  onConsumeInitial?: () => void;
  onComplete: (payload: CartCheckout) => void;
}

// `uid` is kept as a local alias so the many call sites below stay unchanged.
const uid = newId;

type CustomCategory = 'device' | 'accessory' | 'service' | 'other';

interface CartLine {
  key: string;
  inventoryId: string;   // '' for custom items not tied to inventory
  kind: ItemKind;
  name: string;
  code: string;
  quantity: number;
  maxQty: number;        // accessories: available stock; devices: 1; custom: 9999
  unitPrice: number;
  purchaseCost: number;  // per-unit purchase / cost estimate
  repairCost: number;    // per-unit repair (devices)
  taxable: boolean;
  discount: number;
  // Custom (not-in-inventory) items
  isCustom?: boolean;
  category?: CustomCategory;
  imei?: string;
  notes?: string;
  addToInventory?: boolean;
}

export const CartSaleView: React.FC<Props> = ({ inventory, customers = [], initialCustomer, onConsumeInitial, onComplete }) => {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picker, setPicker] = useState<null | ItemKind>(null);
  const [search, setSearch] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const [platformName, setPlatformName] = useState('None / In-Store');
  const [platformFeePercent, setPlatformFeePercent] = useState('0');
  const [soldDate, setSoldDate] = useState(new Date().toISOString().split('T')[0]);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | undefined>(undefined);

  // Pre-seed the customer when arriving from a CRM "Start Sale" quick action.
  useEffect(() => {
    if (!initialCustomer) return;
    setCustomerName(initialCustomer.name || '');
    setCustomerPhone(initialCustomer.phone || '');
    setCustomerEmail(initialCustomer.email || '');
    setSelectedCustomerId(initialCustomer.id);
    onConsumeInitial?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCustomer?.id]);

  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mixed'>('cash');
  const [cashTaxStatus, setCashTaxStatus] = useState<'none' | 'separate' | 'included'>('none');
  const [paymentNotes, setPaymentNotes] = useState('');

  // Mixed-payment breakdown
  const [cashAmount, setCashAmount] = useState('');
  const [cardAmount, setCardAmount] = useState('');
  const [etransferAmount, setEtransferAmount] = useState('');
  const [taxCollected, setTaxCollected] = useState('');

  // Scan input + result of a completed sale
  const [scan, setScan] = useState('');
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const [lastTx, setLastTx] = useState<SalesTransaction | null>(null);
  const [showTx, setShowTx] = useState(false);
  const [labelItem, setLabelItem] = useState<InventoryItem | null>(null);

  // Custom (not-in-inventory) item modal
  const emptyCustom = () => ({ name: '', category: 'accessory' as CustomCategory, quantity: '1', unitPrice: '', costEstimate: '', taxable: true, notes: '', imei: '', addToInventory: false });
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState(emptyCustom());

  const taxRate = getPOSSettings().taxRate;
  const feePercent = parseFloat(platformFeePercent) || 0;

  const soldIds = new Set(inventory.filter(i => kindOf(i) === 'device' && (i.soldDate || i.deviceStatus === 'sold')).map(i => i.id));
  const inCart = new Set(cart.map(l => l.inventoryId));

  // Previous purchases for the typed customer (match name or phone across sold rows)
  const previousPurchases = useMemo(() => {
    const n = customerName.trim().toLowerCase();
    const p = customerPhone.trim();
    if (!n && !p) return [];
    return inventory.filter(i =>
      (i.soldDate || i.deviceStatus === 'sold') &&
      ((n && (i.customerName || i.soldTo || '').toLowerCase() === n) ||
       (p && (i.customerPhone || '') === p))
    );
  }, [inventory, customerName, customerPhone]);

  const availableDevices = inventory.filter(i =>
    kindOf(i) === 'device' && !soldIds.has(i.id) && !inCart.has(i.id) &&
    ((i.item || '').toLowerCase().includes(search.toLowerCase()) ||
     (i.sku || '').toLowerCase().includes(search.toLowerCase()) ||
     (i.imei || '').toLowerCase().includes(search.toLowerCase()))
  );
  const availableAccessories = inventory.filter(i =>
    kindOf(i) === 'accessory' && (i.quantity ?? 0) > 0 && !inCart.has(i.id) &&
    ((i.item || '').toLowerCase().includes(search.toLowerCase()) ||
     (i.sku || '').toLowerCase().includes(search.toLowerCase()) ||
     (i.manufacturerBarcode || '').toLowerCase().includes(search.toLowerCase()))
  );

  // ---- math ----
  // Custom items may be negative (manual discount/adjustment); real items clamp at 0.
  const lineSubtotal = (l: CartLine) => {
    const v = l.quantity * l.unitPrice - l.discount;
    return l.isCustom ? v : Math.max(0, v);
  };
  const linePurchase = (l: CartLine) => l.quantity * l.purchaseCost;
  const lineRepair = (l: CartLine) => l.quantity * l.repairCost;

  const subtotal = cart.reduce((s, l) => s + lineSubtotal(l), 0);
  const purchaseCostTotal = cart.reduce((s, l) => s + linePurchase(l), 0);
  const repairCostTotal = cart.reduce((s, l) => s + lineRepair(l), 0);
  const totalCost = purchaseCostTotal + repairCostTotal;
  const taxableBase = cart.filter(l => l.taxable).reduce((s, l) => s + lineSubtotal(l), 0);
  const taxApplies = !(paymentMethod === 'cash' && cashTaxStatus === 'none');
  // Mixed payments use a manually-entered tax figure; otherwise compute from the rate.
  const tax = paymentMethod === 'mixed'
    ? (parseFloat(taxCollected) || 0)
    : (taxApplies ? taxableBase * taxRate / 100 : 0);
  const platformFee = subtotal * feePercent / 100;
  const totalPaid = subtotal + tax;
  const netProfit = subtotal - totalCost - platformFee;

  // ---- mutations ----
  const addDevice = (i: InventoryItem) => {
    setCart(c => [...c, {
      key: uid(), inventoryId: i.id, kind: 'device', name: i.item || [i.brand, i.model].filter(Boolean).join(' '),
      code: i.sku || i.imei, quantity: 1, maxQty: 1,
      unitPrice: i.targetSalePrice || 0, purchaseCost: i.purchaseCost, repairCost: i.repairCost || 0,
      taxable: true, discount: 0,
    }]);
    setPicker(null); setSearch('');
  };
  const addAccessory = (i: InventoryItem) => {
    setCart(c => [...c, {
      key: uid(), inventoryId: i.id, kind: 'accessory', name: i.item,
      code: i.sku || i.manufacturerBarcode || '', quantity: 1, maxQty: i.quantity ?? 1,
      unitPrice: i.sellingPrice || 0, purchaseCost: i.costPerUnit || 0, repairCost: 0,
      taxable: true, discount: 0,
    }]);
    setPicker(null); setSearch('');
  };
  const updateLine = (key: string, patch: Partial<CartLine>) =>
    setCart(c => c.map(l => l.key === key ? { ...l, ...patch } : l));
  const removeLine = (key: string) => setCart(c => c.filter(l => l.key !== key));
  const num = (v: string) => parseFloat(v) || 0;

  // Add a custom (not-in-inventory) item to the cart
  const addCustomItem = () => {
    if (!custom.name.trim()) return;
    setCart(c => [...c, {
      key: uid(), inventoryId: '', kind: custom.category === 'device' ? 'device' : 'accessory',
      name: custom.name.trim(), code: custom.imei.trim(),
      quantity: Math.max(1, Math.round(num(custom.quantity)) || 1), maxQty: 9999,
      unitPrice: num(custom.unitPrice), purchaseCost: num(custom.costEstimate), repairCost: 0,
      taxable: custom.taxable, discount: 0,
      isCustom: true, category: custom.category, imei: custom.imei.trim() || undefined,
      notes: custom.notes.trim() || undefined, addToInventory: custom.addToInventory,
    }]);
    setCustom(emptyCustom());
    setShowCustom(false);
  };

  // Resolve a scanned/typed code to an inventory item and add it to the cart.
  // Works with USB/Bluetooth scanners that type into the focused input + Enter.
  const handleScan = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    const q = v.toLowerCase();
    const eq = (a?: string) => (a || '').toLowerCase() === q;

    const device = inventory.find(i => kindOf(i) === 'device' && !soldIds.has(i.id) && !inCart.has(i.id) && (eq(i.sku) || eq(i.imei)));
    if (device) { addDevice(device); setScan(''); setScanMsg(null); return; }

    const acc = inventory.find(i => kindOf(i) === 'accessory' && (i.quantity ?? 0) > 0 && (eq(i.sku) || eq(i.manufacturerBarcode)));
    if (acc) {
      const line = cart.find(l => l.inventoryId === acc.id);
      if (line) updateLine(line.key, { quantity: Math.min(line.maxQty, line.quantity + 1) });
      else addAccessory(acc);
      setScan(''); setScanMsg(null); return;
    }
    setScanMsg(`No item found for "${v}"`);
    setScan('');
  };

  // ---- checkout ----
  const handleCheckout = () => {
    if (cart.length === 0 || !customerName) return;
    const transactionId = uid();
    const soldRows: InventoryItem[] = [];
    const accessoryQtys: Record<string, number> = {};
    const newInventoryItems: InventoryItem[] = [];

    cart.forEach(l => {
      const saleShare = lineSubtotal(l);
      const feeShare = subtotal > 0 ? platformFee * (saleShare / subtotal) : 0;
      const taxShare = l.taxable && taxableBase > 0 ? tax * (saleShare / taxableBase) : 0;
      const common = {
        transactionId, soldDate, soldTo: customerName,
        customerName, customerPhone, customerEmail, customerNotes,
        paymentMethod, taxCollected: taxShare,
        cashTaxStatus: paymentMethod === 'cash' ? cashTaxStatus : undefined,
        paymentNotes: paymentNotes || undefined,
        platformName, platformFeePercent: feePercent, platformFees: feeShare,
      };

      // Custom items: never touch existing inventory. Optionally add a new record.
      if (l.isCustom) {
        if (l.addToInventory && (l.category === 'device' || l.category === 'accessory')) {
          if (l.category === 'device') {
            newInventoryItems.push({
              id: uid(), kind: 'device', sku: '', date: soldDate, item: l.name, imei: l.imei || '',
              boughtFrom: 'Custom sale', purchaseCost: l.purchaseCost, repairCost: 0,
              deviceType: 'Other', condition: 'Good', deviceStatus: 'sold',
              salePrice: saleShare, notes: l.notes || 'Added from custom sale', ...common,
            } as InventoryItem);
          } else {
            newInventoryItems.push({
              id: uid(), kind: 'accessory', sku: '', date: soldDate, item: l.name, imei: '',
              boughtFrom: 'Custom sale', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0,
              category: 'Custom', quantity: 0, costPerUnit: l.purchaseCost, sellingPrice: l.unitPrice,
              lowStockThreshold: 3, notes: l.notes || 'Added from custom sale',
            } as InventoryItem);
          }
        }
        return;
      }

      if (l.kind === 'accessory') {
        accessoryQtys[l.inventoryId] = (accessoryQtys[l.inventoryId] || 0) + l.quantity;
      } else {
        const existing = inventory.find(i => i.id === l.inventoryId);
        if (existing) soldRows.push({ ...existing, ...common, salePrice: saleShare, deviceStatus: 'sold' });
      }
    });

    const customer: Customer | undefined = customerName.trim()
      ? { id: (selectedCustomerId || customerPhone.trim() || customerName.trim().toLowerCase().replace(/\s+/g, '-')), name: customerName.trim(), phone: customerPhone.trim(), email: customerEmail.trim() || undefined, notes: customerNotes.trim() || undefined }
      : undefined;

    const transaction: SalesTransaction = {
      id: transactionId, date: soldDate,
      customerId: customer?.id, customerName, customerPhone: customerPhone || undefined, customerEmail: customerEmail || undefined,
      paymentMethod,
      cashAmount: paymentMethod === 'mixed' ? (parseFloat(cashAmount) || 0) : undefined,
      cardAmount: paymentMethod === 'mixed' ? (parseFloat(cardAmount) || 0) : undefined,
      etransferAmount: paymentMethod === 'mixed' ? (parseFloat(etransferAmount) || 0) : undefined,
      platformName,
      subtotal, tax, platformFee, purchaseCost: purchaseCostTotal, repairCost: repairCostTotal,
      totalCost, totalPaid, netProfit,
      lines: cart.map(l => ({ inventoryId: l.inventoryId, kind: l.kind, name: l.name, sku: l.code, quantity: l.quantity, unitPrice: l.unitPrice })),
      notes: paymentNotes || undefined,
    };

    onComplete({ soldRows, accessoryQtys, transaction, customer, newInventoryItems });
    setLastTx(transaction);
    setConfirmed(true);
  };

  const reset = () => {
    setCart([]); setCustomerName(''); setCustomerPhone(''); setCustomerEmail(''); setCustomerNotes(''); setSelectedCustomerId(undefined);
    setPaymentNotes(''); setPaymentMethod('cash'); setCashTaxStatus('none');
    setCashAmount(''); setCardAmount(''); setEtransferAmount(''); setTaxCollected('');
    setPlatformName('None / In-Store'); setPlatformFeePercent('0');
    setLastTx(null); setShowTx(false); setConfirmed(false);
    setCustom(emptyCustom()); setShowCustom(false);
    setTimeout(() => scanRef.current?.focus(), 0);
  };

  // Build and print a simple counter receipt for the completed transaction.
  const printReceipt = () => {
    if (!lastTx) return;
    const rows = lastTx.lines.map(l => `<tr><td>${l.name}</td><td style="text-align:center">${l.quantity}</td><td style="text-align:right">$${(l.quantity * l.unitPrice).toFixed(2)}</td></tr>`).join('');
    const payParts = lastTx.paymentMethod === 'mixed'
      ? [['Cash', lastTx.cashAmount], ['Card', lastTx.cardAmount], ['E-transfer', lastTx.etransferAmount]].filter(([, v]) => v).map(([k, v]) => `${k}: $${Number(v).toFixed(2)}`).join(' · ')
      : (lastTx.paymentMethod || '');
    const win = window.open('', '_blank', 'width=380,height=640');
    if (!win) return;
    win.document.write(`<html><head><title>Receipt ${lastTx.id}</title>
      <style>body{font-family:'Inter',system-ui,Arial,sans-serif;width:280px;margin:0 auto;padding:12px;color:#000;}
      h2{text-align:center;margin:0 0 2px;} .muted{color:#555;font-size:11px;text-align:center;margin-bottom:8px;}
      table{width:100%;border-collapse:collapse;font-size:12px;} td{padding:2px 0;} .tot td{border-top:1px dashed #999;padding-top:4px;}
      .row{display:flex;justify-content:space-between;font-size:12px;} .b{font-weight:800;}</style></head>
      <body><h2>FlipThatTech</h2><div class="muted">Receipt ${lastTx.id}<br/>${lastTx.date}</div>
      <table>${rows}</table>
      <div style="margin-top:8px">
        <div class="row"><span>Subtotal</span><span>$${lastTx.subtotal.toFixed(2)}</span></div>
        <div class="row"><span>Tax</span><span>$${lastTx.tax.toFixed(2)}</span></div>
        <div class="row b" style="margin-top:4px"><span>Total</span><span>$${lastTx.totalPaid.toFixed(2)}</span></div>
        <div class="row" style="margin-top:6px;color:#555"><span>Payment</span><span>${payParts}</span></div>
        ${lastTx.customerName ? `<div class="row" style="color:#555"><span>Customer</span><span>${lastTx.customerName}</span></div>` : ''}
      </div>
      <p style="text-align:center;font-size:11px;color:#555;margin-top:12px">Thank you!</p>
      <script>window.onload=function(){window.print();setTimeout(function(){window.close();},300);};</script>
      </body></html>`);
    win.document.close();
  };

  const soldDeviceRows = cart.filter(l => l.kind === 'device').map(l => inventory.find(i => i.id === l.inventoryId)).filter(Boolean) as InventoryItem[];

  const inputCls = 'w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

  if (confirmed && lastTx) {
    return (
      <div className="h-full min-h-[calc(100vh-14rem)] flex flex-col items-center justify-center text-center gap-4">
        <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <CheckCircle className="w-10 h-10 text-emerald-500" />
        </div>
        <div>
          <p className="text-xl font-bold text-slate-800 dark:text-slate-100">Sale Complete!</p>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{lastTx.lines.length} item{lastTx.lines.length !== 1 ? 's' : ''} sold to {lastTx.customerName || 'customer'}</p>
        </div>
        <div className="flex gap-6 text-sm">
          <div className="text-center"><p className="text-slate-400 text-xs">Total Paid</p><p className="font-bold text-slate-800 dark:text-slate-100">${lastTx.totalPaid.toFixed(2)}</p></div>
          <div className="text-center"><p className="text-slate-400 text-xs">Net Profit</p><p className={`font-bold ${lastTx.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>${lastTx.netProfit.toFixed(2)}</p></div>
        </div>

        <div className="grid grid-cols-2 gap-2 w-full max-w-sm mt-2">
          <button onClick={printReceipt} className="flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Printer className="w-4 h-4" /> Print Receipt</button>
          <button onClick={() => soldDeviceRows[0] && setLabelItem(soldDeviceRows[0])} disabled={soldDeviceRows.length === 0}
            className="flex items-center justify-center gap-2 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400 disabled:opacity-40"><QrCode className="w-4 h-4" /> Print Label</button>
          <button onClick={() => setShowTx(true)} className="flex items-center justify-center gap-2 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400"><Eye className="w-4 h-4" /> View Transaction</button>
          <button onClick={reset} className="flex items-center justify-center gap-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium"><RotateCcw className="w-4 h-4" /> Sell Another</button>
        </div>

        {labelItem && <LabelModal item={labelItem} onClose={() => setLabelItem(null)} />}
        {showTx && (
          <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowTx(false)}>
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md border border-slate-200 dark:border-slate-700 max-h-[90vh] overflow-y-auto text-left" onClick={e => e.stopPropagation()}>
              <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <h2 className="font-bold text-slate-800 dark:text-slate-100">Transaction {lastTx.id}</h2>
                <button onClick={() => setShowTx(false)}><X className="w-5 h-5 text-slate-400" /></button>
              </div>
              <div className="p-5 space-y-3 text-sm">
                <p className="text-slate-500 dark:text-slate-400">{lastTx.date} · {lastTx.customerName}{lastTx.customerPhone ? ` · ${lastTx.customerPhone}` : ''}</p>
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-100 dark:border-slate-800 rounded-lg">
                  {lastTx.lines.map((l, idx) => (
                    <div key={idx} className="flex items-center justify-between px-3 py-2">
                      <span className="text-slate-700 dark:text-slate-200 truncate">{l.name} <span className="text-slate-400 text-xs">×{l.quantity}</span></span>
                      <span className="text-slate-600 dark:text-slate-300">${(l.quantity * l.unitPrice).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1">
                  <Row label="Subtotal" value={lastTx.subtotal} />
                  <Row label="Tax" value={lastTx.tax} muted />
                  <Row label="Platform fee" value={-lastTx.platformFee} muted />
                  <Row label="Total Paid" value={lastTx.totalPaid} bold />
                  <Row label="Net Profit" value={lastTx.netProfit} />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">Payment: {lastTx.paymentMethod}{lastTx.paymentMethod === 'mixed' ? ` — cash $${(lastTx.cashAmount || 0).toFixed(2)}, card $${(lastTx.cardAmount || 0).toFixed(2)}, e-transfer $${(lastTx.etransferAmount || 0).toFixed(2)}` : ''}</p>
                {lastTx.notes && <p className="text-xs text-slate-500 dark:text-slate-400 italic">{lastTx.notes}</p>}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  const items = picker === 'device' ? availableDevices : availableAccessories;

  return (
    <div className="flex flex-col lg:flex-row gap-6 h-full min-h-[calc(100vh-14rem)]">
      {/* Left: cart */}
      <div className="flex-1 flex flex-col gap-3">
        {/* Scan / search to add — works with USB/Bluetooth wedge scanners */}
        <div className="relative">
          <ScanLine className="w-4 h-4 text-indigo-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            ref={scanRef}
            autoFocus
            value={scan}
            onChange={e => { setScan(e.target.value); setScanMsg(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleScan(scan); } }}
            placeholder="Scan SKU, IMEI, serial, or barcode to add item"
            className="w-full pl-9 pr-3 py-3 bg-white dark:bg-slate-900 border-2 border-indigo-200 dark:border-indigo-800 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        {scanMsg && <p className="text-xs text-rose-500 -mt-1">{scanMsg}</p>}

        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setPicker('device'); setSearch(''); }} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Smartphone className="w-4 h-4" /> Add Device</button>
          <button onClick={() => { setPicker('accessory'); setSearch(''); }} className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400"><Package className="w-4 h-4" /> Add Accessory</button>
          <button onClick={() => { setCustom(emptyCustom()); setShowCustom(true); }} className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400"><Sparkles className="w-4 h-4" /> Add Custom Item</button>
        </div>

        {cart.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center text-center text-slate-400 gap-3 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
            <ShoppingCart className="w-10 h-10 text-slate-300" />
            <p className="text-sm font-medium">Cart is empty</p>
            <p className="text-xs">Add devices and accessories to one transaction</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {cart.map(l => (
            <div key={l.key} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <div className={`mt-1 ${l.isCustom ? 'text-amber-500' : l.kind === 'device' ? 'text-indigo-500' : 'text-violet-500'}`}>{l.isCustom ? <Sparkles className="w-4 h-4" /> : l.kind === 'device' ? <Smartphone className="w-4 h-4" /> : <Package className="w-4 h-4" />}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate flex items-center gap-2">{l.name}
                    {l.isCustom && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Custom · {l.category}</span>}
                  </p>
                  {(l.code || l.notes) && <p className="text-xs text-slate-400 font-mono truncate">{l.code}{l.notes ? `  ${l.notes}` : ''}</p>}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2">
                    {(l.kind === 'accessory' || l.isCustom) && (
                      <div><label className={labelCls}>Qty{!l.isCustom ? ` (max ${l.maxQty})` : ''}</label>
                        <input type="number" min="1" max={l.maxQty} className={inputCls} value={l.quantity}
                          onChange={e => updateLine(l.key, { quantity: Math.min(l.maxQty, Math.max(1, Math.round(num(e.target.value)))) })} /></div>
                    )}
                    <div><label className={labelCls}>Unit Price</label>
                      <input type="number" step="0.01" className={inputCls} value={l.unitPrice} onChange={e => updateLine(l.key, { unitPrice: num(e.target.value) })} /></div>
                    <div><label className={labelCls}>Discount</label>
                      <input type="number" step="0.01" className={inputCls} value={l.discount} onChange={e => updateLine(l.key, { discount: num(e.target.value) })} /></div>
                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                        <input type="checkbox" checked={l.taxable} onChange={e => updateLine(l.key, { taxable: e.target.checked })} className="rounded" /> Taxable
                      </label>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">${lineSubtotal(l).toFixed(2)}</p>
                  <button onClick={() => removeLine(l.key)} className="text-slate-400 hover:text-rose-500 mt-1"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: checkout */}
      <div className="w-full lg:w-96 shrink-0 flex flex-col gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-2 text-sm">
          <Row label="Subtotal" value={subtotal} />
          <Row label={`Tax${taxApplies ? ` (${taxRate}%)` : ' (none)'}`} value={tax} muted />
          <Row label={`Platform fee${feePercent ? ` (${feePercent}%)` : ''}`} value={-platformFee} muted />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1" />
          <Row label="Total Paid" value={totalPaid} bold />
          <Row label="Purchase Cost" value={purchaseCostTotal} muted />
          <Row label="Repair Cost" value={repairCostTotal} muted />
          <Row label="Total Cost" value={totalCost} muted />
          <div className="flex items-center justify-between pt-1">
            <span className="font-semibold text-slate-700 dark:text-slate-200">Net Profit</span>
            <span className={`text-lg font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>${netProfit.toFixed(2)}</span>
          </div>
        </div>

        {/* Customer */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Customer</p>
          {customers.length > 0 && (
            <CustomerSearchInput customers={customers} placeholder="Find existing customer…"
              onSelect={c => { setCustomerName(c.name); setCustomerPhone(c.phone || ''); setCustomerEmail(c.email || ''); setSelectedCustomerId(c.id); }} />
          )}
          <IconInput icon={<User className="w-4 h-4" />} placeholder="Customer name *" value={customerName} onChange={v => { setCustomerName(v); setSelectedCustomerId(undefined); }} />
          <IconInput icon={<Phone className="w-4 h-4" />} placeholder="Phone number" value={customerPhone} onChange={setCustomerPhone} />
          <IconInput icon={<Mail className="w-4 h-4" />} placeholder="Email (optional)" value={customerEmail} onChange={setCustomerEmail} />
          <IconInput icon={<FileText className="w-4 h-4" />} placeholder="Customer notes" value={customerNotes} onChange={setCustomerNotes} />
          {previousPurchases.length > 0 && (
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-2 text-xs text-indigo-700 dark:text-indigo-300">
              <p className="font-semibold flex items-center gap-1"><History className="w-3 h-3" /> {previousPurchases.length} previous purchase{previousPurchases.length !== 1 ? 's' : ''}</p>
              <ul className="mt-1 space-y-0.5 text-indigo-600/80 dark:text-indigo-300/80">
                {previousPurchases.slice(0, 4).map(p => <li key={p.id} className="truncate">{p.soldDate}: {p.item} — ${(p.salePrice || 0).toFixed(2)}</li>)}
              </ul>
            </div>
          )}
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
          {paymentMethod === 'mixed' && (
            <div className="grid grid-cols-2 gap-2">
              <div><label className={labelCls}>Cash Amount</label><input type="number" step="0.01" className={inputCls} value={cashAmount} onChange={e => setCashAmount(e.target.value)} placeholder="0.00" /></div>
              <div><label className={labelCls}>Card Amount</label><input type="number" step="0.01" className={inputCls} value={cardAmount} onChange={e => setCardAmount(e.target.value)} placeholder="0.00" /></div>
              <div><label className={labelCls}>E-transfer</label><input type="number" step="0.01" className={inputCls} value={etransferAmount} onChange={e => setEtransferAmount(e.target.value)} placeholder="0.00" /></div>
              <div><label className={labelCls}>Tax Collected</label><input type="number" step="0.01" className={inputCls} value={taxCollected} onChange={e => setTaxCollected(e.target.value)} placeholder="0.00" /></div>
            </div>
          )}
          <IconInput icon={<FileText className="w-4 h-4" />} placeholder="Payment notes, e.g. $200 cash + $15 tax" value={paymentNotes} onChange={setPaymentNotes} />
        </div>

        {/* Platform */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Platform & Date</p>
          <select className={inputCls} value={platformName} onChange={e => {
            const p = PLATFORMS.find(x => x.name === e.target.value); setPlatformName(e.target.value); if (p) setPlatformFeePercent(String(p.fee));
          }}>
            {PLATFORMS.map(p => <option key={p.name} value={p.name}>{p.name}{p.fee > 0 ? ` (${p.fee}%)` : ''}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Fee %</label><input type="number" className={inputCls} value={platformFeePercent} onChange={e => setPlatformFeePercent(e.target.value)} /></div>
            <div><label className={labelCls}>Sale Date</label><input type="date" className={inputCls} value={soldDate} onChange={e => setSoldDate(e.target.value)} /></div>
          </div>
        </div>

        <button onClick={handleCheckout} disabled={cart.length === 0 || !customerName}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
          <ShoppingCart className="w-4 h-4" /> Complete Sale · ${totalPaid.toFixed(2)}
        </button>
      </div>

      {/* Picker modal (device or accessory stock) */}
      {picker && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 bg-black/40 backdrop-blur-sm px-4" onClick={() => setPicker(null)}>
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
              <Search className="w-4 h-4 text-slate-400" />
              <input autoFocus className="flex-1 bg-transparent text-sm focus:outline-none text-slate-900 dark:text-slate-100"
                placeholder={`Scan or search ${picker === 'device' ? 'devices' : 'accessories'}…`} value={search} onChange={e => setSearch(e.target.value)} />
              <span className="flex items-center gap-1 text-[11px] text-slate-400"><ScanLine className="w-3.5 h-3.5" /> scanner ready</span>
              <button onClick={() => setPicker(null)}><X className="w-4 h-4 text-slate-400" /></button>
            </div>
            <div className="max-h-80 overflow-y-auto">
              {items.length === 0 && <p className="text-center text-slate-400 text-sm py-8">No matching {picker === 'device' ? 'unsold devices' : 'in-stock accessories'}.</p>}
              {items.map(i => (
                <button key={i.id} onClick={() => picker === 'device' ? addDevice(i) : addAccessory(i)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-50 dark:border-slate-800/60 flex justify-between items-center">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{i.item || [i.brand, i.model].filter(Boolean).join(' ')}</p>
                    <p className="text-xs text-slate-400 truncate font-mono">{i.sku || i.imei || i.manufacturerBarcode || '—'}</p>
                  </div>
                  <span className="text-xs text-slate-500 shrink-0 ml-3">
                    {picker === 'device' ? `$${(i.targetSalePrice || 0).toFixed(2)}` : `${i.quantity} in stock · $${(i.sellingPrice || 0).toFixed(2)}`}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Custom item modal */}
      {showCustom && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setShowCustom(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg border border-slate-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Sparkles className="w-5 h-5 text-amber-500" /> Add Custom Item</h2>
              <button onClick={() => setShowCustom(false)}><X className="w-5 h-5 text-slate-400" /></button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className={labelCls}>Item Name *</label>
                <input autoFocus className={inputCls} value={custom.name} onChange={e => setCustom(c => ({ ...c, name: e.target.value }))} placeholder="e.g. Service fee, Random charger" /></div>
              <div><label className={labelCls}>Category</label>
                <select className={inputCls} value={custom.category} onChange={e => setCustom(c => ({ ...c, category: e.target.value as CustomCategory }))}>
                  <option value="device">Device</option>
                  <option value="accessory">Accessory</option>
                  <option value="service">Service</option>
                  <option value="other">Other</option>
                </select></div>
              <div><label className={labelCls}>Quantity</label>
                <input type="number" min="1" className={inputCls} value={custom.quantity} onChange={e => setCustom(c => ({ ...c, quantity: e.target.value }))} /></div>
              <div><label className={labelCls}>Unit Price</label>
                <input type="number" step="0.01" className={inputCls} value={custom.unitPrice} onChange={e => setCustom(c => ({ ...c, unitPrice: e.target.value }))} placeholder="0.00 (negative = discount)" /></div>
              <div><label className={labelCls}>Cost Estimate (optional)</label>
                <input type="number" step="0.01" className={inputCls} value={custom.costEstimate} onChange={e => setCustom(c => ({ ...c, costEstimate: e.target.value }))} placeholder="0.00" /></div>
              {custom.category === 'device' && (
                <div className="col-span-2"><label className={labelCls}>IMEI / Serial (optional)</label>
                  <input className={inputCls} value={custom.imei} onChange={e => setCustom(c => ({ ...c, imei: e.target.value }))} /></div>
              )}
              <div className="col-span-2"><label className={labelCls}>Notes</label>
                <input className={inputCls} value={custom.notes} onChange={e => setCustom(c => ({ ...c, notes: e.target.value }))} /></div>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
                <input type="checkbox" checked={custom.taxable} onChange={e => setCustom(c => ({ ...c, taxable: e.target.checked }))} className="rounded" /> Taxable
              </label>
              {(custom.category === 'device' || custom.category === 'accessory') && (
                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={custom.addToInventory} onChange={e => setCustom(c => ({ ...c, addToInventory: e.target.checked }))} className="rounded" /> Add this item to inventory after sale
                </label>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button onClick={() => setShowCustom(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
              <button onClick={addCustomItem} disabled={!custom.name.trim()} className="px-5 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium">Add to Cart</button>
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
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
  </div>
);

const PayBtn: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button type="button" onClick={onClick}
    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-all border ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-400'}`}>
    {icon}{label}
  </button>
);
