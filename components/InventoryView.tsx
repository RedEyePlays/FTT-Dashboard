import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, lazy, Suspense } from 'react';
import {
  Search, Smartphone, Package, QrCode, Trash2, X, Plus, ScanLine, AlertTriangle,
  Columns3, SlidersHorizontal, Bookmark, Download, Upload, Copy, ChevronUp, ChevronDown,
  ChevronLeft, ChevronRight, CheckSquare, Square, Boxes,
  Pencil, MoreVertical, Printer, History, ScrollText, Wrench, Tag, DollarSign, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { InventoryItem, DeviceBuyer, ItemKind, DeviceType, DeviceStatus, ActivityEntry, AuditEntry, Repair, Note, Role, Customer } from '../types';
import { CustomerDraft } from '../domain/customers';
import { linkedRepairFor, REPAIR_STATUS_LABEL } from '../domain/repairs';
import { inRepairTicketFor } from '../domain/repairVisibility';
import { isStalePendingRepair, isOrphanedPendingRepair, PENDING_REPAIR_STALE_DAYS } from '../domain/alerts';
import { printShelfTag, printShelfTagsBatch } from '../services/shelfTag';
import { getStoreProfile } from './SettingsModal';
import { ItemFormModal } from './ItemFormModal';
// Lazy: defers jsPDF (~390 kB) until a label is actually printed.
const LabelModal = lazy(() => import('./LabelModal').then(m => ({ default: m.LabelModal })));
import { useIsMobile } from '../hooks/useMediaQuery';
import { ResponsiveDialog, EmptyState } from './responsive';
import { InvSection, INV_SECTIONS } from '../domain/inventoryNav';
import { getDeviceDisplayName, priceFieldFor, isCostRevealingColumn } from '../domain/inventory';
import { listedElsewhereTitle } from '../domain/listing';
import { clampWidth, fitWidths } from '../domain/columnLayout';
import { usePersistedFilter } from '../hooks/usePersistedFilter';
import { todayISO } from '../domain/dates';

interface Props {
  inventory: InventoryItem[];
  deviceBuyers: DeviceBuyer[];
  activity: ActivityEntry[];
  auditLogs?: AuditEntry[]; // display-only, for the per-row Audit Log popover
  canViewCost?: boolean;    // owner/authorized — show purchase cost on mobile cards
  userId?: string;          // signed-in user's uid — scopes remembered filters so they never leak between accounts
  section: InvSection;              // active inventory section (URL-driven)
  onSelectSection: (s: InvSection) => void; // switch section (updates the route)
  onSave: (item: InventoryItem) => void;
  // May return a promise so bulk actions can tell which items in a multi-select
  // action actually succeeded, instead of assuming every write landed.
  onUpdate: (id: string, field: keyof InventoryItem, value: any) => void | Promise<void>;
  onDelete: (id: string) => void;
  onGenerateSku: (kind: ItemKind, deviceType?: DeviceType) => Promise<string>;
  onSeed?: () => void;
  // Internal repair linking (owner/manager): start a repair ticket for a device,
  // and open the ticket already linked to one.
  repairs?: Repair[];
  // Customer list + inline creation, for the item modal's "Bought From"
  // picker (same field/behaviour as Quick Purchase).
  customers?: Customer[];
  onCreateCustomer?: (draft: CustomerDraft) => Customer | undefined;
  onCreateRepair?: (item: InventoryItem) => void;
  onOpenRepair?: (repairId: string) => void;
  notes?: Note[];                        // workspace notes, for the linked-notes panel
  noteRole?: Role;                       // viewer's role, gates which linked notes show
  onOpenNote?: (noteId: string) => void; // jump to a linked note in the Notes board
}

// Each section is an independent view with its own table, controls, pagination,
// bulk actions and Add button. The active section is owned by App (URL-routed).
type Page = InvSection;
interface Sort { key: string; dir: 'asc' | 'desc'; }
interface SavedView { name: string; page: Page; query: string; sort: Sort | null; statusFilter: string; hidden: Record<'device' | 'accessory', string[]>; }

const PAGE_SIZE = 50; // rows per page in each sub-page table

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const today = () => todayISO();
const kindOf = (i: InventoryItem): ItemKind => i.kind ?? 'device';
const isSold = (i: InventoryItem) => kindOf(i) === 'device' && (!!i.soldDate || i.deviceStatus === 'sold');
const isLow = (i: InventoryItem) => kindOf(i) === 'accessory' && (i.quantity ?? 0) <= (i.lowStockThreshold ?? 0);
const money = (n?: number) => `$${(n || 0).toFixed(2)}`;
const totalCost = (i: InventoryItem) => (i.purchaseCost || 0) + (i.repairCost || 0);
const profitOf = (i: InventoryItem) => i.salePrice ? i.salePrice - i.purchaseCost - (i.repairCost || 0) : 0;

// Actual sale-price cell: editable directly so an off-POS sale (private sale,
// trade show, …) can be logged without running Quick Sale. Value commits on
// blur / Enter — not per keystroke — so the row isn't stamped sold (and yanked
// out of the Devices tab) while the number is still being typed. Stays blank
// with a dash placeholder until a real sale price exists. Module-scope so the
// input keeps focus across parent re-renders.
const ActualCell: React.FC<{ item: InventoryItem; onCommit: (v: number) => void; className: string }> = ({ item, onCommit, className }) => {
  const stored = item.salePrice || 0;
  const [val, setVal] = useState(stored ? String(stored) : '');
  useEffect(() => { setVal(stored ? String(stored) : ''); }, [stored, item.soldDate]);
  const commit = () => {
    const n = parseFloat(val) || 0;
    if (n === stored) return;
    // Entering an Actual price marks the device sold immediately on save (see
    // domain/inventory.ts's applyDirectSale) — this narrow "Target"/"Actual"
    // column pair sits adjacent in the grid and is easy to fat-finger, so guard
    // the one transition that actually does something irreversible-feeling: a
    // not-yet-sold item (no prior salePrice, no soldDate) getting its first
    // nonzero Actual price. Editing an already-sold item's price back and forth
    // needs no extra confirmation.
    const firstTimeMarkingSold = stored === 0 && !item.soldDate && n > 0;
    if (firstTimeMarkingSold && !window.confirm(`Mark "${item.item || item.sku || 'this item'}" as SOLD for $${n.toFixed(2)}? It will move out of active inventory into Sold.`)) {
      setVal(stored ? String(stored) : '');
      return;
    }
    onCommit(n);
  };
  return (
    <input type="number" inputMode="decimal" value={val}
      placeholder={!item.soldDate && !val ? '—' : undefined}
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={className} />
  );
};

// Date cell: shows a muted dash instead of the browser's literal "yyyy-mm-dd"
// placeholder when empty (consistent with how blank Profit renders), while
// staying a real date picker on focus.
const DateCell: React.FC<{ value?: string; onChange: (v: string) => void; className: string }> = ({ value, onChange, className }) => {
  const [focused, setFocused] = useState(false);
  const empty = !value;
  return (
    <div className="relative">
      <input type="date" value={value ?? ''}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={e => onChange(e.target.value)}
        className={`${className} ${empty && !focused ? 'text-transparent' : ''}`} />
      {empty && !focused && <span className="absolute inset-0 flex items-center px-2 text-slate-300 dark:text-slate-600 pointer-events-none">–</span>}
    </div>
  );
};

const DEVICE_TYPES: DeviceType[] = ['Phone', 'Tablet', 'Laptop', 'Console', 'Watch', 'Other'];
const CONDITIONS = ['New', 'Like New', 'Excellent', 'Good', 'Fair', 'For Parts'];
const STATUS_OPTS: { value: DeviceStatus; label: string }[] = [
  { value: 'pending_purchase', label: 'Pending Purchase' },
  { value: 'pending_repair', label: 'Pending Repair' },
  { value: 'ready', label: 'Ready for Sale' },
  { value: 'reserved', label: 'Reserved (Layaway)' },
  { value: 'sold', label: 'Sold' },
  { value: 'returned', label: 'Returned' },
];
// Extra Filters entries beyond a plain deviceStatus match — the two ways the
// in-repair flag goes wrong and leaves a device silently out of stock (see
// domain/alerts.ts's pendingRepairIssues).
const FLAG_STALE_REPAIR = 'flag:stale_repair';
const FLAG_ORPHANED_REPAIR = 'flag:orphan_repair';
const FLAG_OPTS: { value: string; label: string }[] = [
  { value: FLAG_STALE_REPAIR, label: `In repair > ${PENDING_REPAIR_STALE_DAYS} days` },
  { value: FLAG_ORPHANED_REPAIR, label: 'In repair · no open ticket' },
];

const STATUS_CELL: Record<DeviceStatus, string> = {
  pending_purchase: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  pending_repair: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  ready: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
  reserved: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',
  sold: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  returned: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
};
// The SKU cell's in-repair treatment: the exact `pending_repair` orange from
// STATUS_CELL above (never a second, parallel color for the same state), sized
// to fit the narrow frozen SKU column — the wrench icon shrinks rather than
// widening the column, and the SKU itself truncates.
const REPAIR_SKU_CELL = `${STATUS_CELL.pending_repair} font-mono text-xs`;
const repairSkuTitle = (r: Repair): string => `In repair — ${r.repairNumber} · ${REPAIR_STATUS_LABEL[r.status]}`;

// The Item cell's listed-elsewhere treatment. Deliberately the SAME amber as
// the mobile item card's badge (components/InventoryView.tsx's ItemCard) so one
// state has one color across both views — and deliberately a different hue from
// REPAIR_SKU_CELL's orange above, since a device can be BOTH in repair and
// listed elsewhere at once and the two flags must stay tellable apart. They
// also live on different cells (SKU vs Item), so they never compete for width.
// The listed-elsewhere treatment: BLUE, and the same blue for every
// listing platform (Best Buy, Kijiji, Facebook, eBay, Other) — one
// state, one colour, whichever site the device is posted on. Kept
// distinct from REPAIR_SKU_CELL's orange above, since a device can be
// both in repair AND listed at once and the two flags must stay
// tellable apart.
const LISTED_CELL = 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';

// Short labels for the compact in-table status pill (values are unchanged).
const STATUS_SHORT: Record<DeviceStatus, string> = {
  pending_purchase: 'Purchase',
  pending_repair: 'Repair',
  ready: 'Ready',
  reserved: 'Reserved',
  sold: 'Sold',
  returned: 'Returned',
};

type ColType = 'text' | 'number' | 'date' | 'select' | 'computed';
// `frozen` pins a column to the left while scrolling; `emphasis` tunes text
// weight; `readOnly` shows the value as plain text (edited in the form instead);
// `hideCol` keeps the column out of the table + Columns menu but still exports it
// (so removing a display column never drops the underlying data from CSV).
interface Col { key: string; label: string; type: ColType; w: number; min?: number; max?: number; flex?: boolean; align?: 'right'; frozen?: boolean; emphasis?: 'strong' | 'muted'; readOnly?: boolean; hideCol?: boolean; options?: { value: string; label: string }[]; compute?: (i: InventoryItem) => string; sortVal?: (i: InventoryItem) => number | string; }
const opt = (arr: string[]) => arr.map(v => ({ value: v, label: v }));

// The Item column / card title use the shared getDeviceDisplayName helper so the
// combined name (with legacy fallbacks) is identical everywhere it appears.
const itemLabel = getDeviceDisplayName;

// Minimums are kept lean so the full default column set still fits within the
// container (no horizontal scroll) even at ~1024px — the bounded fit shrinks
// columns toward these mins. Notes is capped at 300 and opened via a drawer.
const DEVICE_COLS: Col[] = [
  // Frozen identity block — stays pinned to the left. Defaults are compact so the
  // full set leaves some unused width to grow into on wide screens; mins sum
  // small enough that everything still fits (no scroll) down to ~1024px.
  { key: 'date', label: 'Date In', type: 'date', w: 96, min: 54, max: 140, frozen: true },
  { key: 'sku', label: 'SKU', type: 'text', w: 100, min: 68, max: 160, frozen: true, emphasis: 'muted' },
  { key: 'imei', label: 'IMEI/Serial', type: 'text', w: 140, min: 68, max: 240, frozen: true, emphasis: 'muted' },
  // The Item cell is a plain text field written straight to `item` (typed as one
  // string, e.g. "Apple iPhone 12"). Kept as a computed column so it shows the
  // display name (item, or a brand+model fallback for legacy rows) and sorts by
  // it; the underlying `item` field round-trips via the hidden column below.
  { key: '__item', label: 'Item', type: 'computed', w: 170, min: 80, max: 400, flex: true, frozen: true, emphasis: 'strong', compute: itemLabel, sortVal: i => itemLabel(i).toLowerCase() },
  // Not shown in the table. Type is edited in the form; Brand/Model remain as
  // underlying fields (search/labels/legacy display) but are no longer edited via
  // the Item cell. All kept with hideCol so CSV export still round-trips them —
  // including `item`, which is now the primary name field.
  { key: 'item', label: 'Item Name', type: 'text', w: 170, hideCol: true },
  { key: 'deviceType', label: 'Type', type: 'text', w: 76, hideCol: true },
  { key: 'brand', label: 'Brand', type: 'text', w: 100, hideCol: true },
  { key: 'model', label: 'Model', type: 'text', w: 140, hideCol: true },
  { key: 'storage', label: 'Storage', type: 'text', w: 84, min: 46, max: 120 },
  { key: 'color', label: 'Color', type: 'text', w: 90, min: 48, max: 150 },
  { key: 'batteryHealth', label: 'Battery', type: 'text', w: 68, min: 40, max: 110 },
  { key: 'condition', label: 'Condition', type: 'select', w: 108, min: 80, max: 150, options: opt(CONDITIONS) },
  // 'Bought From' is no longer shown in the grid (or Columns menu). Kept here
  // with hideCol so the value still round-trips through CSV export and stays in
  // Firestore; it remains editable in the expand form.
  { key: 'boughtFrom', label: 'Bought From', type: 'text', w: 130, emphasis: 'muted', hideCol: true },
  { key: 'purchaseSource', label: 'Source', type: 'text', w: 84, min: 42, max: 140, emphasis: 'muted' },
  // Financial group — kept contiguous.
  { key: 'purchaseCost', label: 'Purchase', type: 'number', w: 80, min: 46, max: 130, align: 'right' },
  { key: 'repairCost', label: 'Repair', type: 'number', w: 78, min: 44, max: 130, align: 'right' },
  { key: '__total', label: 'Total Cost', type: 'computed', w: 84, min: 48, max: 130, align: 'right', compute: i => money(totalCost(i)), sortVal: totalCost },
  { key: 'targetSalePrice', label: 'Target', type: 'number', w: 78, min: 44, max: 130, align: 'right' },
  // Actual = the real sale price the device sold for; drives the Profit column.
  { key: 'salePrice', label: 'Actual', type: 'number', w: 78, min: 44, max: 130, align: 'right' },
  // Profit is only real once the device has actually sold (Date Sold set). Until
  // then show '—' — never compute a profit against an unrealized/placeholder price.
  { key: '__profit', label: 'Profit', type: 'computed', w: 84, min: 48, max: 130, align: 'right', compute: i => i.soldDate ? money(profitOf(i)) : '—', sortVal: i => (i.soldDate ? profitOf(i) : 0) },
  // Sale group. (The device Status column is intentionally not shown in the
  // grid — status is still stored and driven via the Filters, the item form,
  // bulk actions, sold detection and analytics.)
  { key: 'soldDate', label: 'Date Sold', type: 'date', w: 96, min: 50, max: 150 },
  // Notes before Customer: `soldTo` is only filled in after a sale, so it reads
  // last. Both columns keep every property they had — this is a reorder only,
  // and every saved layout (hidden columns, widths, saved views) is keyed by
  // column `key`, never by position, so stored layouts survive it untouched.
  { key: 'notes', label: 'Notes', type: 'text', w: 140, min: 54, max: 300, flex: true, emphasis: 'muted' },
  { key: 'soldTo', label: 'Customer', type: 'text', w: 104, min: 46, max: 220 },
];
const ACCESSORY_COLS: Col[] = [
  { key: 'date', label: 'Date Added', type: 'date', w: 130, min: 72, max: 150 },
  { key: 'sku', label: 'SKU', type: 'text', w: 120, min: 76, max: 160, emphasis: 'muted' },
  { key: 'manufacturerBarcode', label: 'Barcode', type: 'text', w: 160, min: 88, max: 220 },
  { key: 'item', label: 'Item Name', type: 'text', w: 220, min: 110, max: 400, flex: true, emphasis: 'strong' },
  { key: 'category', label: 'Category', type: 'text', w: 130, min: 72, max: 160 },
  { key: 'quantity', label: 'Quantity', type: 'number', w: 96, min: 56, max: 130, align: 'right' },
  { key: 'costPerUnit', label: 'Cost/Unit', type: 'number', w: 100, min: 60, max: 140, align: 'right' },
  { key: 'sellingPrice', label: 'Selling Price', type: 'number', w: 110, min: 64, max: 140, align: 'right' },
  { key: 'lowStockThreshold', label: 'Low Stock', type: 'number', w: 100, min: 60, max: 140, align: 'right' },
  { key: 'notes', label: 'Notes', type: 'text', w: 220, min: 60, max: 300, flex: true, emphasis: 'muted' },
];

// Bumped to v2 so existing users pick up the new default layout (Brand, Model,
// and Condition hidden by default — still toggleable in the Columns menu).
const LS_HIDDEN = 'inv_hidden_cols_v2';
const DEFAULT_HIDDEN: Record<'device' | 'accessory', string[]> = { device: ['condition'], accessory: [] };
const LS_VIEWS = 'inv_saved_views_v1';
// Per-column width overrides from drag-resizing, kept per kind (device/accessory)
// and per column key. Empty = use the column's default width.
const LS_COLW = 'inv_col_widths_v1';
type ColWidths = Record<'device' | 'accessory', Record<string, number>>;
const MIN_COL_W = 40; // absolute floor for a stored width (per-column mins clamp further)
const loadLS = <T,>(k: string, fb: T): T => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fb; } catch { return fb; } };

