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

// The two Firestore collections that inventory items live in. Kept as a plain
// string-literal type here so `domain/` stays free of Firebase imports.
export type InventoryCollection = 'inventory' | 'accessories';
export const collectionFor = (i: InventoryItem): InventoryCollection =>
  isAccessory(i) ? 'accessories' : 'inventory';

// Pure stock math. Interim guard against negative stock under concurrent sales;
// true atomicity arrives with the server-side stockMovements ledger in Phase 1.
export const decrementStock = (current: number | undefined, sold: number | undefined): number =>
  Math.max(0, (current ?? 0) - (sold ?? 0));

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
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * Combined device display name.
 *
 * Priority: brand + model (de-duplicated) → item → deviceName → name →
 * modelName → '—'. The brand is not repeated when the model already begins with
 * it (brand "Apple" + model "Apple iPhone 14 Pro" → "Apple iPhone 14 Pro").
 */
export const getDeviceDisplayName = (d: DeviceNameFields | null | undefined): string => {
  if (!d) return '—';
  const brand = clean(d.brand);
  const model = clean(d.model);
  if (brand || model) {
    if (brand && model) {
      const combined = model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
      return clean(combined);
    }
    return brand || model;
  }
  // Legacy fallbacks, in order of preference.
  for (const legacy of [d.item, d.deviceName, d.name, d.modelName]) {
    const v = clean(legacy);
    if (v) return v;
  }
  return '—';
};
