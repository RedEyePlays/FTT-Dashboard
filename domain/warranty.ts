import {
  InventoryItem, PcBuild, Repair, SalesLine, SalesTransaction,
} from '../types';
import { shiftISODate, todayISO } from './dates';
import { normalizeForLookup } from './identifierSearch';
import { queryWords, matchesWords, SearchableItem } from './itemSearch';

/**
 * THE WARRANTY THE SHOP GIVES ON WHAT IT SELLS.
 *
 * THE GAP: warranty existed only on Repair (warrantyDays / warrantyUntil /
 * isWarrantyClaim). SalesTransaction and SalesLine had nothing at all, receipts
 * had no warranty line, and there was no setting for it. The shop gives a
 * 90-day warranty on every device it sells and the system recorded none of it —
 * so when somebody came back in month two, the only record that they were
 * covered was whether anybody remembered.
 *
 * THE DATE IS LOCAL, ALWAYS. `shiftISODate` works in local calendar days
 * (domain/dates.ts). A toISOString round-trip shifts an evening sale to the
 * next day, which at a month end moves the expiry into the following month and
 * at a DST boundary can move it by a day either way. Neither is acceptable for
 * a date somebody is told over a counter.
 *
 * NOTHING IS RETRO-FITTED. A sale written before these fields existed has no
 * warranty recorded and reads as exactly that — "no warranty recorded" — rather
 * than being given one the customer was never actually promised.
 *
 * PC BUILDS USE THIS MECHANISM. There is no separate build warranty: a shelf
 * build is stamped at sale like any device, and a CUSTOMER ORDER is stamped at
 * PICKUP rather than at the deposit, so the ninety days starts when they take
 * the machine home.
 *
 * Pure: no DOM, no Firestore.
 */

const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

export const DEFAULT_DEVICE_WARRANTY_DAYS = 90;
export const DEFAULT_ACCESSORY_WARRANTY_DAYS = 0;

export interface WarrantySettings {
  deviceWarrantyDays?: number;
  accessoryWarrantyDays?: number;
}

/** The default days for a line, by kind. 0 means no warranty. */
export const defaultWarrantyDays = (
  kind: SalesLine['kind'] | 'service' | undefined,
  settings: WarrantySettings = {},
): number => {
  if (kind === 'accessory') {
    return Math.max(0, settings.accessoryWarrantyDays ?? DEFAULT_ACCESSORY_WARRANTY_DAYS);
  }
  if (kind === 'device') {
    return Math.max(0, settings.deviceWarrantyDays ?? DEFAULT_DEVICE_WARRANTY_DAYS);
  }
  // A service line (a repair checked out through the till) already carries the
  // repair's own warranty on the Repair record. Giving it a second one here
  // would mean two dates for one job.
  return 0;
};

/**
 * The last day covered, inclusive.
 *
 * Day 1 is the day of sale, so a 90-day warranty sold on the 1st runs to the
 * 90th day counting that one — `sold + (days - 1)`. Off-by-one here is the
 * difference between honouring a claim and turning somebody away, so it is
 * stated rather than implied.
 */
export const warrantyUntil = (soldDateISO: string, days: number): string | null => {
  if (!soldDateISO || !Number.isFinite(days) || days <= 0) return null;
  return shiftISODate(soldDateISO, Math.floor(days) - 1);
};

/** Is this line still covered on `today`? */
export const isCovered = (
  line: Pick<SalesLine, 'warrantyUntil'>,
  today = todayISO(),
): boolean => !!line.warrantyUntil && line.warrantyUntil >= today;

/** Days left, inclusive of today. 0 once it has expired. */
export const daysLeft = (
  line: Pick<SalesLine, 'warrantyUntil'>,
  today = todayISO(),
): number => {
  if (!line.warrantyUntil) return 0;
  const a = Date.parse(`${today}T00:00:00`);
  const b = Date.parse(`${line.warrantyUntil}T00:00:00`);
  if (!isFinite(a) || !isFinite(b) || b < a) return 0;
  // Inclusive: the last covered day still counts as one day left.
  return Math.round((b - a) / 86_400_000) + 1;
};

