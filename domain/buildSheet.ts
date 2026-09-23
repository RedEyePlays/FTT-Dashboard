import { BuildPart, PcBuild, PartCategory, DevicePhoto } from '../types';
import {
  CONDITION_LABEL, buildTotals, generatedItemName, retailComparison,
  retailAsOfLabel, specsLine,
} from './pcBuild';
import { mainPhoto } from './devicePhotos';

/**
 * WHAT A CUSTOMER IS ALLOWED TO SEE.
 *
 * Two printed things come out of a build: a SPEC SHEET the customer takes home,
 * and a DISPLAY CARD that sits next to the machine on the shelf. Both are
 * public documents. Neither may ever show what the shop paid, where a part came
 * from, who sold it, how many hours went into it, or what the shop makes.
 *
 * SO THE FILTER IS A TRANSFORM, NOT A RENDERING RULE. `customerParts` builds a
 * NEW object containing only the public fields — cost, sourceUrl, source and
 * the seller are not present on the value the printer is handed, so a template
 * cannot leak one by accident and a test can assert on the data rather than on
 * the markup. The same discipline the Money Trail and the Sales Ledger use for
 * a manager's rows: strip at the data layer, because a hidden column with a
 * live value underneath is a mask in name only.
 *
 * Pure: no DOM, no Firestore.
 */

/** Exactly the fields a customer may see about one part. Nothing else exists here. */
export interface CustomerPart {
  category: PartCategory;
  name: string;
  /** "New" / "Used" / "Open box". */
  condition: string;
  /** "$549.99 (as of 2026-03-04)", or null when no retail price was recorded. */
  retail: string | null;
  /** Remaining manufacturer warranty, as a date. Null when none was recorded. */
  mfrWarrantyUntil: string | null;
  /** The PCPartPicker product link, when one was pasted. */
  pcpartpickerUrl: string | null;
}

/**
 * The fields deliberately DROPPED, named so the test can assert on the list
 * rather than on a handful of remembered strings.
 */
export const PRIVATE_PART_FIELDS = ['cost', 'source', 'sourceUrl', 'serial'] as const;

/**
 * A part, stripped to what a customer may see.
 *
 * `serial` is dropped too, which is not obvious: it is the shop's link between
 * a physical card and a warranty claim, and printing it on a card that sits on
 * a shelf in a shop hands it to anyone who walks past.
 */
export const customerPart = (p: BuildPart): CustomerPart => ({
  category: p.category,
  name: (p.name || '').trim(),
  condition: CONDITION_LABEL[p.condition] || 'New',
  retail: retailAsOfLabel(p),
  mfrWarrantyUntil: p.mfrWarrantyUntil || null,
  pcpartpickerUrl: p.pcpartpickerUrl || null,
});

export const customerParts = (parts: BuildPart[]): CustomerPart[] =>
  (parts || []).map(customerPart);

/* ---------------- The take-home spec sheet ---------------- */

export interface CustomerSheet {
  name: string;
  specs: string;
  parts: CustomerPart[];
  warrantyLine: string;
  /** Shelf build: "Parts at retail $1,420 — yours for $1,050". */
  valueLine: string | null;
  /** Customer order: the quote, what has been paid, what is left. */
  order: { quote: number; deposit: number; balance: number } | null;
  price: number | null;
  /**
   * A picture of the machine, when the shop has one. Only the three fields a
   * printed page can use — a photo record also carries who took it and when,
   * and neither belongs on a customer's document.
   */
  photo: SheetPhoto | null;
}

export interface SheetPhoto {
  url: string;
  /** Labelled on the page when true, exactly as on the public listing. */
  stock: boolean;
  credit: string | null;
}

export interface SheetInput {
  build: PcBuild;
  warrantyDays: number;
  /** For a customer order, the money already collected against the quote. */
  deposit?: number;
  /** Overrides the build's own price — e.g. the device's price once it exists. */
  price?: number | null;
  /**
   * The finished device's photos (domain/devicePhotos.ts). Photos live on the
   * DEVICE a finished build becomes, not on the build, so the caller hands
   * them in rather than this module reaching into inventory.
   */
  photos?: DevicePhoto[];
}

