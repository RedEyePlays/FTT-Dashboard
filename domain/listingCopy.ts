import { InventoryItem, PcBuild } from '../types';
import { buildTotals, CONDITION_LABEL, specsLine } from './pcBuild';
import { shareAdLine } from './shareLink';

/**
 * THE LISTING GENERATOR — WHAT THE MODEL IS TOLD.
 *
 * The shop writes the same Marketplace advert forty times a month and it is
 * the dullest part of the job. A model is good at that. It is also good at
 * saying "mint condition, 100% battery health, like new" about a phone nobody
 * showed it, which for a registered business selling to consumers is not a
 * style problem.
 *
 * SO THE MODEL NEVER SEES A RECORD. It sees a FACTS object built here, field
 * by field, from an allow-list — the same discipline as the public build page
 * and the kiosk (functions/src/publicBuildPolicy.ts, showroomPolicy.ts), and
 * for a stronger reason: this output is published under the shop's name.
 *
 * What is NOT on the facts object, and therefore cannot be written into an
 * advert by accident: cost, repair cost, margin, profit, target price, where
 * the item came from, who sold it, any customer, any staff member, IMEI,
 * serial, SKU, internal notes and internal status.
 *
 * Pure: no DOM, no Firestore, no model.
 */

export type ListingPlatform = 'facebook' | 'kijiji' | 'ebay' | 'generic';
export type ListingLength = 'short' | 'standard';

/**
 * The platforms a LISTING can be WRITTEN for.
 *
 * Deliberately not domain/listing.ts's LISTING_PLATFORMS, which is a different
 * list for a different job — that one is "where is this device also listed
 * right now", a stock-safety flag with Best Buy on it. This one is "who is the
 * copy being written for", which changes tone and length and nothing else.
 */
export const LISTING_COPY_PLATFORMS: { value: ListingPlatform; label: string }[] = [
  { value: 'facebook', label: 'Facebook Marketplace' },
  { value: 'kijiji', label: 'Kijiji' },
  { value: 'ebay', label: 'eBay' },
  { value: 'generic', label: 'Generic' },
];

export interface ListingOptions {
  platform: ListingPlatform;
  length: ListingLength;
  /**
   * Put the price in the DESCRIPTION. Off by default: every platform has its
   * own price field, the shop fills that, and a price in two places is a price
   * that disagrees with itself the first time one of them changes.
   */
  includePrice?: boolean;
  /**
   * Mark used and open-box parts in the spec list. OFF by default — see
   * NEW_CLAIM_WORDS: with it off the listing must still never imply the parts
   * are new.
   */
  markUsedParts?: boolean;
}

export const DEFAULT_LISTING_OPTIONS: ListingOptions = {
  platform: 'facebook', length: 'standard', includePrice: false, markUsedParts: false,
};

/* ---------------- The facts ---------------- */

export interface DeviceFacts {
  kind: 'device';
  brand?: string;
  model?: string;
  storage?: string;
  colour?: string;
  /** Plain words, never a grade code — see plainCondition. */
  condition?: string;
  batteryHealth?: string;
  warrantyDays: number;
  price?: number;
  /** Whether the listing can promise photos. Never the photos themselves. */
  hasPhotos: boolean;
  shareLine?: string;
}

export interface ListingPart {
  category: string;
  name: string;
  /** Present ONLY when the owner asked for used parts to be marked. */
  condition?: string;
}

export interface PerformanceFact {
  game: string;
  resolution: string;
  preset: string;
  fpsLow: number;
  fpsHigh: number;
  /** True when the shop measured it on this machine. */
  measured: boolean;
}

export interface BuildFacts {
  kind: 'build';
  name: string;
  specs: string;
  parts: ListingPart[];
  warrantyDays: number;
  price?: number;
  /** Carried ONLY when every part is priced — see buildTotals. */
  comparisonTotal?: number;
  comparisonStore?: string;
  shareLine?: string;
  /** Empty when the GPU has no reviewed rows. Never improvised. */
  performance: PerformanceFact[];
  /** Did every part come in new? Decides whether "new" may be said at all. */
  allPartsNew: boolean;
}

export type ListingFacts = DeviceFacts | BuildFacts;

/**
 * EVERY KEY A FACTS OBJECT MAY CARRY.
 *
 * The structural test walks what is produced against these lists, so a field
 * added to the interface without being added here fails the build rather than
 * being quietly sent to a model and published.
 */
