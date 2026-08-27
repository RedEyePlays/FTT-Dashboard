import QRCode from 'qrcode';
import { InventoryItem } from '../types';
import { kindOf, getDeviceDisplayName } from '../domain/inventory';
import { BUILT_IN_LABEL_SIZES } from '../domain/settings';
import { PRINT_PREVIEW_BAR_STYLE, PRINT_PREVIEW_BAR_HTML } from './printPreview';

// A compact retail SHELF PRICE TAG — printed on a DYMO (or similar) LABEL
// PRINTER, NOT the thermal receipt printer. This is a physically small,
// die-cut/continuous label, not an 80mm paper roll — sizing, margins and font
// scale are completely different from services/salesReceipt.ts /
// services/repairPrint.ts, and this file shares no print path with either.
//
// Sized for the DYMO 36 × 89 mm label ('dymo-36x89' in domain/settings.ts) —
// the same physical stock already used for the QR/barcode inventory labels
// (services/labelLayout.ts, whose header comment documents it as this shop's
// actual Dymo media: 36mm-wide roll, fed portrait-native, 89mm long). Read
// from that single shared preset rather than a second hardcoded copy, so the
// two can never drift apart if the shop's real stock size ever changes.
//
// DYMO printing note (see labelLayout.ts for the full explanation): the
// LabelWriter feeds this label as PORTRAIT native media (36 wide × 89 tall).
// A landscape @page makes the driver shrink-to-fit and clip, so the print
// page is declared portrait at the media's true size and the landscape tag
// content is rotated 90° to fill it exactly.

const IN_TO_MM = 25.4;
const DYMO_MEDIA = BUILT_IN_LABEL_SIZES.find(s => s.id === 'dymo-36x89')!;
const W_MM = +(DYMO_MEDIA.w * IN_TO_MM).toFixed(2); // landscape content width (89mm)
const H_MM = +(DYMO_MEDIA.h * IN_TO_MM).toFixed(2); // landscape content height (36mm)

const money = (n: number) => `$${(n || 0).toFixed(2)}`;
const esc = (s?: string | number) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

// Shelf price = the retail ask. Devices: target sale price (fallback to recorded
// sale price); accessories: selling price.
const shelfPrice = (i: InventoryItem): number =>
  kindOf(i) === 'accessory' ? (i.sellingPrice || 0) : (i.targetSalePrice || i.salePrice || 0);

// One tag's inner markup, sized in mm to fill its W_MM × H_MM box exactly —
// shared by the single-item print and the batch print so the two never drift.
// `qr` is a small IMEI/serial QR data URL — only rendered when the item has
// one, positioned as a corner overlay so it never crowds the centered
// price/name stack.
// Exported for tests — asserting on the real generated markup/CSS instead of
// only on window.open-dependent behavior (printShelfTag/printShelfTagsBatch
// need a DOM window and can't run in the plain node test environment).
export const tagBody = (item: InventoryItem, store: string, qr?: string): string => {
  const name = getDeviceDisplayName(item);
  const specs: string[] = [];
  if (item.storage) specs.push(esc(item.storage));
  if (item.color) specs.push(esc(item.color));
  if (item.carrier) specs.push(esc(item.carrier));
  if (item.batteryHealth) specs.push(`Battery ${esc(item.batteryHealth)}`);
  const specLine = specs.join(' · ');
  return `
    <div class="tag-page-inner">
      <div class="tag-body">
        <div class="store">${esc(store)}</div>
        <div class="name">${esc(name)}</div>
        ${specLine ? `<div class="specs">${specLine}</div>` : ''}
        <div class="price">${money(shelfPrice(item))}</div>
        ${item.sku ? `<div class="sku">${esc(item.sku)}</div>` : ''}
      </div>
      ${qr ? `<img class="tag-qr" src="${qr}" alt="" />` : ''}
    </div>`;
};

