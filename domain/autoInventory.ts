import { DeviceStatus, InventoryItem, Repair, RepairBatch } from '../types';
import { DrawerEffect } from './dropoffs';

// Auto-inventory: when a device repair ticket is created under a `private`
// batch (e.g. an "FTT Personal" batch — never hardcoded by name, always keyed
// off the flag) AND that specific ticket has wantsAutoInventory on, the
// device is added to inventory automatically, or attached to an existing
// record by IMEI/serial match instead of duplicating it. Both conditions are
// required: a private batch alone auto-adds nothing — the per-device toggle
// (defaulting off) is what a technician/manager actually opts each ticket
// into, since not every device under a private batch is meant to go to
// inventory. Pure decision logic lives here; the atomic create-or-attach
// write lives in services/firestoreDb.ts's commitAutoInventory (a Firestore
// transaction against a dedicated identity index, since Firestore has no
// server-side unique-column constraint).
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

/**
 * Same identity match as findAutoInventoryMatch, but recomputed live from each
 * device's raw `imei` field (via identifierOf) rather than trusting the stored
 * `imeiNormalized` index. Only devices resolved through the auto-inventory
 * flow are guaranteed to have that field populated — a device added through
 * the plain Add Item form (or Quick Purchase, before this) never had it
 * backfilled. Used for a warn-only "this device may already be in inventory"
 * check (Quick Purchase) where scanning the whole list live is fine — NOT for
 * the atomic create-or-attach transaction (commitAutoInventory), which needs
 * the indexed field for a real uniqueness guarantee under concurrent writes.
 */
export function findInventoryMatchByIdentifier(normalized: string, inventory: InventoryItem[]): InventoryItem | undefined {
  if (!normalized) return undefined;
  return inventory.find(i => (i.kind ?? 'device') === 'device' && identifierOf(i) === normalized);
}

/**
 * The existing device that already carries this IMEI/serial, for the plain
 * Inventory → Add/Edit Item form.
 *
 * Auto-inventory and Quick Purchase have always normalized and matched
 * identifiers before creating a record; the manual form did not, so the same
 * physical device could be entered twice. This reuses the exact same
 * normalization and live matching those paths use rather than adding a second
 * notion of "same device".
 *
 * `excludeId` is the row being edited — an item is never a duplicate of itself.
 * A blank identifier never matches: plenty of legitimate rows have no serial,
 * and they must not all collide with each other.
 */
export function findDuplicateDevice(
  rawIdentifier: string,
  inventory: InventoryItem[],
  excludeId?: string,
): InventoryItem | undefined {
  const { normalized } = normalizeIdentifier(rawIdentifier || '');
  if (!normalized) return undefined;
  const pool = excludeId ? inventory.filter(i => i.id !== excludeId) : inventory;
  return findInventoryMatchByIdentifier(normalized, pool);
}

// A batch is private if explicitly flagged so, falling back to the legacy
// `autoInventory` flag for a batch saved before this change (e.g. an old "FTT
// Personal" batch with autoInventory: true) — so it reads as private with no
// data migration required. New saves always write `private`, never the
// legacy field (see RepairBatch's field comments).
export const isPrivateBatch = (batch: Pick<RepairBatch, 'private' | 'autoInventory'> | undefined): boolean =>
  !!(batch?.private ?? batch?.autoInventory);

// Statuses that mean a device is already spoken for by a customer — an
// unrelated repair ticket auto-attaching to one of these would silently yank
// it out from under a pending sale or an already-sold record (item 3 of the
// layaway-completion batch: a reserved device must never be double-committed).
const CLAIMED_STATUSES: DeviceStatus[] = ['reserved', 'sold'];

export type AutoInventoryDecision =
  | { action: 'skip' }                                     // batch isn't private, or this ticket didn't opt in
  | { action: 'noIdentifier' }                              // blank IMEI/serial
  | { action: 'invalidImei'; digits: string }               // 15 digits but fails Luhn
  | { action: 'create'; normalized: string }                // Case A
  | { action: 'attach'; match: InventoryItem; normalized: string } // Case B
  | { action: 'blockedClaimed'; match: InventoryItem; normalized: string }; // matched record is reserved/sold — refuse to attach

/**
 * The full decision flow from the spec, minus the DB write. Pure and
 * synchronous so every branch is directly unit-testable; the caller performs
 * the actual create/attach (atomically, via commitAutoInventory) only for the
 * 'create'/'attach' outcomes.
 *
 * Requires BOTH the batch to be private AND this specific ticket to have
 * opted in (Repair.wantsAutoInventory) — a private batch alone auto-adds
 * nothing.
 */
export function decideAutoInventory(
  batch: Pick<RepairBatch, 'private' | 'autoInventory'> | undefined,
  wantsAutoInventory: boolean | undefined,
  imeiRaw: string | undefined,
  inventory: InventoryItem[],
): AutoInventoryDecision {
  if (!isPrivateBatch(batch) || !wantsAutoInventory) return { action: 'skip' };
  if (!imeiRaw || !imeiRaw.trim()) return { action: 'noIdentifier' };

  const { normalized, looksLikeImei, imeiValid } = normalizeIdentifier(imeiRaw);
  if (looksLikeImei && !imeiValid) return { action: 'invalidImei', digits: normalized };

  const match = findAutoInventoryMatch(normalized, inventory);
  if (!match) return { action: 'create', normalized };
  if (CLAIMED_STATUSES.includes(match.deviceStatus)) return { action: 'blockedClaimed', match, normalized };
  return { action: 'attach', match, normalized };
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
