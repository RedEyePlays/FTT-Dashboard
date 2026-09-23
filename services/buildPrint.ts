import { CardOrientation, CustomerSheet, DisplayCard, cardOrientation, truncateName } from '../domain/buildSheet';
import { PRINT_PREVIEW_BAR_HTML, PRINT_PREVIEW_BAR_STYLE } from './printPreview';

/**
 * THE TWO THINGS A BUILD PRINTS, and they are different jobs.
 *
 *   THE SPEC SHEET  goes home with the customer. Read in the hand, kept in a
 *                   drawer, produced when something goes wrong. It is dense and
 *                   complete: every part, its condition, its manufacturer
 *                   warranty, what it retails for.
 *
 *   THE DISPLAY CARD sits next to the machine on a shelf and sells it from
 *                   across the room. It is the opposite: four or five facts,
 *                   the price loud, and nothing else competing with it.
 *
 * BOTH ARE PUBLIC DOCUMENTS. Neither is handed anything it may not show —
 * domain/buildSheet.ts strips cost, source, seller, labour and profit out of
 * the DATA before it gets here, so these templates could not leak one if they
 * tried. That is deliberate: a print template is exactly where a stray field
 * gets rendered by accident.
 *
 * PRINTED ON AN ORDINARY OFFICE PRINTER, not the thermal receipt printer. The
 * card is letter landscape (or half-page, two to a sheet), designed in colour
 * and checked in greyscale — the price and the specs must survive a black and
 * white print, so nothing load-bearing is carried by hue alone.
 *
 * A public shareable link is OUT OF SCOPE for now: print / PDF only. The
 * browser's "Save as PDF" in the print dialog is the PDF path.
 */

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const openPrintWindow = (title: string, style: string, body: string): void => {
  const w = window.open('', '_blank', 'width=1100,height=850');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${PRINT_PREVIEW_BAR_STYLE}${style}</style></head><body>${PRINT_PREVIEW_BAR_HTML}${body}</body></html>`);
  w.document.close();
};

/* ================= The take-home spec sheet ================= */

const SHEET_STYLE = `
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,'Inter',Segoe UI,Arial,sans-serif;color:#111827;background:#fff}
  .sheet{max-width:7.5in;margin:0 auto;padding:28px 32px}
  h1{font-size:26px;margin:0 0 4px;letter-spacing:-0.02em}
  .specs{font-size:14px;color:#4b5563;margin:0 0 20px}
  .warranty{display:inline-block;background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;
    border-radius:999px;padding:5px 14px;font-size:12px;font-weight:700;margin-bottom:18px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;
    border-bottom:1px solid #e5e7eb;padding:0 8px 6px 0;font-weight:700}
  td{padding:9px 8px 9px 0;border-bottom:1px solid #f3f4f6;vertical-align:top}
  .cat{color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
  .name{font-weight:600}
  .muted{color:#6b7280;font-size:12px}
  .value{margin-top:22px;padding:14px 16px;border:1px solid #e5e7eb;border-radius:10px;background:#f9fafb;font-size:15px}
  .value b{font-size:19px}
  .order-row{display:flex;justify-content:space-between;padding:3px 0;font-size:14px}
  .order-row.total{border-top:1px solid #e5e7eb;margin-top:6px;padding-top:8px;font-weight:700}
  .photo{margin:0 0 16px;text-align:center}
  .photo img{max-width:100%;max-height:3in;object-fit:contain}
  .photo figcaption{margin-top:4px;font-size:10px;color:#9ca3af}
  .foot{margin-top:26px;font-size:11px;color:#9ca3af;border-top:1px solid #f3f4f6;padding-top:12px}
  @page{size:letter portrait;margin:0.5in}
`;

const money = (n: number): string =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The spec sheet's rendered HTML.
 *
 * Exported so the ONE rule these two pieces exist under — no cost, no source,
 * no seller, no labour, no profit, ever — can be asserted against what is
 * actually printed, not merely against the data handed to the printer.
 */
export const buildSheetHtml = (
  sheet: CustomerSheet,
  opts: { storeName: string; storePhone?: string },
): string => {
  const rows = sheet.parts.map(p => `
    <tr>
      <td class="cat">${esc(p.category)}</td>
      <td>
        <div class="name">${esc(p.name)}</div>
        ${p.mfrWarrantyUntil ? `<div class="muted">Manufacturer warranty to ${esc(p.mfrWarrantyUntil)}</div>` : ''}
      </td>
      <td class="muted">${esc(p.condition)}</td>
      <td class="muted">${p.retail ? esc(p.retail) : '—'}</td>
    </tr>`).join('');

  const value = sheet.order
    ? `<div class="value">
         <div class="order-row"><span>Quoted</span><span>${money(sheet.order.quote)}</span></div>
         <div class="order-row"><span>Deposit paid</span><span>−${money(sheet.order.deposit)}</span></div>
         <div class="order-row total"><span>Balance owing</span><span>${money(sheet.order.balance)}</span></div>
       </div>`
    : sheet.valueLine
      ? `<div class="value">${esc(sheet.valueLine)}</div>`
      : sheet.price != null
        ? `<div class="value"><b>${money(sheet.price)}</b></div>`
        : '';

  return `
    <div class="sheet">
      ${sheet.photo ? `
        <figure class="photo">
          <img src="${esc(sheet.photo.url)}" alt="" />
          ${sheet.photo.stock
            ? `<figcaption>Stock photo — actual device may vary${sheet.photo.credit ? ` · ${esc(sheet.photo.credit)}` : ''}</figcaption>`
            : ''}
        </figure>` : ''}
      <h1>${esc(sheet.name)}</h1>
      ${sheet.specs ? `<p class="specs">${esc(sheet.specs)}</p>` : ''}
      <div class="warranty">${esc(sheet.warrantyLine)}</div>
      <table>
        <thead><tr><th>Part</th><th>Model</th><th>Condition</th><th>Retail</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${value}
      <div class="foot">${esc(opts.storeName)}${opts.storePhone ? ` · ${esc(opts.storePhone)}` : ''}</div>
    </div>`;
};

export const printBuildSheet = (
  sheet: CustomerSheet,
  opts: { storeName: string; storePhone?: string },
): void => openPrintWindow(`${sheet.name} — spec sheet`, SHEET_STYLE, buildSheetHtml(sheet, opts));

/* ================= The shelf display card ================= */

/**
 * Small inline SVG icons, one per category.
 *
 * Inline because a print popup has no asset pipeline and an icon that fails to
 * load leaves a hole in the middle of a card sitting on a shop shelf.
 * `currentColor` so they follow the text and survive a greyscale print.
 */
const ICONS: Record<string, string> = {
  CPU: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/>',
  GPU: '<rect x="2" y="7" width="20" height="10" rx="2"/><circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/>',
  RAM: '<rect x="2" y="8" width="20" height="9" rx="1"/><path d="M6 17v3M10 17v3M14 17v3M18 17v3M6 11v3M10 11v3M14 11v3M18 11v3"/>',
  Storage: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="0.6"/>',
  PSU: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M13 9l-3 4h4l-3 4"/>',
  Case: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M9 6h6M9 9h6"/><circle cx="12" cy="17" r="1.2"/>',
};

const icon = (category: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round" class="icn">${ICONS[category] || ICONS.Case}</svg>`;

/**
 * The card's type scale is built around ONE decision: the price is the loudest
 * thing, the name is second, everything else is support. Sizes are in points so
 * they mean the same on paper whatever the browser's zoom.
 *
 * Half-page halves the page box and scales the type down with it, so two cards
 * print to a sheet and each still reads across a room.
 */
/**
 * The display card's sheet.
 *
 * BOTH ORIENTATIONS ARE REAL LAYOUTS, not one design squeezed into the other
 * frame. Landscape is wide, so the spec grid runs two-up beside a large price
 * block. Portrait is tall and narrow, so the head stacks (name over price,
 * centred) and the specs run as a single column — a two-column grid at 7.5in
 * wide would clip every part name.
 */
export const cardPrintStyle = (half: boolean, orientation: CardOrientation = 'landscape') => {
  const portrait = orientation === 'portrait';
  // A half-page card is half the SHEET, whichever way up that sheet is.
  const w = portrait ? '7.5in' : '10in';
  const h = portrait ? (half ? '5in' : '10in') : (half ? '3.6in' : '7.5in');
  return `
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,'Inter',Segoe UI,Arial,sans-serif;background:#fff;color:#0f172a;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}
  .card{width:${w};height:${h};
    padding:${half ? '0.28in 0.4in' : '0.45in 0.6in'};display:flex;flex-direction:column;
    border:1px solid #e2e8f0;border-radius:${half ? '10px' : '16px'};overflow:hidden;
    background:linear-gradient(135deg,#ffffff 0%,#f8fafc 100%);position:relative}
  .card + .card{margin-top:${half ? '0.25in' : '0'}}
  /* A quiet accent bar rather than a coloured background: it survives
     greyscale as a grey bar, and a full-bleed colour costs a fortune in toner
     on an office printer. */
  .card:before{content:'';position:absolute;left:0;top:0;bottom:0;width:${half ? '6px' : '10px'};
    background:linear-gradient(180deg,#4f46e5,#7c3aed)}
  /* PORTRAIT stacks the head and centres it; there is no room beside a
     56pt price on a 7.5in sheet. */
  .head{display:flex;align-items:${portrait ? 'center' : 'flex-start'};
    ${portrait ? 'flex-direction:column;text-align:center;' : ''}
    justify-content:space-between;gap:${portrait ? '6px' : '24px'}}
  .name{font-size:${half ? '22pt' : portrait ? '30pt' : '34pt'};font-weight:800;letter-spacing:-0.025em;
    line-height:1.05;margin:0;max-width:${portrait ? '100%' : '60%'}}
  .price-wrap{text-align:${portrait ? 'center' : 'right'};flex-shrink:0}
  .price{font-size:${half ? '34pt' : '56pt'};font-weight:900;letter-spacing:-0.04em;line-height:1;
    color:#4f46e5;margin:0}
  .was{font-size:${half ? '9pt' : '12pt'};color:#64748b;margin-top:4px}
  .was s{opacity:.75}
  .save{display:inline-block;margin-top:5px;background:#dcfce7;color:#14532d;border:1px solid #86efac;
    border-radius:999px;padding:${half ? '2px 9px' : '4px 13px'};font-size:${half ? '9pt' : '12pt'};font-weight:800}
  /* One column in portrait: two columns at this width clips every part name. */
  .specs{flex:1;display:grid;grid-template-columns:repeat(${portrait ? 1 : 2},minmax(0,1fr));
    gap:${half ? '6px 22px' : '14px 40px'};align-content:center;margin:${half ? '10px 0' : '22px 0'}}
  .spec{display:flex;align-items:center;gap:${half ? '8px' : '13px'};min-width:0}
  .icn{width:${half ? '17px' : '27px'};height:${half ? '17px' : '27px'};color:#4f46e5;flex-shrink:0}
  .spec-text{min-width:0}
  .spec-cat{font-size:${half ? '7pt' : '9pt'};text-transform:uppercase;letter-spacing:.09em;color:#64748b;font-weight:700}
  /* Long part names are real: "ASUS TUF Gaming GeForce RTX 4070 Ti SUPER OC
     Edition 16GB GDDR6X". Truncated in the DATA, and clipped here as well so
     nothing can push the grid out of shape. */
  .spec-name{font-size:${half ? '11pt' : '16pt'};font-weight:700;line-height:1.2;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cond{display:inline-block;margin-top:2px;background:#fef3c7;color:#78350f;border:1px solid #fcd34d;
    border-radius:4px;padding:1px 6px;font-size:${half ? '7pt' : '9pt'};font-weight:700}
  .foot{display:flex;align-items:center;justify-content:space-between;gap:16px;
    border-top:1px solid #e2e8f0;padding-top:${half ? '7px' : '14px'}}
  .badge{background:#eef2ff;color:#3730a3;border:1px solid #c7d2fe;border-radius:999px;
    padding:${half ? '3px 10px' : '6px 16px'};font-size:${half ? '9pt' : '12pt'};font-weight:800}
  .shop{font-size:${half ? '8pt' : '11pt'};color:#64748b;font-weight:600}
  /* Expected performance: always a range, always with its settings. */
  .perf{margin:${half ? '4px 0' : '10px 0'};border-top:1px solid #e2e8f0;padding-top:${half ? '4px' : '8px'}}
  .perf-row{display:flex;align-items:baseline;justify-content:space-between;gap:10px;
    font-size:${half ? '8.5pt' : '12pt'};padding:1px 0}
  .perf-game{font-weight:700;min-width:0}
  .perf-set{font-weight:400;color:#64748b;font-size:${half ? '7pt' : '9pt'}}
  .perf-fps{font-weight:800;white-space:nowrap}
  .perf-tested{color:#047857;font-size:${half ? '6.5pt' : '8pt'};text-transform:uppercase;letter-spacing:.05em}
  .perf-note{font-size:${half ? '6pt' : '7.5pt'};color:#94a3b8;margin-top:2px}
  /* The share link's QR, in the footer beside the warranty badge. */
  .qr{display:flex;flex-direction:column;align-items:center;gap:2px;flex-shrink:0;text-align:center}
  .qr img{width:${half ? '52px' : '86px'};height:${half ? '52px' : '86px'};display:block}
  .qr-cap{font-size:${half ? '6.5pt' : '8.5pt'};color:#334155;font-weight:700;max-width:${half ? '78px' : '120px'};line-height:1.15}
  .qr-url{font-size:${half ? '6pt' : '7.5pt'};color:#64748b;font-family:ui-monospace,Menlo,monospace}
  /* The DIY comparison line, quieter than the price and louder than the foot. */
  .diy{font-size:${half ? '9pt' : portrait ? '12pt' : '13pt'};color:#334155;margin-top:6px;font-weight:600}
  .diy b{color:#0f172a}
  @page{size:letter ${portrait ? 'portrait' : 'landscape'};margin:${half ? '0.3in' : '0.4in'}}
  @media print{ .card{break-inside:avoid;page-break-inside:avoid} }
`;
};

/**
 * The QR block. A BARE QR GETS IGNORED — on a shelf card, next to a price,
 * a square of noise with no caption is furniture. The line under it is what
 * makes somebody lift their phone.
 */
const qrBlock = (opts: CardPrintOptions): string => {
  if (!opts.qrDataUrl) return '';
  return `
    <div class="qr">
      <img src="${esc(opts.qrDataUrl)}" alt="" />
      <div class="qr-cap">Scan for full specs and photos</div>
      ${opts.qrLabel ? `<div class="qr-url">${esc(opts.qrLabel)}</div>` : ''}
    </div>`;
};

const cardBody = (card: DisplayCard, half: boolean, portrait = false, opts: CardPrintOptions = {}): string => `
  <div class="card">
    <div class="head">
      <h1 class="name">${esc(truncateName(card.name, half ? 34 : portrait ? 34 : 46))}</h1>
      <div class="price-wrap">
        <p class="price">${esc(card.priceLabel)}</p>
        ${/* The DIY line is the argument the shop wants to make, so it wins
              over the plain retail strike-through when both are available. */''}
        ${card.diyComparison ? `
          <div class="diy">Build it yourself${card.diyComparison.store ? ` at ${esc(card.diyComparison.store)}` : ''}: <b>${esc(card.diyComparison.total)}</b></div>
          ${card.diyComparison.saving ? `<div class="save">You save ${esc(card.diyComparison.saving)}</div>` : ''}`
          : card.comparison ? `
          <div class="was">Parts at retail <s>${esc(card.comparison.retailTotal)}</s></div>
          <div class="save">You save ${esc(card.comparison.saving)}</div>` : ''}
      </div>
    </div>
    ${card.performance.length ? `
      <div class="perf">
        ${card.performance.map(p => `
          <div class="perf-row">
            <span class="perf-game">${esc(p.game)} <span class="perf-set">${esc(p.detail)}</span></span>
            <span class="perf-fps">${esc(p.fps)}${p.measured ? ' <span class="perf-tested">tested in-shop</span>' : ''}</span>
          </div>`).join('')}
        <div class="perf-note">Estimates based on published benchmarks; actual performance varies with settings and game updates.</div>
      </div>` : ''}
    <div class="specs">
      ${card.specs.map(s => `
        <div class="spec">
          ${icon(s.category)}
          <div class="spec-text">
            <div class="spec-cat">${esc(s.category)}</div>
            <div class="spec-name" title="${esc(s.name)}">${esc(truncateName(s.name, half ? 26 : portrait ? 30 : 34))}</div>
            ${s.condition ? `<span class="cond">${esc(s.condition)}</span>` : ''}
          </div>
        </div>`).join('')}
    </div>
    <div class="foot">
      ${card.warrantyBadge ? `<span class="badge">${esc(card.warrantyBadge)}</span>` : '<span></span>'}
      <span class="shop">${esc(card.shopName)}${card.shopPhone ? ` · ${esc(card.shopPhone)}` : ''}</span>
      ${qrBlock(opts)}
    </div>
  </div>`;

export interface CardPrintOptions {
  half?: boolean;
  orientation?: CardOrientation;
  /**
   * The share link's QR, already rendered to a data URL by the caller.
   *
   * Passed IN rather than generated here so this module stays synchronous and
   * printable from a test — and, more usefully, so the QR can only ever be
   * the one the caller just derived from the CURRENT code. There is no cached
   * image anywhere that could outlive a revoked link, which is the failure
   * worth designing out: a dead QR printed onto a card that then sits on a
   * shelf for a month.
   */
  qrDataUrl?: string;
  /** The link in the form a customer would type, printed under the QR. */
  qrLabel?: string;
}

/** The display card's rendered HTML — exported for the same reason. */
export const displayCardHtml = (card: DisplayCard, opts: CardPrintOptions = {}): string => {
  const half = !!opts.half;
  const portrait = cardOrientation(opts.orientation) === 'portrait';
  // Half-page prints TWO copies to a sheet — the point of the option is to get
  // two cards out of one piece of paper, not a smaller card on a whole one.
  return half
    ? cardBody(card, true, portrait, opts) + cardBody(card, true, portrait, opts)
    : cardBody(card, false, portrait, opts);
};

export const printDisplayCard = (
  card: DisplayCard,
  opts: CardPrintOptions = {},
): void => openPrintWindow(
  `${card.name} — display card`,
  cardPrintStyle(!!opts.half, cardOrientation(opts.orientation)),
  displayCardHtml(card, opts),
);
