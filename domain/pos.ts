import { InventoryItem, SalesTransaction } from '../types';
import { kindOf } from './inventory';
import { DrawerEffect } from './dropoffs';

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

// Whole days between two YYYY-MM-DD dates (to − from). Parsed as UTC midnights so
// DST never shifts the count.
const daysBetween = (fromISO: string, toISO: string): number => {
  const a = Date.parse(`${fromISO}T00:00:00Z`), b = Date.parse(`${toISO}T00:00:00Z`);
  if (isNaN(a) || isNaN(b)) return NaN;
  return Math.round((b - a) / 86_400_000);
};

// A sale may be voided only within the configurable void window (in days) after
// its date, and only once. `windowDays` 0 = same calendar day only (the default).
// A SalesTransaction has no separate created-at timestamp, so the window is
// measured against its `date` (YYYY-MM-DD) field.
export const canVoidSale = (tx: Pick<SalesTransaction, 'status' | 'date'>, todayISO: string, windowDays: number = 0): boolean => {
  if (isReversed(tx) || !tx.date) return false;
  const age = daysBetween(tx.date, todayISO);
  return !isNaN(age) && age >= 0 && age <= Math.max(0, windowDays);
};

// --- Returning a completed sale --------------------------------------------
// A return is the "everything after same-day" counterpart to Void: it refunds
// (optionally minus a restocking fee) and either restocks or scraps the device,
// keeping the transaction for history. Void owns same-day reversals; Returns own
// anything on a later day — the two never overlap.

export const isReturned = (tx: Pick<SalesTransaction, 'status'>): boolean => tx.status === 'returned';

/** A sale that has been reversed (voided or returned) — excluded from revenue, profit and balances. */
export const isReversed = (tx: Pick<SalesTransaction, 'status'>): boolean => isVoided(tx) || isReturned(tx);

// A sale may be returned once the void window has passed: it must not be already
// reversed, and it must be older than `windowDays` days (Void owns everything up
// to and including that boundary, Returns own everything after — so the two never
// overlap regardless of how the window is configured).
export const canReturnSale = (tx: Pick<SalesTransaction, 'status' | 'date'>, todayISO: string, windowDays: number = 0): boolean => {
  if (isReversed(tx) || !tx.date) return false;
  const age = daysBetween(tx.date, todayISO);
  return !isNaN(age) && age > Math.max(0, windowDays);
};

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

// --- Void / Return refund amounts -------------------------------------------
// `totalPaid` is the grand total DUE, not reduced by a deposit — refunding it
// wholesale on a layaway overpays the customer by whatever balance was never
// actually collected. These mirror domain/reports.ts's private collectedOnTx
// / cashCollectedOnTx (same contract: layaway → deposit only, cash/mixed →
// only the cash portion) but live here, independently, so domain/pos.ts and
// domain/reports.ts don't form an import cycle (reports.ts already imports
// isReversed from this file).

/**
 * The amount actually collected on a sale so far — the most a refund can ever
 * hand back. A layaway only ever took its deposit; a fully-paid sale took the
 * whole total.
 */
export const collectedOnSale = (tx: Pick<SalesTransaction, 'totalPaid' | 'deposit' | 'balanceOwing'>): number =>
  isLayaway(tx) ? (tx.deposit || 0) : (tx.totalPaid || 0);

/**
 * The CASH portion of what was actually collected: a cash sale → the whole
 * collected amount; a mixed sale → its recorded cash portion; card/e-transfer
 * → nothing (no cash ever entered the till, so none should leave it on a
 * refund).
 */
export const cashCollectedOnSale = (
  tx: Pick<SalesTransaction, 'totalPaid' | 'deposit' | 'balanceOwing' | 'paymentMethod' | 'cashAmount'>,
): number => {
  const collected = collectedOnSale(tx);
  if (collected <= 0) return 0;
  if (tx.paymentMethod === 'cash') return Math.round(collected * 100) / 100;
  if (tx.paymentMethod === 'mixed') return Math.round(Math.max(0, tx.cashAmount || 0) * 100) / 100;
  return 0; // card / etransfer / unset
};

/**
 * A void/return's effect on today's cash drawer — the ONE place that decides
 * whether reversing a sale touches the till. Always logged against the day
 * the reversal is actually processed (today), never retroactively against the
 * original (likely already-reconciled) sale date — see App.tsx's
 * handleVoidSale/handleReturnSale, which pass cashCollectedOnSale (void) or
 * returnRefund(cashCollectedOnSale(tx), restockingFee) (return) in here.
 * A zero/near-zero cash amount (a card/e-transfer sale) produces no entry.
 */
export const saleRefundDrawerEffect = (cashAmount: number): DrawerEffect | null => {
  const amount = Math.round((cashAmount || 0) * 100) / 100;
  if (amount < 0.005) return null;
  return { kind: 'cashOut', amount };
};