/**
 * "90-day warranty — covered until 2026-06-12", or the honest absence.
 *
 * Three distinct states, and they are NOT the same thing:
 *   • covered        — the line has a warranty and it has not run out;
 *   • expired        — it had one and it has;
 *   • not recorded   — it never had one (a historical sale, or a line the
 *                      seller explicitly set to "No warranty").
 */
export type WarrantyState = 'covered' | 'expired' | 'none';

export const warrantyState = (
  line: Pick<SalesLine, 'warrantyDays' | 'warrantyUntil'>,
  today = todayISO(),
): WarrantyState => {
  if (!line.warrantyUntil) return 'none';
  return line.warrantyUntil >= today ? 'covered' : 'expired';
};

export const warrantyLabel = (
  line: Pick<SalesLine, 'warrantyDays' | 'warrantyUntil'>,
  today = todayISO(),
): string => {
  const state = warrantyState(line, today);
  if (state === 'none') return 'No warranty recorded';
  const days = line.warrantyDays ?? 0;
  const prefix = days > 0 ? `${days}-day warranty` : 'Warranty';
  return state === 'covered'
    ? `${prefix} — covered until ${line.warrantyUntil}`
    : `${prefix} — expired ${line.warrantyUntil}`;
};

/* ---------------- Stamping, at checkout ---------------- */

export interface StampInput {
  soldDateISO: string;
  settings?: WarrantySettings;
  /**
   * Per-line override from the cart. `null` means the seller chose "No
   * warranty" explicitly; `undefined` means they left the default alone. The
   * two have to be distinguishable or an explicit "no" reads as "not asked".
   */
  overrideDays?: Record<number, number | null>;
  /**
   * A CUSTOMER PC ORDER: the dates are filled in at pickup, not now. The line
   * is marked so the completion step knows to stamp it.
   */
  startsAtPickup?: Record<number, boolean>;
}

/**
 * Stamp every line of a sale at checkout.
 *
 * Device lines get the workspace default; accessories get theirs (0 unless the
 * owner set one); services get none. A line whose resolved days are 0 is left
 * with NO warranty fields at all rather than `warrantyDays: 0` — absent and
 * zero would render identically but mean different things to a later reader,
 * and absent is what a historical sale looks like.
 */
export const stampWarranty = (lines: SalesLine[], input: StampInput): SalesLine[] =>
  lines.map((line, i) => {
    const override = input.overrideDays?.[i];
    const days = override === null ? 0 : override ?? defaultWarrantyDays(line.kind, input.settings);
    if (input.startsAtPickup?.[i]) {
      // Deposit taken now; the clock starts when they collect it.
      return days > 0
        ? { ...line, warrantyDays: days, warrantyStartsAtPickup: true }
        : { ...line };
    }
    if (days <= 0) return { ...line };
    const until = warrantyUntil(input.soldDateISO, days);
    return until ? { ...line, warrantyDays: days, warrantyUntil: until } : { ...line };
  });

/**
 * PICKUP — the layaway completion — is when a customer order's warranty starts.
 *
 * Called at the moment `balanceOwing` reaches 0 on a sale whose lines were
 * marked `warrantyStartsAtPickup`. Lines that already have a `warrantyUntil`
 * are left alone: stamping twice would restart a clock that was already
 * running.
 */
export const stampPickupWarranty = (
  lines: SalesLine[],
  pickupDateISO: string,
): SalesLine[] =>
  lines.map(line => {
    if (!line.warrantyStartsAtPickup || line.warrantyUntil) return line;
    const days = line.warrantyDays ?? 0;
    const until = warrantyUntil(pickupDateISO, days);
    if (!until) return line;
    const { warrantyStartsAtPickup: _done, ...rest } = line;
    return { ...rest, warrantyDays: days, warrantyUntil: until };
  });

/* ---------------- Looking a warranty up ---------------- */

export interface WarrantyHit {
  sale: SalesTransaction;
  lineIndex: number;
  line: SalesLine;
  /** What was sold, for the list. */
  what: string;
  soldOn: string;
  state: WarrantyState;
  daysLeft: number;
  /** Warranty repairs already opened against this exact line. */
  claims: Repair[];
  /** Set when the line is a PC build found via one of its part serials. */
  matchedBuild?: PcBuild;
  matchedPartName?: string;
}

