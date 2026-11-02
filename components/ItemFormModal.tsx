import React, { useState, useMemo, useRef, useEffect, FocusEventHandler } from 'react';
import { X, Wand2, Smartphone, Package, Barcode, Camera, Tag } from 'lucide-react';
import { printShelfTag } from '../services/shelfTag';
import { getStoreProfile } from './SettingsModal';
import { InventoryItem, ItemKind, DeviceType, DeviceStatus, StorageType, DeviceBuyer, Repair, ListingPlatform, Note, Role, Customer, Location, InventoryTransfer } from '../types';
import { SellerCustomerField } from './SellerCustomerField';
import { useSellerLink } from '../hooks/useSellerLink';
import { CustomerDraft } from '../domain/customers';
import { LinkedNotes } from './LinkedNotes';
import { DevicePhotos } from './DevicePhotos';
import { ListingModal } from './ListingModal';
import { deviceFacts, ListingOptions } from '../domain/listingCopy';
import { damagePhotoPrompt, wantsDamagePhoto } from '../domain/devicePhotos';
import { REPAIR_STATUS_LABEL } from '../domain/repairs';
import { LISTING_PLATFORMS } from '../domain/listing';
import { findDuplicateDevice } from '../domain/autoInventory';
import {
  effectiveDeviceType, hasPhoneFields, hasLaptopFields, hasBrandModel, hasCondition,
  requiresItemName, STORAGE_TYPES, strandedFields,
} from '../domain/deviceSpecs';
import { locationName } from '../domain/locations';
import { isInTransit, transitLabel } from '../domain/transfers';
import { AlertTriangle, Sparkles } from 'lucide-react';
import { ImeiScanner } from './ImeiScanner';
import { Wrench } from 'lucide-react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { selectOnFocus } from '../hooks/selectOnFocus';
import { todayISO } from '../domain/dates';
import { costAccessFor, RECORDED_LABEL } from '../domain/costVisibility';
import { normalizeForLookup } from '../domain/identifierSearch';
import { writeErrorMessage } from '../domain/writeErrors';

interface Props {
  initial?: InventoryItem;
  initialKind?: ItemKind;
  /**
   * The device type an Add from the current inventory tab produces
   * (domain/deviceSpecs.ts's tabAddsType). Add from the Laptops tab and this
   * is 'Laptop' — the type picker is then not rendered at all, which is the
   * point: the dropdown was never missing, it was just easy to leave on its
   * 'Phone' default, and that is why every laptop in the workspace is
   * currently filed as a phone.
   *
   * Undefined means "ask" — the Other tab covers four kinds, and editing an
   * existing item always shows the picker so a mistyped row can be fixed.
   */
  initialDeviceType?: DeviceType;
  // reports.profit.detailed. Without it, a cost that is already RECORDED shows
  // as a word rather than a figure and is read-only; a BLANK one is still
  // enterable, which is the point — an employee adding a device must be able
  // to put the cost in, just not read one back.
  canViewCost?: boolean;
  deviceBuyers: DeviceBuyer[];
  /** May be async — the modal awaits it and stays open if it rejects. */
  onSave: (item: InventoryItem) => void | Promise<unknown>;
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
  /** Needed to file an uploaded photo under the right workspace. */
  workspaceId?: string;
  currentUserId?: string;
  /** settings.operations.deviceWarrantyDays — what a generated advert promises. */
  deviceWarrantyDays?: number;
  /** Ask the Cloud Function for a stock photo for this brand/model. */
  onFindStockPhoto?: (item: InventoryItem) => Promise<boolean>;
  /**
   * WHERE THIS DEVICE IS, and where it is going (multi-store stage 4). The
   * device's own screen answers both, so "where is it" is on the record
   * rather than only on the transfers screen. Optional: a single-store
   * workspace passes neither and nothing is shown.
   */
  locations?: Location[];
  activeTransfer?: InventoryTransfer;
}

const DEVICE_TYPES: DeviceType[] = ['Phone', 'Tablet', 'Laptop', 'Console', 'Watch', 'Desktop PC', 'Other'];
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

