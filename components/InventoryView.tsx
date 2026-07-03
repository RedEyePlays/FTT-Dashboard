import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search, Smartphone, Package, QrCode, Maximize2, Trash2, X, Plus, ScanLine, AlertTriangle,
  Columns3, SlidersHorizontal, Bookmark, Download, Upload, Copy, ChevronUp, ChevronDown,
  Activity as ActivityIcon, CheckSquare, Square, DollarSign, Boxes, TrendingUp, Wrench,
  BadgeCheck, ShoppingBag,
} from 'lucide-react';
import { InventoryItem, Runner, ItemKind, DeviceType, DeviceStatus, ActivityEntry } from '../types';
import { ItemFormModal } from './ItemFormModal';
import { LabelModal } from './LabelModal';

interface Props {
  inventory: InventoryItem[];
  runners: Runner[];
  activity: ActivityEntry[];
  onSave: (item: InventoryItem) => void;
  onUpdate: (id: string, field: keyof InventoryItem, value: any) => void;
  onDelete: (id: string) => void;
  onGenerateSku: (kind: ItemKind, deviceType?: DeviceType) => string;
  onSeed?: () => void;
}

type Tab = 'all' | 'devices' | 'accessories' | 'sold' | 'lowstock';
interface Sort { key: string; dir: 'asc' | 'desc'; }
interface SavedView { name: string; tab: Tab; query: string; sort: Sort | null; statusFilter: string; hidden: Record<'device' | 'accessory', string[]>; }

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => new Date().toISOString().split('T')[0];
const kindOf = (i: InventoryItem): ItemKind => i.kind ?? 'device';
const isSold = (i: InventoryItem) => kindOf(i) === 'device' && (!!i.soldDate || i.deviceStatus === 'sold');
const isLow = (i: InventoryItem) => kindOf(i) === 'accessory' && (i.quantity ?? 0) <= (i.lowStockThreshold ?? 0);
const money = (n?: number) => `$${(n || 0).toFixed(2)}`;
const totalCost = (i: InventoryItem) => (i.purchaseCost || 0) + (i.repairCost || 0);
const profitOf = (i: InventoryItem) => i.salePrice ? i.salePrice - i.purchaseCost - (i.repairCost || 0) : 0;

const DEVICE_TYPES: DeviceType[] = ['Phone', 'Tablet', 'Laptop', 'Console', 'Watch', 'Other'];
const CONDITIONS = ['New', 'Like New', 'Excellent', 'Good', 'Fair', 'For Parts'];
const STATUS_OPTS: { value: DeviceStatus; label: string }[] = [
  { value: 'pending_purchase', label: 'Pending Purchase' },
  { value: 'pending_repair', label: 'Pending Repair' },
  { value: 'ready', label: 'Ready for Sale' },
  { value: 'sold', label: 'Sold' },
  { value: 'returned', label: 'Returned' },
];
const STATUS_CELL: Record<DeviceStatus, string> = {
  pending_purchase: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  pending_repair: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  sold: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  returned: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
};

type ColType = 'text' | 'number' | 'date' | 'select' | 'computed';
interface Col { key: string; label: string; type: ColType; w: number; align?: 'right'; options?: { value: string; label: string }[]; compute?: (i: InventoryItem) => string; sortVal?: (i: InventoryItem) => number | string; }
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
  { key: '__total', label: 'Total Cost', type: 'computed', w: 100, align: 'right', compute: i => money(totalCost(i)), sortVal: totalCost },
  { key: 'targetSalePrice', label: 'Target Sale', type: 'number', w: 100, align: 'right' },
  { key: 'deviceStatus', label: 'Status', type: 'select', w: 150, options: STATUS_OPTS },
  { key: 'soldDate', label: 'Date Sold', type: 'date', w: 130 },
  { key: 'soldTo', label: 'Customer', type: 'text', w: 130 },
  { key: '__profit', label: 'Profit', type: 'computed', w: 100, align: 'right', compute: i => i.salePrice ? money(profitOf(i)) : '—', sortVal: profitOf },
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

