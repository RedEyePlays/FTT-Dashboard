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
