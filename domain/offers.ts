import { InventoryItem, Offer, OfferLine } from '../types';
import { locationOf } from './identifierSearch';
import { targetTotalOf } from './sellBatch';

/**
 * WHOLESALE OFFERS: a saved batch you quote a buyer, then sell part of.
 *
 * WHAT WAS MISSING. PR #238 built the pieces — paste a list into a selection,
 * export a buyer-safe sheet, send a selection to Quick Sale — but the batch
 * was a transient SELECTION that vanished the moment the screen changed. So
 * there was no record of what had been offered to whom: the owner could not
 * look at an offer again after sending it, nothing said a device was already
 * out on a quote (so the same phone could be sold over the counter while a
 * buyer was deciding on it), and the grade and the note written for the buyer
 * lived only in a spreadsheet on somebody's desktop.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE ONE RULE THIS MODULE IS BUILT AROUND: AN OFFER RECORDS NO MONEY.
 *
 * It stores no price, no agreed figure, no revenue and no sold flag. Not one.
 * A sale is a `salesTransaction` with money in it, written by the ordinary
 * checkout (hooks/useCheckout.ts), and anything that writes revenue outside it
 * is money that never reaches the P&L, the drawer, the dashboard, the daily
 * close or payroll. An offer feature that did that would be worse than no
 * offer feature at all.
 *
 * So "did the buyer take this one?" is DERIVED, every time, from two things
 * the offer does not own:
 *   • the device's own `soldDate` / `deviceStatus`, written by the real sale;
 *   • `OfferLine.sentToSaleAt`, which records that the owner pushed this line
 *     to the till FROM THIS OFFER. That is an action, not a sale — and it is
 *     the only thing that tells "the buyer bought it" apart from "it sold
 *     in-store to somebody else while the offer was out".
 *
 * WHAT THE DEVICES THE BUYER DECLINED "RETURN TO" IS: nothing, because they
 * never left. An offer changes no `deviceStatus` and holds nothing back, so
 * declining a line is simply recording that the buyer passed; the device has
 * been ordinary sellable stock the whole time and can be re-offered
 * immediately. That is a property of the design, not a step somebody has to
 * remember to perform.
 *
 * ON NOT CHANGING `deviceStatus`: `reserved` already means a layaway deposit
 * has been taken — somebody has handed over money — which is a far stronger
 * commitment than a quote a buyer has not answered. Overloading it would make
 * both meanings mushy and would quietly change what the Reserved filter, the
 * transfer override and the layaway screens are talking about. An open offer
 * therefore changes NOTHING about the device; the commitment is surfaced
 * instead, as a COUNT (see `committedCounts`), because quoting two buyers the
 * same phone is normal and a flag cannot say "two".
 *
 * Pure: no DOM, no Firestore, no id generation.
 */

/* ======================================================================== *
 * ONE LINE'S STATE
 * ======================================================================== */

export type OfferLineState =
  /** Quoted, no answer yet. This is what "committed" is made of. */
  | 'pending'
  /** Pushed to the till from this offer, not rung through yet. Still committed. */
  | 'at-till'
  /** The buyer took it: pushed from this offer, and the device is now sold. */
  | 'sold'
  /** The buyer passed. The device is ordinary stock and always was. */
  | 'declined'
  /**
   * Sold, but NOT through this offer — somebody sold it over the counter while
   * the quote was out. The whole reason the feature exists, so it gets its own
   * state rather than being quietly counted as the buyer's purchase.
   */
  | 'sold-elsewhere'
  /** The device has since been deleted from inventory. */
  | 'gone';

export const OFFER_LINE_STATE_LABEL: Record<OfferLineState, string> = {
  pending: 'Quoted',
  'at-till': 'At the till',
  sold: 'Sold to this buyer',
  declined: 'Declined',
  'sold-elsewhere': 'Sold in-store, not to this buyer',
  gone: 'No longer in inventory',
};

/**
 * ORDER MATTERS HERE, and it is not arbitrary:
 *
 *   gone first — nothing else can be said about a record that is not there.
 *   declined next — the buyer's answer is a fact about the OFFER, and it stays
 *     true whatever later happens to the device. A declined phone that sells
 *     over the counter next week is still a line this buyer passed on.
 *   then sold vs sold-elsewhere, split on `sentToSaleAt`.
 */
