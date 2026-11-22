import { DeviceStatus, DeviceType, InventoryItem, ItemKind } from '../types';
import { normalizeForLookup, sameIdentifier } from './identifierSearch';

/**
 * IMPORTING A CSV MATCHES EXISTING ITEMS INSTEAD OF DUPLICATING THEM.
 *
 * THE TRAP THIS REMOVES. `importCSV` built every row as a brand new record —
 * `id: uid()`, straight to `onSave` — and never looked for an existing item.
 * So the obvious move in the wholesale workflow (export, mark up in Excel,
 * import back) DOUBLED the inventory, leaving two records carrying the same
 * SKU and the same IMEI, with nothing said to anybody. On a 640-row
 * workspace that is a bad afternoon, and the only reason the shop had not hit
 * it is that they had not tried it yet.
 *
 * MATCHING REUSES domain/identifierSearch.ts. That module already decides
 * whether two strings name the same physical thing, forgivingly enough for
 * codes that arrive off label printers and spreadsheets ("FTT-0142" vs
 * "ftt0142" vs "FTT 0142"). A third copy of that judgement is exactly what it
 * exists to prevent.
 *
 * Pure: no DOM, no Firestore, no id generation. The caller applies the plan.
 */

export type ImportRow = Record<string, string>;

/** Why a row could not be applied. Reported, never guessed at. */
export type ImportConflictReason = 'sku-imei-mismatch' | 'ambiguous-match';

export const CONFLICT_MESSAGE: Record<ImportConflictReason, string> = {
  'sku-imei-mismatch': 'SKU matches a different device\'s IMEI/serial',
  'ambiguous-match': 'matches more than one item',
};

export type ImportOutcome =
  | { kind: 'update'; row: ImportRow; existing: InventoryItem }
  | { kind: 'create'; row: ImportRow }
  | { kind: 'conflict'; row: ImportRow; existing?: InventoryItem; reason: ImportConflictReason };

export interface ImportPlan {
  outcomes: ImportOutcome[];
  updates: number;
  creates: number;
  conflicts: number;
}

/**
 * FIELDS AN IMPORT MAY NEVER WRITE.
 *
 *   id, kind, imeiNormalized — identity and derived index. Changing the first
 *     two by spreadsheet is not editing an item, it is replacing one;
 *     `imeiNormalized` is recomputed from `imei` on write and must never be
 *     typed in by hand.
 *   sku — the match key and the shop's own identity for the item. An import
 *     corrects the fields of a device; it does not rename it. (A row whose
 *     SKU names nothing is a new item, which does get the SKU it carries.)
 *   soldDate, soldTo, salePrice — a SALE. These are written by a real
 *     checkout with money attached, and App.tsx's `applyDirectSale` stamps a
 *     device sold the moment `salePrice` is set — so without this, a
 *     round-tripped export carrying its own sale columns could mark stock
 *     sold, or resurrect a sale, from a spreadsheet. That is the one thing an
 *     import must not be able to do.
 */
export const IMPORT_PROTECTED_FIELDS = [
  'id', 'kind', 'imeiNormalized', 'sku', 'soldDate', 'soldTo', 'salePrice',
] as const;

/** Numeric columns, so a present-but-empty cell becomes 0 rather than NaN. */
const NUMERIC_FIELDS = new Set([
  'purchaseCost', 'repairCost', 'targetSalePrice', 'minSalePrice',
  'quantity', 'costPerUnit', 'sellingPrice', 'lowStockThreshold',
]);

const isProtected = (k: string) => (IMPORT_PROTECTED_FIELDS as readonly string[]).includes(k);

/* ---------------- Which existing item a row is ---------------- */

/** The identifiers a row carries, however the spreadsheet spelled them. */
export const rowSku = (r: ImportRow): string => (r.sku || '').trim();
export const rowImei = (r: ImportRow): string => (r.imei || '').trim();

/**
 * THE ROW'S IDENTITY, and the one case it refuses to guess at.
 *
 * In order:
 *   • SKU names an existing item → that item, UNLESS the row also carries an
 *     IMEI/serial that is not that item's. Then it is a CONFLICT: two
 *     identifiers pointing at two different devices is a file that has been
 *     edited wrongly, or rows that got shuffled in a spreadsheet, and the
 *     wrong answer here overwrites a real device with another one's data.
 *     Reported and skipped; never merged.
 *   • no SKU match, but the IMEI/serial names one → that item. (The buyer may
 *     return a list with only serials on it.)
 *   • neither → a new item, exactly as before.
 *
 * More than one match either way is also a conflict rather than a coin toss.
 */
