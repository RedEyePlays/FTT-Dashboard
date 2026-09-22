import { InventoryItem } from '../types';

/**
 * THE JUNK "ADD DEVICE" LEFT BEHIND.
 *
 * "Add Device" opened no form. It generated a SKU and immediately SAVED a blank
 * device to Firestore, then dropped the user into the inline table to fill it
 * in. Every click that wasn't followed through — a mis-click, a change of mind,
 * an interruption — left a real inventory record with no IMEI, no name and no
 * cost, sitting in the list forever and counted in every "devices in stock"
 * figure. addAccessoryRow did the same.
 *
 * The form now writes nothing until Save (see components/ItemFormModal.tsx), so
 * no new ones are created. This is the cleanup for the ones already there.
 *
 * NEVER AUTO-DELETES. The list is shown first and the owner chooses. A row that
 * looks empty to this code could be a placeholder somebody is deliberately
 * using, and silently deleting inventory is not a thing to do on an inference.
 *
 * Pure: no DOM, no Firestore.
 */

const blank = (s: string | undefined): boolean => !(s || '').trim();
const zero = (n: number | undefined): boolean => !n;

/**
 * Is this row empty enough that it can only be an abandoned "Add Device" click?
 *
 * DELIBERATELY STRICT. Every identifying field, every figure, and every link to
 * anything else must be empty. A row with so much as a cost, a note, a sale, a
 * linked repair or a transaction is somebody's work in progress and is never
 * offered for deletion. The SKU is ignored, because a SKU is exactly what these
 * rows were given and nothing else.
 */
export const isBlankRow = (i: InventoryItem): boolean =>
  blank(i.item) && blank(i.imei) && blank(i.brand) && blank(i.model) &&
  blank(i.manufacturerBarcode) && blank(i.storage) && blank(i.color) &&
  blank(i.carrier) && blank(i.batteryHealth) && blank(i.notes) &&
  blank(i.boughtFrom) && blank(i.soldTo) && blank(i.soldDate) &&
  blank(i.category) && blank(i.purchaseSource) &&
  zero(i.purchaseCost) && zero(i.repairCost) && zero(i.costPerUnit) &&
  zero(i.salePrice) && zero(i.targetSalePrice) && zero(i.sellingPrice) &&
  zero(i.minSalePrice) &&
  // Anything that ties this row to other data means it is not junk.
  !i.transactionId && !i.dropOffId && !i.sourceTicketId && !i.batchId &&
  !i.boughtFromCustomerId && !(i.listedPlatforms || []).length && !i.autoCreated;

/** Every abandoned row, newest first — what the cleanup list shows. */
export const blankRows = (inventory: InventoryItem[]): InventoryItem[] =>
  inventory.filter(isBlankRow).sort((a, b) => (b.date || '').localeCompare(a.date || ''));

export const blankRowsLabel = (n: number): string | null =>
  n <= 0 ? null : `${n} empty row${n === 1 ? '' : 's'} left over from the old Add Device button`;

export const BLANK_ROWS_EXPLANATION =
  'These have no IMEI, no name, no cost and nothing linked to them — they were created by the old “Add Device” button, which saved a blank record the moment it was clicked. Nothing is deleted until you say so.';
