import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Search, Smartphone, Package, QrCode, Trash2, X, Plus, ScanLine, AlertTriangle,
  Columns3, SlidersHorizontal, Bookmark, Download, Upload, Copy, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, CheckSquare, Square, Boxes,
  Pencil, MoreVertical, Printer, History, ScrollText,
} from 'lucide-react';
import { InventoryItem, Runner, ItemKind, DeviceType, DeviceStatus, ActivityEntry, AuditEntry } from '../types';
import { ItemFormModal } from './ItemFormModal';
import { LabelModal } from './LabelModal';
import { useIsMobile } from '../hooks/useMediaQuery';
import { ResponsiveDialog, EmptyState } from './responsive';
import { InvSection, INV_SECTIONS } from '../domain/inventoryNav';

interface Props {
  inventory: InventoryItem[];
  runners: Runner[];
  activity: ActivityEntry[];
  auditLogs?: AuditEntry[]; // display-only, for the per-row Audit Log popover
  canViewCost?: boolean;    // owner/authorized — show purchase cost on mobile cards
  section: InvSection;              // active inventory section (URL-driven)
  onSelectSection: (s: InvSection) => void; // switch section (updates the route)
  onSave: (item: InventoryItem) => void;
  onUpdate: (id: string, field: keyof InventoryItem, value: any) => void;
  onDelete: (id: string) => void;
  onGenerateSku: (kind: ItemKind, deviceType?: DeviceType) => string;
  onSeed?: () => void;
}

// Each section is an independent view with its own table, controls, pagination,
// bulk actions and Add button. The active section is owned by App (URL-routed).
type Page = InvSection;
interface Sort { key: string; dir: 'asc' | 'desc'; }
interface SavedView { name: string; page: Page; query: string; sort: Sort | null; statusFilter: string; hidden: Record<'device' | 'accessory', string[]>; }

const PAGE_SIZE = 50; // rows per page in each sub-page table

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
// Short labels for the compact in-table status pill (values are unchanged).
const STATUS_SHORT: Record<DeviceStatus, string> = {
  pending_purchase: 'Purchase',
  pending_repair: 'Repair',
  ready: 'Ready',
  sold: 'Sold',
  returned: 'Returned',
};

type ColType = 'text' | 'number' | 'date' | 'select' | 'computed';
// `frozen` pins a column to the left while scrolling; `emphasis` tunes text
// weight; `readOnly` shows the value as plain text (edited in the form instead);
// `hideCol` keeps the column out of the table + Columns menu but still exports it
// (so removing a display column never drops the underlying data from CSV).
interface Col { key: string; label: string; type: ColType; w: number; align?: 'right'; frozen?: boolean; emphasis?: 'strong' | 'muted'; readOnly?: boolean; hideCol?: boolean; options?: { value: string; label: string }[]; compute?: (i: InventoryItem) => string; sortVal?: (i: InventoryItem) => number | string; }
const opt = (arr: string[]) => arr.map(v => ({ value: v, label: v }));

// Combined Brand + Model display (falls back to the item name). Read-only —
// Brand/Model stay in the data and remain editable via the expand form. The
// brand is not repeated when the model already starts with it (e.g. brand
// "Samsung" + model "Samsung Galaxy S24" → "Samsung Galaxy S24").
export const deviceName = (i: InventoryItem): string => {
  const brand = (i.brand || '').trim();
  const model = (i.model || '').trim();
  if (brand && model) {
    return model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
  }
  return brand || model || i.item || '—';
};
const itemLabel = deviceName;