export const ItemFormModal: React.FC<Props> = ({ initial, initialKind, initialDeviceType, canViewCost = false, deviceBuyers, onSave, onGenerateSku, onClose, linkedRepair, onCreateRepair, onOpenRepair, inventory = [], customers, onCreateCustomer, notes, noteRole, onOpenNote, onOpenDuplicate, workspaceId, currentUserId, onFindStockPhoto, deviceWarrantyDays, locations = [], activeTransfer }) => {
  const [findingStock, setFindingStock] = useState(false);
  const [listingOpen, setListingOpen] = useState(false);
  // The device document is updated by the Cloud Function, so the new photo
  // arrives on the next subscription tick rather than from here.
  const findStock = async () => {
    if (!onFindStockPhoto) return;
    setFindingStock(true);
    try { await onFindStockPhoto(f); } finally { setFindingStock(false); }
  };
  const [kind, setKind] = useState<ItemKind>(initial?.kind ?? initialKind ?? 'device');
  const [f, setF] = useState<InventoryItem>(() => initial ?? {
    id: uid(), kind: initialKind ?? 'device', sku: '', manufacturerBarcode: '',
    date: today(), item: '', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
    soldDate: '', soldTo: '', salePrice: 0, notes: '',
    // The TAB's type, not a hardcoded 'Phone'. A laptop also starts with no
    // Condition: it does not have one (domain/deviceSpecs.ts's hasCondition),
    // so seeding 'Good' would store a field the form never shows.
    deviceType: initialDeviceType ?? 'Phone', brand: '', model: '', storage: '', color: '', carrier: '',
    batteryHealth: '', condition: (initialDeviceType === 'Laptop' ? '' : 'Good'),
    purchaseSource: '', targetSalePrice: 0,
    deviceStatus: 'ready', quantity: 1, costPerUnit: 0, sellingPrice: 0, lowStockThreshold: 3,
  });

  const set = <K extends keyof InventoryItem>(k: K, v: InventoryItem[K]) => setF(p => ({ ...p, [k]: v }));
  // Which fields this record has at all — one source of truth, shared with the
  // inventory tabs and the tests (domain/deviceSpecs.ts).
  const deviceType = effectiveDeviceType(f);
  const isLaptop = hasLaptopFields(deviceType);
  // Asked when it is genuinely a question: an existing item (so a mistyped row
  // can be retyped here too) or an Add from a tab covering several kinds.
  const showTypePicker = !!initial || !initialDeviceType;
  const stranded = strandedFields(f);
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
        // A laptop has no brand or model to build a name from, so `item` is
        // all there is — and canSave below refuses to save one without it.
        // For everything else this is unchanged.
        item.item = f.item || [f.brand, f.model, f.storage].filter(Boolean).join(' ');
      }
      // AWAITED. Closing the modal is this screen's "saved" — it must not
      // happen on a write that hasn't landed. A rejection lands in the catch
      // below, which keeps the form open with everything still typed in it.
      await onSave(item);
      onClose();
    } catch (e) {
      setSaveError(writeErrorMessage(e, 'Could not save this item.'));
    } finally {
      setSaving(false);
    }
  };

  // A LAPTOP NEEDS ITS NAME. It has no Brand or Model field by the owner's
  // decision, so without `item` the record would have no identity at all —
  // it would read as "Laptop" in the till, on a receipt and in a customer's
  // history (domain/inventory.ts's getDeviceDisplayName falls back to the
  // type). Every other kind is unchanged: a phone still saves on an IMEI
  // alone.
  const hasIdentity = kind === 'device'
    ? (requiresItemName(deviceType) ? !!(f.item || '').trim() : !!(f.item || f.brand || f.model || f.imei))
    : !!f.item;
  const canSave = hasIdentity && !duplicate && !saving;

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
              {/* THE DEVICE ATTRIBUTE BLOCK IS TYPE-SHAPED.
                  A laptop has a CPU, RAM, a drive type, a screen and a GPU; it
                  does not have a carrier, a battery-health reading or a
                  Condition, and by the owner's decision it has no Brand or
                  Model either — the whole name goes in Item Name ("Dell XPS
                  15"). Each of those is one predicate in
                  domain/deviceSpecs.ts, so this form, the grid and the tests
                  cannot disagree about which fields a type has. */}
              <div className="grid grid-cols-3 gap-4">
                {/* The picker appears when the type is genuinely a question:
                    editing an existing item (so a mistyped row can be fixed
                    here as well as in the grid), or adding from a tab that
                    covers more than one kind. Adding from Phones or Laptops
                    shows the type as a fact instead. */}
                {showTypePicker ? (
                  <div>
                    <label className={lbl}>Device Type</label>
                    <select className={inp} value={f.deviceType} onChange={e => set('deviceType', e.target.value as DeviceType)}>
                      {DEVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className={lbl}>Device Type</label>
                    <p className="px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg">
                      {deviceType}
                    </p>
                  </div>
                )}
                {hasBrandModel(deviceType) && <Field label="Brand" value={f.brand} onChange={setText('brand')} placeholder="Apple" />}
                {hasBrandModel(deviceType) && <Field label="Model" value={f.model} onChange={setText('model')} placeholder="iPhone 14 Pro" />}

                {/* --- Laptop specs. `storage` is the SAME field a phone uses
                    for its capacity, reused rather than duplicated. --- */}
                {isLaptop && <Field label="CPU" value={f.cpu} onChange={setText('cpu')} placeholder="i7-1165G7" />}
                {isLaptop && <Field label="RAM" value={f.ram} onChange={setText('ram')} placeholder="16GB" />}
                <Field label="Storage" value={f.storage} onChange={setText('storage')} placeholder={isLaptop ? '512GB' : '256GB'} />
                {isLaptop && (
                  <div>
                    <label className={lbl}>Storage Type</label>
                    <select className={inp} value={f.storageType ?? ''} onChange={e => set('storageType', (e.target.value || undefined) as StorageType | undefined)}>
                      <option value="">—</option>
                      {STORAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                )}
                {isLaptop && <Field label="Screen Size" value={f.screenSize} onChange={setText('screenSize')} placeholder={'15.6"'} />}
                {isLaptop && <Field label="GPU" value={f.gpu} onChange={setText('gpu')} placeholder="RTX 3060" />}

                <Field label="Color" value={f.color} onChange={setText('color')} placeholder="Space Black" />
                {hasPhoneFields(deviceType) && <Field label="Carrier" value={f.carrier} onChange={setText('carrier')} placeholder="Unlocked" />}
                {hasPhoneFields(deviceType) && <Field label="Battery Health" value={f.batteryHealth} onChange={setText('batteryHealth')} placeholder="92%" />}
                {hasCondition(deviceType) && (
                  <div>
                    <label className={lbl}>Condition</label>
                    <select className={inp} value={f.condition} onChange={e => set('condition', e.target.value)}>
                      {CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label className={lbl}>Status</label>
                  <select className={inp} value={f.deviceStatus} onChange={e => set('deviceStatus', e.target.value as DeviceStatus)}>
                    {DEVICE_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                {/* WHERE IT IS. In transit says where it is GOING and how long
                    it has been on the way — the device's own screen should not
                    make somebody open the transfers list to find out it is in
                    a car. `deviceStatus` above is untouched by a transfer, so
                    a device can be both in transit and in repair. */}
                {locations.length > 0 && (
                  <div>
                    <label className={lbl}>Where it is</label>
                    <p className={`px-3 py-2 text-sm font-semibold rounded-lg border ${isInTransit(f)
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                      : 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'}`}>
                      {isInTransit(f)
                        ? transitLabel(activeTransfer, id => locationName(locations, id) || id, Date.now())
                        : (locationName(locations, f.locationId) || 'Not set')}
                    </p>
                  </div>
                )}
                {/* With no Brand or Model, this is a laptop's ONLY identity —
                    so it is the one thing the form insists on. A phone can
                    still be saved on an IMEI alone, exactly as before. */}
                <Field label={isLaptop ? 'Item Name' : 'Item Name (override)'} value={f.item} onChange={setText('item')}
                  placeholder={isLaptop ? 'Dell XPS 15' : 'Auto from brand/model'} />
              </div>
              {isLaptop && !(f.item || '').trim() && (
                <p className="text-xs text-amber-600 dark:text-amber-400 -mt-1">
                  Give the laptop a name — it has no Brand or Model field, so this is what it is called everywhere.
                </p>
              )}
              {/* A retyped row keeps whatever was typed into it; nothing is
                  cleared behind the owner's back. But a value the form no
                  longer shows must not be invisible, or the record quietly
                  disagrees with the screen. */}
              {stranded.length > 0 && (
                <p className="text-xs text-slate-400 -mt-1">
                  Kept from before this was a {deviceType.toLowerCase()}: {stranded.join(', ')}. Nothing was deleted — retype it back to see those fields again.
                </p>
              )}
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

          {/* PHOTOS. Only on a saved device: an upload needs an item id to
              file itself under, and an unsaved draft has none yet. */}
          {kind === 'device' && initial && workspaceId && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <DevicePhotos
                workspaceId={workspaceId}
                itemId={f.id}
                photos={f.photos}
                currentUserId={currentUserId || ''}
                onChange={photos => set('photos', photos)}
                onFindStockPhoto={onFindStockPhoto ? () => { void findStock(); } : undefined}
                findingStock={findingStock}
              />
              {/* A NUDGE, never a block — the device saves either way. */}
              {wantsDamagePhoto({ ...f, kind }) && (
                <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                  {damagePhotoPrompt(f.condition || '')}
                </p>
              )}
            </div>
          )}

          {/* WRITE THE ADVERT. Only on a saved device — the facts are read off
              the record, and an unsaved draft is not one yet. */}
          {kind === 'device' && initial && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
              <button type="button" onClick={() => setListingOpen(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400">
                <Sparkles className="w-4 h-4 text-indigo-500" /> Generate listing
              </button>
              {f.lastListing && (
                <p className="text-[11px] text-slate-400 mt-1">
                  Last written {new Date(f.lastListing.generatedAt).toLocaleDateString()} — open to copy or rewrite it.
                </p>
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

      {listingOpen && (
        <ListingModal
          isBuild={false}
          hasShareLink={false}
          saved={f.lastListing}
          onSave={lastListing => set('lastListing', lastListing)}
          onClose={() => setListingOpen(false)}
          // THE FACTS, built from an allow-list (domain/listingCopy.ts) — the
          // model never sees the inventory row, so the cost, the seller and the
          // IMEI on it cannot travel with the request.
          facts={(options: ListingOptions) => deviceFacts(
            { ...f, kind } as InventoryItem,
            { warrantyDays: deviceWarrantyDays ?? 90, options },
          )}
        />
      )}

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
