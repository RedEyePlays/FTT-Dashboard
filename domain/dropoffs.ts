import { DropOff, PaidBy, Settlement, SettlementLineAdjustment, SettlementPaymentMethod } from '../types';

const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;
const money2 = (n: number): string => `$${n.toFixed(2)}`;

// Pure money math for the device buyer drop-off flow — no Firebase/React imports so it
// can be unit-tested, matching domain/pos.ts, domain/repairs.ts, etc.
//
// THE MODEL (corrected — the store FINANCES the buyer; see types.ts's PaidBy):
// the device buyer sources devices for himself and keeps them. The store never
// acquires them, never resells them, and never pays the buyer. The store either
// fronts the purchase money or it doesn't, and either way it charges a service
// fee. At settlement money flows INTO the store:
//
//   store-funded  ($100 device, $20 fee) → buyer owes $120 (principal + fee)
//   buyer-funded  ($100 device, $20 fee) → buyer owes  $20 (fee only)
//   personal-funded (owner's own cash)   → buyer owes $120, but only the $20
//                                          is store cash (see below)
//
// ONLY THE FEE IS PROFIT. The principal is a receivable being repaid — it is
// never revenue and never touches the P&L (domain/reports.ts).
//
// Principal and fee are deliberately kept as SEPARATE numbers everywhere —
// domain, UI and printed invoice. They are different money and nothing may
// re-derive one by subtracting the other from an opaque total.

// The stored PaidBy value meaning "the buyer used his own money". The literal
// is still 'runner' for legacy-data reasons (see types.ts's PaidBy); naming it
// once here keeps that legacy string out of every call site.
export const BUYER_FUNDED: PaidBy = 'runner';

// Whose cash actually funded a purchase, from the store's point of view.
// 'store' is the only one that moved the till at acceptance
// (dropOffAcceptDrawerEffect), which is why the settlement's drawer effect
// treats it differently from 'personal'.
export type PrincipalFunder = 'store' | 'personal' | 'buyer';
export function principalFunder(d: Pick<DropOff, 'paidBy'>): PrincipalFunder {
  if (d.paidBy === 'store') return 'store';
  if (d.paidBy === 'personal') return 'personal';
  return 'buyer';
}

// How a purchase was funded, in the words this app uses everywhere it shows a
// drop-off's funding: the drop-off list, the settlement review screen and the
// printed settlement invoice. Lives here, next to the model it describes, so
// the printed drop-off label can't invent its own third phrasing for
// 'personal' (the case most easily got wrong — see dropOffLabelMoney).
export const PAID_BY_LABEL: Record<PaidBy, string> = {
  runner: 'Buyer-funded (own money)', store: 'Store-funded (owed back)', personal: 'Owner-funded (owed back)',
};

/**
 * What one device's buyer owes the store for it: the principal the store (or
 * the owner) advanced, if any, plus the service fee. A buyer-funded device
 * carries no principal — he spent his own money on his own device.
 *
 * The single definition of the per-device figure the drop-off list and the
 * printed drop-off label both show, so the screen and the label can never
 * disagree about what's owed on a device.
 */
export function dropOffOwed(d: Pick<DropOff, 'paidBy' | 'purchasePrice' | 'dropOffFee'>): number {
  const principal = principalFunder(d) === 'buyer' ? 0 : (d.purchasePrice || 0);
  return round2(principal + (d.dropOffFee || 0));
}

// The money on a printed drop-off label, stated per device and unambiguously
// by funding source.
export interface DropOffLabelMoney {
  fundingLabel: string;  // PAID_BY_LABEL wording for this drop-off
  moneyLine: string;     // the one-line money statement printed on the label
  principalOwed: number; // advanced by the store/owner and owed back (0 when buyer-funded)
  feeOwed: number;
  totalOwed: number;     // principalOwed + feeOwed — matches dropOffOwed
}

/**
 * The per-device money statement for a printed drop-off label.
 *
 * Deliberately just the number the buyer owes — no funding-source wording
 * (no "Store paid"/"Buyer funded"/"Owner paid"), per the owner's explicit
 * request that the label state the bottom line only. A buyer-funded device
 * (no principal owed) prints as a bare fee, e.g. "$30.00"; a device with a
 * principal owed prints as principal+fee with a single leading $ and no
 * second $, e.g. "$250.00+20.00" — never broken down into separate labeled
 * figures. `fundingLabel`/`principalOwed`/`feeOwed`/`totalOwed` are still
 * returned for callers that need the breakdown elsewhere (the drop-off
 * screen, tests) — only the printed `moneyLine` was simplified.
 */
