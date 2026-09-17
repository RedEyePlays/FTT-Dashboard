import { InventoryItem, SalesTransaction, ListingPlatform, RefundPaidFrom, RefundSplit } from '../types';
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

/**
 * One line's share of a whole-sale cost (the platform fee, or shipping),
 * apportioned by that line's share of the subtotal.
 *
 * Extracted as ONE function rather than left inline so shipping is split
 * across a multi-line cart by exactly the mechanism the platform fee
 * already uses — a second, parallel apportionment scheme is how two
 * costs on the same sale end up disagreeing about which line they belong
 * to. hooks/useCheckout.ts's checkout loop calls it for both.
 *
 * A zero subtotal (a fully discounted or free sale) apportions nothing
 * rather than dividing by zero.
 */
export const costShareForLine = (total: number, lineSubtotal: number, subtotal: number): number =>
  subtotal > 0 ? total * (lineSubtotal / subtotal) : 0;

/** The PLATFORMS entry that means "not an online sale". */
export const IN_STORE_PLATFORM = 'None / In-Store';

/**
 * Is this sale going out through an online channel?
 *
 * Gates the shipping-cost field, so the overwhelmingly common in-store
 * sale never sees it and the checkout screen doesn't gain a box that
 * is empty on almost every transaction. Same reasoning the Fee % field
 * already follows — it only means anything once a platform is chosen.
 */
export const isOnlineSale = (platformName?: string): boolean =>
  !!platformName && platformName !== IN_STORE_PLATFORM;

/**
 * Whether tax applies to a sale, given its payment method and each payment
 * method's own "was tax charged" choice (see CartSaleView/MobileCheckout's
 * Cash Sale Tax Status / E-Transfer Sale Tax Status controls). Only cash and
 * e-transfer sales have that explicit toggle — 'none' turns tax off for that
 * one sale; card sales and mixed sales (which have their own explicit Tax
 * Collected field) always have tax apply.
 */
export const taxAppliesForSale = (
  paymentMethod: 'cash' | 'card' | 'mixed' | 'etransfer' | undefined,
  cashTaxStatus: 'none' | 'separate' | 'included',
  etransferTaxStatus: 'none' | 'separate',
): boolean => !(
  (paymentMethod === 'cash' && cashTaxStatus === 'none') ||
  (paymentMethod === 'etransfer' && etransferTaxStatus === 'none')
);
// NOTE: a MIXED sale stays `true` here even when its cash half is taken
// untaxed, and that is correct — tax genuinely does apply to the
// non-cash part of the sale. "How much" is mixedSaleTax's job below;
// this predicate only answers "is this sale taxed at all".

/**
 * Tax on a MIXED sale where the cash half is taken untaxed.
 *
 * The real-world case this exists for: the customer pays part cash and
 * part card, the shop charges tax on the card portion and not on the
 * cash. Until now there was no way to say that — the mixed branch just
 * read a hand-typed "Tax Collected" box, so the cashier had to work the
 * figure out themselves, and the totals row still labelled the result
 * "Tax (13%)" even though it was 13% of only part of the sale.
 *
 * The model, matching how the till actually works: CASH IS A PAYMENT
 * TOWARD THE GOODS, tax-free. Whatever goods value the cash doesn't
 * cover is taxed at the normal rate.
 *
 *   $1000 of goods, $500 cash → $500 still taxable → $65 at 13%,
 *   so the card side collects $565 and the sale totals $1065.
 *
 * `cashTaxed` true means the shop IS charging tax on the cash too, so
 * the whole taxable base is taxed and the cash portion is irrelevant —
 * the ordinary calculation.
 *
 * Clamped at 0: cash exceeding the taxable base (a cash-heavy split, or
 * a cart of non-taxable lines) leaves nothing to tax, never a negative.
 */
export function mixedSaleTax(input: {
  taxableBase: number;
  cashAmount: number;
  taxRate: number;
  cashTaxed: boolean;
}): number {
  const base = Math.max(0, input.taxableBase || 0);
  const taxedGoods = input.cashTaxed ? base : Math.max(0, base - Math.max(0, input.cashAmount || 0));
  return taxedGoods * (Math.max(0, input.taxRate || 0) / 100);
}

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