export const matchImportRow = (row: ImportRow, inventory: InventoryItem[]): ImportOutcome => {
  const sku = rowSku(row);
  const imei = rowImei(row);

  if (sku) {
    const bySku = inventory.filter(i => sameIdentifier(i.sku, sku));
    if (bySku.length > 1) return { kind: 'conflict', row, reason: 'ambiguous-match' };
    if (bySku.length === 1) {
      const existing = bySku[0];
      // Only a disagreement counts. A row with no IMEI, or an item that has
      // none recorded, says nothing either way and is not a conflict.
      if (imei && existing.imei && !sameIdentifier(existing.imei, imei)) {
        return { kind: 'conflict', row, existing, reason: 'sku-imei-mismatch' };
      }
      return { kind: 'update', row, existing };
    }
  }

  if (imei) {
    const q = normalizeForLookup(imei);
    const byImei = inventory.filter(i =>
      sameIdentifier(i.imei, imei)
      || (!!i.imeiNormalized && normalizeForLookup(i.imeiNormalized) === q)
      || sameIdentifier(i.manufacturerBarcode, imei));
    if (byImei.length > 1) return { kind: 'conflict', row, reason: 'ambiguous-match' };
    if (byImei.length === 1) return { kind: 'update', row, existing: byImei[0] };
  }

  return { kind: 'create', row };
};

/** Every row's outcome, plus the counts the preview shows before committing. */
export const planImport = (rows: ImportRow[], inventory: InventoryItem[]): ImportPlan => {
  const outcomes = rows.map(r => matchImportRow(r, inventory));
  return {
    outcomes,
    updates: outcomes.filter(o => o.kind === 'update').length,
    creates: outcomes.filter(o => o.kind === 'create').length,
    conflicts: outcomes.filter(o => o.kind === 'conflict').length,
  };
};

/* ---------------- Applying a row to an existing item ---------------- */

/**
 * A COLUMN THAT IS NOT IN THE FILE IS NOT A CHANGE.
 *
 * This is the whole reason the update is built from the row's KEYS rather
 * than from a fixed field list. The buyer-safe export deliberately carries no
 * cost columns; a partial sheet somebody built by hand carries whatever they
 * typed. Writing every known field from such a file would silently blank the
 * purchase cost of everything in it — turning a helpful round-trip into data
 * loss of a different shape from the one being fixed.
 *
 * A column that IS present and empty is a deliberate clearing — the owner
 * deleted a note in Excel and expects the note gone. That is safe precisely
 * because the fields where a blank would be destructive are protected above.
 */
export const applyImportRow = (existing: InventoryItem, row: ImportRow): InventoryItem => {
  const next: Record<string, unknown> = { ...existing };
  for (const key of Object.keys(row)) {
    if (isProtected(key)) continue;
    const raw = row[key];
    if (raw === undefined) continue;
    next[key] = NUMERIC_FIELDS.has(key) ? (parseFloat(raw) || 0) : raw;
  }
  return next as unknown as InventoryItem;
};

/** The fields of `existing` this row would actually change — for the preview. */
export const importRowChanges = (existing: InventoryItem, row: ImportRow): string[] => {
  const after = applyImportRow(existing, row) as unknown as Record<string, unknown>;
  const before = existing as unknown as Record<string, unknown>;
  return Object.keys(row)
    .filter(k => !isProtected(k))
    .filter(k => String(before[k] ?? '') !== String(after[k] ?? ''));
};

/* ---------------- The new-item shape ---------------- */

/**
 * A brand new item from a row, exactly as the importer always built one —
 * the only change is that it is now reached only when nothing matched.
 * `sku` is supplied by the caller (it may have to allocate one).
 */
export const newImportedItem = (row: ImportRow, kind: ItemKind, id: string, sku: string, todayISO: string): InventoryItem => {
  const num = (v: string) => parseFloat(v) || 0;
  return {
    id, kind, sku,
    date: row.date || todayISO, item: row.item || '', imei: row.imei || '', boughtFrom: row.boughtFrom || '',
    purchaseCost: num(row.purchaseCost), repairCost: num(row.repairCost), soldDate: row.soldDate || '',
    soldTo: row.soldTo || '', salePrice: num(row.salePrice), notes: row.notes || '',
    ...(kind === 'device' ? {
      deviceType: (row.deviceType as DeviceType) || 'Phone', brand: row.brand, model: row.model, storage: row.storage,
      color: row.color, batteryHealth: row.batteryHealth, condition: row.condition || 'Good', purchaseSource: row.purchaseSource,
      targetSalePrice: num(row.targetSalePrice), deviceStatus: (row.deviceStatus as DeviceStatus) || 'ready',
    } : {
      manufacturerBarcode: row.manufacturerBarcode, category: row.category, quantity: num(row.quantity),
      costPerUnit: num(row.costPerUnit), sellingPrice: num(row.sellingPrice), lowStockThreshold: num(row.lowStockThreshold) || 3,
    }),
  } as InventoryItem;
};

/** One line of the preview: "12 to update, 3 new, 1 conflict". */
export const describeImportPlan = (p: ImportPlan): string => {
  const bits = [
    `${p.updates} to update`,
    `${p.creates} new`,
    ...(p.conflicts ? [`${p.conflicts} conflict${p.conflicts === 1 ? '' : 's'} (skipped)`] : []),
  ];
  return bits.join(' · ');
};
