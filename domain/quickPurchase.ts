import { InventoryItem } from '../types';
import { DrawerEffect } from './dropoffs';
import { normalizeIdentifier } from './autoInventory';

// Quick Purchase: a fast, minimal-friction way to log buying a device with
// store cash (or personal money) at the counter — the buying-side
// counterpart to Quick Sale. Pure decision/builder logic lives here; App.tsx
// wires it to a real inventory write + (when store-paid) a drawer cash-out,
// same pattern as the FTT Personal repair purchase-cost feature
// (domain/autoInventory.ts's autoInventoryPurchaseDrawerEffect).

// Same 'store' | 'personal' vocabulary as RepairPurchasePaidBy (types.ts) —
// 'store' hits the cash drawer right now; 'personal' never touches it.
export type QuickPurchasePaidBy = 'store' | 'personal';

export interface QuickPurchaseInput {
  device: string;
  imei?: string;
  purchaseCost: number;
  paidBy: QuickPurchasePaidBy;
  boughtFrom?: string;
  // Optional, available on the same screen (not a second step) — left blank
  // behaves exactly as it does on the plain Add Item form: fillable later.
  storage?: string;
  color?: string;
  batteryHealth?: string;
  targetSalePrice?: number;
}

/**
 * Build the inventory record a Quick Purchase save creates: status 'ready'
 * (available for sale immediately), same as a normal Add Item save — never a
 * pending/in-repair state, since Quick Purchase has no repair step. The
 * device's identity is normalized and stored on imeiNormalized right away
 * (regular Add Item currently does not backfill this field, but there's no
 * reason a freshly-created record shouldn't carry it correctly from the
 * start) so a later auto-inventory ticket or another Quick Purchase can
 * actually find this record by IMEI/serial.
 */
export function buildQuickPurchaseItem(
  input: QuickPurchaseInput,
  ids: { id: string; sku: string },
  dateISO: string,
): InventoryItem {
  const imei = (input.imei || '').trim();
  const { normalized } = normalizeIdentifier(imei);
  return {
    id: ids.id, kind: 'device', sku: ids.sku, date: dateISO,
    item: input.device.trim(), imei,
    imeiNormalized: normalized || undefined,
    boughtFrom: (input.boughtFrom || '').trim(),
    purchaseCost: Math.max(0, input.purchaseCost || 0), repairCost: 0,
    soldDate: '', soldTo: '', salePrice: 0, notes: '',
    condition: 'Good', deviceStatus: 'ready',
    storage: input.storage?.trim() || undefined,
    color: input.color?.trim() || undefined,
    batteryHealth: input.batteryHealth?.trim() || undefined,
    targetSalePrice: input.targetSalePrice && input.targetSalePrice > 0 ? input.targetSalePrice : undefined,
  };
}

/**
 * The drawer effect of a Quick Purchase — mirrors
 * autoInventoryPurchaseDrawerEffect's exact rule: only a store-paid purchase
 * touches the till, right now; a personal purchase never does, even though
 * purchaseCost still applies to the record's cost basis.
 */
export function quickPurchaseDrawerEffect(
  purchaseCost: number | undefined,
  paidBy: QuickPurchasePaidBy | undefined,
): DrawerEffect | null {
  if (paidBy !== 'store') return null;
  const amount = Math.round((purchaseCost || 0) * 100) / 100;
  if (amount < 0.005) return null;
  return { kind: 'cashOut', amount };
}

/**
 * Hard-validation error for the entered IMEI/serial — a 15-digit value that
 * fails the Luhn checksum, same rule the auto-inventory ticket flow blocks
 * on (decideAutoInventory's 'invalidImei'). Blank input is never an error:
 * IMEI/serial is optional at this stage. Anything that isn't exactly 15
 * digits is treated as a plain serial and never checksum-validated.
 */
export function quickPurchaseImeiError(imeiRaw: string | undefined): string | null {
  if (!imeiRaw || !imeiRaw.trim()) return null;
  const { looksLikeImei, imeiValid, normalized } = normalizeIdentifier(imeiRaw);
  if (looksLikeImei && !imeiValid) {
    return `IMEI "${normalized}" fails the checksum check — fix the entry or clear the IMEI/serial field.`;
  }
  return null;
}
