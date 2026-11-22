import { InventoryItem } from '../types';
import { BatchFlag, batchFlagOf } from './batchSelection';
import { kindOf } from './inventory';
import { locationOf } from './identifierSearch';

/**
 * SENDING A SELECTION TO QUICK SALE AS CART LINES.
 *
 * The wholesale sale itself. Once the batch is built (domain/batchSelection.ts)
 * and the offer sheet has gone out (domain/offerSheet.ts), the lot has to
 * actually be rung through, and the only way to put thirty devices in the POS
 * cart was to search the picker for each one, thirty times.
 *
 * WHAT GOES AND WHAT DOES NOT — and the rule behind it: THIS PATH IS NEITHER
 * STRICTER NOR LOOSER THAN THE PICKER IT REPLACES. `availableDevices` in
 * hooks/useCheckout.ts excludes exactly two things — a device already SOLD and
 * a device already in the cart — and offers everything else, a reserved device
 * and one waiting on a repair included. So:
 *
 *   • SOLD is excluded, and that is not an override anybody should be offered.
 *     The unit is gone; a second sale of it is not a judgement call, it is two
 *     sales of one phone and a stock figure that never comes right again.
 *   • ALREADY IN THE CART is excluded, because it is already in the cart.
 *   • RESERVED, PENDING REPAIR, PENDING PURCHASE and IN TRANSIT all GO, and
 *     each is named first. This is the acknowledge-don't-block pattern the
 *     rest of this screen uses, and it is right here: a reserved device whose
 *     customer never came back is exactly the stock that ends up in a
 *     wholesale lot, and the owner is the one who knows that. What is not
 *     acceptable is finding out afterwards.
 *   • ACCESSORIES are excluded, and reported. An accessory is a quantity line
 *     with its own stock maths and its own oversell guard, and a wholesale lot
 *     of handsets is not where that should be worked out silently. Named, so
 *     nobody wonders where the cables went.
 *
 * Pure: no DOM, no cart. The caller seeds the cart with `sellable`.
 */

export type SellBatchBlock = 'sold' | 'accessory' | 'in-cart';

export const SELL_BLOCK_NOTE: Record<SellBatchBlock, string> = {
  sold: 'already sold — not sent',
  accessory: 'an accessory — not sent (devices only)',
  'in-cart': 'already in the cart',
};

export interface SellBatchPlan {
  /** Devices that will become cart lines, in selection order. */
  sellable: InventoryItem[];
  /** Going, but worth a look first — reserved, in transit, on the bench. */
  flagged: { item: InventoryItem; flag: BatchFlag }[];
  /** Not going, with the reason. */
  blocked: { item: InventoryItem; reason: SellBatchBlock }[];
  /** The sum of the target prices the cart will be seeded with. */
  targetTotal: number;
}

/**
 * HOW THIRTY TARGET PRICES BECOME ONE AGREED LOT PRICE.
 *
 * Each line is seeded at that device's own `targetSalePrice`, exactly as the
 * picker seeds one — this changes no pricing and invents no number. What the
 * owner is given instead is `targetTotal`: the sum, shown before the cart is
 * seeded, so the gap between "what we'd ask retail for these thirty" and "what
 * the buyer agreed for the lot" is a number on screen rather than mental
 * arithmetic at the counter. The agreed figure is then reached with the cart's
 * existing per-line price and discount fields.
 *
 * Deliberately NOT a "lot price" box that spreads one figure across thirty
 * lines: any such spread is an allocation rule (pro-rata by target? evenly?
 * weighted by cost?) and whichever one is picked silently rewrites the
 * per-line profit attribution that every report downstream reads. That is a
 * pricing decision for the owner, not a default for this to choose.
 */
export const targetTotalOf = (items: InventoryItem[]): number =>
  Math.round(items.reduce((s, i) => s + (i.targetSalePrice || 0), 0) * 100) / 100;

export const planSellBatch = (
  items: InventoryItem[],
  inCartIds: Set<string> | string[] = [],
): SellBatchPlan => {
  const inCart = inCartIds instanceof Set ? inCartIds : new Set(inCartIds);
  const sellable: InventoryItem[] = [];
  const flagged: { item: InventoryItem; flag: BatchFlag }[] = [];
  const blocked: { item: InventoryItem; reason: SellBatchBlock }[] = [];

  for (const item of items) {
    if (kindOf(item) === 'accessory') { blocked.push({ item, reason: 'accessory' }); continue; }
    if (locationOf(item) === 'sold') { blocked.push({ item, reason: 'sold' }); continue; }
    if (inCart.has(item.id)) { blocked.push({ item, reason: 'in-cart' }); continue; }
    sellable.push(item);
    const flag = batchFlagOf(item);
    if (flag) flagged.push({ item, flag });
  }

  return { sellable, flagged, blocked, targetTotal: targetTotalOf(sellable) };
};

/**
 * A CEILING ON ONE CART.
 *
 * Not about the work — thirty cart lines is nothing to render — but about what
 * a person can actually check before taking money. A forty-line cart is
 * already a scroll; a two-hundred-line one, seeded by a stray select-all, is a
 * checkout nobody reads, with real money and real stock at the end of it.
 *
 * 40 is comfortably above any lot this shop moves. Above it the action refuses
 * and says so rather than seeding the first 40: a truncated cart looks correct
 * and the missing devices stay on the books as unsold.
 */
export const MAX_SELL_BATCH = 40;

export const sellBatchTooLargeMessage = (n: number): string =>
  `${n} devices selected. Quick Sale takes up to ${MAX_SELL_BATCH} at once — `
  + `split the lot into two sales, or narrow the selection.`;

/** One line describing what the action will do, shown before it does it. */
export const describeSellBatch = (p: SellBatchPlan): string => {
  const bits = [`${p.sellable.length} device${p.sellable.length === 1 ? '' : 's'} to the cart`];
  if (p.blocked.length) bits.push(`${p.blocked.length} not sent`);
  return bits.join(' · ');
};
