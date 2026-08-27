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
  // Shifts the whole text block down as one group via plain padding-top —
  // a `transform` and a margin-cancellation trick were both tried and
  // confirmed to have zero effect on real physical prints despite working
  // in every automated check; see AppSettings.labels.contentPushDownMm.
  pushDownMm?: number;
  // Gap between content lines (org/code/device/sub/serial) on the non-Dymo
  // templates — see AppSettings.labels.lineSpacingMm. Clamped to [0, 1.5]
  // even here (not just at the Settings input) since a bad stored value
  // (old data, a direct Firestore edit) shouldn't be able to reintroduce
  // the print shrink-to-fit that too-large a gap causes.
  lineGapMm?: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// Verified safe ceiling for "Push content down" — see the long comment above
// its use in labelBody for how this was derived (real rendered geometry on
// the tightest template, 2×1", with worst-case realistic content: org row +
// SKU + a device name + a storage/color line + a 15-digit IMEI, all five
// lines present at once). Exported so the two PDF-export paths
// (components/LabelModal.tsx, components/RepairLabelModal.tsx) clamp to the
// exact same verified-safe value instead of re-guessing their own.
export const MAX_PUSH_DOWN_MM = 0.5;

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
  // Vertical gap between content lines (org/code/device/sub/serial). 1.1mm
  // is the physically-confirmed known-good default at pad=2.0 — a larger
  // default (1.6mm) was tried for the smaller inch templates but physical
  // print testing showed it overcrowds the 2×1" label and can re-trigger
  // the browser's print shrink-to-fit at pure defaults, so it's back to
  // 1.1mm across all sizes. Owner-configurable in Settings up to 1.5mm;
  // clamped defensively even for a bad stored value.
  const lineGap = clamp(o.lineGapMm ?? 1.1, 0, 1.5);
  // Push the whole text block down from the top, via plain padding-top —
  // no clever CSS. Two prior mechanisms were each tried and confirmed
  // broken by REAL PHYSICAL PRINTS on the ZP 450, despite passing every
  // automated/string-based check at the time:
  //   1. `transform: translateY(...)` — a compositing-layer feature. Proven
  //      (via direct PDF content-stream inspection) to work correctly in
  //      Chromium's own print/PDF pipeline, but real label-printer
  //      drivers commonly flatten HTML through a simplified box-model-only
  //      renderer that doesn't implement transforms — zero effect.
  //   2. A margin-top/negative-margin-bottom pair inside a
  //      `justify-content:center` parent, meant to shift the block without
  //      growing the parent's used size. Pixel-verified identical to the
  //      transform in a Chromium DOM layout — but centering apparently
  //      neutralizes it on the physical driver's renderer too.
  // Both of those were "clever": they relied on a specific interaction
  // between the shift and another layout algorithm (compositing, or
  // flex centering) to stay overflow-safe. That's exactly the kind of
  // interaction a simplified print renderer is liable to get wrong.
  //
  // This version uses `justify-content:flex-start` (not centered — a plain,
  // unconditional top edge, nothing to interact with) plus a single
  // `padding-top` on the same column, which is just base spacing IS the
  // pushed-down position — no separate mechanism required. `padding-top`
  // is a box-model fundamental; any renderer that can lay out a `<div>` at
  // all has to implement it.
  //
  // basePad and MAX_PUSH_DOWN_MM were re-derived (2026) after a physical
  // print comparison showed pushDownMm=2.5 truncating content that
  // pushDownMm=2.0 rendered correctly — real Chromium layout geometry (not
  // just this string-based test file) confirmed font-size is byte-identical
  // at every pushDown value, so the mechanism was never a font/scale
  // calculation; it was overflow. The OLD basePad (1.4mm) already overflowed
  // the 2×1" template's available content height by ~0.55mm for realistic
  // worst-case content (org + SKU + a device name + a storage/color line + a
  // 15-digit IMEI — all five lines at once, which is the common case for a
  // fully-specified device, not an edge case) BEFORE any pushDown was even
  // applied, and every extra mm of pushDown added exactly one more mm of
  // overflow (confirmed 1:1 linear via real rendered geometry — see the PR
  // description for the measured numbers). A driver/print-pipeline auto-fit
  // triggered by that overflow, not Chromium's own CSS layout, is the most
  // likely source of the truncation and size change actually seen on paper —
  // consistent with this file's other documented history of print-driver
  // quirks invisible to any in-browser or automated check. The fix removes
  // the trigger condition entirely rather than chasing the driver behavior:
  // basePad (0.35mm) is calibrated so the worst-case content has ZERO
  // overflow at pushDownMm=0, and MAX_PUSH_DOWN_MM (0.5mm, exported above)
  // is the exact remaining headroom before that same worst-case content
  // would start overflowing again. Every value in [0, MAX_PUSH_DOWN_MM] is
  // therefore provably overflow-free for the worst realistic content on the
  // tightest template — not merely "smaller than before."
  const basePad = 0.35;
  const pushDown = clamp(o.pushDownMm ?? 0, 0, MAX_PUSH_DOWN_MM);
  const contentPadTop = basePad + pushDown;
  // `flex-shrink:0` on every line below is load-bearing, not decoration: the
  // column has a fixed cross-size (stretched to the row's height) and
  // `display:flex;flex-direction:column` items default to `flex-shrink:1`,
  // so once `padding-top` pushes total content past the column's fixed
  // height, the browser's default behavior is to proportionally SHRINK each
  // line's rendered height to fit — not to overflow and let `overflow:hidden`
  // clip the excess. That's exactly the kind of implicit, easy-to-miss CSS
  // interaction this rewrite is trying to eliminate (confirmed by rendering
  // real geometry: without flex-shrink:0, line heights measurably compressed
  // as pushDownMm increased, instead of the last line cleanly clipping).
  // With flex-shrink:0, every line keeps its natural size unconditionally —
  // content either fits, or the excess is cut off by overflow:hidden. Never
  // resized.
  return `
    <div style="box-sizing:border-box;width:100%;height:100%;padding:${u(pad)};background:#fff;color:#000;
      font-family:'Inter',system-ui,Arial,sans-serif;display:flex;flex-direction:column;gap:${u(1)};overflow:hidden;">
      <div style="flex:1;min-height:0;display:flex;gap:${u(2)};">
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-start;gap:${u(lineGap)};padding-top:${u(contentPadTop)};overflow:hidden;">
          <div style="flex-shrink:0;display:flex;justify-content:space-between;align-items:center;gap:${u(1.2)};">
            <span style="font-weight:800;font-size:${u(fOrg)};letter-spacing:.5px;line-height:1;">${esc(c.org)}</span>
            ${pill}
          </div>
          <div style="flex-shrink:0;font-family:'Courier New',monospace;font-weight:800;font-size:${u(fCode)};line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.code)}</div>
          <div style="flex-shrink:0;font-weight:700;font-size:${u(fDevice)};line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.device)}</div>
          ${c.sub ? `<div style="flex-shrink:0;font-size:${u(fSub)};font-weight:600;color:#000;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.sub)}</div>` : ''}
          ${c.serial ? `<div style="flex-shrink:0;font-family:'Courier New',monospace;font-weight:800;font-size:${u(fSerial)};color:#000;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.serial)}</div>` : ''}
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