export interface WarrantyLookupData {
  sales: SalesTransaction[];
  inventory: InventoryItem[];
  repairs: Repair[];
  builds?: PcBuild[];
}

const lineText = (
  t: SalesTransaction, l: SalesLine, item: InventoryItem | undefined,
): string =>
  [
    l.name, l.sku, item?.imei, item?.sku,
    t.customerName, t.customerPhone, t.customerEmail, t.id,
  ].filter(Boolean).join(' ');

/**
 * Find what somebody bought, by whatever they can tell you at the counter.
 *
 * IMEI/serial, SKU, phone number, customer name — the shared multi-word matcher
 * (domain/itemSearch.ts), so warranty lookup behaves the way every other search
 * in the app does rather than being a fifth search with its own rules.
 *
 * FOR A BUILD, ANY PART SERIAL FINDS IT. That is the case this exists for: a
 * customer turns up with a dead GPU and the number on the card, and the
 * question "is this machine covered" has to be answerable from that alone.
 */
export const warrantyLookup = (
  query: string,
  data: WarrantyLookupData,
  today = todayISO(),
): WarrantyHit[] => {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const normalized = normalizeForLookup(query);
  const invById = new Map(data.inventory.map(i => [i.id, i]));
  const buildsByInventoryId = new Map(
    (data.builds || []).filter(b => b.inventoryId).map(b => [b.inventoryId!, b]),
  );

  // A part serial → the build it belongs to. Compared with separators stripped,
  // like every other identifier in the app.
  const buildByPartSerial = new Map<string, { build: PcBuild; partName: string }>();
  for (const b of data.builds || []) {
    for (const p of b.parts || []) {
      const key = normalizeForLookup(p.serial);
      if (key) buildByPartSerial.set(key, { build: b, partName: p.name });
    }
  }
  const serialHit = normalized ? buildByPartSerial.get(normalized) : undefined;

  const hits: WarrantyHit[] = [];
  for (const sale of data.sales) {
    // A voided or returned sale carries no live warranty — the device came
    // back.
    if (sale.status === 'voided' || sale.status === 'returned') continue;
    (sale.lines || []).forEach((line, lineIndex) => {
      const item = line.inventoryId ? invById.get(line.inventoryId) : undefined;
      const build = line.inventoryId ? buildsByInventoryId.get(line.inventoryId) : undefined;

      const text = lineText(sale, line, item).toLowerCase();
      const searchable: SearchableItem = { plain: text, squashed: text.replace(/\s+/g, '') };
      const byText = matchesWords(searchable, words);
      // ...or by a part serial off the machine itself.
      const bySerial = !!serialHit && !!build && serialHit.build.id === build.id;
      if (!byText && !bySerial) return;

      hits.push({
        sale, lineIndex, line,
        what: line.name || item?.item || 'Item',
        soldOn: sale.date,
        state: warrantyState(line, today),
        daysLeft: daysLeft(line, today),
        claims: warrantyClaimsFor(data.repairs, sale.id, lineIndex),
        ...(bySerial && build ? { matchedBuild: build, matchedPartName: serialHit!.partName } : {}),
      });
    });
  }
  // Newest sale first — the machine somebody is asking about is usually the one
  // they bought most recently.
  return hits.sort((a, b) => b.soldOn.localeCompare(a.soldOn));
};

/* ---------------- Claims ---------------- */

/** Warranty repairs opened against one sale line. */
export const warrantyClaimsFor = (
  repairs: Repair[],
  saleId: string,
  lineIndex: number,
): Repair[] =>
  repairs.filter(r => r.warrantySaleId === saleId && r.warrantyLineIndex === lineIndex);

/**
 * Every warranty repair against ANY line of one sale.
 *
 * What the invoice needs: a sale is one profit figure, so the warranty work
 * charged against it is the work against all of its lines, not one of them.
 */
export const warrantyClaimsForSale = (repairs: Repair[], saleId: string): Repair[] =>
  repairs.filter(r => r.warrantySaleId === saleId);

/** Every warranty repair against one sale line, however it was linked. */
export const claimCount = (claims: Repair[]): number => claims.length;

