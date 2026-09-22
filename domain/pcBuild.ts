import {
  BuildKind, BuildLabourEntry, BuildPart, BuildStatus, InventoryItem, PartCategory,
  PartCondition, PartSource, PcBuild,
} from '../types';
import { todayISO } from './dates';

/**
 * CUSTOM PC BUILDS — the totals, the labour, and the name.
 *
 * Two kinds, and the difference matters everywhere:
 *
 *   SHELF     the shop builds it speculatively. When it is finished it becomes
 *             an ORDINARY inventory device (deviceType 'Desktop PC') and flows
 *             through the floor price, the till, the Money Trail, the Sales
 *             Ledger and search with no special-casing at all. That is the
 *             whole design: a finished build is not a new kind of thing.
 *
 *   CUSTOMER  somebody ordered it. It is NEVER sellable stock — it belongs to
 *             the person who ordered it from the moment it exists, so it must
 *             not appear in the sellable list or be addable to anyone else's
 *             sale (see `isSellable`). Deposits run through the EXISTING
 *             layaway flow (domain/layaway.ts); this module adds no second
 *             deposit system.
 *
 * PARTS ARE NOT STOCK. They come from Facebook, retail and trade-ins, and the
 * owner types each cost in. Nothing here depletes an inventory count, because
 * there is no parts inventory to deplete.
 *
 * Pure: no DOM, no Firestore.
 */

const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

/* ---------------- Statuses ---------------- */

/**
 * The order of the pipeline. A status moves FORWARD with one tap; moving
 * backwards is possible but has to be confirmed, because going back from
 * 'ready' to 'assembling' usually means something went wrong and the person
 * doing it should mean it.
 */
export const BUILD_FLOW: BuildStatus[] = [
  'planning', 'parts_ordered', 'assembling', 'testing', 'ready',
];

/** Terminal: the build is over, however it ended. */
export const BUILD_TERMINAL: BuildStatus[] = ['sold', 'picked_up', 'cancelled'];

export const BUILD_STATUS_LABEL: Record<BuildStatus, string> = {
  planning: 'Planning',
  parts_ordered: 'Parts ordered',
  assembling: 'Assembling',
  testing: 'Testing',
  ready: 'Ready',
  sold: 'Sold',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
};

export const isBuildFinished = (b: Pick<PcBuild, 'status'>): boolean =>
  BUILD_TERMINAL.includes(b.status);

/** The next status one tap forward, or null at the end of the pipeline. */
export const nextStatus = (status: BuildStatus): BuildStatus | null => {
  const i = BUILD_FLOW.indexOf(status);
  if (i < 0 || i === BUILD_FLOW.length - 1) return null;
  return BUILD_FLOW[i + 1];
};

/**
 * Is this a step BACKWARDS? Those need a confirmation.
 *
 * A move into a terminal status is never "backwards" — finishing, selling or
 * cancelling is a legitimate end from anywhere.
 */
export const isBackwards = (from: BuildStatus, to: BuildStatus): boolean => {
  if (BUILD_TERMINAL.includes(to)) return false;
  const a = BUILD_FLOW.indexOf(from), b = BUILD_FLOW.indexOf(to);
  if (a < 0 || b < 0) return false;
  return b < a;
};

/** The In progress / Completed split, the same shape the batch view uses. */
export const splitBuilds = (builds: PcBuild[]): { active: PcBuild[]; completed: PcBuild[] } => ({
  active: builds.filter(b => !isBuildFinished(b)),
  completed: builds.filter(isBuildFinished),
});

/**
 * A CUSTOMER ORDER IS NEVER SELLABLE STOCK.
 *
 * Stated as its own predicate rather than left to a status check at each call
 * site: the failure this prevents is selling somebody's ordered machine to a
 * walk-in, which is not a bug you find in testing.
 */
export const isSellable = (b: Pick<PcBuild, 'kind' | 'status'>): boolean =>
  b.kind === 'shelf' && !BUILD_TERMINAL.includes(b.status);

/* ---------------- Money ---------------- */