export const DEVICE_FACT_KEYS = [
  'kind', 'brand', 'model', 'storage', 'colour', 'condition', 'batteryHealth',
  'warrantyDays', 'price', 'hasPhotos', 'shareLine',
] as const;

export const BUILD_FACT_KEYS = [
  'kind', 'name', 'specs', 'parts', 'warrantyDays', 'price',
  'comparisonTotal', 'comparisonStore', 'shareLine', 'performance', 'allPartsNew',
] as const;

export const PART_FACT_KEYS = ['category', 'name', 'condition'] as const;
export const PERFORMANCE_FACT_KEYS = ['game', 'resolution', 'preset', 'fpsLow', 'fpsHigh', 'measured'] as const;

/** Named so the test says what it is protecting, not merely that a shape matched. */
export const FORBIDDEN_FACT_FIELDS = [
  'purchaseCost', 'repairCost', 'cost', 'partsCost', 'labour', 'labourCost', 'totalCost',
  'profit', 'margin', 'marginPercent', 'targetSalePrice', 'targetPrice', 'quotePrice',
  'imei', 'serial', 'sku', 'id', 'boughtFrom', 'purchaseSource', 'source', 'sourceUrl',
  'customerId', 'customerName', 'customerPhone', 'soldTo', 'createdBy', 'createdByEmail',
  'notes', 'status', 'deviceStatus', 'inventoryId', 'shareToken',
] as const;

const str = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || undefined;
};
const pos = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : undefined;

/**
 * A grade code means nothing to a buyer, and "Fair" means whatever they fear
 * most. The same wording the counter kiosk uses, deliberately: a customer who
 * reads "Good — light scratches" on the tablet and then on Marketplace is
 * reading the shop being consistent.
 */
const CONDITION_WORDS: Record<string, string> = {
  New: 'Brand new, sealed',
  'Like New': 'Like new — no marks',
  Excellent: 'Excellent — barely a mark',
  Good: 'Good — light scratches',
  Fair: 'Fair — visible wear',
  'For Parts': 'Sold as-is, for parts',
};

export const plainCondition = (grade: unknown): string | undefined =>
  CONDITION_WORDS[typeof grade === 'string' ? grade.trim() : ''];

export interface FactsInput {
  warrantyDays: number;
  options: ListingOptions;
  /** The build's share code, when it has one. */
  shareCode?: string;
}

export const deviceFacts = (item: InventoryItem, input: FactsInput): DeviceFacts => {
  const out: DeviceFacts = {
    kind: 'device',
    warrantyDays: Math.max(0, Math.round(input.warrantyDays || 0)),
    hasPhotos: (item.photos || []).length > 0,
  };
  const brand = str(item.brand);
  if (brand) out.brand = brand;
  const model = str(item.model) || str(item.item);
  if (model) out.model = model;
  const storage = str(item.storage);
  if (storage) out.storage = storage;
  const colour = str(item.color);
  if (colour) out.colour = colour;
  const condition = plainCondition(item.condition);
  if (condition) out.condition = condition;
  const battery = str(item.batteryHealth);
  if (battery) out.batteryHealth = battery;
  if (input.options.includePrice) {
    const price = pos(item.targetSalePrice);
    if (price != null) out.price = price;
  }
  if (input.shareCode) out.shareLine = shareAdLine(input.shareCode);
  return out;
};

export const buildFacts = (build: PcBuild, input: FactsInput & {
  performance?: PerformanceFact[];
  /** Overrides the build's own price, e.g. the finished device's. */
  price?: number | null;
}): BuildFacts => {
  const totals = buildTotals(build);
  const parts = (build.parts || [])
    .filter(p => str(p.name))
    .map(p => {
      const row: ListingPart = { category: p.category, name: p.name.trim() };
      // The condition marker is carried ONLY when the owner asked for it, and
      // "New" is never a marker — a badge saying New beside three unbadged
      // parts implies the others are not, which is the same claim backwards.
      if (input.options.markUsedParts && p.condition !== 'new') {
        row.condition = CONDITION_LABEL[p.condition];
      }
      return row;
    });

  const price = input.price != null && input.price > 0 ? Math.round(input.price * 100) / 100 : totals.price;

  const out: BuildFacts = {
    kind: 'build',
    name: (build.name || 'Custom PC').trim(),
    specs: specsLine(build.parts || []),
    parts,
    warrantyDays: Math.max(0, Math.round(input.warrantyDays || 0)),
    performance: input.performance || [],
    // Every part new, and there is at least one part. An empty build is not
    // "all new" — it is nothing, and it must not unlock the word.
    allPartsNew: (build.parts || []).length > 0 && (build.parts || []).every(p => p.condition === 'new'),
  };
  if (input.options.includePrice && price != null) out.price = price;
  // The comparison rides along ONLY when it is complete, because a total from
  // some of the parts is a different number wearing the same label.
  if (totals.altStoreTotal != null && totals.altStoreName) {
    out.comparisonTotal = totals.altStoreTotal;
    out.comparisonStore = totals.altStoreName;
  } else if (totals.retailComplete && totals.retailTotal > 0) {
    out.comparisonTotal = totals.retailTotal;
  }
  if (input.shareCode) out.shareLine = shareAdLine(input.shareCode);
  return out;
};