// Device listedPlatforms snapshots captured at sale time (SalesLine.listedPlatforms,
// set by hooks/useCheckout.ts before the live field is cleared) — keyed by
// inventoryId. voidSale/returnSale use this to restore the flag on reversal
// instead of leaving it cleared, so a device that was flagged listed elsewhere
// when it sold doesn't silently lose that fact if the sale is undone.
export const saleDeviceListedPlatforms = (tx: Pick<SalesTransaction, 'lines'>): Map<string, ListingPlatform[] | undefined> => {
  const byId = new Map<string, ListingPlatform[] | undefined>();
  for (const l of tx.lines) {
    if (l.kind === 'device' && l.inventoryId) byId.set(l.inventoryId, l.listedPlatforms);
  }
  return byId;
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

/**
 * A mixed-payment sale's cash + card + e-transfer amounts must sum to what's
 * actually being collected right now (the deposit for a layaway, the full
 * total otherwise) — an unvalidated mismatch silently corrupts the drawer's
 * expected-cash calculation later, since `cashAmount` flows straight into it.
 * Amounts are clamped to non-negative (a stray "-" typo shouldn't cancel out
 * the mismatch) and compared to the cent.
 */
export function mixedPaymentMismatch(
  parts: { cash?: number; card?: number; etransfer?: number },
  collected: number,
): boolean {
  const sum = Math.max(0, parts.cash || 0) + Math.max(0, parts.card || 0) + Math.max(0, parts.etransfer || 0);
  return Math.round(sum * 100) !== Math.round((collected || 0) * 100);
}

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
 * hand back. A fully-paid sale (never a layaway, or a layaway since paid off)
 * took the whole total; an open layaway took its original deposit PLUS
 * whatever balance payments have landed since (domain/layaway.ts's
 * applyBalancePayment — `deposit` itself stays frozen at the original
 * checkout amount, so those payments have to be added back in here or a
 * cancellation after a partial balance payment would under-refund).
 */
export const collectedOnSale = (tx: Pick<SalesTransaction, 'totalPaid' | 'deposit' | 'balanceOwing' | 'balancePayments'>): number => {
  if (!isLayaway(tx)) return tx.totalPaid || 0;
  const paymentsSoFar = (tx.balancePayments || []).reduce((s, p) => s + (p.amount || 0), 0);
  return Math.round(((tx.deposit || 0) + paymentsSoFar) * 100) / 100;
};

/**
 * The CASH portion of what was actually collected at ORIGINAL checkout: a
 * cash sale → the whole collected amount; a mixed sale → its recorded cash
 * portion; card/e-transfer → nothing. Each later balance payment can have
 * its own independent payment method, so its cash portion is added
 * separately below rather than assumed to follow the original sale's method.
 */
const cashCollectedAtCheckout = (
  tx: Pick<SalesTransaction, 'totalPaid' | 'deposit' | 'balanceOwing' | 'paymentMethod' | 'cashAmount'>,
): number => {
  const collected = isLayaway(tx) ? (tx.deposit || 0) : (tx.totalPaid || 0);
  if (collected <= 0) return 0;
  if (tx.paymentMethod === 'cash') return Math.round(collected * 100) / 100;
  if (tx.paymentMethod === 'mixed') return Math.round(Math.max(0, tx.cashAmount || 0) * 100) / 100;
  return 0; // card / etransfer / unset
};

/** The cash portion of one balance payment — same contract as above, applied
 * to that payment's own method rather than the original sale's. */
const cashPortionOfBalancePayment = (p: { paymentMethod: string; amount: number; cashAmount?: number }): number => {
  if (p.paymentMethod === 'cash') return Math.round((p.amount || 0) * 100) / 100;
  if (p.paymentMethod === 'mixed') return Math.round(Math.max(0, p.cashAmount || 0) * 100) / 100;
  return 0;
};

/**
 * The total CASH portion of everything collected on a sale so far — the most
 * cash a refund can ever hand back. Sums the original checkout's cash portion
 * with every balance payment's own cash portion (each may have used a
 * different method), so cancelling a layaway after a partial cash balance
 * payment refunds that cash too, not just the original deposit's.
 */
export const cashCollectedOnSale = (
  tx: Pick<SalesTransaction, 'totalPaid' | 'deposit' | 'balanceOwing' | 'paymentMethod' | 'cashAmount' | 'balancePayments'>,
): number => {
  const atCheckout = cashCollectedAtCheckout(tx);
  if (!isLayaway(tx)) return atCheckout;
  const fromPayments = (tx.balancePayments || []).reduce((s, p) => s + cashPortionOfBalancePayment(p), 0);
  return Math.round((atCheckout + fromPayments) * 100) / 100;
};

/* ---------------- Refund source (void / return) ---------------- */
//
// A refund used to have no recorded source. The app simply assumed the money
// went back the way it came in — the sale's cash portion always logged as a
// cash-out on today's drawer, card/e-transfer never touching it. Two real
// cases had nowhere to go: refunding out of the owner's own pocket, and
// refunding a card sale in cash from the till. Both silently left the
// drawer's expected cash wrong.
//
// Everything below is pure so each rule is testable without a component, and
// every one of them is about WHERE THE MONEY CAME FROM ONLY. A refund reduces
// sales, tax and revenue in exactly the same way no matter which source paid
// it — see domain/reports.ts, which keys off `status`, never these fields.

/** How each refund source is worded, everywhere it is shown. */
export const REFUND_PAID_FROM_LABEL: Record<RefundPaidFrom, string> = {
  store_cash: 'Store cash',
  personal: "Owner's personal cash",
  card: 'Card',
  etransfer: 'E-Transfer',
  other: 'Other',
};

/** The order the sources are offered in — till first, since it is the default. */
export const REFUND_PAID_FROM_OPTIONS: RefundPaidFrom[] =
  ['store_cash', 'personal', 'card', 'etransfer', 'other'];

const roundSplit = (n: number): number => Math.round((n || 0) * 100) / 100;

/**
 * How a refund would go back if nobody chose: the same way the sale was paid.
 * Cash → store cash, card → card, e-transfer → e-transfer. A MIXED sale is
 * split the way it was taken — its cash portion (capped at the refund) from
 * the till, the remainder back to the card.
 *
 * This is both the default the dialogs pre-select AND, via
 * impliedRefundSplits below, how every pre-existing voided/returned record
 * keeps reading. The rule is written once so the two can't diverge.
 */
export const defaultRefundSplits = (
  tx: Pick<SalesTransaction, 'totalPaid' | 'deposit' | 'balanceOwing' | 'paymentMethod' | 'cashAmount' | 'balancePayments'>,
  refundAmount: number,
): RefundSplit[] => {
  const total = roundSplit(Math.max(0, refundAmount));
  if (total < 0.005) return [];
  const method = tx.paymentMethod;
  if (method === 'card') return [{ paidFrom: 'card', amount: total }];
  if (method === 'etransfer') return [{ paidFrom: 'etransfer', amount: total }];
  if (method === 'mixed') {
    // The restocking fee (if any) comes out of the cash side first, matching
    // how the drawer effect has always been computed.
    const cash = roundSplit(Math.min(cashCollectedOnSale(tx), total));
    const rest = roundSplit(total - cash);
    const out: RefundSplit[] = [];
    if (cash >= 0.005) out.push({ paidFrom: 'store_cash', amount: cash });
    if (rest >= 0.005) out.push({ paidFrom: 'card', amount: rest });
    return out.length ? out : [{ paidFrom: 'store_cash', amount: total }];
  }
  // 'cash' and legacy/unset both mean the money came out of the till.
  return [{ paidFrom: 'store_cash', amount: total }];
};

/**
 * The refund sources to DISPLAY for an already-voided/returned sale.
 *
 * A record written since this feature carries its own `refundSplits` (or the
 * single-source `refundPaidFrom`) and is shown exactly as recorded. An older
 * record has neither — it is shown under the rule that was actually in force
 * when it was written, never as "unknown" and never migrated.
 */
export const impliedRefundSplits = (
  tx: Pick<SalesTransaction, 'status' | 'totalPaid' | 'deposit' | 'balanceOwing' | 'paymentMethod' | 'cashAmount' | 'balancePayments' | 'refundAmount' | 'refundPaidFrom' | 'refundSplits'>,
): RefundSplit[] => {
  if (tx.refundSplits?.length) return tx.refundSplits;
  const refunded = tx.status === 'returned'
    ? (tx.refundAmount ?? collectedOnSale(tx))
    : collectedOnSale(tx);
  if (tx.refundPaidFrom) {
    const amount = roundSplit(Math.max(0, refunded));
    return amount < 0.005 ? [] : [{ paidFrom: tx.refundPaidFrom, amount }];
  }
  return defaultRefundSplits(tx, refunded);
};

/** One-line wording for a set of refund sources, for the invoice/history view. */
export const refundSourceLabel = (splits: RefundSplit[]): string => {
  const real = splits.filter(s => roundSplit(s.amount) >= 0.005);
  if (!real.length) return '—';
  if (real.length === 1) return REFUND_PAID_FROM_LABEL[real[0].paidFrom];
  return real.map(s => `${REFUND_PAID_FROM_LABEL[s.paidFrom]} $${roundSplit(s.amount).toFixed(2)}`).join(' + ');
};

export interface RefundSplitValidation {
  valid: boolean;
  total: number;        // Σ of the entered amounts
  remaining: number;    // refund total − entered total (0 when it balances)
  error?: string;
}

/**
 * Do these splits actually add up to the refund?
 *
 * Deliberately the same rule as the checkout's own mixed-payment validation
 * (mixedPaymentMismatch above): amounts clamped non-negative so a stray "-"
 * can't cancel out a mismatch, and the sum compared to the target IN WHOLE
 * CENTS rather than by float equality. An unbalanced split would corrupt the
 * drawer the same way an unbalanced mixed payment does — it feeds straight
 * into the expected-cash figure.
 */
export const refundSplitsValid = (splits: RefundSplit[], refundTotal: number): RefundSplitValidation => {
  const target = roundSplit(Math.max(0, refundTotal));
  const total = roundSplit(splits.reduce((s, r) => s + Math.max(0, r.amount || 0), 0));
  const remaining = roundSplit(target - total);
  if (splits.some(s => (s.amount || 0) < -0.005)) {
    return { valid: false, total, remaining, error: 'A refund source cannot be negative.' };
  }
  if (target < 0.005) {
    // Nothing to refund (a fully-restocking-fee'd return, or a sale that
    // never collected anything) — no source is needed, and none is wrong.
    return { valid: true, total, remaining: 0 };
  }
  if (!splits.length) return { valid: false, total, remaining, error: 'Choose where the refund was paid from.' };
  if (Math.round(total * 100) !== Math.round(target * 100)) {
    return {
      valid: false, total, remaining,
      error: remaining > 0
        ? `$${remaining.toFixed(2)} of the refund is still unassigned.`
        : `$${Math.abs(remaining).toFixed(2)} more than the refund has been assigned.`,
    };
  }
  return { valid: true, total, remaining: 0 };
};

/**
 * A void/return's effect on today's cash drawer — the ONE place that decides
 * whether reversing a sale touches the till.
 *
 * ONLY the `store_cash` portion moves the drawer. 'personal' never does (the
 * owner's own money leaves no trace on the store's books, exactly as with
 * PaidBy 'personal' and domain/dropoffs.ts's dropOffAcceptDrawerEffect), and
 * card/e-transfer/other never did.
 *
 * This replaces the old saleRefundDrawerEffect, which took a bare cash amount
 * and so could only ever express the assumed rule. Always logged against the
 * day the reversal is processed (today), never retroactively against the
 * original — and likely already-reconciled — sale date.
 */
export const refundDrawerEffect = (splits: RefundSplit[]): DrawerEffect | null => {
  const amount = roundSplit(splits
    .filter(s => s.paidFrom === 'store_cash')
    .reduce((s, r) => s + Math.max(0, r.amount || 0), 0));
  if (amount < 0.005) return null;
  return { kind: 'cashOut', amount };
};

/**
 * The single-source shorthand to store alongside `refundSplits`, or undefined
 * when the refund genuinely came from more than one place.
 */
export const singleRefundSource = (splits: RefundSplit[]): RefundPaidFrom | undefined => {
  const real = splits.filter(s => roundSplit(s.amount) >= 0.005);
  return real.length === 1 ? real[0].paidFrom : undefined;
};
