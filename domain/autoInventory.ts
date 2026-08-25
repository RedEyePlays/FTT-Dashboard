import { DeviceStatus, InventoryItem, Repair, RepairBatch } from '../types';
import { DrawerEffect } from './dropoffs';

// Auto-inventory: when a device repair ticket is created under a batch with
// `autoInventory = true` (e.g. an "FTT Personal" batch — never hardcoded by
// name, always keyed off the flag), the device is added to inventory
// automatically, or attached to an existing record by IMEI/serial match
// instead of duplicating it. Pure decision logic lives here; the atomic
// create-or-attach write lives in services/firestoreDb.ts's
// commitAutoInventory (a Firestore transaction against a dedicated identity
// index, since Firestore has no server-side unique-column constraint).
//
// Schema note: this app stores one "IMEI / Serial" field per device (`imei`),
// not separate imei/serial columns. So identity matching normalizes whatever
// was entered as either a 15-digit Luhn-valid IMEI or, failing that, a plain
// serial — and a single normalized value is compared, never two independent
// fields. That also means the spec's "Case C: IMEI matches record X, serial
// matches record Y" can't arise here (there's only one field to match on) —
// every match is against the one identity value, so the decision only ever
// resolves to create-new or attach-to-the-one-match.

/** Digits-only, per the spec's IMEI normalization rule. */
const digitsOnly = (raw: string): string => (raw || '').replace(/\D/g, '');

/** Trimmed + whitespace-collapsed + uppercased, per the spec's serial rule. */
export const normalizeSerial = (raw: string): string => (raw || '').replace(/\s+/g, '').trim().toUpperCase();

/** Luhn checksum — standard IMEI validity check (ITU-T recommendation). */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = parseInt(digits[digits.length - 1 - i], 10);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export interface NormalizedIdentifier {
  normalized: string;     // the value to store/match on (imeiNormalized)
  looksLikeImei: boolean; // 15 digits after stripping non-digits
  imeiValid: boolean;     // true for a serial (Luhn n/a); false only for a 15-digit non-Luhn-valid IMEI
}

/**
 * Normalize a raw "IMEI / Serial" input for storage and matching. A value
 * that reduces to exactly 15 digits is treated as an IMEI (validated via
 * Luhn); anything else is treated as a serial (trimmed + uppercased, no
 * checksum). Blank input normalizes to an empty string.
 */
export function normalizeIdentifier(raw: string): NormalizedIdentifier {
  const digits = digitsOnly(raw);
  if (digits.length === 15) {
    return { normalized: digits, looksLikeImei: true, imeiValid: luhnValid(digits) };
  }
  return { normalized: normalizeSerial(raw), looksLikeImei: false, imeiValid: true };
}

/** The normalized identity of an inventory item, recomputed from its raw imei
 *  field (used to backfill/verify imeiNormalized — matching itself should
 *  read the stored, indexed field, not recompute it, per the spec). */
export const identifierOf = (item: Pick<InventoryItem, 'imei'>): string => normalizeIdentifier(item.imei || '').normalized;

/** First device in `inventory` whose stored imeiNormalized matches. */
export function findAutoInventoryMatch(normalized: string, inventory: InventoryItem[]): InventoryItem | undefined {
  if (!normalized) return undefined;
  return inventory.find(i => (i.kind ?? 'device') === 'device' && i.imeiNormalized === normalized);
}

export type AutoInventoryDecision =
  | { action: 'skip' }                                     // batch isn't auto_inventory
  | { action: 'noIdentifier' }                              // blank IMEI/serial
  | { action: 'invalidImei'; digits: string }               // 15 digits but fails Luhn
  | { action: 'create'; normalized: string }                // Case A
  | { action: 'attach'; match: InventoryItem; normalized: string }; // Case B

/**
 * The full decision flow from the spec, minus the DB write. Pure and
 * synchronous so every branch is directly unit-testable; the caller performs
 * the actual create/attach (atomically, via commitAutoInventory) only for the
 * 'create'/'attach' outcomes.
 */
export function decideAutoInventory(
  batch: Pick<RepairBatch, 'autoInventory'> | undefined,
  imeiRaw: string | undefined,
  inventory: InventoryItem[],
): AutoInventoryDecision {
  if (!batch?.autoInventory) return { action: 'skip' };
  if (!imeiRaw || !imeiRaw.trim()) return { action: 'noIdentifier' };

  const { normalized, looksLikeImei, imeiValid } = normalizeIdentifier(imeiRaw);
  if (looksLikeImei && !imeiValid) return { action: 'invalidImei', digits: normalized };

  const match = findAutoInventoryMatch(normalized, inventory);
  return match ? { action: 'attach', match, normalized } : { action: 'create', normalized };
}

/**
 * A wholesale device ticket's effect on today's cash drawer when it auto-
 * creates its inventory record — the ONE place that decides whether entering
 * a device's purchase cost touches the till. Only 'store' does: that's the
 * shop paying for the device out of the register right now, the same "cash
 * actually moved, log it" contract as domain/dropoffs.ts's
 * dropOffAcceptDrawerEffect and settlementDrawerEffect. 'personal' (paid
 * outside store cash) never touches the drawer — purchaseCost still applies
 * to the inventory record's cost basis, it just didn't come out of the till.
 *
 * Only relevant when THIS ticket is the one auto-creating the inventory
 * record (see decideAutoInventory's 'create' outcome) — a ticket that merely
 * attaches to an existing auto-inventory record never re-spends this cash.
 */
export function autoInventoryPurchaseDrawerEffect(
  r: Pick<Repair, 'purchaseCost' | 'purchasePaidBy'>,
): DrawerEffect | null {
  if (r.purchasePaidBy !== 'store') return null;
  const amount = Math.round((r.purchaseCost || 0) * 100) / 100;
  if (amount < 0.005) return null;
  return { kind: 'cashOut', amount };
}

/** UI-facing summary of what a save just did, for RepairsView to surface as a
 *  blocking alert ('blocked') or a save-succeeded notice ('warning' /
 *  'created' / 'attached'). Built by the App-level save handler, which is the
 *  only place with both the decision and the transaction's real outcome. */
export type AutoInventoryNotice =
  | { kind: 'blocked'; message: string }
  | { kind: 'warning'; message: string }
  | { kind: 'created'; sku: string }
  | { kind: 'attached'; sku: string; previousStatus?: DeviceStatus };