export const offerLineState = (line: OfferLine, item: InventoryItem | undefined): OfferLineState => {
  if (!item) return 'gone';
  if (line.outcome === 'declined') return 'declined';
  const isSold = locationOf(item) === 'sold';
  if (isSold) return line.sentToSaleAt ? 'sold' : 'sold-elsewhere';
  return line.sentToSaleAt ? 'at-till' : 'pending';
};

/** The states that mean this device is still spoken for by this offer. */
const COMMITTING: OfferLineState[] = ['pending', 'at-till'];

export interface OfferLineView {
  line: OfferLine;
  item?: InventoryItem;
  state: OfferLineState;
}

/** Every line of one offer, resolved against live inventory. */
export const offerLineViews = (offer: Offer, inventory: InventoryItem[]): OfferLineView[] => {
  const byId = new Map(inventory.map(i => [i.id, i]));
  return offer.lines.map(line => {
    const item = byId.get(line.itemId);
    return { line, item, state: offerLineState(line, item) };
  });
};

/* ======================================================================== *
 * THE OFFER'S OWN PROGRESS
 * ======================================================================== */

export type OfferProgress =
  /** Explicitly finished with by the owner, whatever happened in it. */
  | 'closed'
  /** Saved, nothing in it yet. */
  | 'empty'
  /** Out with the buyer, nothing resolved. */
  | 'open'
  /** Some of it sold, some still waiting on an answer. */
  | 'part-sold'
  /** Everything the buyer did not decline has sold. */
  | 'sold'
  /** The buyer passed on all of it. */
  | 'declined';

export const OFFER_PROGRESS_LABEL: Record<OfferProgress, string> = {
  closed: 'Closed',
  empty: 'Empty',
  open: 'Open',
  'part-sold': 'Part sold',
  sold: 'Sold',
  declined: 'Declined',
};

/**
 * THE OFFER'S STATUS, and what a part-sale leaves it as.
 *
 * `status` is the one thing the owner sets directly, and it has exactly two
 * values: open, or closed because they are done with it. EVERYTHING ELSE IS
 * DERIVED, so an offer's badge can never disagree with its lines — which is
 * the failure mode of a stored status that somebody forgot to update after a
 * sale.
 *
 * A part-sale therefore leaves the offer OPEN and showing 'part-sold': some
 * devices went, the rest are still quoted and still committed, and the owner
 * closes it when the conversation is over. It does not auto-close, because an
 * offer where the buyer took six of ten and is still thinking about the other
 * four is the normal case, not a finished one.
 *
 * It DOES report 'sold' or 'declined' once nothing is pending, which is the
 * cue to close it — but the closing is a decision, not a side effect.
 */
export const offerProgress = (offer: Offer, inventory: InventoryItem[]): OfferProgress => {
  if (offer.status === 'closed') return 'closed';
  const views = offerLineViews(offer, inventory);
  if (views.length === 0) return 'empty';
  const states = views.map(v => v.state);
  const pending = states.filter(s => COMMITTING.includes(s)).length;
  const sold = states.filter(s => s === 'sold').length;
  const declined = states.filter(s => s === 'declined').length;
  if (pending > 0) return sold > 0 ? 'part-sold' : 'open';
  if (sold > 0) return 'sold';
  if (declined === states.length) return 'declined';
  // Nothing pending, nothing sold to this buyer: everything either went
  // elsewhere or is gone. Still the owner's to close.
  return 'open';
};

/** Counts for the offer's own header line. */
export interface OfferCounts {
  total: number;
  pending: number;
  sold: number;
  declined: number;
  soldElsewhere: number;
  gone: number;
}

export const offerCounts = (offer: Offer, inventory: InventoryItem[]): OfferCounts => {
  const states = offerLineViews(offer, inventory).map(v => v.state);
  const n = (s: OfferLineState) => states.filter(x => x === s).length;
  return {
    total: states.length,
    pending: states.filter(s => COMMITTING.includes(s)).length,
    sold: n('sold'),
    declined: n('declined'),
    soldElsewhere: n('sold-elsewhere'),
    gone: n('gone'),
  };
};

