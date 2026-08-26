// Shared label rendering for the Inventory and Repair label modals so both stay
// identical. All geometry is expressed in millimetres; the on-screen preview
// scales mm→px, and print uses real mm units. The DYMO 36 × 89 mm label is the
// primary template and gets a dedicated, tightly-packed landscape layout.
//
// DYMO printing note: the DYMO LabelWriter feeds the 36 × 89 mm label as
// PORTRAIT native media (36 wide × 89 tall). Sending a landscape @page makes the
// driver shrink-to-fit and leaves whitespace/clipping. So for DYMO we make the
// print page portrait (36 × 89, matching the media exactly) and rotate the
// landscape label 90° to fill it — the physical output then matches the preview.

export interface LabelMedia {
  id: string;
  w: number; // inches (landscape content orientation)
  h: number; // inches
  label: string;
  dymo?: boolean;
}

export interface LabelContent {
  org: string;      // FlipThatTech
  code: string;     // SKU (inventory) or Repair ID (repairs) — very large
  device: string;   // device / accessory name
  sub?: string;     // storage · color, or repair type
  serial?: string;  // IMEI / serial — large, bold, high-contrast
  status?: string;  // status badge label
}

export interface LabelImages { qr?: string; barcode?: string; }
export interface LabelOpts {
  showBarcode: boolean;
  showStatus: boolean;
  barcodeOnly?: boolean;
  // Owner-configurable overrides (Settings → Labels & Printing) for the
  // non-Dymo (inch/ZP 450) templates only — undefined uses the built-in
  // default. Dymo keeps its own separately-tuned constants.
  padMm?: number;
  // Shifts the whole text block down as one group (a paint-only transform,
  // not a layout change) — see AppSettings.labels.contentPushDownMm.
  pushDownMm?: number;
}

const IN = 25.4; // mm per inch
export const mmOf = (m: LabelMedia) => ({ w: +(m.w * IN).toFixed(2), h: +(m.h * IN).toFixed(2) });

const esc = (s?: string) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

// A unit emitter: mm for print, px (scaled) for the preview.
type U = (mm: number) => string;
const mkU = (unit: 'px' | 'mm', pxPerMm: number): U =>
  unit === 'px' ? (mm) => `${+(mm * pxPerMm).toFixed(2)}px` : (mm) => `${+mm.toFixed(3)}mm`;

/**
 * The label body, sized to fill its parent (width/height 100%). The parent is
 * responsible for the physical dimensions (preview box in px, or the print page
 * / rotation wrapper in mm), so this is orientation-agnostic and identical for
 * preview and print.
 */
