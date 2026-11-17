import { InventoryItem } from '../types';
import type { CartLine } from '../hooks/useCheckout';
import { getDeviceDisplayName } from './inventory';

// Quick Sale cart auto-save/restore — pure decision logic. The actual
// sessionStorage read/write lives in services/checkoutPersistence.ts; this
// file only decides WHAT gets persisted, WHEN a saved blob is still usable,
// and HOW a restored cart gets reconciled against live inventory before it's
// shown to anyone. Kept separate from the storage IO so all of that can be
// unit-tested without a DOM.

// The subset of useCheckout's state that's worth auto-saving: cart lines,
// customer fields, payment method + its sub-fields, deposit/layaway, and the
// platform/date fields. Deliberately EXCLUDES:
//  - soldDate: a restored cart must never resurrect a previously chosen/
//    backdated sale date (see useCheckout — soldDate always starts as
//    today's date and is simply never restored here).
//  - allowZeroPrice / allowListedElsewhereSale: safety-override checkboxes
//    tied to the cart as last reviewed. A restored cart re-requires
//    re-acknowledging either warning rather than silently carrying an old
//    "yes, sell it anyway" through — see useCheckout's restore effect.
export interface PersistedCheckoutState {
  savedAt: number; // epoch ms — used for expiry, see isPersistedStateFresh
  cart: CartLine[];
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  customerNotes: string;
  selectedCustomerId?: string;
  linkedRepairId?: string;
  paymentMethod: 'cash' | 'card' | 'mixed' | 'etransfer';
  cashTaxStatus: 'none' | 'separate' | 'included';
  etransferTaxStatus: 'none' | 'separate';
  paymentNotes: string;
  cashAmount: string;
  cardAmount: string;
  etransferAmount: string;
  taxCollected: string;
  deposit: string;
  platformName: string;
  platformFeePercent: string;
  // Optional so a blob saved before shipping existed still restores
  // cleanly (the restore reads `saved.shippingCost || ''`).
  shippingCost?: string;
}

// How long a saved cart stays eligible for restore. A fixed rolling window
// (not "same calendar day") so a cart saved at 11:58pm and reopened at
// 12:02am the next day isn't treated as instantly stale just because the
// date rolled over — 4 hours comfortably covers a normal shift while still
// making a cart from yesterday (or from before a lunch/overnight break)
// refuse to come back.
export const CHECKOUT_PERSIST_TTL_MS = 4 * 60 * 60 * 1000;

export const isPersistedStateFresh = (savedAt: number, now: number): boolean =>
  now - savedAt >= 0 && now - savedAt <= CHECKOUT_PERSIST_TTL_MS;

// The storage key is namespaced by workspace + user, which is what actually
// enforces "never restore one employee's cart into another's session" and
// "never restore across a workspace mismatch" on a shared terminal — a
// different user (or workspace) simply reads a different key and never sees
// this one, with no separate cross-user clearing logic required. Both ids
// are required (not optional) so a caller can't accidentally build an
// unscoped/shared key for an unauthenticated or not-yet-resolved session.
export const checkoutStorageKey = (workspaceId: string, userId: string): string =>
  `ftt_quicksale_cart_v1:${workspaceId}:${userId}`;

export interface RevalidatedCart {
  cart: CartLine[];
  droppedNames: string[];
}

