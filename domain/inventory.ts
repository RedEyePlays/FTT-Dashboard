import { InventoryItem, ItemKind } from '../types';

// --- Item-kind vocabulary -------------------------------------------------
//
// Phase 0 begins splitting the overloaded `InventoryItem` type into a
// device/accessory distinction. We do this additively — via narrowing type
// guards and helpers — so no existing call site breaks. The full discriminated
// union is completed in the later phases that actually touch each surface.

// Legacy rows have no `kind`; they are devices.
export const kindOf = (i: Pick<InventoryItem, 'kind'>): ItemKind => i.kind ?? 'device';

/** A serialized, one-of-a-kind device (phones, laptops, …). */
export interface SerializedDevice extends InventoryItem { kind?: 'device'; }
/** A stock-tracked accessory (quantity-based). */
export interface StockItem extends InventoryItem { kind: 'accessory'; quantity?: number; }

export const isAccessory = (i: InventoryItem): i is StockItem => kindOf(i) === 'accessory';
export const isDevice = (i: InventoryItem): i is SerializedDevice => kindOf(i) === 'device';

// The field that represents an item's shelf/listing price — devices ask via
// targetSalePrice, accessories via sellingPrice. Shared so shelf tags and bulk
// price updates agree on which field a "price" bulk action actually writes.
export const priceFieldFor = (i: Pick<InventoryItem, 'kind'>): 'targetSalePrice' | 'sellingPrice' =>
  kindOf(i) === 'accessory' ? 'sellingPrice' : 'targetSalePrice';

// The two Firestore collections that inventory items live in. Kept as a plain
// string-literal type here so `domain/` stays free of Firebase imports.
export type InventoryCollection = 'inventory' | 'accessories';
export const collectionFor = (i: InventoryItem): InventoryCollection =>
  isAccessory(i) ? 'accessories' : 'inventory';

// The signed change to an accessory's on-hand quantity when `sold` units leave
// stock — always a decrement (you can't sell a negative quantity). This delta is
// applied atomically server-side via Firestore's increment(), so concurrent sales
// of the same accessory sum correctly regardless of write order (no lost update
// from two clients writing a precomputed absolute quantity).
//
// The resulting on-hand value is intentionally NOT clamped: if more units are
// sold than are in stock it goes negative, and that negative is a real oversell
// signal we surface rather than hide. `isOversold` names that check for callers
// that want to flag it. (The previous `decrementStock` helper clamped to 0 at
// write time, which is exactly what masked oversells — it is removed.)
export const stockChange = (sold: number | undefined): number => -Math.max(0, sold ?? 0) || 0;

// True when an on-hand quantity has gone below zero — i.e. the item was oversold.
export const isOversold = (onHand: number | undefined): boolean => (onHand ?? 0) < 0;

// --- Direct sale (outside Quick Sale) -------------------------------------
//
// A device can be sold outside the normal Quick Sale checkout — a private sale,
// a trade show, etc. Recording an Actual sale price directly on the device row
// or the edit form should mark it sold the SAME way Quick Sale does (soldDate +
// deviceStatus 'sold'), so it drops out of active stock AND is picked up by the
// dashboard / P&L / analytics, which recognize any device carrying a soldDate
// that isn't already part of a POS transaction. Without this a directly-entered
// price would be a silent second path that never shows up in reporting.
//
// Idempotent and side-effect free: only devices with a positive Actual price are
// stamped; an explicit soldDate the user picked is preserved, otherwise it
// defaults to today. Accessories and unpriced devices pass through unchanged.
export const applyDirectSale = (i: InventoryItem, now: number = Date.now()): InventoryItem => {
  if (kindOf(i) !== 'device' || (i.salePrice || 0) <= 0) return i;
  const soldDate = i.soldDate || new Date(now).toISOString().split('T')[0];
  return { ...i, soldDate, deviceStatus: 'sold' };
};

// --- Device display name --------------------------------------------------
//
// The single source of truth for the "Item" value shown for a device. Every
// surface (inventory table, mobile card, search, sort, labels) must use this so
// the combined name is consistent. Legacy records that predate the brand/model
// split may carry the name in `item`, `deviceName`, `name`, or `modelName`.

