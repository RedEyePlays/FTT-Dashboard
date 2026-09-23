/**
 * WHAT A CUSTOMER HOLDING THE COUNTER TABLET MAY SEE.
 *
 * A pure module: showroomLookup.ts finds the documents with the Admin SDK and
 * hands them here. Everything that decides what leaves the building is in one
 * file with no Firebase in it — the same shape as publicBuildPolicy.ts, and for
 * the same reason.
 *
 * THE RULE, AGAIN: every returned object is BUILT FIELD BY FIELD from an
 * allow-list. Never the stored item with things deleted. Subtractive filtering
 * fails open the next time somebody adds a field to InventoryItem — and what is
 * on the other side of this boundary is purchase cost, margin, IMEI, and the
 * name of whoever sold the shop the phone.
 *
 * The tablet is PUBLIC and UNATTENDED. Assume it is picked up by somebody who
 * would rather like to know what the shop paid.
 */

export interface PublicPhoto {
  url: string;
  thumbUrl?: string;
  /** Present only on an auto-fetched stock photo; the page labels those. */
  stock?: true;
  credit?: string;
}

export interface ShowroomItem {
  /** The SKU is how a customer points at something without describing it. */
  sku: string;
  kind: 'device' | 'build';
  category: string;            // 'Phones' | 'Laptops' | 'Gaming PCs' | 'Tablets'
  title: string;
  photo?: PublicPhoto;
  storage?: string;
  colour?: string;
  /** Plain words, never a raw grade code. */
  condition?: string;
  batteryHealth?: string;
  price: number;
  warrantyDays: number;
  /** PC builds only: the spec line, and the retail comparison when complete. */
  specs?: string;
  compareTotal?: number;
  compareStore?: string;
  saving?: number;
}

export interface ShowroomResult {
  found: true;
  shopName: string;
  shopPhone?: string;
  items: ShowroomItem[];
  repairs: ShowroomRepair[];
  repairWarrantyDays: number;
  tradeIns: ShowroomTradeIn[];
  updatedAt: number;
}

export interface ShowroomRepair {
  deviceModel: string;
  repairType: string;
  price: number;
  /** True when the owner marked it a starting price — shown as "from $X". */
  fromPrice?: true;
  turnaround?: string;
}

export interface ShowroomTradeIn {
  deviceModel: string;
  condition: string;
  lowPrice: number;
  highPrice: number;
}

/** EVERY key each public object may carry. The structural test walks these. */
export const SHOWROOM_ITEM_KEYS = [
  'sku', 'kind', 'category', 'title', 'photo', 'storage', 'colour', 'condition',
  'batteryHealth', 'price', 'warrantyDays', 'specs', 'compareTotal', 'compareStore', 'saving',
] as const;

export const SHOWROOM_PHOTO_KEYS = ['url', 'thumbUrl', 'stock', 'credit'] as const;

export const SHOWROOM_RESULT_KEYS = [
  'found', 'shopName', 'shopPhone', 'items', 'repairs', 'repairWarrantyDays',
  'tradeIns', 'updatedAt',
] as const;

export const SHOWROOM_REPAIR_KEYS = ['deviceModel', 'repairType', 'price', 'fromPrice', 'turnaround'] as const;
export const SHOWROOM_TRADEIN_KEYS = ['deviceModel', 'condition', 'lowPrice', 'highPrice'] as const;

/**
 * Named so the test can say what it is protecting, not merely that the shape
 * matched. Every one of these is on the stored item and must never leave.
 */
export const FORBIDDEN_ITEM_FIELDS = [
  'purchaseCost', 'repairCost', 'cost', 'costPerUnit', 'margin', 'profit',
  'targetSalePrice', 'salePrice', 'imei', 'serial', 'manufacturerBarcode',
  'boughtFrom', 'purchaseSource', 'boughtFromCustomerId', 'boughtFromPhone',
  'customerName', 'customerPhone', 'customerId', 'soldTo', 'soldDate',
  'createdBy', 'createdByEmail', 'id', 'inventoryId', 'pcBuildId', 'notes',
  'listedPlatforms', 'deviceStatus', 'quantity', 'shareToken',
] as const;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const pos = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? round2(v) : undefined;

/* ---------------- Eligibility ---------------- */

/**
 * The device types that go on the tablet. Accessories are deliberately absent:
 * a browsable list of cases and cables is a different product, and the point
 * of the screen is the expensive things somebody is deciding about.
 */
const SHOWN_TYPES: Record<string, string> = {
  Phone: 'Phones',
  Laptop: 'Laptops',
  Tablet: 'Tablets',
  'Desktop PC': 'Gaming PCs',
};

export const CATEGORY_ORDER = ['Phones', 'Laptops', 'Gaming PCs', 'Tablets'];

/**
 * Is this device for sale, today, on the shop floor?
 *
 * UNPRICED ITEMS NEVER APPEAR. A price of 0 on a public screen is not a
 * bargain, it is a mistake somebody will try to hold the shop to. Reserved and
 * sold devices are gone too — a customer pointing at something already spoken
 * for is a conversation nobody wants.
 */
export function isShowroomEligible(item: Record<string, unknown>): boolean {
  if (str(item.kind) === 'accessory') return false;
  if (!SHOWN_TYPES[str(item.deviceType)]) return false;
  const status = str(item.deviceStatus);
  if (status && status !== 'ready') return false;     // reserved, sold, pending
  if (str(item.soldDate)) return false;
  return pos(item.targetSalePrice) != null;
}

/* ---------------- Condition, in plain words ---------------- */

/**
 * A grade code means nothing to a customer, and "Fair" means whatever they
 * fear most. Say what they will actually see when they pick it up.
 */
