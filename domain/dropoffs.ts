import { DropOff, Settlement, SettlementFeeDirection, SettlementLineAdjustment, SettlementPaymentMethod } from '../types';

const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

// Pure money math for the device buyer drop-off flow — no Firebase/React imports so it
// can be unit-tested, matching domain/pos.ts, domain/repairs.ts, etc. The device buyer
// balance and settlement totals were previously defined inline in DropOffView;
// the device acquisition-cost calc lived (buggily) inline in App.tsx.

export interface DeviceBuyerBalance {
  cashFronted: number; // cash the device buyer fronted to sellers (drop-offs paidBy 'runner')
  feesOwed: number;    // drop-off commission owed to the device buyer
  net: number;         // total owed to the device buyer (positive = store owes device buyer)
  count: number;       // number of active drop-offs counted
}

// Balance owed to a device buyer: the cash they fronted to sellers (paidBy 'runner')
// plus the fees owed, across drop-offs that are neither rejected nor already
// settled. Store-paid devices don't add to what we owe the device buyer (only the fee
// does).
export function deviceBuyerBalance(buyerId: string, dropOffs: DropOff[]): DeviceBuyerBalance {
  const active = dropOffs.filter(d =>
    d.buyerId === buyerId && d.status !== 'rejected' && d.status !== 'settled'
  );
  const cashFronted = active.filter(d => d.paidBy === 'runner').reduce((s, d) => s + (d.purchasePrice || 0), 0);
  const feesOwed = active.reduce((s, d) => s + (d.dropOffFee || 0), 0);
  return { cashFronted, feesOwed, net: cashFronted + feesOwed, count: active.length };
}

// Drop-offs eligible to be rolled into a settlement for a device buyer: accepted or
// paid-out, and not yet settled/rejected.
export function settleableDropOffs(buyerId: string, dropOffs: DropOff[]): DropOff[] {
  return dropOffs.filter(d =>
    d.buyerId === buyerId && (d.status === 'accepted' || d.status === 'paidout')
  );
}

export interface SettlementTotals {
  cashFronted: number; // fronted cash to reimburse (paidBy 'runner')
  totalFees: number;   // all drop-off fees in the set
  amountToPay: number; // cashFronted + totalFees
}

// Amount to pay a device buyer for a set of drop-offs: reimburse the cash they fronted
// (paidBy 'runner') plus every drop-off fee.
export function settlementTotals(dropOffs: DropOff[]): SettlementTotals {
  const cashFronted = dropOffs.filter(d => d.paidBy === 'runner').reduce((s, d) => s + (d.purchasePrice || 0), 0);
  const totalFees = dropOffs.reduce((s, d) => s + (d.dropOffFee || 0), 0);
  return { cashFronted, totalFees, amountToPay: cashFronted + totalFees };
}

// Acquisition cost of a device sourced via a drop-off: what was paid to the
// seller PLUS the device buyer's commission — both are real costs of acquiring it, and
// both are what the settlement pays the device buyer. (Previously purchaseCost dropped
// the fee, overstating resale Net Profit by exactly the fee.)
export function dropOffPurchaseCost(d: Pick<DropOff, 'purchasePrice' | 'dropOffFee'>): number {
  return (d.purchasePrice || 0) + (d.dropOffFee || 0);
}

// Shared shape for "this money action moved cash in the till, log it as this
// kind/amount" — returned by every drawer-affecting decision below.
//
// IMPORTANT: any NEW action that hands cash to/from someone outside a normal
// POS sale (a settlement, a drop-off purchase, a refund, ...) must decide its
// drawer effect through a function here (returning DrawerEffect | null) and
// have its App.tsx handler write that effect via commitDrawerRecord — the same
// two-step every effect below follows. A handler that skips this is a missing
// drawer entry, which is exactly the store-paid-drop-off bug this file's
// dropOffAcceptDrawerEffect was added to fix: the cash really left the till,
// but nothing ever told the reconciliation screen.
export interface DrawerEffect { kind: 'cashOut' | 'cashIn'; amount: number }

