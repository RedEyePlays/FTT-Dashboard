import React, { useMemo, useState } from 'react';
import {
  Cpu, Plus, Search, Trash2, X, ArrowRight, ArrowLeft, Printer, CreditCard,
  ExternalLink, Clock, FileText, AlertTriangle, Sparkles, CheckCircle2,
} from 'lucide-react';
import {
  BuildKind, BuildPart, BuildStatus, Customer, InventoryItem, PartCategory,
  PartCondition, PartSource, PcBuild,
} from '../types';
import { CustomerDraft } from '../domain/customers';
import {
  BUILD_FLOW, BUILD_STATUS_LABEL, CONDITION_LABEL, PART_CATEGORIES, SOURCE_LABEL,
  buildKindLabel, buildSearchText, buildTotals, generatedItemName, isBackwards,
  isBuildFinished, nextStatus, partsEditable, PARTS_LOCKED_NOTE, pcPartPickerSearchUrl,
  retailAgeDays, retailAsOfLabel, RETAIL_STALE_DAYS, splitBuilds,
} from '../domain/pcBuild';
import { canHaveDisplayCard, customerSheet, displayCard } from '../domain/buildSheet';
import { costAccessFor, RECORDED_LABEL } from '../domain/costVisibility';
import { buildSearchable, matchesWords, queryWords } from '../domain/itemSearch';
import { printBuildSheet, printDisplayCard } from '../services/buildPrint';
import { getStoreProfile } from './SettingsModal';
import { CustomerSearchInput } from './CustomerSearchInput';
import { useSellerLink } from '../hooks/useSellerLink';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { todayISO } from '../domain/dates';

/**
 * CUSTOM PC BUILDS.
 *
 * The list splits In progress from Completed, the same way the Tickets tab and
 * a batch's device list do — finished work leaves the working list rather than
 * accumulating in it. Search is the shared multi-word matcher.
 *
 * COST VISIBILITY follows the existing rules exactly (domain/costVisibility.ts):
 * staff may ENTER a part cost and then see "Recorded" rather than the figure,
 * and the totals, profit and margin are owner-only. A build is full of cost
 * data, so this is the screen where getting that wrong would matter most.
 */

interface Props {
  builds: PcBuild[];
  inventory: InventoryItem[];
  customers: Customer[];
  canViewCost: boolean;
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
  builds, inventory, customers, canViewCost, currentUserId, currentUserEmail,
  labourRate, warrantyDays, onSave, onDelete, onFinishBuild, onTakeDeposit,
  onCreateCustomer, onOpenInventoryItem, unavailableNotice,
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

  const split = useMemo(() => splitBuilds(matched), [matched]);
  const shown = view === 'completed' ? split.completed : split.active;
  const open = builds.find(b => b.id === openId) || null;

