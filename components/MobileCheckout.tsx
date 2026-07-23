import React, { useEffect, useState } from 'react';
import {
  ScanLine, Search, Plus, Minus, Trash2, Smartphone, Package, Sparkles, ShoppingCart,
  User, Phone, Mail, ChevronLeft, CheckCircle, Banknote, CreditCard, Blend, Send,
  Printer, RotateCcw, Eye, X, AlertTriangle,
} from 'lucide-react';
import { InventoryItem, Customer } from '../types';
import { getDeviceDisplayName } from '../domain/inventory';
import { useCheckout, CartCheckout } from '../hooks/useCheckout';
import { CustomerSearchInput } from './CustomerSearchInput';
import { LabelModal } from './LabelModal';
import { ResponsiveDialog, EmptyState } from './responsive';

interface Props {
  inventory: InventoryItem[];
  customers?: Customer[];
  initialCustomer?: Customer;
  onConsumeInitial?: () => void;
  onComplete: (payload: CartCheckout) => void;
  // Accepted for a uniform QuickSaleView call; the mobile flow shows no
  // cost/profit figures, so there is nothing to mask here.
  canViewProfit?: boolean;
}

const STEPS = ['Items', 'Cart', 'Customer', 'Payment', 'Done'];

export const MobileCheckout: React.FC<Props> = (props) => {
  const cx = useCheckout(props);
  const [step, setStep] = useState(0); // 0..4
  const [pick, setPick] = useState<null | 'device' | 'accessory'>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [payChoice, setPayChoice] = useState<'cash' | 'card' | 'etransfer' | 'mixed'>('cash');
  const [txModal, setTxModal] = useState(false);

  // E-Transfer maps to the existing 'mixed' record with the full total in the
  // e-transfer bucket (no schema change); tax uses the rate-based figure so it
  // isn't self-referential.
  const computedTax = cx.taxableBase * cx.taxRate / 100;
  useEffect(() => {
    if (payChoice !== 'etransfer') return;
    cx.setPaymentMethod('mixed');
    cx.setCashAmount(''); cx.setCardAmount('');
    cx.setTaxCollected(computedTax.toFixed(2));
    cx.setEtransferAmount((cx.subtotal + computedTax).toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payChoice, cx.subtotal, cx.taxableBase, cx.taxRate]);

  const choosePay = (c: typeof payChoice) => {
    setPayChoice(c);
    if (c === 'cash') cx.setPaymentMethod('cash');
    else if (c === 'card') cx.setPaymentMethod('card');
    else cx.setPaymentMethod('mixed');
  };

  const money = (n: number) => `$${(n || 0).toFixed(2)}`;
  const input = 'w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';

  // ---- Step 5: confirmation ----
  if (cx.confirmed && cx.lastTx) {
    const t = cx.lastTx;
    return (
      <div className="flex flex-col items-center text-center gap-4 py-6">
        <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center"><CheckCircle className="w-10 h-10 text-emerald-500" /></div>
        <div>
          <p className="text-xl font-bold text-slate-800 dark:text-slate-100">Sale Complete</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Receipt <span className="font-mono">{t.id.slice(0, 8)}</span></p>
        </div>
        <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-left space-y-1.5 text-sm">
          <div className="divide-y divide-slate-100 dark:divide-slate-800 mb-2">
            {t.lines.map((l, i) => <div key={i} className="flex justify-between py-1.5"><span className="text-slate-700 dark:text-slate-200 truncate">{l.name} <span className="text-slate-400 text-xs">×{l.quantity}</span></span><span className="text-slate-600 dark:text-slate-300">{money(l.quantity * l.unitPrice)}</span></div>)}
          </div>
          <div className="flex justify-between"><span className="text-slate-400">Customer</span><span className="text-slate-700 dark:text-slate-200">{t.customerName || 'Walk-in'}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Payment</span><span className="text-slate-700 dark:text-slate-200 capitalize">{payChoice === 'etransfer' ? 'E-Transfer' : t.paymentMethod}</span></div>
          <div className="flex justify-between text-base font-bold pt-1"><span>Total paid</span><span>{money(t.totalPaid)}</span></div>
        </div>
        <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
          <button onClick={cx.printReceipt} className="flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold"><Printer className="w-4 h-4" /> Print Receipt</button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setTxModal(true)} className="flex items-center justify-center gap-2 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-medium"><Eye className="w-4 h-4" /> View Sale</button>
            <button onClick={() => { cx.reset(); setStep(0); setPayChoice('cash'); }} className="flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium"><RotateCcw className="w-4 h-4" /> New Sale</button>
          </div>
          {cx.soldDeviceRows[0] && <button onClick={() => cx.setLabelItem(cx.soldDeviceRows[0])} className="text-xs text-indigo-600 dark:text-indigo-400 py-1">Print device label</button>}
        </div>
        {cx.labelItem && <LabelModal item={cx.labelItem} onClose={() => cx.setLabelItem(null)} />}
        <ResponsiveDialog open={txModal} onClose={() => setTxModal(false)} title={`Sale ${t.id.slice(0, 8)}`}>
          <div className="space-y-2 text-sm">
            <p className="text-slate-500 dark:text-slate-400">{t.date} · {t.customerName || 'Walk-in'}</p>
            {t.lines.map((l, i) => <div key={i} className="flex justify-between"><span className="text-slate-700 dark:text-slate-200">{l.name} ×{l.quantity}</span><span>{money(l.quantity * l.unitPrice)}</span></div>)}
            <div className="border-t border-slate-100 dark:border-slate-800 pt-2 flex justify-between font-bold"><span>Total</span><span>{money(t.totalPaid)}</span></div>
          </div>
        </ResponsiveDialog>
      </div>
    );
  }

  // ---- progress + step wrapper ----
  const canNext = step === 0 ? cx.cart.length > 0
    : step === 1 ? cx.cart.length > 0
    : step === 2 ? !!cx.customerName.trim()
    : true;

  const next = () => setStep(s => Math.min(3, s + 1));
  const back = () => setStep(s => Math.max(0, s - 1));

  const Progress = () => (
    <div className="flex items-center gap-1.5 mb-4">
      {STEPS.slice(0, 4).map((label, i) => (
        <div key={i} className="flex-1 flex flex-col items-center gap-1">
          <div className={`w-full h-1.5 rounded-full ${i <= step ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
          <span className={`text-[10px] ${i === step ? 'text-indigo-600 dark:text-indigo-400 font-semibold' : 'text-slate-400'}`}>{label}</span>
        </div>
      ))}
    </div>
  );

  const pickerItems = pick === 'device' ? cx.availableDevices : cx.availableAccessories;

  return (
    <div className="flex flex-col pb-28">
      <div className="flex items-center gap-2 mb-2">
        {step > 0 && <button onClick={back} aria-label="Back" className="tap-target flex items-center justify-center text-slate-500 -ml-2"><ChevronLeft className="w-5 h-5" /></button>}
        <h1 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2"><ShoppingCart className="w-5 h-5 text-indigo-500" /> Checkout</h1>
        {cx.cart.length > 0 && <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{cx.cart.length} item{cx.cart.length !== 1 ? 's' : ''}</span>}
      </div>
      <Progress />

      {/* STEP 1: scan / add items */}
      {step === 0 && (
        <div className="space-y-3">
          <div className="relative">
            <ScanLine className="w-5 h-5 text-indigo-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input inputMode="search" value={cx.scan} autoFocus
              onChange={e => { cx.setScan(e.target.value); cx.setScanMsg(null); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); cx.handleScan(cx.scan); } }}
              placeholder="Scan or type SKU / IMEI / serial / barcode"
              className="w-full pl-10 pr-3 py-3.5 bg-white dark:bg-slate-900 border-2 border-indigo-200 dark:border-indigo-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          </div>
          {cx.scanMsg && <p className="text-xs text-rose-500">{cx.scanMsg}</p>}
          <button onClick={() => cx.handleScan(cx.scan)} className="w-full flex items-center justify-center gap-2 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-base font-semibold"><ScanLine className="w-5 h-5" /> Scan / Add</button>
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => { cx.setSearch(''); setPick('device'); }} className="flex flex-col items-center gap-1 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200"><Smartphone className="w-5 h-5 text-indigo-500" /> Device</button>
            <button onClick={() => { cx.setSearch(''); setPick('accessory'); }} className="flex flex-col items-center gap-1 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200"><Package className="w-5 h-5 text-violet-500" /> Accessory</button>
            <button onClick={() => { cx.setCustom(cx.emptyCustom()); setShowCustom(true); }} className="flex flex-col items-center gap-1 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200"><Sparkles className="w-5 h-5 text-amber-500" /> Custom</button>
          </div>
          {cx.cart.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mt-2 mb-1">Recently added</p>
              <div className="flex flex-col gap-1.5">
                {[...cx.cart].slice(-4).reverse().map(l => (
                  <div key={l.key} className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm">
                    <span className="truncate text-slate-700 dark:text-slate-200">{l.name} <span className="text-slate-400 text-xs">×{l.quantity}</span></span>
                    <span className="font-medium text-slate-800 dark:text-slate-100">{money(cx.lineSubtotal(l))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* STEP 2: cart */}
      {step === 1 && (
        <div className="space-y-3">
          {cx.cart.length === 0 ? <EmptyState icon={<ShoppingCart className="w-6 h-6" />} title="Cart is empty" hint="Go back to add items." /> : cx.cart.map(l => {
            const zeroPrice = cx.isZeroPricedDevice(l);
            return (
            <div key={l.key} className={`bg-white dark:bg-slate-900 border rounded-xl p-3 ${zeroPrice ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-300/60 dark:ring-amber-500/30' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-slate-100 truncate flex items-center gap-2">{l.name}
                    {zeroPrice && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 flex items-center gap-1 shrink-0"><AlertTriangle className="w-3 h-3" /> No price</span>}
                  </p>
                  {l.code && <p className="text-xs font-mono text-slate-400 truncate">{l.code}</p>}
                </div>
                <button onClick={() => cx.removeLine(l.key)} aria-label="Remove" className="tap-target flex items-center justify-center text-slate-400 hover:text-rose-500 -mt-1 -mr-1"><Trash2 className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center justify-between mt-2 gap-2">
                <div className="flex items-center gap-2">
                  <button onClick={() => cx.updateLine(l.key, { quantity: Math.max(1, l.quantity - 1) })} aria-label="Decrease" className="tap-target flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"><Minus className="w-4 h-4" /></button>
                  <span className="w-8 text-center font-semibold text-slate-800 dark:text-slate-100">{l.quantity}</span>
                  <button onClick={() => cx.updateLine(l.key, { quantity: Math.min(l.maxQty, l.quantity + 1) })} aria-label="Increase" className="tap-target flex items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"><Plus className="w-4 h-4" /></button>
                </div>
                <span className="font-bold text-slate-800 dark:text-slate-100">{money(cx.lineSubtotal(l))}</span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <label className="text-xs text-slate-400">Price<input type="number" step="0.01" inputMode="decimal" value={l.unitPrice} onChange={e => cx.updateLine(l.key, { unitPrice: cx.num(e.target.value) })} className={input} /></label>
                <label className="text-xs text-slate-400">Discount<input type="number" step="0.01" inputMode="decimal" value={l.discount} onChange={e => cx.updateLine(l.key, { discount: cx.num(e.target.value) })} className={input} /></label>
              </div>
            </div>
          );})}
          {cx.cart.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Subtotal</span><span className="text-slate-800 dark:text-slate-100">{money(cx.subtotal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Discount</span><span className="text-slate-600 dark:text-slate-300">−{money(cx.discountTotal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Tax</span><span className="text-slate-600 dark:text-slate-300">{money(cx.tax)}</span></div>
              <div className="flex justify-between text-base font-bold border-t border-slate-100 dark:border-slate-800 pt-1.5"><span>Grand Total</span><span>{money(cx.totalPaid)}</span></div>
            </div>
          )}
        </div>
      )}

      {/* STEP 3: customer */}
      {step === 2 && (
        <div className="space-y-3">
          {cx.customers.length > 0 && (
            <CustomerSearchInput customers={cx.customers} placeholder="Search existing customer…"
              onSelect={c => { cx.setCustomerName(c.name); cx.setCustomerPhone(c.phone || ''); cx.setCustomerEmail(c.email || ''); cx.setSelectedCustomerId(c.id); }} />
          )}
          <div className="relative"><User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={cx.customerName} onChange={e => { cx.setCustomerName(e.target.value); cx.setSelectedCustomerId(undefined); }} placeholder="Customer name" className={`${input} pl-9`} /></div>
          <div className="relative"><Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input type="tel" inputMode="tel" value={cx.customerPhone} onChange={e => cx.setCustomerPhone(e.target.value)} placeholder="Phone" className={`${input} pl-9`} /></div>
          <div className="relative"><Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input type="email" inputMode="email" value={cx.customerEmail} onChange={e => cx.setCustomerEmail(e.target.value)} placeholder="Email (optional)" className={`${input} pl-9`} /></div>
          <button onClick={() => { cx.setCustomerName('Walk-in'); cx.setCustomerPhone(''); cx.setCustomerEmail(''); cx.setSelectedCustomerId(undefined); next(); }} className="w-full py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-medium">Continue as Walk-in</button>
        </div>
      )}

      {/* STEP 4: payment */}
      {step === 3 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <PayBig active={payChoice === 'cash'} onClick={() => choosePay('cash')} icon={<Banknote className="w-6 h-6" />} label="Cash" />
            <PayBig active={payChoice === 'card'} onClick={() => choosePay('card')} icon={<CreditCard className="w-6 h-6" />} label="Card" />
            <PayBig active={payChoice === 'etransfer'} onClick={() => choosePay('etransfer')} icon={<Send className="w-6 h-6" />} label="E-Transfer" />
            <PayBig active={payChoice === 'mixed'} onClick={() => choosePay('mixed')} icon={<Blend className="w-6 h-6" />} label="Mixed" />
          </div>
          {payChoice === 'cash' && (
            <label className="block text-sm text-slate-500 dark:text-slate-400">Cash tax status
              <select value={cx.cashTaxStatus} onChange={e => cx.setCashTaxStatus(e.target.value as any)} className={input}>
                <option value="none">No tax charged</option>
                <option value="separate">Tax paid separately</option>
                <option value="included">Tax included in cash</option>
              </select>
            </label>
          )}
          {payChoice === 'mixed' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-400">Cash<input type="number" inputMode="decimal" value={cx.cashAmount} onChange={e => cx.setCashAmount(e.target.value)} className={input} placeholder="0.00" /></label>
              <label className="text-xs text-slate-400">Card<input type="number" inputMode="decimal" value={cx.cardAmount} onChange={e => cx.setCardAmount(e.target.value)} className={input} placeholder="0.00" /></label>
              <label className="text-xs text-slate-400">E-Transfer<input type="number" inputMode="decimal" value={cx.etransferAmount} onChange={e => cx.setEtransferAmount(e.target.value)} className={input} placeholder="0.00" /></label>
              <label className="text-xs text-slate-400">Tax collected<input type="number" inputMode="decimal" value={cx.taxCollected} onChange={e => cx.setTaxCollected(e.target.value)} className={input} placeholder="0.00" /></label>
            </div>
          )}
          <input value={cx.paymentNotes} onChange={e => cx.setPaymentNotes(e.target.value)} placeholder="Payment notes (optional)" className={input} />
          {cx.hasZeroPricedDevice && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-500/40 rounded-xl p-3 text-sm">
              <p className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="w-4 h-4" /> A device has no sale price ($0.00)</p>
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-1">Set a price in the cart, or confirm you meant to sell it for $0.</p>
              <label className="flex items-center gap-2 mt-2 text-amber-800 dark:text-amber-300"><input type="checkbox" checked={cx.allowZeroPrice} onChange={e => cx.setAllowZeroPrice(e.target.checked)} className="rounded" /> Sell the $0 device anyway</label>
            </div>
          )}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Subtotal</span><span className="text-slate-800 dark:text-slate-100">{money(cx.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Tax</span><span className="text-slate-600 dark:text-slate-300">{money(cx.tax)}</span></div>
            <div className="flex justify-between text-base font-bold border-t border-slate-100 dark:border-slate-800 pt-1.5"><span>Total</span><span>{money(cx.totalPaid)}</span></div>
          </div>
        </div>
      )}

      {/* Sticky total + next/complete bar */}
      <div className="fixed left-0 right-0 bottom-14 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 px-4 py-3 flex items-center gap-3 safe-b">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Total</p>
          <p className="text-lg font-bold text-slate-900 dark:text-white leading-none">{money(cx.totalPaid)}</p>
        </div>
        {step < 3 ? (
          <button onClick={next} disabled={!canNext} className="ml-auto px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold">Next</button>
        ) : (
          <button onClick={cx.handleCheckout} disabled={cx.cart.length === 0 || !cx.customerName || cx.blockedByZeroPrice} className="ml-auto px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold flex items-center gap-2"><CheckCircle className="w-4 h-4" /> Complete Sale</button>
        )}
      </div>

      {/* Item picker sheet */}
      <ResponsiveDialog open={!!pick} onClose={() => setPick(null)} title={pick === 'device' ? 'Add device' : 'Add accessory'}>
        <div className="space-y-2">
          <div className="relative"><Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input autoFocus inputMode="search" value={cx.search} onChange={e => cx.setSearch(e.target.value)} placeholder="Search or scan…" className={`${input} pl-9`} /></div>
          <div className="max-h-[50vh] overflow-y-auto -mx-2">
            {pickerItems.length === 0 && <p className="text-center text-slate-400 text-sm py-6">No matching items.</p>}
            {pickerItems.map(i => (
              <button key={i.id} onClick={() => { pick === 'device' ? cx.addDevice(i) : cx.addAccessory(i); setPick(null); }}
                className="w-full text-left px-3 py-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 flex justify-between items-center">
                <div className="min-w-0"><p className="font-semibold text-slate-800 dark:text-slate-100 truncate">{getDeviceDisplayName(i)}</p><p className="text-xs font-mono text-slate-400 truncate">{i.sku || i.imei || i.manufacturerBarcode || '—'}</p></div>
                <span className="text-xs text-slate-500 shrink-0 ml-2">{pick === 'device' ? money(i.targetSalePrice || 0) : `${i.quantity} · ${money(i.sellingPrice || 0)}`}</span>
              </button>
            ))}
          </div>
        </div>
      </ResponsiveDialog>

      {/* Custom item sheet */}
      <ResponsiveDialog open={showCustom} onClose={() => setShowCustom(false)} title="Add custom item"
        footer={<button onClick={() => { cx.addCustomItem(); setShowCustom(false); }} disabled={!cx.custom.name.trim()} className="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-medium">Add to cart</button>}>
        <div className="space-y-3">
          <input autoFocus value={cx.custom.name} onChange={e => cx.setCustom(c => ({ ...c, name: e.target.value }))} placeholder="Item name *" className={input} />
          <div className="grid grid-cols-2 gap-2">
            <input type="number" inputMode="decimal" value={cx.custom.unitPrice} onChange={e => cx.setCustom(c => ({ ...c, unitPrice: e.target.value }))} placeholder="Unit price" className={input} />
            <input type="number" inputMode="numeric" value={cx.custom.quantity} onChange={e => cx.setCustom(c => ({ ...c, quantity: e.target.value }))} placeholder="Qty" className={input} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={cx.custom.taxable} onChange={e => cx.setCustom(c => ({ ...c, taxable: e.target.checked }))} className="rounded" /> Taxable</label>
        </div>
      </ResponsiveDialog>
    </div>
  );
};

const PayBig: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button onClick={onClick} className={`flex flex-col items-center justify-center gap-2 py-5 rounded-xl border-2 text-sm font-semibold transition-colors ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'}`}>
    {icon}{label}
  </button>
);
