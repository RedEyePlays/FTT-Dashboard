import QRCode from 'qrcode';
import { InventoryItem } from '../types';
import { kindOf, getDeviceDisplayName } from '../domain/inventory';
import { laptopPrintSpecs, printsLaptopLayout } from '../domain/deviceSpecs';
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
  // A LAPTOP'S SPECS *ARE* THE DIFFERENCE between two machines on a shelf, in
  // a way a phone's are not, so it gets its own layout rather than the phone
  // one with blanks in it. Carrier and battery health are deliberately absent:
  // they are phone fields, a laptop never has them, and reaching for them was
  // what made a laptop tag print its storage and nothing else.
  //
  // Every OTHER device type still takes the phone layout — a known gap, stated
  // in the PR, not a forgotten one.
  if (printsLaptopLayout(item)) {
    const { main, gpu, screen } = laptopPrintSpecs(item);
    return `
    <div class="tag-page-inner">
      <div class="tag-body laptop">
        <div class="store">${esc(store)}</div>
        <div class="name">${esc(name)}</div>
        ${main ? `<div class="specs">${esc(main)}</div>` : ''}
        ${gpu ? `<div class="specs gpu">${esc(gpu)}</div>` : ''}
        <div class="price">${money(shelfPrice(item))}</div>
      </div>
      ${qr ? `<img class="tag-qr" src="${qr}" alt="" />` : ''}
      ${screen ? `<div class="tag-screen">${esc(screen)}</div>` : ''}
    </div>`;
  }
  // Color dropped from the specs line (owner request) — storage/carrier/
  // battery are what actually help someone pick the right unit off a shelf
  // of otherwise-identical devices; color is visible on the device itself.
  const specs: string[] = [];
  if (item.storage) specs.push(esc(item.storage));
  if (item.carrier) specs.push(esc(item.carrier));
  if (item.batteryHealth) specs.push(`Battery ${esc(item.batteryHealth)}`);
  const specLine = specs.join(' · ');
  // The SKU line was dropped entirely (owner request) — the QR already
  // encodes the item's identifier, and removing this line freed real
  // vertical room, used below for bigger type and a further push-down.
  return `
    <div class="tag-page-inner">
      <div class="tag-body">
        <div class="store">${esc(store)}</div>
        <div class="name">${esc(name)}</div>
        ${specLine ? `<div class="specs">${specLine}</div>` : ''}
        <div class="price">${money(shelfPrice(item))}</div>
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
    /* Dropping the SKU line entirely (see tagBody) freed real vertical room —
       enough to both push the stack down further AND size up .store/.specs
       below without re-risking the overflow this tag already had a
       dedicated fix for (see the flex-shrink comment below; the fit margin
       is re-proven with the current values in shelfTag.test.ts, not just
       carried over from before this line was removed). Top padding grown to
       4.5mm (from 2.4mm) for a noticeably bigger push-down; bottom kept at
       0.5mm. The RIGHT padding reserves room for the 20mm QR (see .tag-qr
       below) so centered text can't run underneath its top-right corner. */
    padding: 4.5mm 22mm 0.5mm 2mm;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    font-family: 'Inter', system-ui, Arial, sans-serif; color: #000; overflow: hidden;
  }
  /* Root-caused bug: three consecutive font-size bumps (this tag went
     through several "make it bigger" passes) pushed the flex column's total
     natural content height past the label's fixed 36mm box, WITHOUT
     flex-shrink:0 on the lines below — flexbox's default flex-shrink:1 then
     silently compressed every line's box to fit, squashing (not cleanly
     cropping) whichever lines had the least margin/padding slack to absorb
     it, which on a real print looked like the model (.name) and storage
     (.specs) rows getting cut off. This is the exact failure mode the ZP 450
     template already guards against with flex-shrink:0 (see
     services/labelLayout.ts) — this tag never had that guard. Fixed two
     ways together: flex-shrink:0 on every line so nothing ever gets silently
     resized again, AND the margins below were tightened (from the last few
     passes' generous values) so the real content total now fits the 36mm
     box with room to spare — flex-shrink:0 alone would just turn "squashed"
     into "cleanly cropped," not actually fix the fit. */
  .store { flex-shrink: 0; font-size: 4.2mm; font-weight: 800; letter-spacing: 0.3mm; text-transform: uppercase; color: #222; line-height: 1; }
  .name { flex-shrink: 0; font-size: 5.6mm; font-weight: 800; line-height: 1.1; margin-top: 0.8mm; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .specs { flex-shrink: 0; font-size: 4.6mm; font-weight: 800; color: #333; margin-top: 0.6mm; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* No top/bottom rule around the price anymore — removed at the owner's
     request; the size + weight alone are enough to make it read as the
     standout line. */
  .price { flex-shrink: 0; font-size: 8.2mm; font-weight: 900; letter-spacing: -0.2mm; padding: 0.4mm 0; margin-top: 1mm; }
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

  /* ---------------- The laptop tag ----------------
     Everything below applies ONLY to .tag-body.laptop, so the phone tag's
     rendered markup and CSS are untouched — a phone tag prints byte-for-byte
     what it printed before (asserted in shelfTag.test.ts).

     WHY A LAPTOP NEEDS ITS OWN SIZES, measured on the real 89 × 36 mm stock
     (65 × 31 mm of text box after the padding above; see the PR for the full
     table):

       • a laptop's spec line is far longer than a phone's. "Ryzen 7 5800H ·
         32GB · 1TB SSD" is 73.0mm at the phone's 4.6mm — 8mm wider than the
         column, i.e. silently ellipsised. At 3.7mm it is 58.7mm, with 6.3mm
         of real spare for a longer CPU string. 4.0mm was measured too and
         left only 1.5mm, which is not margin.
       • the GPU cannot share that line AT ALL: 94.0mm at 4.6mm, and still
         69.5mm at 3.4mm against a 65mm column. So it gets its own line, and
         only when one is recorded.
       • that second line costs vertical room the stack does not have — the
         phone stack is 28.9mm in a 31mm box, i.e. 2.1mm spare. It is paid for
         by spending the laptop's top padding (the "push down" margin) back
         down to 2.4mm, which is the value this tag used before that pass, and
         by line-height:1 on the two spec lines (the .store line above already
         prints at line-height:1). Nothing is shrunk to fit and nothing
         clips — the fit margin is re-measured in the tests. */
  .tag-body.laptop { padding-top: 2.4mm; }
  .laptop .specs { font-size: 3.7mm; line-height: 1; }
  /* The GPU line: lighter than the CPU/RAM/storage line above it, because it
     is supplementary rather than part of the machine's identity. */
  .laptop .specs.gpu { font-weight: 700; color: #444; margin-top: 0.3mm; }

  /* SCREEN SIZE — the BOTTOM-right corner, and the corner choice is the whole
     point. The QR already owns the top-right (1.2mm inset, 20mm square, so it
     runs to 21.2mm down a 36mm label) and it is load-bearing: it encodes the
     identifier that gets scanned. Below it, from 21.2mm to the bottom edge,
     there is roughly 20 × 14mm of genuinely empty label — inside the 22mm
     right gutter .tag-body already reserves, so this can collide with neither
     the QR above it nor the centred text to its left. '15.6"' measures 11.1mm
     at this size against 20mm of room. Measured, not assumed, and asserted in
     shelfTag.test.ts rather than left to drift. */
  .tag-screen {
    position: absolute; bottom: 1.2mm; right: 1.2mm; width: 20mm;
    font-family: 'Inter', system-ui, Arial, sans-serif;
    font-size: 4.2mm; font-weight: 800; line-height: 1; color: #000;
    text-align: center; white-space: nowrap; overflow: hidden;
  }
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
