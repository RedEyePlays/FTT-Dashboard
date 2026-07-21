import { DeviceType, ItemKind, InventoryItem } from '../types';

// Neutral, sequential SKU prefix for ALL new inventory (devices + accessories).
// Previously SKUs were namespaced per device type (PHN-, LAP-, ACC-, …); new
// items now share one running counter under this prefix, e.g. FTT-000001.
export const INVENTORY_SKU_PREFIX = 'FTT';

// New items get a neutral sequential SKU regardless of kind/device type.
// Existing SKUs (legacy prefixes) are stored as-is and display unchanged — only
// newly generated SKUs use INVENTORY_SKU_PREFIX. The signature is unchanged so
// callers/tests stay stable; the kind/deviceType args are intentionally ignored.
export const skuPrefix = (_kind: ItemKind, _deviceType?: DeviceType): string => INVENTORY_SKU_PREFIX;

export const formatSku = (prefix: string, n: number): string =>
  `${prefix}-${String(n).padStart(6, '0')}`;

/**
 * Generate the next unique SKU for a prefix using a monotonic counter map.
 * Returns the new SKU plus the updated counters (never reuses a number, even
 * after deletion). Also skips any number already present on an item, as a guard.
 */
export const nextSku = (
  prefix: string,
  counters: Record<string, number>,
  existing: InventoryItem[]
): { sku: string; counters: Record<string, number> } => {
  const used = new Set(existing.map(i => i.sku).filter(Boolean) as string[]);
  let n = (counters[prefix] || 0) + 1;
  let sku = formatSku(prefix, n);
  while (used.has(sku)) {
    n += 1;
    sku = formatSku(prefix, n);
  }
  return { sku, counters: { ...counters, [prefix]: n } };
};