export function dropOffLabelMoney(
  d: Pick<DropOff, 'paidBy' | 'purchasePrice' | 'dropOffFee'>,
): DropOffLabelMoney {
  const funder = principalFunder(d);
  const fee = round2(d.dropOffFee || 0);
  const principal = funder === 'buyer' ? 0 : round2(d.purchasePrice || 0);
  const total = round2(principal + fee);
  const moneyLine = principal > 0
    ? `$${principal.toFixed(2)}+${fee.toFixed(2)}`
    : money2(fee);
  return {
    fundingLabel: PAID_BY_LABEL[d.paidBy] || PAID_BY_LABEL.store,
    moneyLine, principalOwed: principal, feeOwed: fee, totalOwed: total,
  };
}

/* ---------------- Outstanding receivable (money on the street) ---------------- */

// What a device buyer currently owes the store: everything accepted/paid-out
// and not yet settled or rejected. Split, never netted into one figure.
export interface DeviceBuyerOutstanding {
  principalStoreFunded: number;    // store cash advanced and not yet repaid
  principalPersonalFunded: number; // the owner's own cash advanced, not yet repaid
  principalOwed: number;           // both of the above — total principal the buyer owes back
  feesOwed: number;                // service fees accrued and not yet collected
  totalOwed: number;               // principalOwed + feesOwed
  count: number;                   // number of unsettled drop-offs counted
}

/**
 * Per-buyer outstanding balance — the receivable the store carries between
 * accepting a drop-off and settling it. Replaces the old `deviceBuyerBalance`,
 * which computed the exact opposite (what the STORE owed the buyer).
 *
 * Buyer-funded drop-offs contribute no principal: the buyer spent his own
 * money on his own device, so there is nothing to repay — only the fee.
 */
export function deviceBuyerOutstanding(buyerId: string, dropOffs: DropOff[]): DeviceBuyerOutstanding {
  const active = dropOffs.filter(d =>
    d.buyerId === buyerId && d.status !== 'rejected' && d.status !== 'settled'
  );
  let principalStoreFunded = 0, principalPersonalFunded = 0, feesOwed = 0;
  for (const d of active) {
    const funder = principalFunder(d);
    if (funder === 'store') principalStoreFunded += d.purchasePrice || 0;
    else if (funder === 'personal') principalPersonalFunded += d.purchasePrice || 0;
    feesOwed += d.dropOffFee || 0;
  }
  principalStoreFunded = round2(principalStoreFunded);
  principalPersonalFunded = round2(principalPersonalFunded);
  feesOwed = round2(feesOwed);
  const principalOwed = round2(principalStoreFunded + principalPersonalFunded);
  return {
    principalStoreFunded, principalPersonalFunded, principalOwed, feesOwed,
    totalOwed: round2(principalOwed + feesOwed), count: active.length,
  };
}

