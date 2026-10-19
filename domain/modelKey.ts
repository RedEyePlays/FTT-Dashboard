import { InventoryItem } from '../types';

/**
 * A COUNTABLE MODEL KEY, SO "HOW MANY 15 PRO MAX IN STOCK" CAN BE COUNTED.
 *
 * THE PROBLEM. Asked "how many 15pm in stock" the assistant said it had only a
 * summary — 162 devices, no breakdown. It was honest and useless, and it could
 * not have done better: the word search reads the newest 40 rows and keeps 12,
 * so with 162 devices in stock it sees a slice. It can list examples. It can
 * never say HOW MANY.
 *
 * Counting has to happen the way businessSummary already counts: a Firestore
 * `count()` aggregation, which reads no documents. But Firestore has no
 * substring match, and `item` is free text ("Product Name/Model"), so there is
 * nothing to equality-match on. Hence this field.
 *
 * WHY A STORED KEY AND NOT A PREFIX RANGE on `item`. A prefix range
 * (`item >= q`, `item < q + '\\uf8ff'`) needs the model name to be the START of
 * `item`, and in this data it reliably is not:
 *
 *   • The ONE code path that constructs `item` writes `[brand, model]` joined
 *     (App.tsx's IMEI-scan intake) — "Apple iPhone 15 Pro Max". A prefix range
 *     on "iPhone 15 Pro Max" matches NONE of those.
 *   • Every other path is free text: the entry form and the inventory grid
 *     start it blank for a human to type, checkout copies a sale line's name,
 *     and AI bulk entry fills it from "Name of the product" with no shape
 *     imposed.
 *   • Firestore range matching is case- and accent-sensitive, so a row typed
 *     "iphone 15 pro max" would not match "iPhone…" either.
 *
 * It would therefore fail QUIETLY — returning a plausible small number instead
 * of an error — which is the one outcome worse than refusing to answer. So the
 * key is normalised and stored, and the counting path reports how many rows
 * are not yet keyed rather than letting them go silently missing.
 *
 * Pure: no Firestore. Mirrored by functions/src/ai/modelKey.ts, which is the
 * copy the server counts with — the two are separate TypeScript projects (the
 * pattern documented in functions/src/showroomPolicy.ts).
 */

/**
 * Fold a model name to a comparable key.
 *
 * Lower-cased, punctuation dropped, whitespace collapsed to nothing. Squashing
 * spaces is what makes "iPhone 15 Pro Max", "iphone15 promax" and
 * "iPhone-15-Pro-Max" one key, which is the actual variation in typed stock.
 */
export const normalizeModelName = (raw: unknown): string =>
  (typeof raw === 'string' ? raw : '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();

/**
 * Words the key drops, because they vary per unit and would split one model
 * into a dozen keys.
 *
 * Storage, colour and condition are NOT part of a model: "iPhone 15 Pro Max
 * 256GB Blue" and "iPhone 15 Pro Max 512GB Black" are the same model, and the
 * owner asking "how many 15 Pro Max" means both. Capacity and colour are
 * already their own fields and are searchable through the existing word path.
 */
const NOISE = [
  /\b\d+\s?(gb|tb|mb)\b/g,
  /\b(unlocked|locked|dual\s?sim|esim|5g|4g|lte)\b/g,
  /\b(new|used|refurb(ished)?|open\s?box|pulled|mint|good|fair|poor|cracked|broken)\b/g,
  /\b(black|white|silver|gold|grey|gray|blue|red|green|purple|pink|yellow|titanium|graphite|midnight|starlight|natural|desert)\b/g,
];

const stripNoise = (s: string): string => {
  let out = ` ${s.toLowerCase()} `;
  for (const re of NOISE) out = out.replace(re, ' ');
  return out.replace(/\s+/g, ' ').trim();
};

/**
 * THE KEY FOR ONE STOCK ROW.
 *
 * Built from `model` when the row has one, since that is the field that means
 * exactly this; otherwise from `item` with the brand and the per-unit noise
 * stripped. Returns '' when there is nothing to key on, and a row with no key
 * is COUNTED AS UNKEYED rather than silently omitted (see
 * functions/src/ai/context.ts's modelCounts).
 *
 * Accessories are deliberately not keyed: "how many 15 Pro Max" is a question
 * about devices, and an accessory's `item` is a product name with no model
 * behind it.
 */
export const modelKeyOf = (
  row: Pick<InventoryItem, 'item' | 'model' | 'brand' | 'kind'>,
): string => {
  if (row.kind === 'accessory') return '';
  const model = typeof row.model === 'string' ? row.model.trim() : '';
  if (model) return normalizeModelName(stripNoise(model));

  // No `model` field: fall back to `item`, minus the brand it is usually
  // prefixed with, so "Apple iPhone 15 Pro Max" keys the same as a row whose
  // model field says "iPhone 15 Pro Max".
  const item = typeof row.item === 'string' ? row.item.trim() : '';
  if (!item) return '';
  const brand = typeof row.brand === 'string' ? row.brand.trim() : '';
  const withoutBrand = brand
    ? item.replace(new RegExp(`^\\s*${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i'), '')
    : item;
  return normalizeModelName(stripNoise(withoutBrand || item));
};

/**
 * Stamp the key on a row about to be saved.
 *
 * Called at the single save chokepoint so every path — the form, the grid, the
 * scanner, checkout, a restore — gets one without each remembering to. An
 * existing row is re-keyed on every save, so correcting a typo in `model`
 * fixes the count too.
 */
export const withModelKey = <T extends Pick<InventoryItem, 'item' | 'model' | 'brand' | 'kind'>>(
  row: T,
): T & { modelKey?: string } => {
  const key = modelKeyOf(row);
  // Omitted rather than stored empty: `modelKey >= ''` is how the server
  // counts how many rows ARE keyed, and an empty string would make an
  // unkeyable accessory look keyed.
  if (!key) {
    const { modelKey: _drop, ...rest } = row as T & { modelKey?: string };
    return rest as T & { modelKey?: string };
  }
  return { ...row, modelKey: key };
};