// A completed settlement's effect on today's cash drawer — the ONE place that
// decides whether paying a device buyer touches the till. Only 'cash' ever does;
// e-transfer/other never do, no matter the amount. A settlement predating this
// field (paymentMethod absent) defaults to 'cash', matching how every
// settlement was implicitly treated before payment method was tracked.
// amountPaid > 0 (store owes device buyer) is cash OUT of the drawer; a negative
// amountPaid (device buyer owed the store) is cash IN. Zero/near-zero produces no
// entry at all.
export function settlementDrawerEffect(settlement: Pick<Settlement, 'paymentMethod' | 'amountPaid'>): DrawerEffect | null {
  const method = settlement.paymentMethod || 'cash';
  if (method !== 'cash') return null;
  const amount = round2(settlement.amountPaid || 0);
  if (Math.abs(amount) < 0.005) return null;
  return amount > 0 ? { kind: 'cashOut', amount } : { kind: 'cashIn', amount: -amount };
}

// A drop-off's effect on today's cash drawer at the moment it's accepted
// (pending → accepted) — the ONE place that decides whether accepting a
// drop-off touches the till. Only a store-paid purchase does: that's the shop
// handing cash to the seller directly, right now. A buyer-paid drop-off never
// touches the drawer here — that was the device buyer's own cash, fronted on the
// store's behalf and reimbursed later (as a lump sum, alongside the fee) via
// settlementDrawerEffect when the device buyer is settled, not at acceptance.
//
// The caller is responsible for only invoking this on the actual pending→
// accepted transition (not on every save of an already-accepted drop-off) so
// the purchase is never logged to the drawer twice.
export function dropOffAcceptDrawerEffect(d: Pick<DropOff, 'paidBy' | 'purchasePrice'>): DrawerEffect | null {
  if (d.paidBy !== 'store') return null;
  const amount = round2(d.purchasePrice || 0);
  if (amount < 0.005) return null;
  return { kind: 'cashOut', amount };
}

/* ---------------- Pre-settlement review (editable) ---------------- */
//
// The review screen lets the owner correct a per-device fee or exclude a
// device from THIS settlement run before anything is written. All of that
// state lives here as pure data/functions so it's fully unit-testable
// without a component — components/SettlementReviewModal.tsx and
// DropOffView.tsx's SettlementTab just hold this shape in React state and
// call these functions to total it up / build the final record.

// One line on the review screen: whether it's still included in this
// settlement, and the fee actually being paid for it (may differ from the
// drop-off's stored dropOffFee if edited on this screen).
export interface SettlementReviewLine {
  dropOffId: string;
  included: boolean;
  fee: number;
}

// Seed one review line per settleable drop-off, unedited (fee = its stored
// dropOffFee, included = true) — the natural starting point before any
// review-screen edits or exclusions.
export function initSettlementReview(dropOffs: DropOff[]): SettlementReviewLine[] {
  return dropOffs.map(d => ({ dropOffId: d.id, included: true, fee: round2(d.dropOffFee || 0) }));
}

export interface SettlementReviewTotals {
  deviceCount: number;    // included lines only
  cashFronted: number;    // purchasePrice of included, paidBy 'runner' lines
  totalFees: number;      // sum of included lines' (possibly-edited) fee
  subtotal: number;       // cashFronted + totalFees
  adjustmentAmount: number;
  netAmount: number;      // subtotal + adjustmentAmount — what settlementDrawerEffect/Settlement.amountPaid uses
}

// Recompute every total live from the current review state — called on every
// edit so the screen never shows a stale number. `adjustmentAmount` is the
// settlement-level correction (positive = more owed to the device buyer, negative
// = less), independent of any per-line fee edit.
export function settlementReviewTotals(
  dropOffs: DropOff[],
  lines: SettlementReviewLine[],
  adjustmentAmount: number,
): SettlementReviewTotals {
  const byId = new Map(dropOffs.map(d => [d.id, d]));
  let cashFronted = 0;
  let totalFees = 0;
  let deviceCount = 0;
  for (const l of lines) {
    if (!l.included) continue;
    const d = byId.get(l.dropOffId);
    if (!d) continue;
    deviceCount += 1;
    if (d.paidBy === 'runner') cashFronted += d.purchasePrice || 0;
    totalFees += l.fee || 0;
  }
  cashFronted = round2(cashFronted);
  totalFees = round2(totalFees);
  const adj = round2(adjustmentAmount || 0);
  const subtotal = round2(cashFronted + totalFees);
  return { deviceCount, cashFronted, totalFees, subtotal, adjustmentAmount: adj, netAmount: round2(subtotal + adj) };
}

