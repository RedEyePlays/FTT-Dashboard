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

/**
 * ONE LINE OF THE PERFORMANCE BLOCK.
 *
 * ALWAYS A RANGE AND ALWAYS WITH ITS SETTINGS. A bare "160 fps" is a promise;
 * "120–160 fps at 1080p, High" is a description. `measured` marks a figure the
 * shop took on this actual machine, which is a stronger claim and so is
 * labelled rather than blended in with the estimates.
 */
export interface PublicPerformance {
  game: string;
  resolution: string;
  preset: string;
  fpsLow: number;
  fpsHigh: number;
  measured?: true;
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
  /**
   * Expected performance, from the shop's reviewed per-GPU table plus anything
   * measured on this machine. EMPTY when the card has no reviewed rows — the
   * page then omits the section entirely rather than improvising one.
   */
  performance: PublicPerformance[];
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
  'storeTotal', 'storeName', 'saving', 'warrantyDays', 'performance',
  'shopName', 'shopPhone', 'shopAddress', 'shopEmail',
] as const;

export const PUBLIC_PERFORMANCE_KEYS = [
  'game', 'resolution', 'preset', 'fpsLow', 'fpsHigh', 'measured',
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

/**
 * The shop's reviewed frame-rate table, as stored in settings.
 *
 * Mirrors domain/gpuPerformance.ts. Read here rather than recomputed: the
 * public page must show the same figures the shop approved, not a fresh
 * opinion — that is the entire reason the table exists.
 */
export interface GpuRow {
  gpuModel?: unknown;
  game?: unknown;
  resolution?: unknown;
  preset?: unknown;
  fpsLow?: unknown;
  fpsHigh?: unknown;
}

const normalizeGpu = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\b(gigabyte|asus|msi|zotac|evga|sapphire|xfx|powercolor|pny|inno3d|palit|gainward)\b/g, '')
    .replace(/\b(windforce|gaming|oc|ventus|tuf|rog|strix|eagle|aero|trinity|twin|dual|edition|founders|fe)\b/g, '')
    .replace(/\b\d+\s*gb\b/g, '')
    .replace(/\b(gddr\d x?|graphics card|gpu)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const gpuMatches = (tableModel: string, buildPart: string): boolean => {
  const a = normalizeGpu(tableModel), b = normalizeGpu(buildPart);
  if (!a || !b) return false;
  return a === b || b.includes(a) || a.includes(b);
};

/**
 * The public performance block: the table's rows for this build's card, with
 * anything measured on THIS machine replacing the matching estimate.
 *
 * A measurement is one number, so it is shown as a range of itself — every
 * figure on the page then has the same shape, and a bare number cannot sit
 * among ranges looking like a guarantee.
 */
export function publicPerformance(
  build: Record<string, unknown>,
  table: GpuRow[],
): PublicPerformance[] {
  const parts = Array.isArray(build.parts) ? (build.parts as Record<string, unknown>[]) : [];
  const gpu = str(parts.find(p => str(p.category) === 'GPU')?.name);
  const out: PublicPerformance[] = [];

  if (gpu) {
    for (const row of table || []) {
      const model = str(row.gpuModel);
      const game = str(row.game);
      const resolution = str(row.resolution);
      const preset = str(row.preset);
      const low = pos(row.fpsLow);
      const high = pos(row.fpsHigh);
      if (!model || !game || !resolution || !preset || low == null || high == null) continue;
      if (!gpuMatches(model, gpu)) continue;
      if (out.some(x => x.game === game && x.resolution === resolution)) continue;
      out.push({
        game, resolution, preset,
        fpsLow: Math.round(Math.min(low, high)),
        fpsHigh: Math.round(Math.max(low, high)),
      });
    }
  }

  const measured = Array.isArray(build.measuredFps) ? (build.measuredFps as Record<string, unknown>[]) : [];
  for (const m of measured) {
    const game = str(m.game);
    const resolution = str(m.resolution);
    const preset = str(m.preset);
    const fps = pos(m.fps);
    if (!game || !resolution || fps == null) continue;
    // WHO measured it is the shop's business, not the buyer's — the name and
    // the timestamp are deliberately not carried.
    const line: PublicPerformance = {
      game, resolution, preset: preset || 'Tested settings',
      fpsLow: Math.round(fps), fpsHigh: Math.round(fps), measured: true,
    };
    const at = out.findIndex(x => x.game === game && x.resolution === resolution);
    if (at >= 0) out[at] = line; else out.push(line);
  }

  return out;
}

export interface ShopProfile {
  name?: unknown;
  phone?: unknown;
  address?: unknown;
  email?: unknown;
  /** settings.operations.deviceWarrantyDays — what the shop warrants a machine for. */
  warrantyDays?: unknown;
  /** settings.operations.gpuPerformance — the reviewed frame-rate table. */
  gpuPerformance?: unknown;
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
    performance: publicPerformance(
      build,
      Array.isArray(shop.gpuPerformance) ? (shop.gpuPerformance as GpuRow[]) : [],
    ),
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
