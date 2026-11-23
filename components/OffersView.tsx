import React, { useMemo, useState } from 'react';
import {
  Handshake, Plus, Trash2, X, Download, Printer, DollarSign, ListPlus, AlertTriangle, CheckCircle2, Lock, Unlock,
} from 'lucide-react';
import { InventoryItem, Offer } from '../types';
import { newId } from '../domain/ids';
import { todayISO } from '../domain/dates';
import { getDeviceDisplayName } from '../domain/inventory';
import {
  LIVE_STATES, OFFER_LINE_STATE_LABEL, OFFER_PROGRESS_LABEL, OfferLineState, addLines,
  OFFER_ACCESSORY_NOTE, commitmentExcept, commitmentWarning, committedCounts, newOffer, splitOfferable,
  offerAnnotations, offerCounts, offerItemsIn, offerLineViews, offerProgress, offerTotals,
  ownerSheetRows, patchLine, removeLine, sheetIsStale,
} from '../domain/offers';
import {
  OFFER_SHEET_EXCLUDED_NOTE, offerSheetCsv, offerSheetFileNameFor, offerSheetRows,
} from '../domain/offerSheet';
import { printOfferOwnerCopy, printOfferSheet } from '../services/offerPrint';
import { getStoreProfile } from './SettingsModal';
import {
  MAX_BATCH_PASTE, batchIds, batchPasteTooLargeMessage, describeBatch, parseIdentifierList, resolveBatch,
} from '../domain/batchSelection';
import { MAX_SELL_BATCH, SELL_BLOCK_NOTE, planSellBatch, sellBatchTooLargeMessage } from '../domain/sellBatch';
import { ResponsiveDialog, EmptyState } from './responsive';
import { NumberCell } from './NumberCell';

/**
 * WHOLESALE OFFERS — a saved batch you quote a buyer, then sell part of.
 *
 * ITS OWN SECTION, NOT A TAB INSIDE INVENTORY. An offer is a record with a
 * lifecycle — raised, sent, part-answered, closed — not a view of stock. It
 * outlives the screen it was built on, which is the entire difference between
 * this and the transient selection PR #238 shipped.
 *
 * TWO VIEWS OF THE SAME OFFER, AND THE DIFFERENCE IS THE POINT:
 *
 *   • The OWNER'S view, below, shows cost, the target sale price and the
 *     margin, per device and for the batch — gated on `canViewCost` like every
 *     other cost figure in the app.
 *   • The EXPORTED SHEET shows none of it. It is `offerSheetCsv`, built from
 *     its own allow-list of InventoryItem keys, which cannot reach a cost
 *     field at all.
 *
 * They share no code path. `offerTotals` computes numbers for this screen;
 * `offerSheetCsv` builds the file. Nothing in this component hands the sheet a
 * cost, because there is no argument through which it could.
 *
 * BUILDING THE DEVICE LIST REUSES domain/batchSelection.ts — the same paste
 * and scan matcher Inventory uses, reporting what did not match before
 * anything is added. Not a second selection mechanism.
 *
 * SELLING ROUTES THROUGH THE EXISTING SALE PATH. This component never writes a
 * sale: `onSellLines` hands ids to Quick Sale (domain/sellBatch.ts plans them,
 * hooks/useCheckout.ts seeds the cart, the ordinary checkout writes the
 * salesTransaction). Anything that bypassed `salesTransactions` would be money
 * that never reached the P&L, the drawer or the dashboard.
 */

interface Props {
  offers: Offer[];
  inventory: InventoryItem[];
  canViewCost: boolean;
  currentUserId?: string;
  onSave: (offer: Offer) => void;
  onDelete?: (id: string) => void;
  /**
   * WRITE ONE FIELD OF AN INVENTORY RECORD. The same handler the Inventory
   * grid uses (App's `handleUpdateItem`), deliberately — not a second way to
   * write an item. It carries the permission check, the audit entry and the
   * below-floor target warning with it, so a target set from here behaves
   * exactly as one set in the grid.
   *
   * Optional, and absent without `inventory.edit`: the Target cell is then
   * read-only, as it was before.
   */
  onUpdateItem?: (id: string, field: keyof InventoryItem, value: unknown) => void | Promise<void>;
  /** Send these devices to Quick Sale. The offer records only that it did. */
  onSellLines: (offerId: string, itemIds: string[]) => void;
}