// Which per-device fee edits actually happened — only lines still included
// AND whose fee differs from the drop-off's original stored dropOffFee.
// Excluding a line, or leaving its fee untouched, produces no adjustment
// entry for it (nothing to disclose that wasn't already true).
export function buildLineAdjustments(dropOffs: DropOff[], lines: SettlementReviewLine[]): SettlementLineAdjustment[] {
  const byId = new Map(dropOffs.map(d => [d.id, d]));
  const out: SettlementLineAdjustment[] = [];
  for (const l of lines) {
    if (!l.included) continue;
    const d = byId.get(l.dropOffId);
    if (!d) continue;
    const originalFee = round2(d.dropOffFee || 0);
    const adjustedFee = round2(l.fee || 0);
    if (originalFee !== adjustedFee) out.push({ dropOffId: l.dropOffId, originalFee, adjustedFee });
  }
  return out;
}

// The net-amount direction of a settlement. Deliberately UNIFIED with
// SettlementFeeDirection (types.ts): the two non-even members are exactly that
// type, so a settlement's cash direction and its fee direction are described in
// one vocabulary instead of two overlapping ones. 'even' exists only here —
// a fee always flows one way or the other, but a net amount can land at zero.
export type SettlementDirection = SettlementFeeDirection | 'even';

// Zero (to the cent) reads as neither direction — a settlement that landed
// exactly even shouldn't be described as "the store pays the device buyer $0.00",
// which is technically true but misleading on a printed page.
export function settlementDirection(netAmount: number): SettlementDirection {
  if (netAmount > 0.004) return 'store_pays_buyer';
  if (netAmount < -0.004) return 'buyer_owes_store';
  return 'even';
}

// Plain-words statement of the net amount's direction — this is what goes on
// the printed breakdown so there's no ambiguity on paper about who owes whom.
export function settlementDirectionLabel(netAmount: number, direction: SettlementDirection = settlementDirection(netAmount)): string {
  const amt = money2(Math.abs(netAmount));
  if (direction === 'store_pays_buyer') return `Store pays device buyer ${amt}`;
  if (direction === 'buyer_owes_store') return `Device buyer owes store ${amt}`;
  return 'Settled even — no balance either way';
}

/* ---------------- Fee direction (who owes the fee to whom) ---------------- */
//
// The drop-off fee does NOT always flow from the store to the device buyer. In
// this shop the buyer frequently owes the STORE a fee for handling/reselling
// the device, which makes that fee INCOME, not an expense. Both arrangements
// are real and can differ per buyer and per settlement, so the direction is
// recorded per settlement rather than assumed globally.
//
// NOTE the cash side (settlementDrawerEffect above) was already correct and is
// deliberately untouched: a negative amountPaid is already treated as cash IN.
// Only the P&L attribution in domain/reports.ts was wrong.

/**
 * The fee direction for one settlement.
 *
 * New settlements carry an explicit `feeDirection` (set by
 * buildSettlementFromReview) and that always wins. Historical settlements
 * predate the field, so their direction is DERIVED from the sign of
 * `amountPaid`:
 *   • amountPaid < 0  → the buyer owed the store money  → 'buyer_owes_store'
 *   • otherwise (incl. exactly 0) → 'store_pays_buyer'
 *
 * This is safe without a data migration because the sign of amountPaid is
 * already the established, trusted source of truth for direction on the cash
 * side — settlementDrawerEffect has always used it to decide cash-in vs
 * cash-out, so every historical record's sign was written correctly. Zero nets
 * resolve to 'store_pays_buyer', which is harmless: a zero-net settlement
 * contributes 0 to either bucket. Same no-migration-fallback pattern as
 * RepairBatch.private falling back to the legacy `autoInventory` field.
 */