/**
 * "3rd claim on this device — warranty cost so far $412.00".
 *
 * A PLAIN FACT, not an accusation and not a block. The third time a device
 * comes back is worth noticing, and the person on intake is the one who should
 * notice it. The DOLLAR FIGURE is cost-visible only: an employee sees the
 * count, the owner sees what it has cost.
 */
export const repeatClaimNote = (
  claims: Repair[],
  canViewCost: boolean,
  incoming = 1,
): string | null => {
  const n = claims.length + incoming;
  if (n < 3) return null;
  const ordinal = n === 3 ? '3rd' : `${n}th`;
  const base = `${ordinal} claim on this device`;
  if (!canViewCost) return `${base}.`;
  return `${base} — warranty cost so far $${warrantyCostOf(claims).toFixed(2)}.`;
};

/**
 * WHAT A WARRANTY REPAIR COST THE SHOP: parts + labour on the repair.
 *
 * `partsCost` is what the shop spent on components; `labourCost` is only
 * present on repairs that record it. Nothing is estimated — a repair with
 * neither recorded costs as 0 rather than being guessed at.
 */
export const warrantyCostOf = (claims: Repair[]): number =>
  round2(claims.reduce(
    (n, r) => n + (r.partsCost || 0) + ((r as { labourCost?: number }).labourCost || 0),
    0,
  ));

/**
 * "Profit after warranty work" on a sale.
 *
 * The sale booked a profit; a warranty repair against it is money spent on a
 * sale already closed. Showing both lets the owner see what a machine really
 * earned rather than what it appeared to on the day.
 */
export const profitAfterWarranty = (
  sale: Pick<SalesTransaction, 'netProfit'>,
  claims: Repair[],
): { booked: number; warrantyCost: number; after: number } => {
  const warrantyCost = warrantyCostOf(claims);
  const booked = round2(sale.netProfit || 0);
  return { booked, warrantyCost, after: round2(booked - warrantyCost) };
};

/* ---------------- Warranty cost in the P&L ---------------- */

/**
 * Warranty repair cost falling in a date range, dated by COMPLETION.
 *
 * DATED WHEN THE WORK WAS DONE, never backdated into the original sale's month.
 * A machine sold in March and repaired under warranty in June cost the shop
 * money in June; moving it back to March would restate a month that has been
 * closed, reported and probably filed.
 *
 * ONE PATH IS AUTHORITATIVE. A warranty repair is a repair, and a repair's
 * parts cost already reaches the P&L through the repairs path. So this figure
 * is REPORTING ONLY — it is shown so the owner can see what warranties cost,
 * and it is NOT subtracted again in profitAndLoss. Counting it twice is the
 * failure this note exists to prevent.
 */
export interface WarrantyCostRow {
  repairId: string;
  repairNumber?: string;
  completedOn: string;
  cost: number;
  saleId?: string;
}

export const warrantyCostRows = (
  repairs: Repair[],
  start: string,
  end: string,
): WarrantyCostRow[] => {
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return repairs
    .filter(r => r.isWarrantyClaim || r.warrantySaleId)
    .map(r => {
      // `completedAt` is epoch ms; a repair completed but never stamped falls
      // back to its own date rather than being dropped.
      const completedOn = r.completedAt ? localDate(r.completedAt) : r.date;
      return {
        repairId: r.id,
        repairNumber: r.repairNumber,
        completedOn,
        cost: round2((r.partsCost || 0) + ((r as { labourCost?: number }).labourCost || 0)),
        saleId: r.warrantySaleId,
      };
    })
    // Only COMPLETED warranty work has cost anything yet.
    .filter(row => !!row.completedOn && row.completedOn >= lo && row.completedOn <= hi)
    .sort((a, b) => a.completedOn.localeCompare(b.completedOn));
};

export const warrantyCostTotal = (rows: WarrantyCostRow[]): number =>
  round2(rows.reduce((n, r) => n + r.cost, 0));

export const WARRANTY_COST_PL_NOTE =
  'Reporting only. A warranty repair’s parts already reach the P&L through the repairs path, so this line is shown to explain what warranties cost — it is not subtracted a second time.';

const localDate = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