const DEVICE_COLS: Col[] = [
  // Frozen identity block — stays visible while the row scrolls horizontally.
  { key: 'date', label: 'Date In', type: 'date', w: 120, frozen: true },
  { key: 'sku', label: 'SKU', type: 'text', w: 116, frozen: true, emphasis: 'muted' },
  { key: 'imei', label: 'IMEI/Serial', type: 'text', w: 150, frozen: true, emphasis: 'muted' },
  { key: '__item', label: 'Item', type: 'computed', w: 170, frozen: true, emphasis: 'strong', compute: itemLabel, sortVal: i => itemLabel(i).toLowerCase() },
  // Type/Brand/Model are not shown in the table (Brand+Model live in the Item
  // column and its inline editor; Type is edited in the form). Kept here with
  // hideCol so CSV export still round-trips them.
  { key: 'deviceType', label: 'Type', type: 'text', w: 76, hideCol: true },
  { key: 'brand', label: 'Brand', type: 'text', w: 100, hideCol: true },
  { key: 'model', label: 'Model', type: 'text', w: 140, hideCol: true },
  { key: 'storage', label: 'Storage', type: 'text', w: 90 },
  { key: 'color', label: 'Color', type: 'text', w: 100 },
  { key: 'batteryHealth', label: 'Battery', type: 'text', w: 80 },
  { key: 'condition', label: 'Condition', type: 'select', w: 120, options: opt(CONDITIONS) },
  // 'Bought From' is no longer shown in the grid (or Columns menu). Kept here
  // with hideCol so the value still round-trips through CSV export and stays in
  // Firestore; it remains editable in the expand form.
  { key: 'boughtFrom', label: 'Bought From', type: 'text', w: 130, emphasis: 'muted', hideCol: true },
  { key: 'purchaseSource', label: 'Source', type: 'text', w: 110, emphasis: 'muted' },
  // Financial group — kept contiguous.
  { key: 'purchaseCost', label: 'Purchase', type: 'number', w: 100, align: 'right' },
  { key: 'repairCost', label: 'Repair', type: 'number', w: 90, align: 'right' },
  { key: '__total', label: 'Total Cost', type: 'computed', w: 100, align: 'right', compute: i => money(totalCost(i)), sortVal: totalCost },
  { key: 'targetSalePrice', label: 'Target', type: 'number', w: 90, align: 'right' },
  { key: '__profit', label: 'Profit', type: 'computed', w: 100, align: 'right', compute: i => i.salePrice ? money(profitOf(i)) : '—', sortVal: profitOf },
  // Sale group. (The device Status column is intentionally not shown in the
  // grid — status is still stored and driven via the Filters, the item form,
  // bulk actions, sold detection and analytics.)
  { key: 'soldDate', label: 'Date Sold', type: 'date', w: 130 },
  { key: 'soldTo', label: 'Customer', type: 'text', w: 130 },
  { key: 'notes', label: 'Notes', type: 'text', w: 220, emphasis: 'muted' },
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

// Bumped to v2 so existing users pick up the new default layout (Brand, Model,
// and Condition hidden by default — still toggleable in the Columns menu).
const LS_HIDDEN = 'inv_hidden_cols_v2';
const DEFAULT_HIDDEN: Record<'device' | 'accessory', string[]> = { device: ['condition'], accessory: [] };
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

export const InventoryView: React.FC<Props> = ({ inventory, runners, activity, auditLogs = [], canViewCost = false, section, onSelectSection, onSave, onUpdate, onDelete, onGenerateSku, onSeed }) => {
  const isMobile = useIsMobile();
  const [selectMode, setSelectMode] = useState(false); // mobile multi-select
  const [mobileFilter, setMobileFilter] = useState(false);
  // The active section is controlled by App (URL-routed); `setPage` navigates.
  const page = section;
  const setPage = onSelectSection;
  const [pageNum, setPageNum] = useState(1); // pagination within the active sub-page
  const [historyItem, setHistoryItem] = useState<{ item: InventoryItem; mode: 'history' | 'audit' } | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Record<'device' | 'accessory', string[]>>(() => loadLS(LS_HIDDEN, DEFAULT_HIDDEN));
  const [views, setViews] = useState<SavedView[]>(() => loadLS(LS_VIEWS, []));
  const [menu, setMenu] = useState<null | 'cols' | 'views' | 'filter'>(null);
  const [expandItem, setExpandItem] = useState<InventoryItem | null>(null);
  const [labelItem, setLabelItem] = useState<InventoryItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { localStorage.setItem(LS_HIDDEN, JSON.stringify(hidden)); }, [hidden]);
  useEffect(() => { localStorage.setItem(LS_VIEWS, JSON.stringify(views)); }, [views]);
  // Reset pagination + selection whenever the active page or its filters change.
  useEffect(() => { setPageNum(1); setSelected(new Set()); }, [page, query, statusFilter, sort]);

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

  // Rows/columns/kind for the currently open sub-page (a single table per page).
  const activeKind: 'device' | 'accessory' = (page === 'accessories' || page === 'lowstock') ? 'accessory' : 'device';
  const activeCols = activeKind === 'device' ? DEVICE_COLS : ACCESSORY_COLS;
  const activeRows =
    page === 'devices' ? devices :
    page === 'sold' ? soldDevices :
    page === 'accessories' ? accessories :
    page === 'lowstock' ? lowAccessories : [];
  const activeTitle =
    page === 'devices' ? 'Devices' :
    page === 'sold' ? 'Sold Devices' :
    page === 'accessories' ? 'Accessories' :
    page === 'lowstock' ? 'Low Stock' : '';
  const totalPages = Math.max(1, Math.ceil(activeRows.length / PAGE_SIZE));
  const clampedPage = Math.min(pageNum, totalPages);
  const pageRows = activeRows.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE);

  // --- actions ---
  const addDeviceRow = () => {
    const sku = onGenerateSku('device', 'Phone');
    onSave({ id: uid(), kind: 'device', sku, date: today(), item: '', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, deviceType: 'Phone', brand: '', model: '', storage: '', color: '', carrier: '', batteryHealth: '', condition: 'Good', purchaseSource: '', targetSalePrice: 0, deviceStatus: 'ready', notes: '' });
    setPage('devices');
  };
  const addAccessoryRow = () => {
    const sku = onGenerateSku('accessory');
    onSave({ id: uid(), kind: 'accessory', sku, date: today(), item: '', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, manufacturerBarcode: '', category: '', quantity: 1, costPerUnit: 0, sellingPrice: 0, lowStockThreshold: 3, notes: '' });
    setPage('accessories');
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
    setViews(v => [...v.filter(x => x.name !== name), { name, page, query, sort, statusFilter, hidden }]);
  };
  const applyView = (v: SavedView) => { setPage(((v as any).page ?? 'devices') as Page); setQuery(v.query); setSort(v.sort); setStatusFilter(v.statusFilter); setHidden(v.hidden); setMenu(null); };

  const onSortToggle = (key: string) => setSort(s => s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' });
  const toggleCol = (kind: 'device' | 'accessory', key: string) =>
    setHidden(h => ({ ...h, [kind]: h[kind].includes(key) ? h[kind].filter(k => k !== key) : [...h[kind], key] }));

  const visCols = (kind: 'device' | 'accessory', cols: Col[]) => cols.filter(c => !c.hideCol && !hidden[kind].includes(c.key));

  const sectionCount: Record<InvSection, number> = { devices: counts.devices, accessories: counts.accessories, sold: counts.sold, lowstock: counts.lowstock };

  // Compact top navigation: switches inventory sections (not table filters).
  // A single horizontally-scrollable pill row serves both desktop and mobile,
  // so it never causes page-level horizontal overflow.
  const SectionSwitcher = (
    <nav aria-label="Inventory sections" className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
      {INV_SECTIONS.map(s => {
        const active = page === s.id;
        return (
          <button key={s.id} onClick={() => setPage(s.id)} aria-current={active ? 'page' : undefined}
            className={`shrink-0 whitespace-nowrap flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
              active
                ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:border-indigo-300'
            }`}>
            {s.label}
            <span className={`text-xs ${active ? 'text-indigo-100' : 'text-slate-400'}`}>{sectionCount[s.id]}</span>
          </button>
        );
      })}
    </nav>
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
      {/* Top section switcher (Devices / Accessories / Sold / Low Stock) */}
      {SectionSwitcher}

      {/* Section title */}
      <div className="flex items-baseline gap-2">
        <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 leading-tight">{activeTitle}</h2>
        <span className="text-sm text-slate-400">{activeRows.length}</span>
      </div>

          {/* Controls (scoped to this page) */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Scan or search by SKU, IMEI, serial, barcode, or name…"
                className="w-full pl-9 pr-24 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[11px] text-slate-400"><ScanLine className="w-3.5 h-3.5" /> scanner ready</span>
            </div>

            {/* Mobile: selection-mode toggle */}
            <button onClick={() => { setSelectMode(m => !m); setSelected(new Set()); }} className="md:hidden flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200"><CheckSquare className="w-4 h-4" /> {selectMode ? 'Done' : 'Select'}</button>

            {/* Mobile filters/sort sheet trigger */}
            <button onClick={() => setMobileFilter(true)} className="md:hidden flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400"><SlidersHorizontal className="w-4 h-4" /> Sort{page === 'devices' && statusFilter !== 'all' && <span className="w-2 h-2 rounded-full bg-indigo-500" />}</button>

            {/* Desktop status filter (device page only) */}
            {page === 'devices' && (
              <div className="relative hidden md:block" onClick={e => e.stopPropagation()}>
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
            )}

            {/* Columns (this page's kind only) */}
            <div className="relative hidden md:block" onClick={e => e.stopPropagation()}>
              <button onClick={() => setMenu(menu === 'cols' ? null : 'cols')} className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400"><Columns3 className="w-4 h-4" /> Columns</button>
              {menu === 'cols' && (
                <div className="absolute right-0 mt-1 w-64 max-h-80 overflow-y-auto bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-30 p-3 space-y-1">
                  <p className="text-xs font-semibold text-slate-500 mb-1 capitalize">{activeKind} columns</p>
                  {activeCols.filter(c => !c.hideCol).map(c => (
                    <label key={c.key} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer text-slate-600 dark:text-slate-300">
                      <input type="checkbox" checked={!hidden[activeKind].includes(c.key)} onChange={() => toggleCol(activeKind, c.key)} className="rounded" /> {c.label}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Saved views (desktop) */}
            <div className="relative hidden md:block" onClick={e => e.stopPropagation()}>
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

            <button onClick={exportAll} title="Export CSV" className="hidden md:flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400"><Download className="w-4 h-4" /></button>
            <button onClick={() => fileRef.current?.click()} title="Import CSV" className="hidden md:flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400"><Upload className="w-4 h-4" /></button>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={e => e.target.files?.[0] && importCSV(e.target.files[0])} />

            {/* Add button (relevant to this page's kind) */}
            <button onClick={() => (activeKind === 'device' ? addDeviceRow() : addAccessoryRow())} className="flex items-center gap-2 px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
              {activeKind === 'device' ? <Smartphone className="w-4 h-4" /> : <Package className="w-4 h-4" />}
              <span className="hidden sm:inline">{activeKind === 'device' ? 'Add Device' : 'Add Accessory'}</span>
            </button>
          </div>

          {/* Bulk action bar (desktop) */}
          {selected.size > 0 && (
            <div className="hidden md:flex items-center gap-2 flex-wrap bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-2">
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{selected.size} selected</span>
              {activeKind === 'device' && (
                <select onChange={e => { if (e.target.value) { bulkStatus(e.target.value as DeviceStatus); e.target.value = ''; } }} className="text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1">
                  <option value="">Set status…</option>
                  {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              )}
              <button onClick={() => exportCSV(inventory.filter(i => selected.has(i.id)), activeCols, 'selection')} className="text-sm px-2 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 flex items-center gap-1"><Download className="w-3.5 h-3.5" /> Export</button>
              <button onClick={bulkDelete} className="text-sm px-2 py-1 rounded-md bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300 hover:bg-rose-100 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
              <button onClick={() => setSelected(new Set())} className="text-sm px-2 py-1 rounded-md text-slate-500 hover:text-slate-700">Clear</button>
            </div>
          )}

          {/* Mobile: cards for this page */}
          {isMobile && (
            <div className="flex flex-col gap-2 pb-24">
              {pageRows.length === 0
                ? <EmptyState icon={<Boxes className="w-6 h-6" />} title="Nothing here" hint="Try a different search or filter." />
                : pageRows.map(i => (
                  <InvCard key={i.id} item={i} canViewCost={canViewCost} selectMode={selectMode} selected={selected.has(i.id)}
                    onToggleSel={() => toggleSel(i.id)} onOpen={() => setExpandItem(i)} onLabel={() => setLabelItem(i)}
                    onUpdate={onUpdate} onDelete={onDelete} onDuplicate={duplicate} onHistory={mode => setHistoryItem({ item: i, mode })} />
                ))}
            </div>
          )}

          {/* Desktop: single table for this page */}
          <div className="hidden md:flex flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex-1 overflow-auto min-w-0">
              <Sheet title={activeTitle} total={activeRows.length} cols={visCols(activeKind, activeCols)} rows={pageRows}
                sort={sort} onSort={onSortToggle} selected={selected} onToggleSel={toggleSel} onToggleAll={toggleSelAll}
                onUpdate={onUpdate} onDelete={onDelete} onDuplicate={duplicate} onExpand={setExpandItem} onLabel={setLabelItem}
                onHistory={(it, mode) => setHistoryItem({ item: it, mode })}
                onAddRow={(page === 'devices' || page === 'accessories') ? (activeKind === 'device' ? addDeviceRow : addAccessoryRow) : undefined}
                addLabel={activeKind === 'device' ? 'Add Device row' : 'Add Accessory row'} lowFlag={page === 'lowstock'} />
            </div>
          </div>

          {/* Pagination (shared by mobile + desktop) */}
          {activeRows.length > PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 text-sm pb-24 md:pb-0">
              <span className="text-slate-500 dark:text-slate-400">{(clampedPage - 1) * PAGE_SIZE + 1}–{Math.min(clampedPage * PAGE_SIZE, activeRows.length)} of {activeRows.length}</span>
              <div className="flex items-center gap-1">
                <button disabled={clampedPage <= 1} onClick={() => setPageNum(p => Math.max(1, p - 1))} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:border-indigo-400"><ChevronLeft className="w-4 h-4" /> Prev</button>
                <span className="px-2 text-slate-500 dark:text-slate-400">Page {clampedPage} / {totalPages}</span>
                <button disabled={clampedPage >= totalPages} onClick={() => setPageNum(p => Math.min(totalPages, p + 1))} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed hover:border-indigo-400">Next <ChevronRight className="w-4 h-4" /></button>
              </div>
            </div>
          )}

          {/* Mobile: bottom bulk action bar (selection mode) */}
          {isMobile && selectMode && selected.size > 0 && (
            <div className="md:hidden fixed left-0 right-0 bottom-14 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 px-3 py-2 flex items-center gap-2 safe-b">
              <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{selected.size}</span>
              {activeKind === 'device' && (
                <select onChange={e => { if (e.target.value) { bulkStatus(e.target.value as DeviceStatus); e.target.value = ''; } }} className="text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1.5 flex-1">
                  <option value="">Set status…</option>
                  {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              )}
              <button onClick={() => exportCSV(inventory.filter(i => selected.has(i.id)), activeCols, 'selection')} aria-label="Export selection" className="tap-target flex items-center justify-center rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"><Download className="w-4 h-4" /></button>
              <button onClick={bulkDelete} aria-label="Delete selection" className="tap-target flex items-center justify-center rounded-md bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300"><Trash2 className="w-4 h-4" /></button>
              <button onClick={() => setSelected(new Set())} className="text-sm px-2 py-1 rounded-md text-slate-500">Clear</button>
            </div>
          )}

      {/* Mobile filter + sort sheet */}
      <ResponsiveDialog open={mobileFilter} onClose={() => setMobileFilter(false)} title="Filters & sort"
        footer={<button onClick={() => setMobileFilter(false)} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">Done</button>}>
        <div className="space-y-4">
          {page === 'devices' && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-1">Device Status</p>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
                <option value="all">All statuses</option>
                {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">Sort by</p>
            <select value={sort ? `${sort.key}:${sort.dir}` : ''} onChange={e => { const v = e.target.value; setSort(v ? { key: v.split(':')[0], dir: v.split(':')[1] as 'asc' | 'desc' } : null); }}
              className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
              <option value="">Newest first (default)</option>
              <option value="item:asc">Name A–Z</option>
              <option value="item:desc">Name Z–A</option>
              <option value="salePrice:desc">Sale price high–low</option>
              <option value="salePrice:asc">Sale price low–high</option>
            </select>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">Add</p>
            <div className="flex gap-2">
              <button onClick={() => { addDeviceRow(); setMobileFilter(false); }} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium"><Smartphone className="w-4 h-4" /> Device</button>
              <button onClick={() => { addAccessoryRow(); setMobileFilter(false); }} className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium"><Package className="w-4 h-4" /> Accessory</button>
            </div>
          </div>
        </div>
      </ResponsiveDialog>

      {expandItem && <ItemFormModal initial={expandItem} runners={runners} onSave={onSave} onGenerateSku={onGenerateSku} onClose={() => setExpandItem(null)} />}
      {labelItem && <LabelModal item={labelItem} onClose={() => setLabelItem(null)} />}
      {historyItem && <HistoryModal item={historyItem.item} mode={historyItem.mode} activity={activity} auditLogs={auditLogs} onClose={() => setHistoryItem(null)} />}
    </div>
  );
};

/* ---------------- History / Audit popover (read-only) ---------------- */
const HistoryModal: React.FC<{ item: InventoryItem; mode: 'history' | 'audit'; activity: ActivityEntry[]; auditLogs: AuditEntry[]; onClose: () => void }> = ({ item, mode, activity, auditLogs, onClose }) => {
  const label = item.sku || item.item || item.id;
  const fmt = (ts: number) => new Date(ts).toLocaleString();
  // History: activity entries that mention this item's SKU or name. Audit: audit
  // entries recorded against this item's id. Both are read-only views of data
  // the app already holds.
  const historyRows = activity.filter(a => (item.sku && a.text.includes(item.sku)) || (item.item && a.text.includes(item.item)));
  const auditRows = auditLogs.filter(a => a.entityId === item.id);
  const isAudit = mode === 'audit';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            {isAudit ? <ScrollText className="w-4 h-4 text-indigo-500" /> : <History className="w-4 h-4 text-indigo-500" />}
            {isAudit ? 'Audit Log' : 'History'} · <span className="font-mono text-xs text-slate-500">{label}</span>
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto custom-scrollbar">
          {isAudit ? (
            auditRows.length === 0 ? <p className="text-sm text-slate-400">No audit entries for this item.</p> : (
              <ul className="space-y-2">
                {auditRows.map(a => (
                  <li key={a.id} className="text-sm border-l-2 border-indigo-200 dark:border-indigo-800 pl-3">
                    <div className="font-medium text-slate-700 dark:text-slate-200">{a.action}</div>
                    <div className="text-xs text-slate-400">{fmt(a.ts)} · {a.userEmail}</div>
                  </li>
                ))}
              </ul>
            )
          ) : (
            historyRows.length === 0 ? <p className="text-sm text-slate-400">No history entries for this item.</p> : (
              <ul className="space-y-2">
                {historyRows.map(a => (
                  <li key={a.id} className="text-sm border-l-2 border-indigo-200 dark:border-indigo-800 pl-3">
                    <div className="text-slate-700 dark:text-slate-200">{a.text}</div>
                    <div className="text-xs text-slate-400">{fmt(a.ts)}</div>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </div>
    </div>
  );
};

/* ---------------- Sheet ---------------- */
const Sheet: React.FC<{
  title: string; total?: number; cols: Col[]; rows: InventoryItem[]; sort: Sort | null; onSort: (k: string) => void;
  selected: Set<string>; onToggleSel: (id: string) => void; onToggleAll: (rows: InventoryItem[]) => void;
  onUpdate: (id: string, f: keyof InventoryItem, v: any) => void; onDelete: (id: string) => void;
  onDuplicate: (i: InventoryItem) => void; onExpand: (i: InventoryItem) => void; onLabel: (i: InventoryItem) => void;
  onHistory: (i: InventoryItem, mode: 'history' | 'audit') => void;
  onAddRow?: () => void; addLabel: string; lowFlag?: boolean;
}> = ({ title, total, cols, rows, sort, onSort, selected, onToggleSel, onToggleAll, onUpdate, onDelete, onDuplicate, onExpand, onLabel, onHistory, onAddRow, addLabel, lowFlag }) => {
  // Row overflow menu + inline Brand/Model editor. State lives at the Sheet root
  // and the popovers render outside the sticky table subtree (fixed-positioned)
  // so they aren't clipped or trapped under the sticky columns' stacking context.
  const [menu, setMenu] = useState<{ i: InventoryItem; x: number; y: number } | null>(null);
  const [itemPop, setItemPop] = useState<{ i: InventoryItem; x: number; y: number } | null>(null);
  const openAt = (e: React.MouseEvent, width: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.min(r.left, window.innerWidth - width - 12), y: r.bottom + 4 };
  };

  // Frozen identity columns stay pinned to the left while the rest scrolls.
  // Left offsets are the running width of the Actions column + preceding frozen
  // columns, so they must use fixed widths.
  const ACTIONS_W = 108;
  const frozenLeft: Record<string, number> = {};
  { let acc = ACTIONS_W; for (const c of cols) { if (c.frozen) { frozenLeft[c.key] = acc; acc += c.w; } else break; } }
  const emph = (c: Col) =>
    c.emphasis === 'strong' ? 'font-semibold text-slate-900 dark:text-slate-100'
      : c.emphasis === 'muted' ? 'text-slate-500 dark:text-slate-400'
        : 'text-slate-700 dark:text-slate-200';
  const cellBase = 'w-full px-2 py-1.5 bg-transparent outline-none text-sm focus:bg-white dark:focus:bg-slate-800 focus:ring-2 focus:ring-indigo-500 rounded';
  const allSel = rows.length > 0 && rows.every(r => selected.has(r.id));

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{title} <span className="text-xs font-normal text-slate-400">({total ?? rows.length})</span></h3>
      </div>
      <div className="overflow-auto custom-scrollbar max-h-[60vh]">
        <table className="border-collapse" style={{ minWidth: '100%' }}>
          <thead className="sticky top-0 z-20 bg-slate-50 dark:bg-slate-800">
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
              <th style={{ width: ACTIONS_W, minWidth: ACTIONS_W, left: 0 }} className="px-2 py-2 text-center border-b border-slate-200 dark:border-slate-700 sticky !z-30 bg-slate-50 dark:bg-slate-800">
                <div className="flex items-center gap-1 justify-center">
                  <button onClick={() => onToggleAll(rows)}>{allSel ? <CheckSquare className="w-4 h-4 text-indigo-500" /> : <Square className="w-4 h-4 text-slate-400" />}</button>
                  <span>Actions</span>
                </div>
              </th>
              {cols.map(c => (
                <th key={c.key}
                  style={{ minWidth: c.w, ...(c.frozen ? { width: c.w, left: frozenLeft[c.key], position: 'sticky' as const } : {}) }}
                  onClick={() => onSort(c.key)}
                  className={`px-2 py-2 border-b border-slate-200 dark:border-slate-700 cursor-pointer select-none hover:text-indigo-600 ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.frozen ? 'z-30 bg-slate-50 dark:bg-slate-800' : ''}`}>
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
              // Frozen cells need an opaque background so scrolled content can't show through.
              const frozenBg = sel ? 'bg-indigo-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-900';
              return (
                <tr key={i.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${sel ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : low ? 'bg-rose-50/40 dark:bg-rose-900/10' : ''}`}>
                  <td style={{ width: ACTIONS_W, minWidth: ACTIONS_W, left: 0 }} className={`px-2 py-1.5 whitespace-nowrap sticky z-10 ${frozenBg}`}>
                    <div className="flex items-center gap-1">
                      <button onClick={() => onToggleSel(i.id)} className="p-1" title="Select">{sel ? <CheckSquare className="w-4 h-4 text-indigo-500" /> : <Square className="w-4 h-4 text-slate-300" />}</button>
                      <button onClick={() => onExpand(i)} className="p-1 text-slate-400 hover:text-indigo-600" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={e => setMenu({ i, ...openAt(e, 180) })} className="p-1 text-slate-400 hover:text-indigo-600" title="More actions"><MoreVertical className="w-4 h-4" /></button>
                    </div>
                  </td>
                  {cols.map(c => (
                    <td key={c.key}
                      style={{ minWidth: c.w, ...(c.frozen ? { width: c.w, left: frozenLeft[c.key], position: 'sticky' as const } : {}) }}
                      className={`p-0 align-top ${c.frozen ? `sticky z-10 ${frozenBg}` : ''}`}>
                      {c.type === 'computed' ? (
                        c.key === '__item' ? (
                          <button onClick={e => setItemPop({ i, ...openAt(e, 240) })} title="Edit brand & model"
                            className={`w-full text-left px-2 py-1.5 text-sm truncate rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20 ${emph(c)}`}>
                            {c.compute!(i)}
                          </button>
                        ) : (
                          <div className={`px-2 py-1.5 text-sm ${c.align === 'right' ? 'text-right font-mono' : ''} ${emph(c)}`}>
                            {c.key === '__profit' && i.salePrice ? <span className={profitOf(i) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{c.compute!(i)}</span> : c.compute!(i)}
                          </div>
                        )
                      ) : c.readOnly ? (
                        <div className={`px-2 py-1.5 text-sm truncate ${emph(c)}`}>{((i[c.key as keyof InventoryItem] as any) ?? '') || '—'}</div>
                      ) : c.type === 'select' ? (
                        c.key === 'deviceStatus' ? (
                          <div className="px-2 py-1 flex items-center">
                            <select value={(i.deviceStatus as any) ?? 'ready'} onChange={e => onUpdate(i.id, 'deviceStatus', e.target.value)}
                              className={`appearance-none cursor-pointer rounded px-2 py-0.5 text-[11px] font-semibold leading-tight outline-none focus:ring-2 focus:ring-indigo-500 ${STATUS_CELL[(i.deviceStatus as DeviceStatus) || 'ready']}`}>
                              {c.options!.map(o => <option key={o.value} value={o.value}>{STATUS_SHORT[o.value as DeviceStatus] ?? o.label}</option>)}
                            </select>
                          </div>
                        ) : (
                          <select value={(i[c.key as keyof InventoryItem] as any) ?? ''} onChange={e => onUpdate(i.id, c.key as keyof InventoryItem, e.target.value)} className={`${cellBase} ${emph(c)}`}>
                            {c.options!.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        )
                      ) : (
                        <div className="relative">
                          {low && c.key === 'quantity' && <AlertTriangle className="w-3 h-3 text-rose-500 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />}
                          <input type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                            value={(i[c.key as keyof InventoryItem] as any) ?? (c.type === 'number' ? 0 : '')}
                            onChange={e => onUpdate(i.id, c.key as keyof InventoryItem, c.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)}
                            className={`${cellBase} ${emph(c)} ${c.align === 'right' ? 'text-right font-mono' : ''} ${c.key === 'sku' ? 'font-mono text-xs' : ''} dark:[color-scheme:dark]`} />
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

      {/* Row overflow menu (rendered outside the table so it never clips) */}
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div className="fixed z-50 w-44 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl py-1 text-sm" style={{ left: menu.x, top: menu.y }}>
            {[
              { icon: <Printer className="w-4 h-4" />, label: 'Print Label', run: () => onLabel(menu.i) },
              { icon: <QrCode className="w-4 h-4" />, label: 'QR Code', run: () => onLabel(menu.i) },
              { icon: <Copy className="w-4 h-4" />, label: 'Duplicate', run: () => onDuplicate(menu.i) },
              { icon: <History className="w-4 h-4" />, label: 'View History', run: () => onHistory(menu.i, 'history') },
              { icon: <ScrollText className="w-4 h-4" />, label: 'Audit Log', run: () => onHistory(menu.i, 'audit') },
            ].map(m => (
              <button key={m.label} onClick={() => { m.run(); setMenu(null); }} className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800">
                <span className="text-slate-400">{m.icon}</span>{m.label}
              </button>
            ))}
            <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
            <button onClick={() => { onDelete(menu.i.id); setMenu(null); }} className="w-full text-left px-3 py-1.5 flex items-center gap-2 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20">
              <Trash2 className="w-4 h-4" /> Delete
            </button>
          </div>
        </>
      )}

      {/* Inline Brand/Model editor for the Item cell */}
      {itemPop && (
        <BrandModelPopover item={itemPop.i} x={itemPop.x} y={itemPop.y} onUpdate={onUpdate} onClose={() => setItemPop(null)} />
      )}
    </div>
  );
};

/* Inline Brand + Model editor (keeps the underlying fields; writes through live) */
const BrandModelPopover: React.FC<{ item: InventoryItem; x: number; y: number; onUpdate: (id: string, f: keyof InventoryItem, v: any) => void; onClose: () => void }> = ({ item, x, y, onUpdate, onClose }) => {
  const [brand, setBrand] = useState(item.brand || '');
  const [model, setModel] = useState(item.model || '');
  const inputCls = 'mt-0.5 w-full px-2 py-1.5 text-sm bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100';
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="fixed z-50 w-60 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl p-3 space-y-2" style={{ left: x, top: y }}
        onKeyDown={e => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT')) onClose(); }}>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Edit Item</p>
        <label className="block text-xs text-slate-500 dark:text-slate-400">Brand
          <input autoFocus value={brand} onChange={e => { setBrand(e.target.value); onUpdate(item.id, 'brand', e.target.value); }} placeholder="e.g. Apple" className={inputCls} />
        </label>
        <label className="block text-xs text-slate-500 dark:text-slate-400">Model
          <input value={model} onChange={e => { setModel(e.target.value); onUpdate(item.id, 'model', e.target.value); }} placeholder="e.g. iPhone 14 Pro" className={inputCls} />
        </label>
        <div className="flex justify-end"><button onClick={onClose} className="text-xs px-3 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white font-medium">Done</button></div>
      </div>
    </>
  );
};

/* ---------------- Mobile inventory card ---------------- */
const salePriceOf = (i: InventoryItem) => kindOf(i) === 'device' ? (i.salePrice || i.targetSalePrice || 0) : (i.sellingPrice || 0);
const costOf = (i: InventoryItem) => kindOf(i) === 'device' ? (i.purchaseCost || 0) : (i.costPerUnit || 0);
const nameOf = (i: InventoryItem) => kindOf(i) === 'device' ? deviceName(i) : (i.item || i.sku || 'Item');

const InvCard: React.FC<{
  item: InventoryItem;
  canViewCost: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSel: () => void;
  onOpen: () => void;
  onLabel: () => void;
  onUpdate: (id: string, field: keyof InventoryItem, value: any) => void;
  onDelete: (id: string) => void;
  onDuplicate: (i: InventoryItem) => void;
  onHistory: (mode: 'history' | 'audit') => void;
}> = ({ item: i, canViewCost, selectMode, selected, onToggleSel, onOpen, onLabel, onDelete, onDuplicate, onHistory }) => {
  const [menu, setMenu] = useState(false);
  const isDevice = kindOf(i) === 'device';
  const copy = (v?: string) => v && navigator.clipboard?.writeText(v).catch(() => {});
  const tap = () => (selectMode ? onToggleSel() : onOpen());

  const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex items-center justify-between gap-3 py-0.5"><span className="text-xs text-slate-400 shrink-0">{label}</span><span className="text-sm text-slate-700 dark:text-slate-200 truncate text-right">{children}</span></div>
  );

  return (
    <div className={`relative bg-white dark:bg-slate-900 border rounded-xl p-3 ${selected ? 'border-indigo-400 ring-1 ring-indigo-400' : 'border-slate-200 dark:border-slate-700'}`}>
      <div className="flex items-start gap-2">
        {selectMode && (
          <button onClick={onToggleSel} aria-label={selected ? 'Deselect' : 'Select'} className="tap-target flex items-center justify-center -ml-1 text-indigo-600">
            {selected ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-300" />}
          </button>
        )}
        <button onClick={tap} className="text-left min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-slate-800 dark:text-slate-100 truncate">{nameOf(i)}</span>
            {/* Devices no longer show a status badge here (status removed from the
                device view); accessories still flag low stock. */}
            {!isDevice && (i.quantity ?? 0) <= (i.lowStockThreshold ?? 0) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">Low · {i.quantity ?? 0}</span>}
          </div>
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={onLabel} aria-label="Print label" title="Print label" className="tap-target flex items-center justify-center text-slate-400 hover:text-indigo-600"><Printer className="w-4 h-4" /></button>
          <button onClick={() => setMenu(m => !m)} aria-label="More actions" className="tap-target flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><MoreVertical className="w-5 h-5" /></button>
        </div>
      </div>

      <button onClick={tap} className="w-full text-left mt-2 block">
        <Row label="SKU"><span className="font-mono">{i.sku || '—'}</span></Row>
        {isDevice && i.imei && <Row label="IMEI / Serial"><span className="font-mono">{i.imei}</span></Row>}
        {isDevice && (i.storage || i.color) && <Row label="Storage / Color">{[i.storage, i.color].filter(Boolean).join(' · ') || '—'}</Row>}
        <Row label="Sale price"><span className="font-semibold">{money(salePriceOf(i))}</span></Row>
        {canViewCost && <Row label="Purchase cost">{money(costOf(i))}</Row>}
        <Row label="Date added">{i.date || '—'}</Row>
      </button>

      {menu && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenu(false)} />
          <div className="absolute right-2 top-11 z-30 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg py-1 text-sm">
            {[
              { icon: <Pencil className="w-4 h-4" />, label: 'Open / Edit', run: onOpen },
              { icon: <QrCode className="w-4 h-4" />, label: 'Print Label', run: onLabel },
              { icon: <Copy className="w-4 h-4" />, label: 'Copy SKU', run: () => copy(i.sku) },
              ...(isDevice && i.imei ? [{ icon: <Copy className="w-4 h-4" />, label: 'Copy IMEI/Serial', run: () => copy(i.imei) }] : []),
              { icon: <Copy className="w-4 h-4" />, label: 'Duplicate', run: () => onDuplicate(i) },
              { icon: <History className="w-4 h-4" />, label: 'View History', run: () => onHistory('history') },
              { icon: <ScrollText className="w-4 h-4" />, label: 'Audit Log', run: () => onHistory('audit') },
              { icon: <Trash2 className="w-4 h-4" />, label: 'Delete', run: () => onDelete(i.id), danger: true },
            ].map((a, idx) => (
              <button key={idx} onClick={() => { a.run(); setMenu(false); }} className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 ${(a as any).danger ? 'text-rose-600' : 'text-slate-700 dark:text-slate-200'}`}>{a.icon}{a.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