export function settlementFeeDirection(
  s: Pick<Settlement, 'feeDirection' | 'amountPaid'>,
): SettlementFeeDirection {
  if (s.feeDirection) return s.feeDirection;
  return (s.amountPaid || 0) < 0 ? 'buyer_owes_store' : 'store_pays_buyer';
}

export interface SettlementFeeTotals {
  feesCollected: number;   // Σ totalFees where the buyer owed the store — INCOME
  feesPaid: number;        // Σ totalFees where the store paid the buyer — EXPENSE
  netContribution: number; // feesCollected − feesPaid; add this to net profit
}

/**
 * Split a set of settlements' fees by direction. `netContribution` is what
 * domain/reports.ts ADDS to net profit — collected fees raise profit, paid fees
 * lower it. Never sum totalFees unconditionally; that was the bug this fixes.
 */
export function settlementFeeTotals(settlements: Settlement[]): SettlementFeeTotals {
  let feesCollected = 0, feesPaid = 0;
  for (const s of settlements) {
    const fee = s.totalFees || 0;
    if (settlementFeeDirection(s) === 'buyer_owes_store') feesCollected += fee;
    else feesPaid += fee;
  }
  feesCollected = round2(feesCollected);
  feesPaid = round2(feesPaid);
  return { feesCollected, feesPaid, netContribution: round2(feesCollected - feesPaid) };
}

/* ---------------- Legacy field normalization ---------------- */

/**
 * Backfill `buyerId` from a legacy `runnerId` on a raw Firestore record.
 *
 * The Runner→Device Buyer rename deliberately did NOT migrate stored documents
 * (see types.ts's DropOff.buyerId). Instead every DropOff/Settlement is
 * normalized once, at the single point where Firestore data enters the app
 * (hooks/useWorkspaceData.ts), so nothing downstream ever has to know the
 * legacy name. `raw` is intentionally loosely typed — subscribeCollection
 * already reads document data as `any` — which keeps the exported DropOff /
 * Settlement interfaces free of a deprecated `runnerId?` field while still
 * tolerating legacy documents at the boundary.
 *
 * An explicit `buyerId` always wins; `runnerId` is only ever a fallback, and
 * new code never writes it.
 */
export function withResolvedBuyerId<T extends { buyerId: string }>(raw: any): T {
  if (raw && !raw.buyerId && raw.runnerId) return { ...raw, buyerId: raw.runnerId } as T;
  return raw as T;
}

const money2 = (n: number): string => `$${n.toFixed(2)}`;

// Assemble the final Settlement record from the reviewed state — the ONE
// place that turns review-screen edits into what actually gets saved, so the
// pre-commit print preview and the post-commit save can never disagree.
export function buildSettlementFromReview(
  base: { id: string; buyerId: string; date: string; paymentMethod: SettlementPaymentMethod; notes: string },
  dropOffs: DropOff[],
  lines: SettlementReviewLine[],
  adjustmentAmount: number,
  adjustmentNote: string,
): Settlement {
  const totals = settlementReviewTotals(dropOffs, lines, adjustmentAmount);
  const lineAdjustments = buildLineAdjustments(dropOffs, lines);
  const trimmedNote = (adjustmentNote || '').trim();
  // Record the fee direction EXPLICITLY on every new settlement, derived from
  // the same net amount the printed invoice and the drawer effect use, so the
  // P&L never has to guess. (Only pre-existing records fall back to deriving it
  // from the sign of amountPaid — see settlementFeeDirection.) A settlement
  // that lands exactly even is recorded as 'store_pays_buyer'; it contributes
  // zero either way, so the choice is cosmetic.
  const feeDirection: SettlementFeeDirection =
    totals.netAmount < 0 ? 'buyer_owes_store' : 'store_pays_buyer';
  return {
    ...base,
    dropOffIds: lines.filter(l => l.included).map(l => l.dropOffId),
    totalPurchaseFronted: totals.cashFronted,
    totalFees: totals.totalFees,
    amountPaid: totals.netAmount,
    feeDirection,
    lineAdjustments: lineAdjustments.length ? lineAdjustments : undefined,
    adjustmentAmount: Math.abs(totals.adjustmentAmount) >= 0.005 ? totals.adjustmentAmount : undefined,
    adjustmentNote: trimmedNote || undefined,
  };
}
