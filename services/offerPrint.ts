import { OfferSheetRow } from '../domain/offerSheet';
import { PRINT_PREVIEW_BAR_HTML, PRINT_PREVIEW_BAR_STYLE } from './printPreview';

/**
 * THE PRINTED OFFER SHEET — a document to hand the buyer across the counter,
 * or send in the box with the devices.
 *
 * THERE IS NO PRICING ON IT. Not the cost, not the margin, not the target, and
 * not an asking price either — not even the number the shop hopes to get. The
 * owner's words were "don't have any pricing on em", and this is built to mean
 * that literally. It is a list of what is in the lot and what state each
 * device is in; the price is a conversation, not a figure on a sheet the buyer
 * walks away with and shows the next shop.
 *
 * THAT IS HARDER THAN IT SOUNDS, because the screen this prints FROM is
 * showing cost, target and margin on every row. A print template is exactly
 * where a stray field gets rendered by accident, so this module is handed NO
 * InventoryItem at all — only `OfferSheetRow`s, whose strings have already
 * been through domain/offerSheet.ts's allow-list. There is nothing here to
 * reach a cost WITH. The CSV and this sheet are the same content in two
 * formats, from one row builder, so neither can grow a field the other lacks.
 *
 * ORDINARY PAPER, NOT LABEL STOCK — letter portrait, 0.5in margins. A real lot
 * runs to dozens of devices, so:
 *   • `thead` is a table-header-group, which repeats the column header on
 *     every page;
 *   • every row is `break-inside: avoid`, so a device never splits across the
 *     page boundary with its grade on one sheet and its note on the next.
 *
 * LEGIBLE IN BLACK AND WHITE. Nothing is distinguished by colour: the grade is
 * bold text in a ruled box, not a coloured pill, because a buyer's photocopy
 * of a colour-coded grade column is a column of identical grey blobs.
 *
 * Follows the same shape as services/buildPrint.ts and payrollPrint.ts: a
 * small window opener over the shared print-preview chrome in printPreview.ts.
 */

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/**
 * The spec cell: whichever of these columns this device actually has, joined.
 *
 * A phone has type, storage, colour and battery health; a laptop adds CPU, RAM
 * and screen. Taking only the non-empty ones is what stops a phone's row
 * printing "Phone · 128GB · Black · 94% ·  ·  · " with three empty slots for
 * the laptop fields, and what stops a thirteen-column table that does not fit
 * on letter paper.
 *
 * TYPE IS IN HERE, and it is in here because the drift test put it there: the
 * CSV has a Type column, the first draft of this layout quietly dropped it,
 * and the test asserting every CSV cell reaches the page failed. Folding it
 * into this line costs no column width and means the two formats carry the
 * same facts — which is the point of that test, so weakening it to "every cell
 * except Type" would have been the wrong fix.
 */
const SPEC_HEADERS = ['Type', 'Storage', 'Colour', 'Battery health', 'CPU', 'RAM', 'Screen'];

export const offerSpecLine = (row: OfferSheetRow): string =>
  SPEC_HEADERS.map(h => row.byHeader[h]).filter(v => !!(v || '').trim()).join(' · ');

const STYLE = `
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,'Inter',Segoe UI,Arial,sans-serif;color:#111827;background:#fff}
  .sheet{padding:0}
  .head{margin:0 0 14px}
  .head h1{font-size:20px;margin:0 0 2px;letter-spacing:-0.01em}
  .head .meta{font-size:12px;color:#4b5563}
  .head .meta b{color:#111827}
  table{width:100%;border-collapse:collapse;font-size:11px}
  thead{display:table-header-group}
  tfoot{display:table-row-group}
  th{text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#374151;
    border-bottom:1.5px solid #111827;padding:0 6px 4px 0;font-weight:700}
  td{padding:6px 6px 6px 0;border-bottom:1px solid #e5e7eb;vertical-align:top}
  tr{break-inside:avoid;page-break-inside:avoid}
  .n{color:#6b7280;text-align:right;padding-right:8px;white-space:nowrap}
  .sku{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;white-space:nowrap}
  .dev{font-weight:600}
  .serial{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;color:#6b7280}
  .specs{color:#374151}
  /* The grade must survive a black and white photocopy, so it is weight and a
     rule — never hue. */
  .grade{display:inline-block;min-width:1.6em;text-align:center;font-weight:800;font-size:12px;
    border:1.5px solid #111827;border-radius:3px;padding:1px 4px;line-height:1.2}
  .note{color:#111827}
  .foot{margin-top:14px;padding-top:8px;border-top:1px solid #e5e7eb;font-size:10px;color:#6b7280}
  .ftt-print-why{font-family:-apple-system,'Inter',Arial,sans-serif;font-size:11px;color:#9ca3af;
    text-align:center;padding:6px 8px 0;}
  @media print{.ftt-print-why{display:none !important}}
  @page{size:letter portrait;margin:0.5in}
`;