  if (open) {
    return (
      <BuildDetail
        build={open} inventory={inventory} customers={customers} canViewCost={canViewCost}
        currentUserId={currentUserId} currentUserEmail={currentUserEmail}
        labourRate={labourRate} warrantyDays={warrantyDays}
        onBack={() => setOpenId(null)} onSave={onSave}
        onDelete={onDelete ? () => { onDelete(open.id); setOpenId(null); } : undefined}
        onFinishBuild={onFinishBuild} onTakeDeposit={onTakeDeposit}
        onCreateCustomer={onCreateCustomer} onOpenInventoryItem={onOpenInventoryItem}
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
                  {/* The price is not a cost figure — everyone sees it. The
                      cost, profit and margin beside it are owner-only. */}
                  <div className="text-right shrink-0">
                    {t.price != null && <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{money(t.price)}</p>}
                    {canViewCost && t.profit != null && (
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
  canViewCost: boolean;
  currentUserId: string;
  currentUserEmail: string;
  labourRate: number;
  warrantyDays: number;
  onBack: () => void;
  onSave: (b: PcBuild, prev?: PcBuild) => void;
  onDelete?: () => void;
  onFinishBuild: (b: PcBuild, itemName: string) => unknown | Promise<unknown>;
  onTakeDeposit?: (b: PcBuild) => void;
  onCreateCustomer?: (draft: CustomerDraft) => Customer | undefined;
  onOpenInventoryItem?: (id: string) => void;
}> = ({
  build, inventory, canViewCost, currentUserId, currentUserEmail, labourRate,
  warrantyDays, onBack, onSave, onDelete, onFinishBuild, onTakeDeposit, onOpenInventoryItem,
}) => {
  const totals = buildTotals(build);
  const device = build.inventoryId ? inventory.find(i => i.id === build.inventoryId) : undefined;
  const editable = partsEditable(build, device);
  const { isSubmitting, run } = useSubmitGuard();
  const [cardPreview, setCardPreview] = useState(false);
  const store = getStoreProfile();

  const patch = (p: Partial<PcBuild>) => onSave({ ...build, ...p, updatedAt: Date.now() }, build);

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

  const sheet = customerSheet({ build, warrantyDays, price: device?.targetSalePrice });
  const card = displayCard({
    build, price: device?.targetSalePrice, warrantyDays,
    shopName: store.storeName, shopPhone: (store as { phone?: string }).phone || '',
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"><ArrowLeft className="w-4 h-4" /></button>
        <div className="flex-1 min-w-0">
          <input value={build.name} onChange={e => patch({ name: e.target.value })}
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

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Parts', canViewCost ? money(totals.partsCost) : RECORDED_LABEL],
          ['Labour', canViewCost ? `${money(totals.labourCost)} · ${totals.labourHours}h` : `${totals.labourHours}h`],
          ['Total cost', canViewCost ? money(totals.totalCost) : RECORDED_LABEL],
          [build.kind === 'customer' ? 'Quote' : 'Target', totals.price != null ? money(totals.price) : '—'],
        ].map(([k, v]) => (
          <div key={k} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{k}</p>
            <p className="text-lg font-bold text-slate-900 dark:text-white">{v}</p>
          </div>
        ))}
      </div>
      {canViewCost && totals.profit != null && (
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
          <PartRow key={p.id} part={p} canViewCost={canViewCost} editable={editable}
            onChange={x => setPart(p.id, x)} onRemove={() => removePart(p.id)} />
        ))}
      </div>

      {/* Labour */}
      <LabourPanel build={build} canViewCost={canViewCost} labourRate={labourRate} onLog={logLabour} />

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

      {cardPreview && (
        <CardPreview card={card} onClose={() => setCardPreview(false)} build={build}
          devicePrice={device?.targetSalePrice} warrantyDays={warrantyDays} store={store} />
      )}
    </div>
  );
};

/* ---------------- One part ---------------- */

const PartRow: React.FC<{
  part: BuildPart;
  canViewCost: boolean;
  editable: boolean;
  onChange: (p: Partial<BuildPart>) => void;
  onRemove: () => void;
}> = ({ part, canViewCost, editable, onChange, onRemove }) => {
  const [expanded, setExpanded] = useState(false);
  const costAccess = costAccessFor(canViewCost, part.cost);
  const stale = retailAgeDays(part);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={part.category} disabled={!editable}
          onChange={e => onChange({ category: e.target.value as PartCategory })}
          className={`${input} w-32 shrink-0`}>
          {PART_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input value={part.name} disabled={!editable} onChange={e => onChange({ name: e.target.value })}
          placeholder="Exact model, e.g. RTX 4070 Windforce OC 12GB" className={`${input} flex-1 min-w-[180px]`} />

        {/* COST: staff may ENTER one and then see "Recorded" — the existing
            write-only rule (domain/costVisibility.ts), unchanged. */}
        {costAccess === 'locked' ? (
          <div className="w-24 p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 italic text-sm text-center select-none">{RECORDED_LABEL}</div>
        ) : (
          <input type="number" min="0" step="0.01" disabled={!editable} value={part.cost || ''}
            onChange={e => onChange({ cost: parseFloat(e.target.value) || 0 })}
            placeholder="Cost" className={`${input} w-24 shrink-0`} />
        )}

        <select value={part.condition} disabled={!editable}
          onChange={e => onChange({ condition: e.target.value as PartCondition })}
          className={`${input} w-28 shrink-0`}>
          {(Object.keys(CONDITION_LABEL) as PartCondition[]).map(c => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
        </select>

        <a href={pcPartPickerSearchUrl(part.name)} target="_blank" rel="noreferrer"
          title="Search PCPartPicker (Canada) for this part"
          className="flex items-center gap-1 px-2 py-2 rounded-lg text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline shrink-0">
          <ExternalLink className="w-3.5 h-3.5" /> Look up
        </a>
        <button onClick={() => setExpanded(x => !x)} className="text-xs text-slate-500 hover:text-indigo-600 px-2 shrink-0">
          {expanded ? 'Less' : 'More'}
        </button>
        {editable && <button onClick={onRemove} className="p-1 text-slate-400 hover:text-rose-500 shrink-0"><Trash2 className="w-4 h-4" /></button>}
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
            <input value={part.sourceUrl || ''} disabled={!editable}
              onChange={e => onChange({ sourceUrl: e.target.value })} className={input}
              placeholder="https://…" />
          </div>
          <div>
            {/* The serial is what makes a build findable from a warranty
                lookup — a dead GPU and the number on the card is all a
                customer will have (domain/warranty.ts). */}
            <label className={label}>Serial</label>
            <input value={part.serial || ''} disabled={!editable}
              onChange={e => onChange({ serial: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label}>Manufacturer warranty until</label>
            <input type="date" value={part.mfrWarrantyUntil || ''} disabled={!editable}
              onChange={e => onChange({ mfrWarrantyUntil: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label}>PCPartPicker product link</label>
            <input value={part.pcpartpickerUrl || ''} disabled={!editable}
              onChange={e => onChange({ pcpartpickerUrl: e.target.value })} className={input}
              placeholder="Paste the exact product link" />
          </div>
          <div>
            <label className={label}>Retail price (new)</label>
            <div className="flex gap-2">
              <input type="number" min="0" step="0.01" value={part.retailPrice ?? ''} disabled={!editable}
                onChange={e => onChange({
                  retailPrice: parseFloat(e.target.value) || undefined,
                  // A price with no date looks current forever, so the date is
                  // stamped WITH it rather than left to be filled in.
                  retailCheckedAt: todayISO(),
                })} className={input} placeholder="0.00" />
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
              <p className={`text-[11px] mt-1 ${stale != null && stale > RETAIL_STALE_DAYS ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                {retailAsOfLabel(part)}
                {stale != null && stale > RETAIL_STALE_DAYS && ` — ${stale} days old`}
              </p>
            )}
          </div>
          <div>
            <label className={label}>Retail source</label>
            <input value={part.retailSource || ''} disabled={!editable}
              onChange={e => onChange({ retailSource: e.target.value })} className={input}
              placeholder="e.g. Canada Computers" />
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

/* ---------------- Labour ---------------- */

const LabourPanel: React.FC<{
  build: PcBuild;
  canViewCost: boolean;
  labourRate: number;
  onLog: (hours: number, note: string) => void;
}> = ({ build, canViewCost, labourRate, onLog }) => {
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
                {l.hours}h{canViewCost ? ` · ${money(l.hours * l.rate)}` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      {canViewCost && (
        <p className="text-[11px] text-slate-400 mt-2">
          Costed at ${labourRate.toFixed(2)}/hr, snapshotted when logged — changing the rate later never reprices past entries.
        </p>
      )}
    </div>
  );
};

/* ---------------- Display card preview ---------------- */

const CardPreview: React.FC<{
  card: ReturnType<typeof displayCard>;
  build: PcBuild;
  devicePrice?: number;
  warrantyDays: number;
  store: { storeName: string };
  onClose: () => void;
}> = ({ build, devicePrice, warrantyDays, store, onClose }) => {
  const [half, setHalf] = useState(false);
  const [showComparison, setShowComparison] = useState(true);
  const [showConditions, setShowConditions] = useState(true);
  useEscapeKey(onClose);

  const card = displayCard({
    build, price: devicePrice, warrantyDays,
    shopName: store.storeName, shopPhone: (store as { phone?: string }).phone || '',
    showComparison, showConditions,
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
              {card.comparison && (
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
          {card.warrantyBadge && (
            <p className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 mt-3">{card.warrantyBadge}</p>
          )}
        </div>

        <div className="space-y-1.5 text-sm">
          {([
            ['Half page (two per sheet)', half, setHalf],
            ['Show the retail comparison', showComparison, setShowComparison],
            ['Show condition badges', showConditions, setShowConditions],
          ] as [string, boolean, (v: boolean) => void][]).map(([text, value, set]) => (
            <label key={text} className="flex items-center gap-2 text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={value} onChange={e => set(e.target.checked)} className="rounded" /> {text}
            </label>
          ))}
          {!card.comparison && showComparison && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              No comparison shown: every part needs a retail price, or the total would understate the machine.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Close</button>
          <button onClick={() => printDisplayCard(card, { half })}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium">
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>
    </div>
  );
};
