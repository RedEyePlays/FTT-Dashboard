import React, { useEffect, useState, lazy, Suspense } from 'react';
import {
  ScanLine, Search, Plus, Minus, Trash2, Smartphone, Package, Sparkles, ShoppingCart,
  User, Phone, Mail, ChevronLeft, CheckCircle, Banknote, CreditCard, Blend, Send,
  Printer, RotateCcw, Eye, X, AlertTriangle, FileText, Wrench, History, HandCoins, Camera,
} from 'lucide-react';
// Lazy: pulls in the camera viewport/detection code only when actually opened
// — the mobile checkout flow otherwise assumes a keyboard-wedge barcode
// scanner gun (real POS hardware), so most sessions never touch this at all.
const QRScanner = lazy(() => import('./QRScanner').then(m => ({ default: m.QRScanner })));
import { InventoryItem, Customer, DeviceType, Repair } from '../types';
import { RepairSalePrefill } from '../domain/repairs';
import { getDeviceDisplayName, suggestedSalePrice, PriceSuggestion } from '../domain/inventory';
import { formatPhoneInput } from '../domain/phone';
import { listingPlatformsLabel } from '../domain/listing';
import { useCheckout, CartCheckout, CustomCategory, CUSTOM_DEVICE_TYPES } from '../hooks/useCheckout';
import { PAYMENT_METHOD_LABEL } from '../services/salesReceipt';
import { CustomerSearchInput } from './CustomerSearchInput';
import { selectOnFocus } from '../hooks/selectOnFocus';
// Lazy: defers jsPDF (~390 kB) until a label is actually printed.
const LabelModal = lazy(() => import('./LabelModal').then(m => ({ default: m.LabelModal })));
import { ResponsiveDialog, EmptyState } from './responsive';
import { todayISO } from '../domain/dates';

interface Props {
  inventory: InventoryItem[];
  customers?: Customer[];
  repairs?: Repair[];
  initialCustomer?: Customer;
  onConsumeInitial?: () => void;
  initialRepair?: RepairSalePrefill;
  onConsumeInitialRepair?: () => void;
  onComplete: (payload: CartCheckout) => void;
  // Accepted for a uniform QuickSaleView call; the mobile flow shows no
  // cost/profit figures, so there is nothing to mask here.
  canViewProfit?: boolean;
  onGenerateSku?: (deviceType?: DeviceType) => Promise<string>;
  onDirtyChange?: (dirty: boolean) => void; // reports whether the cart has unsaved items
  persist?: { workspaceId: string; userId: string } | null;
}

const STEPS = ['Items', 'Cart', 'Customer', 'Payment', 'Done'];