// Filtered out of activeCols before the table renders or CSV exports it, so
// an unauthorized role can't see or export cost data through either path
// (see domain/inventory.ts's isCostRevealingColumn).
const visibleCols = (cols: Col[], canViewCost: boolean): Col[] =>
  canViewCost ? cols : cols.filter(c => !isCostRevealingColumn(c.key));

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

export const InventoryView: React.FC<Props> = ({ inventory, deviceBuyers, activity, auditLogs = [], canViewCost = false, userId, section, onSelectSection, onSave, onUpdate, onDelete, onGenerateSku, onSeed, repairs = [], customers, onCreateCustomer, onCreateRepair, onOpenRepair, notes, noteRole, onOpenNote }) => {
  const linkedRepairOf = (id: string): Repair | undefined => linkedRepairFor(id, repairs);
  // Only a STILL-OPEN ticket flags the device as in repair; a completed/picked
  // up/cancelled one leaves the SKU cell exactly as it was.
  // What makes a device DISPLAY as in-repair. Resolved through the item,
  // not just its id, so a SOLD device never shows the orange in-repair SKU
  // however its tickets stand — the device has left the shop, whatever the
  // paperwork still says. See domain/repairVisibility.ts.
  const openRepairOf = (id: string): Repair | undefined => {
    const item = inventory.find(i => i.id === id);
    return item ? inRepairTicketFor(item, repairs) : undefined;
  };
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
  const [statusFilter, setStatusFilter] = usePersistedFilter<string>('inv_status_filter', userId, 'all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Record<'device' | 'accessory', string[]>>(() => loadLS(LS_HIDDEN, DEFAULT_HIDDEN));
  const [views, setViews] = useState<SavedView[]>(() => loadLS(LS_VIEWS, []));
  const [menu, setMenu] = useState<null | 'cols' | 'views' | 'filter'>(null);
  const [expandItem, setExpandItem] = useState<InventoryItem | null>(null);
  const [labelItem, setLabelItem] = useState<InventoryItem | null>(null);
  const [colW, setColW] = useState<ColWidths>(() => loadLS(LS_COLW, { device: {}, accessory: {} }));
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { localStorage.setItem(LS_HIDDEN, JSON.stringify(hidden)); }, [hidden]);
  useEffect(() => { localStorage.setItem(LS_VIEWS, JSON.stringify(views)); }, [views]);
  useEffect(() => { localStorage.setItem(LS_COLW, JSON.stringify(colW)); }, [colW]);

  // Drag-resize: set / clear a column's width override for the active kind.
  const setColumnWidth = (kind: 'device' | 'accessory', key: string, w: number) =>
    setColW(c => ({ ...c, [kind]: { ...c[kind], [key]: Math.max(MIN_COL_W, Math.round(w)) } }));
  const resetColumnWidth = (kind: 'device' | 'accessory', key: string) =>
    setColW(c => { const next = { ...c[kind] }; delete next[key]; return { ...c, [kind]: next }; });
  const resetAllWidths = (kind: 'device' | 'accessory') => setColW(c => ({ ...c, [kind]: {} }));
  // Reset pagination + selection whenever the active page or its filters change.
  useEffect(() => { setPageNum(1); setSelected(new Set()); setBulkResult(null); setBulkPriceOpen(false); }, [page, query, statusFilter, sort]);

  const counts = useMemo(() => ({
    all: inventory.length,
    // Devices tab = current stock only: a sold device is counted under Sold, not
    // here (otherwise it would be double-counted).
    devices: inventory.filter(i => kindOf(i) === 'device' && !isSold(i)).length,
    accessories: inventory.filter(i => kindOf(i) === 'accessory').length,
    sold: inventory.filter(isSold).length,
    lowstock: inventory.filter(isLow).length,
  }), [inventory]);

  const matchesQuery = (i: InventoryItem) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    // Include the combined display value so search matches the Item column (and
    // legacy-named rows), alongside the raw brand/model/item fields.
    return [i.sku, i.manufacturerBarcode, i.imei, i.item, i.brand, i.model, getDeviceDisplayName(i)].some(v => (v || '').toLowerCase().includes(q));
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

  // All devices matching the query + status filter — the shared base for both the
  // Devices ("in stock") view and the Sold view.
  const deviceRows = useMemo(() => {
    let r = inventory.filter(i => kindOf(i) === 'device' && matchesQuery(i));
    if (statusFilter === FLAG_STALE_REPAIR) r = r.filter(i => isStalePendingRepair(i, repairs, Date.now()));
    else if (statusFilter === FLAG_ORPHANED_REPAIR) r = r.filter(i => isOrphanedPendingRepair(i, repairs));
    else if (statusFilter !== 'all') r = r.filter(i => i.deviceStatus === statusFilter);
    // Default order: oldest Date In first, so aging stock surfaces at the top and
    // nothing sits forgotten at the bottom. A user's column-header sort overrides
    // this via applySort.
    r = r.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return applySort(r, DEVICE_COLS);
  }, [inventory, repairs, query, statusFilter, sort]);
  // Devices tab = current stock only: once a device is sold it drops out of here
  // and lives only under the Sold tab.
  const devices = useMemo(() => deviceRows.filter(i => !isSold(i)), [deviceRows]);
  const accessories = useMemo(() => {
    let r = inventory.filter(i => kindOf(i) === 'accessory' && matchesQuery(i)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return applySort(r, ACCESSORY_COLS);
  }, [inventory, query, sort]);

  const soldDevices = deviceRows.filter(isSold);
  const lowAccessories = accessories.filter(isLow);

  // Rows/columns/kind for the currently open sub-page (a single table per page).
  const activeKind: 'device' | 'accessory' = (page === 'accessories' || page === 'lowstock') ? 'accessory' : 'device';
  const activeCols = visibleCols(activeKind === 'device' ? DEVICE_COLS : ACCESSORY_COLS, canViewCost);
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
  const addDeviceRow = async () => {
    const sku = await onGenerateSku('device', 'Phone');
    onSave({ id: uid(), kind: 'device', sku, date: today(), item: '', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, deviceType: 'Phone', brand: '', model: '', storage: '', color: '', carrier: '', batteryHealth: '', condition: 'Good', purchaseSource: '', targetSalePrice: 0, deviceStatus: 'ready', notes: '' });
    setPage('devices');
  };
  const addAccessoryRow = async () => {
    const sku = await onGenerateSku('accessory');
    onSave({ id: uid(), kind: 'accessory', sku, date: today(), item: '', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, manufacturerBarcode: '', category: '', quantity: 1, costPerUnit: 0, sellingPrice: 0, lowStockThreshold: 3, notes: '' });
    setPage('accessories');
  };
  const duplicate = async (i: InventoryItem) => {
    const k = kindOf(i);
    const sku = await onGenerateSku(k, i.deviceType);
    onSave({ ...i, id: uid(), sku, soldDate: '', soldTo: '', salePrice: 0, deviceStatus: k === 'device' ? 'ready' : i.deviceStatus });
  };
  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelAll = (rows: InventoryItem[]) => setSelected(s => {
    const allSel = rows.every(r => s.has(r.id));
    const n = new Set(s); rows.forEach(r => allSel ? n.delete(r.id) : n.add(r.id)); return n;
  });
  const bulkDelete = () => { selected.forEach(id => onDelete(id)); setSelected(new Set()); };
  const bulkStatus = (status: DeviceStatus) => { selected.forEach(id => { const it = inventory.find(x => x.id === id); if (it && kindOf(it) === 'device') onUpdate(id, 'deviceStatus', status); }); };

  // Bulk price / listed actions run each write independently and report which
  // ones actually succeeded — a multi-select action must never silently drop
  // failures for some items while claiming success for the whole selection.
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<{ ok: number; fail: number; failLabels: string[] } | null>(null);
  const [bulkPriceOpen, setBulkPriceOpen] = useState(false);
  const [bulkPriceValue, setBulkPriceValue] = useState('');

  const labelOf = (id: string) => { const it = inventory.find(x => x.id === id); return it?.sku || it?.item || id; };

  const runBulk = async (ids: string[], apply: (id: string) => void | Promise<void>) => {
    setBulkBusy(true);
    setBulkResult(null);
    const results = await Promise.allSettled(ids.map(id => Promise.resolve(apply(id))));
    const fails = results
      .map((r, idx) => ({ r, id: ids[idx] }))
      .filter((x): x is { r: PromiseRejectedResult; id: string } => x.r.status === 'rejected');
    setBulkBusy(false);
    setBulkResult({ ok: ids.length - fails.length, fail: fails.length, failLabels: fails.map(f => labelOf(f.id)) });
  };

  const bulkMarkListed = () => runBulk([...selected], id => onUpdate(id, 'listed', true));

  const applyBulkPrice = () => {
    const price = parseFloat(bulkPriceValue);
    if (!isFinite(price) || price < 0) return;
    setBulkPriceOpen(false); setBulkPriceValue('');
    runBulk([...selected], id => {
      const it = inventory.find(x => x.id === id);
      if (!it) return Promise.reject(new Error('Item no longer exists'));
      return onUpdate(id, priceFieldFor(it), price);
    });
  };

  const bulkPrintShelfTags = () => {
    const items = inventory.filter(i => selected.has(i.id));
    printShelfTagsBatch(items, { storeName: getStoreProfile().storeName });
  };

  const exportCSV = (rows: InventoryItem[], cols: Col[], name: string) => {
    const blob = new Blob([toCSV(rows, cols)], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}_${today()}.csv`; a.click();
  };
  const exportAll = () => exportCSV(inventory, visibleCols([...DEVICE_COLS, ...ACCESSORY_COLS], canViewCost), 'inventory');
  const importCSV = (file: File) => {
    const reader = new FileReader();
    reader.onload = async e => {
      const rows = parseCSV(String(e.target?.result || ''));
      for (const r of rows) {
        const k: ItemKind = (r.kind === 'accessory') ? 'accessory' : 'device';
        const num = (v: string) => parseFloat(v) || 0;
        const base: InventoryItem = {
          id: uid(), kind: k, sku: r.sku || await onGenerateSku(k, (r.deviceType as DeviceType) || undefined),
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
      }
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
                      <optgroup label="Needs attention">
                        {FLAG_OPTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </optgroup>
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
                  <div className="my-1 border-t border-slate-100 dark:border-slate-800" />
                  <button onClick={() => resetAllWidths(activeKind)} disabled={Object.keys(colW[activeKind]).length === 0}
                    className="w-full text-left px-1 py-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:text-slate-400 disabled:no-underline disabled:cursor-default">
                    Reset column widths
                  </button>
                  <p className="text-[11px] text-slate-400 leading-tight mt-1">Tip: drag a column's right edge to resize; double-click the edge to reset it.</p>
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
            <div className="hidden md:flex flex-col gap-2">
              <div className="flex items-center gap-2 flex-wrap bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{selected.size} selected</span>
                {activeKind === 'device' && (
                  <select onChange={e => { if (e.target.value) { bulkStatus(e.target.value as DeviceStatus); e.target.value = ''; } }} className="text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1">
                    <option value="">Set status…</option>
                    {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                )}
                {bulkPriceOpen ? (
                  <span className="flex items-center gap-1">
                    <input autoFocus type="number" step="0.01" min="0" value={bulkPriceValue} onChange={e => setBulkPriceValue(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && applyBulkPrice()} placeholder="New price"
                      className="w-24 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1" />
                    <button onClick={applyBulkPrice} disabled={!bulkPriceValue} className="text-sm px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">Apply</button>
                    <button onClick={() => { setBulkPriceOpen(false); setBulkPriceValue(''); }} className="text-sm px-2 py-1 rounded-md text-slate-500 hover:text-slate-700">Cancel</button>
                  </span>
                ) : (
                  <button onClick={() => setBulkPriceOpen(true)} disabled={bulkBusy} className="text-sm px-2 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 flex items-center gap-1 disabled:opacity-40"><DollarSign className="w-3.5 h-3.5" /> Update Price</button>
                )}
                <button onClick={bulkMarkListed} disabled={bulkBusy} className="text-sm px-2 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 flex items-center gap-1 disabled:opacity-40"><Tag className="w-3.5 h-3.5" /> Mark Listed</button>
                <button onClick={bulkPrintShelfTags} disabled={bulkBusy} className="text-sm px-2 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 flex items-center gap-1 disabled:opacity-40"><Printer className="w-3.5 h-3.5" /> Print Shelf Tags</button>
                <button onClick={() => exportCSV(inventory.filter(i => selected.has(i.id)), activeCols, 'selection')} className="text-sm px-2 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 flex items-center gap-1"><Download className="w-3.5 h-3.5" /> Export</button>
                <button onClick={bulkDelete} className="text-sm px-2 py-1 rounded-md bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300 hover:bg-rose-100 flex items-center gap-1"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
                <button onClick={() => { setSelected(new Set()); setBulkResult(null); }} className="text-sm px-2 py-1 rounded-md text-slate-500 hover:text-slate-700">Clear</button>
                {bulkBusy && <span className="text-xs text-indigo-500">Working…</span>}
              </div>
              {bulkResult && (
                <div className={`flex items-start gap-2 text-sm rounded-lg px-3 py-2 border ${bulkResult.fail > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300' : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'}`}>
                  {bulkResult.fail > 0 ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
                  <span>
                    {bulkResult.fail === 0
                      ? `Updated ${bulkResult.ok} item${bulkResult.ok !== 1 ? 's' : ''}.`
                      : `Updated ${bulkResult.ok} of ${bulkResult.ok + bulkResult.fail} items — ${bulkResult.fail} failed: ${bulkResult.failLabels.join(', ')}.`}
                  </span>
                  <button onClick={() => setBulkResult(null)} className="ml-auto text-xs opacity-70 hover:opacity-100 shrink-0"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
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
                    onUpdate={onUpdate} onDelete={onDelete} onDuplicate={duplicate} onHistory={mode => setHistoryItem({ item: i, mode })}
                    linkedRepair={linkedRepairOf(i.id)} openRepair={openRepairOf(i.id)} onCreateRepair={onCreateRepair} onOpenRepair={onOpenRepair} />
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
                linkedRepairOf={linkedRepairOf} onCreateRepair={onCreateRepair} onOpenRepair={onOpenRepair} openRepairOf={openRepairOf}
                widths={colW[activeKind]} onResize={(key, w) => setColumnWidth(activeKind, key, w)} onResetWidth={(key) => resetColumnWidth(activeKind, key)}
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
            <div className="md:hidden fixed left-0 right-0 bottom-14 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 safe-b">
              {bulkResult && (
                <div className={`flex items-start gap-2 text-xs px-3 py-2 border-b ${bulkResult.fail > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300' : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300'}`}>
                  {bulkResult.fail > 0 ? <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
                  <span>
                    {bulkResult.fail === 0
                      ? `Updated ${bulkResult.ok} item${bulkResult.ok !== 1 ? 's' : ''}.`
                      : `Updated ${bulkResult.ok} of ${bulkResult.ok + bulkResult.fail} — ${bulkResult.fail} failed: ${bulkResult.failLabels.join(', ')}.`}
                  </span>
                  <button onClick={() => setBulkResult(null)} className="ml-auto opacity-70"><X className="w-3.5 h-3.5" /></button>
                </div>
              )}
              {bulkPriceOpen ? (
                <div className="px-3 py-2 flex items-center gap-2">
                  <input autoFocus type="number" step="0.01" min="0" value={bulkPriceValue} onChange={e => setBulkPriceValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && applyBulkPrice()} placeholder="New price"
                    className="flex-1 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1.5" />
                  <button onClick={applyBulkPrice} disabled={!bulkPriceValue} className="text-sm px-3 py-1.5 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">Apply</button>
                  <button onClick={() => { setBulkPriceOpen(false); setBulkPriceValue(''); }} className="text-sm px-2 py-1.5 rounded-md text-slate-500">Cancel</button>
                </div>
              ) : (
                <div className="px-3 py-2 flex items-center gap-2 overflow-x-auto">
                  <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300 shrink-0">{selected.size}</span>
                  {activeKind === 'device' && (
                    <select onChange={e => { if (e.target.value) { bulkStatus(e.target.value as DeviceStatus); e.target.value = ''; } }} className="text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md px-2 py-1.5 shrink-0">
                      <option value="">Status…</option>
                      {STATUS_OPTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  )}
                  <button onClick={() => setBulkPriceOpen(true)} disabled={bulkBusy} aria-label="Update price" className="tap-target flex items-center justify-center rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 shrink-0 disabled:opacity-40"><DollarSign className="w-4 h-4" /></button>
                  <button onClick={bulkMarkListed} disabled={bulkBusy} aria-label="Mark listed" className="tap-target flex items-center justify-center rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 shrink-0 disabled:opacity-40"><Tag className="w-4 h-4" /></button>
                  <button onClick={bulkPrintShelfTags} disabled={bulkBusy} aria-label="Print shelf tags" className="tap-target flex items-center justify-center rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 shrink-0 disabled:opacity-40"><Printer className="w-4 h-4" /></button>
                  <button onClick={() => exportCSV(inventory.filter(i => selected.has(i.id)), activeCols, 'selection')} aria-label="Export selection" className="tap-target flex items-center justify-center rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 shrink-0"><Download className="w-4 h-4" /></button>
                  <button onClick={bulkDelete} aria-label="Delete selection" className="tap-target flex items-center justify-center rounded-md bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-300 shrink-0"><Trash2 className="w-4 h-4" /></button>
                  <button onClick={() => { setSelected(new Set()); setBulkResult(null); }} className="text-sm px-2 py-1 rounded-md text-slate-500 shrink-0">Clear</button>
                </div>
              )}
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
                <optgroup label="Needs attention">
                  {FLAG_OPTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </optgroup>
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

      {expandItem && <ItemFormModal initial={expandItem} deviceBuyers={deviceBuyers} onSave={onSave} onGenerateSku={onGenerateSku} onClose={() => setExpandItem(null)}
        linkedRepair={linkedRepairOf(expandItem.id)}
        onCreateRepair={onCreateRepair ? () => { onCreateRepair(expandItem); setExpandItem(null); } : undefined}
        onOpenRepair={onOpenRepair ? (id: string) => { onOpenRepair(id); setExpandItem(null); } : undefined}
        inventory={inventory}
        customers={customers} onCreateCustomer={onCreateCustomer}
        notes={notes} noteRole={noteRole} onOpenNote={onOpenNote ? (id: string) => { onOpenNote(id); setExpandItem(null); } : undefined} />}
      {labelItem && <Suspense fallback={null}><LabelModal item={labelItem} onClose={() => setLabelItem(null)} /></Suspense>}
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

// Device-only repair row actions, shared by the desktop and mobile menus: open
// the linked internal repair (with its status) if one exists, else offer to
// create one. No-op (empty) for accessories or when the callbacks are absent.
type RowMenuItem = { icon: React.ReactNode; label: string; run: () => void };
const repairMenuItems = (
  item: InventoryItem,
  linkedRepairOf?: (id: string) => Repair | undefined,
  onCreateRepair?: (i: InventoryItem) => void,
  onOpenRepair?: (repairId: string) => void,
): RowMenuItem[] => {
  if (kindOf(item) !== 'device') return [];
  const linked = linkedRepairOf?.(item.id);
  if (linked && onOpenRepair) {
    return [{ icon: <Wrench className="w-4 h-4" />, label: `Repair · ${REPAIR_STATUS_LABEL[linked.status]}`, run: () => onOpenRepair(linked.id) }];
  }
  if (onCreateRepair) {
    return [{ icon: <Wrench className="w-4 h-4" />, label: 'Create repair ticket', run: () => onCreateRepair(item) }];
  }
  return [];
};

/* ---------------- Sheet ---------------- */
const Sheet: React.FC<{
  title: string; total?: number; cols: Col[]; rows: InventoryItem[]; sort: Sort | null; onSort: (k: string) => void;
  selected: Set<string>; onToggleSel: (id: string) => void; onToggleAll: (rows: InventoryItem[]) => void;
  onUpdate: (id: string, f: keyof InventoryItem, v: any) => void; onDelete: (id: string) => void;
  onDuplicate: (i: InventoryItem) => void; onExpand: (i: InventoryItem) => void; onLabel: (i: InventoryItem) => void;
  onHistory: (i: InventoryItem, mode: 'history' | 'audit') => void;
  linkedRepairOf?: (id: string) => Repair | undefined;
  onCreateRepair?: (i: InventoryItem) => void;
  onOpenRepair?: (repairId: string) => void;
  // The still-open ticket (if any) on a device — drives the SKU cell's in-repair
  // highlight. Distinct from linkedRepairOf, which also returns closed tickets.
  openRepairOf?: (id: string) => Repair | undefined;
  widths?: Record<string, number>; onResize?: (key: string, w: number) => void; onResetWidth?: (key: string) => void;
  onAddRow?: () => void; addLabel: string; lowFlag?: boolean;
}> = ({ title, total, cols, rows, sort, onSort, selected, onToggleSel, onToggleAll, onUpdate, onDelete, onDuplicate, onExpand, onLabel, onHistory, linkedRepairOf, onCreateRepair, onOpenRepair, openRepairOf, widths, onResize, onResetWidth, onAddRow, addLabel, lowFlag }) => {
  // Row overflow menu. State lives at the Sheet root and the menu renders outside
  // the sticky table subtree (fixed-positioned) so it isn't clipped or trapped
  // under the sticky columns' stacking context.
  const [menu, setMenu] = useState<{ i: InventoryItem; x: number; y: number } | null>(null);
  const openAt = (e: React.MouseEvent, width: number) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.min(r.left, window.innerWidth - width - 12), y: r.bottom + 4 };
  };

  // Full note viewer: clicking a Notes cell opens the note in a side drawer
  // (truncated in the grid, full text here) instead of an inline input.
  const [notesItem, setNotesItem] = useState<InventoryItem | null>(null);

  // The table is fitted INSIDE this container — it never scrolls horizontally and
  // no column is pushed off-screen. We measure the container so the fit knows how
  // much width is available (and re-fit when the viewport changes).
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  useLayoutEffect(() => {
    const el = containerRef.current; if (!el) return;
    const measure = () => setContainerW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ACTIONS_W = 124; // fits select + edit + print-label + more icons
  // Bounded independent widths: each column keeps its own width, but the whole
  // table is fitted within the container. Any width the columns don't use becomes
  // a trailing spacer a column can grow INTO — once that unused width is consumed
  // the column stops growing, so the table never exceeds the container and no
  // neighbour is shrunk. Widths + the frozen columns' sticky-left offsets ride on
  // CSS vars (via a <colgroup>) so a drag updates them imperatively — no per-row
  // re-render — committing the override on release.
  const fit = fitWidths(cols, ACTIONS_W, containerW, widths ?? {});
  const buildVars = (overrideKey?: string, overrideVal?: number): Record<string, string> => {
    const vars: Record<string, string> = { '--w-actions': `${ACTIONS_W}px` };
    let used = ACTIONS_W, accL = ACTIONS_W;
    for (const c of cols) {
      const w = overrideKey === c.key ? overrideVal! : fit.widths[c.key];
      vars[`--w-${c.key}`] = `${w}px`;
      if (c.frozen) { vars[`--l-${c.key}`] = `${accL}px`; accL += w; }
      used += w;
    }
    // The spacer soaks up any unused container width so the table fills the box.
    vars['--w-spacer'] = `${Math.max(0, containerW - used)}px`;
    return vars;
  };
  // The width CSS vars are owned entirely by this effect (not React's style prop)
  // so React never diffs them away: every render writes the full committed set,
  // overwriting any imperative values left on the table by an in-progress drag.
  const tableRef = useRef<HTMLTableElement>(null);
  useLayoutEffect(() => {
    const t = tableRef.current; if (!t) return;
    const vars = buildVars();
    for (const k in vars) t.style.setProperty(k, vars[k]);
  });

  // Live drag-resize: only the dragged column changes. Growth is capped to the
  // currently-unused width (`fit.spacer`) so the table can never overflow the
  // container and neighbours are never shrunk; shrinking is bounded only by the
  // column's own min. The override is committed to state (+localStorage) on
  // release. Once no unused width remains, a column simply can't grow further.
  const startResize = (e: React.MouseEvent, c: Col) => {
    e.preventDefault(); e.stopPropagation();
    const table = tableRef.current;
    const startX = e.clientX;
    const startW = fit.widths[c.key];
    const slack = fit.spacer; // unused container width available to grow into
    let latest = startW;
    const apply = () => {
      if (!table) return;
      const vars = buildVars(c.key, latest);
      for (const k in vars) table.style.setProperty(k, vars[k]);
    };
    const onMove = (ev: MouseEvent) => {
      const proposed = startW + (ev.clientX - startX);
      latest = Math.min(clampWidth(c, proposed), startW + slack);
      apply();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      onResize?.(c.key, latest);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  };
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
      {/* Fitted table: vertical scroll only — never horizontal (the fit keeps
          every column inside this box). */}
      <div ref={containerRef} className="overflow-x-hidden overflow-y-auto max-h-[60vh]">
        <table ref={tableRef} className="border-collapse w-full" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: 'var(--w-actions)' }} />
            {cols.map(c => <col key={c.key} style={{ width: `var(--w-${c.key})` }} />)}
            {/* Trailing spacer soaks up any unused container width. */}
            <col style={{ width: 'var(--w-spacer)' }} />
          </colgroup>
          <thead className="sticky top-0 z-20 bg-slate-50 dark:bg-slate-800">
            <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold">
              <th style={{ left: 0, top: 0 }} className="px-2 py-2 text-center border-b border-slate-200 dark:border-slate-700 sticky !z-30 bg-slate-50 dark:bg-slate-800">
                <div className="flex items-center gap-1 justify-center">
                  <button onClick={() => onToggleAll(rows)}>{allSel ? <CheckSquare className="w-4 h-4 text-indigo-500" /> : <Square className="w-4 h-4 text-slate-400" />}</button>
                  <span>Actions</span>
                </div>
              </th>
              {cols.map(c => (
                <th key={c.key}
                  style={c.frozen ? { left: `var(--l-${c.key})`, top: 0, position: 'sticky' as const } : { top: 0 }}
                  onClick={() => onSort(c.key)}
                  className={`relative px-2 py-2 border-b border-slate-200 dark:border-slate-700 cursor-pointer select-none hover:text-indigo-600 sticky top-0 ${c.align === 'right' ? 'text-right' : 'text-left'} ${c.frozen ? 'z-30 bg-slate-50 dark:bg-slate-800' : 'z-20 bg-slate-50 dark:bg-slate-800'}`}>
                  <span className="inline-flex items-center gap-1">{c.label}{sort?.key === c.key && (sort.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}</span>
                  {onResize && (
                    <span onMouseDown={e => startResize(e, c)} onClick={e => e.stopPropagation()} onDoubleClick={e => { e.stopPropagation(); onResetWidth?.(c.key); }}
                      title="Drag to resize · double-click to reset"
                      className="group/rz absolute top-0 right-0 h-full w-2.5 flex justify-center cursor-col-resize z-10">
                      <span className="block w-px h-full bg-slate-200 dark:bg-slate-700 group-hover/rz:bg-indigo-500 group-hover/rz:w-0.5" />
                    </span>
                  )}
                </th>
              ))}
              <th aria-hidden style={{ top: 0 }} className="sticky top-0 z-20 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.length === 0 && <tr><td colSpan={cols.length + 2} className="text-center text-slate-400 text-sm py-8">No items.</td></tr>}
            {rows.map(i => {
              const low = lowFlag && isLow(i);
              const sel = selected.has(i.id);
              const openRepair = openRepairOf?.(i.id);
              // Frozen cells need an opaque background so scrolled content can't show through.
              const frozenBg = sel ? 'bg-indigo-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-900';
              return (
                <tr key={i.id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${sel ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : low ? 'bg-rose-50/40 dark:bg-rose-900/10' : ''}`}>
                  <td style={{ left: 0 }} className={`px-2 py-1.5 whitespace-nowrap sticky z-10 ${frozenBg}`}>
                    <div className="flex items-center gap-1">
                      <button onClick={() => onToggleSel(i.id)} className="p-1" title="Select">{sel ? <CheckSquare className="w-4 h-4 text-indigo-500" /> : <Square className="w-4 h-4 text-slate-300" />}</button>
                      <button onClick={() => onExpand(i)} className="p-1 text-slate-400 hover:text-indigo-600" title="Edit"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => onLabel(i)} className="p-1 text-slate-400 hover:text-indigo-600" title="Print label"><Printer className="w-4 h-4" /></button>
                      <button onClick={e => setMenu({ i, ...openAt(e, 180) })} className="p-1 text-slate-400 hover:text-indigo-600" title="More actions"><MoreVertical className="w-4 h-4" /></button>
                    </div>
                  </td>
                  {cols.map(c => (
                    <td key={c.key}
                      style={{ overflow: 'hidden', ...(c.frozen ? { left: `var(--l-${c.key})`, position: 'sticky' as const } : {}) }}
                      className={`p-0 align-top ${c.frozen ? `sticky z-10 ${frozenBg}` : ''}`}>
                      {c.key === 'sku' && openRepair ? (
                        // Device is on the bench: the SKU cell itself carries the
                        // flag (the owner's device table has no Status column and
                        // isn't getting one) and opens the ticket on click.
                        <button onClick={() => onOpenRepair?.(openRepair.id)} title={repairSkuTitle(openRepair)}
                          disabled={!onOpenRepair}
                          className={`w-full h-full text-left px-2 py-1.5 flex items-center gap-1 ${REPAIR_SKU_CELL} ${onOpenRepair ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}`}>
                          <Wrench className="w-3 h-3 shrink-0" />
                          <span className="truncate">{(i.sku as any) || '—'}</span>
                        </button>
                      ) : c.key === 'notes' ? (
                        // Notes: truncated in the grid; click opens the full note in a drawer.
                        <button onClick={() => setNotesItem(i)} title={String((i.notes as any) ?? '')}
                          className={`w-full text-left px-2 py-1.5 text-sm truncate rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20 ${emph(c)}`}>
                          {i.notes ? String(i.notes) : <span className="text-slate-300 dark:text-slate-600 italic">Add note…</span>}
                        </button>
                      ) : c.key === '__item' ? (
                        // Item: a single plain text field typed straight into `item`.
                        // Empty legacy rows show their brand+model name as a
                        // placeholder (still displayed everywhere via the helper).
                        //
                        // A device also listed on an external marketplace carries
                        // its flag HERE, beside the name — the same cell the mobile
                        // item card badges, and the same reasoning as the in-repair
                        // SKU cell above: this table has no Status column and isn't
                        // getting one, so an existing cell has to carry the state.
                        // The badge is `shrink-0` beside a `flex-1 min-w-0` input,
                        // so it never widens the column or clips itself — the input
                        // gives up the width, exactly as the SKU truncates for the
                        // wrench icon. Unlisted devices render the bare input, byte
                        // for byte what they rendered before.
                        (i.listedPlatforms?.length || 0) > 0 ? (
                          <div className="flex items-center gap-1 pr-1">
                            <input type="text" value={(i.item as any) ?? ''} title={c.compute!(i)}
                              placeholder={c.compute!(i) === '—' ? 'Item name' : c.compute!(i)}
                              onChange={e => onUpdate(i.id, 'item', e.target.value)}
                              className={`${cellBase} flex-1 min-w-0 ${emph(c)}`} />
                            {/* ICON ONLY — no text at all. The platform name
                                lives in the hover title instead, which is
                                what the owner asked for: the flag should
                                take almost no width in the column, and
                                say "Best Buy" when you point at it. */}
                            <span title={listedElsewhereTitle(i.listedPlatforms)}
                              aria-label={listedElsewhereTitle(i.listedPlatforms)}
                              className={`shrink-0 inline-flex items-center p-0.5 rounded ${LISTED_CELL}`}>
                              <Tag className="w-3 h-3 shrink-0" />
                            </span>
                          </div>
                        ) : (
                          <input type="text" value={(i.item as any) ?? ''} title={c.compute!(i)}
                            placeholder={c.compute!(i) === '—' ? 'Item name' : c.compute!(i)}
                            onChange={e => onUpdate(i.id, 'item', e.target.value)}
                            className={`${cellBase} ${emph(c)}`} />
                        )
                      ) : c.type === 'computed' ? (
                        <div title={c.compute!(i)} className={`px-2 py-1.5 text-sm truncate ${c.align === 'right' ? 'text-right font-mono' : ''} ${emph(c)}`}>
                          {c.key === '__profit' && i.soldDate ? <span className={profitOf(i) >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{c.compute!(i)}</span> : c.compute!(i)}
                        </div>
                      ) : c.readOnly ? (
                        <div title={String((i[c.key as keyof InventoryItem] as any) ?? '')} className={`px-2 py-1.5 text-sm truncate ${emph(c)}`}>{((i[c.key as keyof InventoryItem] as any) ?? '') || '—'}</div>
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
                      ) : c.key === 'salePrice' ? (
                        // Actual: editable directly (records a private/off-POS sale).
                        // Commits on blur so the row isn't marked sold mid-keystroke;
                        // stays blank until a real sale exists.
                        <ActualCell item={i} onCommit={v => onUpdate(i.id, 'salePrice', v)}
                          className={`${cellBase} ${emph(c)} text-right font-mono dark:[color-scheme:dark]`} />
                      ) : c.type === 'date' ? (
                        // Date shows a dash placeholder (not the native yyyy-mm-dd) when empty.
                        <DateCell value={(i[c.key as keyof InventoryItem] as any) ?? ''}
                          onChange={v => onUpdate(i.id, c.key as keyof InventoryItem, v)}
                          className={`${cellBase} ${emph(c)} dark:[color-scheme:dark]`} />
                      ) : (
                        <div className="relative">
                          {low && c.key === 'quantity' && <AlertTriangle className="w-3 h-3 text-rose-500 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none" />}
                          <input type={c.type === 'number' ? 'number' : 'text'}
                            value={(i[c.key as keyof InventoryItem] as any) ?? (c.type === 'number' ? 0 : '')}
                            title={c.type === 'text' ? String((i[c.key as keyof InventoryItem] as any) ?? '') : undefined}
                            onChange={e => onUpdate(i.id, c.key as keyof InventoryItem, c.type === 'number' ? (parseFloat(e.target.value) || 0) : e.target.value)}
                            className={`${cellBase} ${emph(c)} ${c.align === 'right' ? 'text-right font-mono' : ''} ${c.key === 'sku' ? 'font-mono text-xs' : ''} dark:[color-scheme:dark]`} />
                        </div>
                      )}
                    </td>
                  ))}
                  <td aria-hidden />
                </tr>
              );
            })}
            {onAddRow && (
              <tr>
                <td colSpan={cols.length + 2} className="px-2 py-2">
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
              { icon: <QrCode className="w-4 h-4" />, label: 'QR Code', run: () => onLabel(menu.i) },
              { icon: <Tag className="w-4 h-4" />, label: 'Print Shelf Tag', run: () => printShelfTag(menu.i, { storeName: getStoreProfile().storeName }) },
              { icon: <Copy className="w-4 h-4" />, label: 'Duplicate', run: () => onDuplicate(menu.i) },
              ...repairMenuItems(menu.i, linkedRepairOf, onCreateRepair, onOpenRepair),
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

      {/* Full-note side drawer (opened from a Notes cell) */}
      {notesItem && (
        <NotesDrawer item={notesItem} onUpdate={onUpdate} onClose={() => setNotesItem(null)} />
      )}
    </div>
  );
};

