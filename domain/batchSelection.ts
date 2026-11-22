import { InventoryItem } from '../types';
import { INVENTORY_SKU_PREFIX } from '../services/sku';
import { LOCATION_LABEL, itemIdentifiers, locationOf, normalizeForLookup, sameIdentifier } from './identifierSearch';
import { isInTransit } from './transfers';

/**
 * BUILDING A BATCH FROM A LIST OF IDENTIFIERS.
 *
 * WHAT THIS IS FOR. A wholesale offer is thirty devices, and the buyer names
 * them the way buyers do: a column pasted out of a spreadsheet, or a pile of
 * handsets scanned one after another. Up to now the only way to turn that into
 * a selection in Inventory was to tick thirty checkboxes, and the screen was
 * actively hostile to it:
 *
 *   • the selection is wiped whenever the page, the search, the status filter
 *     or the sort changes (InventoryView's reset effect);
 *   • "select all" ticks the CURRENT 50-ROW PAGE, not the filter's result, so
 *     a 120-row result cannot be selected at all without paging;
 *   • the scanner types into the SEARCH box, so every scan both replaced the
 *     query and — via that same effect — threw away everything ticked so far.
 *
 * So the one tool that could have built the batch quickly was the one that
 * destroyed it. This module is the other half: it turns a pasted blob or a
 * stream of scans into a resolved set of items, and reports what it could not
 * resolve BEFORE anything is acted on.
 *
 * MATCHING IS NOT REIMPLEMENTED HERE. `normalizeForLookup` and
 * `sameIdentifier` (domain/identifierSearch.ts) already decide whether two
 * strings name the same physical thing, forgivingly enough for codes that come
 * off label printers, packing slips and spreadsheets. This module adds exactly
 * ONE candidate spelling to that comparison — the shop's own SKU prefix, see
 * `skuSpellings` — and otherwise defers to it entirely. A second matcher is
 * precisely what that module exists to prevent.
 *
 * Pure: no DOM, no Firestore, no state. The caller decides what to do with the
 * resolution.
 */

/* ---------------- Parsing whatever got pasted ---------------- */

/**
 * SPLIT A PASTED BLOB INTO IDENTIFIERS.
 *
 * A column copied out of Excel arrives as newlines. A list typed into an email
 * arrives as commas, or spaces, or "FTT-000101 / FTT-000102". A column copied
 * out of Google Sheets arrives wrapped in double quotes, sometimes with the
 * quotes doubled up. A list pasted off a phone has a trailing blank line and a
 * stray non-breaking space.
 *
 * None of that is worth asking the owner to clean up by hand, so the split is
 * on any run of whitespace, commas, semicolons, pipes, slashes or tabs, and
 * surrounding quotes and stray punctuation are trimmed off each token.
 *
 * TWO SHAPES THE SPLIT HAS TO PUT BACK TOGETHER, both of them real:
 *
 *   • A GROUPED IMEI — "35 123456 789012 3" is how it is printed on the box
 *     and how staff type it. Splitting on spaces alone turns one device into
 *     four unmatched fragments. So a line whose fragments are ALL digits, none
 *     of them a full code on its own, and which together make an IMEI-length
 *     run (14–17 digits), is rejoined into one identifier. Two whole IMEIs on
 *     one line stay two, because each fragment is already code-length.
 *   • A SPACED PREFIX — "FTT 000101". A fragment that is exactly the shop's
 *     own SKU prefix is not an identifier, it is one orphaned by the split, so
 *     it is glued back onto the fragment after it.
 *
 * Anything else that cannot be resolved is REPORTED as not found rather than
 * quietly discarded, which is the point: a mis-split token the owner can see
 * is a question, and one that vanished is a device missing from the offer.
 *
 * Duplicates are collapsed on the NORMALISED form, keeping the first spelling
 * seen, so "FTT-000101" and "ftt000101" in the same paste are one identifier
 * rather than two — and the batch does not report a phantom duplicate.
 */