export interface BuildTotals {
  partsCost: number;
  labourHours: number;
  /** Σ hours × the rate snapshotted on each entry. */
  labourCost: number;
  /** partsCost + labourCost. The build's own cost. */
  totalCost: number;
  /** targetPrice (shelf) or quotePrice (customer), whichever applies. */
  price: number | null;
  /** price − totalCost. Null when no price is set yet. */
  profit: number | null;
  /** profit / price, as a percentage. Null when no price is set. */
  marginPercent: number | null;
  /** Σ retailPrice, and whether EVERY part has one — see retailComparison. */
  retailTotal: number;
  retailComplete: boolean;
}

export const partsCost = (parts: BuildPart[]): number =>
  round2(parts.reduce((n, p) => n + (p.cost || 0), 0));

/**
 * Labour cost from the SNAPSHOTTED rate on each entry, never from the current
 * setting.
 *
 * Changing settings.operations.buildLabourRate must not reprice a build that
 * was costed months ago — the same rule pay periods follow for hourly rates,
 * and for the same reason: a figure that silently moves is a figure nobody can
 * reconcile.
 */
export const labourCost = (labour: BuildLabourEntry[]): number =>
  round2(labour.reduce((n, l) => n + (l.hours || 0) * (l.rate || 0), 0));

export const labourHours = (labour: BuildLabourEntry[]): number =>
  round2(labour.reduce((n, l) => n + (l.hours || 0), 0));

export const buildPrice = (b: Pick<PcBuild, 'kind' | 'targetPrice' | 'quotePrice'>): number | null => {
  const p = b.kind === 'customer' ? b.quotePrice : b.targetPrice;
  return typeof p === 'number' && p > 0 ? round2(p) : null;
};

export const buildTotals = (b: PcBuild): BuildTotals => {
  const parts = round2(partsCost(b.parts || []));
  const labour = labourCost(b.labour || []);
  const totalCost = round2(parts + labour);
  const price = buildPrice(b);
  const withRetail = (b.parts || []).filter(p => typeof p.retailPrice === 'number' && p.retailPrice > 0);
  return {
    partsCost: parts,
    labourHours: labourHours(b.labour || []),
    labourCost: labour,
    totalCost,
    price,
    profit: price == null ? null : round2(price - totalCost),
    marginPercent: price == null || price <= 0 ? null : round2(((price - totalCost) / price) * 100),
    retailTotal: round2(withRetail.reduce((n, p) => n + (p.retailPrice || 0), 0)),
    // EVERY part must have a retail price for the comparison to mean anything —
    // see retailComparison.
    retailComplete: (b.parts || []).length > 0 && withRetail.length === (b.parts || []).length,
  };
};

/**
 * "Parts at retail $1,420 — yours for $1,050", or nothing.
 *
 * ONLY WHEN EVERY PART HAS A RETAIL PRICE. A total built from four parts out of
 * seven understates what the machine is worth and overstates nothing — it is
 * simply a different number wearing the same label, and a customer reading it
 * off a card has no way to know. So a partial total is omitted rather than
 * shown, which is the one place in this feature where showing less is the whole
 * point.
 *
 * Also omitted when the comparison would be unflattering (retail at or below
 * the asking price): the claim is "this is good value", and a card that says
 * "parts at retail $900 — yours for $1,050" makes an argument nobody wants to
 * make.
 */
export interface RetailComparison {
  retailTotal: number;
  price: number;
  saving: number;
}

export const retailComparison = (b: PcBuild, priceOverride?: number | null): RetailComparison | null => {
  const totals = buildTotals(b);
  const price = priceOverride != null && priceOverride > 0 ? round2(priceOverride) : totals.price;
  if (!totals.retailComplete || price == null || totals.retailTotal <= 0) return null;
  const saving = round2(totals.retailTotal - price);
  if (saving <= 0) return null;
  return { retailTotal: totals.retailTotal, price, saving };
};

/**
 * "as of 2026-03-04" — a retail price is ALWAYS shown with the date it was
 * checked, so a stale price looks stale.
 */