export const MobileCheckout: React.FC<Props> = (props) => {
  const cx = useCheckout(props);
  const { onDirtyChange } = props;
  useEffect(() => { onDirtyChange?.(cx.cart.length > 0); }, [cx.cart.length, onDirtyChange]);
  const [step, setStep] = useState(0); // 0..4
  const [pick, setPick] = useState<null | 'device' | 'accessory'>(null);
  const [showCustom, setShowCustom] = useState(false);
  const [txModal, setTxModal] = useState(false);
  // Off by default — same toggle as CartSaleView (item 8 of the layaway-
  // completion batch): a normal full-payment checkout never sees a deposit
  // field unless explicitly switched on.
  const [layawayToggle, setLayawayToggle] = useState(false);
  // Camera fallback for scanning — most stores use a keyboard-wedge scanner
  // gun (handleScan / the "Scan / Add" button just read whatever's already in
  // the text field), but a phone running this mobile flow has no such
  // hardware, only its own camera.
  const [showCamera, setShowCamera] = useState(false);

  // "Similar past sale" price hints per device line — suggestion only, applied on tap.
  const priceHints = React.useMemo(() => {
    const map = new Map<string, PriceSuggestion>();
    for (const l of cx.cart) {
      if (l.kind !== 'device' || l.isCustom || !l.inventoryId) continue;
      const item = props.inventory.find(i => i.id === l.inventoryId);
      if (!item) continue;
      const s = suggestedSalePrice(item, props.inventory);
      if (s) map.set(l.key, s);
    }
    return map;
  }, [cx.cart, props.inventory]);

  const money = (n: number) => `$${(n || 0).toFixed(2)}`;
  const input = 'w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';

  // ---- Step 5: confirmation ----
  if (cx.confirmed && cx.lastTx) {
    const t = cx.lastTx;
    return (
      <div className="flex flex-col items-center text-center gap-4 py-6">
        <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center"><CheckCircle className="w-10 h-10 text-emerald-500" /></div>
        <div>
          <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{t.balanceOwing ? 'Deposit Taken — On Layaway' : 'Sale Complete'}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Receipt <span className="font-mono">{t.id.slice(0, 8)}</span></p>
        </div>
        <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 text-left space-y-1.5 text-sm">
          <div className="divide-y divide-slate-100 dark:divide-slate-800 mb-2">
            {t.lines.map((l, i) => <div key={i} className="flex justify-between py-1.5"><span className="text-slate-700 dark:text-slate-200 truncate">{l.name} <span className="text-slate-400 text-xs">×{l.quantity}</span></span><span className="text-slate-600 dark:text-slate-300">{money(l.quantity * l.unitPrice)}</span></div>)}
          </div>
          <div className="flex justify-between"><span className="text-slate-400">Customer</span><span className="text-slate-700 dark:text-slate-200">{t.customerName || 'Walk-in'}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Payment</span><span className="text-slate-700 dark:text-slate-200">{PAYMENT_METHOD_LABEL[t.paymentMethod || ''] || t.paymentMethod}</span></div>
          <div className="flex justify-between text-base font-bold pt-1"><span>{t.balanceOwing ? 'Total due' : 'Total paid'}</span><span>{money(t.totalPaid)}</span></div>
          {t.balanceOwing ? (
            <>
              <div className="flex justify-between"><span className="text-slate-400">Deposit paid</span><span className="text-slate-700 dark:text-slate-200">{money(t.deposit || 0)}</span></div>
              <div className="flex justify-between font-bold text-sky-600 dark:text-sky-300"><span>Balance owing</span><span>{money(t.balanceOwing)}</span></div>
            </>
          ) : null}
        </div>
        {cx.delistReminders.length > 0 && (
          <div className="w-full max-w-sm bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-500/40 rounded-2xl p-4 text-left text-sm">
            <p className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="w-4 h-4" /> Remember to delist</p>
            <ul className="mt-1.5 space-y-1 text-amber-700/90 dark:text-amber-300/90">
              {cx.delistReminders.map((r, i) => <li key={i}>{r.name} — {listingPlatformsLabel(r.platforms)}</li>)}
            </ul>
          </div>
        )}
        <div className="grid grid-cols-1 gap-2 w-full max-w-sm">
          <button onClick={() => cx.printReceipt()} className="flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold"><Printer className="w-4 h-4" /> Print Receipt</button>
          <button onClick={cx.printInvoice} className="flex items-center justify-center gap-2 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-medium"><FileText className="w-4 h-4" /> Print Invoice</button>
          <button onClick={cx.emailReceipt} className="flex items-center justify-center gap-2 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-medium"><Mail className="w-4 h-4" /> Email Receipt</button>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setTxModal(true)} className="flex items-center justify-center gap-2 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-medium"><Eye className="w-4 h-4" /> View Sale</button>
            <button onClick={() => { cx.reset(); setStep(0); }} className="flex items-center justify-center gap-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium"><RotateCcw className="w-4 h-4" /> New Sale</button>
          </div>
          {cx.soldDeviceRows[0] && <button onClick={() => cx.setLabelItem(cx.soldDeviceRows[0])} className="text-xs text-indigo-600 dark:text-indigo-400 py-1">Print device label</button>}
        </div>
        {cx.labelItem && <Suspense fallback={null}><LabelModal item={cx.labelItem} onClose={() => cx.setLabelItem(null)} /></Suspense>}
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
    : true; // customer name is optional — a blank name checks out as "Walk-in"

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

      {cx.restoreNotice && (
        <div className="mb-3 bg-sky-50 dark:bg-sky-900/20 border border-sky-300 dark:border-sky-500/40 rounded-xl p-3 text-sm flex items-start justify-between gap-2">
          <p className="flex items-center gap-2 text-sky-800 dark:text-sky-300"><AlertTriangle className="w-4 h-4 shrink-0" /> Restored your cart — {cx.restoreNotice}</p>
          <button onClick={() => cx.setRestoreNotice(null)} aria-label="Dismiss" className="text-sky-500 hover:text-sky-700 dark:hover:text-sky-300 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}

      {/* STEP 1: scan / add items */}
      {step === 0 && (
        <div className="space-y-3">
          <div className="relative">
            <ScanLine className="w-5 h-5 text-indigo-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input inputMode="search" value={cx.scan} autoFocus
              onChange={e => { cx.setScan(e.target.value); cx.setScanMsg(null); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); cx.handleScan(cx.scan); } }}
              placeholder="Scan a code, or type a name / repair # to search"
              className="w-full pl-10 pr-11 py-3.5 bg-white dark:bg-slate-900 border-2 border-indigo-200 dark:border-indigo-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            <button type="button" onClick={() => setShowCamera(true)} title="Scan with camera" aria-label="Scan with camera"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-indigo-500 hover:text-indigo-700 dark:hover:text-indigo-300">
              <Camera className="w-5 h-5" />
            </button>
            {cx.scan.trim() && (cx.scanResults.length > 0 || cx.repairMatches.length > 0) && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden">
                {cx.repairMatches.map(r => (
                  <button key={r.id} onClick={() => cx.addRepair(r)}
                    className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border-b border-slate-50 dark:border-slate-800 last:border-0">
                    <span className="min-w-0 flex items-center gap-2">
                      <Wrench className="w-4 h-4 text-emerald-500 shrink-0" />
                      <span className="min-w-0">
                        <span className="block text-sm text-slate-800 dark:text-slate-100 truncate">{r.repairNumber || 'Repair'}{r.customerName ? ` · ${r.customerName}` : ''}</span>
                        <span className="block text-[11px] text-slate-400 truncate">{[r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device'}{r.issue ? ` — ${r.issue}` : ''} · {money(r.repairPrice || 0)}</span>
                      </span>
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">Repair</span>
                  </button>
                ))}
                {cx.scanResults.map(i => (
                  <button key={i.id} onClick={() => cx.addScanResult(i)}
                    className="w-full text-left px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border-b border-slate-50 dark:border-slate-800 last:border-0">
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-800 dark:text-slate-100 truncate">{i.item || getDeviceDisplayName(i)}</span>
                      <span className="block text-[11px] text-slate-400 font-mono truncate">{i.sku || i.imei || i.manufacturerBarcode || ''}{i.kind === 'accessory' ? ` · ${i.quantity ?? 0} in stock` : ''}</span>
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">{(i.kind ?? 'device') === 'device' ? 'Device' : 'Accessory'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {cx.scanMsg && <p className="text-xs text-rose-500">{cx.scanMsg}</p>}
          {/* A phone has no wedge-scanner gun, so the field is normally empty
              here — handleScan('') is a silent no-op (see useCheckout.ts),
              which read as "the button does nothing" / "doesn't open the
              camera" (it never did; that was only the small camera icon
              inside the input above). This is the main, thumb-sized CTA on
              this screen, so it now does what tapping it obviously implies:
              with something typed/wedge-scanned into the field, add that;
              otherwise open the camera directly, same as the icon button. */}
          <button onClick={() => { if (cx.scan.trim()) cx.handleScan(cx.scan); else setShowCamera(true); }} className="w-full flex items-center justify-center gap-2 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-base font-semibold"><ScanLine className="w-5 h-5" /> Scan / Add</button>
          <div className="grid grid-cols-3 gap-2">
            <button onClick={() => { cx.setSearch(''); setPick('device'); }} className="flex flex-col items-center gap-1 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200"><Smartphone className="w-5 h-5 text-indigo-500" /> Device</button>
            <button onClick={() => { cx.setSearch(''); setPick('accessory'); }} className="flex flex-col items-center gap-1 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200"><Package className="w-5 h-5 text-violet-500" /> Accessory</button>
            <button onClick={() => { cx.setCustom(cx.emptyCustom()); setShowCustom(true); }} className="flex flex-col items-center gap-1 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200"><Sparkles className="w-5 h-5 text-amber-500" /> Custom</button>
          </div>
          {cx.cart.length > 0 && (
            <button onClick={() => { if (window.confirm('Clear the whole cart? This removes every item and customer/payment field entered so far.')) cx.reset(); }}
              className="w-full flex items-center justify-center gap-2 py-2 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-medium hover:bg-rose-50 dark:hover:bg-rose-900/20">
              <Trash2 className="w-3.5 h-3.5" /> Clear Cart
            </button>
          )}
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
                <label className="text-xs text-slate-400">Price<input type="number" step="0.01" inputMode="decimal" value={l.unitPrice} onChange={e => cx.updateLine(l.key, { unitPrice: cx.num(e.target.value) })} onFocus={selectOnFocus} className={input} /></label>
                <label className="text-xs text-slate-400">Discount<input type="number" step="0.01" inputMode="decimal" value={l.discount} onChange={e => cx.updateLine(l.key, { discount: cx.num(e.target.value) })} onFocus={selectOnFocus} className={input} /></label>
              </div>
              {priceHints.has(l.key) && (() => { const s = priceHints.get(l.key)!; return (
                <button type="button" onClick={() => cx.updateLine(l.key, { unitPrice: s.price })}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] text-indigo-600 dark:text-indigo-400">
                  <History className="w-3 h-3" /> Similar sold for {money(s.price)} <span className="text-slate-400">· {s.sampleSize} sale{s.sampleSize !== 1 ? 's' : ''} · tap to use</span>
                </button>
              ); })()}
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
          <div className="relative"><User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input value={cx.customerName} onChange={e => { cx.setCustomerName(e.target.value); cx.setSelectedCustomerId(undefined); }} placeholder="Customer name (optional)" className={`${input} pl-9`} /></div>
          <div className="relative"><Phone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input type="tel" inputMode="tel" value={cx.customerPhone} onChange={e => cx.setCustomerPhone(formatPhoneInput(e.target.value))} placeholder="Phone" className={`${input} pl-9`} /></div>
          <div className="relative"><Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" /><input type="email" inputMode="email" value={cx.customerEmail} onChange={e => cx.setCustomerEmail(e.target.value)} placeholder="Email (optional)" className={`${input} pl-9`} /></div>
          <button onClick={() => { cx.setCustomerName('Walk-in'); cx.setCustomerPhone(''); cx.setCustomerEmail(''); cx.setSelectedCustomerId(undefined); next(); }} className="w-full py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-sm font-medium">Continue as Walk-in</button>
        </div>
      )}

      {/* STEP 4: payment */}
      {step === 3 && (
        <div className="space-y-3">
          <label className="block text-sm text-slate-500 dark:text-slate-400">Sale Date
            <input type="date" max={todayISO()} value={cx.soldDate} onChange={e => cx.setSoldDate(e.target.value)} className={input} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <PayBig active={cx.paymentMethod === 'cash'} onClick={() => cx.setPaymentMethod('cash')} icon={<Banknote className="w-6 h-6" />} label="Cash" />
            <PayBig active={cx.paymentMethod === 'card'} onClick={() => cx.setPaymentMethod('card')} icon={<CreditCard className="w-6 h-6" />} label="Card" />
            <PayBig active={cx.paymentMethod === 'etransfer'} onClick={() => cx.setPaymentMethod('etransfer')} icon={<Send className="w-6 h-6" />} label="E-Transfer" />
            <PayBig active={cx.paymentMethod === 'mixed'} onClick={() => cx.setPaymentMethod('mixed')} icon={<Blend className="w-6 h-6" />} label="Mixed" />
          </div>
          {cx.paymentMethod === 'cash' && (
            <label className="block text-sm text-slate-500 dark:text-slate-400">Cash tax status
              <select value={cx.cashTaxStatus === 'none' ? 'none' : 'separate'} onChange={e => cx.setCashTaxStatus(e.target.value as any)} className={input}>
                <option value="separate">Charge tax</option>
                <option value="none">No tax</option>
              </select>
            </label>
          )}
          {cx.paymentMethod === 'etransfer' && (
            <label className="block text-sm text-slate-500 dark:text-slate-400">E-Transfer tax status
              <select value={cx.etransferTaxStatus} onChange={e => cx.setEtransferTaxStatus(e.target.value as any)} className={input}>
                <option value="separate">Charge tax</option>
                <option value="none">No tax</option>
              </select>
            </label>
          )}
          {cx.paymentMethod === 'mixed' && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-400">Cash<input type="number" inputMode="decimal" value={cx.cashAmount} onChange={e => cx.setCashAmount(e.target.value)} onFocus={selectOnFocus} className={input} placeholder="0.00" /></label>
              <label className="text-xs text-slate-400">Card<input type="number" inputMode="decimal" value={cx.cardAmount} onChange={e => cx.setCardAmount(e.target.value)} onFocus={selectOnFocus} className={input} placeholder="0.00" /></label>
              <label className="text-xs text-slate-400">E-Transfer<input type="number" inputMode="decimal" value={cx.etransferAmount} onChange={e => cx.setEtransferAmount(e.target.value)} onFocus={selectOnFocus} className={input} placeholder="0.00" /></label>
              <label className="text-xs text-slate-400">Tax collected<input type="number" inputMode="decimal" value={cx.taxCollected} onChange={e => cx.setTaxCollected(e.target.value)} onFocus={selectOnFocus} className={input} placeholder="0.00" /></label>
            </div>
          )}
          {cx.mixedPaymentMismatch && (
            <p className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Cash + Card + E-transfer ({money(cx.mixedPaymentTotal)}) must add up to the amount being collected ({money(cx.isLayaway ? cx.depositAmount : cx.totalPaid)}).
            </p>
          )}
          <input value={cx.paymentNotes} onChange={e => cx.setPaymentNotes(e.target.value)} placeholder="Payment notes (optional)" className={input} />
          <button type="button" onClick={() => { const next = !layawayToggle; setLayawayToggle(next); if (!next) cx.setDeposit(''); }}
            className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${layawayToggle ? 'bg-sky-50 dark:bg-sky-900/20 border-sky-300 dark:border-sky-700 text-sky-700 dark:text-sky-300' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400'}`}>
            <span className="flex items-center gap-1.5"><HandCoins className="w-3.5 h-3.5" /> Layaway / partial payment</span>
            <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${layawayToggle ? 'bg-sky-600' : 'bg-slate-300 dark:bg-slate-700'}`}>
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${layawayToggle ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
            </span>
          </button>
          {layawayToggle && (
            <label className="block text-sm text-slate-500 dark:text-slate-400">Deposit / partial payment
              <input type="number" inputMode="decimal" min="0" value={cx.deposit} onChange={e => cx.setDeposit(e.target.value)} onFocus={selectOnFocus} placeholder={`Blank if paying in full (${money(cx.totalPaid)})`} className={input} />
            </label>
          )}
          {cx.hasZeroPricedDevice && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-500/40 rounded-xl p-3 text-sm">
              <p className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="w-4 h-4" /> A device has no sale price ($0.00)</p>
              <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-1">Set a price in the cart, or confirm you meant to sell it for $0.</p>
              <label className="flex items-center gap-2 mt-2 text-amber-800 dark:text-amber-300"><input type="checkbox" checked={cx.allowZeroPrice} onChange={e => cx.setAllowZeroPrice(e.target.checked)} className="rounded" /> Sell the $0 device anyway</label>
            </div>
          )}
          {cx.hasListedElsewhereDevice && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-500/40 rounded-xl p-3 text-sm">
              <p className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="w-4 h-4" /> Listed elsewhere</p>
              {cx.cart.filter(l => l.kind === 'device' && (l.listedPlatforms?.length || 0) > 0).map(l => (
                <p key={l.key} className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-1">
                  {l.name} is listed on {listingPlatformsLabel(l.listedPlatforms)}. Confirm it's not already sold there before completing this sale.
                </p>
              ))}
              <label className="flex items-center gap-2 mt-2 text-amber-800 dark:text-amber-300"><input type="checkbox" checked={cx.allowListedElsewhereSale} onChange={e => cx.setAllowListedElsewhereSale(e.target.checked)} className="rounded" /> Confirmed — not already sold elsewhere</label>
            </div>
          )}
          {cx.hasOpenRepairDevice && (
            <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-500/40 rounded-xl p-3 text-sm">
              <p className="flex items-center gap-2 font-semibold text-orange-800 dark:text-orange-300"><Wrench className="w-4 h-4" /> Open repair ticket</p>
              {cx.openRepairLines.map(l => (
                <p key={l.key} className="text-xs text-orange-700/80 dark:text-orange-300/80 mt-1">
                  {l.name} has an open repair ticket {l.openRepairNumber} — confirm the device is complete, or that this is a deliberate as-is sale.
                </p>
              ))}
              <label className="flex items-center gap-2 mt-2 text-orange-800 dark:text-orange-300"><input type="checkbox" checked={cx.allowOpenRepairSale} onChange={e => cx.setAllowOpenRepairSale(e.target.checked)} className="rounded" /> Sell anyway</label>
            </div>
          )}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Subtotal</span><span className="text-slate-800 dark:text-slate-100">{money(cx.subtotal)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Tax</span><span className="text-slate-600 dark:text-slate-300">{money(cx.tax)}</span></div>
            <div className="flex justify-between text-base font-bold border-t border-slate-100 dark:border-slate-800 pt-1.5"><span>{cx.isLayaway ? 'Total Due' : 'Total'}</span><span>{money(cx.totalPaid)}</span></div>
            {cx.isLayaway && (
              <>
                <div className="flex justify-between"><span className="text-slate-500 dark:text-slate-400">Deposit</span><span className="text-slate-600 dark:text-slate-300">{money(cx.depositAmount)}</span></div>
                <div className="flex justify-between font-bold text-sky-600 dark:text-sky-300"><span>Balance Owing</span><span>{money(cx.balanceOwing)}</span></div>
              </>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={cx.printReceiptOnComplete} onChange={e => cx.setPrintReceiptOnComplete(e.target.checked)} className="rounded" />
            <Printer className="w-4 h-4 text-slate-400" /> Print receipt on completion
          </label>
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
          <button onClick={cx.handleCheckout} disabled={cx.isSubmitting || cx.cart.length === 0 || cx.blockedByZeroPrice || cx.blockedByListedElsewhere || cx.blockedByOpenRepair || cx.mixedPaymentMismatch} className="ml-auto px-6 py-3 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-xl text-sm font-semibold flex items-center gap-2"><CheckCircle className="w-4 h-4" /> {cx.isSubmitting ? 'Processing…' : cx.isLayaway ? 'Take Deposit' : 'Complete Sale'}</button>
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
            <label className="text-xs text-slate-400">Category
              <select value={cx.custom.category} onChange={e => cx.setCustom(c => ({ ...c, category: e.target.value as CustomCategory }))} className={input}>
                <option value="device">Device</option>
                <option value="accessory">Accessory</option>
                <option value="service">Service</option>
                <option value="other">Other</option>
              </select></label>
            {cx.custom.category === 'device' && (
              <label className="text-xs text-slate-400">Device type
                <select value={cx.custom.deviceType} onChange={e => cx.setCustom(c => ({ ...c, deviceType: e.target.value as DeviceType }))} className={input}>
                  {CUSTOM_DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select></label>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input type="number" inputMode="decimal" value={cx.custom.unitPrice} onChange={e => cx.setCustom(c => ({ ...c, unitPrice: e.target.value }))} onFocus={selectOnFocus} placeholder="Unit price" className={input} />
            <input type="number" inputMode="numeric" value={cx.custom.quantity} onChange={e => cx.setCustom(c => ({ ...c, quantity: e.target.value }))} placeholder="Qty" className={input} />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={cx.custom.taxable} onChange={e => cx.setCustom(c => ({ ...c, taxable: e.target.checked }))} className="rounded" /> Taxable</label>
          {(cx.custom.category === 'device' || cx.custom.category === 'accessory') && (
            <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={cx.custom.addToInventory} onChange={e => cx.setCustom(c => ({ ...c, addToInventory: e.target.checked }))} className="rounded" /> Add to inventory after sale</label>
          )}
        </div>
      </ResponsiveDialog>

      {showCamera && (
        <Suspense fallback={null}>
          <QRScanner
            onScan={value => cx.handleScan(value)}
            onClose={() => setShowCamera(false)}
          />
        </Suspense>
      )}
    </div>
  );
};

const PayBig: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; label: string }> = ({ active, onClick, icon, label }) => (
  <button onClick={onClick} className={`flex flex-col items-center justify-center gap-2 py-5 rounded-xl border-2 text-sm font-semibold transition-colors ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'}`}>
    {icon}{label}
  </button>
);