const CONDITION_WORDS: Record<string, string> = {
  New: 'Brand new, sealed',
  'Like New': 'Like new — no marks',
  Excellent: 'Excellent — barely a mark',
  Good: 'Good — light scratches',
  Fair: 'Fair — visible wear',
  'For Parts': 'Sold as-is, for parts',
};

export function conditionWords(grade: unknown): string | undefined {
  return CONDITION_WORDS[str(grade)];
}

/* ---------------- Building the public objects ---------------- */

function publicPhoto(photos: unknown): PublicPhoto | undefined {
  if (!Array.isArray(photos) || photos.length === 0) return undefined;
  const list = photos as Record<string, unknown>[];
  // A REAL photo always wins, mirroring domain/devicePhotos.ts's mainPhoto.
  const chosen = list.find(p => str(p.kind) === 'real') || list[0];
  const url = str(chosen?.url);
  if (!url) return undefined;
  const out: PublicPhoto = { url };
  const thumb = str(chosen.thumbUrl);
  if (thumb) out.thumbUrl = thumb;
  if (str(chosen.kind) === 'stock') {
    out.stock = true;
    // The credit travels WITH the photo: most Commons files are CC-BY, and
    // dropping the attribution because it is small would be a licence breach.
    const credit = str(chosen.credit);
    if (credit) out.credit = credit;
  }
  return out;
}

export function toShowroomDevice(
  item: Record<string, unknown>,
  warrantyDays: number,
): ShowroomItem | null {
  const price = pos(item.targetSalePrice);
  const category = SHOWN_TYPES[str(item.deviceType)];
  if (price == null || !category) return null;

  const title = [str(item.brand), str(item.model)].filter(Boolean).join(' ')
    || str(item.item) || 'Device';

  const out: ShowroomItem = {
    sku: str(item.sku),
    kind: 'device',
    category,
    title,
    price,
    warrantyDays,
  };
  const photo = publicPhoto(item.photos);
  if (photo) out.photo = photo;
  const storage = str(item.storage);
  if (storage) out.storage = storage;
  const colour = str(item.color);
  if (colour) out.colour = colour;
  const condition = conditionWords(item.condition);
  if (condition) out.condition = condition;
  const battery = str(item.batteryHealth);
  if (battery) out.batteryHealth = battery;
  return out;
}

/**
 * A finished PC build that is ready to sell.
 *
 * The retail comparison is carried through ONLY when it is complete — a total
 * from some of the parts is a different number wearing the same label, and a
 * customer reading it off a tablet cannot tell.
 */
export function toShowroomBuild(
  build: Record<string, unknown>,
  device: Record<string, unknown> | undefined,
  warrantyDays: number,
): ShowroomItem | null {
  const price = pos(device?.targetSalePrice) ?? pos(build.targetPrice);
  if (price == null) return null;

  const out: ShowroomItem = {
    sku: str(build.sku) || str(device?.sku),
    kind: 'build',
    category: 'Gaming PCs',
    title: str(build.name) || 'Custom PC',
    price,
    warrantyDays,
  };

  const photo = publicPhoto(device?.photos);
  if (photo) out.photo = photo;

  const parts = Array.isArray(build.parts) ? (build.parts as Record<string, unknown>[]) : [];
  const specs = parts.map(p => str(p.name)).filter(Boolean).slice(0, 4).join(' · ');
  if (specs) out.specs = specs;

  // Comparison prices only — never a cost. A part with no price at the store
  // falls back to its new price; a part with neither kills the comparison.
  const store = str(build.comparisonStore);
  const comparison = parts.map(p => pos(p.altStorePrice) ?? pos(p.retailPrice));
  const complete = parts.length > 0 && comparison.every(v => v != null);
  if (complete) {
    const total = round2(comparison.reduce<number>((n, v) => n + (v || 0), 0));
    out.compareTotal = total;
    if (store) out.compareStore = store;
    if (total - price > 0) out.saving = round2(total - price);
  }
  return out;
}

/* ---------------- Repair prices and trade-ins ---------------- */

export function toShowroomRepair(row: Record<string, unknown>): ShowroomRepair | null {
  if (row.active === false) return null;
  const price = pos(row.price);
  const model = str(row.deviceModel);
  const type = str(row.repairType);
  if (price == null || !model || !type) return null;
  const out: ShowroomRepair = { deviceModel: model, repairType: type, price };
  if (row.fromPrice === true) out.fromPrice = true;
  const turnaround = str(row.turnaround);
  if (turnaround) out.turnaround = turnaround;
  return out;
}

export function toShowroomTradeIn(row: Record<string, unknown>): ShowroomTradeIn | null {
  if (row.active === false) return null;
  const low = pos(row.lowPrice);
  const high = pos(row.highPrice);
  const model = str(row.deviceModel);
  const condition = str(row.condition);
  if (low == null || high == null || !model || !condition) return null;
  // A range that is the wrong way round is a typo; showing it would read as
  // "$220–$180", which looks like the shop cannot do arithmetic.
  return {
    deviceModel: model,
    condition,
    lowPrice: Math.min(low, high),
    highPrice: Math.max(low, high),
  };
}

/* ---------------- Sorting ---------------- */

export type SortOrder = 'price-asc' | 'price-desc';

/** Cheapest first by default: it is the order somebody browsing expects. */
export function sortItems(items: ShowroomItem[], order: SortOrder = 'price-asc'): ShowroomItem[] {
  const dir = order === 'price-desc' ? -1 : 1;
  return [...items].sort((a, b) => (a.price - b.price) * dir || a.title.localeCompare(b.title));
}

export function groupByCategory(items: ShowroomItem[]): { category: string; items: ShowroomItem[] }[] {
  return CATEGORY_ORDER
    .map(category => ({ category, items: items.filter(i => i.category === category) }))
    .filter(g => g.items.length > 0);
}