const money = (n: number) => `$${n.toFixed(2)}`;

const STATE_STYLE: Record<OfferLineState, string> = {
  pending: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  'at-till': 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300',
  sold: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
  declined: 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 line-through',
  'sold-elsewhere': 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300',
  gone: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
};

export const OffersView: React.FC<Props> = ({
  offers, inventory, canViewCost, currentUserId, onSave, onDelete, onSellLines, onUpdateItem,
}) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const [newBuyer, setNewBuyer] = useState('');
  const [creating, setCreating] = useState(false);
  // Adding devices by pasted/scanned identifier.
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteResolved, setPasteResolved] = useState<ReturnType<typeof resolveBatch> | null>(null);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  // Which lines the owner has ticked to send to the till.
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [sellNote, setSellNote] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...offers].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    [offers],
  );
  const offer = sorted.find(o => o.id === openId) || null;
  /**
   * WHAT IS ALREADY OUT ON SOMEBODY ELSE'S QUOTE.
   *
   * Quick Sale catches the double-sell at the moment money changes hands,
   * which is where the damage is. This catches it one step earlier, while the
   * offer is being BUILT: quoting two buyers the same phone is legitimate and
   * normal, so this does not block it — but doing it without realising is how
   * the owner promises one device to two people and finds out when both say
   * yes. `commitmentExcept` discounts this offer's own lines, so an offer
   * never reports itself.
   */
  const commitments = useMemo(() => committedCounts(offers, inventory), [offers, inventory]);
  const elsewhere = (itemId: string) => commitmentExcept(commitments, itemId, offer?.id);
  const views = useMemo(() => offer ? offerLineViews(offer, inventory) : [], [offer, inventory]);

  const save = (next: Offer) => onSave(next);

  const createOffer = () => {
    const o = newOffer(newId(), newBuyer, todayISO(), Date.now(), currentUserId);
    save(o);
    setOpenId(o.id);
    setNewBuyer('');
    setCreating(false);
    setTicked(new Set());
  };

  /* ---------------- Adding devices ---------------- */

  const resolvePaste = () => {
    const count = parseIdentifierList(pasteText).length;
    if (count > MAX_BATCH_PASTE) { setPasteResolved(null); setPasteNote(batchPasteTooLargeMessage(count)); return; }
    setPasteNote(null);
    setPasteResolved(resolveBatch(inventory, pasteText));
  };

  /** The matched devices, minus the accessories — see `splitOfferable`. */
  const pasteSplit = pasteResolved
    ? splitOfferable(pasteResolved.matched.map(m => m.item))
    : { offerable: [], notOfferable: [] };

  const applyPaste = () => {
    if (!offer || !pasteResolved) return;
    save(addLines(offer, pasteSplit.offerable.map(i => i.id), Date.now()));
    setPasteResolved(null);
    setPasteText('');
    setPasteOpen(false);
  };

  /* ---------------- The sheet ---------------- */

  /**
   * EXPORT THE BUYER-SAFE SHEET, and stamp when it went.
   *
   * The items come from the offer's LIVE lines — everything still quoted or
   * already sold — and the grades and notes from the offer. `offerSheetCsv`
   * does the rest; this function has no access to a cost figure to leak even
   * if it wanted one.
   */
  const exportSheet = () => {
    if (!offer) return;
    const items = offerItemsIn(offer, inventory, LIVE_STATES);
    const csv = offerSheetCsv(items, offerAnnotations(offer));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = offerSheetFileNameFor(offer.buyerName, todayISO());
    a.click();
    // `sentAt` is what makes "the buyer is holding a stale sheet" answerable.
    save({ ...offer, sentAt: Date.now() });
  };

  /**
   * PRINT THE SAME THING ON PAPER, with no pricing on it at all.
   *
   * Same rows, same annotations, same allow-list — `offerSheetRows` is what
   * the CSV is built from too, so the two cannot drift. The printer is handed
   * those STRINGS and no InventoryItem, which is what makes "the printout
   * cannot reach a cost" a fact about the code rather than a promise: there is
   * nothing in services/offerPrint.ts to reach one with.
   *
   * Printing does NOT stamp `sentAt`. That field answers "is the buyer holding
   * a stale FILE?" — a CSV they have on their computer and will open again. A
   * sheet handed across the counter is not something the owner re-sends when a
   * device is added; they print another one. Conflating the two would put the
   * stale-sheet banner up after every print.
   */
  const printMeta = () => ({
    storeName: getStoreProfile().storeName,
    buyerName: offer!.buyerName,
    dateLabel: todayISO(),
  });

  const printSheet = () => {
    if (!offer) return;
    const items = offerItemsIn(offer, inventory, LIVE_STATES);
    printOfferSheet(offerSheetRows(items, offerAnnotations(offer)), {
      ...printMeta(),
      excludedNote: OFFER_SHEET_EXCLUDED_NOTE,
    });
  };

  /**
   * THE OWNER'S OWN COPY — the same lot with the money on it, for reading on
   * a phone while standing in front of the buyer.
   *
   * A DIFFERENT BUILDER, not a flag on the one above: `ownerSheetRows` returns
   * a row type that carries cost, target, margin and the internal note, and
   * `offerOwnerPrintHtml` is the only function that accepts it. The buyer's
   * renderer takes a row type with no money field on it, so there is nothing
   * to toggle and no default to get wrong.
   *
   * Gated on `canViewCost`, like every other cost figure.
   */
  const printOwnerCopy = () => {
    if (!offer || !canViewCost) return;
    const items = offerItemsIn(offer, inventory, LIVE_STATES);
    printOfferOwnerCopy(ownerSheetRows(items, offerAnnotations(offer)), {
      ...printMeta(),
      totals: offerTotals(items),
    });
  };

  /* ---------------- Selling part of it ---------------- */

  /**
   * SEND THE TICKED DEVICES TO QUICK SALE.
   *
   * `planSellBatch` is asked first, exactly as Inventory's bulk action asks
   * it, so a device that has since sold or been deleted is reported here
   * rather than arriving at the till as a surprise. The offer then records
   * only that these lines went to the checkout — a timestamp, not a sale.
   */
  const sellTicked = () => {
    if (!offer) return;
    const items = views.filter(v => ticked.has(v.line.itemId) && !!v.item).map(v => v.item!);
    const plan = planSellBatch(items);
    if (plan.sellable.length === 0) {
      setSellNote('Nothing in that selection can be sent to the till.');
      return;
    }
    if (plan.sellable.length > MAX_SELL_BATCH) {
      setSellNote(sellBatchTooLargeMessage(plan.sellable.length));
      return;
    }
    setSellNote(plan.blocked.length
      ? `${plan.blocked.length} not sent: ${plan.blocked.map(b => `${b.item.sku || b.item.item} (${SELL_BLOCK_NOTE[b.reason]})`).join('; ')}`
      : null);
    // App marks the lines and navigates; the sale itself is the ordinary one.
    onSellLines(offer.id, plan.sellable.map(i => i.id));
    setTicked(new Set());
  };

  const tickable = views.filter(v => v.state === 'pending' || v.state === 'at-till');

  /* ======================================================================= *
   * THE LIST
   * ======================================================================= */

  if (!offer) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Handshake className="w-5 h-5 text-indigo-500" /> Wholesale Offers
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              A saved batch quoted to a buyer. Devices stay in ordinary stock the whole time — an
              offer holds nothing back and reserves nothing.
            </p>
          </div>
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-3 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium shrink-0">
            <Plus className="w-4 h-4" /> New offer
          </button>
        </div>

        {creating && (
          <div className="flex flex-wrap items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
            <input autoFocus value={newBuyer} onChange={e => setNewBuyer(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newBuyer.trim()) createOffer(); }}
              placeholder="Buyer's name" aria-label="Buyer's name"
              className="flex-1 min-w-[200px] px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm" />
            <button onClick={createOffer} disabled={!newBuyer.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium">Create</button>
            <button onClick={() => { setCreating(false); setNewBuyer(''); }}
              className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
          </div>
        )}

        {sorted.length === 0
          ? <EmptyState icon={<Handshake className="w-6 h-6" />} title="No offers yet"
              hint="Raise one, paste in the SKUs you are quoting, and send the buyer a sheet." />
          : (
            <div className="flex flex-col gap-2">
              {sorted.map(o => {
                const c = offerCounts(o, inventory);
                const p = offerProgress(o, inventory);
                return (
                  <button key={o.id} onClick={() => { setOpenId(o.id); setTicked(new Set()); setSellNote(null); }}
                    className="text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 hover:border-indigo-400">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-900 dark:text-slate-100">{o.buyerName || 'Unnamed buyer'}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {OFFER_PROGRESS_LABEL[p]}
                      </span>
                      <span className="text-xs text-slate-400">{o.date}</span>
                      {sheetIsStale(o) && (
                        <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                          changed since the sheet was sent
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      {c.total} device{c.total === 1 ? '' : 's'}
                      {c.pending > 0 && ` · ${c.pending} quoted`}
                      {c.sold > 0 && ` · ${c.sold} sold to them`}
                      {c.declined > 0 && ` · ${c.declined} declined`}
                      {c.soldElsewhere > 0 && ` · ${c.soldElsewhere} sold in-store`}
                      {c.gone > 0 && ` · ${c.gone} no longer in inventory`}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
      </div>
    );
  }

  /* ======================================================================= *
   * ONE OFFER
   * ======================================================================= */

  const counts = offerCounts(offer, inventory);
  const progress = offerProgress(offer, inventory);
  const liveTotals = offerTotals(offerItemsIn(offer, inventory, LIVE_STATES));
  const soldTotals = offerTotals(offerItemsIn(offer, inventory, ['sold']));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <button onClick={() => setOpenId(null)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline">← All offers</button>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 mt-1">
            <Handshake className="w-5 h-5 text-indigo-500" /> {offer.buyerName || 'Unnamed buyer'}
            <span className="text-[11px] font-normal px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {OFFER_PROGRESS_LABEL[progress]}
            </span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Raised {offer.date}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => { setPasteOpen(true); setPasteResolved(null); setPasteNote(null); }}
            className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400">
            <ListPlus className="w-4 h-4" /> Add devices
          </button>
          <button onClick={exportSheet} disabled={counts.total === 0}
            title={OFFER_SHEET_EXCLUDED_NOTE}
            className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400 disabled:opacity-40">
            <Download className="w-4 h-4" /> Export sheet
          </button>
          {/* TWO NAMED ACTIONS, NOT A CHECKBOX. One of these sheets must never
              reach the buyer, and a remembered toggle is how it eventually
              does: the owner prints one, prints another an hour later, and the
              setting is whatever they last left it on. Each button says whose
              copy it is and what is on it, every time. */}
          <button onClick={printSheet} disabled={counts.total === 0}
            title={`Print the sheet to hand the buyer. ${OFFER_SHEET_EXCLUDED_NOTE} No pricing of any kind.`}
            className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400 disabled:opacity-40">
            <Printer className="w-4 h-4" /> Buyer sheet
          </button>
          {canViewCost && (
            <button onClick={printOwnerCopy} disabled={counts.total === 0}
              title="Print YOUR copy — it shows cost, target, margin and your internal notes. Do not hand this one over."
              className="flex items-center gap-2 px-3 py-2.5 bg-slate-900 dark:bg-slate-700 border border-slate-900 dark:border-slate-600 rounded-lg text-sm text-white hover:bg-slate-800 disabled:opacity-40">
              <Printer className="w-4 h-4" /> Owner copy
            </button>
          )}
          <button onClick={() => save({ ...offer, status: offer.status === 'open' ? 'closed' : 'open', updatedAt: Date.now() })}
            title={offer.status === 'open'
              ? 'Finished with this offer. Its devices stop being counted as out on a quote.'
              : 'Reopen it — its quoted devices count as committed again.'}
            className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200 hover:border-indigo-400">
            {offer.status === 'open' ? <><Lock className="w-4 h-4" /> Close</> : <><Unlock className="w-4 h-4" /> Reopen</>}
          </button>
          {onDelete && (
            <button onClick={() => { if (window.confirm('Delete this offer? It is the record of what was quoted to this buyer.')) { onDelete(offer.id); setOpenId(null); } }}
              className="flex items-center gap-2 px-3 py-2.5 bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-300 rounded-lg text-sm hover:bg-rose-100">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {sheetIsStale(offer) && (
        <p className="flex items-start gap-2 text-sm rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          {/* The file in their inbox is a snapshot and does not update itself. */}
          This offer has changed since the sheet was sent. The buyer is holding an out-of-date file — export it again.
        </p>
      )}

      {/* Buyer details and the internal note, which is never exported. */}
      <div className="grid gap-2 sm:grid-cols-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
        <label className="text-xs text-slate-500 dark:text-slate-400">
          Buyer
          <input value={offer.buyerName} onChange={e => save({ ...offer, buyerName: e.target.value, updatedAt: Date.now() })}
            className="mt-1 w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100" />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400">
          Contact
          <input value={offer.buyerContact || ''} onChange={e => save({ ...offer, buyerContact: e.target.value, updatedAt: Date.now() })}
            placeholder="Phone, email, wherever you reach them"
            className="mt-1 w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100" />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400">
          Your own note <span className="text-slate-400">(never exported)</span>
          <input value={offer.notes || ''} onChange={e => save({ ...offer, notes: e.target.value, updatedAt: Date.now() })}
            className="mt-1 w-full px-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100" />
        </label>
      </div>

      {/* THE OWNER'S FIGURES. Screen only — see the header comment. Gated on
          canViewCost like every other cost figure in the app. */}
      {canViewCost && counts.total > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">The lot as it stands ({liveTotals.count})</p>
            <dl className="mt-1 text-sm text-slate-700 dark:text-slate-200 space-y-0.5">
              <div className="flex justify-between"><dt>Our cost</dt><dd className="font-medium">{money(liveTotals.cost)}</dd></div>
              <div className="flex justify-between"><dt>At target prices</dt><dd className="font-medium">{money(liveTotals.target)}</dd></div>
              <div className="flex justify-between"><dt>Margin at target</dt><dd className="font-medium">{money(liveTotals.margin)}</dd></div>
            </dl>
            {liveTotals.targetsSet < liveTotals.count && (
              <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                {liveTotals.count - liveTotals.targetsSet} of these have no target price set, so the target and margin are understated.
              </p>
            )}
            <p className="text-[11px] text-slate-400 mt-1">
              A wholesale lot goes for one agreed figure. Reach it with the line prices in Quick Sale — nothing is priced for you.
            </p>
          </div>
          {soldTotals.count > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Sold to this buyer ({soldTotals.count})</p>
              <dl className="mt-1 text-sm text-slate-700 dark:text-slate-200 space-y-0.5">
                <div className="flex justify-between"><dt>Our cost</dt><dd className="font-medium">{money(soldTotals.cost)}</dd></div>
              </dl>
              {/* What they ACTUALLY paid is on the sale, not here: the offer
                  records no money, and the transaction is the only place the
                  real figure lives. */}
              <p className="text-[11px] text-slate-400 mt-1">
                What they paid is on the sale itself — this record holds no money, by design.
              </p>
            </div>
          )}
        </div>
      )}

      {sellNote && (
        <p className="flex items-start gap-2 text-sm rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {sellNote}
          <button onClick={() => setSellNote(null)} className="ml-auto opacity-70 hover:opacity-100 shrink-0"><X className="w-3.5 h-3.5" /></button>
        </p>
      )}

      {/* MARKING WHAT SOLD. The tick is a selection, not an assertion: the
          button hands these to Quick Sale and the ordinary checkout records
          the money. Nothing here writes a sale. */}
      {tickable.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg px-3 py-2">
          <span className="text-sm text-indigo-700 dark:text-indigo-300">
            {ticked.size > 0 ? `${ticked.size} ticked` : 'Tick what the buyer took'}
          </span>
          <button onClick={sellTicked} disabled={ticked.size === 0}
            className="text-sm px-2 py-1 rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5" /> Sell these in Quick Sale
          </button>
          <button onClick={() => {
            let next = offer;
            ticked.forEach(id => { next = patchLine(next, id, { outcome: 'declined' }, Date.now()); });
            save(next);
            setTicked(new Set());
          }} disabled={ticked.size === 0}
            title="The buyer passed on these. They are ordinary stock — they always were — and can be offered again."
            className="text-sm px-2 py-1 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-400 disabled:opacity-40">
            Buyer declined these
          </button>
          <button onClick={() => setTicked(new Set(tickable.map(v => v.line.itemId)))}
            className="text-sm px-2 py-1 rounded-md text-slate-500 hover:text-slate-700">Tick all</button>
          {ticked.size > 0 && (
            <button onClick={() => setTicked(new Set())} className="text-sm px-2 py-1 rounded-md text-slate-500 hover:text-slate-700">Clear</button>
          )}
        </div>
      )}

      {/* THE LINES */}
      {views.length === 0
        ? <EmptyState icon={<ListPlus className="w-6 h-6" />} title="No devices on this offer yet"
            hint="Add devices by pasting or scanning their SKUs, IMEIs or serials." />
        : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold text-left">
                  <th className="px-2 py-2 w-8" />
                  <th className="px-2 py-2">Device</th>
                  <th className="px-2 py-2">State</th>
                  <th className="px-2 py-2 w-20">Grade</th>
                  <th className="px-2 py-2">Note to the buyer</th>
                  {canViewCost && <th className="px-2 py-2 text-right">Cost</th>}
                  {/* TARGET IS NOT COST-GATED, unlike the two beside it.
                      It is the asking price, not what the shop paid, and the
                      Inventory grid has never gated its Target column either
                      — anyone with inventory.edit prices stock there. Gating
                      it here would make the offer screen stricter than the
                      grid for the same field, for no reason. Cost and Margin
                      stay gated, and the below-floor warning stays
                      owner-facing, so nothing about a cost is recoverable
                      from this column. */}
                  <th className="px-2 py-2 text-right">Target</th>
                  {canViewCost && <th className="px-2 py-2 text-right">Margin</th>}
                  <th className="px-2 py-2 w-8" />
                </tr>
              </thead>
              <tbody>
                {views.map(v => {
                  const cost = (v.item?.purchaseCost || 0) + (v.item?.repairCost || 0);
                  const target = v.item?.targetSalePrice || 0;
                  const canTick = v.state === 'pending' || v.state === 'at-till';
                  return (
                    <tr key={v.line.itemId} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-2 py-1.5">
                        {canTick && (
                          <input type="checkbox" aria-label={`Select ${v.item?.sku || v.line.itemId}`}
                            checked={ticked.has(v.line.itemId)}
                            onChange={() => setTicked(s => {
                              const n = new Set(s);
                              n.has(v.line.itemId) ? n.delete(v.line.itemId) : n.add(v.line.itemId);
                              return n;
                            })} className="rounded" />
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-slate-800 dark:text-slate-100">
                        <span className="font-mono text-xs text-slate-500 dark:text-slate-400">{v.item?.sku || v.line.itemId}</span>
                        <span className="block">{v.item ? getDeviceDisplayName(v.item) : 'Deleted from inventory'}</span>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${STATE_STYLE[v.state]}`}>
                          {OFFER_LINE_STATE_LABEL[v.state]}
                        </span>
                        {elsewhere(v.line.itemId) && (
                          <span className="block text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">
                            also {commitmentWarning(elsewhere(v.line.itemId)!)}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={v.line.grade || ''} aria-label={`Grade for ${v.item?.sku || v.line.itemId}`}
                          onChange={e => save(patchLine(offer, v.line.itemId, { grade: e.target.value }, Date.now()))}
                          placeholder="A/B/C"
                          className="w-16 px-1.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm" />
                      </td>
                      <td className="px-2 py-1.5">
                        <input value={v.line.note || ''} aria-label={`Note for ${v.item?.sku || v.line.itemId}`}
                          onChange={e => save(patchLine(offer, v.line.itemId, { note: e.target.value }, Date.now()))}
                          placeholder="What the buyer should know"
                          className="w-full min-w-[160px] px-1.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm" />
                      </td>
                      {/* COST STAYS READ-ONLY. It is what the shop paid, not a
                          figure to revise while quoting — if it is wrong it is
                          wrong on the purchase, and that belongs in Inventory
                          where the audit trail for it lives. MARGIN is
                          derived. */}
                      {canViewCost && <td className="px-2 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{money(cost)}</td>}
                      <td className="px-2 py-1.5 text-right">
                        {onUpdateItem && v.item
                          ? (
                            // Writes the DEVICE's own targetSalePrice — the same
                            // field Inventory edits, not a per-offer copy that
                            // would immediately disagree with the grid.
                            <NumberCell value={target} placeholder="—"
                              ariaLabel={`Target for ${v.item.sku || v.line.itemId}`}
                              onCommit={n => { void onUpdateItem(v.item!.id, 'targetSalePrice', n); }}
                              className="w-20 px-1.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm text-right tabular-nums dark:[color-scheme:dark]" />
                          )
                          : <span className="tabular-nums text-slate-600 dark:text-slate-300">{target ? money(target) : '—'}</span>}
                      </td>
                      {canViewCost && <td className="px-2 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{target ? money(target - cost) : '—'}</td>}
                      <td className="px-2 py-1.5">
                        <button onClick={() => save(removeLine(offer, v.line.itemId, Date.now()))}
                          aria-label={`Remove ${v.item?.sku || v.line.itemId}`}
                          className="text-slate-400 hover:text-rose-500"><X className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {counts.declined > 0 && (
        <p className="flex items-start gap-2 text-xs text-slate-500 dark:text-slate-400">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {/* The honest wording: they never left. */}
          The {counts.declined} declined device{counts.declined === 1 ? '' : 's'} need nothing doing — an offer holds no
          stock back, so they have been ordinary sellable stock the whole time and can go on another offer right away.
        </p>
      )}

      {/* ADD DEVICES — the same paste-and-scan matcher Inventory uses. */}
      <ResponsiveDialog open={pasteOpen} onClose={() => setPasteOpen(false)} title="Add devices to this offer"
        footer={
          <div className="flex items-center gap-2">
            <button onClick={() => setPasteOpen(false)} className="px-3 py-2 text-sm text-slate-500 hover:text-slate-700">Cancel</button>
            {pasteResolved
              ? (
                <button onClick={applyPaste} disabled={pasteSplit.offerable.length === 0}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium">
                  Add {pasteSplit.offerable.length} to the offer
                </button>
              )
              : (
                <button onClick={resolvePaste} disabled={!pasteText.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium">
                  Find these
                </button>
              )}
          </div>
        }>
        <div className="space-y-3">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Paste SKUs, IMEIs or serials — one per line, or separated by commas or spaces. The
            shop's <span className="font-mono">FTT-</span> prefix is optional. Nothing is added until you have read what it found.
          </p>
          <textarea value={pasteText} onChange={e => { setPasteText(e.target.value); setPasteResolved(null); }}
            rows={7} aria-label="Identifiers to add"
            placeholder={'FTT-000101\n000102\n35 678901 234000 2'}
            className="w-full p-2.5 font-mono text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg" />
          {pasteNote && (
            <p className="text-sm rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
              {pasteNote}
            </p>
          )}
          {pasteResolved && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{describeBatch(pasteResolved)}</p>
              {pasteResolved.unmatched.length > 0 && (
                <div className="text-sm rounded-lg px-3 py-2 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
                  <p className="font-medium">Not in inventory — nothing will be added for these:</p>
                  <p className="font-mono text-xs mt-1 break-all">{pasteResolved.unmatched.join(', ')}</p>
                </div>
              )}
              {pasteResolved.ambiguous.length > 0 && (
                <div className="text-sm rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                  <p className="font-medium">Matches more than one item — skipped rather than guessed at:</p>
                  <p className="font-mono text-xs mt-1 break-all">
                    {pasteResolved.ambiguous.map(a => `${a.identifier} (${a.items.length})`).join(', ')}
                  </p>
                </div>
              )}
              {/* DEVICES ONLY. Named, not silently dropped — a cable that
                  vanishes out of a pasted list is a line the owner thinks
                  they quoted. */}
              {pasteSplit.notOfferable.length > 0 && (
                <div className="text-sm rounded-lg px-3 py-2 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300">
                  <p className="font-medium">Not added — {OFFER_ACCESSORY_NOTE}:</p>
                  <p className="font-mono text-xs mt-1 break-all">
                    {pasteSplit.notOfferable.map(i => i.sku || i.item).join(', ')}
                  </p>
                </div>
              )}
              {/* Already quoted to somebody else. Not a block: that is a
                  normal thing to do on purpose, and the only mistake is doing
                  it without realising. */}
              {pasteSplit.offerable.some(i => !!elsewhere(i.id)) && (
                <div className="text-sm rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300">
                  <p className="font-medium">Already on another open offer — they will be added anyway:</p>
                  <ul className="mt-1 space-y-0.5">
                    {pasteSplit.offerable.filter(i => !!elsewhere(i.id)).map(i => (
                      <li key={i.id} className="text-xs">
                        <span className="font-mono">{i.sku || i.item}</span>
                        {' — '}{commitmentWarning(elsewhere(i.id)!)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </ResponsiveDialog>
    </div>
  );
};
