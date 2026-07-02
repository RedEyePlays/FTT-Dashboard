import React, { useState, useMemo, useRef } from 'react';
import {
  Search, Smartphone, Package, QrCode, Maximize2, Trash2, X, Plus, ScanLine, AlertTriangle,
} from 'lucide-react';
import { InventoryItem, Runner, ItemKind, DeviceType, DeviceStatus } from '../types';
import { ItemFormModal } from './ItemFormModal';
import { LabelModal } from './LabelModal';

interface Props {
  inventory: InventoryItem[];
  runners: Runner[];
  onSave: (item: InventoryItem) => void;
  onUpdate: (id: string, field: keyof InventoryItem, value: any) => void;
  onDelete: (id: string) => void;
  onGenerateSku: (kind: ItemKind, deviceType?: DeviceType) => string;
}

type Tab = 'all' | 'devices' | 'accessories' | 'sold' | 'lowstock';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().split('T')[0];
const kindOf = (i: InventoryItem): ItemKind => i.kind ?? 'device';
const isSold = (i: InventoryItem) => kindOf(i) === 'device' && (!!i.soldDate || i.deviceStatus === 'sold');
const isLow = (i: InventoryItem) => kindOf(i) === 'accessory' && (i.quantity ?? 0) <= (i.lowStockThreshold ?? 0);
const money = (n?: number) => `$${(n || 0).toFixed(2)}`;

const DEVICE_TYPES: DeviceType[] = ['Phone', 'Tablet', 'Laptop', 'Console', 'Watch', 'Other'];
const CONDITIONS = ['New', 'Like New', 'Excellent', 'Good', 'Fair', 'For Parts'];
const STATUS_OPTS: { value: DeviceStatus; label: string }[] = [
  { value: 'pending_purchase', label: 'Pending Purchase' },
  { value: 'pending_repair', label: 'Pending Repair' },
  { value: 'ready', label: 'Ready for Sale' },
  { value: 'sold', label: 'Sold' },
  { value: 'returned', label: 'Returned' },
];

type ColType = 'text' | 'number' | 'date' | 'select' | 'computed';
interface Col {
  key: keyof InventoryItem | '__total' | '__profit';
  label: string;
  type: ColType;
  w: number;
  align?: 'right';
  options?: { value: string; label: string }[];
  compute?: (i: InventoryItem) => string;
}

const opt = (arr: string[]) => arr.map(v => ({ value: v, label: v }));

const DEVICE_COLS: Col[] = [
  { key: 'date', label: 'Date In', type: 'date', w: 130 },
  { key: 'sku', label: 'SKU', type: 'text', w: 120 },
  { key: 'imei', label: 'IMEI/Serial', type: 'text', w: 150 },
  { key: 'deviceType', label: 'Type', type: 'select', w: 100, options: opt(DEVICE_TYPES) },
  { key: 'brand', label: 'Brand', type: 'text', w: 100 },
  { key: 'model', label: 'Model', type: 'text', w: 140 },
  { key: 'storage', label: 'Storage', type: 'text', w: 90 },
  { key: 'color', label: 'Color', type: 'text', w: 100 },
  { key: 'batteryHealth', label: 'Battery', type: 'text', w: 80 },
  { key: 'condition', label: 'Condition', type: 'select', w: 120, options: opt(CONDITIONS) },
  { key: 'boughtFrom', label: 'Bought From', type: 'text', w: 130 },
  { key: 'purchaseSource', label: 'Source', type: 'text', w: 110 },
  { key: 'purchaseCost', label: 'Purchase', type: 'number', w: 100, align: 'right' },
  { key: 'repairCost', label: 'Repair', type: 'number', w: 90, align: 'right' },
  { key: '__total', label: 'Total Cost', type: 'computed', w: 100, align: 'right', compute: i => money((i.purchaseCost || 0) + (i.repairCost || 0)) },
  { key: 'targetSalePrice', label: 'Target Sale', type: 'number', w: 100, align: 'right' },
  { key: 'deviceStatus', label: 'Status', type: 'select', w: 150, options: STATUS_OPTS },
  { key: 'soldDate', label: 'Date Sold', type: 'date', w: 130 },
  { key: 'soldTo', label: 'Customer', type: 'text', w: 130 },
  { key: '__profit', label: 'Profit', type: 'computed', w: 100, align: 'right', compute: i => i.salePrice ? money(i.salePrice - i.purchaseCost - (i.repairCost || 0)) : '—' },
  { key: 'notes', label: 'Notes', type: 'text', w: 220 },
];