export const retailAsOfLabel = (p: Pick<BuildPart, 'retailPrice' | 'retailCheckedAt'>): string | null => {
  if (typeof p.retailPrice !== 'number' || p.retailPrice <= 0) return null;
  return p.retailCheckedAt
    ? `$${p.retailPrice.toFixed(2)} (as of ${p.retailCheckedAt})`
    : `$${p.retailPrice.toFixed(2)} (date not recorded)`;
};

/** How stale, in days. Used to grey out a price nobody has looked at in months. */
export const retailAgeDays = (p: Pick<BuildPart, 'retailCheckedAt'>, today = todayISO()): number | null => {
  if (!p.retailCheckedAt) return null;
  const a = Date.parse(`${p.retailCheckedAt}T00:00:00`);
  const b = Date.parse(`${today}T00:00:00`);
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
};

export const RETAIL_STALE_DAYS = 30;

/* ---------------- Logging labour ---------------- */

/**
 * A labour entry with the CURRENT rate baked in.
 *
 * The snapshot happens here, at the moment of logging, and nowhere else — so
 * there is exactly one place where "what was the rate" is answered, and it is
 * answered once per entry rather than every time a total is drawn.
 */
export const buildLabourEntry = (input: {
  id: string;
  userId: string;
  userEmail: string;
  hours: number;
  date: string;
  note?: string;
  rate: number;
  at: number;
}): BuildLabourEntry => ({
  id: input.id,
  userId: input.userId,
  userEmail: input.userEmail,
  hours: Math.max(0, round2(input.hours)),
  date: input.date,
  ...(input.note ? { note: input.note } : {}),
  rate: Math.max(0, round2(input.rate)),
  loggedAt: input.at,
});

export const DEFAULT_BUILD_LABOUR_RATE = 15;

/**
 * BUILD LABOUR IS NOT A P&L EXPENSE. It is already paid through payroll — the
 * person building the PC is on the time clock, and their hours reach the P&L
 * through PayPeriodPaid like everyone else's.
 *
 * So labour counts toward the BUILD's own cost and profit only, and the
 * device's inventory cost when a build is finished is PARTS ONLY. That is
 * option (a) of the two the spec offered, chosen because payroll stays the
 * single source of wage cost and nothing has to be subtracted back out of it.
 *
 * The consequence, stated plainly because it is a real trade-off: the per-item
 * profit the Sales Ledger shows for a finished build is parts-only profit, and
 * the build page is where the labour-inclusive figure lives. The alternative
 * would have been truer per item and would have required the P&L to exclude
 * some payroll hours — a subtraction with no audit trail and nothing to
 * reconcile it against.
 */
export const deviceCostForBuild = (b: PcBuild): number => partsCost(b.parts || []);

export const LABOUR_NOT_IN_PL_NOTE =
  'Build labour is already paid through payroll, so it counts toward this build’s own profit only — it is never added to the P&L on top of wages.';

/* ---------------- The generated name ---------------- */

/** The categories that make up the headline spec, in the order people read. */
export const HEADLINE_CATEGORIES: PartCategory[] = ['CPU', 'GPU', 'RAM', 'Storage'];

export const PART_CATEGORIES: PartCategory[] = [
  'CPU', 'GPU', 'Motherboard', 'RAM', 'Storage', 'PSU', 'Case', 'Cooler', 'Fans', 'OS', 'Other',
];

export const CONDITION_LABEL: Record<PartCondition, string> = {
  new: 'New', used: 'Used', open_box: 'Open box',
};

export const SOURCE_LABEL: Record<PartSource, string> = {
  facebook: 'Facebook', retail: 'Retail', trade_in: 'Trade-in',
  online: 'Online', other: 'Other',
};

/**
 * "Ryzen 7 7800X3D / RTX 4070 / 32GB / 1TB" — the specs line.
 *
 * CPU, GPU, RAM and Storage only: those are what somebody buying a PC asks
 * about, and a line that also listed the case and the fans would stop being
 * readable at a glance. Missing categories are skipped rather than padded, so a
 * build with no GPU yet reads as a shorter line rather than an odd one.
 */
