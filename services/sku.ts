import { DeviceType, ItemKind, InventoryItem } from '../types';

// SKU prefix per device type; accessories/other share fixed prefixes.
export const DEVICE_TYPE_PREFIX: Record<DeviceType, string> = {
  Phone: 'PHN',
  Laptop: 'LAP',
  Tablet: 'TAB',
  Console: 'CON',
  Watch: 'WCH',
  Other: 'OTH',
};

export const skuPrefix = (kind: ItemKind, deviceType?: DeviceType): string => {
  if (kind === 'accessory') return 'ACC';
  return DEVICE_TYPE_PREFIX[deviceType || 'Other'] || 'OTH';
};

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
