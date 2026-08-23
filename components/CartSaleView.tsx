import React from 'react';
import {
  ShoppingCart, Trash2, X, Search, User, Phone, FileText, Mail,
  Banknote, CreditCard, Blend, CheckCircle, Package, Smartphone, ScanLine, History,
  Printer, Eye, RotateCcw, QrCode, Sparkles, AlertTriangle, Wrench,
} from 'lucide-react';
import { InventoryItem, Customer, DeviceType, Repair } from '../types';
import { RepairSalePrefill } from '../domain/repairs';
import { getDeviceDisplayName } from '../domain/inventory';
import { LabelModal } from './LabelModal';
import { PLATFORMS } from '../domain/pos';
import { CustomerSearchInput } from './CustomerSearchInput';
import { useCheckout, CustomCategory, CUSTOM_DEVICE_TYPES } from '../hooks/useCheckout';

export type { CartCheckout } from '../hooks/useCheckout';

interface Props {
  inventory: InventoryItem[];
  customers?: Customer[];
  repairs?: Repair[];           // ready repairs, searchable/selectable in-cart
  initialCustomer?: Customer;   // pre-seed the sale customer (CRM quick action)
  onConsumeInitial?: () => void;
  initialRepair?: RepairSalePrefill;   // pre-seed a repair checkout (Repairs → Check Out)
  onConsumeInitialRepair?: () => void;
  onComplete: (payload: import('../hooks/useCheckout').CartCheckout) => void;
  canViewProfit?: boolean;      // gate cost/profit figures (same pattern as Dashboard)
  onGenerateSku?: (deviceType?: DeviceType) => Promise<string>;
}

