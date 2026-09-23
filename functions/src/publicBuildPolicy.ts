/**
 * WHAT A STRANGER WITH THE LINK IS ALLOWED TO SEE.
 *
 * A pure module, deliberately: buildLookup.ts does nothing but find the
 * document with the Admin SDK and hand it here. Everything that decides what
 * leaves the building is in one file with no Firebase in it, so it can be
 * exercised without a live project — the same shape as staffPasswordPolicy.ts
 * and switchUserPolicy.ts.
 *
 * THE RULE: the returned object is BUILT FIELD BY FIELD from an allow-list. It
 * is never the stored build with things deleted. A subtractive approach fails
 * open — add a field to BuildPart next year and it ships to the public page
 * unless somebody remembers to strip it — and the thing on the other side of
 * this boundary is part costs, supplier links and customer names.
 */

/** Everything a part may contribute to the public page. Nothing else exists. */
export interface PublicPart {
  category: string;
  name: string;
  /** "New" / "Used — tested". Never the raw enum. */
  condition: string;
  /** Remaining MANUFACTURER warranty in plain words, or absent. */
  warranty?: string;
  /** What this part costs new, and at the comparison store. */
  newPrice?: number;
  storePrice?: number;
  storeName?: string;
}

/**
 * ONE PHOTO OF THE MACHINE, for the listing.
 *
 * `stock` and `credit` travel together and are not decoration: a stock image
 * is labelled as one on the page, and most Commons files are CC-BY, so
 * dropping the attribution because it is small would be a licence breach.
 */
export interface PublicPhoto {
  url: string;
  thumbUrl?: string;
  stock?: true;
  credit?: string;
}

export interface PublicBuild {
  found: true;
  name: string;
  /** The finished machine, when the shop has photographed it. */
  photo?: PublicPhoto;
  /** "Available" or "Sold". The internal pipeline never leaves the shop. */
  status: string;
  parts: PublicPart[];
  /** The shop's asking price. Absent if none is set — "Ask us". */
  price?: number;
  /** Σ new prices, and whether every part had one. */
  retailTotal?: number;
  retailComplete: boolean;
  /** Σ at the comparison store, present only when complete. */
  storeTotal?: number;
  storeName?: string;
  /** storeTotal (or retailTotal) − price, when that is a positive number. */
  saving?: number;
  /** What the shop warrants the machine for. */
  warrantyDays: number;
  shopName: string;
  shopPhone?: string;
  shopAddress?: string;
  shopEmail?: string;
}

export type PublicBuildResult = PublicBuild | { found: false };

/**
 * EVERY KEY THE PUBLIC OBJECT MAY CARRY.
 *
 * The structural test walks the produced object against this list, so a field
 * added to PublicBuild without being added here fails the build rather than
 * shipping. Keep it in sync deliberately — that friction is the feature.
 */
export const PUBLIC_BUILD_KEYS = [
  'found', 'name', 'photo', 'status', 'parts', 'price', 'retailTotal', 'retailComplete',
  'storeTotal', 'storeName', 'saving', 'warrantyDays',
  'shopName', 'shopPhone', 'shopAddress', 'shopEmail',
] as const;

export const PUBLIC_PART_KEYS = [
  'category', 'name', 'condition', 'warranty', 'newPrice', 'storePrice', 'storeName',
] as const;

export const PUBLIC_PHOTO_KEYS = ['url', 'thumbUrl', 'stock', 'credit'] as const;

/**
 * Fields that must NEVER reach the public object, named so the test can say
 * what it is protecting rather than only that the shape matched.
 *
 * SERIALS ARE EXCLUDED DELIBERATELY. A published serial is what somebody needs
 * to claim a manufacturer warranty on hardware they do not own, and the page
 * is a public listing on Marketplace.
 */
export const FORBIDDEN_FIELDS = [
  'cost', 'partsCost', 'labour', 'labourCost', 'totalCost', 'profit', 'margin',
  'marginPercent', 'targetPrice', 'quotePrice', 'source', 'sourceUrl', 'serial',
  'customerId', 'customerName', 'customerPhone', 'createdBy', 'createdByEmail',
  'inventoryId', 'sku', 'id', 'shareToken', 'notes', 'pcpartpickerUrl',
  'retailSource', 'retailCheckedAt', 'altStoreName', 'altStorePrice',
] as const;

const SOLD_GRACE_DAYS = 30;
const round2 = (n: number): number => Math.round(n * 100) / 100;
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const pos = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? round2(v) : undefined;

const CONDITION_WORDS: Record<string, string> = {
  new: 'New',
  open_box: 'Open box',
  used: 'Used — tested',
  refurbished: 'Refurbished',
  pulled: 'Used — tested',
};

const TERMINAL = new Set(['sold', 'picked_up', 'cancelled']);