/* Full note viewer/editor — a responsive right-side drawer. Notes are truncated
   in the grid (capped ~300px); the full text is read and edited here. */
const NotesDrawer: React.FC<{ item: InventoryItem; onUpdate: (id: string, f: keyof InventoryItem, v: any) => void; onClose: () => void }> = ({ item, onUpdate, onClose }) => {
  const [text, setText] = useState(String((item.notes as any) ?? ''));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const title = nameOf(item);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 animate-fadeIn" role="dialog" aria-modal="true" aria-label="Note">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[85vh] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl flex flex-col">
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Note</p>
            <h2 className="font-bold text-slate-800 dark:text-slate-100 truncate">{title}</h2>
          </div>
          <button onClick={onClose} className="shrink-0 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 flex-1 overflow-y-auto">
          <textarea autoFocus value={text} onChange={e => { setText(e.target.value); onUpdate(item.id, 'notes', e.target.value); }}
            placeholder="Write a note for this item…"
            className="w-full h-full min-h-[240px] resize-none rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 text-sm text-slate-800 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium">Done</button>
        </div>
      </div>
    </div>
  );
};

/* ---------------- Mobile inventory card ---------------- */
const salePriceOf = (i: InventoryItem) => kindOf(i) === 'device' ? (i.salePrice || i.targetSalePrice || 0) : (i.sellingPrice || 0);
const costOf = (i: InventoryItem) => kindOf(i) === 'device' ? (i.purchaseCost || 0) : (i.costPerUnit || 0);
const nameOf = (i: InventoryItem) => {
  if (kindOf(i) === 'accessory') return i.item || i.sku || 'Item';
  const n = getDeviceDisplayName(i);
  return n === '—' ? (i.sku || 'Item') : n;
};

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
  linkedRepair?: Repair;
  openRepair?: Repair;   // still-open ticket — highlights the card's SKU row
  onCreateRepair?: (i: InventoryItem) => void;
  onOpenRepair?: (repairId: string) => void;
}> = ({ item: i, canViewCost, selectMode, selected, onToggleSel, onOpen, onLabel, onDelete, onDuplicate, onHistory, linkedRepair, openRepair, onCreateRepair, onOpenRepair }) => {
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
            {i.listed && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">Listed</span>}
            {/* Same tiny blue icon as the desktop table's Item cell —
                one state, one colour, one shape in both views. The
                site name is in the hover/accessible label. */}
            {(i.listedPlatforms?.length || 0) > 0 && (
              <span title={listedElsewhereTitle(i.listedPlatforms)}
                aria-label={listedElsewhereTitle(i.listedPlatforms)}
                className={`shrink-0 inline-flex items-center p-0.5 rounded ${LISTED_CELL}`}>
                <Tag className="w-3 h-3 shrink-0" />
              </span>
            )}
            {/* Devices no longer show a status badge here (status removed from the
                device view); accessories still flag low stock. */}
            {!isDevice && (i.quantity ?? 0) <= (i.lowStockThreshold ?? 0) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">Low · {i.quantity ?? 0}</span>}
            {isDevice && linkedRepair && (
              <span onClick={e => { e.stopPropagation(); onOpenRepair?.(linkedRepair.id); }}
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
                <Wrench className="w-3 h-3" /> {REPAIR_STATUS_LABEL[linkedRepair.status]}
              </span>
            )}
          </div>
        </button>
        <div className="flex items-center gap-0.5 shrink-0">
          <button onClick={onLabel} aria-label="Print label" title="Print label" className="tap-target flex items-center justify-center text-slate-400 hover:text-indigo-600"><Printer className="w-4 h-4" /></button>
          <button onClick={() => setMenu(m => !m)} aria-label="More actions" className="tap-target flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><MoreVertical className="w-5 h-5" /></button>
        </div>
      </div>

      <button onClick={tap} className="w-full text-left mt-2 block">
        <Row label="SKU">
          {openRepair ? (
            // Same in-repair treatment as the table's SKU cell, on the card's SKU row.
            <span onClick={e => { e.stopPropagation(); onOpenRepair?.(openRepair.id); }} title={repairSkuTitle(openRepair)}
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${REPAIR_SKU_CELL}`}>
              <Wrench className="w-3 h-3 shrink-0" />{i.sku || '—'}
            </span>
          ) : <span className="font-mono">{i.sku || '—'}</span>}
        </Row>
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
              { icon: <Tag className="w-4 h-4" />, label: 'Print Shelf Tag', run: () => printShelfTag(i, { storeName: getStoreProfile().storeName }) },
              { icon: <Copy className="w-4 h-4" />, label: 'Copy SKU', run: () => copy(i.sku) },
              ...(isDevice && i.imei ? [{ icon: <Copy className="w-4 h-4" />, label: 'Copy IMEI/Serial', run: () => copy(i.imei) }] : []),
              { icon: <Copy className="w-4 h-4" />, label: 'Duplicate', run: () => onDuplicate(i) },
              ...repairMenuItems(i, () => linkedRepair, onCreateRepair, onOpenRepair),
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
