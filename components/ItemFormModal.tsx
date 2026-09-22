import React, { useState, useMemo, useRef, useEffect, FocusEventHandler } from 'react';
import { X, Wand2, Smartphone, Package, Barcode, Camera, Tag } from 'lucide-react';
import { printShelfTag } from '../services/shelfTag';
import { getStoreProfile } from './SettingsModal';
import { InventoryItem, ItemKind, DeviceType, DeviceStatus, DeviceBuyer, Repair, ListingPlatform, Note, Role, Customer } from '../types';
import { SellerCustomerField } from './SellerCustomerField';
import { useSellerLink } from '../hooks/useSellerLink';
import { CustomerDraft } from '../domain/customers';
import { LinkedNotes } from './LinkedNotes';
import { REPAIR_STATUS_LABEL } from '../domain/repairs';
import { LISTING_PLATFORMS } from '../domain/listing';
import { findDuplicateDevice } from '../domain/autoInventory';
import { AlertTriangle } from 'lucide-react';
import { ImeiScanner } from './ImeiScanner';
import { Wrench } from 'lucide-react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { selectOnFocus } from '../hooks/selectOnFocus';
import { todayISO } from '../domain/dates';
import { costAccessFor, RECORDED_LABEL } from '../domain/costVisibility';
import { normalizeForLookup } from '../domain/identifierSearch';

interface Props {
  initial?: InventoryItem;
  initialKind?: ItemKind;
  // reports.profit.detailed. Without it, a cost that is already RECORDED shows
  // as a word rather than a figure and is read-only; a BLANK one is still
  // enterable, which is the point — an employee adding a device must be able
  // to put the cost in, just not read one back.
  canViewCost?: boolean;
  deviceBuyers: DeviceBuyer[];
  onSave: (item: InventoryItem) => void;
  onGenerateSku: (kind: ItemKind, deviceType?: DeviceType) => Promise<string>;
  onClose: () => void;
  // Internal repair linking (owner/manager). The linked ticket (if any) is shown
  // read-only for review; the item's own repair cost is set manually, never
  // synced from the ticket.
  linkedRepair?: Repair;
  onCreateRepair?: () => void;
  onOpenRepair?: (repairId: string) => void;
  // Existing inventory, for the duplicate IMEI/serial guard. Optional so the
  // form still renders for callers that don't have the list; the guard simply
  // doesn't engage without it.
  inventory?: InventoryItem[];
  // Customer list + inline creation for the "Bought From" picker — the same
  // field, behaving the same way, as on Quick Purchase. Optional: without
  // them the field is plain free text exactly as before.
  customers?: Customer[];
  onCreateCustomer?: (draft: CustomerDraft) => Customer | undefined;
  notes?: Note[];                        // workspace notes, for the linked-notes panel
  noteRole?: Role;                       // viewer's role, gates which linked notes show
  onOpenNote?: (noteId: string) => void; // jump to a linked note in the Notes board
  // Open the existing device the duplicate guard found, so "already in
  // inventory" is one click from the record rather than an instruction to go
  // and find it.
  onOpenDuplicate?: (item: InventoryItem) => void;
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
const today = () => todayISO();

const inp = 'w-full p-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md text-sm focus:ring-indigo-500 focus:border-indigo-500';
const lbl = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

// Defined at MODULE scope (not inside ItemFormModal) on purpose: a component
// declared inside another component's body gets a new function identity on every
// render, so React unmounts/remounts its DOM subtree each time the parent
// re-renders — which for a text input means losing focus after every keystroke.
// Hoisting it keeps the input mounted so typing stays continuous.
const Field: React.FC<{ label: string; value: unknown; onChange: (v: string) => void; type?: string; placeholder?: string; onFocus?: FocusEventHandler<HTMLInputElement> }> = ({ label, value, onChange, type = 'text', placeholder = '', onFocus }) => (
  <div>
    <label className={lbl}>{label}</label>
    <input type={type} className={inp} placeholder={placeholder}
      value={(value as any) ?? ''} onChange={e => onChange(e.target.value)} onFocus={onFocus} />
  </div>
);

/**
 * A cost field staff may RECORD but not READ.
 *
 * Blank → an ordinary input, so an employee adding a device can put the cost
 * in (the point of the whole change). Already recorded → the word, read-only,
 * and the figure never reaches the DOM. Not a disabled input holding the
 * value, which would put it there.
 */
const CostField: React.FC<{
  label: string; value: unknown; onChange: (v: string) => void; canViewCost: boolean;
  onFocus?: FocusEventHandler<HTMLInputElement>;
}> = ({ label, value, onChange, canViewCost, onFocus }) => {
  const access = costAccessFor(canViewCost, value);
  if (access === 'locked') {
    return (
      <div>
        <label className={lbl}>{label}</label>
        <div className={`${inp} text-slate-400 italic select-none`}>{RECORDED_LABEL}</div>
      </div>
    );
  }
  return <Field label={label} value={value} onChange={onChange} type="number" onFocus={onFocus} />;
};

export const ItemFormModal: React.FC<Props> = ({ initial, initialKind, canViewCost = false, deviceBuyers, onSave, onGenerateSku, onClose, linkedRepair, onCreateRepair, onOpenRepair, inventory = [], customers, onCreateCustomer, notes, noteRole, onOpenNote, onOpenDuplicate }) => {
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
  const toggleListedPlatform = (p: ListingPlatform) => setF(prev => {
    const cur = prev.listedPlatforms || [];
    return { ...prev, listedPlatforms: cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p] };
  });