const ACCESSORY_COLS: Col[] = [
  { key: 'date', label: 'Date Added', type: 'date', w: 130 },
  { key: 'sku', label: 'SKU', type: 'text', w: 120 },
  { key: 'manufacturerBarcode', label: 'Barcode', type: 'text', w: 150 },
  { key: 'item', label: 'Item Name', type: 'text', w: 200 },
  { key: 'category', label: 'Category', type: 'text', w: 130 },
  { key: 'quantity', label: 'Quantity', type: 'number', w: 90, align: 'right' },
  { key: 'costPerUnit', label: 'Cost/Unit', type: 'number', w: 100, align: 'right' },
  { key: 'sellingPrice', label: 'Selling Price', type: 'number', w: 110, align: 'right' },
  { key: 'lowStockThreshold', label: 'Low Stock', type: 'number', w: 100, align: 'right' },
  { key: 'notes', label: 'Notes', type: 'text', w: 220 },
];

export const InventoryView: React.FC<Props> = ({ inventory, runners, onSave, onUpdate, onDelete, onGenerateSku }) => {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [expandItem, setExpandItem] = useState<InventoryItem | null>(null);
  const [labelItem, setLabelItem] = useState<InventoryItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => ({
    all: inventory.length,
    devices: inventory.filter(i => kindOf(i) === 'device').length,
    accessories: inventory.filter(i => kindOf(i) === 'accessory').length,
    sold: inventory.filter(isSold).length,
    lowstock: inventory.filter(isLow).length,
  }), [inventory]);

  const matchesQuery = (i: InventoryItem) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return [i.sku, i.manufacturerBarcode, i.imei, i.item, i.brand, i.model]
      .some(v => (v || '').toLowerCase().includes(q));
  };

  const devices = useMemo(() => inventory.filter(i => kindOf(i) === 'device' && matchesQuery(i))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')), [inventory, query]);
  const accessories = useMemo(() => inventory.filter(i => kindOf(i) === 'accessory' && matchesQuery(i))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')), [inventory, query]);

  const soldDevices = devices.filter(isSold);
  const lowAccessories = accessories.filter(isLow);

  const addDeviceRow = () => {
    const sku = onGenerateSku('device', 'Phone');
    onSave({
      id: uid(), kind: 'device', sku, date: today(), item: '', imei: '', boughtFrom: '',
      purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0,
      deviceType: 'Phone', brand: '', model: '', storage: '', color: '', carrier: '',
      batteryHealth: '', condition: 'Good', purchaseSource: '', targetSalePrice: 0,
      deviceStatus: 'ready', notes: '',
    });
    setTab('devices');
  };
  const addAccessoryRow = () => {
    const sku = onGenerateSku('accessory');
    onSave({
      id: uid(), kind: 'accessory', sku, date: today(), item: '', imei: '', boughtFrom: '',
      purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0,
      manufacturerBarcode: '', category: '', quantity: 1, costPerUnit: 0, sellingPrice: 0,
      lowStockThreshold: 3, notes: '',
    });
    setTab('accessories');
  };

  const tabBtn = (id: Tab, label: string, n: number) => (
    <button onClick={() => setTab(id)}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
        tab === id ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
      }`}>
      {label} <span className={`ml-1 text-xs ${tab === id ? 'text-indigo-200' : 'text-slate-400'}`}>{n}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-4 h-full">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Inventory</h1>
        <div className="flex gap-2">
          <button onClick={addDeviceRow} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Smartphone className="w-4 h-4" /> Add Device</button>
          <button onClick={addAccessoryRow} className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400"><Package className="w-4 h-4" /> Add Accessory</button>
        </div>
      </div>

      {/* Scanner-ready search */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input ref={searchRef} autoFocus value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Scan or search by SKU, IMEI, serial, barcode, or name…"
          className="w-full pl-9 pr-28 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[11px] text-slate-400"><ScanLine className="w-3.5 h-3.5" /> scanner ready</span>
        {query && <button onClick={() => { setQuery(''); searchRef.current?.focus(); }} className="absolute right-24 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabBtn('all', 'All', counts.all)}
        {tabBtn('devices', 'Devices', counts.devices)}
        {tabBtn('accessories', 'Accessories', counts.accessories)}
        {tabBtn('sold', 'Sold', counts.sold)}
        {tabBtn('lowstock', 'Low Stock', counts.lowstock)}
      </div>

      {/* Sheets — columns adapt to the tab */}
      <div className="flex-1 flex flex-col gap-6 overflow-auto">
        {(tab === 'all' || tab === 'devices' || tab === 'sold') && (
          <Sheet
            title={tab === 'sold' ? 'Sold Devices' : 'Devices'}
            cols={DEVICE_COLS}
            rows={tab === 'sold' ? soldDevices : devices}
            onUpdate={onUpdate} onDelete={onDelete} onExpand={setExpandItem} onLabel={setLabelItem}
            onAddRow={tab === 'sold' ? undefined : addDeviceRow}
            addLabel="Add Device row"
          />
        )}
        {(tab === 'all' || tab === 'accessories' || tab === 'lowstock') && (
          <Sheet
            title={tab === 'lowstock' ? 'Low Stock Accessories' : 'Accessories'}
            cols={ACCESSORY_COLS}
            rows={tab === 'lowstock' ? lowAccessories : accessories}
            onUpdate={onUpdate} onDelete={onDelete} onExpand={setExpandItem} onLabel={setLabelItem}
            onAddRow={tab === 'lowstock' ? undefined : addAccessoryRow}
            addLabel="Add Accessory row"
            lowFlag
          />
        )}
      </div>

      {expandItem && (
        <ItemFormModal initial={expandItem} runners={runners} onSave={onSave} onGenerateSku={onGenerateSku} onClose={() => setExpandItem(null)} />
      )}
      {labelItem && <LabelModal item={labelItem} onClose={() => setLabelItem(null)} />}
    </div>
  );
};

/* ---------------- Sheet (editable table) ---------------- */

const Sheet: React.FC<{
  title: string;
  cols: Col[];
  rows: InventoryItem[];
  onUpdate: (id: string, field: keyof InventoryItem, value: any) => void;
  onDelete: (id: string) => void;
  onExpand: (i: InventoryItem) => void;
  onLabel: (i: InventoryItem) => void;
  onAddRow?: () => void;
  addLabel: string;
  lowFlag?: boolean;
}> = ({ title, cols, rows, onUpdate, onDelete, onExpand, onLabel, onAddRow, addLabel, lowFlag }) => {
  const cellCls = 'w-full px-2 py-1.5 bg-transparent outline-none text-sm text-slate-700 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 rounded';

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{title} <span className="text-xs font-normal text-slate-400">({rows.length})</span></h3>
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <table className="border-collapse" style={{ minWidth: '100%' }}>
          <thead className="bg-slate-50 dark:bg-slate-800/50 sticky top-0 z-10">
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
              <th className="px-2 py-2 w-24 text-center border-b border-slate-200 dark:border-slate-700">Actions</th>
              {cols.map(c => (
                <th key={String(c.key)} style={{ minWidth: c.w }} className={`px-2 py-2 border-b border-slate-200 dark:border-slate-700 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + 1} className="text-center text-slate-400 text-sm py-8">No items.</td></tr>
            )}
            {rows.map(i => {
              const low = lowFlag && isLow(i);
              return (
                <tr key={i.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${low ? 'bg-rose-50/40 dark:bg-rose-900/10' : ''}`}>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => onLabel(i)} title="Print label" className="p-1 text-slate-400 hover:text-indigo-600 rounded"><QrCode className="w-3.5 h-3.5" /></button>
                      <button onClick={() => onExpand(i)} title="Expanded details" className="p-1 text-slate-400 hover:text-indigo-600 rounded"><Maximize2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => onDelete(i.id)} title="Delete" className="p-1 text-slate-400 hover:text-rose-500 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                  {cols.map(c => (
                    <td key={String(c.key)} style={{ minWidth: c.w }} className="p-0 align-top">
                      {c.type === 'computed' ? (
                        <div className={`px-2 py-1.5 text-sm font-mono ${c.align === 'right' ? 'text-right' : ''} text-slate-500 dark:text-slate-400`}>
                          {c.key === '__profit' && i.salePrice
                            ? <span className={(i.salePrice - i.purchaseCost - (i.repairCost || 0)) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{c.compute!(i)}</span>
                            : c.compute!(i)}
                        </div>
                      ) : c.type === 'select' ? (
                        <select value={(i[c.key as keyof InventoryItem] as any) ?? ''} onChange={e => onUpdate(i.id, c.key as keyof InventoryItem, e.target.value)} className={cellCls}>
                          {c.options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : (
                        <div className="relative">
                          {low && c.key === 'quantity' && <AlertTriangle className="w-3 h-3 text-rose-500 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />}
                          <input
                            type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                            value={(i[c.key as keyof InventoryItem] as any) ?? (c.type === 'number' ? 0 : '')}
                            onChange={e => onUpdate(i.id, c.key as keyof InventoryItem, c.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)}
                            className={`${cellCls} ${c.align === 'right' ? 'text-right font-mono' : ''} ${c.key === 'sku' ? 'font-mono text-xs' : ''} dark:[color-scheme:dark]`}
                          />
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
            {onAddRow && (
              <tr>
                <td colSpan={cols.length + 1} className="px-2 py-2">
                  <button onClick={onAddRow} className="w-full py-2.5 flex items-center justify-center gap-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 dark:hover:text-indigo-400 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-indigo-300 rounded-lg text-sm font-medium">
                    <Plus className="w-4 h-4" /> {addLabel}
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
