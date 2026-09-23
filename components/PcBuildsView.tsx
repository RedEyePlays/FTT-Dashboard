import React, { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  Cpu, Plus, Search, Trash2, X, ArrowRight, ArrowLeft, Printer, CreditCard,
  ExternalLink, Clock, FileText, AlertTriangle, Sparkles, CheckCircle2,
  Link as LinkIcon, Copy, Check, CopyPlus, StickyNote, Gauge,
} from 'lucide-react';
import {
  BuildKind, BuildPart, BuildStatus, Customer, InventoryItem, PartCategory,
  PartCondition, PartSource, PcBuild, SalesTransaction, MeasuredFps,
} from '../types';
import { CustomerDraft } from '../domain/customers';
import {
  BUILD_FLOW, BUILD_STATUS_LABEL, CONDITION_LABEL, PART_CATEGORIES, SOURCE_LABEL,
  buildKindLabel, buildSearchText, buildTotals, generatedItemName, isBackwards,
  isBuildFinished, nextStatus, partsEditable, PARTS_LOCKED_NOTE, pcPartPickerSearchUrl,
  retailAgeDays, retailAsOfLabel, RETAIL_STALE_DAYS, splitBuilds,
  duplicateBuild, depositOnBuild, priceChangeWarning,
} from '../domain/pcBuild';
import {
  CARD_ORIENTATIONS, CardOrientation, DEFAULT_CARD_ORIENTATION, canHaveDisplayCard,
  cardOrientation, customerSheet, displayCard,
} from '../domain/buildSheet';
import { buildSearchable, matchesWords, queryWords } from '../domain/itemSearch';
import { printBuildSheet, printDisplayCard } from '../services/buildPrint';
import { getStoreProfile } from './SettingsModal';
import { CustomerSearchInput } from './CustomerSearchInput';
import { DevicePhotos } from './DevicePhotos';
import { ListingModal } from './ListingModal';
import { buildFacts, ListingOptions } from '../domain/listingCopy';
import {
  GPU_GAMES, GPU_RESOLUTIONS, GpuPerformanceRow, MEASURED_LABEL, PERFORMANCE_CAVEAT,
  PerformanceLine, buildGpu, fpsLabel, performanceFor,
} from '../domain/gpuPerformance';
import { useSellerLink } from '../hooks/useSellerLink';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { todayISO } from '../domain/dates';
import { SOLD_LINK_GRACE_DAYS, shareState } from '../domain/buildShare';
import { CUSTOM_CODE_MESSAGE, newShareCode, validateCustomCode } from '../domain/shareCode';
import { codeFromShareInput, shareAdLine, shareLinkDisplay, shareLinkUrl } from '../domain/shareLink';
import { SHARE_LINK_HOST } from '../domain/statusLink';
import { useFieldDraft } from '../hooks/useFieldDraft';
import { numericDraft } from '../domain/fieldDraft';

/**
 * CUSTOM PC BUILDS.
 *
 * The list splits In progress from Completed, the same way the Tickets tab and
 * a batch's device list do — finished work leaves the working list rather than
 * accumulating in it. Search is the shared multi-word matcher.
 *
 * COSTS ARE VISIBLE AND EDITABLE TO ANYONE WHO CAN OPEN A BUILD.
 *
 * This screen used to apply the write-only masking (domain/costVisibility.ts):
 * a cost was typed once, replaced by the word "Recorded" and locked. On a
 * technician's account that hid the numbers from the person who had just gone
 * out and bought the parts — they could not check or correct their own entry,
 * and the Parts / Total cost tiles read "Recorded" as well.
 *
 * The owner's decision is that whoever can work on a build sees everything on
 * that build. So there is NO cost masking in this file at all, and no flag to
 * reintroduce one: both shells render this view only behind
 * allow('builds.manage'), which makes "can open a build" and "can see its
 * costs" the same question.
 *
 * THE BOUNDARY IS THIS SCREEN. It grants nothing anywhere else — inventory
 * costs, Reports, the Sales Ledger, the Money Trail, dashboard profit and the
 * per-user Financials (allowProfit) toggle all keep their own rules, and a
 * technician still sees no cost on a device outside a build and no figure for
 * what the shop makes overall. See components/PcBuildsView.costScope.test.tsx.
 */

