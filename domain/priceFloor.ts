import { InventoryItem } from '../types';

/**
 * A FLOOR PRICE, WITHOUT TELLING STAFF WHAT THE FLOOR IS.
 *
 * Staff can't see cost (deliberately), so nothing stopped them selling a
 * device below what the shop paid for it. This computes the minimum a device
 * may go out at, and the block message is written so that somebody without
 * cost access learns only "too low" — never the floor, the cost, or the gap.
 *
 * Pure: no DOM, no Firestore. The checkout and the tests use the same
 * functions, so the number that blocks a sale is the number that was tested.
 */

export interface FloorSettings {
  /** e.g. 10 → the device must sell for at least cost + 10%. */
  minMarginPercent?: number;
  /** e.g. 25 → the device must sell for at least cost + $25. */
  minMarginDollars?: number;
}

export interface Floor {
  /** The minimum price, or null when there is no floor at all. */
  price: number | null;
  /** Total cost the floor was derived from. Null when nothing is recorded. */
  cost: number | null;
  /**
   * Why there is no floor. 'no_cost' is the interesting one: it is the gap
   * that write-only cost entry exists to shrink.
   */
  reason?: 'no_cost' | 'not_configured';
  /** True when the floor came from the device's own override. */
  fromOverride?: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A device's recorded cost, or null when nothing has been recorded. */
export const recordedCost = (
  item: Pick<InventoryItem, 'purchaseCost' | 'repairCost'>,
): number | null => {
  const purchase = item.purchaseCost || 0;
  const repair = item.repairCost || 0;
  // Nothing recorded at all — NOT a cost of zero. Every row is created with
  // these defaulted to 0, so treating that as "this device was free" would
  // give it a floor of $0 and quietly make the check meaningless.
  if (purchase <= 0 && repair <= 0) return null;
  return round2(purchase + repair);
};

/**
 * The floor for one device.
 *
 * Both settings may be set; the floor is the HIGHER of the two, because each
 * expresses a different worry — a percentage protects a proportion on an
 * expensive phone, a flat amount protects the handling on a cheap one, and
 * taking the lower would defeat whichever one mattered.
 *
 * A per-device `minSalePrice` (owner-only) overrides both outright: it exists
 * for the phone that needs its own answer, so a computed floor must not
 * quietly raise it.
 *
 * NO RECORDED COST MEANS NO FLOOR. Guessing one from the sale price would
 * invent a number and block sales on a fiction.
 */
export const floorFor = (
  item: Pick<InventoryItem, 'purchaseCost' | 'repairCost' | 'minSalePrice'>,
  settings: FloorSettings = {},
): Floor => {
  const cost = recordedCost(item);

  if (typeof item.minSalePrice === 'number' && item.minSalePrice > 0) {
    return { price: round2(item.minSalePrice), cost, fromOverride: true };
  }
  if (cost == null) return { price: null, cost: null, reason: 'no_cost' };

  const pct = settings.minMarginPercent;
  const dollars = settings.minMarginDollars;
  const hasPct = typeof pct === 'number' && pct > 0;
  const hasDollars = typeof dollars === 'number' && dollars > 0;
  if (!hasPct && !hasDollars) return { price: null, cost, reason: 'not_configured' };

  const byPct = hasPct ? cost * (1 + pct / 100) : 0;
  const byDollars = hasDollars ? cost + dollars : 0;
  return { price: round2(Math.max(byPct, byDollars)), cost };
};

/** Is this line's price (after discount) below the device's floor? */
export const isBelowFloor = (price: number, floor: Floor): boolean =>
  floor.price != null && round2(price) < floor.price - 0.005;

/* ---------------- What the till says ---------------- */

/**
 * The block message.
 *
 * CARRIES NO FIGURE. Not the floor, not the cost, not the gap in dollars —
 * each of those is the cost back-computable in one subtraction, which would
 * undo the whole point of hiding it. The same sentence is shown to everyone,
 * so a seller cannot tell from the wording whether the person beside them can
 * see more than they can.
 */
export const BELOW_FLOOR_MESSAGE =
  'Below the minimum price for this device. A manager or owner needs to approve it.';

/** Shown to the OWNER only, on a device with no cost to check against. */
export const NO_COST_NOTE = 'No cost recorded — no minimum price check.';

/** Shown to the OWNER when a target price is set under the floor. */
export const TARGET_BELOW_FLOOR_NOTE = 'Target is under the minimum price.';

export interface FloorCheck {
  ok: boolean;
  /** True when the sale needs a manager/owner to approve it. */
  needsApproval: boolean;
  /** The sentence to show. Empty when nothing is wrong. */
  message: string;
}

/**
 * May this line go through at this price?
 *
 * `approved` is set once a manager or owner has signed off with their PIN, at
 * which point the line passes whatever the floor says — the approval IS the
 * answer, and re-blocking it would make the approval meaningless.
 */
export const checkLineFloor = (
  price: number,
  floor: Floor,
  approved = false,
): FloorCheck => {
  if (approved || !isBelowFloor(price, floor)) {
    return { ok: true, needsApproval: false, message: '' };
  }
  return { ok: false, needsApproval: true, message: BELOW_FLOOR_MESSAGE };
};

/**
 * Is a device's TARGET price under its own floor?
 *
 * A pricing mistake to fix when the device is saved, not something to discover
 * at the till with a customer waiting. Owner-facing only — it names no figure
 * here either, though the owner can see both anyway.
 */
export const targetBelowFloor = (
  item: Pick<InventoryItem, 'purchaseCost' | 'repairCost' | 'minSalePrice' | 'targetSalePrice'>,
  settings: FloorSettings = {},
): boolean => {
  const target = item.targetSalePrice || 0;
  if (target <= 0) return false;
  return isBelowFloor(target, floorFor(item, settings));
};

/* ---------------- Audit ---------------- */

export interface FloorApprovalAudit {
  sellerUid: string;
  sellerEmail: string;
  approverUid: string;
  approverEmail: string;
  inventoryId?: string;
  deviceLabel: string;
  salePrice: number;
  /** OWNER-ONLY, and only ever in the audit record — never on screen. */
  floorPrice: number | null;
  costAtApproval: number | null;
  at: number;
}

/**
 * The audit payload for a below-floor approval.
 *
 * The floor and the cost DO go in here: the audit log is owner-visible only,
 * and without them the record cannot answer "how far below was it?" — which is
 * the only question worth asking afterwards.
 */
export const buildFloorApprovalAudit = (a: FloorApprovalAudit): Record<string, unknown> => ({
  seller: a.sellerEmail,
  sellerUid: a.sellerUid,
  approver: a.approverEmail,
  approverUid: a.approverUid,
  device: a.deviceLabel,
  inventoryId: a.inventoryId,
  salePrice: round2(a.salePrice),
  floorPrice: a.floorPrice,
  costAtApproval: a.costAtApproval,
  shortfall: a.floorPrice != null ? round2(a.floorPrice - a.salePrice) : null,
  at: a.at,
});