const QUOTE_TRIM = /^["'\s]+|["'\s,;.]+$/g;
const FRAGMENT_SPLIT = /[\s,;|/\t]+/;

const splitLine = (line: string): string[] => {
  const frags = line.split(FRAGMENT_SPLIT).map(f => f.replace(QUOTE_TRIM, '')).filter(Boolean);
  if (frags.length <= 1) return frags;

  // A grouped IMEI/serial: all-digit fragments, none code-length by itself,
  // adding up to one code-length run.
  const joined = frags.join('');
  if (frags.every(f => /^\d+$/.test(f) && f.length < 14) && joined.length >= 14 && joined.length <= 17) {
    return [joined];
  }

  // The shop's prefix, orphaned by the split.
  const out: string[] = [];
  for (let k = 0; k < frags.length; k++) {
    if (normalizeForLookup(frags[k]) === INVENTORY_SKU_PREFIX && k + 1 < frags.length) {
      out.push(`${INVENTORY_SKU_PREFIX}-${frags[k + 1]}`);
      k++;
    } else out.push(frags[k]);
  }
  return out;
};

export const parseIdentifierList = (text: string): string[] => {
  const raw = (text || '').replace(/ /g, ' ');
  const tokens = raw
    .split(/[\r\n]+/)
    .map(l => l.replace(QUOTE_TRIM, ''))
    .filter(Boolean)
    .flatMap(splitLine);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const v = t.replace(QUOTE_TRIM, '');
    const key = normalizeForLookup(v);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
};

/* ---------------- Resolving one identifier ---------------- */

/**
 * THE SPELLINGS OF ONE PASTED TOKEN — the only thing this module adds to the
 * app's existing comparison.
 *
 * Every SKU this shop generates starts with INVENTORY_SKU_PREFIX, and the
 * PRINTED label deliberately drops it (`shortLabelSku`, services/labelLayout).
 * So the shelf tag in the owner's hand says `000101` while the stored value is
 * `FTT-000101`, and a list typed from those tags carries the short form. Both
 * must resolve, so the prefixed spelling is offered as a second candidate and
 * handed to the same `sameIdentifier` as the first.
 *
 * Nothing is stripped: a token that already carries the prefix is left alone,
 * and a code belonging to some other numbering scheme is never rewritten.
 */
export const skuSpellings = (token: string): string[] => {
  const v = (token || '').trim();
  if (!v) return [];
  const n = normalizeForLookup(v);
  return n.startsWith(INVENTORY_SKU_PREFIX) ? [v] : [v, `${INVENTORY_SKU_PREFIX}-${v}`];
};

/** Every item one pasted identifier could mean. Exact (normalised) matches only. */
export const identifierMatches = (inventory: InventoryItem[], token: string): InventoryItem[] => {
  const spellings = skuSpellings(token);
  if (spellings.length === 0) return [];
  return inventory.filter(i =>
    itemIdentifiers(i).some(v => spellings.some(s => sameIdentifier(v, s))));
};

/* ---------------- The resolution ---------------- */

/**
 * WHY AN ITEM IN THE BATCH IS WORTH MENTIONING.
 *
 * Nothing here BLOCKS a match — the same acknowledge-don't-block judgement the
 * rest of this screen makes. A wholesale batch legitimately includes a device
 * that is reserved for a customer who never came back, and the owner is the
 * one who knows that. What is not acceptable is finding out afterwards that a
 * sold phone went into an offer, so each one is named on screen first.
 */
export type BatchFlag = 'sold' | 'in-transit' | 'reserved' | 'pending-repair' | 'pending-purchase' | 'accessory';

export const BATCH_FLAG_NOTE: Record<BatchFlag, string> = {
  sold: 'already sold',
  'in-transit': 'in transit between stores',
  reserved: 'reserved for a customer',
  'pending-repair': 'waiting on a repair',
  'pending-purchase': 'not bought yet',
  accessory: 'an accessory, not a device',
};

export const batchFlagOf = (i: InventoryItem): BatchFlag | null => {
  if ((i.kind ?? 'device') === 'accessory') return 'accessory';
  if (locationOf(i) === 'sold') return 'sold';
  if (isInTransit(i)) return 'in-transit';
  if (i.deviceStatus === 'reserved') return 'reserved';
  if (i.deviceStatus === 'pending_repair') return 'pending-repair';
  if (i.deviceStatus === 'pending_purchase') return 'pending-purchase';
  return null;
};

export interface BatchMatch { identifier: string; item: InventoryItem; flag: BatchFlag | null }

export interface BatchResolution {
  /** The identifiers as parsed, in paste order. */
  identifiers: string[];
  /** One identifier, one item. */
  matched: BatchMatch[];
  /** Identifiers that name nothing in inventory — reported, never silently dropped. */
  unmatched: string[];
  /** Identifiers naming more than one item. Never guessed at; nothing is selected for these. */
  ambiguous: { identifier: string; items: InventoryItem[] }[];
}

/**
 * RESOLVE A WHOLE PASTE. Every identifier lands in exactly one of the three
 * buckets, so `matched + unmatched + ambiguous` always accounts for the lot
 * and the count on screen cannot disagree with what gets selected.
 *
 * An identifier naming more than one item is reported rather than resolved: in
 * a wholesale offer, picking the wrong one of two devices that share a code
 * means shipping the wrong phone.
 */
export const resolveBatch = (inventory: InventoryItem[], text: string): BatchResolution => {
  const identifiers = parseIdentifierList(text);
  const matched: BatchMatch[] = [];
  const unmatched: string[] = [];
  const ambiguous: { identifier: string; items: InventoryItem[] }[] = [];

  for (const identifier of identifiers) {
    const hits = identifierMatches(inventory, identifier);
    if (hits.length === 0) unmatched.push(identifier);
    else if (hits.length > 1) ambiguous.push({ identifier, items: hits });
    else matched.push({ identifier, item: hits[0], flag: batchFlagOf(hits[0]) });
  }

  return { identifiers, matched, unmatched, ambiguous };
};

/** The ids a resolution would add to the selection. */
export const batchIds = (r: BatchResolution): string[] => r.matched.map(m => m.item.id);

/** The flagged matches, for the "worth mentioning" list. */
export const batchFlagged = (r: BatchResolution): BatchMatch[] => r.matched.filter(m => !!m.flag);

/**
 * A CEILING ON ONE PASTE.
 *
 * Not a limit on how big a batch may get — the owner can paste twice — but a
 * guard against a whole exported sheet, or a stuck scanner, arriving as one
 * blob and resolving thousands of identifiers in a loop that is O(paste ×
 * inventory). 500 is far more than any offer this shop makes.
 */
export const MAX_BATCH_PASTE = 500;

export const batchPasteTooLargeMessage = (n: number): string =>
  `${n} identifiers pasted. Up to ${MAX_BATCH_PASTE} can be added at once — `
  + `paste it in parts (each paste adds to the batch).`;

/** One line summarising a resolution, shown before anything is added. */
export const describeBatch = (r: BatchResolution): string => {
  const bits = [`${r.matched.length} found`];
  if (r.unmatched.length) bits.push(`${r.unmatched.length} not found`);
  if (r.ambiguous.length) bits.push(`${r.ambiguous.length} ambiguous`);
  return bits.join(' · ');
};

/** Where a matched item actually lives, for a batch built across tabs. */
export const batchLocationLabel = (i: InventoryItem): string => LOCATION_LABEL[locationOf(i)];