interface Props {
  builds: PcBuild[];
  inventory: InventoryItem[];
  customers: Customer[];
  currentUserId: string;
  currentUserEmail: string;
  /** settings.operations.buildLabourRate. */
  labourRate: number;
  /** settings.operations.deviceWarrantyDays — what the printed sheet promises. */
  warrantyDays: number;
  onSave: (build: PcBuild, prev?: PcBuild) => void;
  onDelete?: (id: string) => void;
  /** Finish a shelf build: allocates a SKU and creates the inventory device. */
  onFinishBuild: (build: PcBuild, itemName: string) => unknown | Promise<unknown>;
  /** Open the till with this build as the item, for a customer deposit. */
  onTakeDeposit?: (build: PcBuild) => void;
  onCreateCustomer?: (draft: CustomerDraft) => Customer | undefined;
  onOpenInventoryItem?: (id: string) => void;
  /**
   * PHOTOS OF THE FINISHED MACHINE.
   *
   * They live on the inventory DEVICE a finished shelf build becomes, not on
   * the build — photograph it once and the spec sheet, the Marketplace link
   * and the counter kiosk all show the same picture. Omit either of these, or
   * open a build that has not been finished yet, and the gallery is simply
   * not offered.
   */
  workspaceId?: string;
  onSaveDevice?: (item: InventoryItem) => void | Promise<unknown>;
  /**
   * Sales, read ONLY to work out what has been collected against a customer
   * order (domain/pcBuild.ts's depositOnBuild). There is no deposit field on a
   * build and there must not be one — deposits are the layaway flow's, and a
   * second copy here would drift the first time a balance payment is taken.
   */
  sales?: SalesTransaction[];
  /** Start a new build from this one's recipe. Audited as a create. */
  onDuplicate?: (source: PcBuild, copy: PcBuild) => void;
  /** settings.operations.gpuPerformance — the reviewed frame-rate table. */
  gpuTable?: GpuPerformanceRow[];
  /**
   * Set when this workspace's pcBuilds subscription was REFUSED (almost always
   * rules that have not been deployed yet). The section says so itself; the
   * rest of the app is unaffected — see domain/subscriptionAccess.ts.
   */
  unavailableNotice?: string;
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const money = (n: number) => `$${(n || 0).toFixed(2)}`;
const input = 'w-full p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm';
const label = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

const STATUS_CLS: Record<BuildStatus, string> = {
  planning: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  parts_ordered: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  assembling: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  testing: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  ready: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  sold: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  picked_up: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  cancelled: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300',
};

export const PcBuildsView: React.FC<Props> = ({
  builds, inventory, customers, currentUserId, currentUserEmail,
  labourRate, warrantyDays, onSave, onDelete, onFinishBuild, onTakeDeposit,
  onCreateCustomer, onOpenInventoryItem, workspaceId, onSaveDevice,
  sales = [], onDuplicate, gpuTable = [], unavailableNotice,
}) => {
  const [view, setView] = useState<'active' | 'completed'>('active');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState<BuildKind | null>(null);

  const matched = useMemo(() => {
    const words = queryWords(query);
    if (words.length === 0) return builds;
    return builds.filter(b => {
      const text = buildSearchText(b).toLowerCase();
      return matchesWords({ plain: text, squashed: text.replace(/\s+/g, '') }, words);
    });
  }, [builds, query]);

  // Every code already spoken for. A collision would point two adverts at one
  // machine, so the generator is told what not to produce rather than being
  // trusted to be lucky.
  const takenCodes = useMemo(
    () => new Set(builds.map(b => b.shareToken).filter((t): t is string => !!t)),
    [builds],
  );

  const split = useMemo(() => splitBuilds(matched), [matched]);
  const shown = view === 'completed' ? split.completed : split.active;
  const open = builds.find(b => b.id === openId) || null;

  if (open) {
    return (
      <BuildDetail
        build={open} inventory={inventory} customers={customers}
        currentUserId={currentUserId} currentUserEmail={currentUserEmail}
        labourRate={labourRate} warrantyDays={warrantyDays} takenCodes={takenCodes}
        onBack={() => setOpenId(null)} onSave={onSave}
        onDelete={onDelete ? () => { onDelete(open.id); setOpenId(null); } : undefined}
        onFinishBuild={onFinishBuild} onTakeDeposit={onTakeDeposit}
        onCreateCustomer={onCreateCustomer} onOpenInventoryItem={onOpenInventoryItem}
        workspaceId={workspaceId} onSaveDevice={onSaveDevice}
        sales={sales} gpuTable={gpuTable}
        onDuplicate={onDuplicate ? () => {
          const copy = duplicateBuild({
            source: open, id: uid(), partId: () => uid(),
            createdBy: currentUserId, createdByEmail: currentUserEmail, now: Date.now(),
          });
          onDuplicate(open, copy);
          setOpenId(copy.id);
        } : undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* This section's data was refused. An inline notice, NOT the full-screen
          error — one missing rule must not take the shop down with it. */}
      {unavailableNotice && (
        <div className="flex items-start gap-2 rounded-xl px-4 py-3 text-sm bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {unavailableNotice}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Cpu className="w-6 h-6 text-indigo-500" /> PC Builds
          <span className="text-sm font-normal text-slate-400">{builds.length}</span>
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Search name, customer, part or serial…" className={`${input} pl-9`} />
          </div>
          <button onClick={() => setCreating('shelf')}
            className="flex items-center gap-2 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
            <Plus className="w-4 h-4" /> Build to sell
          </button>
          <button onClick={() => setCreating('customer')}
            className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-indigo-400">
            <Plus className="w-4 h-4" /> Customer order
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {(([['active', 'In progress', split.active.length], ['completed', 'Completed', split.completed.length]]) as ['active' | 'completed', string, number][]).map(([v, text, n]) => (
          <button key={v} onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${view === v ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
            {text} <span className="opacity-70">({n})</span>
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {shown.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-12">
            {query ? 'No builds match that search.' : view === 'completed' ? 'No finished builds yet.' : 'No builds in progress.'}
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {shown.map(b => {
              const t = buildTotals(b);
              return (
                <button key={b.id} onClick={() => setOpenId(b.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <div className="w-9 h-9 rounded-lg bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center shrink-0">
                    <Cpu className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{b.name}</p>
                    <p className="text-xs text-slate-400 truncate">
                      {buildKindLabel[b.kind]}
                      {b.customerName ? ` · ${b.customerName}` : ''}
                      {` · ${(b.parts || []).length} part${(b.parts || []).length !== 1 ? 's' : ''}`}
                      {t.labourHours > 0 ? ` · ${t.labourHours}h` : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {t.price != null && <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{money(t.price)}</p>}
                    {t.profit != null && (
                      <p className={`text-[11px] ${t.profit >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>{money(t.profit)} profit</p>
                    )}
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded shrink-0 ${STATUS_CLS[b.status]}`}>
                    {BUILD_STATUS_LABEL[b.status]}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {creating && (
        <NewBuildModal
          kind={creating} customers={customers} onCreateCustomer={onCreateCustomer}
          currentUserId={currentUserId} currentUserEmail={currentUserEmail}
          onClose={() => setCreating(null)}
          onCreate={b => { onSave(b); setCreating(null); setOpenId(b.id); }}
        />
      )}
    </div>
  );
};

/* ---------------- New build ---------------- */

const NewBuildModal: React.FC<{
  kind: BuildKind;
  customers: Customer[];
  currentUserId: string;
  currentUserEmail: string;
  onCreateCustomer?: (draft: CustomerDraft) => Customer | undefined;
  onClose: () => void;
  onCreate: (b: PcBuild) => void;
}> = ({ kind, customers, currentUserId, currentUserEmail, onCreateCustomer, onClose, onCreate }) => {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [customerName, setCustomerName] = useState('');
  useEscapeKey(onClose);

  // A typed customer name becomes a customer the same way Quick Purchase now
  // does — one shared path (domain/sellerLink.ts), no second routine.
  const link = useSellerLink({ customers, onCreateCustomer });

  const create = () => {
    const commit = (resolvedId: string | undefined) => {
      const n = parseFloat(price);
      const now = Date.now();
      onCreate({
        id: uid(),
        name: name.trim() || (kind === 'customer' ? `Order for ${customerName.trim() || 'customer'}` : 'New build'),
        kind, status: 'planning', parts: [], labour: [],
        ...(kind === 'customer'
          ? { quotePrice: Number.isFinite(n) && n > 0 ? n : undefined, customerId: resolvedId, customerName: customerName.trim() || undefined }
          : { targetPrice: Number.isFinite(n) && n > 0 ? n : undefined }),
        createdBy: currentUserId, createdByEmail: currentUserEmail,
        createdAt: now, updatedAt: now,
      });
    };
    if (kind === 'customer' && customerName.trim() && !customerId) {
      link.resolve({ name: customerName, customerId }, commit);
      return;
    }
    commit(customerId);
  };

  return (
    <>
      {link.prompt}
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md border border-slate-200 dark:border-slate-700 p-5 space-y-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-800 dark:text-slate-100">{buildKindLabel[kind]}</h2>
            <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
          </div>
          <div>
            <label className={label}>Build name</label>
            <input autoFocus className={input} value={name} onChange={e => setName(e.target.value)}
              placeholder={kind === 'customer' ? 'e.g. Ali — streaming build' : 'e.g. Starter Gaming PC'} />
          </div>
          {kind === 'customer' && (
            <div className="space-y-2">
              <label className={label}>Customer</label>
              {customers.length > 0 && (
                <CustomerSearchInput customers={customers} placeholder="Find existing customer…"
                  onSelect={c => { setCustomerId(c.id); setCustomerName(c.name || c.company || ''); }} />
              )}
              <input className={input} value={customerName}
                onChange={e => { setCustomerName(e.target.value); setCustomerId(undefined); }}
                placeholder="or type a name" />
            </div>
          )}
          <div>
            <label className={label}>{kind === 'customer' ? 'Quote' : 'Target price'}</label>
            <input type="number" min="0" step="0.01" className={input} value={price}
              onChange={e => setPrice(e.target.value)} placeholder="0.00" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
            <button onClick={create} className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium">Create</button>
          </div>
        </div>
      </div>
    </>
  );
};

/* ---------------- Detail ---------------- */

const BuildDetail: React.FC<{
  build: PcBuild;
  inventory: InventoryItem[];
  customers: Customer[];
  currentUserId: string;
  currentUserEmail: string;
  labourRate: number;
  warrantyDays: number;
  /** Every share code in use across the workspace, so a new one is unique. */
  takenCodes: Set<string>;
  onBack: () => void;
  onSave: (b: PcBuild, prev?: PcBuild) => void;
  onDelete?: () => void;
  onFinishBuild: (b: PcBuild, itemName: string) => unknown | Promise<unknown>;
  onTakeDeposit?: (b: PcBuild) => void;
  onCreateCustomer?: (draft: CustomerDraft) => Customer | undefined;
  onOpenInventoryItem?: (id: string) => void;
  workspaceId?: string;
  onSaveDevice?: (item: InventoryItem) => void | Promise<unknown>;
  sales?: SalesTransaction[];
  onDuplicate?: () => void;
  /** The shop's reviewed per-GPU frame-rate table (Settings → PC Builds). */
  gpuTable?: GpuPerformanceRow[];
}> = ({
  build, inventory, currentUserId, currentUserEmail, labourRate, takenCodes,
  warrantyDays, onBack, onSave, onDelete, onFinishBuild, onTakeDeposit, onOpenInventoryItem,
  workspaceId, onSaveDevice, sales = [], onDuplicate, gpuTable = [],
}) => {
  const totals = buildTotals(build);
  const device = build.inventoryId ? inventory.find(i => i.id === build.inventoryId) : undefined;
  const editable = partsEditable(build, device);
  const { isSubmitting, run } = useSubmitGuard();
  const [cardPreview, setCardPreview] = useState(false);
  const [listingOpen, setListingOpen] = useState(false);
  const store = getStoreProfile();
  const performance = performanceFor(build, gpuTable);

  const patch = (p: Partial<PcBuild>) => onSave({ ...build, ...p, updatedAt: Date.now() }, build);

  /**
   * THE PRICE, SET WHEN THE SHOP ACTUALLY KNOWS IT.
   *
   * It used to be typed once in the create dialog and never again — which is
   * backwards, because a PC is priced AFTER the parts are in and the cost is
   * known. The number the shop will really sell at could not be recorded.
   *
   * A customer order's quote is a number somebody has been TOLD, so changing
   * it once a deposit is against it warns first and says what the balance
   * becomes. It never touches the deposit: that money was taken, it lives on
   * the sale, and nothing on this screen may restate it.
   */
  const deposit = depositOnBuild(build, sales);
  const commitPrice = (next: number | undefined) => {
    const field = build.kind === 'customer' ? 'quotePrice' : 'targetPrice';
    if (next == null) { patch({ [field]: undefined } as Partial<PcBuild>); return; }
    const warning = priceChangeWarning(build, next, deposit);
    if (warning && !window.confirm(`${warning.message}\n\nChange the quote?`)) return;
    patch({ [field]: next } as Partial<PcBuild>);
  };

  const moveTo = (to: BuildStatus) => {
    // Backwards needs a confirm — it usually means something went wrong.
    if (isBackwards(build.status, to) && !window.confirm(
      `Move this build back from ${BUILD_STATUS_LABEL[build.status]} to ${BUILD_STATUS_LABEL[to]}?`,
    )) return;
    patch({ status: to });
  };

  const forward = nextStatus(build.status);

  const addPart = () => patch({
    parts: [...(build.parts || []), {
      id: uid(), category: 'CPU', name: '', cost: 0, condition: 'new', source: 'retail',
    }],
  });
  const setPart = (id: string, p: Partial<BuildPart>) =>
    patch({ parts: (build.parts || []).map(x => x.id === id ? { ...x, ...p } : x) });
  const removePart = (id: string) => patch({ parts: (build.parts || []).filter(x => x.id !== id) });

  const logLabour = (hours: number, note: string) => patch({
    labour: [...(build.labour || []), {
      id: uid(), userId: currentUserId, userEmail: currentUserEmail,
      hours, date: todayISO(), ...(note ? { note } : {}),
      // THE RATE IS SNAPSHOTTED HERE — changing the setting later must never
      // reprice a build that was already costed (domain/pcBuild.ts).
      rate: labourRate, loggedAt: Date.now(),
    }],
  });

  // Photos live on the DEVICE a finished build became — photograph the machine
  // once and it serves the spec sheet, the Marketplace listing and the kiosk.
  const sheet = customerSheet({ build, warrantyDays, price: device?.targetSalePrice, photos: device?.photos });
  const card = displayCard({
    build, price: device?.targetSalePrice, warrantyDays,
    shopName: store.storeName, shopPhone: (store as { phone?: string }).phone || '',
    performance,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"><ArrowLeft className="w-4 h-4" /></button>
        <div className="flex-1 min-w-0">
          <DraftInput value={build.name} recordKey={build.id} onCommit={name => patch({ name })}
            className="text-xl font-bold bg-transparent text-slate-900 dark:text-white w-full outline-none" />
          <p className="text-xs text-slate-400">
            {buildKindLabel[build.kind]}{build.customerName ? ` · ${build.customerName}` : ''}
            {device ? ` · ${device.sku}` : ''}
          </p>
        </div>
        <span className={`text-[11px] font-semibold px-2 py-1 rounded ${STATUS_CLS[build.status]}`}>{BUILD_STATUS_LABEL[build.status]}</span>
        {onDelete && (
          <button onClick={() => window.confirm('Delete this build? Its parts and labour history go with it.') && onDelete()}
            className="p-2 text-slate-400 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
        )}
      </div>

      {/* Pipeline */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {BUILD_FLOW.map(s => (
          <button key={s} onClick={() => moveTo(s)} disabled={isBuildFinished(build)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border disabled:opacity-40 ${
              build.status === s
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>
            {BUILD_STATUS_LABEL[s]}
          </button>
        ))}
        {forward && !isBuildFinished(build) && (
          <button onClick={() => moveTo(forward)}
            className="ml-1 flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            {BUILD_STATUS_LABEL[forward]} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {!editable && (
        <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {PARTS_LOCKED_NOTE}
        </p>
      )}

      {/* TOTALS — ours against theirs, without anyone doing the arithmetic. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Our cost" value={money(totals.totalCost)}
          note={`${money(totals.partsCost)} parts + ${money(totals.labourCost)} labour`} />

        {/* A partial retail total is a real figure as far as it goes, but it is
            NOT the retail price of this machine — so it is labelled as partial
            rather than presented as the whole. */}
        <Tile label="Retail" value={totals.retailTotal > 0 ? money(totals.retailTotal) : '—'}
          note={totals.partCount === 0
            ? 'No parts yet'
            : `${totals.retailPriced} of ${totals.partCount} priced`}
          warn={!totals.retailComplete && totals.retailPriced > 0} />

        {/* The saving is shown ONLY when every part is priced: a saving built
            from some of the parts is a different number wearing the same
            label, and nobody reading it can tell. */}
        {totals.altStoreTotal != null ? (
          <Tile label={`At ${totals.altStoreName}`} value={money(totals.altStoreTotal)}
            note={totals.altFallbackCount > 0
              ? `${totals.altFallbackCount} part${totals.altFallbackCount === 1 ? '' : 's'} use the new price`
              : 'Every part priced at that store'} />
        ) : (
          <Tile label="You save" value={totals.retailSaving != null ? money(totals.retailSaving) : '—'}
            note={totals.retailSaving != null ? 'Retail − our cost' : 'Price every part to compare'} />
        )}

        {/* EDITABLE, any time before the build is finished. Same local-draft
            handling as every other field here: committed on blur or after a
            short pause, never written per keystroke, and never overwritten
            while somebody is typing in it. */}
        <EditableTile
          label={build.kind === 'customer' ? 'Quote' : 'Target'}
          value={totals.price ?? undefined}
          recordKey={build.id}
          disabled={!editable}
          onCommit={commitPrice}
          note={!editable
            ? 'Locked — this build has been sold'
            : deposit > 0
              ? `${money(deposit)} collected · balance ${money(Math.max(0, (totals.price || 0) - deposit))}`
              : build.kind === 'customer' ? 'What the customer was quoted' : 'What we intend to sell it for'}
          warn={deposit > 0} />
      </div>

      {/* The saving keeps its own line when the store tile took its slot. */}
      {totals.altStoreTotal != null && totals.retailSaving != null && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Retail {money(totals.retailTotal)} — you save <b className="text-emerald-600">{money(totals.retailSaving)}</b> against our cost.
        </p>
      )}

      {/* RENAMING THE BUILD DOES NOT RENAME THE DEVICE. Once a shelf build is
          finished it IS an inventory device with its own name, its own SKU and
          its own history; quietly rewriting that from here would rename a row
          in inventory, on a label and in a sale. */}
      {device && (
        <p className="text-[11px] text-slate-400">
          Renaming this build does not rename {device.sku} — the device keeps the name it was finished with.
        </p>
      )}

      {/* THE SHOP'S OWN NOTES. Internal: never on the display card, never on
          the public listing, and not on the customer spec sheet either. */}
      <div>
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
          <StickyNote className="w-3.5 h-3.5" /> Notes <span className="font-normal text-slate-400">· internal, never shown to a customer</span>
        </label>
        <DraftTextarea value={build.notes || ''} recordKey={build.id}
          onCommit={notes => patch({ notes })}
          placeholder="Waiting on the GPU · customer wants white cables · tested overnight"
          className={`${input} min-h-[64px] resize-y`} />
      </div>

      {/* Typed once here, and the default for every part's own store. */}
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Compare against</label>
        <DraftInput value={build.comparisonStore || ''} recordKey={build.id}
          onCommit={comparisonStore => patch({ comparisonStore })}
          placeholder="e.g. Canada Computers — sets the default store for every part"
          className={`${input} max-w-sm`} />
      </div>
      {totals.profit != null && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Profit <b className={totals.profit >= 0 ? 'text-emerald-600' : 'text-rose-500'}>{money(totals.profit)}</b>
          {totals.marginPercent != null && <> · margin <b>{totals.marginPercent.toFixed(1)}%</b></>}
          <span className="block text-[11px] text-slate-400 mt-0.5">
            Labour is already paid through payroll, so it counts toward this build’s profit only — never twice.
          </span>
        </p>
      )}

      {/* Parts */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">Parts ({(build.parts || []).length})</h2>
        {editable && (
          <button onClick={addPart} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white">
            <Plus className="w-3.5 h-3.5" /> Add part
          </button>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {(build.parts || []).length === 0 && (
          <p className="text-sm text-slate-400 text-center py-8 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
            No parts yet. Parts aren’t tracked as stock — type each one’s cost as you buy it.
          </p>
        )}
        {(build.parts || []).map(p => (
          <PartRow key={p.id} part={p} editable={editable} buildStore={build.comparisonStore}
            onChange={x => setPart(p.id, x)} onRemove={() => removePart(p.id)} />
        ))}
      </div>

      {/* Labour */}
      <LabourPanel build={build} labourRate={labourRate} onLog={logLabour} />

      {/* PHOTOS OF THE FINISHED MACHINE — stored on the device, not the build. */}
      {device && workspaceId && onSaveDevice && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">Photos</h3>
          <p className="text-xs text-slate-400 mb-3">
            Of the finished machine. These are what the Marketplace listing, the printed spec sheet and the counter kiosk show.
          </p>
          <DevicePhotos
            workspaceId={workspaceId}
            itemId={device.id}
            photos={device.photos}
            currentUserId={currentUserId}
            onChange={photos => { void onSaveDevice({ ...device, photos }); }}
          />
        </div>
      )}

      {/* EXPECTED PERFORMANCE — estimates from the shop's reviewed table for
          this build's card, with anything measured on this machine replacing
          them. A card with no rows shows nothing at all rather than a guess. */}
      <PerformancePanel
        build={build}
        lines={performance}
        // RECORDING happens from Testing onwards — that is when the machine
        // exists and somebody is sitting in front of it with a game open.
        // Reading stays available at every stage.
        canMeasure={editable && (build.status === 'testing' || build.status === 'ready')}
        canEdit={editable}
        onMeasure={m => patch({ measuredFps: [...(build.measuredFps || []), m] })}
        onRemoveMeasurement={id => patch({ measuredFps: (build.measuredFps || []).filter(x => x.id !== id) })}
        currentUserId={currentUserId}
        currentUserEmail={currentUserEmail}
      />

      {/* THE PUBLIC LINK. One per build, for a Marketplace post. */}
      {canHaveDisplayCard(build) && <SharePanel build={build} onSave={onSave} takenCodes={takenCodes} />}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 dark:border-slate-800 pt-4">
        <button onClick={() => printBuildSheet(sheet, { storeName: store.storeName, storePhone: (store as { phone?: string }).phone })}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400">
          <FileText className="w-4 h-4" /> Spec sheet
        </button>
        {canHaveDisplayCard(build) && (
          <button onClick={() => setCardPreview(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400">
            <Printer className="w-4 h-4" /> Display card
          </button>
        )}
        {build.kind === 'shelf' && !build.inventoryId && build.status === 'ready' && (
          <button disabled={isSubmitting}
            onClick={() => run(async () => onFinishBuild(build, generatedItemName(build.parts || [])))}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white">
            <CheckCircle2 className="w-4 h-4" /> {isSubmitting ? 'Finishing…' : 'Finish build → inventory'}
          </button>
        )}
        <button onClick={() => setListingOpen(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400">
          <Sparkles className="w-4 h-4" /> Generate listing
        </button>
        {onDuplicate && (
          <button onClick={() => {
            if (!window.confirm('Start a new build from this one?\n\nThe parts, prices and notes come across. Serials, warranty dates, labour and anything to do with the customer or the sale do not — they belong to this machine.')) return;
            onDuplicate();
          }}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400">
            <CopyPlus className="w-4 h-4" /> Duplicate
          </button>
        )}
        {device && onOpenInventoryItem && (
          <button onClick={() => onOpenInventoryItem(device.id)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400">
            <ExternalLink className="w-4 h-4" /> Open {device.sku}
          </button>
        )}
        {build.kind === 'customer' && onTakeDeposit && !build.saleId && (
          <button onClick={() => onTakeDeposit(build)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white">
            <CreditCard className="w-4 h-4" /> Take deposit
          </button>
        )}
        {build.kind === 'customer' && build.status === 'ready' && totals.price != null && (
          <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            Ready for pickup — balance {money(totals.price)}
          </span>
        )}
      </div>

      {listingOpen && (
        <ListingModal
          isBuild
          hasShareLink={!!build.shareToken}
          // An advert with nowhere to send somebody for the full specs is a
          // worse advert, so the offer is made here rather than the line being
          // dropped in silence.
          onCreateShareLink={build.shareToken ? undefined : () => {
            try { patch({ shareToken: newShareCode(c => takenCodes.has(c)), shareCreatedAt: Date.now() }); }
            catch { /* the panel below surfaces the same failure properly */ }
          }}
          saved={build.lastListing}
          onSave={lastListing => patch({ lastListing })}
          onClose={() => setListingOpen(false)}
          // THE FACTS, built from an allow-list — never the build document.
          facts={(options: ListingOptions) => buildFacts(build, {
            warrantyDays, options,
            shareCode: build.shareToken,
            price: device?.targetSalePrice,
            // The model WORDS these; it does not produce them. Passing them as
            // input is also what lets them through the "no number that was not
            // in the input" check (domain/listingCopy.ts).
            performance: performance.map(l => ({
              game: l.game, resolution: l.resolution, preset: l.preset,
              fpsLow: l.fpsLow, fpsHigh: l.fpsHigh, measured: l.measured,
            })),
          })}
        />
      )}

      {cardPreview && (
        <CardPreview card={card} onClose={() => setCardPreview(false)} build={build}
          devicePrice={device?.targetSalePrice} warrantyDays={warrantyDays} store={store}
          performance={performance} />
      )}
    </div>
  );
};

/* ---------------- One part ---------------- */

/** One totals tile: a label, the figure, and a line saying where it came from. */
const Tile: React.FC<{ label: string; value: string; note?: string; warn?: boolean }> = ({ label, value, note, warn }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
    <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
    <p className="text-lg font-bold text-slate-900 dark:text-white">{value}</p>
    {note && (
      <p className={`text-[11px] mt-0.5 ${warn ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-400'}`}>
        {warn ? `Partial — ${note}` : note}
      </p>
    )}
  </div>
);

/**
 * The same tile, with the figure editable in place.
 *
 * It looks like the read-only tiles beside it until it is clicked, because it
 * IS one of the totals — making it a form field in its own box would say the
 * price is a different kind of thing from the cost and the retail total, which
 * it is not.
 */
const EditableTile: React.FC<{
  label: string;
  value: number | undefined;
  recordKey: string;
  onCommit: (v: number | undefined) => void;
  note?: string;
  warn?: boolean;
  disabled?: boolean;
}> = ({ label, value, recordKey, onCommit, note, warn, disabled }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
    <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
    <div className="flex items-baseline gap-0.5">
      <span className={`text-lg font-bold ${value == null ? 'text-slate-300 dark:text-slate-600' : 'text-slate-900 dark:text-white'}`}>$</span>
      <DraftNumber value={value} recordKey={recordKey} onCommit={onCommit} disabled={disabled}
        min="0" step="0.01" placeholder="—"
        className="w-full min-w-0 bg-transparent text-lg font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500 rounded px-0.5 disabled:opacity-60" />
    </div>
    {note && (
      <p className={`text-[11px] mt-0.5 ${warn ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-400'}`}>{note}</p>
    )}
  </div>
);

/**
 * A FIELD THAT DOES NOT LOSE THE CARET.
 *
 * Every input on this screen used to be controlled straight off the saved
 * build, and every keystroke wrote to Firestore. The subscription echoed the
 * document back, the input re-rendered with the round-tripped string, and the
 * browser put the caret at the END — so correcting one letter in the middle of
 * a part name meant retyping the rest of it.
 *
 * These two wrap hooks/useFieldDraft.ts so the fix is uniform: local draft
 * while focused, committed on blur or after a short pause, and never
 * overwritten by an incoming update while somebody is typing in it. As a side
 * effect the write-per-character is gone, which was real Firestore cost.
 */
const DraftInput: React.FC<{
  value: string;
  /** The record this field belongs to — a part id. Changing it re-seeds. */
  recordKey: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  type?: string;
  autoFocus?: boolean;
}> = ({ value, recordKey, onCommit, ...rest }) => {
  const draft = useFieldDraft(value, recordKey, onCommit);
  return <input {...rest} {...draft.bind} />;
};

/** The same, for several lines of text. */
const DraftTextarea: React.FC<{
  value: string;
  recordKey: string;
  onCommit: (v: string) => void;
  className?: string;
  placeholder?: string;
}> = ({ value, recordKey, onCommit, ...rest }) => {
  const draft = useFieldDraft(value, recordKey, onCommit);
  return <textarea {...rest} {...draft.bind} />;
};

/** The same, for a number. Blank commits `undefined`, not 0 — see numericDraft. */
const DraftNumber: React.FC<{
  value: number | undefined;
  recordKey: string;
  onCommit: (v: number | undefined) => void;
  className?: string;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  min?: string;
  step?: string;
}> = ({ value, recordKey, onCommit, ...rest }) => {
  const draft = useFieldDraft(
    value == null ? '' : String(value),
    recordKey,
    (v) => onCommit(numericDraft(v)),
  );
  return <input type="number" {...rest} {...draft.bind} />;
};

/**
 * ONE PART.
 *
 * WHAT WAS PAID and WHAT IT SELLS FOR NEW are the two numbers the person
 * buying the parts is actually working with, so both sit on the row itself,
 * side by side, always editable. Retail used to be buried behind "More", and
 * the cost was typed once and then locked behind the word "Recorded" — so the
 * builder could not check or correct their own entry.
 *
 * "More" keeps everything that is reference rather than working data: source,
 * the listing/order link, serial, manufacturer warranty, the PCPartPicker
 * product link, and the retail source that goes with the retail price.
 */
const PartRow: React.FC<{
  part: BuildPart;
  editable: boolean;
  /** The build's comparison store, which defaults this part's. */
  buildStore?: string;
  onChange: (p: Partial<BuildPart>) => void;
  onRemove: () => void;
}> = ({ part, editable, buildStore, onChange, onRemove }) => {
  const [expanded, setExpanded] = useState(false);
  const stale = retailAgeDays(part);
  const isStale = stale != null && stale > RETAIL_STALE_DAYS;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
      {/* flex-wrap throughout, and every fixed-width control is shrink-0 with
          a wrapping group — the row reflows on a phone instead of overflowing. */}
      <div className="flex flex-wrap items-start gap-2">
        <select value={part.category} disabled={!editable}
          onChange={e => onChange({ category: e.target.value as PartCategory })}
          className={`${input} w-32 shrink-0`}>
          {PART_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <DraftInput value={part.name} recordKey={part.id} disabled={!editable}
          onCommit={name => onChange({ name })}
          placeholder="Exact model, e.g. RTX 4070 Windforce OC 12GB" className={`${input} flex-1 min-w-[180px]`} />

        {/* The two money fields, kept together so they wrap as a pair. */}
        <div className="flex items-start gap-2 shrink-0">
          <div className="w-24">
            {/* A cost carried over by Duplicate is an ESTIMATE until somebody
                confirms it, so typing over it is what clears the flag — the
                edit IS the confirmation, and a separate "confirm" button would
                be one more thing to forget. */}
            <DraftNumber value={part.cost || undefined} recordKey={part.id} disabled={!editable}
              min="0" step="0.01" onCommit={v => onChange({ cost: v ?? 0, costFromCopy: undefined })}
              placeholder="Cost" title={part.costFromCopy
                ? 'Copied from the build this one was duplicated from — check it against the receipt'
                : 'What the shop paid for this part'}
              className={`${input} ${part.costFromCopy ? 'border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/10' : ''}`} />
            <span className={`block text-[10px] mt-0.5 text-center ${part.costFromCopy ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-400'}`}>
              {part.costFromCopy ? 'Copied' : 'Paid'}
            </span>
          </div>
          <div className="w-28">
            <DraftNumber value={part.retailPrice} recordKey={part.id} disabled={!editable}
              min="0" step="0.01"
              onCommit={retailPrice => onChange({
                retailPrice,
                // A price with no date looks current forever, so the date is
                // stamped WITH it rather than left to be filled in. Clearing
                // the price clears the date with it.
                retailCheckedAt: retailPrice == null ? undefined : todayISO(),
              })}
              placeholder="Retail" title="What it sells for new — used for the customer's value comparison"
              className={input} />
            {/* The date is the quiet part: a stale retail price must LOOK
                stale, or the comparison on the customer's card is fiction. */}
            <span className={`block text-[10px] mt-0.5 text-center truncate ${isStale ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-slate-400'}`}
              title={part.retailPrice != null ? retailAsOfLabel(part) : undefined}>
              {part.retailPrice == null
                ? 'New price'
                : isStale ? `${stale}d old` : (part.retailCheckedAt || 'no date')}
            </span>
          </div>
        </div>

        <select value={part.condition} disabled={!editable}
          onChange={e => onChange({ condition: e.target.value as PartCondition })}
          className={`${input} w-28 shrink-0`}>
          {(Object.keys(CONDITION_LABEL) as PartCondition[]).map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
        </select>

        <div className="flex items-center gap-1 shrink-0">
          <a href={pcPartPickerSearchUrl(part.name)} target="_blank" rel="noreferrer"
            title="Search PCPartPicker (Canada) for this part"
            className="flex items-center gap-1 px-2 py-2 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
            <ExternalLink className="w-3.5 h-3.5" /> Look up
          </a>
          <button onClick={() => setExpanded(x => !x)} className="text-xs text-slate-500 hover:text-indigo-600 px-2">
            {expanded ? 'Less' : 'More'}
          </button>
          {editable && <button onClick={onRemove} className="p-1 text-slate-400 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>}
        </div>
      </div>

      {expanded && (
        <div className="grid md:grid-cols-3 gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <div>
            <label className={label}>Source</label>
            <select value={part.source} disabled={!editable}
              onChange={e => onChange({ source: e.target.value as PartSource })} className={input}>
              {(Object.keys(SOURCE_LABEL) as PartSource[]).map(sv => <option key={sv} value={sv}>{SOURCE_LABEL[sv]}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className={label}>Listing / order link</label>
            <DraftInput value={part.sourceUrl || ''} recordKey={part.id} disabled={!editable}
              onCommit={sourceUrl => onChange({ sourceUrl })} className={input}
              placeholder="https://…" />
          </div>
          <div>
            {/* The serial is what makes a build findable from a warranty
                lookup — a dead GPU and the number on the card is all a
                customer will have (domain/warranty.ts). */}
            <label className={label}>Serial</label>
            <DraftInput value={part.serial || ''} recordKey={part.id} disabled={!editable}
              onCommit={serial => onChange({ serial })} className={input} />
          </div>
          <div>
            <label className={label}>Manufacturer warranty until</label>
            <input type="date" value={part.mfrWarrantyUntil || ''} disabled={!editable}
              onChange={e => onChange({ mfrWarrantyUntil: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label}>PCPartPicker product link</label>
            <DraftInput value={part.pcpartpickerUrl || ''} recordKey={part.id} disabled={!editable}
              onCommit={pcpartpickerUrl => onChange({ pcpartpickerUrl })} className={input}
              placeholder="Paste the exact product link" />
          </div>
          <div>
            {/* The retail PRICE is on the row itself; what stays here is where
                it came from and when it was checked — reference for the price,
                not the price. */}
            <label className={label}>Retail source</label>
            <div className="flex gap-2">
              <DraftInput value={part.retailSource || ''} recordKey={part.id} disabled={!editable}
                onCommit={retailSource => onChange({ retailSource })} className={input}
                placeholder="e.g. Canada Computers" />
              {/* ─────────────────────────────────────────────────────────────
                  UNIMPLEMENTED — "Look up retail price" goes here.
                  The AI price lookup (Claude web search) arrives with the
                  separate provider PR; this slot is deliberately inert and
                  hidden behind the flag below so the layout is already right
                  when it lands. Do not wire it up here.
                  ───────────────────────────────────────────────────────────── */}
              {AI_PRICE_LOOKUP_ENABLED && (
                <button type="button" disabled title="Coming soon"
                  className="shrink-0 px-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed">
                  <Sparkles className="w-4 h-4" />
                </button>
              )}
            </div>
            {part.retailPrice != null && (
              <p className={`text-[11px] mt-1 ${isStale ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                {retailAsOfLabel(part)}
                {isStale && ` — ${stale} days old`}
              </p>
            )}
          </div>
          {/* WHAT A CUSTOMER WOULD PAY AT A NAMED STORE. The argument the shop
              makes is not "these parts retail for X" but "you would pay X at
              Canada Computers to build this yourself". Comparison only — it
              never touches cost, profit or margin. */}
          <div>
            <label className={label}>Price at {buildStore || 'comparison store'}</label>
            <DraftNumber value={part.altStorePrice} recordKey={part.id} disabled={!editable}
              min="0" step="0.01" onCommit={altStorePrice => onChange({ altStorePrice })}
              className={input} placeholder="0.00" />
            <p className="text-[11px] text-slate-400 mt-1">
              {part.altStorePrice == null ? 'Falls back to the new price above.' : 'Used in the “build it yourself” total.'}
            </p>
          </div>
          <div>
            <label className={label}>Store for this part</label>
            <DraftInput value={part.altStoreName || ''} recordKey={part.id} disabled={!editable}
              onCommit={altStoreName => onChange({ altStoreName })} className={input}
              placeholder={buildStore || 'e.g. Canada Computers'} />
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * The AI retail-price lookup is not built yet — it arrives with the Claude
 * provider work. The slot above renders only when this is turned on, so the
 * button cannot be clicked in the meantime and the layout is already correct
 * for when it is.
 */
const AI_PRICE_LOOKUP_ENABLED = false;

/** Where the remembered print orientation lives. Per device, not per user. */
const CARD_ORIENTATION_KEY = 'ftt_card_orientation_v1';

/* ---------------- Labour ---------------- */

const LabourPanel: React.FC<{
  build: PcBuild;
  labourRate: number;
  onLog: (hours: number, note: string) => void;
}> = ({ build, labourRate, onLog }) => {
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const entries = build.labour || [];

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
      <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-slate-400" /> Labour
      </h2>
      <div className="flex flex-wrap items-end gap-2 mb-3">
        <div className="w-24">
          <label className={label}>Hours</label>
          <input type="number" min="0" step="0.25" value={hours} onChange={e => setHours(e.target.value)} className={input} />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className={label}>Note (optional)</label>
          <input value={note} onChange={e => setNote(e.target.value)} className={input} placeholder="e.g. cable management" />
        </div>
        <button
          onClick={() => {
            const h = parseFloat(hours);
            if (!Number.isFinite(h) || h <= 0) return;
            onLog(h, note.trim());
            setHours(''); setNote('');
          }}
          className="px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white">
          Log time
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-slate-400">No time logged yet.</p>
      ) : (
        <div className="space-y-1">
          {entries.map(l => (
            <div key={l.id} className="flex items-center justify-between gap-3 text-xs border-b border-slate-50 dark:border-slate-800/60 last:border-0 py-1.5">
              <span className="text-slate-600 dark:text-slate-300 truncate">
                {l.userEmail} · {l.date}{l.note ? ` · ${l.note}` : ''}
              </span>
              <span className="text-slate-500 shrink-0">
                {l.hours}h · {money(l.hours * l.rate)}
              </span>
            </div>
          ))}
        </div>
      )}
      {(
        <p className="text-[11px] text-slate-400 mt-2">
          Costed at ${labourRate.toFixed(2)}/hr, snapshotted when logged — changing the rate later never reprices past entries.
        </p>
      )}
    </div>
  );
};

/* ---------------- Display card preview ---------------- */

/**
 * THE SHARE LINK.
 *
 * The shop posts builds on Facebook Marketplace and wants one link per build
 * showing the specs, the price and what the same parts cost new elsewhere — so
 * a buyer sees the value without phoning.
 *
 * LINK-ONLY: there is no index and no way to browse, so holding the token is
 * the whole of the access check. It is 26 characters from a CSPRNG
 * (domain/buildShare.ts), and what the page can show is decided server-side
 * from an allow-list (functions/src/publicBuildPolicy.ts) — the browser never
 * touches the build document, which carries part costs and serials.
 */
const SharePanel: React.FC<{
  build: PcBuild;
  /** Every code already in use, so a new one cannot collide with it. */
  takenCodes: Set<string>;
  onSave: (b: PcBuild, prev?: PcBuild) => void;
}> = ({ build, takenCodes, onSave }) => {
  const [copied, setCopied] = useState<'link' | 'ad' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const code = build.shareToken;
  const state = shareState({ shareToken: code, status: build.status, soldAt: build.finishedAt });

  const isTaken = (c: string) => takenCodes.has(c) && c !== build.shareToken;

  const put = (next: string | undefined) => onSave({
    ...build,
    shareToken: next,
    shareCreatedAt: next ? Date.now() : undefined,
    ...(next ? {} : { shareCreatedBy: undefined }),
  }, build);

  const mint = (regenerating: boolean) => {
    if (regenerating && !window.confirm(
      'Make a new link?\n\nThe current link stops working straight away — anywhere it has been posted, it will show "No longer available".',
    )) return;
    try {
      setError(null);
      put(newShareCode(isTaken));
    } catch (e) {
      // newShareCode refuses rather than falling back to Math.random, and
      // gives up rather than reusing a code.
      setError(e instanceof Error ? e.message : 'Could not create a link.');
    }
  };

  const useCustom = () => {
    // A whole URL pasted in is what somebody will actually do.
    const typed = codeFromShareInput(custom) ?? custom;
    const result = validateCustomCode(typed, isTaken);
    if (result.ok === false) { setError(CUSTOM_CODE_MESSAGE[result.error]); return; }
    setError(null);
    put(result.code);
    setCustom('');
    setCustomOpen(false);
  };

  const stopSharing = () => {
    if (!window.confirm('Stop sharing?\n\nThe link stops working straight away, wherever it has been posted.')) return;
    put(undefined);
  };

  const copy = async (what: 'link' | 'ad', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Could not copy — select the text and copy it manually.');
    }
  };

  if (!code) {
    return (
      <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => mint(false)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400">
            <LinkIcon className="w-4 h-4" /> Share link
          </button>
          <button onClick={() => setCustomOpen(v => !v)} className="text-xs text-slate-500 hover:text-indigo-600 underline">
            or pick your own code
          </button>
        </div>
        {customOpen && <CustomCodeRow value={custom} onChange={setCustom} onUse={useCustom} />}
        <p className="text-[11px] text-slate-400 mt-1.5">
          Makes a public page for this build — specs, your price and the comparison. Anyone with the link can see it; it is not listed anywhere.
        </p>
        {error && <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">{error}</p>}
      </div>
    );
  }

  const display = shareLinkDisplay(code);
  const url = shareLinkUrl(code);
  const adText = shareAdLine(code);

  return (
    <div className="border-t border-slate-100 dark:border-slate-800 pt-4 space-y-2">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[220px] space-y-2">
          {/* THE FORM THAT GOES IN AN ADVERT. No scheme, because nobody types
              "https://" and a Marketplace description is not clickable — this
              is a line somebody reads off a screen and types. */}
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={display} onFocus={e => e.currentTarget.select()}
              className={`${input} flex-1 min-w-[180px] font-mono text-sm font-semibold`} />
            <button onClick={() => copy('link', display)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 text-white shrink-0">
              {copied === 'link' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied === 'link' ? 'Copied' : 'Copy'}
            </button>
          </div>
          <button onClick={() => copy('ad', adText)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400">
            {copied === 'ad' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied === 'ad' ? 'Copied' : 'Copy ad text'}
          </button>
          <p className="text-[11px] text-slate-400">“{adText}”</p>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <button onClick={() => mint(true)} className="text-slate-500 hover:text-indigo-600 underline">New link</button>
            <button onClick={() => setCustomOpen(v => !v)} className="text-slate-500 hover:text-indigo-600 underline">Pick a code</button>
            <button onClick={stopSharing} className="text-slate-500 hover:text-rose-600 underline">Stop sharing</button>
            {state === 'sold' && (
              <span className="text-amber-600 dark:text-amber-400">
                Sold — the link keeps working for {SOLD_LINK_GRACE_DAYS} days, then shows “No longer available”.
              </span>
            )}
            {state === 'expired' && (
              <span className="text-slate-500">This link has expired and now shows “No longer available”.</span>
            )}
          </div>
          {customOpen && <CustomCodeRow value={custom} onChange={setCustom} onUse={useCustom} />}
        </div>

        {/* Big enough to scan off the counter tablet from across the desk. */}
        <ShareQr url={url} size={132} caption="Scan for full specs and photos" />
      </div>
      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
};

/**
 * WHAT IT RUNS AT.
 *
 * Two kinds of figure, always labelled: an ESTIMATE from the shop's reviewed
 * per-GPU table, and a measurement taken on THIS machine, which is a much
 * stronger thing to be able to say and so is marked plainly.
 *
 * A build whose GPU has no rows in the table renders nothing — no heading, no
 * empty state, no invitation to improvise. The one thing this feature must
 * never do is produce a number nobody stands behind.
 */
const PerformancePanel: React.FC<{
  build: PcBuild;
  lines: PerformanceLine[];
  /** May a NEW measurement be recorded right now? */
  canMeasure: boolean;
  /** May existing measurements be reviewed and removed? */
  canEdit: boolean;
  onMeasure: (m: MeasuredFps) => void;
  onRemoveMeasurement: (id: string) => void;
  currentUserId: string;
  currentUserEmail: string;
}> = ({ build, lines, canMeasure, canEdit, onMeasure, onRemoveMeasurement, currentUserId, currentUserEmail }) => {
  const [adding, setAdding] = useState(false);
  const [game, setGame] = useState<string>(GPU_GAMES[0]);
  const [resolution, setResolution] = useState<string>(GPU_RESOLUTIONS[0]);
  const [preset, setPreset] = useState('High');
  const [fps, setFps] = useState('');

  const gpu = buildGpu(build);
  const measured = build.measuredFps || [];
  // Measuring is offered from Testing onwards — that is when the machine
  // exists and somebody is sitting in front of it.
  const offerMeasure = canMeasure && !!gpu;
  if (lines.length === 0 && !offerMeasure) return null;

  const record = () => {
    const value = parseFloat(fps);
    if (!Number.isFinite(value) || value <= 0) return;
    onMeasure({
      id: uid(), game, resolution, preset: preset.trim() || 'High',
      fps: Math.round(value),
      measuredBy: currentUserId, measuredByEmail: currentUserEmail,
      measuredAt: Date.now(),
    });
    setFps('');
    setAdding(false);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
          <Gauge className="w-4 h-4 text-indigo-500" /> Expected performance
        </h3>
        {offerMeasure && (
          <button onClick={() => setAdding(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400">
            <Plus className="w-3.5 h-3.5" /> Record measured fps
          </button>
        )}
      </div>
      {gpu && <p className="text-[11px] text-slate-400 mb-2">{gpu}</p>}

      {adding && (
        <div className="flex flex-wrap items-end gap-2 mb-3 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
          <select value={game} onChange={e => setGame(e.target.value)} className={`${input} w-44`}>
            {GPU_GAMES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={resolution} onChange={e => setResolution(e.target.value)} className={`${input} w-24`}>
            {GPU_RESOLUTIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <input value={preset} onChange={e => setPreset(e.target.value)} placeholder="Preset" className={`${input} w-28`} />
          <input type="number" min="1" value={fps} onChange={e => setFps(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') record(); }}
            placeholder="fps" className={`${input} w-20`} />
          <button onClick={record} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white">Save</button>
        </div>
      )}

      {lines.length === 0 ? (
        <p className="text-xs text-slate-400">
          No figures for this card yet. An owner can fill them in under Settings → PC Builds, or record what you measure here.
        </p>
      ) : (
        <>
          <div className="grid gap-1.5">
            {lines.map(l => (
              <div key={`${l.game}-${l.resolution}`} className="flex items-baseline justify-between gap-2 text-sm">
                <span className="text-slate-600 dark:text-slate-300 min-w-0 truncate">
                  {l.game} <span className="text-xs text-slate-400">· {l.resolution} · {l.preset}</span>
                </span>
                <span className="shrink-0 flex items-center gap-1.5">
                  <b className="text-slate-900 dark:text-white">{fpsLabel(l)}</b>
                  {l.measured && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">{MEASURED_LABEL}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">{PERFORMANCE_CAVEAT}</p>
        </>
      )}

      {measured.length > 0 && canEdit && (
        <div className="mt-3 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1">
          {measured.map(m => (
            <div key={m.id} className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
              <span className="truncate">
                Measured {m.game} {m.resolution} {m.preset} — {m.fps} fps{m.measuredByEmail ? ` · ${m.measuredByEmail}` : ''}
              </span>
              <button onClick={() => onRemoveMeasurement(m.id)} aria-label="Remove measurement"
                className="p-1 text-slate-400 hover:text-rose-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const CustomCodeRow: React.FC<{
  value: string;
  onChange: (v: string) => void;
  onUse: () => void;
}> = ({ value, onChange, onUse }) => (
  <div className="flex flex-wrap items-center gap-2 mt-2">
    <span className="text-xs text-slate-400 font-mono">{SHARE_LINK_HOST}/b/</span>
    <input value={value} autoFocus
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') onUse(); }}
      placeholder="reaper" className={`${input} w-40 font-mono text-sm`} />
    <button onClick={onUse}
      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white">
      Use it
    </button>
  </div>
);

/**
 * THE QR CODE.
 *
 * Reuses the `qrcode` dependency the label printer already pulls in, with the
 * same options — one library, one look, nothing new in the bundle.
 *
 * It is derived from the URL on every render, so regenerating or revoking a
 * link regenerates the QR with it. There is no cached image anywhere that
 * could outlive the code it points at: printing a dead QR onto a card that
 * sits on a shelf for a month is exactly the failure worth designing out.
 */
const ShareQr: React.FC<{ url: string; size: number; caption?: string }> = ({ url, size, caption }) => {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(url, { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      .then(d => { if (live) setSrc(d); })
      .catch(() => { if (live) setSrc(''); });
    return () => { live = false; };
  }, [url]);
  if (!src) return null;
  return (
    <figure className="shrink-0 text-center m-0">
      <img src={src} alt="" width={size} height={size} className="rounded-lg bg-white p-1" />
      {caption && <figcaption className="text-[10px] text-slate-400 mt-1 max-w-[140px]">{caption}</figcaption>}
    </figure>
  );
};

const CardPreview: React.FC<{
  card: ReturnType<typeof displayCard>;
  build: PcBuild;
  devicePrice?: number;
  warrantyDays: number;
  store: { storeName: string };
  performance: PerformanceLine[];
  onClose: () => void;
}> = ({ build, devicePrice, warrantyDays, store, performance, onClose }) => {
  const [half, setHalf] = useState(false);
  const [showComparison, setShowComparison] = useState(true);
  const [showConditions, setShowConditions] = useState(true);
  const [showStoreName, setShowStoreName] = useState(true);
  // A shop prints the same way every time, so the choice is remembered per
  // device. Read through cardOrientation, which copes with whatever is
  // actually in localStorage — it survives a cleared or blocked store.
  const [orientation, setOrientation] = useState<CardOrientation>(() => {
    try { return cardOrientation(localStorage.getItem(CARD_ORIENTATION_KEY)); }
    catch { return DEFAULT_CARD_ORIENTATION; }
  });
  const chooseOrientation = (o: CardOrientation) => {
    setOrientation(o);
    try { localStorage.setItem(CARD_ORIENTATION_KEY, o); } catch { /* private window */ }
  };
  useEscapeKey(onClose);

  /**
   * THE QR, DERIVED FROM THE CODE ON THIS BUILD RIGHT NOW.
   *
   * Never stored, never carried over: regenerating or revoking the link
   * changes build.shareToken, this re-runs, and a card printed afterwards
   * carries the new code. A build with no link prints no QR rather than a
   * square that goes nowhere.
   */
  const [qr, setQr] = useState('');
  const shareCode = build.shareToken;
  useEffect(() => {
    if (!shareCode) { setQr(''); return; }
    let live = true;
    QRCode.toDataURL(shareLinkUrl(shareCode), { margin: 1, width: 320, errorCorrectionLevel: 'M' })
      .then(d => { if (live) setQr(d); })
      .catch(() => { if (live) setQr(''); });
    return () => { live = false; };
  }, [shareCode]);

  const card = displayCard({
    build, price: devicePrice, warrantyDays,
    shopName: store.storeName, shopPhone: (store as { phone?: string }).phone || '',
    showComparison, showConditions, showStoreName,
    // The same figures as the screen it was printed from.
    performance,
  });

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg border border-slate-200 dark:border-slate-700 p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Display card</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        {/* A miniature of the real thing — the same data, so what is previewed
            is what prints. */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 bg-gradient-to-br from-white to-slate-50 dark:from-slate-900 dark:to-slate-800">
          <div className="flex items-start justify-between gap-3">
            <p className="text-lg font-extrabold text-slate-900 dark:text-white leading-tight truncate">{card.name}</p>
            <div className="text-right shrink-0">
              <p className="text-2xl font-black text-indigo-600 dark:text-indigo-400 leading-none">{card.priceLabel}</p>
              {card.diyComparison ? (
                <>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
                    Build it yourself{card.diyComparison.store ? ` at ${card.diyComparison.store}` : ''}: <b>{card.diyComparison.total}</b>
                  </p>
                  {card.diyComparison.saving && (
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold">You save {card.diyComparison.saving}</p>
                  )}
                </>
              ) : card.comparison && (
                <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-bold mt-1">You save {card.comparison.saving}</p>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3">
            {card.specs.map(s => (
              <div key={s.category} className="min-w-0">
                <p className="text-[9px] uppercase tracking-wide text-slate-400 font-bold">{s.category}</p>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">{s.name}</p>
                {s.condition && <span className="text-[9px] text-amber-700 dark:text-amber-400">{s.condition}</span>}
              </div>
            ))}
          </div>
          <div className="flex items-end justify-between gap-3 mt-3">
            {card.warrantyBadge
              ? <p className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300">{card.warrantyBadge}</p>
              : <span />}
            {qr && (
              <figure className="m-0 text-center shrink-0">
                <img src={qr} alt="" width={44} height={44} className="bg-white rounded" />
                <figcaption className="text-[7px] text-slate-500 dark:text-slate-400 leading-tight mt-0.5 max-w-[60px]">
                  Scan for full specs and photos
                </figcaption>
              </figure>
            )}
          </div>
        </div>

        {/* Chosen BEFORE printing — both are real layouts, not one design
            squeezed into the other frame (services/buildPrint.ts). */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-600 dark:text-slate-300">Print</span>
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
            {CARD_ORIENTATIONS.map(o => (
              <button key={o} onClick={() => chooseOrientation(o)}
                className={`px-3 py-1.5 text-xs font-semibold capitalize ${
                  orientation === o
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>
                {o}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5 text-sm">
          {([
            ['Half page (two per sheet)', half, setHalf],
            ['Show the price comparison', showComparison, setShowComparison],
            ...(card.diyComparison || build.comparisonStore
              ? [['Name the store on the card', showStoreName, setShowStoreName] as [string, boolean, (v: boolean) => void]]
              : []),
            ['Show condition badges', showConditions, setShowConditions],
          ] as [string, boolean, (v: boolean) => void][]).map(([text, value, set]) => (
            <label key={text} className="flex items-center gap-2 text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={value} onChange={e => set(e.target.checked)} className="rounded" /> {text}
            </label>
          ))}
          {!card.comparison && !card.diyComparison && showComparison && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              No comparison shown: every part needs a price, or the total would understate the machine.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Close</button>
          <button onClick={() => printDisplayCard(card, {
            half, orientation,
            qrDataUrl: qr || undefined,
            qrLabel: shareCode ? shareLinkDisplay(shareCode) : undefined,
          })}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>
    </div>
  );
};