// Structural shape — accepts an InventoryItem plus any legacy name fields that
// aren't on the current type but may exist on older Firestore documents.
export interface DeviceNameFields {
  brand?: string;
  model?: string;
  item?: string;
  deviceName?: string;
  name?: string;
  modelName?: string;
  // Last-resort identity when no name field is set — so a nameless device still
  // reads as e.g. "Phone" or its SKU in a picker instead of a bare em dash.
  deviceType?: string;
  sku?: string;
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * Device display name.
 *
 * Priority: item → brand + model (de-duplicated) → deviceName → name →
 * modelName → deviceType → SKU → '—'.
 *
 * `item` is now the single, directly-edited name field (typed straight into the
 * Item cell), so it wins when set. Existing rows that only have brand/model keep
 * displaying their combined name (brand not repeated when the model already
 * begins with it — "Apple" + "Apple iPhone 14 Pro" → "Apple iPhone 14 Pro"). A
 * record with no name at all but a device type or SKU falls back to those so it's
 * still identifiable rather than rendering as a bare "—".
 */
export const getDeviceDisplayName = (d: DeviceNameFields | null | undefined): string => {
  if (!d) return '—';
  // The primary, user-edited name.
  const item = clean(d.item);
  if (item) return item;
  // Legacy rows without an `item`: keep showing their brand+model combination.
  const brand = clean(d.brand);
  const model = clean(d.model);
  if (brand || model) {
    if (brand && model) {
      const combined = model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
      return clean(combined);
    }
    return brand || model;
  }
  // Older legacy name fields, in order of preference.
  for (const legacy of [d.deviceName, d.name, d.modelName]) {
    const v = clean(legacy);
    if (v) return v;
  }
  // No name set — lead with device type, then SKU, so it's still identifiable.
  return clean(d.deviceType) || clean(d.sku) || '—';
};

// --- "Similar past sale" price suggestion (Quick Sale) ---
// A non-binding hint: what comparable devices actually sold for recently. Pure,
// so it's cheap and unit-testable. Never mutates anything and never decides a
// price — the caller shows it as a suggestion the cashier can take or ignore.

export interface PriceSuggestion {
  price: number;       // median sale price of the comparable set
  sampleSize: number;  // how many past sales it's based on
  basis: string;       // which attributes the comparables matched, e.g. "model + storage + condition"
}

const norm = (s?: string) => (s || '').trim().toLowerCase();
const median = (nums: number[]): number => {
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 100) / 100;
};

/**
 * Suggest a sale price for a device from what similar devices sold for. Matches
 * sold devices (soldDate set, positive salePrice) by model, tightening to also
 * match storage and condition when enough comparable sales exist. Returns the
 * median of the most recent up-to-`limit` comparable sales, or null when there's
 * nothing to compare against (e.g. no model, or a first-of-its-kind item).
 */
export const suggestedSalePrice = (
  target: Pick<InventoryItem, 'model' | 'storage' | 'condition'>,
  inventory: InventoryItem[],
  opts?: { limit?: number; minSamples?: number },
): PriceSuggestion | null => {
  const model = norm(target.model);
  if (!model) return null; // nothing reliable to match on
  const limit = opts?.limit ?? 8;
  const minSamples = opts?.minSamples ?? 2;

  // Sold devices with a real price, matching at least the model, most recent first.
  const sold = inventory
    .filter(i => kindOf(i) === 'device' && !!i.soldDate && (i.salePrice || 0) > 0 && norm(i.model) === model)
    .sort((a, b) => (b.soldDate || '').localeCompare(a.soldDate || ''));
  if (sold.length === 0) return null;

  const storage = norm(target.storage);
  const condition = norm(target.condition);
  // Build the tightest → loosest tiers, but only include a discriminator the
  // target actually has, so the reported basis is honest.
  const tiers: { attrs: string[]; rows: InventoryItem[] }[] = [];
  if (storage && condition) tiers.push({ attrs: ['model', 'storage', 'condition'], rows: sold.filter(i => norm(i.storage) === storage && norm(i.condition) === condition) });
  if (storage) tiers.push({ attrs: ['model', 'storage'], rows: sold.filter(i => norm(i.storage) === storage) });
  tiers.push({ attrs: ['model'], rows: sold });

  const chosen = tiers.find(t => t.rows.length >= minSamples) || tiers[tiers.length - 1];
  const recent = chosen.rows.slice(0, limit);
  return { price: median(recent.map(i => i.salePrice)), sampleSize: recent.length, basis: chosen.attrs.join(' + ') };
};
