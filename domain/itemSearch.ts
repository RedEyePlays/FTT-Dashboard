import { InventoryItem } from '../types';
import { normalizeForLookup } from './identifierSearch';

/**
 * "iPhone 16 128GB White" HAS TO FIND THE PHONE.
 *
 * THE BUG: the inventory matcher tested the WHOLE query as one substring
 * against each field separately:
 *
 *   [sku, barcode, imei, item, brand, model, displayName]
 *     .some(v => v.toLowerCase().includes(q))
 *
 * Those four words live in four different fields, so no single field contains
 * the whole string and the search returned nothing — for a phone sitting on the
 * shelf. Worse, storage, colour, carrier, condition, battery health, notes and
 * "bought from" were never searched at all, so half of what is written on a
 * device was unfindable.
 *
 * The fix is the obvious one: SPLIT THE QUERY INTO WORDS, and match a device
 * when EVERY word appears somewhere on it. Word order stops mattering, which is
 * what people actually expect — "white 128 iphone 16" is the same search.
 *
 * Loose in exactly three ways, and no further:
 *   • case-insensitive;
 *   • spacing-insensitive, so "128gb" finds a stored "128 GB" and vice versa;
 *   • "gb" optional, so "128" alone finds 128 GB.
 * No fuzzy matching and no typo correction: a search that quietly returns
 * things you did not ask for is worse than one that returns nothing, because
 * you cannot tell which is which at a glance.
 *
 * AN EXACT IDENTIFIER STILL WINS AND IGNORES THE FILTERS — that is
 * domain/identifierSearch.ts's job and is untouched here. Word searches respect
 * the page and the status filter exactly as they always did.
 *
 * Pure: no DOM, no Firestore. The inventory table, the POS product search and
 * global search all use it, so searching behaves the same everywhere.
 */

/** The fields a DEVICE is searched across. */
const DEVICE_FIELDS: (keyof InventoryItem)[] = [
  'sku', 'imei', 'manufacturerBarcode', 'item', 'brand', 'model',
  'storage', 'color', 'carrier', 'condition', 'batteryHealth', 'deviceType',
  'notes', 'boughtFrom',
];

/** The fields an ACCESSORY is searched across. */
const ACCESSORY_FIELDS: (keyof InventoryItem)[] = [
  'sku', 'manufacturerBarcode', 'item', 'category', 'notes', 'boughtFrom', 'brand', 'model',
];

/**
 * The searchable text for one item, built ONCE.
 *
 * Two forms are kept: the plain lowercase text, and the same text with every
 * space removed. A word is tried against both, which is what makes "128gb"
 * match a stored "128 GB" and "128 gb" match a stored "128GB" without needing
 * to guess which way round somebody typed it.
 *
 * `extra` carries the computed display name, which callers already have and
 * which is not a stored field.
 */
export interface SearchableItem {
  plain: string;
  squashed: string;
}

export const buildSearchable = (i: InventoryItem, extra = ''): SearchableItem => {
  const fields = (i.kind ?? 'device') === 'accessory' ? ACCESSORY_FIELDS : DEVICE_FIELDS;
  const parts = fields.map(f => {
    const v = i[f];
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  });
  parts.push(extra);
  const plain = parts.filter(Boolean).join(' ').toLowerCase();
  return { plain, squashed: plain.replace(/\s+/g, '') };
};

/** Split a query into words. Blank yields no words, which matches everything. */
export const queryWords = (query: string): string[] =>
  (query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);

/**
 * Does one word appear on this item?
 *
 * Tried three ways, in the order they are cheapest:
 *   1. as typed, against the plain text ("white" in "… white …");
 *   2. with its own spaces removed, against the squashed text, so "128 gb"
 *      finds "128GB" and "128gb" finds "128 GB";
 *   3. with a trailing "gb" dropped — "128" alone finds 128 GB. Only the
 *      storage suffix is optional, because it is the one people habitually
 *      leave off; making every suffix optional would start matching things
 *      nobody asked for.
 */
export const wordMatches = (word: string, s: SearchableItem): boolean => {
  if (!word) return true;
  if (s.plain.includes(word)) return true;
  const squashed = word.replace(/\s+/g, '');
  if (squashed && s.squashed.includes(squashed)) return true;
  // "128" → also try "128gb", so a bare number finds a storage size.
  if (/^\d+$/.test(squashed) && s.squashed.includes(`${squashed}gb`)) return true;
  return false;
};

/**
 * EVERY word must appear somewhere on the item — AND across words, any field.
 *
 * AND rather than OR: "iphone 16" must not return every iPhone ever plus
 * everything with a 16 in it. A missing word excludes the device, which is what
 * makes adding a word narrow the results the way people expect.
 */
export const matchesWords = (s: SearchableItem, words: string[]): boolean =>
  words.every(w => wordMatches(w, s));

/**
 * The whole matcher for one item, for callers with nothing to memoise.
 *
 * Prefer building the SearchableItem once per item (buildSearchable, memoised
 * on the inventory list) and calling matchesWords — this rebuilds the text on
 * every call, which is fine for a handful of items and wasteful for thousands.
 */
export const matchesItemQuery = (i: InventoryItem, query: string, extra = ''): boolean => {
  const words = queryWords(query);
  if (words.length === 0) return true;
  return matchesWords(buildSearchable(i, extra), words);
};

/**
 * A memoised index over an inventory list.
 *
 * Built once per list rather than per keystroke per field: the old matcher
 * re-read seven fields off every row on every render, and this is the same work
 * done once.
 */
export const buildSearchIndex = (
  items: InventoryItem[],
  displayName: (i: InventoryItem) => string = () => '',
): Map<string, SearchableItem> =>
  new Map(items.map(i => [i.id, buildSearchable(i, displayName(i))]));

/* ---------------- Scoring, for ranked result lists ---------------- */

/**
 * A rough relevance score for a word search, so global search can rank these
 * alongside its other categories. An exact identifier is scored by
 * domain/identifierSearch.ts and always beats this.
 */
export const wordScore = (s: SearchableItem, words: string[], name: string): number => {
  if (words.length === 0 || !matchesWords(s, words)) return 0;
  const n = (name || '').toLowerCase();
  const joined = words.join(' ');
  if (n === joined) return 900;
  if (n.startsWith(joined)) return 650;
  if (n.includes(joined)) return 500;
  return 350;
};

/** The whole query as one normalised identifier, for the exact-hit fast path. */
export const asIdentifier = (query: string): string => normalizeForLookup(query);