// Re-check a restored cart against LIVE inventory before it's ever shown —
// never trust the saved snapshot for availability or price. A line is
// dropped (not silently kept) when:
//  - it references an inventoryId that no longer exists (deleted), or
//  - it's a device that's since been sold or reserved elsewhere, or
//  - it's an accessory with zero live stock left.
// A device line that's still available has its price/cost fields refreshed
// from the live record (never the saved one) — a price change or the device
// listing on another platform since the cart was saved should show up now,
// not silently trail the stale snapshot. An accessory's quantity is clamped
// down to whatever's actually still in stock rather than dropped outright,
// since a partial fill is usually still useful (e.g. 3 of the 5 requested
// are still on the shelf). Custom lines (no inventoryId) have nothing to
// check against and are always kept as-is.
export function revalidateRestoredCart(cart: CartLine[], inventory: InventoryItem[]): RevalidatedCart {
  const byId = new Map(inventory.map(i => [i.id, i]));
  const kept: CartLine[] = [];
  const droppedNames: string[] = [];

  for (const line of cart) {
    if (!line.inventoryId) { kept.push(line); continue; }
    const live = byId.get(line.inventoryId);
    if (!live) { droppedNames.push(line.name); continue; }

    if (line.kind === 'device') {
      const unavailable = !!live.soldDate || live.deviceStatus === 'sold' || live.deviceStatus === 'reserved';
      if (unavailable) { droppedNames.push(line.name); continue; }
      kept.push({
        ...line,
        name: getDeviceDisplayName(live) || line.name,
        unitPrice: live.targetSalePrice || 0,
        purchaseCost: live.purchaseCost,
        repairCost: live.repairCost || 0,
        listedPlatforms: live.listedPlatforms,
      });
    } else {
      const availableQty = live.quantity ?? 0;
      if (availableQty <= 0) { droppedNames.push(line.name); continue; }
      kept.push({
        ...line,
        name: live.item || line.name,
        quantity: Math.min(line.quantity, availableQty),
        maxQty: availableQty,
        unitPrice: live.sellingPrice || 0,
        purchaseCost: live.costPerUnit || 0,
      });
    }
  }

  return { cart: kept, droppedNames };
}

// A plain, staff-facing summary of what got dropped — null when nothing was,
// so callers can use it directly as "show a notice or don't".
/**
 * MERGE A RESTORED CART INTO WHATEVER THIS MOUNT HAS ALREADY SEEDED.
 *
 * Quick Sale has two things that both write the cart on mount: a repair
 * prefill (the ticket's Check Out) and the sessionStorage restore. They used
 * to race, and the restore won purely because it is DECLARED SECOND in
 * hooks/useCheckout.ts — so the fresh repair line, built moments earlier from
 * the repair's current parts, was replaced by the saved one and its stale
 * parts cost. Invisible while the view stayed mounted (the restore runs once
 * per mount), and reproducible the instant you navigate away and back, which
 * is exactly what somebody does to go and change the parts.
 *
 * So the outcome is decided HERE, by identity, instead of by declaration
 * order:
 *
 *   • THE SEEDED LINES WIN. The person asked for this repair to be checked
 *     out seconds ago; a cart saved minutes ago is the older intent.
 *   • A RESTORED LINE FOR THE SAME REPAIR IS DROPPED, not kept alongside —
 *     otherwise the reported flow (check out, go change the parts, check out
 *     again) would put the repair in the cart twice, at two different costs.
 *   • EVERYTHING ELSE IN THE SAVED CART SURVIVES. Somebody halfway through
 *     ringing up a case and a charger, who then sends a repair to checkout,
 *     keeps the case and the charger. Throwing those away to make the repair
 *     line correct would be trading one bug for another.
 *
 * With nothing seeded this is the identity function on the restored cart, so
 * the ordinary restore — by far the common case — behaves exactly as before.
 */
export function mergeSeededWithRestored(seeded: CartLine[], restored: CartLine[]): CartLine[] {
  if (seeded.length === 0) return restored;
  const seededRepairs = new Set(seeded.map(l => l.repairId).filter(Boolean));
  const kept = restored.filter(l => !(l.repairId && seededRepairs.has(l.repairId)));
  return [...kept, ...seeded];
}

export function describeDroppedLines(droppedNames: string[]): string | null {
  if (droppedNames.length === 0) return null;
  if (droppedNames.length === 1) return `1 item is no longer available and was removed: ${droppedNames[0]}.`;
  return `${droppedNames.length} items are no longer available and were removed: ${droppedNames.join(', ')}.`;
}