export interface OfferPrintMeta {
  storeName: string;
  buyerName: string;
  /** Already-formatted date — this module does no date arithmetic. */
  dateLabel: string;
  /**
   * What the sheet promises it leaves out. Shown to the OWNER in the print
   * preview chrome and hidden from the printed page — it is reassurance for
   * the person pressing print, not a line for the buyer to read.
   * Pass domain/offerSheet.ts's OFFER_SHEET_EXCLUDED_NOTE.
   */
  excludedNote?: string;
}

/**
 * The sheet's rendered HTML.
 *
 * Exported so the one rule this exists under — no cost, no target, no margin,
 * no price, ever — can be asserted against what is actually PRINTED rather
 * than against the data handed to the printer.
 *
 * WHAT IS ON IT BESIDES THE DEVICES: the shop name, the date, the buyer's
 * name, and the device count. The count is there because a buyer counting
 * twenty-eight handsets against a sheet needs the sheet to say twenty-eight —
 * a page that fell out of the stapler is otherwise invisible, and "is this all
 * of them?" is the first question a lot raises. Nothing else: no page numbers
 * (Chromium will not put a counter in an @page margin box, so one would have
 * to be faked by guessing the row height, and a wrong page number is worse
 * than none) and no reference number, because an offer has no number the buyer
 * has ever been told.
 */
export const offerPrintHtml = (rows: OfferSheetRow[], meta: OfferPrintMeta): string => {
  const body = rows.map((r, k) => `
    <tr>
      <td class="n">${k + 1}</td>
      <td class="sku">${esc(r.byHeader['SKU'])}</td>
      <td>
        <div class="dev">${esc(r.byHeader['Item'])}</div>
        ${(r.byHeader['IMEI/Serial'] || '').trim() ? `<div class="serial">${esc(r.byHeader['IMEI/Serial'])}</div>` : ''}
      </td>
      <td class="specs">${esc(offerSpecLine(r))}</td>
      <td>${esc(r.byHeader['Condition'])}</td>
      <td>${(r.byHeader['Grade'] || '').trim() ? `<span class="grade">${esc(r.byHeader['Grade'])}</span>` : ''}</td>
      <td class="note">${esc(r.byHeader['Notes'])}</td>
    </tr>`).join('');

  const count = `${rows.length} device${rows.length === 1 ? '' : 's'}`;

  return `
    <div class="sheet">
      <div class="head">
        <h1>${esc(meta.storeName)}</h1>
        <div class="meta">
          Offer for <b>${esc(meta.buyerName || 'buyer')}</b> · ${esc(meta.dateLabel)} · <b>${esc(count)}</b>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th></th><th>SKU</th><th>Device</th><th>Specs</th><th>Condition</th><th>Grade</th><th>Notes</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      <div class="foot">${esc(count)} in this lot · ${esc(meta.storeName)} · ${esc(meta.dateLabel)}</div>
    </div>`;
};

export const printOfferSheet = (rows: OfferSheetRow[], meta: OfferPrintMeta): boolean => {
  const w = window.open('', '_blank', 'width=1000,height=850');
  if (!w) return false;
  const why = meta.excludedNote
    ? `<div class="ftt-print-why">${esc(meta.excludedNote)} This sheet carries no pricing of any kind.</div>`
    : '';
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">`
    + `<title>${esc(`Offer — ${meta.buyerName || 'buyer'}`)}</title>`
    + `<style>${PRINT_PREVIEW_BAR_STYLE}${STYLE}</style></head>`
    + `<body>${PRINT_PREVIEW_BAR_HTML}${why}${offerPrintHtml(rows, meta)}</body></html>`);
  w.document.close();
  return true;
};
