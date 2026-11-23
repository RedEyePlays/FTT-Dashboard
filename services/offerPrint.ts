import { OfferSheetRow } from '../domain/offerSheet';
import { OwnerSheetRow } from '../domain/offers';
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

/* ======================================================================== *
 * THE OWNER'S COPY
 * ======================================================================== */

/**
 * THE SAME LOT, WITH THE MONEY ON IT — for the owner to read on their phone
 * while they are standing in front of the buyer negotiating.
 *
 * A SEPARATE FUNCTION TAKING A SEPARATE ROW TYPE, and that is the whole
 * safety argument. `offerPrintHtml` above takes `OfferSheetRow[]`, which has
 * no money field on it at all — so it could not print a cost if somebody
 * wanted it to, and there is no `includeCost` flag anywhere for a wrong
 * default or an inverted condition to flip. Putting a cost on the buyer's
 * sheet would mean changing that function's type signature, which is not
 * something anybody does by accident. The two sheets share this file's
 * stylesheet, which carries no data, and nothing else.
 *
 * LABELLED SO THE TWO CANNOT BE MIXED UP. They are produced from one screen,
 * moments apart, onto one printer, and one of them must never reach a buyer:
 *
 *   • a black band across the top reading OWNER COPY — NOT FOR THE BUYER.
 *     Solid black with reversed type, so it survives a black and white print
 *     and reads from across a counter, where a coloured tint would not;
 *   • the band is INSIDE `<thead>`, so it repeats on every page — a sheet
 *     that gets separated from its first page is exactly how the wrong page
 *     ends up in the wrong hand;
 *   • the same words again in the footer line.
 *
 * READABLE ON A PHONE. This one is as much an on-screen document as a printed
 * one, so the table collapses to a stacked card per device on a narrow SCREEN
 * (each cell labelled from its `data-l`), while `@media print` keeps the
 * table. One document, two presentations — not a second page to keep in sync.
 */
const OWNER_BANNER = 'OWNER COPY — NOT FOR THE BUYER';

const OWNER_STYLE = `
  .owner-band{background:#111827;color:#fff;font-weight:800;letter-spacing:.08em;
    font-size:11px;text-transform:uppercase;padding:5px 8px;text-align:center;border:none}
  td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  th.num{text-align:right}
  .internal{color:#374151;font-size:10px}
  .internal b{font-weight:700;color:#111827}
  .totals{margin-top:14px;border:1.5px solid #111827;border-radius:6px;padding:10px 12px;font-size:12px}
  .totals .row{display:flex;justify-content:space-between;padding:2px 0}
  .totals .row.big{font-weight:800;border-top:1px solid #d1d5db;margin-top:4px;padding-top:6px}
  .totals .warn{margin-top:6px;font-size:10px;color:#92400e}
  /* LANDSCAPE, overriding the buyer sheet's portrait. Eleven columns —
     four more than the buyer's seven, and three of them money — do not fit
     across 7.5in without the notes columns collapsing to one word a line.
     The buyer's @page rule is untouched; this one comes after it. */
  @page{size:letter landscape;margin:0.45in}
  /* PHONE, ON SCREEN ONLY. The printed table is untouched. */
  @media screen and (max-width:640px){
    table,thead,tbody,tr,td{display:block;width:100%}
    thead tr:last-child{display:none}
    thead tr:first-child th{display:block}
    tbody tr{border:1px solid #d1d5db;border-radius:8px;padding:8px;margin:0 0 10px}
    td{border:none;padding:2px 0;display:flex;gap:8px}
    td.num{justify-content:space-between}
    td[data-l]::before{content:attr(data-l);flex:0 0 7.5em;color:#6b7280;font-size:10px;
      text-transform:uppercase;letter-spacing:.04em;padding-top:2px}
    td:empty{display:none}
  }
`;

export interface OwnerPrintMeta extends OfferPrintMeta {
  /** The lot totals the offer screen already shows. */
  totals: { count: number; cost: number; target: number; margin: number; targetsSet: number };
}

const money = (n: number): string => `$${n.toFixed(2)}`;

/**
 * The owner copy's rendered HTML. Exported so what it carries — and what the
 * buyer's copy does not — can be asserted against the real output.
 */
export const offerOwnerPrintHtml = (rows: OwnerSheetRow[], meta: OwnerPrintMeta): string => {
  const body = rows.map((r, k) => `
    <tr>
      <td class="n" data-l="#">${k + 1}</td>
      <td class="sku" data-l="SKU">${esc(r.sheet.byHeader['SKU'])}</td>
      <td data-l="Device">
        <div class="dev">${esc(r.sheet.byHeader['Item'])}</div>
        ${(r.sheet.byHeader['IMEI/Serial'] || '').trim() ? `<div class="serial">${esc(r.sheet.byHeader['IMEI/Serial'])}</div>` : ''}
      </td>
      <td class="specs" data-l="Specs">${esc(offerSpecLine(r.sheet))}</td>
      <td data-l="Condition">${esc(r.sheet.byHeader['Condition'])}</td>
      <td data-l="Grade">${(r.sheet.byHeader['Grade'] || '').trim() ? `<span class="grade">${esc(r.sheet.byHeader['Grade'])}</span>` : ''}</td>
      <td class="num" data-l="Cost">${esc(money(r.cost))}</td>
      <td class="num" data-l="Target">${r.target ? esc(money(r.target)) : '—'}</td>
      <td class="num" data-l="Margin">${r.target ? esc(money(r.margin)) : '—'}</td>
      <td class="note" data-l="To buyer">${esc(r.sheet.byHeader['Notes'])}</td>
      <td class="internal" data-l="Our notes">${esc(r.internalNote)}</td>
    </tr>`).join('');

  const count = `${rows.length} device${rows.length === 1 ? '' : 's'}`;
  const t = meta.totals;

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
          <tr><th class="owner-band" colspan="11">${esc(OWNER_BANNER)}</th></tr>
          <tr>
            <th></th><th>SKU</th><th>Device</th><th>Specs</th><th>Condition</th><th>Grade</th>
            <th class="num">Cost</th><th class="num">Target</th><th class="num">Margin</th>
            <th>To buyer</th><th>Our notes</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
      <div class="totals">
        <div class="row"><span>Our cost</span><span>${esc(money(t.cost))}</span></div>
        <div class="row"><span>At target prices</span><span>${esc(money(t.target))}</span></div>
        <div class="row big"><span>Margin at target</span><span>${esc(money(t.margin))}</span></div>
        ${t.targetsSet < t.count
          ? `<div class="warn">${t.count - t.targetsSet} of these have no target price set, so the target and margin are understated.</div>`
          : ''}
      </div>
      <div class="foot">${esc(OWNER_BANNER)} · ${esc(count)} · ${esc(meta.storeName)} · ${esc(meta.dateLabel)}</div>
    </div>`;
};

export const printOfferOwnerCopy = (rows: OwnerSheetRow[], meta: OwnerPrintMeta): boolean => {
  const w = window.open('', '_blank', 'width=1100,height=850');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${esc(`${OWNER_BANNER} — ${meta.buyerName || 'buyer'}`)}</title>`
    + `<style>${PRINT_PREVIEW_BAR_STYLE}${STYLE}${OWNER_STYLE}</style></head>`
    + `<body>${PRINT_PREVIEW_BAR_HTML}`
    + `<div class="ftt-print-why">Your copy — it shows cost, target and margin. Do not hand this one over.</div>`
    + `${offerOwnerPrintHtml(rows, meta)}</body></html>`);
  w.document.close();
  return true;
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
