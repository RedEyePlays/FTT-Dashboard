import { InventoryItem } from '../types';

/**
 * A FLOOR PRICE, WITHOUT TELLING STAFF WHAT THE FLOOR IS.
 *
 * Staff can't see cost (deliberately), so nothing stopped them selling a
 * device below what the shop paid for it. This computes the minimum a device
 * may go out at, and the warning is written so that somebody without cost
 * access learns only "too low" — never the floor, the cost, or the gap.
 *
 * IT WARNS, IT DOES NOT BLOCK: the sale completes, is stamped, and the owner
 * reviews it where he already looks each day.
 *
 * Pure: no DOM, no Firestore. The checkout and the tests use the same
 * functions, so the number that warns at the till is the number that was
 * tested.
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
 * The warning shown on the line.
 *
 * IT WARNS, IT DOES NOT BLOCK. The sale completes; the owner reviews it after
 * the fact. A manager-PIN gate was tried and removed — besides being more
 * friction than the owner wants, it verified the approver's PIN client-side
 * out of the user list, which firestore.rules does not let an employee's
 * session read. So at the one till that actually needed it the approver list
 * was always empty and a below-floor sale could never be completed at all.
 *
 * CARRIES NO FIGURE. Not the floor, not the cost, not the gap in dollars —
 * each of those is the cost back-computable in one subtraction, which would
 * undo the whole point of hiding it. Somebody WITH cost access gets the gap
 * as a separate line (belowFloorGapLabel), never folded into this sentence.
 */
export const BELOW_FLOOR_WARNING = 'Below the minimum price for this device.';

/** OWNER-FACING ONLY: "$64.00 under minimum". Never shown without cost access. */
export const belowFloorGapLabel = (gap: number | null): string | null =>
  gap == null || gap <= 0 ? null : `$${gap.toFixed(2)} under minimum`;

/** Shown to the OWNER only, on a device with no cost to check against. */
export const NO_COST_NOTE = 'No cost recorded — no minimum price check.';

/** Shown to the OWNER when a target price is set under the floor. */
export const TARGET_BELOW_FLOOR_NOTE = 'Target is under the minimum price.';

/** How far under the floor, in dollars. Null when the line is not under it. */
export const floorGap = (price: number, floor: Floor): number | null =>
  floor.price != null && isBelowFloor(price, floor)
    ? round2(floor.price - price)
    : null;

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

export interface BelowFloorSaleAudit {
  sellerUid: string;
  sellerEmail: string;
  inventoryId?: string;
  deviceLabel: string;
  salePrice: number;
  transactionId: string;
  /** OWNER-VISIBLE ONLY, and only ever in the audit record — never on screen. */
  floorPrice: number | null;
  costAtSale: number | null;
  at: number;
}

/**
 * The audit payload for a sale that went out below its floor.
 *
 * There is no approver: the sale completes and the owner reviews it after the
 * fact. The floor and the cost DO go in here — the audit log is owner-visible
 * only, and without them the record cannot answer "how far below was it?",
 * which is the only question worth asking afterwards.
 */
export const buildBelowFloorSaleAudit = (a: BelowFloorSaleAudit): Record<string, unknown> => ({
  seller: a.sellerEmail,
  sellerUid: a.sellerUid,
  device: a.deviceLabel,
  inventoryId: a.inventoryId,
  transactionId: a.transactionId,
  salePrice: round2(a.salePrice),
  floorPrice: a.floorPrice,
  costAtSale: a.costAtSale,
  shortfall: a.floorPrice != null ? round2(a.floorPrice - a.salePrice) : null,
  at: a.at,
});


/* ---------------- What gets recorded on the sale ---------------- */

/**
 * A sale line that went out under its floor.
 *
 * Stamped on SalesLine.belowFloor at checkout so the owner can find it later
 * without recomputing anything — the floor depends on settings and on the
 * device's cost, both of which can change afterwards, so a figure recomputed
 * next week would not be the figure that applied on the day.
 */