function labelBody(u: U, m: LabelMedia, c: LabelContent, img: LabelImages, o: LabelOpts): string {
  const dymo = !!m.dymo;
  // Minimal margins, mm. The non-Dymo (inch/ZP 450) templates need a bit more
  // than this used to give — confirmed via a physical test print that the
  // printer/driver side is correctly calibrated (a driver-level top offset
  // made no visible difference) and there's spare room at the bottom, so the
  // top clipping on the first line ("org"/store name) was this content
  // padding being too tight, not a print calibration issue.
  const pad = dymo ? 1.3 : (o.padMm ?? 2.0);

  // Barcode-only label (accessories): the UPC barcode fills the whole label,
  // centered, with its human-readable digits (baked into the image). No QR,
  // name, SKU or status — just a clean, scannable barcode.
  if (o.barcodeOnly) {
    return `
      <div style="box-sizing:border-box;width:100%;height:100%;padding:${u(pad)};background:#fff;color:#000;
        display:flex;align-items:center;justify-content:center;overflow:hidden;">
        ${img.barcode
          ? `<img src="${img.barcode}" style="max-width:100%;max-height:100%;object-fit:contain;image-rendering:pixelated;" />`
          : `<div style="font-family:'Courier New',monospace;font-weight:800;font-size:${u(4)};">${esc(c.code)}</div>`}
      </div>`;
  }
  const showStatus = o.showStatus && !!c.status;
  const showBarcode = o.showBarcode && !!img.barcode;

  const pill = showStatus
    ? `<span style="align-self:flex-start;border:${u(0.3)} solid #000;border-radius:${u(1.4)};padding:${u(0.4)} ${u(1.2)};font-size:${u(dymo ? 2.6 : 2.2)};font-weight:800;text-transform:uppercase;letter-spacing:.4px;line-height:1;white-space:nowrap;">${esc(c.status)}</span>`
    : '';

  if (dymo) {
    // Landscape 89 × 36 mm: text column on the left, large square QR on the
    // right, full-width barcode across the bottom.
    const fOrg = 2.7, fCode = 7.2, fDevice = 4.4, fSub = 3.0, fSerial = 4.2;
    const gap = 1.0;
    const bcH = showBarcode ? 5.5 : 0;
    const { h } = mmOf(m);
    // QR fills the height of the top region (label height − padding − barcode).
    const qrS = +(h - pad * 2 - (bcH ? bcH + gap : 0)).toFixed(2);
    return `
      <div style="box-sizing:border-box;width:100%;height:100%;padding:${u(pad)};background:#fff;color:#000;
        font-family:'Inter',system-ui,Arial,sans-serif;display:flex;flex-direction:column;gap:${u(gap)};overflow:hidden;">
        <div style="flex:1;min-height:0;display:flex;gap:${u(2)};">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:${u(1.1)};">
            <div style="font-weight:800;font-size:${u(fOrg)};letter-spacing:.5px;line-height:1;">${esc(c.org)}</div>
            <div style="font-family:'Courier New',monospace;font-weight:800;font-size:${u(fCode)};line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.code)}</div>
            <div style="font-weight:700;font-size:${u(fDevice)};line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.device)}</div>
            ${c.sub ? `<div style="font-size:${u(fSub)};font-weight:600;color:#000;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.sub)}</div>` : ''}
            ${c.serial ? `<div style="font-family:'Courier New',monospace;font-weight:800;font-size:${u(fSerial)};color:#000;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.serial)}</div>` : ''}
            ${pill}
          </div>
          ${img.qr ? `<img src="${img.qr}" style="width:${u(qrS)};height:${u(qrS)};flex-shrink:0;align-self:center;image-rendering:pixelated;" />` : ''}
        </div>
        ${showBarcode ? `<img src="${img.barcode}" style="width:100%;height:${u(bcH)};object-fit:fill;" />` : ''}
      </div>`;
  }

  // Generic layout for the inch (thermal roll) templates: branding row, text +
  // QR, optional barcode. Bigger, bolder, high-contrast — same content rules.
  const { w, h } = mmOf(m);
  const large = m.w >= 4;
  const fOrg = large ? 3.2 : 2.6;
  const fCode = large ? 7.5 : 5.2;
  const fDevice = large ? 4.6 : 3.6;
  const fSub = large ? 3.4 : 2.8;
  const fSerial = large ? 4.4 : 3.6;
  const qrS = +(Math.min(w, h) * (m.h >= 3 ? 0.42 : 0.6)).toFixed(2);
  const bcH = showBarcode ? h * 0.14 : 0;
  // Vertical gap between content lines (org/code/device/sub/serial). The
  // smaller inch templates (2×1") used to leave noticeable dead space below
  // the last line at pad=2.0 — a bigger default gap here spreads the same
  // content more evenly across the full label height instead of leaving it
  // clumped in the center.
  const lineGap = large ? 1.1 : 1.6;
  // Push the whole text block down as one group, without touching the gap
  // between lines or the block's own height — a `transform`, not a layout
  // change, so it can't trigger the browser's print auto-shrink-to-fit (that
  // only reacts to content overflowing its layout box; a transform only
  // repaints, it never resizes anything). Owner-configurable in Settings;
  // 0 (no shift) when unset.
  const pushDown = o.pushDownMm ?? 0;
  return `
    <div style="box-sizing:border-box;width:100%;height:100%;padding:${u(pad)};background:#fff;color:#000;
      font-family:'Inter',system-ui,Arial,sans-serif;display:flex;flex-direction:column;gap:${u(1)};overflow:hidden;">
      <div style="flex:1;min-height:0;display:flex;gap:${u(2)};">
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:${u(lineGap)};transform:translateY(${u(pushDown)});">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:${u(1.2)};">
            <span style="font-weight:800;font-size:${u(fOrg)};letter-spacing:.5px;line-height:1;">${esc(c.org)}</span>
            ${pill}
          </div>
          <div style="font-family:'Courier New',monospace;font-weight:800;font-size:${u(fCode)};line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.code)}</div>
          <div style="font-weight:700;font-size:${u(fDevice)};line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.device)}</div>
          ${c.sub ? `<div style="font-size:${u(fSub)};font-weight:600;color:#000;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.sub)}</div>` : ''}
          ${c.serial ? `<div style="font-family:'Courier New',monospace;font-weight:800;font-size:${u(fSerial)};color:#000;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.serial)}</div>` : ''}
        </div>
        ${img.qr ? `<img src="${img.qr}" style="width:${u(qrS)};height:${u(qrS)};flex-shrink:0;align-self:center;image-rendering:pixelated;" />` : ''}
      </div>
      ${showBarcode ? `<img src="${img.barcode}" style="width:100%;height:${u(bcH)};object-fit:fill;" />` : ''}
    </div>`;
}

/** Preview HTML: a physically-proportioned box (px) containing the label body. */
export function labelPreview(m: LabelMedia, c: LabelContent, img: LabelImages, o: LabelOpts, maxPx = 300): string {
  const { w, h } = mmOf(m);
  const pxPerMm = maxPx / Math.max(w, h);
  const u = mkU('px', pxPerMm);
  return `<div style="width:${+(w * pxPerMm).toFixed(1)}px;height:${+(h * pxPerMm).toFixed(1)}px;border:1px solid #e5e7eb;overflow:hidden;">${labelBody(u, m, c, img, o)}</div>`;
}

/**
 * Full print document. For DYMO, the page is portrait 36 × 89 mm (native media)
 * and the landscape label is rotated 90° to fill it exactly. For inch stock, the
 * page equals the label with no rotation. Zero margins, no headers/footers, the
 * label anchored top-left, printed at 100% scale.
 */
export function labelPrintDoc(title: string, m: LabelMedia, c: LabelContent, img: LabelImages, o: LabelOpts): string {
  const u = mkU('mm', 1);
  const body = labelBody(u, m, c, img, o);
  const { w, h } = mmOf(m);
  const common = `
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; -webkit-font-smoothing: none; }
    img { image-rendering: pixelated; }`;
  const script = `<script>window.onload=function(){window.focus();window.print();setTimeout(function(){window.close();},300);};</script>`;

  if (m.dymo) {
    // Portrait page = native DYMO media; rotate the landscape label into it.
    return `<!DOCTYPE html><html><head><title>${esc(title)}</title><style>
      @page { size: ${h}mm ${w}mm; margin: 0; }
      html, body { width: ${h}mm; height: ${w}mm; overflow: hidden; }
      body { position: relative; }
      .rot { position: absolute; top: 0; left: 0; width: ${w}mm; height: ${h}mm; transform-origin: 0 0; transform: translate(${h}mm, 0) rotate(90deg); }
      ${common}
    </style></head><body><div class="rot">${body}</div>${script}</body></html>`;
  }

  return `<!DOCTYPE html><html><head><title>${esc(title)}</title><style>
    @page { size: ${w}mm ${h}mm; margin: 0; }
    html, body { width: ${w}mm; height: ${h}mm; overflow: hidden; }
    body { position: relative; }
    .lab { position: absolute; top: 0; left: 0; width: ${w}mm; height: ${h}mm; }
    ${common}
  </style></head><body><div class="lab">${body}</div>${script}</body></html>`;
}