/* ---------------- Checking what came back ---------------- */

/**
 * THE NUMBER CHECK.
 *
 * Every number in the output must have been in the input. That is what stops
 * "256GB" appearing on a 128GB phone, "94% battery health" on a device whose
 * battery was never measured, and a warranty length nobody offered.
 *
 * WHAT IT CANNOT CATCH, stated plainly because the gap matters:
 *   • a false claim with no number in it — "mint", "never dropped", "one
 *     owner". The prompt forbids these and the NEW_CLAIM_WORDS check catches
 *     the most dangerous family, but prose is prose;
 *   • a number recombined wrongly from two real ones ("32GB" from a 32GB RAM
 *     fact used to describe storage). The number was in the input, so this
 *     passes. It is why the generated text is EDITABLE and never auto-posted;
 *   • years and model numbers that are part of a name ("RTX 4070") — those
 *     come from the facts, so they pass, which is correct.
 *
 * Years like 2026 and ordinary list numbering are not treated as claims.
 */
export const numbersIn = (text: string): string[] =>
  (text.match(/\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(/,/g, ''));

export interface OutputCheck {
  ok: boolean;
  /** Numbers in the output that were never in the facts. */
  invented: string[];
  /** A "new"-implying word used on a machine that is not all new. */
  impliedNew?: string;
}

/**
 * Words that assert the goods are NEW.
 *
 * With "mark used parts" off, the spec list carries model names and no
 * condition markers — which is fine, and is not the same as claiming they are
 * new. Saying "brand new" on a machine with a used GPU is a different thing
 * entirely: the shop is a registered business selling to consumers, and an
 * implied-new claim is a consumer-protection problem, not a style one.
 *
 * So it is enforced HERE, on the output, not merely asked for in the prompt.
 */
export const NEW_CLAIM_WORDS = ['brand new', 'brand-new', 'sealed', 'unopened', 'new in box', 'nib', 'bnib'];

/** Allowed even on a used machine, because they are about the work, not the parts. */
export const NEUTRAL_FRAMING = 'Custom built and tested in-shop.';

export const checkListingOutput = (
  facts: ListingFacts,
  output: { title: string; description: string },
): OutputCheck => {
  const text = `${output.title}\n${output.description}`;
  const allowed = new Set(numbersIn(JSON.stringify(factNumbersSource(facts))));
  // Years and small ordinals are noise, not claims: "2026", "1." in a list.
  const invented = numbersIn(text).filter(n => {
    if (allowed.has(n)) return false;
    const value = parseFloat(n);
    if (Number.isInteger(value) && value >= 1 && value <= 12) return false;    // list numbering
    if (Number.isInteger(value) && value >= 1990 && value <= 2100) return false; // a year
    return true;
  });

  const check: OutputCheck = { ok: invented.length === 0, invented };

  const allNew = facts.kind === 'build' ? facts.allPartsNew : facts.condition === CONDITION_WORDS.New;
  if (!allNew) {
    const lower = text.toLowerCase();
    // Word-boundary matched: "renewed" must not fire, and neither must a part
    // called "Newegg".
    const hit = NEW_CLAIM_WORDS.find(w => new RegExp(`\\b${w.replace(/[-\s]/g, '[-\\s]')}\\b`).test(lower));
    if (hit) { check.impliedNew = hit; check.ok = false; }
  }
  return check;
};

/**
 * The facts a number may legitimately come from.
 *
 * Stringifying the whole object would also license `warrantyDays: 90` to
 * appear as a price, which is a trade we accept — the alternative is a
 * per-field check that rejects correct listings constantly. The point of the
 * check is inventions, not provenance.
 */
const factNumbersSource = (facts: ListingFacts): unknown => facts;