const LS_HIDDEN = 'inv_hidden_cols_v1';
const LS_VIEWS = 'inv_saved_views_v1';
const loadLS = <T,>(k: string, fb: T): T => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };

// --- CSV helpers ---
const toCSV = (rows: InventoryItem[], cols: Col[]): string => {
  const headers = ['kind', ...cols.filter(c => c.type !== 'computed').map(c => c.key)];
  const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map(r => headers.map(h => esc(h === 'kind' ? kindOf(r) : (r as any)[h])).join(','));
  return [headers.join(','), ...lines].join('\n');
};
const parseCSV = (text: string): Record<string, string>[] => {
  const rows: string[][] = [];
  let cur: string[] = [], val = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { val += '"'; i++; } else q = false; } else val += c; }
    else if (c === '"') q = true;
    else if (c === ',') { cur.push(val); val = ''; }
    else if (c === '\n' || c === '\r') { if (val !== '' || cur.length) { cur.push(val); rows.push(cur); cur = []; val = ''; } }
    else val += c;
  }
  if (val !== '' || cur.length) { cur.push(val); rows.push(cur); }
  const header = rows.shift(); if (!header) return [];
  return rows.filter(r => r.some(x => x !== '')).map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i] ?? ''])));
};

export const InventoryView: React.FC<Props> = ({ inventory, runners, activity, onSave, onUpdate, onDelete, onGenerateSku, onSeed }) => {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Record<'device' | 'accessory', string[]>>(() => loadLS(LS_HIDDEN, { device: [], accessory: [] }));
  const [views, setViews] = useState<SavedView[]>(() => loadLS(LS_VIEWS, []));
  const [menu, setMenu] = useState<null | 'cols' | 'views' | 'filter'>(null);
  const [expandItem, setExpandItem] = useState<InventoryItem | null>(null);
  const [labelItem, setLabelItem] = useState<InventoryItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { localStorage.setItem(LS_HIDDEN, JSON.stringify(hidden)); }, [hidden]);
  useEffect(() => { localStorage.setItem(LS_VIEWS, JSON.stringify(views)); }, [views]);

  const summary = useMemo(() => {
    const devices = inventory.filter(i => kindOf(i) === 'device');
    const accessories = inventory.filter(i => kindOf(i) === 'accessory');
    const invCost = inventory.reduce((s, i) => s + (kindOf(i) === 'accessory' ? (i.costPerUnit || 0) * (i.quantity || 0) : totalCost(i)), 0);
    const retail = inventory.reduce((s, i) => s + (kindOf(i) === 'accessory' ? (i.sellingPrice || 0) * (i.quantity || 0) : (i.targetSalePrice || 0)), 0);
    return {
      totalDevices: devices.length,
      invCost, retail,
      ready: devices.filter(i => i.deviceStatus === 'ready').length,
      pendingRepair: devices.filter(i => i.deviceStatus === 'pending_repair').length,
      sold: inventory.filter(isSold).length,
      low: accessories.filter(isLow).length,
    };
  }, [inventory]);

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
    return [i.sku, i.manufacturerBarcode, i.imei, i.item, i.brand, i.model].some(v => (v || '').toLowerCase().includes(q));
  };

  const applySort = (rows: InventoryItem[], cols: Col[]) => {
    if (!sort) return rows;
    const col = cols.find(c => c.key === sort.key);
    if (!col) return rows;
    const val = (i: InventoryItem) => col.sortVal ? col.sortVal(i) : ((i as any)[sort.key] ?? '');
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  };

  const devices = useMemo(() => {
    let r = inventory.filter(i => kindOf(i) === 'device' && matchesQuery(i));
    if (statusFilter !== 'all') r = r.filter(i => i.deviceStatus === statusFilter);
    r = r.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return applySort(r, DEVICE_COLS);
  }, [inventory, query, statusFilter, sort]);
  const accessories = useMemo(() => {
    let r = inventory.filter(i => kindOf(i) === 'accessory' && matchesQuery(i)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return applySort(r, ACCESSORY_COLS);
  }, [inventory, query, sort]);

  const soldDevices = devices.filter(isSold);
  const lowAccessories = accessories.filter(isLow);
  const lowAll = useMemo(() => inventory.filter(isLow), [inventory]);

  // --- actions ---
  const addDeviceRow = () => {
    const sku = onGenerateSku('device', 'Phone');
    onSave({ id: uid(), kind: 'device', sku, date: today(), item: '', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, deviceType: 'Phone', brand: '', model: '', storage: '', color: '', carrier: '', batteryHealth: '', condition: 'Good', purchaseSource: '', targetSalePrice: 0, deviceStatus: 'ready', notes: '' });
    setTab('devices');
  };
  const addAccessoryRow = () => {
    const sku = onGenerateSku('accessory');
    onSave({ id: uid(), kind: 'accessory', sku, date: today(), item: '', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, manufacturerBarcode: '', category: '', quantity: 1, costPerUnit: 0, sellingPrice: 0, lowStockThreshold: 3, notes: '' });
    setTab('accessories');
  };
  const duplicate = (i: InventoryItem) => {
    const k = kindOf(i);
    const sku = onGenerateSku(k, i.deviceType);
    onSave({ ...i, id: uid(), sku, soldDate: '', soldTo: '', salePrice: 0, deviceStatus: k === 'device' ? 'ready' : i.deviceStatus });
  };
  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelAll = (rows: InventoryItem[]) => setSelected(s => {
    const allSel = rows.every(r => s.has(r.id));
    const n = new Set(s); rows.forEach(r => allSel ? n.delete(r.id) : n.add(r.id)); return n;
  });
  const bulkDelete = () => { selected.forEach(id => onDelete(id)); setSelected(new Set()); };
  const bulkStatus = (status: DeviceStatus) => { selected.forEach(id => { const it = inventory.find(x => x.id === id); if (it && kindOf(it) === 'device') onUpdate(id, 'deviceStatus', status); }); };

  const exportCSV = (rows: InventoryItem[], cols: Col[], name: string) => {
    const blob = new Blob([toCSV(rows, cols)], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}_${today()}.csv`; a.click();
  };
  const exportAll = () => exportCSV(inventory, [...DEVICE_COLS, ...ACCESSORY_COLS], 'inventory');
  const importCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      const rows = parseCSV(String(e.target?.result || ''));
      rows.forEach(r => {
        const k: ItemKind = (r.kind === 'accessory') ? 'accessory' : 'device';
        const num = (v: string) => parseFloat(v) || 0;
        const base: InventoryItem = {
          id: uid(), kind: k, sku: r.sku || onGenerateSku(k, (r.deviceType as DeviceType) || undefined),
          date: r.date || today(), item: r.item || '', imei: r.imei || '', boughtFrom: r.boughtFrom || '',
          purchaseCost: num(r.purchaseCost), repairCost: num(r.repairCost), soldDate: r.soldDate || '',
          soldTo: r.soldTo || '', salePrice: num(r.salePrice), notes: r.notes || '',
          ...(k === 'device' ? {
            deviceType: (r.deviceType as DeviceType) || 'Phone', brand: r.brand, model: r.model, storage: r.storage,
            color: r.color, batteryHealth: r.batteryHealth, condition: r.condition || 'Good', purchaseSource: r.purchaseSource,
            targetSalePrice: num(r.targetSalePrice), deviceStatus: (r.deviceStatus as DeviceStatus) || 'ready',
          } : {
            manufacturerBarcode: r.manufacturerBarcode, category: r.category, quantity: num(r.quantity),
            costPerUnit: num(r.costPerUnit), sellingPrice: num(r.sellingPrice), lowStockThreshold: num(r.lowStockThreshold) || 3,
          }),
        };
        onSave(base);
      });
    };
    reader.readAsText(file);
  };

  const saveView = () => {
    const name = prompt('Save current view as:');
    if (!name) return;
    setViews(v => [...v.filter(x => x.name !== name), { name, tab, query, sort, statusFilter, hidden }]);
  };
  const applyView = (v: SavedView) => { setTab(v.tab); setQuery(v.query); setSort(v.sort); setStatusFilter(v.statusFilter); setHidden(v.hidden); setMenu(null); };

  const onSortToggle = (key: string) => setSort(s => s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' });
  const toggleCol = (kind: 'device' | 'accessory', key: string) =>
    setHidden(h => ({ ...h, [kind]: h[kind].includes(key) ? h[kind].filter(k => k !== key) : [...h[kind], key] }));

  const visCols = (kind: 'device' | 'accessory', cols: Col[]) => cols.filter(c => !hidden[kind].includes(c.key));

  const tabBtn = (id: Tab, label: string, n: number) => (
    <button onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${tab === id ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'}`}>
      {label} <span className={`ml-1 text-xs ${tab === id ? 'text-indigo-200' : 'text-slate-400'}`}>{n}</span>
    </button>
  );

  const card = (icon: React.ReactNode, label: string, value: string, accent: string) => (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 flex items-center gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${accent}`}>{icon}</div>
      <div className="min-w-0"><p className="text-[11px] text-slate-400 uppercase tracking-wide truncate">{label}</p><p className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-tight">{value}</p></div>
    </div>
  );

  if (inventory.length === 0) {
    return (
      <div className="h-full min-h-[60vh] flex flex-col items-center justify-center text-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center"><Boxes className="w-8 h-8 text-slate-300" /></div>
        <div>
          <p className="text-lg font-bold text-slate-800 dark:text-slate-100">No inventory yet</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Add your first device or accessory, or load sample data to explore.</p>
        </div>
        <div className="flex gap-2 flex-wrap justify-center">
          <button onClick={addDeviceRow} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Smartphone className="w-4 h-4" /> Add Device</button>
          <button onClick={addAccessoryRow} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium"><Package className="w-4 h-4" /> Add Accessory</button>
          {onSeed && <button onClick={onSeed} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-300 rounded-lg text-sm font-medium"><Boxes className="w-4 h-4" /> Load Sample Data</button>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full" onClick={() => menu && setMenu(null)}>
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {card(<Boxes className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />, 'Total Devices', String(summary.totalDevices), 'bg-indigo-100 dark:bg-indigo-900/30')}
        {card(<DollarSign className="w-4 h-4 text-slate-600 dark:text-slate-300" />, 'Inventory Cost', money(summary.invCost), 'bg-slate-100 dark:bg-slate-800')}
        {card(<TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />, 'Est. Retail', money(summary.retail), 'bg-emerald-100 dark:bg-emerald-900/30')}
        {card(<BadgeCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />, 'Ready', String(summary.ready), 'bg-emerald-100 dark:bg-emerald-900/30')}
        {card(<Wrench className="w-4 h-4 text-orange-600 dark:text-orange-400" />, 'Pending Repair', String(summary.pendingRepair), 'bg-orange-100 dark:bg-orange-900/30')}
        {card(<ShoppingBag className="w-4 h-4 text-slate-600 dark:text-slate-300" />, 'Sold', String(summary.sold), 'bg-slate-100 dark:bg-slate-800')}
        {card(<AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400" />, 'Low Stock', String(summary.low), 'bg-rose-100 dark:bg-rose-900/30')}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Scan or search by SKU, IMEI, serial, barcode, or name…"
            className="w-full pl-9 pr-24 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[11px] text-slate-400"><ScanLine className="w-3.5 h-3.5" /> scanner ready</span>
        </div>

        {/* Filter */}
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button onClick={() => setMenu(menu === 'filter' ? null : 'filter')} className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400"><SlidersHorizontal className="w-4 h-4" /> Filters{statusFilter !== 'all' && <span className="w-2 h-2 rounded-full bg-indigo-500" />}</button>
          {menu === 'filter' && (
            <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-30 p-3">
              <p className="text-xs font-semibold text-slate-500 mb-1">Device Status</p>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm">
                <option value="all">All statuses</option>
                {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}
        </div>

        {/* Columns */}
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button onClick={() => setMenu(menu === 'cols' ? null : 'cols')} className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400"><Columns3 className="w-4 h-4" /> Columns</button>
          {menu === 'cols' && (
            <div className="absolute right-0 mt-1 w-64 max-h-80 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-30 p-3 space-y-2">
              {(['device', 'accessory'] as const).map(k => (
                <div key={k}>
                  <p className="text-xs font-semibold text-slate-500 mb-1 capitalize">{k}s</p>
                  {(k === 'device' ? DEVICE_COLS : ACCESSORY_COLS).map(c => (
                    <label key={c.key} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer text-slate-600 dark:text-slate-300">
                      <input type="checkbox" checked={!hidden[k].includes(c.key)} onChange={() => toggleCol(k, c.key)} className="rounded" /> {c.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Saved views */}
        <div className="relative" onClick={e => e.stopPropagation()}>
          <button onClick={() => setMenu(menu === 'views' ? null : 'views')} className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400"><Bookmark className="w-4 h-4" /> Views</button>
          {menu === 'views' && (
            <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-30 p-2">
              <button onClick={saveView} className="w-full text-left px-2 py-1.5 text-sm rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-indigo-600"><Plus className="w-4 h-4" /> Save current view</button>
              {views.length === 0 && <p className="text-xs text-slate-400 px-2 py-2">No saved views</p>}
              {views.map(v => (
                <div key={v.name} className="flex items-center justify-between px-2 py-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800">
                  <button onClick={() => applyView(v)} className="text-sm text-slate-700 dark:text-slate-200 truncate flex-1 text-left">{v.name}</button>
                  <button onClick={() => setViews(vs => vs.filter(x => x.name !== v.name))} className="text-slate-400 hover:text-rose-500"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        <button onClick={exportAll} title="Export CSV" className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400"><Download className="w-4 h-4" /></button>
        <button onClick={() => fileRef.current?.click()} title="Import CSV" className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400"><Upload className="w-4 h-4" /></button>
        <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => e.target.files?.[0] && importCSV(e.target.files[0])} />

        <button onClick={addDeviceRow} className="flex items-center gap-2 px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Smartphone className="w-4 h-4" /> Add Device</button>
        <button onClick={addAccessoryRow} className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400"><Package className="w-4 h-4" /> Add Accessory</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabBtn('all', 'All', counts.all)}
        {tabBtn('devices', 'Devices', counts.devices)}
        {tabBtn('accessories', 'Accessories', counts.accessories)}
        {tabBtn('sold', 'Sold', counts.sold)}
        {tabBtn('lowstock', 'Low Stock', counts.lowstock)}
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-2">
          <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{selected.size} selected</span>
          <select onChange={e => { if (e.target.value) { bulkStatus(e.target.value as DeviceStatus); e.target.value = ''; } }} className="text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1">
            <option value="">Set status…</option>
            {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <button onClick={() => exportCSV(inventory.filter(i => selected.has(i.id)), [...DEVICE_COLS, ...ACCESSORY_COLS], 'selection')} className="text-sm px-2 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 flex items-center gap-1"><Download className="w-3.5 h-3.5" /> Export</button>
          <button onClick={bulkDelete} className="text-sm px-2 py-1 rounded-md bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300 hover:bg-rose-100 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
          <button onClick={() => setSelected(new Set())} className="text-sm px-2 py-1 rounded-md text-slate-500 hover:text-slate-700">Clear</button>
        </div>
      )}

      {/* Sheets + side panels */}
      <div className="flex-1 flex flex-col xl:flex-row gap-4 overflow-hidden">
        <div className="flex-1 flex flex-col gap-6 overflow-auto min-w-0">
          {(tab === 'all' || tab === 'devices' || tab === 'sold') && (
            <Sheet title={tab === 'sold' ? 'Sold Devices' : 'Devices'} cols={visCols('device', DEVICE_COLS)} rows={tab === 'sold' ? soldDevices : devices}
              sort={sort} onSort={onSortToggle} selected={selected} onToggleSel={toggleSel} onToggleAll={toggleSelAll}
              onUpdate={onUpdate} onDelete={onDelete} onDuplicate={duplicate} onExpand={setExpandItem} onLabel={setLabelItem}
              onAddRow={tab === 'sold' ? undefined : addDeviceRow} addLabel="Add Device row" />
          )}
          {(tab === 'all' || tab === 'accessories' || tab === 'lowstock') && (
            <Sheet title={tab === 'lowstock' ? 'Low Stock Accessories' : 'Accessories'} cols={visCols('accessory', ACCESSORY_COLS)} rows={tab === 'lowstock' ? lowAccessories : accessories}
              sort={sort} onSort={onSortToggle} selected={selected} onToggleSel={toggleSel} onToggleAll={toggleSelAll}
              onUpdate={onUpdate} onDelete={onDelete} onDuplicate={duplicate} onExpand={setExpandItem} onLabel={setLabelItem}
              onAddRow={tab === 'lowstock' ? undefined : addAccessoryRow} addLabel="Add Accessory row" lowFlag />
          )}
        </div>

        {/* Side panels */}
        <div className="xl:w-72 shrink-0 flex flex-col gap-4 overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-2"><ActivityIcon className="w-4 h-4 text-indigo-500" /> Recent Activity</h3>
            {activity.length === 0 && <p className="text-xs text-slate-400">No activity yet.</p>}
            <ul className="space-y-1.5">
              {activity.slice(0, 8).map(a => <li key={a.id} className="text-xs text-slate-600 dark:text-slate-300 border-l-2 border-indigo-200 dark:border-indigo-800 pl-2">{a.text}</li>)}
            </ul>
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-4">
            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-2"><AlertTriangle className="w-4 h-4 text-rose-500" /> Low Stock</h3>
            {lowAll.length === 0 && <p className="text-xs text-slate-400">Everything is well stocked.</p>}
            <ul className="space-y-1.5">
              {lowAll.slice(0, 10).map(i => (
                <li key={i.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600 dark:text-slate-300 truncate">{i.item || i.sku}</span>
                  <span className="font-bold text-rose-600 shrink-0 ml-2">{i.quantity ?? 0} / {i.lowStockThreshold ?? 0}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {expandItem && <ItemFormModal initial={expandItem} runners={runners} onSave={onSave} onGenerateSku={onGenerateSku} onClose={() => setExpandItem(null)} />}
      {labelItem && <LabelModal item={labelItem} onClose={() => setLabelItem(null)} />}
    </div>
  );
};

/* ---------------- Sheet ---------------- */
const Sheet: React.FC<{
  title: string; cols: Col[]; rows: InventoryItem[]; sort: Sort | null; onSort: (k: string) => void;
  selected: Set<string>; onToggleSel: (id: string) => void; onToggleAll: (rows: InventoryItem[]) => void;
  onUpdate: (id: string, f: keyof InventoryItem, v: any) => void; onDelete: (id: string) => void;
  onDuplicate: (i: InventoryItem) => void; onExpand: (i: InventoryItem) => void; onLabel: (i: InventoryItem) => void;
  onAddRow?: () => void; addLabel: string; lowFlag?: boolean;
}> = ({ title, cols, rows, sort, onSort, selected, onToggleSel, onToggleAll, onUpdate, onDelete, onDuplicate, onExpand, onLabel, onAddRow, addLabel, lowFlag }) => {
  const cellCls = 'w-full px-2 py-2 bg-transparent outline-none text-sm text-slate-700 dark:text-slate-200 focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 rounded';
  const allSel = rows.length > 0 && rows.every(r => selected.has(r.id));
  const stickyLeft = 'sticky left-0 z-10 bg-white dark:bg-slate-900';

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{title} <span className="text-xs font-normal text-slate-400">({rows.length})</span></h3>
      </div>
      <div className="overflow-auto custom-scrollbar max-h-[60vh]">
        <table className="border-collapse" style={{ minWidth: '100%' }}>
          <thead className="sticky top-0 z-20 bg-slate-50 dark:bg-slate-800">
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
              <th className={`px-2 py-2.5 w-28 text-center border-b border-slate-200 dark:border-slate-700 ${stickyLeft} !z-30 bg-slate-50 dark:bg-slate-800`}>
                <div className="flex items-center gap-1 justify-center">
                  <button onClick={() => onToggleAll(rows)}>{allSel ? <CheckSquare className="w-4 h-4 text-indigo-500" /> : <Square className="w-4 h-4 text-slate-400" />}</button>
                  <span>Actions</span>
                </div>
              </th>
              {cols.map(c => (
                <th key={c.key} style={{ minWidth: c.w }} onClick={() => onSort(c.key)}
                  className={`px-2 py-2.5 border-b border-slate-200 dark:border-slate-700 cursor-pointer select-none hover:text-indigo-600 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                  <span className="inline-flex items-center gap-1">{c.label}{sort?.key === c.key && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.length === 0 && <tr><td colSpan={cols.length + 1} className="text-center text-slate-400 text-sm py-8">No items.</td></tr>}
            {rows.map(i => {
              const low = lowFlag && isLow(i);
              const sel = selected.has(i.id);
              return (
                <tr key={i.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${sel ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : low ? 'bg-rose-50/40 dark:bg-rose-900/10' : ''}`}>
                  <td className={`px-2 py-1 whitespace-nowrap ${stickyLeft} ${sel ? 'bg-indigo-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-900'}`}>
                    <div className="flex items-center gap-0.5">
                      <button onClick={() => onToggleSel(i.id)} className="p-1">{sel ? <CheckSquare className="w-4 h-4 text-indigo-500" /> : <Square className="w-4 h-4 text-slate-300" />}</button>
                      <button onClick={() => onLabel(i)} title="Print label" className="p-1 text-slate-400 hover:text-indigo-600"><QrCode className="w-3.5 h-3.5" /></button>
                      <button onClick={() => onDuplicate(i)} title="Duplicate" className="p-1 text-slate-400 hover:text-indigo-600"><Copy className="w-3.5 h-3.5" /></button>
                      <button onClick={() => onExpand(i)} title="Expanded details" className="p-1 text-slate-400 hover:text-indigo-600"><Maximize2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => onDelete(i.id)} title="Delete" className="p-1 text-slate-400 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                  {cols.map(c => (
                    <td key={c.key} style={{ minWidth: c.w }} className="p-0 align-top">
                      {c.type === 'computed' ? (
                        <div className={`px-2 py-2 text-sm font-mono ${c.align === 'right' ? 'text-right' : ''} text-slate-500 dark:text-slate-400`}>
                          {c.key === '__profit' && i.salePrice ? <span className={profitOf(i) >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{c.compute!(i)}</span> : c.compute!(i)}
                        </div>
                      ) : c.type === 'select' ? (
                        c.key === 'deviceStatus' ? (
                          <select value={(i.deviceStatus as any) ?? 'ready'} onChange={e => onUpdate(i.id, 'deviceStatus', e.target.value)}
                            className={`w-full mx-1 my-1 px-2 py-1 rounded-md text-xs font-semibold outline-none ${STATUS_CELL[(i.deviceStatus as DeviceStatus) || 'ready']}`}>
                            {c.options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        ) : (
                          <select value={(i[c.key as keyof InventoryItem] as any) ?? ''} onChange={e => onUpdate(i.id, c.key as keyof InventoryItem, e.target.value)} className={cellCls}>
                            {c.options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        )
                      ) : (
                        <div className="relative">
                          {low && c.key === 'quantity' && <AlertTriangle className="w-3 h-3 text-rose-500 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />}
                          <input type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                            value={(i[c.key as keyof InventoryItem] as any) ?? (c.type === 'number' ? 0 : '')}
                            onChange={e => onUpdate(i.id, c.key as keyof InventoryItem, c.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)}
                            className={`${cellCls} ${c.align === 'right' ? 'text-right font-mono' : ''} ${c.key === 'sku' ? 'font-mono text-xs' : ''} dark:[color-scheme:dark]`} />
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
                  <button onClick={onAddRow} className="w-full py-2.5 flex items-center justify-center gap-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-indigo-300 rounded-lg text-sm font-medium"><Plus className="w-4 h-4" /> {addLabel}</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
