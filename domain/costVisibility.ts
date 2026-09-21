import { InventoryItem } from '../types';

/**
 * "CAN'T SEE" AND "CAN'T ENTER" ARE TWO DIFFERENT RULES.
 *
 * They were collapsed into one. The inventory table is inline-editable, so
 * hiding a cost column also removed the only place to TYPE the value — which
 * meant every device an employee added looked like 100% margin until the owner
 * went back and filled the cost in by hand.
 *
 * The owner's position is unchanged and correct: staff must not see costs or
 * margins. What they must be able to do is RECORD one. So:
 *
 *   • A BLANK cost is enterable by anyone who may edit inventory.
 *   • A RECORDED cost is shown to them as "Recorded", never as a figure, and
 *     is read-only. Otherwise re-typing the field would be a way to learn it:
 *     type a number, see whether the app treats it as a change.
 *   • Derived figures — total cost, profit — stay hidden outright. They are
 *     not enterable, so there is nothing to trade off.
 *
 * Pure: no DOM, no Firestore. The table, the forms, the CSV export, the
 * mobile card and global search all ask this module rather than each deciding
 * for themselves.
 */

/** The three fields staff may RECORD but not READ. */
export const COST_ENTRY_FIELDS = ['purchaseCost', 'repairCost', 'costPerUnit'] as const;
export type CostEntryField = typeof COST_ENTRY_FIELDS[number];

/**
 * Columns that are DERIVED from cost and can never be entered, so they are
 * removed entirely rather than masked — exactly as they were before.
 */
export const DERIVED_COST_COLUMN_KEYS: readonly string[] = ['__total', '__profit'];

export const isCostEntryField = (key: string): key is CostEntryField =>
  (COST_ENTRY_FIELDS as readonly string[]).includes(key);

export const isDerivedCostColumn = (key: string): boolean =>
  DERIVED_COST_COLUMN_KEYS.includes(key);

/**
 * Every column that must not show a figure to somebody without cost access —
 * the enterable ones (masked) plus the derived ones (removed).
 *
 * Replaces the old single `isCostRevealingColumn` list, which could only
 * express "hide it".
 */
export const isCostRevealingColumn = (key: string): boolean =>
  isCostEntryField(key) || isDerivedCostColumn(key);

/* ---------------- The decision ---------------- */

export type CostAccess =
  /** Full access: see the figure and change it. */
  | 'edit'
  /** No cost access, field is blank: may type a value in, once. */
  | 'enter'
  /** No cost access, field already has a value: shows "Recorded", read-only. */
  | 'locked';

/** Is there a recorded cost in this field? 0 counts as recorded. */
export const hasRecordedCost = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/**
 * What may this person do with this cost field right now?
 *
 * A value of 0 is treated as NOT recorded, deliberately. Every inventory row
 * is created with purchaseCost/repairCost/costPerUnit defaulted to 0, so
 * treating 0 as "already recorded" would lock every existing device forever
 * and leave the original problem exactly where it was.
 */
export const costAccessFor = (canViewCost: boolean, currentValue: unknown): CostAccess => {
  if (canViewCost) return 'edit';
  return hasRecordedCost(currentValue) ? 'locked' : 'enter';
};

/** What a masked cost field shows instead of the figure. */
export const RECORDED_LABEL = 'Recorded';
export const NOT_RECORDED_LABEL = '';

/**
 * The string to render in a cost cell.
 *
 * Returns null when the caller should render the real figure itself (so the
 * formatting stays wherever it already lives). Never returns the value.
 */
export const maskedCostLabel = (canViewCost: boolean, value: unknown): string | null => {
  if (canViewCost) return null;
  return hasRecordedCost(value) ? RECORDED_LABEL : NOT_RECORDED_LABEL;
};

/* ---------------- Stripping, for anything that leaves the screen ---------------- */

/**
 * Remove every cost figure from a record before it reaches a CSV file, a
 * search subtitle, or anywhere else a value could be read off.
 *
 * MASKING A TABLE CELL IS NOT ENOUGH. The export writes raw fields, and a
 * masked column with an exportable value underneath is a mask in name only.
 */
export const stripCostFields = <T extends Record<string, unknown>>(
  row: T,
  canViewCost: boolean,
): T => {
  if (canViewCost) return row;
  const out = { ...row } as Record<string, unknown>;
  for (const f of COST_ENTRY_FIELDS) {
    if (f in out) out[f] = hasRecordedCost(out[f]) ? RECORDED_LABEL : '';
  }
  return out as T;
};

/**
 * Cost-derived figures for an item, or nulls when the viewer may not see them.
 *
 * One place decides, so the table, the card and the detail panel cannot drift
 * into disagreeing about who sees what.
 */
export const costFiguresFor = (
  item: Pick<InventoryItem, 'purchaseCost' | 'repairCost' | 'costPerUnit' | 'salePrice'>,
  canViewCost: boolean,
): { totalCost: number | null; profit: number | null } => {
  if (!canViewCost) return { totalCost: null, profit: null };
  const totalCost = (item.purchaseCost || 0) + (item.repairCost || 0);
  return {
    totalCost,
    profit: item.salePrice ? item.salePrice - totalCost : 0,
  };
};

/* ---------------- Audit ---------------- */

/**
 * Was a cost actually RECORDED by this edit (blank → a figure)?
 *
 * Only that transition is worth an audit entry of its own: it is the moment a
 * device stops looking like 100% margin, and the owner needs to be able to see
 * who supplied the number.
 */
export const isCostEntry = (field: string, before: unknown, after: unknown): boolean =>
  isCostEntryField(field) && !hasRecordedCost(before) && hasRecordedCost(after);