/* ======================================================================== *
 * THE DOUBLE-SELL PROBLEM: WHAT IS COMMITTED, AND TO HOW MANY BUYERS
 * ======================================================================== */

export interface Commitment {
  /** How many open offers currently have this device quoted and unanswered. */
  count: number;
  /** Who they are, for the warning that names them. */
  buyers: string[];
  offerIds: string[];
}

/**
 * WHICH DEVICES ARE OUT ON A QUOTE RIGHT NOW — a COUNT, not a flag.
 *
 * Two buyers quoted the same phone is normal and legitimate: that is how you
 * find out which of them actually wants it. So "committed" cannot be a boolean
 * on the device; it is "how many open offers is this on, and whose", which is
 * exactly what somebody about to sell it over the counter needs told.
 *
 * Only OPEN offers count, and within them only lines that are still pending or
 * at the till. A closed offer, a declined line and an already-sold line commit
 * nothing.
 */
export const committedCounts = (offers: Offer[], inventory: InventoryItem[]): Map<string, Commitment> => {
  const out = new Map<string, Commitment>();
  for (const offer of offers) {
    if (offer.status === 'closed') continue;
    for (const v of offerLineViews(offer, inventory)) {
      if (!COMMITTING.includes(v.state)) continue;
      const cur = out.get(v.line.itemId) || { count: 0, buyers: [], offerIds: [] };
      cur.count += 1;
      cur.buyers.push(offer.buyerName || 'an unnamed buyer');
      cur.offerIds.push(offer.id);
      out.set(v.line.itemId, cur);
    }
  }
  return out;
};

/**
 * What to say at the till about a device that is out on a quote.
 *
 * ACKNOWLEDGE, DO NOT BLOCK — the pattern this app already uses for $0 device
 * prices, listed-elsewhere devices and devices with an open repair ticket.
 * Selling something that is out on offer is perfectly legitimate: the buyer
 * has not agreed to anything, and a customer standing at the counter with cash
 * beats a wholesaler who is still thinking about it. Doing it UNKNOWINGLY is
 * the mistake, so the sale is gated on an acknowledgement that names the
 * buyers, and then it goes through.
 */
export const commitmentWarning = (c: Commitment): string =>
  c.count === 1
    ? `out on an open offer to ${c.buyers[0]}`
    : `out on ${c.count} open offers (${c.buyers.join(', ')})`;

/* ======================================================================== *
 * THE OWNER'S FIGURES — SCREEN ONLY, NEVER THE SHEET
 * ======================================================================== */

export interface OfferTotals {
  count: number;
  /** What the shop has in them: purchase + repair. */
  cost: number;
  /** The sum of the target sale prices, where set. */
  target: number;
  /** target − cost. Meaningless where no target is set, hence `targetsSet`. */
  margin: number;
  /** How many of `count` actually have a target price recorded. */
  targetsSet: number;
}

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * THE OWNER'S VIEW OF A BATCH: cost, target and margin.
 *
 * COMPUTED FOR THE SCREEN AND NOWHERE ELSE. It shares no code path with
 * `offerSheetCsv`, which is built from its own allow-list of InventoryItem
 * keys and cannot reach a cost field at all — that separation is the whole
 * point and is asserted by test. These numbers go on the owner's screen,
 * gated on `canViewCost` like every other cost figure in the app, and never
 * into a file that leaves the shop.
 *
 * `target` goes through `targetTotalOf` (domain/sellBatch.ts) rather than
 * re-summing, so "what this lot would fetch at target" has ONE definition.
 * Read the comment above it before touching pricing: it deliberately refuses
 * to spread one agreed figure across the lines, because any allocation rule
 * silently rewrites per-line profit attribution. That decision stands here —
 * an offer gives the owner the total and they reach the agreed number with the
 * cart's existing price and discount fields.
 */