const money = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The one photo a printed sheet uses: the same choice the app and the public
 * listing make (a real photo beats a stock one), reduced to what paper needs.
 */
export const sheetPhoto = (photos?: DevicePhoto[]): SheetPhoto | null => {
  const p = mainPhoto(photos);
  if (!p?.url) return null;
  return { url: p.url, stock: p.kind === 'stock', credit: p.credit || null };
};

export const customerSheet = (input: SheetInput): CustomerSheet => {
  const { build } = input;
  const totals = buildTotals(build);
  const price = input.price != null && input.price > 0 ? input.price : totals.price;
  const comparison = retailComparison(build, price);

  const order = build.kind === 'customer' && totals.price != null
    ? {
      quote: totals.price,
      deposit: Math.max(0, input.deposit || 0),
      balance: Math.max(0, Math.round((totals.price - (input.deposit || 0)) * 100) / 100),
    }
    : null;

  return {
    name: build.name || generatedItemName(build.parts || []),
    specs: specsLine(build.parts || []),
    parts: customerParts(build.parts || []),
    warrantyLine: input.warrantyDays > 0
      ? `${input.warrantyDays}-day warranty from FlipThatTech`
      : 'Sold as-is',
    valueLine: comparison
      ? `Parts at retail ${money(comparison.retailTotal)} — yours for ${money(comparison.price)}`
      : null,
    order,
    price: price ?? null,
    photo: sheetPhoto(input.photos),
  };
};

/* ---------------- The shelf display card ---------------- */

/**
 * The card is a different job from the sheet: the sheet is read in the hand,
 * the card is read from across the room. So it carries the headline specs and
 * the price and almost nothing else.
 *
 * A CUSTOMER ORDER GETS NO CARD. It is already somebody's machine; a card
 * advertising it to the room is the wrong object entirely.
 */
export interface DisplayCard {
  name: string;
  price: number | null;
  priceLabel: string;
  /** Null unless EVERY part has a retail price — see pcBuild.ts's retailComparison. */
  comparison: { retailTotal: string; saving: string } | null;
  /**
   * "Build it yourself at Canada Computers: $1,330".
   *
   * The comparison the shop actually wants to make. Present only when a store
   * is set on the build AND every part has a price there (or a new price to
   * fall back on) — otherwise it would be an understated total presented as a
   * complete one. Falls back to the plain retail line above when absent.
   *
   * `store` is separated from the figure so the preview can drop the NAME and
   * keep the number, for a shop that would rather not print a competitor's.
   */
  diyComparison: { store: string; total: string; saving: string | null } | null;
  /** The headline grid: one row per category that has a part. */
  specs: { category: PartCategory; name: string; condition: string | null }[];
  warrantyBadge: string | null;
  /**
   * Expected performance, at most a few lines — a shelf card is read from
   * across the room, so this is the two or three games that sell the machine,
   * not the whole table. Empty when the card has no reviewed figures.
   */
  performance: { game: string; detail: string; fps: string; measured: boolean }[];
  shopName: string;
  shopPhone: string;
}

/** How many performance lines fit on a card before it stops being readable. */
export const CARD_PERFORMANCE_LINES = 3;

export interface CardInput {
  build: PcBuild;
  /**
   * Already resolved by the caller (domain/gpuPerformance.ts's performanceFor),
   * because this module knows nothing about the shop's settings and a printed
   * card must show the same figures as the screen it was printed from.
   */
  performance?: { game: string; resolution: string; preset: string; fpsLow: number; fpsHigh: number; measured: boolean }[];
  price?: number | null;
  warrantyDays: number;
  shopName: string;
  shopPhone: string;
  /** The preview toggles — the owner may want a cleaner card. */
  showComparison?: boolean;
  showConditions?: boolean;
  /** Print the comparison figure without naming the store. */
  showStoreName?: boolean;
}

/**
 * WHICH WAY UP THE CARD PRINTS.
 *
 * Both are real layouts, not one design squeezed into the other frame: a
 * landscape card runs the specs beside the price, a portrait card stacks them.
 * Remembered per device, because a shop prints the same way every time.
 */
