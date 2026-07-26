import React, { useState } from 'react';
import { X, Wand2, Smartphone, Package, Barcode, Camera } from 'lucide-react';
import { InventoryItem, ItemKind, DeviceType, DeviceStatus, Runner } from '../types';
import { ImeiScanner } from './ImeiScanner';

interface Props {
  initial?: InventoryItem;
  initialKind?: ItemKind;
  runners: Runner[];
  onSave: (item: InventoryItem) => void;
  onGenerateSku: (kind: ItemKind, deviceType?: DeviceType) => Promise<string>;
  onClose: () => void;
}

const DEVICE_TYPES: DeviceType[] = ['Phone', 'Tablet', 'Laptop', 'Console', 'Watch', 'Other'];
const DEVICE_STATUSES: { value: DeviceStatus; label: string }[] = [
  { value: 'pending_purchase', label: 'Pending Purchase' },
  { value: 'pending_repair', label: 'Pending Repair' },
  { value: 'ready', label: 'Ready for Sale' },
  { value: 'sold', label: 'Sold' },
  { value: 'returned', label: 'Returned' },
];
const CONDITIONS = ['New', 'Like New', 'Excellent', 'Good', 'Fair', 'For Parts'];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().split('T')[0];

export const ItemFormModal: React.FC<Props> = ({ initial, initialKind, runners, onSave, onGenerateSku, onClose }) => {
  const [kind, setKind] = useState<ItemKind>(initial?.kind ?? initialKind ?? 'device');
  const [f, setF] = useState<InventoryItem>(() => initial ?? {
    id: uid(), kind: initialKind ?? 'device', sku: '', manufacturerBarcode: '',
    date: today(), item: '', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
    soldDate: '', soldTo: '', salePrice: 0, notes: '',
    deviceType: 'Phone', brand: '', model: '', storage: '', color: '', carrier: '',
    batteryHealth: '', condition: 'Good', purchaseSource: '', targetSalePrice: 0,
    deviceStatus: 'ready', quantity: 1, costPerUnit: 0, sellingPrice: 0, lowStockThreshold: 3,
  });

  const set = <K extends keyof InventoryItem>(k: K, v: InventoryItem[K]) => setF(p => ({ ...p, [k]: v }));
  const [showImeiScanner, setShowImeiScanner] = useState(false);

  const genSku = async () => set('sku', await onGenerateSku(kind, f.deviceType));

  const save = () => {
    const item: InventoryItem = { ...f, kind };
    if (kind === 'accessory') {
      // Accessories derive item-level cost/price from per-unit fields
      item.purchaseCost = (f.costPerUnit || 0) * (f.quantity || 0);
      item.deviceStatus = undefined;
      item.imei = '';
    } else {
      item.item = f.item || [f.brand, f.model, f.storage].filter(Boolean).join(' ');
    }
    onSave(item);
    onClose();
  };

  const inp = 'w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500';
  const lbl = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

  const canSave = kind === 'device' ? !!(f.item || f.brand || f.model) : !!f.item;

  const Field = ({ label, k, type = 'text', placeholder = '' }: { label: string; k: keyof InventoryItem; type?: string; placeholder?: string }) => (
    <div>
      <label className={lbl}>{label}</label>
      <input type={type} className={inp} placeholder={placeholder}
        value={(f[k] as any) ?? ''}
        onChange={e => set(k, (type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value) as any)} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl border border-slate-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto custom-scrollbar" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center sticky top-0 bg-white dark:bg-slate-900 z-10">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">{initial ? 'Edit Item' : 'Add Item'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Kind toggle */}
          {!initial && (
            <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
              <button onClick={() => setKind('device')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium ${kind === 'device' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500'}`}>
                <Smartphone className="w-4 h-4" /> Device
              </button>
              <button onClick={() => setKind('accessory')} className={`flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium ${kind === 'accessory' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500'}`}>
                <Package className="w-4 h-4" /> Accessory
              </button>
            </div>
          )}

          {/* SKU + barcode */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Internal SKU</label>
              <div className="flex gap-2">
                <input className={inp} value={f.sku ?? ''} onChange={e => set('sku', e.target.value)} placeholder="Auto or manual" />
                <button onClick={genSku} title="Generate SKU" className="shrink-0 px-3 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white"><Wand2 className="w-4 h-4" /></button>
              </div>
            </div>
            <div>
              <label className={lbl}>{kind === 'device' ? 'IMEI / Serial' : 'Manufacturer Barcode (optional)'}</label>
              {kind === 'device' ? (
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Barcode className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                    <input className={`${inp} pl-8`} value={f.imei} onChange={e => set('imei', e.target.value)} />
                  </div>
                  <button type="button" onClick={() => setShowImeiScanner(true)} title="Scan IMEI / serial with camera"
                    className="shrink-0 px-3 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-indigo-600 hover:border-indigo-400 transition-colors">
                    <Camera className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Barcode className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input className={`${inp} pl-8`} value={f.manufacturerBarcode ?? ''} onChange={e => set('manufacturerBarcode', e.target.value)} />
                </div>
              )}
            </div>
          </div>

          {kind === 'device' ? (
            <>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className={lbl}>Device Type</label>
                  <select className={inp} value={f.deviceType} onChange={e => set('deviceType', e.target.value as DeviceType)}>
                    {DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <Field label="Brand" k="brand" placeholder="Apple" />
                <Field label="Model" k="model" placeholder="iPhone 14 Pro" />
                <Field label="Storage" k="storage" placeholder="256GB" />
                <Field label="Color" k="color" placeholder="Space Black" />
                <Field label="Carrier" k="carrier" placeholder="Unlocked" />
                <Field label="Battery Health" k="batteryHealth" placeholder="92%" />
                <div>
                  <label className={lbl}>Condition</label>
                  <select className={inp} value={f.condition} onChange={e => set('condition', e.target.value)}>
                    {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Status</label>
                  <select className={inp} value={f.deviceStatus} onChange={e => set('deviceStatus', e.target.value as DeviceStatus)}>
                    {DEVICE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <Field label="Item Name (override)" k="item" placeholder="Auto from brand/model" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Bought From (seller)" k="boughtFrom" />
                <Field label="Purchase Source (channel)" k="purchaseSource" placeholder="Marketplace" />
                <div>
                  <label className={lbl}>Runner (drop-off)</label>
                  <select className={inp} value={f.runnerId ?? ''} onChange={e => {
                    const r = runners.find(x => x.id === e.target.value);
                    set('runnerId', e.target.value || undefined); set('runnerName', r?.name);
                  }}>
                    <option value="">— none —</option>
                    {runners.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <Field label="Purchase Price ($)" k="purchaseCost" type="number" />
                <Field label="Repair Cost ($)" k="repairCost" type="number" />
                <Field label="Target Sale Price ($)" k="targetSalePrice" type="number" />
                <Field label="Date In" k="date" type="date" />
              </div>
            </>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2"><Field label="Item Name" k="item" placeholder="Lightning Cable 1m" /></div>
              <Field label="Category" k="category" placeholder="Cables" />
              <Field label="Quantity" k="quantity" type="number" />
              <Field label="Cost / Unit ($)" k="costPerUnit" type="number" />
              <Field label="Selling Price ($)" k="sellingPrice" type="number" />
              <Field label="Low Stock Threshold" k="lowStockThreshold" type="number" />
              <Field label="Purchase Date" k="date" type="date" />
              <Field label="Bought From" k="boughtFrom" />
            </div>
          )}

          <div>
            <label className={lbl}>Notes</label>
            <textarea className={inp} rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 sticky bottom-0 bg-white dark:bg-slate-900">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={save} disabled={!canSave} className="px-5 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium">Save</button>
        </div>
      </div>

      {showImeiScanner && (
        <ImeiScanner
          onScan={(imei) => { set('imei', imei); setShowImeiScanner(false); }}
          onClose={() => setShowImeiScanner(false)}
        />
      )}
    </div>
  );
};
