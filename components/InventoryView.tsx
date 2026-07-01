import React, { useState, useMemo, useRef } from 'react';
import {
  Search, Plus, Smartphone, Package, Tag, QrCode, Pencil, Trash2, X,
  AlertTriangle, ScanLine,
} from 'lucide-react';
import { InventoryItem, Runner, ItemKind, DeviceType, DeviceStatus } from '../types';
import { ItemFormModal } from './ItemFormModal';
import { LabelModal } from './LabelModal';

interface Props {
  inventory: InventoryItem[];
  runners: Runner[];
  onSave: (item: InventoryItem) => void;
  onDelete: (id: string) => void;
  onGenerateSku: (kind: ItemKind, deviceType?: DeviceType) => string;
}

type Tab = 'all' | 'devices' | 'accessories' | 'sold' | 'lowstock';

const kindOf = (i: InventoryItem): ItemKind => i.kind ?? 'device';
const isSold = (i: InventoryItem) => kindOf(i) === 'device' && (!!i.soldDate || i.deviceStatus === 'sold');
const isLow = (i: InventoryItem) =>
  kindOf(i) === 'accessory' && (i.quantity ?? 0) <= (i.lowStockThreshold ?? 0);

const STATUS_LABEL: Record<DeviceStatus, { label: string; cls: string }> = {
  pending_purchase: { label: 'Pending Purchase', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  pending_repair: { label: 'Pending Repair', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  ready: { label: 'Ready', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  sold: { label: 'Sold', cls: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300' },
  returned: { label: 'Returned', cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' },
};

export const InventoryView: React.FC<Props> = ({ inventory, runners, onSave, onDelete, onGenerateSku }) => {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formKind, setFormKind] = useState<ItemKind>('device');
  const [editing, setEditing] = useState<InventoryItem | undefined>();
  const [labelItem, setLabelItem] = useState<InventoryItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const counts = useMemo(() => ({
    all: inventory.length,
    devices: inventory.filter(i => kindOf(i) === 'device').length,
    accessories: inventory.filter(i => kindOf(i) === 'accessory').length,
    sold: inventory.filter(isSold).length,
    lowstock: inventory.filter(isLow).length,
  }), [inventory]);

  const filtered = useMemo(() => {
    let list = inventory;
    if (tab === 'devices') list = list.filter(i => kindOf(i) === 'device');
    else if (tab === 'accessories') list = list.filter(i => kindOf(i) === 'accessory');
    else if (tab === 'sold') list = list.filter(isSold);
    else if (tab === 'lowstock') list = list.filter(isLow);

    const q = query.toLowerCase().trim();
    if (q) {
      // Scan/search order: SKU, manufacturer barcode, IMEI/serial, then name.
      list = list.filter(i =>
        (i.sku || '').toLowerCase().includes(q) ||
        (i.manufacturerBarcode || '').toLowerCase().includes(q) ||
        (i.imei || '').toLowerCase().includes(q) ||
        (i.item || '').toLowerCase().includes(q) ||
        (i.brand || '').toLowerCase().includes(q) ||
        (i.model || '').toLowerCase().includes(q)
      );
    }
    return list.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }, [inventory, tab, query]);

  const openAdd = (kind: ItemKind) => { setFormKind(kind); setEditing(undefined); setShowForm(true); };
  const openEdit = (i: InventoryItem) => { setEditing(i); setShowForm(true); };

  const tabBtn = (id: Tab, label: string, n: number) => (
    <button onClick={() => setTab(id)}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
        tab === id ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
      }`}>
      {label} <span className={`ml-1 text-xs ${tab === id ? 'text-indigo-200' : 'text-slate-400'}`}>{n}</span>
    </button>
  );

  const money = (n?: number) => `$${(n || 0).toFixed(2)}`;

  return (
    <div className="flex flex-col gap-4">
      {/* Header controls */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Inventory</h1>
        <div className="flex gap-2">
          <button onClick={() => openAdd('device')} className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
            <Smartphone className="w-4 h-4" /> Add Device
          </button>
          <button onClick={() => openAdd('accessory')} className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400">
            <Package className="w-4 h-4" /> Add Accessory
          </button>
        </div>
      </div>

      {/* Search — accepts USB/Bluetooth scanner input (types into this focused field) */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          ref={searchRef}
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Scan or search by SKU, IMEI, serial, barcode, or name…"
          className="w-full pl-9 pr-24 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[11px] text-slate-400">
          <ScanLine className="w-3.5 h-3.5" /> scanner ready
        </span>
        {query && (
          <button onClick={() => { setQuery(''); searchRef.current?.focus(); }} className="absolute right-24 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabBtn('all', 'All', counts.all)}
        {tabBtn('devices', 'Devices', counts.devices)}
        {tabBtn('accessories', 'Accessories', counts.accessories)}
        {tabBtn('sold', 'Sold', counts.sold)}
        {tabBtn('lowstock', 'Low Stock', counts.lowstock)}
      </div>

      {/* List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
        {filtered.length === 0 && (
          <div className="text-center text-slate-400 text-sm py-12">No items in this view.</div>
        )}
        {filtered.map(i => {
          const device = kindOf(i) === 'device';
          const sold = isSold(i);
          const low = isLow(i);
          const profit = i.salePrice ? i.salePrice - i.purchaseCost - (i.repairCost || 0) : 0;
          return (
            <div key={i.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/50">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${device ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400'}`}>
                {device ? <Smartphone className="w-4 h-4" /> : <Package className="w-4 h-4" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs text-slate-400">{i.sku || '—'}</span>
                  <span className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">
                    {i.item || [i.brand, i.model, i.storage].filter(Boolean).join(' ') || 'Untitled'}
                  </span>
                  {device && i.deviceStatus && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${STATUS_LABEL[i.deviceStatus].cls}`}>{STATUS_LABEL[i.deviceStatus].label}</span>
                  )}
                  {low && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Low
                    </span>
                  )}
                </div>
                <div className="flex gap-3 mt-0.5 text-xs text-slate-400 flex-wrap">
                  {device
                    ? <><span>{i.imei || 'No IMEI'}</span>{i.carrier && <span>· {i.carrier}</span>}{i.condition && <span>· {i.condition}</span>}{i.runnerName && <span>· runner: {i.runnerName}</span>}</>
                    : <><span>{i.category || 'Accessory'}</span>{i.manufacturerBarcode && <span className="flex items-center gap-1"><Tag className="w-3 h-3" />{i.manufacturerBarcode}</span>}</>
                  }
                </div>
              </div>

              <div className="text-right shrink-0 hidden sm:block">
                {device ? (
                  sold
                    ? <><p className={`text-sm font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{money(profit)}</p><p className="text-[11px] text-slate-400">profit</p></>
                    : <><p className="text-sm font-medium text-slate-600 dark:text-slate-300">{money(i.purchaseCost + (i.repairCost || 0))}</p><p className="text-[11px] text-slate-400">total cost</p></>
                ) : (
                  <><p className={`text-sm font-bold ${low ? 'text-rose-600' : 'text-slate-700 dark:text-slate-200'}`}>{i.quantity ?? 0} in stock</p><p className="text-[11px] text-slate-400">{money(i.sellingPrice)} ea</p></>
                )}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setLabelItem(i)} title="Print label" className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20"><QrCode className="w-4 h-4" /></button>
                <button onClick={() => openEdit(i)} title="Edit" className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => onDelete(i.id)} title="Delete" className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          );
        })}
      </div>

      {showForm && (
        <ItemFormModal
          initial={editing}
          initialKind={formKind}
          runners={runners}
          onSave={onSave}
          onGenerateSku={onGenerateSku}
          onClose={() => { setShowForm(false); setEditing(undefined); }}
        />
      )}
      {labelItem && <LabelModal item={labelItem} onClose={() => setLabelItem(null)} />}
    </div>
  );
};