export const specsLine = (parts: BuildPart[]): string =>
  HEADLINE_CATEGORIES
    .map(c => parts.find(p => p.category === c)?.name?.trim())
    .filter((n): n is string => !!n)
    .join(' / ');

/** "Custom PC · Ryzen 7 7800X3D / RTX 4070 / 32GB / 1TB". Editable afterwards. */
export const generatedItemName = (parts: BuildPart[]): string => {
  const specs = specsLine(parts);
  return specs ? `Custom PC · ${specs}` : 'Custom PC';
};

/* ---------------- Finishing a shelf build ---------------- */

export interface FinishBuildInput {
  build: PcBuild;
  sku: string;
  itemId: string;
  today: string;
  /** Overridden name, when the user edited the generated one. */
  itemName?: string;
}

/**
 * The inventory device a finished SHELF build becomes.
 *
 * Deliberately an ordinary InventoryItem with nothing bespoke on it beyond the
 * link back to the build: from this moment the floor price, the till, the Money
 * Trail, the Sales Ledger and search all treat it as a device, because it is
 * one.
 *
 * COST IS PARTS ONLY — see deviceCostForBuild and the note above it.
 */
export const buildToInventoryItem = (input: FinishBuildInput): InventoryItem => {
  const { build, sku, itemId, today } = input;
  return {
    id: itemId,
    kind: 'device',
    sku,
    date: today,
    item: (input.itemName || generatedItemName(build.parts || [])).trim(),
    imei: '',
    boughtFrom: '',
    // Parts only. Labour is payroll's — see LABOUR_NOT_IN_PL_NOTE.
    purchaseCost: deviceCostForBuild(build),
    repairCost: 0,
    soldDate: '',
    soldTo: '',
    salePrice: 0,
    deviceType: 'Desktop PC',
    brand: 'Custom',
    model: specsLine(build.parts || []),
    condition: 'New',
    purchaseSource: 'Built in-house',
    targetSalePrice: build.targetPrice || 0,
    deviceStatus: 'ready',
    notes: build.notes || '',
    // The device links back to the build, and the build to the device, so
    // neither is reachable only from the other.
    pcBuildId: build.id,
  };
};

/**
 * May the parts still be edited?
 *
 * Yes while the machine is the shop's — editing parts after the device exists
 * is allowed and updates its cost (audited). NO once it has SOLD: the sale
 * booked a cost, that cost is in the Sales Ledger and the P&L, and quietly
 * changing it afterwards would restate a closed figure.
 */
export const partsEditable = (
  b: Pick<PcBuild, 'status'>,
  device?: Pick<InventoryItem, 'soldDate' | 'deviceStatus'>,
): boolean => {
  if (b.status === 'sold' || b.status === 'picked_up') return false;
  if (device && (device.soldDate || device.deviceStatus === 'sold')) return false;
  return true;
};

export const PARTS_LOCKED_NOTE =
  'This build has been sold — its parts and costs are locked, because the sale already booked them.';

/* ---------------- PCPartPicker ---------------- */

/**
 * A search on the CANADIAN site — the shop is in Canada and US pricing is not
 * what anybody here pays.
 */
export const pcPartPickerSearchUrl = (name: string): string =>
  `https://ca.pcpartpicker.com/search/?q=${encodeURIComponent((name || '').trim())}`;

/* ---------------- Searching builds ---------------- */

/** The text the shared multi-word matcher searches a build across. */
export const buildSearchText = (b: PcBuild): string =>
  [
    b.name,
    b.customerName,
    BUILD_STATUS_LABEL[b.status],
    b.kind === 'customer' ? 'customer order' : 'shelf build',
    ...(b.parts || []).flatMap(p => [p.name, p.category, p.serial]),
  ].filter(Boolean).join(' ');

export const buildKindLabel: Record<BuildKind, string> = {
  shelf: 'Build to sell',
  customer: 'Customer order',
};