export type CardOrientation = 'landscape' | 'portrait';
export const CARD_ORIENTATIONS: CardOrientation[] = ['landscape', 'portrait'];
export const DEFAULT_CARD_ORIENTATION: CardOrientation = 'landscape';

/** Accepts anything (a stored string, a stale value) and gives a real one. */
export const cardOrientation = (v: unknown): CardOrientation =>
  v === 'portrait' ? 'portrait' : DEFAULT_CARD_ORIENTATION;

/** The categories the card shows, in reading order. */
export const CARD_CATEGORIES: PartCategory[] = ['CPU', 'GPU', 'RAM', 'Storage', 'PSU', 'Case'];

export const canHaveDisplayCard = (b: Pick<PcBuild, 'kind'>): boolean => b.kind === 'shelf';

export const displayCard = (input: CardInput): DisplayCard => {
  const { build } = input;
  const totals = buildTotals(build);
  const price = input.price != null && input.price > 0 ? input.price : totals.price;
  const showComparison = input.showComparison !== false;
  const comparison = showComparison ? retailComparison(build, price) : null;

  // "Build it yourself at <store>". Only when the store is set and the total
  // is complete — a partial total presented as the price of the whole machine
  // is the one misleading thing this card could do with a number.
  const diyComparison = showComparison && totals.altStoreName && totals.altStoreTotal != null
    ? {
      store: input.showStoreName === false ? '' : totals.altStoreName,
      total: money(totals.altStoreTotal),
      // Only a saving that flatters, and only against a real price — the same
      // rule retailComparison follows.
      saving: price != null && totals.altStoreTotal - price > 0
        ? money(Math.round((totals.altStoreTotal - price) * 100) / 100)
        : null,
    }
    : null;

  return {
    name: build.name || generatedItemName(build.parts || []),
    price,
    priceLabel: price != null ? money(price) : 'Ask us',
    comparison: comparison
      ? { retailTotal: money(comparison.retailTotal), saving: money(comparison.saving) }
      : null,
    diyComparison,
    specs: CARD_CATEGORIES
      .map(category => {
        const part = (build.parts || []).find(p => p.category === category);
        if (!part?.name?.trim()) return null;
        return {
          category,
          name: part.name.trim(),
          // A condition badge only where it tells the reader something. "New"
          // on every line is noise; "Used — tested" on the GPU is the fact
          // somebody wants before they ask.
          condition: input.showConditions === false || part.condition === 'new'
            ? null
            : `${CONDITION_LABEL[part.condition]} — tested`,
        };
      })
      .filter((s): s is { category: PartCategory; name: string; condition: string | null } => s !== null),
    warrantyBadge: input.warrantyDays > 0 ? `${input.warrantyDays}-day warranty` : null,
    // 1080p first, because that is what most buyers are on, and only the first
    // few — a card read from across the room cannot carry twelve lines.
    performance: (input.performance || [])
      .filter(p => p.fpsLow > 0 && p.fpsHigh > 0)
      .sort((a, b) => (a.resolution === b.resolution ? 0 : a.resolution === '1080p' ? -1 : 1))
      .slice(0, CARD_PERFORMANCE_LINES)
      .map(p => ({
        game: p.game,
        detail: `${p.resolution} · ${p.preset}`,
        fps: p.fpsLow === p.fpsHigh ? `${p.fpsLow} fps` : `${p.fpsLow}–${p.fpsHigh} fps`,
        measured: p.measured,
      })),
    shopName: input.shopName,
    shopPhone: input.shopPhone,
  };
};

/**
 * Truncate a very long part name so a card never wraps badly.
 *
 * "ASUS TUF Gaming GeForce RTX 4070 Ti SUPER OC Edition 16GB GDDR6X" is a real
 * product name and it does not fit on one line at display size. Cut at a word
 * boundary where possible — a name broken mid-word reads as a rendering fault
 * rather than as an abbreviation.
 */
export const truncateName = (name: string, max = 42): string => {
  const v = (name || '').trim();
  if (v.length <= max) return v;
  const cut = v.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
};