export const offerTotals = (items: InventoryItem[]): OfferTotals => {
  const cost = money(items.reduce((s, i) => s + (i.purchaseCost || 0) + (i.repairCost || 0), 0));
  const target = targetTotalOf(items);
  return {
    count: items.length,
    cost,
    target,
    margin: money(target - cost),
    targetsSet: items.filter(i => (i.targetSalePrice || 0) > 0).length,
  };
};

/** The items behind the lines in the given states — for the totals above. */
export const offerItemsIn = (
  offer: Offer,
  inventory: InventoryItem[],
  states: OfferLineState[],
): InventoryItem[] => offerLineViews(offer, inventory)
  .filter(v => !!v.item && states.includes(v.state))
  .map(v => v.item!);

/** Everything still quoted or already sold — the lot as it stands. */
export const LIVE_STATES: OfferLineState[] = ['pending', 'at-till', 'sold'];

/* ======================================================================== *
 * EDITS
 * ======================================================================== */

/**
 * ADD DEVICES TO AN OFFER, skipping the ones already on it.
 *
 * The caller resolves the identifiers with domain/batchSelection.ts — the same
 * paste-and-scan matcher Inventory uses, not a second selection mechanism —
 * and hands the ids here.
 */
export const addLines = (offer: Offer, itemIds: string[], now: number): Offer => {
  const have = new Set(offer.lines.map(l => l.itemId));
  const added: OfferLine[] = [];
  for (const itemId of itemIds) {
    if (have.has(itemId)) continue;
    have.add(itemId);
    added.push({ itemId, outcome: 'pending' });
  }
  return added.length ? { ...offer, lines: [...offer.lines, ...added], updatedAt: now } : offer;
};

export const removeLine = (offer: Offer, itemId: string, now: number): Offer => ({
  ...offer,
  lines: offer.lines.filter(l => l.itemId !== itemId),
  updatedAt: now,
});

/** Set the grade/note/outcome of one line. */
export const patchLine = (
  offer: Offer,
  itemId: string,
  patch: Partial<Pick<OfferLine, 'grade' | 'note' | 'outcome'>>,
  now: number,
): Offer => ({
  ...offer,
  lines: offer.lines.map(l => l.itemId === itemId ? { ...l, ...patch } : l),
  updatedAt: now,
});

/**
 * RECORD THAT THESE LINES WENT TO THE TILL. Called when the owner sends part
 * of an offer to Quick Sale, BEFORE any sale exists.
 *
 * This is the closest thing in this module to touching a sale, and it still
 * is not one: it writes a timestamp meaning "I pushed this to the checkout",
 * on lines the owner selected. No price, no revenue, no sold flag. If the
 * owner abandons the cart the line reads 'at the till' and can be pushed again
 * or declined; nothing is left inconsistent, because nothing was asserted.
 */
export const markSentToSale = (offer: Offer, itemIds: string[], now: number): Offer => {
  const ids = new Set(itemIds);
  return {
    ...offer,
    lines: offer.lines.map(l => ids.has(l.itemId) ? { ...l, sentToSaleAt: now, outcome: 'pending' } : l),
    updatedAt: now,
  };
};

/** The offer sheet's per-line annotations, keyed by item id. */
export const offerAnnotations = (offer: Offer): Record<string, { grade?: string; note?: string }> =>
  Object.fromEntries(offer.lines.map(l => [l.itemId, { grade: l.grade, note: l.note }]));

/**
 * IS THE BUYER HOLDING A STALE SHEET?
 *
 * An offer stays editable after the sheet has been sent — refusing edits would
 * mean raising a new offer every time a device is added, which loses the
 * thread of the conversation. But the file in the buyer's inbox is a SNAPSHOT
 * of the moment it was exported, and it does not update itself. So when the
 * offer has changed since, the screen says so and the fix is to export again.
 */
export const sheetIsStale = (offer: Offer): boolean =>
  !!offer.sentAt && !!offer.updatedAt && offer.updatedAt > offer.sentAt;

export const newOffer = (id: string, buyerName: string, todayISO: string, now: number, createdBy?: string): Offer => ({
  id,
  buyerName: buyerName.trim(),
  date: todayISO,
  status: 'open',
  lines: [],
  createdAt: now,
  createdBy,
});
