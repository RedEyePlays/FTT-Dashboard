import { BuildPart, PcBuild, PartCategory } from '../types';
import {
  CONDITION_LABEL, buildTotals, generatedItemName, retailComparison,
  retailAsOfLabel, specsLine,
} from './pcBuild';

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
}

export interface SheetInput {
  build: PcBuild;
  warrantyDays: number;
  /** For a customer order, the money already collected against the quote. */
  deposit?: number;
  /** Overrides the build's own price — e.g. the device's price once it exists. */
  price?: number | null;
}

const money = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  /** The headline grid: one row per category that has a part. */
  specs: { category: PartCategory; name: string; condition: string | null }[];
  warrantyBadge: string | null;
  shopName: string;
  shopPhone: string;
}

export interface CardInput {
  build: PcBuild;
  price?: number | null;
  warrantyDays: number;
  shopName: string;
  shopPhone: string;
  /** The preview toggles — the owner may want a cleaner card. */
  showComparison?: boolean;
  showConditions?: boolean;
}

/** The categories the card shows, in reading order. */
export const CARD_CATEGORIES: PartCategory[] = ['CPU', 'GPU', 'RAM', 'Storage', 'PSU', 'Case'];

export const canHaveDisplayCard = (b: Pick<PcBuild, 'kind'>): boolean => b.kind === 'shelf';

export const displayCard = (input: CardInput): DisplayCard => {
  const { build } = input;
  const totals = buildTotals(build);
  const price = input.price != null && input.price > 0 ? input.price : totals.price;
  const comparison = input.showComparison === false ? null : retailComparison(build, price);

  return {
    name: build.name || generatedItemName(build.parts || []),
    price,
    priceLabel: price != null ? money(price) : 'Ask us',
    comparison: comparison
      ? { retailTotal: money(comparison.retailTotal), saving: money(comparison.saving) }
      : null,
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