  // Snapshot the form at mount for a dirty check, so a stray backdrop/X/Cancel
  // click doesn't silently discard typed changes.
  const [snapshot] = useState(() => JSON.stringify({ kind, f }));
  const dirty = JSON.stringify({ kind, f }) !== snapshot;
  const requestClose = () => { if (!dirty || window.confirm('Discard unsaved changes to this item?')) onClose(); };
  useEscapeKey(requestClose);

  const genSku = async () => set('sku', await onGenerateSku(kind, f.deviceType));

  // A USB/Bluetooth scanner types wherever the caret is and then sends Enter.
  // On a NEW item the caret goes into the code field, so a scan works with
  // zero clicks — which was the whole problem with the old "Add Device", where
  // nothing was focused and the code went nowhere.
  // A typed seller becomes a customer on save — one shared path
  // (domain/sellerLink.ts), the same one Quick Purchase uses.
  const sellerLink = useSellerLink({ customers: customers || [], onCreateCustomer });

  const codeRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!initial) codeRef.current?.focus(); }, [initial]);

  // ENTER IN THE CODE FIELD MUST NOT SUBMIT. Scanners always send it, and a
  // form that closes on the scan is a form you can never fill in. Enter accepts
  // the code and moves to the next field instead.
  const onCodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    nextRef.current?.focus();
  };

  // Same normalization + matching auto-inventory and Quick Purchase use — a
  // device already in stock must not be enterable a second time by hand.
  const duplicate = useMemo(
    () => (kind === 'device' ? findDuplicateDevice(f.imei || '', inventory, f.id) : undefined),
    [kind, f.imei, f.id, inventory],
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Where the existing device actually is, so "already in inventory" answers
  // the next question without another search.
  const duplicateWhere = duplicate
    ? (duplicate.soldDate || duplicate.deviceStatus === 'sold' ? 'Sold'
      : duplicate.deviceStatus === 'reserved' ? 'Reserved'
      : duplicate.deviceStatus === 'pending_repair' ? 'In repair' : 'In stock')
    : '';

  const save = () => {
    if (duplicate || saving) return;
    sellerLink.resolve(
      { name: f.boughtFrom || '', phone: f.boughtFromPhone, customerId: f.boughtFromCustomerId },
      boughtFromCustomerId => commit(boughtFromCustomerId),
    );
  };

  const commit = async (boughtFromCustomerId: string | undefined) => {
    setSaving(true);
    setSaveError(null);
    try {
      // THE SKU IS ALLOCATED HERE, NOT WHEN THE FORM OPENED. Allocating on open
      // burned a number on every abandoned form, and the counter never went
      // back. (onGenerateSku refuses offline with its own message — surfaced
      // below rather than swallowed, so an offline save says so instead of
      // appearing to work.)
      const sku = f.sku?.trim() || await onGenerateSku(kind, f.deviceType);
      const item: InventoryItem = { ...f, kind, sku, boughtFromCustomerId };
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
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Could not save this item.');
    } finally {
      setSaving(false);
    }
  };

  const canSave = (kind === 'device' ? !!(f.item || f.brand || f.model || f.imei) : !!f.item) && !duplicate && !saving;

  // Text/date fields go straight through; number fields parse to a number.
  const setText = (k: keyof InventoryItem) => (v: string) => set(k, v as any);
  const setNum = (k: keyof InventoryItem) => (v: string) => set(k, (parseFloat(v) || 0) as any);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={requestClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl border border-slate-200 dark:border-slate-700 max-h-[92vh] overflow-y-auto custom-scrollbar" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center sticky top-0 bg-white dark:bg-slate-900 z-10">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">{initial ? 'Edit Item' : 'Add Item'}</h2>
          <button onClick={requestClose}><X className="w-5 h-5 text-slate-400" /></button>
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
                <input ref={nextRef} className={inp} value={f.sku ?? ''} onChange={e => set('sku', e.target.value)} placeholder="Allocated on save" />
                <button onClick={genSku} title="Generate SKU" className="shrink-0 px-3 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white"><Wand2 className="w-4 h-4" /></button>
              </div>
            </div>
            <div>
              <label className={lbl}>{kind === 'device' ? 'Scan or type IMEI' : 'Scan or type barcode'}</label>
              {kind === 'device' ? (
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <Barcode className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                    <input ref={codeRef} className={`${inp} pl-8`} value={f.imei}
                      onChange={e => set('imei', e.target.value)}
                      onKeyDown={onCodeKeyDown}
                      // Stored with separators stripped, so every IMEI written
                      // from here on matches a scan without the search having
                      // to guess how it was punctuated.
                      onBlur={e => { const n = normalizeForLookup(e.target.value); if (n && n !== e.target.value) set('imei', n); }}
                      placeholder="Scan or type IMEI" />
                  </div>
                  <button type="button" onClick={() => setShowImeiScanner(true)} title="Scan IMEI / serial with camera"
                    className="shrink-0 px-3 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-500 hover:text-indigo-600 hover:border-indigo-400 transition-colors">
                    <Camera className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Barcode className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                  <input ref={codeRef} className={`${inp} pl-8`} value={f.manufacturerBarcode ?? ''}
                    onChange={e => set('manufacturerBarcode', e.target.value)}
                    onKeyDown={onCodeKeyDown}
                    onBlur={e => { const n = normalizeForLookup(e.target.value); if (n && n !== e.target.value) set('manufacturerBarcode', n); }}
                    placeholder="Scan or type barcode" />
                </div>
              )}
              {/* Blocks the save rather than silently creating a second record
                  for one physical device, or merging into the existing one
                  behind the user's back. */}
              {duplicate && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>
                    Already in inventory — <strong>{duplicate.sku || duplicate.item || duplicate.id}</strong>
                    {duplicate.item && duplicate.sku ? ` (${duplicate.item})` : ''}, {duplicateWhere}.
                    {onOpenDuplicate && (
                      <> <button type="button" onClick={() => onOpenDuplicate(duplicate)} className="underline font-semibold hover:opacity-80">Open it</button></>
                    )}
                  </span>
                </p>
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
                <Field label="Brand" value={f.brand} onChange={setText('brand')} placeholder="Apple" />
                <Field label="Model" value={f.model} onChange={setText('model')} placeholder="iPhone 14 Pro" />
                <Field label="Storage" value={f.storage} onChange={setText('storage')} placeholder="256GB" />
                <Field label="Color" value={f.color} onChange={setText('color')} placeholder="Space Black" />
                <Field label="Carrier" value={f.carrier} onChange={setText('carrier')} placeholder="Unlocked" />
                <Field label="Battery Health" value={f.batteryHealth} onChange={setText('batteryHealth')} placeholder="92%" />
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
                <Field label="Item Name (override)" value={f.item} onChange={setText('item')} placeholder="Auto from brand/model" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <SellerCustomerField
                  label="Bought From (seller)"
                  placeholder="Seller name (optional)"
                  inputClassName={inp} labelClassName={lbl}
                  customers={customers} onCreateCustomer={onCreateCustomer}
                  value={{ boughtFrom: f.boughtFrom || '', boughtFromCustomerId: f.boughtFromCustomerId, boughtFromPhone: f.boughtFromPhone }}
                  onChange={v => setF(prev => ({ ...prev, ...v }))} />
                <Field label="Purchase Source (channel)" value={f.purchaseSource} onChange={setText('purchaseSource')} placeholder="Marketplace" />
                <div>
                  {/* Attribution only — who sourced this device the store
                      owns. NOT a drop-off link: a financed drop-off is the
                      buyer's device and never becomes store inventory (see
                      domain/dropoffs.ts). */}
                  <label className={lbl}>Sourced by (device buyer)</label>
                  <select className={inp} value={f.buyerId ?? ''} onChange={e => {
                    const r = deviceBuyers.find(x => x.id === e.target.value);
                    set('buyerId', e.target.value || undefined); set('buyerName', r?.name);
                  }}>
                    <option value="">— none —</option>
                    {deviceBuyers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <CostField label="Purchase Price ($)" value={f.purchaseCost} onChange={setNum('purchaseCost')} canViewCost={canViewCost} onFocus={selectOnFocus} />
                <CostField label="Repair Cost ($)" value={f.repairCost} onChange={setNum('repairCost')} canViewCost={canViewCost} onFocus={selectOnFocus} />
                <Field label="Target Sale Price ($)" value={f.targetSalePrice} onChange={setNum('targetSalePrice')} type="number" onFocus={selectOnFocus} />
                {/* OWNER-ONLY per-device floor, for the phone that needs its
                    own answer. Hidden from staff entirely: it is a price, but
                    one derived from cost, and showing it would give the game
                    away on any device where it was set. */}
                {canViewCost && (
                  <Field label="Minimum Sale Price ($)" value={f.minSalePrice} onChange={setNum('minSalePrice')} type="number" placeholder="Use workspace setting" onFocus={selectOnFocus} />
                )}
                <Field label="Date In" value={f.date} onChange={setText('date')} type="date" />
              </div>
              {/* Record a sale made outside Quick Sale (private sale, trade show, …).
                  Entering an Actual price marks the device sold on save (Date Sold
                  defaults to today if blank) so it counts in the dashboard/P&L. */}
              <div className="grid grid-cols-3 gap-4">
                <Field label="Actual Sale Price ($)" value={f.salePrice} onChange={setNum('salePrice')} type="number" placeholder="0.00" onFocus={selectOnFocus} />
                <Field label="Date Sold" value={f.soldDate} onChange={setText('soldDate')} type="date" />
                <Field label="Sold To" value={f.soldTo} onChange={setText('soldTo')} placeholder="Buyer (optional)" />
              </div>
              {(f.salePrice || 0) > 0 && !f.soldDate && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 -mt-1">Saving will mark this device sold today and include it in revenue/profit totals.</p>
              )}
            </>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2"><Field label="Item Name" value={f.item} onChange={setText('item')} placeholder="Lightning Cable 1m" /></div>
              <Field label="Category" value={f.category} onChange={setText('category')} placeholder="Cables" />
              <Field label="Quantity" value={f.quantity} onChange={setNum('quantity')} type="number" />
              <CostField label="Cost / Unit ($)" value={f.costPerUnit} onChange={setNum('costPerUnit')} canViewCost={canViewCost} onFocus={selectOnFocus} />
              <Field label="Selling Price ($)" value={f.sellingPrice} onChange={setNum('sellingPrice')} type="number" onFocus={selectOnFocus} />
              <Field label="Low Stock Threshold" value={f.lowStockThreshold} onChange={setNum('lowStockThreshold')} type="number" />
              <Field label="Purchase Date" value={f.date} onChange={setText('date')} type="date" />
              <SellerCustomerField
                  label="Bought From"
                  placeholder="Seller name (optional)"
                  inputClassName={inp} labelClassName={lbl}
                  customers={customers} onCreateCustomer={onCreateCustomer}
                  value={{ boughtFrom: f.boughtFrom || '', boughtFromCustomerId: f.boughtFromCustomerId, boughtFromPhone: f.boughtFromPhone }}
                  onChange={v => setF(prev => ({ ...prev, ...v }))} />
            </div>
          )}

          <div>
            <label className={lbl}>Listed Elsewhere (also posted on)</label>
            <div className="flex flex-wrap gap-2">
              {LISTING_PLATFORMS.map(p => {
                const active = (f.listedPlatforms || []).includes(p.value);
                return (
                  <button key={p.value} type="button" onClick={() => toggleListedPlatform(p.value)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${active ? 'bg-amber-500 text-white border-amber-500' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-amber-400'}`}>
                    {p.label}
                  </button>
                );
              })}
            </div>
            {(f.listedPlatforms || []).length > 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">Quick Sale will warn before selling this item in-store while it's flagged listed elsewhere.</p>
            )}
          </div>

          <div>
            <label className={lbl}>Notes</label>
            <textarea className={inp} rows={2} value={f.notes} onChange={e => set('notes', e.target.value)} />
          </div>

          {/* Internal repair link (devices only). Read-only review of the linked
              ticket's work — the item's own Repair cost is set manually, never
              synced from here. */}
          {kind === 'device' && initial && (onCreateRepair || linkedRepair) && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className={`${lbl} flex items-center gap-1.5`}><Wrench className="w-3.5 h-3.5 text-indigo-500" /> Repair ticket</span>
                {linkedRepair
                  ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">{REPAIR_STATUS_LABEL[linkedRepair.status]}</span>
                  : onCreateRepair && <button type="button" onClick={onCreateRepair} className="text-xs font-medium px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 text-white">Create repair ticket</button>}
              </div>
              {linkedRepair ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-400">{linkedRepair.repairNumber || 'Ticket'} · review the technician's work before setting this device's repair cost.</p>
                  {([
                    ['Diagnostics', linkedRepair.diagnostics],
                    ['Work performed', linkedRepair.workPerformed],
                    ['Parts used', linkedRepair.partsUsed],
                    ['Testing', linkedRepair.testingResults],
                    ['Tech notes', linkedRepair.techNotes],
                  ] as const).filter(([, v]) => v && String(v).trim()).map(([label, v]) => (
                    <div key={label}>
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{label}</p>
                      <p className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{v}</p>
                    </div>
                  ))}
                  {!linkedRepair.diagnostics && !linkedRepair.workPerformed && !linkedRepair.partsUsed && !linkedRepair.testingResults && !linkedRepair.techNotes && (
                    <p className="text-xs text-slate-400">No technician notes recorded yet.</p>
                  )}
                  {onOpenRepair && (
                    <button type="button" onClick={() => onOpenRepair(linkedRepair.id)} className="mt-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">Open full ticket →</button>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-400">No repair ticket linked. Create one to track internal refurb work by a technician.</p>
              )}
            </div>
          )}

          {initial && <LinkedNotes notes={notes} role={noteRole} linkType="inventory" linkId={f.id} onOpenNote={onOpenNote} />}
        </div>

        {/* A SKU cannot be allocated offline (services allocateSku refuses with
            a clear message), so an offline save SAYS SO rather than looking
            like it worked. */}
        {saveError && (
          <p className="mx-5 mb-2 flex items-start gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /><span>{saveError}</span>
          </p>
        )}
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2 sticky bottom-0 bg-white dark:bg-slate-900">
          {initial && (
            <button type="button" onClick={() => printShelfTag({ ...f, kind }, { storeName: getStoreProfile().storeName })}
              className="mr-auto px-4 py-2 text-sm rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 flex items-center gap-1.5"><Tag className="w-4 h-4" /> Shelf Tag</button>
          )}
          <button onClick={requestClose} className="px-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={save} disabled={!canSave} className="px-5 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-medium">{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>

      {sellerLink.prompt}
      {showImeiScanner && (
        <ImeiScanner
          onScan={(imei) => { set('imei', imei); setShowImeiScanner(false); }}
          onClose={() => setShowImeiScanner(false)}
        />
      )}
    </div>
  );
};