export const TAG_STYLE = `
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .tag-page-inner { position: relative; width: 100%; height: 100%; }
  .tag-body {
    width: 100%; height: 100%;
    /* Asymmetric top/bottom padding (was 1.5mm/1.5mm) nudges the centered
       content stack down by ~1mm — there's spare room at the bottom (the
       price line shrank in a prior change, and the stack no longer fills
       the label height), so a small downward shift reads better without
       crowding anything or touching the QR corner overlay. Vertical padding
       is unchanged from the prior change (2.5mm + 0.5mm = same total as the
       1.5mm/1.5mm before it, a pure position shift). The RIGHT padding is
       no longer equal to the left: the QR grew from 9mm to 20mm (see
       .tag-qr below), big enough that centered text could otherwise run
       underneath its top-right corner (the QR paints on top, as a sibling
       overlay with no layout awareness of the text beneath it). Reserving
       ~22mm on the right (20mm QR + 1.2mm inset + ~1mm buffer) keeps the
       centered stack visually clear of it, same "well clear of the QR"
       intent the corner-overlay comment below has always stated — just
       re-balanced for the new size instead of assuming it still fits. */
    padding: 2.5mm 22mm 0.5mm 2mm;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    font-family: 'Inter', system-ui, Arial, sans-serif; color: #000; overflow: hidden;
  }
  /* Every line's font-size bumped ~8-10% ("make the scale a bit bigger") from
     the previous pass. Kept deliberately modest — this is a 36mm-tall label,
     content still has to fit inside it without the browser's default flex
     shrink-to-fit silently compressing every line to squeeze it in (that
     failure mode is exactly why the ZP 450 template disables flex-shrink; the
     margin here is kept generous enough that this tag doesn't need to). */
  .store { font-size: 3.3mm; font-weight: 700; letter-spacing: 0.3mm; text-transform: uppercase; color: #222; line-height: 1; }
  .name { font-size: 5.6mm; font-weight: 800; line-height: 1.1; margin-top: 1.3mm; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .specs { font-size: 3.9mm; font-weight: 700; color: #333; margin-top: 1mm; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* No top/bottom rule around the price anymore — removed at the owner's
     request; the size + weight alone are enough to make it read as the
     standout line. */
  .price { font-size: 8.2mm; font-weight: 900; letter-spacing: -0.2mm; padding: 0.6mm 0; margin-top: 1.6mm; }
  .sku { font-family: 'SF Mono', ui-monospace, Menlo, Consolas, monospace; font-weight: 700; font-size: 3.7mm; letter-spacing: 0.3mm; margin-top: 1.4mm; }
  /* Small IMEI/serial QR — a corner overlay. Bumped from 9mm to 20mm for
     easier scanning at a normal shelf-browsing distance — still smaller
     than the full-size QR on the ZP 450 inventory label (11-40mm+ depending
     on stock size — see services/labelLayout.ts's nonDymoQrSizeMm), and
     positioned as an absolute overlay on .tag-page-inner (not .tag-body),
     so it's unaffected by the content push-down above. At this size it's
     large enough to meaningfully crowd the centered text stack if nothing
     accounted for it — see .tag-body's right padding above, added
     specifically for this. Deliberately NOT image-rendering:pixelated —
     this tag is rotated 90° via CSS transform to print correctly (see
     below), and nearest-neighbor scaling combined with that rotation is
     what made the QR look rough/jagged. Smooth (default) scaling reads far
     cleaner at this size. */
  .tag-qr { position: absolute; top: 1.2mm; right: 1.2mm; width: 20mm; height: 20mm; }
`;

// Wraps tag content for the DYMO portrait-native page: one .tag-page per
// physical label, each internally rotating its landscape content 90° to fill
// the portrait media exactly (see file header). Page-break-after chains
// multiple labels through one continuous print job.
const printDoc = (title: string, pages: string[]): string => {
  const rotated = pages.map(body => `
    <div class="tag-page">
      <div class="rot">${body}</div>
    </div>`).join('');
  return `<!DOCTYPE html><html><head><title>${esc(title)}</title>
    <style>
      @page { size: ${H_MM}mm ${W_MM}mm; margin: 0; }
      ${TAG_STYLE}
      .tag-page { position: relative; width: ${H_MM}mm; height: ${W_MM}mm; overflow: hidden; page-break-after: always; }
      .tag-page:last-child { page-break-after: auto; }
      .rot { position: absolute; top: 0; left: 0; width: ${W_MM}mm; height: ${H_MM}mm; transform-origin: 0 0; transform: translate(${H_MM}mm, 0) rotate(90deg); }
      ${PRINT_PREVIEW_BAR_STYLE}
    </style></head>
    <body>${PRINT_PREVIEW_BAR_HTML}${rotated}
      <script>window.onload=function(){window.focus();};</script>
    </body></html>`;
};

// Small IMEI/serial QR for the corner overlay — only generated when the item
// actually has one; a blank/missing IMEI omits the QR cleanly rather than
// encoding an empty string. Generated well above the 7mm display size (see
// .tag-qr) as extra insurance against quality loss from the CSS scale +
// rotation it goes through on the printed tag.
const imeiQr = (item: InventoryItem): Promise<string | undefined> => {
  const imei = (item.imei || '').trim();
  if (!imei) return Promise.resolve(undefined);
  return QRCode.toDataURL(imei, { margin: 1, width: 240, errorCorrectionLevel: 'M' }).catch(() => undefined);
};

export async function printShelfTag(item: InventoryItem, opts: { storeName?: string } = {}): Promise<boolean> {
  const store = opts.storeName || 'FlipThatTech';
  // Open the window synchronously (in direct response to the click) so
  // popup blockers don't kick in while the QR is generated, then write the
  // document once it's ready.
  const win = window.open('', '_blank', 'width=380,height=260');
  if (!win) return false;
  const qr = await imeiQr(item);
  win.document.write(printDoc(`Shelf Tag ${item.sku || getDeviceDisplayName(item)}`, [tagBody(item, store, qr)]));
  win.document.close();
  return true;
}

// Print shelf tags for many items at once — one print job, one label per
// physical page, so a bulk selection prints as a single job instead of one
// popup per item (which browsers block after the first anyway).
export async function printShelfTagsBatch(items: InventoryItem[], opts: { storeName?: string } = {}): Promise<boolean> {
  if (items.length === 0) return false;
  const store = opts.storeName || 'FlipThatTech';
  const win = window.open('', '_blank', 'width=380,height=260');
  if (!win) return false;
  const qrs = await Promise.all(items.map(imeiQr));
  win.document.write(printDoc(`Shelf Tags (${items.length})`, items.map((i, idx) => tagBody(i, store, qrs[idx]))));
  win.document.close();
  return true;
}