// Desktop split-screen Quick Sale. All state / pricing / checkout logic lives in
// useCheckout (shared with the mobile step flow) — this file is presentation.
export const CartSaleView: React.FC<Props> = (props) => {
  const cx = useCheckout(props);
  const canViewProfit = props.canViewProfit ?? true;
  const {
    customers, cart, picker, setPicker, search, setSearch, confirmed,
    platformName, setPlatformName, platformFeePercent, setPlatformFeePercent, soldDate, setSoldDate,
    customerName, setCustomerName, customerPhone, setCustomerPhone, customerEmail, setCustomerEmail,
    customerNotes, setCustomerNotes, setSelectedCustomerId,
    paymentMethod, setPaymentMethod, cashTaxStatus, setCashTaxStatus, paymentNotes, setPaymentNotes,
    cashAmount, setCashAmount, cardAmount, setCardAmount, etransferAmount, setEtransferAmount, taxCollected, setTaxCollected,
    deposit, setDeposit, balanceOwing, isLayaway,
    scan, setScan, scanMsg, scanRef, lastTx, showTx, setShowTx, labelItem, setLabelItem,
    emptyCustom, showCustom, setShowCustom, custom, setCustom,
    taxRate, feePercent, previousPurchases, availableDevices, availableAccessories,
    lineSubtotal, subtotal, purchaseCostTotal, repairCostTotal, totalCost, taxApplies, tax, platformFee, totalPaid, netProfit,
    isZeroPricedDevice, hasZeroPricedDevice, allowZeroPrice, setAllowZeroPrice, blockedByZeroPrice,
    addDevice, addAccessory, updateLine, removeLine, num, addCustomItem, handleScan, handleCheckout, reset, printReceipt, printInvoice, emailReceipt, soldDeviceRows,
    scanResults, addScanResult, repairMatches, addRepair,
    printReceiptOnComplete, setPrintReceiptOnComplete,
  } = cx;

  const inputCls = 'w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
  const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

  if (confirmed && lastTx) {
    return (
      <div className="h-full min-h-[calc(100vh-14rem)] flex flex-col items-center justify-center text-center gap-4">
        <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <CheckCircle className="w-10 h-10 text-emerald-500" />
        </div>
        <div>
          <p className="text-xl font-bold text-slate-800 dark:text-slate-100">{lastTx.balanceOwing ? 'Deposit Taken — On Layaway' : 'Sale Complete!'}</p>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">{lastTx.lines.length} item{lastTx.lines.length !== 1 ? 's' : ''} {lastTx.balanceOwing ? 'reserved for' : 'sold to'} {lastTx.customerName || 'customer'}</p>
        </div>
        <div className="flex gap-6 text-sm">
          {lastTx.balanceOwing ? (
            <>
              <div className="text-center"><p className="text-slate-400 text-xs">Deposit Paid</p><p className="font-bold text-slate-800 dark:text-slate-100">${(lastTx.deposit || 0).toFixed(2)}</p></div>
              <div className="text-center"><p className="text-slate-400 text-xs">Balance Owing</p><p className="font-bold text-sky-600">${lastTx.balanceOwing.toFixed(2)}</p></div>
            </>
          ) : (
            <div className="text-center"><p className="text-slate-400 text-xs">Total Paid</p><p className="font-bold text-slate-800 dark:text-slate-100">${lastTx.totalPaid.toFixed(2)}</p></div>
          )}
          {canViewProfit && <div className="text-center"><p className="text-slate-400 text-xs">Net Profit</p><p className={`font-bold ${lastTx.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>${lastTx.netProfit.toFixed(2)}</p></div>}
        </div>

        <div className="grid grid-cols-2 gap-2 w-full max-w-sm mt-2">
          <button onClick={() => printReceipt()} className="flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Printer className="w-4 h-4" /> Print Receipt</button>
          <button onClick={printInvoice} title="Full-page invoice with your store details — for a business/wholesale buyer"
            className="flex items-center justify-center gap-2 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400"><FileText className="w-4 h-4" /> Print Invoice</button>
          <button onClick={emailReceipt} title={lastTx.customerEmail ? `Email to ${lastTx.customerEmail}` : 'No email captured — opens a blank To: field'}
            className="flex items-center justify-center gap-2 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400"><Mail className="w-4 h-4" /> Email Receipt</button>
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
                  <Row label={lastTx.balanceOwing ? 'Total Due' : 'Total Paid'} value={lastTx.totalPaid} bold />
                  {lastTx.balanceOwing ? <><Row label="Deposit" value={lastTx.deposit || 0} muted /><Row label="Balance Owing" value={lastTx.balanceOwing} /></> : null}
                  {canViewProfit && <Row label="Net Profit" value={lastTx.netProfit} />}
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
            onChange={e => { setScan(e.target.value); cx.setScanMsg(null); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleScan(scan); } }}
            placeholder="Scan a SKU/IMEI/barcode, or type a name / repair # to search"
            className="w-full pl-9 pr-3 py-3 bg-white dark:bg-slate-900 border-2 border-indigo-200 dark:border-indigo-800 rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {/* Typed-search pick-list: substring matches to click-to-add (partial
              matches never auto-add). Exact scans still add instantly on Enter.
              Ready repairs matching the query appear here too, so a repair can be
              checked out straight from Quick Sale. */}
          {scan.trim() && (scanResults.length > 0 || repairMatches.length > 0) && (
            <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl overflow-hidden">
              {repairMatches.map(r => (
                <button key={r.id} onClick={() => addRepair(r)}
                  className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 border-b border-slate-50 dark:border-slate-800 last:border-0">
                  <span className="min-w-0 flex items-center gap-2">
                    <Wrench className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-800 dark:text-slate-100 truncate">{r.repairNumber || 'Repair'}{r.customerName ? ` · ${r.customerName}` : ''}</span>
                      <span className="block text-[11px] text-slate-400 truncate">{[r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device'}{r.issue ? ` — ${r.issue}` : ''} · ${(r.repairPrice || 0).toFixed(2)}</span>
                    </span>
                  </span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">Repair</span>
                </button>
              ))}
              {scanResults.map(i => (
                <button key={i.id} onClick={() => addScanResult(i)}
                  className="w-full text-left px-3 py-2 flex items-center justify-between gap-2 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border-b border-slate-50 dark:border-slate-800 last:border-0">
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
          {cart.map(l => {
            const zeroPrice = isZeroPricedDevice(l);
            return (
            <div key={l.key} className={`bg-white dark:bg-slate-900 border rounded-xl p-4 ${zeroPrice ? 'border-amber-400 dark:border-amber-500/60 ring-1 ring-amber-300/60 dark:ring-amber-500/30' : 'border-slate-200 dark:border-slate-700'}`}>
              <div className="flex items-start gap-3">
                <div className={`mt-1 ${l.isCustom ? 'text-amber-500' : l.kind === 'device' ? 'text-indigo-500' : 'text-violet-500'}`}>{l.isCustom ? <Sparkles className="w-4 h-4" /> : l.kind === 'device' ? <Smartphone className="w-4 h-4" /> : <Package className="w-4 h-4" />}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate flex items-center gap-2">{l.name}
                    {l.isCustom && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">Custom · {l.category}</span>}
                    {zeroPrice && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> No price</span>}
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
          );})}
        </div>
      </div>

      {/* Right: checkout */}
      <div className="w-full lg:w-96 shrink-0 flex flex-col gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-2 text-sm">
          <Row label="Subtotal" value={subtotal} />
          <Row label={`Tax${taxApplies ? ` (${taxRate}%)` : ' (none)'}`} value={tax} muted />
          <Row label={`Platform fee${feePercent ? ` (${feePercent}%)` : ''}`} value={-platformFee} muted />
          <div className="border-t border-slate-100 dark:border-slate-800 my-1" />
          <Row label={isLayaway ? 'Total Due' : 'Total Paid'} value={totalPaid} bold />
          {isLayaway && (
            <>
              <Row label="Deposit" value={cx.depositAmount} muted />
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sky-700 dark:text-sky-300">Balance Owing</span>
                <span className="font-bold text-sky-700 dark:text-sky-300">${balanceOwing.toFixed(2)}</span>
              </div>
            </>
          )}
          {canViewProfit && (
            <>
              <Row label="Purchase Cost" value={purchaseCostTotal} muted />
              <Row label="Repair Cost" value={repairCostTotal} muted />
              <Row label="Total Cost" value={totalCost} muted />
              <div className="flex items-center justify-between pt-1">
                <span className="font-semibold text-slate-700 dark:text-slate-200">Net Profit</span>
                <span className={`text-lg font-bold ${netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>${netProfit.toFixed(2)}</span>
              </div>
            </>
          )}
        </div>

        {/* Customer */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Customer</p>
          {customers.length > 0 && (
            <CustomerSearchInput customers={customers} placeholder="Find existing customer…"
              onSelect={c => { setCustomerName(c.name); setCustomerPhone(c.phone || ''); setCustomerEmail(c.email || ''); setSelectedCustomerId(c.id); }} />
          )}
          <IconInput icon={<User className="w-4 h-4" />} placeholder="Customer name (optional — defaults to Walk-in)" value={customerName} onChange={v => { setCustomerName(v); setSelectedCustomerId(undefined); }} />
          <IconInput icon={<Phone className="w-4 h-4" />} placeholder="Phone number" value={customerPhone} onChange={setCustomerPhone} />
          <IconInput icon={<Mail className="w-4 h-4" />} placeholder="Email (optional)" value={customerEmail} onChange={setCustomerEmail} />
          <IconInput icon={<FileText className="w-4 h-4" />} placeholder="Customer notes" value={customerNotes} onChange={setCustomerNotes} />
          {previousPurchases.length > 0 && (
            <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-2 text-xs text-indigo-700 dark:text-indigo-300">
              <p className="font-semibold flex items-center gap-1"><History className="w-3 h-3" /> {previousPurchases.length} previous purchase{previousPurchases.length !== 1 ? 's' : ''}</p>
              <ul className="mt-1 space-y-0.5 text-indigo-600/80 dark:text-indigo-300/80">
                {previousPurchases.slice(0, 4).map(p => <li key={p.id} className="truncate">{p.soldDate}: {getDeviceDisplayName(p)} — ${(p.salePrice || 0).toFixed(2)}</li>)}
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
          <div>
            <label className={labelCls}>Deposit / partial payment (optional)</label>
            <input type="number" step="0.01" min="0" className={inputCls} value={deposit} onChange={e => setDeposit(e.target.value)} placeholder={`Leave blank if paying in full ($${totalPaid.toFixed(2)})`} />
            {isLayaway && (
              <div className="mt-2 flex items-center justify-between rounded-lg bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-500/30 px-3 py-2 text-sm">
                <span className="font-semibold text-sky-700 dark:text-sky-300">Balance owing (layaway)</span>
                <span className="font-bold text-sky-700 dark:text-sky-300">${balanceOwing.toFixed(2)}</span>
              </div>
            )}
          </div>
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

        {hasZeroPricedDevice && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-500/40 rounded-xl p-3 text-sm">
            <p className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="w-4 h-4" /> A device has no sale price ($0.00)</p>
            <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-1">Set a price on the flagged line, or confirm you meant to sell it for $0.</p>
            <label className="flex items-center gap-2 mt-2 text-amber-800 dark:text-amber-300 cursor-pointer">
              <input type="checkbox" checked={allowZeroPrice} onChange={e => setAllowZeroPrice(e.target.checked)} className="rounded" />
              Sell the $0 device anyway
            </label>
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
          <input type="checkbox" checked={printReceiptOnComplete} onChange={e => setPrintReceiptOnComplete(e.target.checked)} className="rounded" />
          <Printer className="w-3.5 h-3.5 text-slate-400" /> Print receipt on completion
        </label>

        <button onClick={handleCheckout} disabled={cart.length === 0 || blockedByZeroPrice}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
          <ShoppingCart className="w-4 h-4" /> {isLayaway ? `Take Deposit · $${cx.depositAmount.toFixed(2)}` : `Complete Sale · $${totalPaid.toFixed(2)}`}
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
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{getDeviceDisplayName(i)}</p>
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
              {custom.category === 'device' && (
                <div><label className={labelCls}>Device Type</label>
                  <select className={inputCls} value={custom.deviceType} onChange={e => setCustom(c => ({ ...c, deviceType: e.target.value as DeviceType }))}>
                    {CUSTOM_DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select></div>
              )}
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
