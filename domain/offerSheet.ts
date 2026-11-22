import { InventoryItem } from '../types';
import { effectiveDeviceType } from './deviceSpecs';

/**
 * THE BUYER-SAFE EXPORT — a sheet you can send a wholesale buyer.
 *
 * WHAT WAS WRONG WITH SENDING THE ORDINARY ONE. Both existing inventory
 * exports write the shop's own columns, which means `purchaseCost`,
 * `repairCost`, `boughtFrom`, `purchaseSource` and the internal `notes` field
 * go in the file. Email that to a buyer and you have told them exactly what
 * every device cost, where it came from, and whatever the tech typed about it
 * ("seller was sketchy", "screen is aftermarket, don't mention"). Those are
 * the shop's margin and the shop's sourcing, and they are not recoverable once
 * sent. The only safe way to share stock up to now was to export and then
 * delete columns by hand, every time, correctly, under time pressure.
 *
 * So this is a THIRD export with its own column set, built from an allow-list
 * rather than by removing columns from the shop's sheet. That direction
 * matters: a new internal field added to the app later appears in the shop's
 * exports automatically and in this one not at all, which is the right default
 * for a file whose whole job is to leave the shop.
 *
 * WHAT IT CARRIES: identity and condition. What a buyer needs to decide what
 * the lot is worth — what each device IS, and what state it is in.
 *
 * TARGET SALE PRICE IS DELIBERATELY NOT IN IT. It is the shop's RETAIL asking
 * price, and this is a WHOLESALE conversation: thirty retail prices in a
 * buyer's inbox either anchor the negotiation at a number the shop never
 * intended to get for a lot, or — read across thirty rows beside the condition
 * column — simply hand over the shop's pricing model. A wholesale offer is one
 * agreed figure for the batch, not the sum of thirty shelf prices, so the
 * sheet carries no price at all and the number is agreed in the conversation
 * the sheet starts.
 *
 * GRADE AND NOTES ARE BLANK ON PURPOSE. They are the BUYER's columns: grade is
 * the buyer's own A/B/C judgement on arrival, and Notes is where their
 * questions and exceptions go. Blank columns in the file mean the sheet comes
 * back in the same shape it went out, which is what makes it a working
 * document rather than a one-way dump. They are also why `notes` can be left
 * out without losing anything a buyer should see: the internal note is not for
 * them, and the column they should write in is empty and waiting.
 *
 * Pure: no DOM. The caller downloads it.
 */

/**
 * THE FIELDS THIS SHEET MUST NEVER CARRY, named so the UI can show them at
 * the moment of export. A promise that a file omits something belongs on the
 * screen where the file is produced, not only in a comment in this module.
 */
export const OFFER_SHEET_EXCLUDED = [
  'purchase cost', 'repair cost', 'bought from', 'purchase source', 'internal notes',
] as const;

export const OFFER_SHEET_EXCLUDED_NOTE =
  `No ${OFFER_SHEET_EXCLUDED.slice(0, -1).join(', ')} or ${OFFER_SHEET_EXCLUDED[OFFER_SHEET_EXCLUDED.length - 1]}.`;

/** The keys of InventoryItem this sheet is allowed to read. The allow-list. */
export const OFFER_SHEET_SOURCE_FIELDS = [
  'sku', 'imei', 'item', 'deviceType', 'storage', 'storageType', 'color',
  'batteryHealth', 'cpu', 'ram', 'screenSize', 'condition',
] as const;

/**
 * WHAT THE OWNER TYPED FOR THIS BUYER, keyed by inventory id.
 *
 * The one thing in this file that does NOT come off the InventoryItem — and
 * that is exactly why Grade and Notes can be filled in without weakening the
 * allow-list. The values come from a saved offer (domain/offers.ts), which
 * holds only what the owner typed for a buyer to read; the item's own fields
 * are still reached only through `OFFER_SHEET_SOURCE_FIELDS`.
 *
 * Absent, or absent for a given row, and the column is blank exactly as
 * before — the plain inventory export calls this with nothing.
 */
export type OfferSheetAnnotations = Record<string, { grade?: string; note?: string }>;

interface OfferColumn {
  header: string;
  value: (i: InventoryItem, a?: { grade?: string; note?: string }) => string;
}

const str = (v: unknown): string => (v == null ? '' : String(v)).trim();

/**
 * THE COLUMNS, in the order a buyer reads them: which one is it, what is it,
 * what state is it in, then their own two.
 *
 * `storage` keeps whatever unit the owner typed ("256GB", "1TB") — the same
 * rule the printed label follows, for the same reason: stripping it renders
 * "1TB" as "1".
 */
export const OFFER_SHEET_COLUMNS: OfferColumn[] = [
  { header: 'SKU', value: i => str(i.sku) },
  { header: 'IMEI/Serial', value: i => str(i.imei) },
  { header: 'Item', value: i => str(i.item) },
  { header: 'Type', value: i => str(effectiveDeviceType(i)) },
  { header: 'Storage', value: i => [str(i.storage), str(i.storageType)].filter(Boolean).join(' ') },
  { header: 'Colour', value: i => str(i.color) },
  { header: 'Battery health', value: i => str(i.batteryHealth) },
  { header: 'CPU', value: i => str(i.cpu) },
  { header: 'RAM', value: i => str(i.ram) },
  { header: 'Screen', value: i => str(i.screenSize) },
  { header: 'Condition', value: i => str(i.condition) },
  // THE BUYER'S OWN COLUMNS. Blank when the sheet is exported straight from
  // Inventory (nobody has written anything for this buyer yet, and a blank
  // column is a working document — see the header comment). Filled from the
  // offer when it is exported from a saved one: the grade the owner put on
  // this device FOR THIS BUYER, and the note they wrote them.
  { header: 'Grade', value: (_i, a) => str(a?.grade) },
  { header: 'Notes', value: (_i, a) => str(a?.note) },
];

/** Every header this sheet writes, in order. */
export const offerSheetHeaders = (): string[] => OFFER_SHEET_COLUMNS.map(c => c.header);

const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;

/**
 * The sheet itself. Built column by column from the allow-list, so a row's
 * other fields are never read — not masked, not blanked, never touched.
 */
export const offerSheetCsv = (rows: InventoryItem[], annotations?: OfferSheetAnnotations): string => [
  offerSheetHeaders().map(esc).join(','),
  ...rows.map(r => OFFER_SHEET_COLUMNS.map(c => esc(c.value(r, annotations?.[r.id]))).join(',')),
].join('\n');

/**
 * A FILE NAME THAT SAYS WHAT IT IS. "phones_2026-11-22.csv" in a Downloads
 * folder beside this one tells nobody which of the two is safe to attach, and
 * the moment that is unclear is the moment the wrong one gets sent.
 */
export const offerSheetFileName = (todayISO: string): string =>
  `offer-sheet-SAFE-TO-SEND_${todayISO}.csv`;

/**
 * The same, for a sheet exported from a saved offer — the buyer's name is in
 * it because the owner will have several of these in one folder, quoted to
 * different people, and "which of these did I send Rashid?" is not a question
 * a date alone answers.
 */
export const offerSheetFileNameFor = (buyerName: string, todayISO: string): string => {
  const slug = (buyerName || '').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40);
  return slug
    ? `offer-sheet-SAFE-TO-SEND_${slug}_${todayISO}.csv`
    : offerSheetFileName(todayISO);
};
