import React, { useState, useEffect } from 'react';
import { ShoppingBag, AlertTriangle, CheckCircle, Camera } from 'lucide-react';
import { InventoryItem, Customer } from '../types';
import { findInventoryMatchByIdentifier, normalizeIdentifier } from '../domain/autoInventory';
import { quickPurchaseImeiError, QuickPurchasePaidBy } from '../domain/quickPurchase';
import { selectOnFocus } from '../hooks/selectOnFocus';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { ImeiScanner } from './ImeiScanner';
import { SellerCustomerField } from './SellerCustomerField';
import { CustomerDraft } from '../domain/customers';

export interface QuickPurchaseSaveInput {
  device: string;
  imei?: string;
  purchaseCost: number;
  paidBy: QuickPurchasePaidBy;
  boughtFrom?: string;
  // Optional link to the customer record for the person we bought from —
  // buyers and sellers are the same people. Left undefined for a one-off
  // seller entered as free text only.
  boughtFromCustomerId?: string;
  boughtFromPhone?: string;
  storage?: string;
  color?: string;
  batteryHealth?: string;
  targetSalePrice?: number;
}

interface Props {
  inventory: InventoryItem[];
  onSave: (input: QuickPurchaseSaveInput) => void;
  customers?: Customer[];
  // Create-and-link a customer without leaving Quick Purchase. Runs the
  // existing phone/email duplicate detection (domain/customers.ts) rather
  // than blindly adding a second record.
  onCreateCustomer?: (draft: CustomerDraft) => Customer | undefined;
}

const inputCls = 'w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
const labelCls = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

const emptyForm = () => ({
  device: '', imei: '', purchaseCost: '', paidBy: 'store' as QuickPurchasePaidBy, boughtFrom: '',
  boughtFromCustomerId: undefined as string | undefined, boughtFromPhone: undefined as string | undefined,
  storage: '', color: '', batteryHealth: '', targetSalePrice: '',
});

