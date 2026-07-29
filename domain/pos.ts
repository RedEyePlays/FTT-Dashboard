import { InventoryItem, SalesTransaction } from '../types';
import { kindOf } from './inventory';

// Shared POS constants/helpers. Extracted from CartSaleView so the platform-fee
// list has a single home and can be unit-tested and reused by future POS views.

export interface PlatformFee {
  name: string;
  fee: number; // percent
}

export const PLATFORMS: PlatformFee[] = [
  { name: 'None / In-Store', fee: 0 },
  { name: 'eBay', fee: 13.25 },
  { name: 'Amazon', fee: 15 },
  { name: 'Facebook Marketplace', fee: 5 },
  { name: 'Best Buy', fee: 10 },
  { name: 'Swappa', fee: 3 },
  { name: 'Other', fee: 0 },
];

/** Dollar platform fee for a subtotal at a given percent. */
export const platformFeeAmount = (subtotal: number, percent: number): number =>
  Math.max(0, subtotal) * (Math.max(0, percent) / 100);

// --- $0 device safeguard ---------------------------------------------------
// A device with no sale price set (targetSalePrice missing/0) can be added to
// the cart and would sell for $0.00. These pure predicates let the checkout flag
// such lines and block completion unless the seller explicitly overrides it.

export interface PricedLine { kind: 'device' | 'accessory'; unitPrice: number }

/** A device line priced at $0 (or less) — a likely mistake worth confirming. */
export const isZeroPricedDevice = (l: PricedLine): boolean =>
  l.kind === 'device' && (l.unitPrice || 0) <= 0;

/** True if any device line in the cart is priced at $0. */
export const cartHasZeroPricedDevice = (lines: PricedLine[]): boolean =>
  lines.some(isZeroPricedDevice);

// --- Checkout typed-search fallback ----------------------------------------
//
// When a scan/typed value doesn't exactly match a SKU/IMEI/barcode, the checkout
// falls back to a case-insensitive substring search across sellable inventory
// (unsold devices + in-stock accessories) on name/brand/model/SKU/IMEI/barcode.
// Returns a bounded list — a short pick-list, never the whole catalogue.
export const searchCheckoutInventory = (
  inventory: InventoryItem[],
  query: string,
  opts?: { excludeIds?: Set<string>; limit?: number },
): InventoryItem[] => {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exclude = opts?.excludeIds ?? new Set<string>();
  const limit = opts?.limit ?? 6;
  const hit = (i: InventoryItem) =>
    [i.item, i.brand, i.model, i.sku, i.imei, i.manufacturerBarcode]
      .some(v => (v || '').toLowerCase().includes(q));
  const sellable = (i: InventoryItem) =>
    kindOf(i) === 'device'
      ? !(i.soldDate || i.deviceStatus === 'sold')
      : (i.quantity ?? 0) > 0;
  return inventory.filter(i => !exclude.has(i.id) && sellable(i) && hit(i)).slice(0, limit);
};

// --- Voiding a completed sale ----------------------------------------------

export const isVoided = (tx: Pick<SalesTransaction, 'status'>): boolean => tx.status === 'voided';

// A sale may be voided only within the same calendar day it was recorded, and
// only once. A SalesTransaction has no separate created-at timestamp, so the
// window is measured against its `date` (YYYY-MM-DD) field.
export const canVoidSale = (tx: Pick<SalesTransaction, 'status' | 'date'>, todayISO: string): boolean =>
  !isVoided(tx) && !!tx.date && tx.date === todayISO;

// --- Returning a completed sale --------------------------------------------
// A return is the "everything after same-day" counterpart to Void: it refunds
// (optionally minus a restocking fee) and either restocks or scraps the device,
// keeping the transaction for history. Void owns same-day reversals; Returns own
// anything on a later day — the two never overlap.

export const isReturned = (tx: Pick<SalesTransaction, 'status'>): boolean => tx.status === 'returned';

/** A sale that has been reversed (voided or returned) — excluded from revenue, profit and balances. */
export const isReversed = (tx: Pick<SalesTransaction, 'status'>): boolean => isVoided(tx) || isReturned(tx);

// A sale may be returned once the same-day void window has passed: it must not be
// already reversed, and its date must be a day earlier than today (same day is
// Void's job). Measured against the transaction `date` (YYYY-MM-DD), like void.
export const canReturnSale = (tx: Pick<SalesTransaction, 'status' | 'date'>, todayISO: string): boolean =>
  !isReversed(tx) && !!tx.date && tx.date < todayISO;

/**
 * Actual refund for a return: the sale total minus an optional restocking fee.
 * The fee is clamped to [0, total] (never a negative refund, never a fee bigger
 * than the sale). Rounded to cents.
 */
export const returnRefund = (total: number, restockingFee?: number): number => {
  const fee = Math.min(Math.max(restockingFee || 0, 0), Math.max(0, total));
  return Math.max(0, Math.round((total - fee) * 100) / 100);
};

/**
 * The accessory restock deltas for reversing a sale (void or return): one
 * positive delta per accessory line, summed by inventory id. Applied with
 * Firestore's atomic increment() so concurrent reversals don't clobber stock.
 */
export const saleAccessoryRestock = (tx: Pick<SalesTransaction, 'lines'>): { id: string; delta: number }[] => {
  const byId = new Map<string, number>();
  for (const l of tx.lines) {
    if (l.kind === 'accessory' && l.inventoryId) byId.set(l.inventoryId, (byId.get(l.inventoryId) || 0) + (l.quantity || 0));
  }
  return [...byId].map(([id, delta]) => ({ id, delta }));
};

// --- Layaway / deposit -----------------------------------------------------
// A Quick Sale can be partially paid: the customer leaves a deposit now and
// owes the balance later (same concept repairs already use via `deposit`).
// These pure helpers keep the money math testable and shared across the
// desktop and mobile checkout flows.

/**
 * Balance still owed on a sale after a deposit. `total` is the grand total due
 * (subtotal + tax); `deposit` is what was actually collected. A missing, zero
 * or negative deposit means the sale is paid in full (owes nothing), and a
 * deposit at/above the total also clears the balance. Rounded to cents.
 */
export const salesBalanceOwing = (total: number, deposit?: number): number => {
  const paid = deposit || 0;
  if (paid <= 0) return 0;
  return Math.max(0, Math.round((total - paid) * 100) / 100);
};

/** True when a sale still has money owing on it (a layaway / partial payment). */
export const isLayaway = (tx: { balanceOwing?: number }): boolean =>
  (tx.balanceOwing || 0) > 0;