export interface BelowFloorStamp {
  belowFloor: true;
  /** The floor that applied at the moment of sale. Owner-visible only. */
  floorAtSale?: number;
  /** The cost that floor came from. Owner-visible only. */
  costAtSale?: number;
}

export const belowFloorStamp = (price: number, floor: Floor): BelowFloorStamp | null =>
  isBelowFloor(price, floor)
    ? {
      belowFloor: true,
      ...(floor.price != null ? { floorAtSale: floor.price } : {}),
      ...(floor.cost != null ? { costAtSale: floor.cost } : {}),
    }
    : null;

/* ---------------- The review list ---------------- */

export interface BelowFloorSaleRow {
  transactionId: string;
  date: string;
  at?: number;
  lineIndex: number;
  device: string;
  /** Who rang it. Visible to managers as well as owners. */
  seller?: string;
  salePrice: number;
  /** OWNER / allowProfit ONLY — stripped for a manager by trimBelowFloorRow. */
  floorAtSale?: number;
  costAtSale?: number;
  gap?: number;
}

interface SaleLike {
  id: string;
  date: string;
  createdAt?: number;
  status?: string;
  soldByEmail?: string;
  customerName?: string;
  lines?: {
    name?: string;
    unitPrice?: number;
    quantity?: number;
    belowFloor?: boolean;
    floorAtSale?: number;
    costAtSale?: number;
  }[];
}

/**
 * Every sale line that went out below its minimum, newest first.
 *
 * Reads the STAMP on the line rather than recomputing: the floor depends on
 * settings and on the device's cost, and both can change after the sale. A
 * recomputed figure would quietly restate history.
 *
 * Voided and returned sales are excluded — the device came back, so there is
 * no discount to review.
 */
export const belowFloorSales = <T extends SaleLike>(
  sales: T[],
  range?: { start?: string; end?: string },
): BelowFloorSaleRow[] => {
  const rows: BelowFloorSaleRow[] = [];
  for (const t of sales) {
    if (t.status === 'voided' || t.status === 'returned') continue;
    if (range?.start && t.date < range.start) continue;
    if (range?.end && t.date > range.end) continue;
    (t.lines || []).forEach((l, lineIndex) => {
      if (!l.belowFloor) return;
      const salePrice = round2(l.unitPrice || 0);
      rows.push({
        transactionId: t.id,
        date: t.date,
        at: t.createdAt,
        lineIndex,
        device: l.name || 'Device',
        seller: t.soldByEmail,
        salePrice,
        ...(l.floorAtSale != null ? { floorAtSale: l.floorAtSale, gap: round2(l.floorAtSale - salePrice) } : {}),
        ...(l.costAtSale != null ? { costAtSale: l.costAtSale } : {}),
      });
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0));
};

/** How many below-minimum sale lines fall on one date. */
export const belowFloorCountForDate = <T extends SaleLike>(sales: T[], date: string): number =>
  belowFloorSales(sales, { start: date, end: date }).length;

/** "2 sales below minimum" / "1 sale below minimum". Null when there are none. */
export const belowFloorCountLabel = (n: number): string | null =>
  n <= 0 ? null : `${n} sale${n === 1 ? '' : 's'} below minimum`;

/**
 * Trim a row for somebody without cost access.
 *
 * A MANAGER SEES WHO IS DISCOUNTING WITHOUT LEARNING WHAT THE SHOP PAYS: the
 * date, the seller, the device and the price stay; the floor, the cost and the
 * gap are REMOVED from the object, not merely hidden by the table, so an
 * export cannot leak what the screen withholds.
 */
export const trimBelowFloorRow = (
  row: BelowFloorSaleRow,
  canViewCost: boolean,
): BelowFloorSaleRow => {
  if (canViewCost) return row;
  const { floorAtSale: _f, costAtSale: _c, gap: _g, ...rest } = row;
  return rest;
};

export const trimBelowFloorRows = (
  rows: BelowFloorSaleRow[],
  canViewCost: boolean,
): BelowFloorSaleRow[] => rows.map(r => trimBelowFloorRow(r, canViewCost));