// A fast, minimal-friction way to log buying a device with store cash (or
// personal money) at the counter — the buying-side counterpart to Quick
// Sale. Device / Purchase Price / Paid From are the only required fields;
// IMEI/Serial, Storage, Color, Battery Health and Target Sale Price sit on
// the same screen (not a second step) but stay optional — left blank, they
// behave exactly as on the plain Add Item form (fillable later). The full
// Add Item form (InventoryView) stays available for complete specs up front.
export const QuickPurchaseView: React.FC<Props> = ({ inventory, onSave, customers = [], onCreateCustomer }) => {
  const [f, setF] = useState(emptyForm());
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [saved, setSaved] = useState<{ device: string; amount: number } | null>(null);
  const [showImeiScanner, setShowImeiScanner] = useState(false);
  const set = (patch: Partial<ReturnType<typeof emptyForm>>) => setF(prev => ({ ...prev, ...patch }));
  // onSave logs a cash-out and creates an inventory record — a double-tap on
  // "Add to Inventory" before the form visibly clears would do both twice.
  const { isSubmitting, run } = useSubmitGuard();

  const imeiError = quickPurchaseImeiError(f.imei);
  const normalized = normalizeIdentifier(f.imei || '').normalized;
  const duplicate = !imeiError && normalized ? findInventoryMatchByIdentifier(normalized, inventory) : undefined;

  // Confirming a duplicate applies only to the identifier that triggered it —
  // editing the field again (even back to a different duplicate) requires a
  // fresh confirmation rather than silently carrying the old one over.
  useEffect(() => { setConfirmDuplicate(false); }, [normalized]);

  const cost = parseFloat(f.purchaseCost) || 0;
  const canSave = f.device.trim().length > 0 && cost > 0 && !imeiError && (!duplicate || confirmDuplicate);

  const save = () => {
    if (!canSave) return;
    run(() => {
      onSave({
        device: f.device.trim(), imei: f.imei.trim() || undefined, purchaseCost: cost, paidBy: f.paidBy,
        boughtFrom: f.boughtFrom.trim() || undefined,
        boughtFromCustomerId: f.boughtFromCustomerId,
        boughtFromPhone: f.boughtFromPhone,
        storage: f.storage.trim() || undefined, color: f.color.trim() || undefined,
        batteryHealth: f.batteryHealth.trim() || undefined,
        targetSalePrice: parseFloat(f.targetSalePrice) > 0 ? parseFloat(f.targetSalePrice) : undefined,
      });
      setSaved({ device: f.device.trim(), amount: cost });
      setF(emptyForm());
      setConfirmDuplicate(false);
      setTimeout(() => setSaved(null), 3000);
    });
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      <div className="flex items-center gap-2 mb-1">
        <ShoppingBag className="w-6 h-6 text-indigo-500" />
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Quick Purchase</h2>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">Log buying a device at the counter — just the essentials, with optional details if you have them handy. Use the full Add Item form (Inventory) for complete specs, or come back and fill in more detail later.</p>

      {saved && (
        <div className="mb-4 flex items-center gap-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 rounded-xl px-4 py-3 text-sm">
          <CheckCircle className="w-4 h-4 shrink-0" /> Added "{saved.device}" — ${saved.amount.toFixed(2)}.
        </div>
      )}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-4">
        <div>
          <label className={labelCls}>Device</label>
          <input autoFocus className={inputCls} placeholder="e.g. iPhone 13 Pro 256GB" value={f.device} onChange={e => set({ device: e.target.value })} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Purchase Price</label>
            <input type="number" min="0" step="0.01" className={inputCls} placeholder="0.00" value={f.purchaseCost} onChange={e => set({ purchaseCost: e.target.value })} onFocus={selectOnFocus} />
          </div>
          <div>
            <label className={labelCls}>Paid From</label>
            <select className={inputCls} value={f.paidBy} onChange={e => set({ paidBy: e.target.value as QuickPurchasePaidBy })}>
              <option value="store">Store cash</option>
              <option value="personal">Personal / outside store cash</option>
            </select>
          </div>
        </div>
        {cost > 0 && f.paidBy === 'store' && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 -mt-2">Saving will log a ${cost.toFixed(2)} cash-out against today's drawer.</p>
        )}

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">Optional details</p>

          <div className="mb-3">
            <label className={labelCls}>IMEI / Serial</label>
            <div className="flex gap-2">
              <input className={`${inputCls} flex-1 min-w-0`} placeholder="Optional" value={f.imei} onChange={e => set({ imei: e.target.value })} />
              <button type="button" onClick={() => setShowImeiScanner(true)} title="Scan IMEI / serial with camera"
                className="shrink-0 px-3 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-indigo-600 hover:border-indigo-400 transition-colors">
                <Camera className="w-4 h-4" />
              </button>
            </div>
            {imeiError && <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">{imeiError}</p>}
            {duplicate && (
              <div className="mt-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-500/40 rounded-lg p-3 text-xs">
                <p className="flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> Already in inventory</p>
                <p className="text-amber-700/90 dark:text-amber-300/90 mt-1">This IMEI/serial matches {duplicate.sku ? `${duplicate.sku} — ` : ''}{duplicate.item || 'an existing record'} ({duplicate.deviceStatus || 'unknown status'}).</p>
                <label className="flex items-center gap-2 mt-2 text-amber-800 dark:text-amber-300 cursor-pointer">
                  <input type="checkbox" checked={confirmDuplicate} onChange={e => setConfirmDuplicate(e.target.checked)} className="rounded" /> Add anyway — this is a different device / re-entry confirmed
                </label>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={labelCls}>Storage</label>
              <input className={inputCls} placeholder="e.g. 128GB" value={f.storage} onChange={e => set({ storage: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Color</label>
              <input className={inputCls} placeholder="e.g. Midnight" value={f.color} onChange={e => set({ color: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={labelCls}>Battery Health</label>
              <input className={inputCls} placeholder="e.g. 92%" value={f.batteryHealth} onChange={e => set({ batteryHealth: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Target Sale Price</label>
              <input type="number" min="0" step="0.01" className={inputCls} placeholder="0.00" value={f.targetSalePrice} onChange={e => set({ targetSalePrice: e.target.value })} onFocus={selectOnFocus} />
            </div>
          </div>

          <SellerCustomerField
            value={{ boughtFrom: f.boughtFrom, boughtFromCustomerId: f.boughtFromCustomerId, boughtFromPhone: f.boughtFromPhone }}
            onChange={v => set(v)}
            customers={customers}
            onCreateCustomer={onCreateCustomer}
            inputClassName={inputCls}
            labelClassName={labelCls}
          />
        </div>

        <button onClick={save} disabled={!canSave || isSubmitting}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-semibold">
          {isSubmitting ? 'Adding…' : 'Add to Inventory'}
        </button>
      </div>
      {showImeiScanner && (
        <ImeiScanner
          onScan={(imei) => { set({ imei }); setShowImeiScanner(false); }}
          onClose={() => setShowImeiScanner(false)}
        />
      )}
    </div>
  );
};
