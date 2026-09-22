import { InventoryItem, Repair } from '../types';

/**
 * ONE WAY TO COMPARE A SCANNED CODE TO A STORED ONE.
 *
 * THE BUG: scanning an IMEI in Inventory returned "Nothing here" for devices
 * that were plainly in stock. Three separate reasons, all of them here:
 *
 *   a. The search was a raw `.toLowerCase().includes(q)`. An IMEI typed in as
 *      "35 123456 789012 3" — which is how it is printed on the box, and how
 *      staff enter it — never matches a scanner's "351234567890123". Same for a
 *      SKU written "FTT-0142" and scanned "FTT0142".
 *   b. It only searched the CURRENT page and the CURRENT status filter, so a
 *      sold device scanned while the filter said "In stock" simply wasn't there.
 *   c. That status filter is remembered PER USER, so one employee was stuck
 *      behind a narrow filter the owner never saw.
 *
 * (a) is fixed by normalising BOTH sides before comparing; (b) and (c) by
 * letting an EXACT identifier hit ignore the page and the filters — see
 * `identifierHits` and `outsideFilterNote`.
 *
 * WHY A SEPARATE MODULE FROM domain/autoInventory.ts: that one's
 * `normalizeIdentifier` decides what gets STORED on `imeiNormalized` and is the
 * basis of the uniqueness index. Loosening it would change stored values and
 * silently reinterpret the index. This module never writes anything — it only
 * decides whether two strings name the same physical thing when somebody is
 * looking for it — so it can be as forgiving as a human would be.
 *
 * Pure: no DOM, no Firestore. Inventory search, the POS scan box, the repair
 * intake lookup, the tech bench scanner and global search all call it, so a
 * code that finds a device in one place finds it in all of them.
 */

/**
 * Strip every separator and case difference: "35-123456 789012/3" and
 * "351234567890123" both become "351234567890123", "ftt-0142" becomes
 * "FTT0142".
 *
 * Deliberately removes ANYTHING that is not a letter or a digit rather than
 * listing the separators to remove. Codes arrive off label printers, packing
 * slips and hand-written notes, and the set of characters people put between
 * the groups of an IMEI is not a set worth trying to enumerate.
 */
export const normalizeForLookup = (raw: string | undefined): string =>
  (raw || '').replace(/[^a-z0-9]/gi, '').toUpperCase();

/** Do these two strings name the same identifier? Blank never matches. */
export const sameIdentifier = (a: string | undefined, b: string | undefined): boolean => {
  const na = normalizeForLookup(a);
  return !!na && na === normalizeForLookup(b);
};

/**
 * The identifier fields of an inventory item.
 *
 * Both kinds get all three. A device's code lives in `imei` or `sku`, an
 * accessory's in `manufacturerBarcode` or `sku` — but the field a given row
 * actually used is a matter of who typed it in, and refusing to look at the
 * "wrong" one is exactly the kind of narrowing that caused this.
 */
export const itemIdentifiers = (
  i: Pick<InventoryItem, 'sku' | 'imei' | 'manufacturerBarcode'>,
): string[] => [i.sku, i.imei, i.manufacturerBarcode].filter(Boolean) as string[];

/** Is `query` an EXACT (normalised) match for one of this item's identifiers? */
export const matchesItemIdentifier = (
  i: Pick<InventoryItem, 'sku' | 'imei' | 'manufacturerBarcode'>,
  query: string,
): boolean => {
  const q = normalizeForLookup(query);
  if (!q) return false;
  return itemIdentifiers(i).some(v => normalizeForLookup(v) === q);
};

/**
 * Every item whose identifier exactly matches — across the WHOLE inventory,
 * ignoring page and filters by design. The caller decides how to present one
 * that sits outside what is currently on screen.
 */
export const identifierHits = (inventory: InventoryItem[], query: string): InventoryItem[] => {
  const q = normalizeForLookup(query);
  if (!q) return [];
  return inventory.filter(i => matchesItemIdentifier(i, q));
};

/** A repair ticket found by its number, its id, or the device's IMEI/serial. */
export const matchesRepairIdentifier = (
  r: Pick<Repair, 'id' | 'repairNumber' | 'imei'>,
  query: string,
): boolean => {
  const q = normalizeForLookup(query);
  if (!q) return false;
  return [r.id, r.repairNumber, r.imei].some(v => normalizeForLookup(v) === q);
};

/* ---------------- Saying where it actually is ---------------- */

/**
 * Which inventory section a row really lives in — the answer to "then where
 * IS it?", which an empty table never gave.
 */
export type ItemLocation = 'devices' | 'sold' | 'accessories';

export const locationOf = (
  i: Pick<InventoryItem, 'kind' | 'soldDate' | 'deviceStatus'>,
): ItemLocation => {
  if ((i.kind ?? 'device') === 'accessory') return 'accessories';
  return i.soldDate || i.deviceStatus === 'sold' ? 'sold' : 'devices';
};

export const LOCATION_LABEL: Record<ItemLocation, string> = {
  devices: 'In stock',
  sold: 'Sold',
  accessories: 'Accessories',
};

/**
 * The note shown beside a scanned item that the current page and filter would
 * otherwise have hidden. Null when the item is already on screen — there is
 * nothing to explain.
 */
export const outsideFilterNote = (
  i: Pick<InventoryItem, 'kind' | 'soldDate' | 'deviceStatus'>,
  onScreen: boolean,
): string | null =>
  onScreen ? null : `Found in ${LOCATION_LABEL[locationOf(i)]} — outside your current filter.`;

/* ---------------- When nothing matched ---------------- */

/** Long codes are shown truncated, so the message stays one readable line. */
const shortCode = (raw: string): string => {
  const v = raw.trim();
  return v.length <= 10 ? v : `${v.slice(0, 4)}…`;
};

/**
 * What to say when a scan finds nothing.
 *
 * "Nothing here" was the old answer and it was wrong twice over: it did not say
 * WHAT was not found, and it was often untrue — the device existed, on another
 * page. This is only ever shown once the whole inventory has been checked.
 *
 * The wording follows what was scanned: a run of digits is called an IMEI
 * because that is what it will be 99 times out of 100 at this counter, and
 * anything else is quoted back as typed rather than mislabelled.
 */
export const noIdentifierMatchMessage = (query: string): string => {
  const v = query.trim();
  if (!v) return '';
  return /^\d[\d\s-]*$/.test(v)
    ? `No device with IMEI ${shortCode(v)} — nothing in inventory matches that code.`
    : `No item with the code “${shortCode(v)}” — nothing in inventory matches it.`;
};