// Drop-offs eligible to be rolled into a settlement for a device buyer: accepted or
// paid-out, and not yet settled/rejected. A drop-off flagged 'settled' by a
// committed settlement can never come back here, which is what stops the same
// batch being settled (and collected on) twice.
export function settleableDropOffs(buyerId: string, dropOffs: DropOff[]): DropOff[] {
  return dropOffs.filter(d =>
    d.buyerId === buyerId && (d.status === 'accepted' || d.status === 'paidout')
  );
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
// settlement, and the service fee actually being charged for it (may differ
// from the drop-off's stored dropOffFee if edited on this screen).
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

// Everything the buyer owes for one settlement run, split by kind of money.
// `totalOwed` and `storeCashIn` differ only by personal-funded principal: the
// buyer owes it, but it is the OWNER's money coming back, not the till's.
export interface SettlementTotals {
  deviceCount: number;
  principalStoreFunded: number;
  principalPersonalFunded: number;
  principalOwed: number;      // principalStoreFunded + principalPersonalFunded
  feesOwed: number;           // Σ included lines' (possibly-edited) fee
  adjustmentAmount: number;   // positive = buyer owes more, negative = owes less
  totalOwed: number;          // principalOwed + feesOwed + adjustmentAmount — what the buyer pays
  storeCashIn: number;        // principalStoreFunded + feesOwed + adjustmentAmount — what the till receives
}

/**
 * Recompute every total live from the current review state — called on every
 * edit so the screen never shows a stale number.
 *
 * PERSONAL-FUNDED TREATMENT (a documented judgment call): a personal-funded
 * drop-off is treated like a store-funded one for what the BUYER owes — he
 * received store-negotiated financing and owes principal + fee back — but its
 * principal is deliberately EXCLUDED from `storeCashIn`. The owner's own cash
 * left no trace on the store's books at acceptance (dropOffAcceptDrawerEffect
 * no-ops for 'personal', and always has), so depositing that principal into
 * the till at settlement would invent store cash the store never advanced and
 * silently convert the owner's personal loan into store money. Only the fee is
 * the store's. The buyer still sees, and signs for, the full amount owed.
 */
export function settlementReviewTotals(
  dropOffs: DropOff[],
  lines: SettlementReviewLine[],
  adjustmentAmount: number,
): SettlementTotals {
  const byId = new Map(dropOffs.map(d => [d.id, d]));
  let principalStoreFunded = 0, principalPersonalFunded = 0, feesOwed = 0, deviceCount = 0;
  for (const l of lines) {
    if (!l.included) continue;
    const d = byId.get(l.dropOffId);
    if (!d) continue;
    deviceCount += 1;
    const funder = principalFunder(d);
    if (funder === 'store') principalStoreFunded += d.purchasePrice || 0;
    else if (funder === 'personal') principalPersonalFunded += d.purchasePrice || 0;
    feesOwed += l.fee || 0;
  }
  principalStoreFunded = round2(principalStoreFunded);
  principalPersonalFunded = round2(principalPersonalFunded);
  feesOwed = round2(feesOwed);
  const adj = round2(adjustmentAmount || 0);
  const principalOwed = round2(principalStoreFunded + principalPersonalFunded);
  return {
    deviceCount, principalStoreFunded, principalPersonalFunded, principalOwed, feesOwed,
    adjustmentAmount: adj,
    totalOwed: round2(principalOwed + feesOwed + adj),
    storeCashIn: round2(principalStoreFunded + feesOwed + adj),
  };
}

// What a device buyer owes for a set of drop-offs with no review edits —
// the same math the review screen runs, so the two can never drift.
export function settlementTotals(dropOffs: DropOff[]): SettlementTotals {
  return settlementReviewTotals(dropOffs, initSettlementReview(dropOffs), 0);
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

/* ---------------- Cash drawer ---------------- */

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

/**
 * A completed settlement's effect on today's cash drawer — the ONE place that
 * decides whether settling with a device buyer touches the till. Only 'cash'
 * ever does; e-transfer/other never do, no matter the amount. A settlement
 * with no paymentMethod recorded defaults to 'cash', matching how every
 * settlement was implicitly treated before that field was tracked.
 *
 * NEW (financing-model) settlements: the buyer PAYS the store, so the effect
 * is derived from `storeCashIn` — store-funded principal coming back plus the
 * service fees, but NOT personal-funded principal (that's the owner's money,
 * see settlementReviewTotals). Cash IN. It can only go the other way if a
 * settlement-level adjustment exceeds everything owed.
 *
 * LEGACY settlements (no `model`) keep their original interpretation exactly:
 * a positive amountPaid was cash OUT to the buyer, a negative one cash IN.
 * Nothing stored is reinterpreted or migrated — historical drawer entries and
 * reprints must keep saying what they always said.
 */
export function settlementDrawerEffect(
  s: Pick<Settlement, 'paymentMethod' | 'amountPaid' | 'storeCashIn' | 'model'>,
): DrawerEffect | null {
  const method = s.paymentMethod || 'cash';
  if (method !== 'cash') return null;
  if (s.model === 'financing') {
    const amount = round2(s.storeCashIn || 0);
    if (Math.abs(amount) < 0.005) return null;
    return amount > 0 ? { kind: 'cashIn', amount } : { kind: 'cashOut', amount: -amount };
  }
  const amount = round2(s.amountPaid || 0);
  if (Math.abs(amount) < 0.005) return null;
  return amount > 0 ? { kind: 'cashOut', amount } : { kind: 'cashIn', amount: -amount };
}

/**
 * A drop-off's effect on today's cash drawer at the moment it's accepted
 * (pending → accepted) — the ONE place that decides whether accepting a
 * drop-off touches the till. Only a store-funded purchase does: that's the
 * shop advancing cash for a device the BUYER keeps, and the buyer owes it back
 * (plus the fee) at settlement. A buyer-funded drop-off never touches the
 * drawer — it was the buyer's own money for his own device. A personal-funded
 * one doesn't either: that was the owner's out-of-pocket cash, which by design
 * leaves no trace on the store's books.
 *
 * The caller is responsible for only invoking this on the actual pending→
 * accepted transition (not on every save of an already-accepted drop-off) so
 * the purchase is never logged to the drawer twice.
 */
export function dropOffAcceptDrawerEffect(d: Pick<DropOff, 'paidBy' | 'purchasePrice'>): DrawerEffect | null {
  if (d.paidBy !== 'store') return null;
  const amount = round2(d.purchasePrice || 0);
  if (amount < 0.005) return null;
  return { kind: 'cashOut', amount };
}

/* ---------------- Plain-words direction ---------------- */

// Under the corrected model a settlement only ever has the buyer paying the
// store, so there is no per-settlement "direction" to record any more — the
// old feeDirection / settlementFeeDirection / settlementFeeTotals machinery is
// gone. All that remains is stating the amount in plain words.
export function settlementOwedLabel(totalOwed: number): string {
  if (totalOwed > 0.004) return `Device buyer owes store ${money2(totalOwed)}`;
  // Only reachable via a settlement-level adjustment bigger than what's owed.
  if (totalOwed < -0.004) return `Store owes device buyer ${money2(-totalOwed)}`;
  return 'Settled even — no balance either way';
}

/* ---------------- Legacy settlement rendering ---------------- */

// How a PRE-REWORK settlement read at the time it was recorded. Used only to
// re-display/reprint historical records truthfully (services/
// settlementInvoice.ts) — never for new settlements, never for the P&L.
export type LegacySettlementDirection = 'store_pays_buyer' | 'buyer_owes_store' | 'even';

export function legacySettlementDirection(amountPaid: number | undefined): LegacySettlementDirection {
  const n = amountPaid || 0;
  if (n > 0.004) return 'store_pays_buyer';
  if (n < -0.004) return 'buyer_owes_store';
  return 'even';
}

export function legacySettlementDirectionLabel(
  amountPaid: number | undefined,
  direction: LegacySettlementDirection = legacySettlementDirection(amountPaid),
): string {
  const amt = money2(Math.abs(amountPaid || 0));
  if (direction === 'store_pays_buyer') return `Store paid device buyer ${amt}`;
  if (direction === 'buyer_owes_store') return `Device buyer owed store ${amt}`;
  return 'Settled even — no balance either way';
}

// True for any settlement recorded before the financing rework. Such records
// are displayed exactly as stored and clearly labelled, never recomputed.
export function isLegacySettlement(s: Pick<Settlement, 'model'>): boolean {
  return s.model !== 'financing';
}

export const LEGACY_SETTLEMENT_NOTE =
  'Recorded under the prior model (store reimbursed the device buyer) — shown exactly as originally recorded.';

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


// Assemble the final Settlement record from the reviewed state — the ONE
// place that turns review-screen edits into what actually gets saved, so the
// pre-commit print preview and the post-commit save can never disagree.
// Always stamped `model: 'financing'`, which is how every consumer tells a
// corrected-model record from a pre-rework one. The legacy
// totalPurchaseFronted/amountPaid fields are deliberately NOT written.
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
  return {
    ...base,
    model: 'financing',
    dropOffIds: lines.filter(l => l.included).map(l => l.dropOffId),
    principalStoreFunded: totals.principalStoreFunded,
    principalPersonalFunded: totals.principalPersonalFunded,
    principalOwed: totals.principalOwed,
    totalFees: totals.feesOwed,
    amountOwed: totals.totalOwed,
    storeCashIn: totals.storeCashIn,
    lineAdjustments: lineAdjustments.length ? lineAdjustments : undefined,
    adjustmentAmount: Math.abs(totals.adjustmentAmount) >= 0.005 ? totals.adjustmentAmount : undefined,
    adjustmentNote: trimmedNote || undefined,
  };
}