/** Remaining manufacturer warranty in plain words, or undefined. */
export function warrantyWords(until: unknown, nowMs: number): string | undefined {
  const s = str(until);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const [y, m, d] = s.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d);
  const today = new Date(nowMs);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((end - start) / 86400000);
  if (days < 0) return undefined;                  // expired: say nothing at all
  if (days === 0) return 'maker warranty ends today';
  if (days < 45) return `${days} days of maker warranty left`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months of maker warranty left`;
  return `${Math.floor(months / 12)} years of maker warranty left`;
}

/**
 * Is this token still allowed to resolve?
 *
 * A cancelled build stops immediately. A sold one keeps answering for
 * SOLD_GRACE_DAYS so a link in an old Marketplace post says "Sold" rather than
 * looking like a broken site, then stops.
 */
export function shareVisible(build: Record<string, unknown>, nowMs: number): boolean {
  if (!str(build.shareToken)) return false;
  const status = str(build.status);
  if (status === 'cancelled') return false;
  if (!TERMINAL.has(status)) return true;
  const soldAt = typeof build.finishedAt === 'number' ? build.finishedAt
    : typeof build.updatedAt === 'number' ? build.updatedAt : undefined;
  // No stamp at all — a build finished before this shipped. Keep the link
  // working rather than 404ing something the shop has already posted.
  if (soldAt == null) return true;
  return nowMs - soldAt <= SOLD_GRACE_DAYS * 86400000;
}

export interface ShopProfile {
  name?: unknown;
  phone?: unknown;
  address?: unknown;
  email?: unknown;
  /** settings.operations.deviceWarrantyDays — what the shop warrants a machine for. */
  warrantyDays?: unknown;
}

/**
 * The public object, built key by key.
 *
 * Nothing is spread from the stored build. Every field below is read
 * explicitly, coerced, and assigned — which is what makes the allow-list real
 * rather than a comment.
 */
/**
 * The one photo the listing shows, built field by field like everything else.
 *
 * A REAL photo always wins over the stock one, mirroring domain/devicePhotos.ts's
 * mainPhoto — a buyer looking at a Marketplace post should be looking at the
 * machine they would be buying, not at a catalogue render of something like it.
 * `addedBy`, `addedAt`, `id` and `sourceUrl` are deliberately not carried: who
 * in the shop took the picture is nobody's business outside it.
 */
export function publicPhoto(photos: unknown): PublicPhoto | undefined {
  if (!Array.isArray(photos) || photos.length === 0) return undefined;
  const list = photos as Record<string, unknown>[];
  const chosen = list.find(p => str(p.kind) === 'real') || list[0];
  const url = str(chosen?.url);
  if (!url) return undefined;
  const out: PublicPhoto = { url };
  const thumb = str(chosen.thumbUrl);
  if (thumb) out.thumbUrl = thumb;
  if (str(chosen.kind) === 'stock') {
    out.stock = true;
    const credit = str(chosen.credit);
    if (credit) out.credit = credit;
  }
  return out;
}

export function toPublicBuild(
  build: Record<string, unknown>,
  shop: ShopProfile,
  nowMs: number,
  /**
   * The finished machine's inventory document, when the build has one. Photos
   * live on the DEVICE, not on the build — a finished shelf build becomes an
   * inventory item, and photographing it once has to serve the kiosk, the
   * inventory list and this listing alike.
   */
  device?: Record<string, unknown>,
): PublicBuild {
  const rawParts = Array.isArray(build.parts) ? (build.parts as Record<string, unknown>[]) : [];
  const buildStore = str(build.comparisonStore);

  const parts: PublicPart[] = rawParts
    .filter(p => str(p.name))
    .map(p => {
      const out: PublicPart = {
        category: str(p.category) || 'Part',
        name: str(p.name),
        condition: CONDITION_WORDS[str(p.condition)] || 'Used — tested',
      };
      const warranty = warrantyWords(p.mfrWarrantyUntil, nowMs);
      if (warranty) out.warranty = warranty;
      const newPrice = pos(p.retailPrice);
      if (newPrice != null) out.newPrice = newPrice;
      const storePrice = pos(p.altStorePrice);
      if (storePrice != null) out.storePrice = storePrice;
      const storeName = str(p.altStoreName) || buildStore;
      if (storeName && (storePrice != null || newPrice != null)) out.storeName = storeName;
      return out;
    });

  // Totals, recomputed here from the public numbers rather than trusted from
  // the document — the page must never be able to show a figure that was not
  // derived from what it is also showing.
  const priced = parts.filter(p => p.newPrice != null);
  const retailComplete = parts.length > 0 && priced.length === parts.length;
  const retailTotal = round2(priced.reduce((n, p) => n + (p.newPrice || 0), 0));

  const comparison = parts.map(p => p.storePrice ?? p.newPrice);
  const storeComplete = parts.length > 0 && comparison.every(v => v != null);
  const storeTotal = round2(comparison.reduce<number>((n, v) => n + (v || 0), 0));

  const price = pos(build.targetPrice);
  const headline = buildStore && storeComplete ? storeTotal : retailComplete ? retailTotal : undefined;

  const out: PublicBuild = {
    found: true,
    name: str(build.name) || 'Custom PC',
    status: TERMINAL.has(str(build.status)) ? 'Sold' : 'Available',
    parts,
    retailComplete,
    warrantyDays: typeof shop.warrantyDays === 'number' && shop.warrantyDays > 0 ? Math.round(shop.warrantyDays) : 0,
    shopName: str(shop.name) || 'Our shop',
  };

  const photo = publicPhoto(device?.photos);
  if (photo) out.photo = photo;

  if (price != null) out.price = price;
  if (retailTotal > 0) out.retailTotal = retailTotal;
  if (buildStore && storeComplete) {
    out.storeTotal = storeTotal;
    out.storeName = buildStore;
  }
  // A saving is only shown when it flatters and when the total behind it is
  // complete — a saving computed from some of the parts is a different number
  // wearing the same label, and a buyer cannot tell.
  if (headline != null && price != null && headline - price > 0) {
    out.saving = round2(headline - price);
  }

  const phone = str(shop.phone);
  if (phone) out.shopPhone = phone;
  const address = str(shop.address);
  if (address) out.shopAddress = address;
  const email = str(shop.email);
  if (email) out.shopEmail = email;

  return out;
}
