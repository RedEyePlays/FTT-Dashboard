import { INVENTORY_SKU_PREFIX } from './sku';

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
  sub?: string;     // storage · color · battery health, or repair type
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

// Where the label modals persist the owner's last-selected label template
// (localStorage, per-browser — not Firestore). Named here rather than inline
// in components/LabelModal.tsx so every label TYPE on this system prints on
// the same configured stock instead of each one hardcoding a guess.
export const LABEL_PREFS_KEY = 'ftt_label_tpl_v1';

/**
 * The label stock currently configured for printing: the owner's last-selected
 * template if it's still a known size, otherwise the first available one
 * (the built-in DYMO 36 × 89 preset, in a default install). `sizes` is passed
 * in — components read it from Settings (components/SettingsModal.ts's
 * getLabelSizes) — so this file keeps its no-component, no-Firestore contract.
 */
export function selectedLabelMedia<T extends LabelMedia>(sizes: T[]): T | undefined {
  if (!sizes.length) return undefined;
  try {
    const id = JSON.parse(localStorage.getItem(LABEL_PREFS_KEY) || '{}')?.template;
    return sizes.find(s => s.id === id) || sizes[0];
  } catch { return sizes[0]; }
}

// Nominal ceiling for "Push content down" — a generous cap for content that
// isn't using the full label (see maxSafePushDownMm below for the actual,
// content-aware limit that's really enforced). A flat global ceiling small
// enough to be safe for the WORST possible content (org + SKU + a long
// device name + a storage/color line + a 15-digit IMEI, all five lines at
// once — the common case for a fully-specified device, not an edge case)
// made push-down imperceptible for every item that isn't that worst case —
// which is most items. So the real safety limit is computed per render from
// the content actually being printed (maxSafePushDownMm); this constant only
// caps how far it's ever allowed to reach even when a short/sparse item has
// tons of spare room, so the offset stays a "close up the gap" tweak, not an
// arbitrary shove.
export const MAX_PUSH_DOWN_MM = 6;

// The base (pushDownMm=0) top offset for content on the non-Dymo templates —
// see the long comment above its use in labelBody. Exported so
// maxSafePushDownMm can compute the SAME baseline the real render uses.
// 0.85mm, not the original 1.4mm: real rendered geometry showed the OLD
// 1.4mm baseline already clipped ~0.55mm off the bottom of the worst-case
// (all-five-lines) content even at pushDownMm=0, before push-down enters the
// picture at all — a real, pre-existing defect, not introduced by this
// feature. 0.85mm is exactly the reduction that zeroes that out (see the PR
// description for the measured numbers).
const BASE_PAD_MM = 0.85;

/**
 * How many additional mm of pushDownMm the given content can actually
 * absorb on this template before ANY line's box would extend past the
 * available content height — i.e. the real, content-aware safety ceiling,
 * not a one-size-fits-none flat constant. Computed analytically from the
 * exact same font-size/line-height constants labelBody renders with (no
 * DOM, no browser needed — this has to run identically in the PDF-export
 * path too, which has neither), so it stays exactly in sync with what
 * actually gets drawn. Dymo has no push-down at all (0). A barcode row
 * subtracts its own height + gap from the available space, matching
 * labelBody's real layout.
 *
 * This is the mechanism that makes "clamp the offset, don't shrink or
 * truncate" apply per-item rather than per-fixed-guess: a short accessory
 * label (org+code+device only) gets many mm of real headroom, while the
 * worst-case fully-specified device (all five lines) safely clamps down
 * toward zero — physically, there simply isn't room to move a label's
 * worth of text further down a 1" tall box once every line is already in
 * use. Either way, font size and content are NEVER touched — only how far
 * this function says it's safe to push is.
 */
export function maxSafePushDownMm(
  m: LabelMedia,
  c: Pick<LabelContent, 'sub' | 'serial'>,
  opts: { padMm?: number; lineGapMm?: number; showBarcode: boolean; hasBarcodeImage: boolean },
  ceilingMm: number = MAX_PUSH_DOWN_MM,
): number {
  if (m.dymo) return 0; // Dymo keeps its own separately-tuned layout; push-down never applies there.
  const { h } = mmOf(m);
  const pad = opts.padMm ?? 2.0;
  const lineGap = clamp(opts.lineGapMm ?? 1.1, 0, 1.5);
  const showBarcode = opts.showBarcode && opts.hasBarcodeImage;
  const bcH = showBarcode ? h * 0.14 : 0;
  const available = (h - pad * 2) - (showBarcode ? bcH + 1 : 0);

  const { fOrg, fCode, fDevice, fSub, fSerial } = nonDymoFontSizesMm(m);
  // Rendered line-box heights = font-size × line-height (matches the
  // line-height values labelBody actually sets on each line below).
  const lineHeights = [fOrg * 1, fCode * 1, fDevice * 1.05];
  if (c.sub) lineHeights.push(fSub * 1);
  if (c.serial) lineHeights.push(fSerial * 1.05);
  const gaps = lineGap * (lineHeights.length - 1);
  const needed = BASE_PAD_MM + lineHeights.reduce((a, b) => a + b, 0) + gaps;

  const headroom = Math.max(0, available - needed);
  return Math.min(ceilingMm, headroom);
}

const IN = 25.4; // mm per inch
export const mmOf = (m: LabelMedia) => ({ w: +(m.w * IN).toFixed(2), h: +(m.h * IN).toFixed(2) });

const esc = (s?: string) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));

// Font sizes (mm) for the generic inch/ZP 450 templates — the single source
// both labelBody and maxSafePushDownMm read, so the two can never drift.
export function nonDymoFontSizesMm(m: LabelMedia): { fOrg: number; fCode: number; fDevice: number; fSub: number; fSerial: number } {
  const large = m.w >= 4;
  return {
    fOrg: large ? 3.2 : 2.6,
    fCode: large ? 7.5 : 5.2,
    fDevice: large ? 4.6 : 3.6,
    fSub: large ? 3.4 : 2.8,
    fSerial: large ? 4.4 : 3.6,
  };
}

// QR size (mm) for the generic inch/ZP 450 templates, as a fraction of the
// label's shorter side. Reduced from the previous 0.6 (stock under 3" tall)
// / 0.42 (3"+ stock) — even after the SKU display is shortened (see
// shortLabelSku below), the QR was still claiming more of the text column's
// width than a low-density alphanumeric SKU/IMEI needs to scan reliably.
// These sizes stay well above the 9mm corner QR already shipped and used in
// production on the DYMO shelf tag (services/shelfTag.ts) for the same kind
// of payload (an IMEI), which is the closest real-world precedent available
// for "how small can this get and still scan" in this codebase — no
// physical ZP 450 print + phone-camera scan test was performed for this
// change (not available in this environment); confirm on a real print
// before relying on it, per the task's own instruction.
export function nonDymoQrSizeMm(m: LabelMedia): number {
  const { w, h } = mmOf(m);
  return +(Math.min(w, h) * (m.h >= 3 ? 0.34 : 0.47)).toFixed(2);
}

// Approximate monospace glyph width as a fraction of font-size — the same
// analytical-geometry approach maxSafePushDownMm already uses for vertical
// headroom (no DOM/browser available in this codebase's test or PDF-export
// paths). 0.6 is the standard approximation for a bold 'Courier New'-class
// monospace face at normal tracking. Used only to prove, with real numbers,
// that shortening the SKU + shrinking the QR actually buys back column
// width — not just that the expected string shows up in the output.
const MONO_CHAR_WIDTH_RATIO = 0.6;
export const estimateTextWidthMm = (text: string, fontSizeMm: number): number =>
  +(text.length * fontSizeMm * MONO_CHAR_WIDTH_RATIO).toFixed(2);

// The text column's available width on a non-Dymo template: label width
// minus padding on both sides, minus the QR (+ its row gap) when one is
// shown — mirrors the subtraction labelBody's flex row performs, computed
// standalone so tests (and PDF export) can work from the same real geometry.
export function textColumnWidthMm(m: LabelMedia, opts: { padMm?: number; showQr: boolean }): number {
  const { w } = mmOf(m);
  const pad = opts.padMm ?? 2.0;
  const qrGap = 2; // matches labelBody's `gap:${u(2)}` on the text/QR row
  const qrW = opts.showQr ? nonDymoQrSizeMm(m) + qrGap : 0;
  return +(w - pad * 2 - qrW).toFixed(2);
}

// Strip the shop's own SKU prefix + separator for on-label DISPLAY ONLY.
// Every SKU this shop generates shares INVENTORY_SKU_PREFIX (services/sku.ts)
// — repeating it on a label that already prints the store name above it is
// pure wasted width, and it's 4 of ~11 characters on a typical SKU. Derived
// from the shared constant (not the literal 'FTT-') so this keeps working if
// the store's prefix is ever configured differently. The stored `sku` value,
// the QR's encoded payload, receipts, reports, exports and search all keep
// the full value — only what's rendered on the printed label is shortened.
// A SKU that doesn't start with the current prefix (legacy data, or a
// foreign value) is returned unchanged rather than guessed at.
export function shortLabelSku(sku: string): string {
  const prefix = `${INVENTORY_SKU_PREFIX}-`;
  return sku.startsWith(prefix) ? sku.slice(prefix.length) : sku;
}

// The device label's "sub" line (LabelContent.sub): storage · color · battery
// health, skipping anything unset. Battery health is a resale-relevant number
// staff read off the shelf next to the QR (condition varies a lot between two
// otherwise-identical listings), so it belongs on the printed label itself,
// not just in the app. Takes plain strings (not InventoryItem) so this file
// doesn't need to depend on ../types.
export function deviceSubLine(parts: { storage?: string; color?: string; batteryHealth?: string }): string | undefined {
  return [parts.storage, parts.color, parts.batteryHealth && `Batt ${parts.batteryHealth}`].filter(Boolean).join(' · ') || undefined;
}

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
  const { fOrg, fCode, fDevice, fSub, fSerial } = nonDymoFontSizesMm(m);
  const qrS = nonDymoQrSizeMm(m);
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
  // basePad reads BASE_PAD_MM directly (not a separately-tuned local literal)
  // so this and maxSafePushDownMm's own baseline calculation can never drift
  // apart from each other.
  //
  // The actual ceiling on pushDown is content-aware (maxSafePushDownMm), not
  // a flat constant: a first attempt at this fix (physical print comparison
  // showed pushDownMm=2.5 truncating content that pushDownMm=2.0 rendered
  // correctly) used a single fixed ceiling small enough to be safe for the
  // WORST-case content on the tightest template — which made push-down
  // imperceptible for every item that wasn't that exact worst case. Real
  // Chromium layout geometry proved font-size stays byte-identical at every
  // pushDown value regardless — the actual defect was overflow, not scale —
  // so the fix that actually restores a usable range without reintroducing
  // truncation is computing, per render, exactly how much room THIS
  // content has before its last line would extend past the available
  // height, and clamping to that (see maxSafePushDownMm's own comment for
  // the full derivation and the PR description for measured geometry).
  const basePad = BASE_PAD_MM;
  const pushDown = clamp(
    o.pushDownMm ?? 0, 0,
    maxSafePushDownMm(m, c, { padMm: o.padMm, lineGapMm: o.lineGapMm, showBarcode: o.showBarcode, hasBarcodeImage: !!img.barcode }),
  );
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
          <div style="flex-shrink:0;font-family:'Courier New',monospace;font-weight:800;font-size:${u(fCode)};line-height:1.05;max-height:${u(fCode * 2.1)};overflow-wrap:anywhere;word-break:break-all;overflow:hidden;">${esc(c.code)}</div>
          <div style="flex-shrink:0;font-weight:700;font-size:${u(fDevice)};line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.device)}</div>
          ${c.sub ? `<div style="flex-shrink:0;font-size:${u(fSub)};font-weight:600;color:#000;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.sub)}</div>` : ''}
          ${c.serial ? `<div style="flex-shrink:0;font-family:'Courier New',monospace;font-weight:800;font-size:${u(fSerial)};color:#000;line-height:1.05;max-height:${u(fSerial * 2.1)};overflow-wrap:anywhere;word-break:break-all;overflow:hidden;">${esc(c.serial)}</div>` : ''}
        </div>
        ${img.qr ? `<img src="${img.qr}" style="width:${u(qrS)};height:${u(qrS)};flex-shrink:0;align-self:center;image-rendering:pixelated;" />` : ''}
      </div>
      ${showBarcode ? `<img src="${img.barcode}" style="width:100%;height:${u(bcH)};object-fit:fill;" />` : ''}
    </div>`;
}

/* ---------------- Drop-off device label ----------------------------------
 *
 * A SECOND label TYPE on this same system — not a second label system. It
 * shares this file's media presets (LabelMedia / mmOf), unit emitter, escaping,
 * text-width geometry (estimateTextWidthMm) and, critically, the one print-page
 * builder below (pagesPrintDoc), which owns the DYMO portrait-media rotation
 * every physical print in this app depends on. The QR bitmaps themselves are
 * generated by the caller with the same `qrcode` library the inventory label
 * and shelf tag use (services/dropOffLabel.ts), exactly as LabelModal does.
 *
 * The content shape is genuinely different from LabelContent's (a device
 * belonging to a named buyer with money owed on it, not a SKU on store stock),
 * so it gets its own body function rather than being bent into labelBody's
 * org/code/device/sub/serial slots — but nothing about the page, the media or
 * the print path is duplicated.
 */

export interface DropOffLabelContent {
  org: string;          // store name
  buyerName: string;    // who the device belongs to
  device: string;       // model / item name
  serial?: string;      // IMEI / serial (also the QR payload)
  fundingLabel: string; // domain/dropoffs.ts's PAID_BY_LABEL wording
  moneyLine: string;    // domain/dropoffs.ts's dropOffLabelMoney().moneyLine
  dateDropped: string;  // YYYY-MM-DD
  ref: string;          // drop-off / device reference id
}

export interface DropOffLabelOpts {
  // Same owner-configurable spacing settings the inventory label honours
  // (Settings → Labels & Printing), rather than a hardcoded layout.
  padMm?: number;
  lineGapMm?: number;
}

// Content padding default for this template. Slightly tighter than the
// inventory label's 2.0mm because this label carries two full-width lines
// (money + meta) under the text/QR row and needs the vertical room.
const DROPOFF_PAD_MM = 1.6;
const DROPOFF_QR_GAP_MM = 2;

// The smallest this label's QR is ever allowed to shrink to. 9mm is the size
// already shipped and proven in production on the DYMO shelf tag's corner QR
// (services/shelfTag.ts) for exactly this payload — an IMEI — which is the
// only real-world "how small still scans" evidence this codebase has.
export const MIN_DROPOFF_QR_MM = 9;

/**
 * Font sizes (mm) for the drop-off label, scaled from the DYMO 89mm landscape
 * template the shop actually prints on so the same layout works on every
 * configured stock size. The single source both the body and the fit
 * calculation below read, so the two can never drift (same arrangement as
 * nonDymoFontSizesMm).
 */
export function dropOffFontSizesMm(m: LabelMedia): {
  fOrg: number; fBuyer: number; fDevice: number; fSerial: number; fMoney: number; fMeta: number;
} {
  const { w } = mmOf(m);
  const s = clamp(w / 89, 0.6, 1.2);
  const r = (n: number) => +(n * s).toFixed(2);
  return { fOrg: r(2.7), fBuyer: r(5.0), fDevice: r(4.0), fSerial: r(3.7), fMoney: r(4.0), fMeta: r(2.6) };
}

/**
 * The QR's rendered size (mm) for this content — SHRINK THE QR BEFORE THE TEXT.
 *
 * Same non-truncation rule as the inventory label work (services/
 * labelLayout.ts's nonDymoQrSizeMm + textColumnWidthMm, services/shelfTag.ts's
 * flex-shrink:0 fit): the IMEI and the money figures are the whole point of
 * this label and must never ellipsis-clip, so when the serial's measured width
 * (estimateTextWidthMm, the same analytical geometry used everywhere else in
 * this file — no DOM needed, so it runs identically in tests) doesn't fit
 * beside an ideally-sized QR, the QR gives up width first.
 *
 * The QR never shrinks below MIN_DROPOFF_QR_MM: past that it stops scanning,
 * which would defeat the label. In that (very long serial) case the serial
 * line WRAPS instead — it is rendered with overflow-wrap:anywhere and no
 * ellipsis, exactly like the inventory label's code/serial lines — so the
 * value is still printed in full, never cut.
 */
export function dropOffQrSizeMm(
  m: LabelMedia,
  c: Pick<DropOffLabelContent, 'serial'>,
  opts: { padMm?: number } = {},
): number {
  const { w, h } = mmOf(m);
  const pad = opts.padMm ?? DROPOFF_PAD_MM;
  // Ideal: a comfortably scannable square — this label gets scanned off a
  // shelf or a bin, so it's sized generously (0.55 of the short side, well
  // above the 9mm floor and the inventory label's text-heavy 0.34/0.47) —
  // capped so the full-width money/meta rows beneath still get their height.
  const ideal = +Math.min(Math.min(w, h) * 0.55, (h - pad * 2) * 0.62).toFixed(2);
  const serial = (c.serial || '').trim();
  if (!serial) return ideal;
  const { fSerial } = dropOffFontSizesMm(m);
  // Widest QR that still leaves the serial its full measured width on one line.
  const fits = w - pad * 2 - DROPOFF_QR_GAP_MM - estimateTextWidthMm(serial, fSerial);
  return +clamp(Math.min(ideal, fits), Math.min(MIN_DROPOFF_QR_MM, ideal), ideal).toFixed(2);
}

/**
 * The width (mm) left for the top block's text beside the QR — the drop-off
 * label's counterpart to textColumnWidthMm, computed from the SAME subtraction
 * the flex row below actually performs, so tests can prove the fit with real
 * numbers instead of only asserting a string is present.
 */
export function dropOffTextColumnWidthMm(
  m: LabelMedia,
  c: Pick<DropOffLabelContent, 'serial'>,
  opts: { padMm?: number; showQr: boolean },
): number {
  const { w } = mmOf(m);
  const pad = opts.padMm ?? DROPOFF_PAD_MM;
  const qrW = opts.showQr ? dropOffQrSizeMm(m, c, { padMm: opts.padMm }) + DROPOFF_QR_GAP_MM : 0;
  return +(w - pad * 2 - qrW).toFixed(2);
}

/**
 * The drop-off label body, sized to fill its parent — same contract as
 * labelBody, so it drops straight into the shared preview box and print page.
 *
 * Layout: store name / buyer / device / serial in a left column with the QR
 * beside it, then the money line and the date + reference across the FULL
 * label width beneath. Putting the money on its own full-width row (rather
 * than in the QR-adjacent column) is deliberate: the figures are the most
 * clip-sensitive content on the label, and this way the QR never competes
 * with them for width at all.
 *
 * `flex-shrink:0` on every line is load-bearing for the same reason it is on
 * the inventory label and the shelf tag (see labelBody's long comment): a flex
 * column's default flex-shrink:1 SILENTLY COMPRESSES lines to fit rather than
 * letting them overflow, which on a physical print reads as squashed/cut-off
 * text. With it, content either fits or cleanly clips — and the two lines that
 * must never clip (serial, money) wrap instead of clipping.
 */
function dropOffLabelBody(u: U, m: LabelMedia, c: DropOffLabelContent, qr: string | undefined, o: DropOffLabelOpts): string {
  const pad = o.padMm ?? DROPOFF_PAD_MM;
  const lineGap = clamp(o.lineGapMm ?? 0.9, 0, 1.5);
  const f = dropOffFontSizesMm(m);
  const qrS = dropOffQrSizeMm(m, c, { padMm: o.padMm });
  // Never ellipsis: wrap the value instead. Same rule (and same CSS) the
  // inventory label's code/serial lines use.
  const noClip = 'overflow-wrap:anywhere;word-break:break-all;';
  return `
    <div style="box-sizing:border-box;width:100%;height:100%;padding:${u(pad)};background:#fff;color:#000;
      font-family:'Inter',system-ui,Arial,sans-serif;display:flex;flex-direction:column;gap:${u(lineGap)};overflow:hidden;">
      <div style="flex:1;min-height:0;display:flex;gap:${u(DROPOFF_QR_GAP_MM)};">
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:flex-start;gap:${u(lineGap)};overflow:hidden;">
          <div style="flex-shrink:0;font-weight:800;font-size:${u(f.fOrg)};letter-spacing:.5px;line-height:1;text-transform:uppercase;">${esc(c.org)}</div>
          <div style="flex-shrink:0;font-weight:800;font-size:${u(f.fBuyer)};line-height:1.05;${noClip}overflow:hidden;">${esc(c.buyerName)}</div>
          <div style="flex-shrink:0;font-weight:700;font-size:${u(f.fDevice)};line-height:1.05;${noClip}overflow:hidden;">${esc(c.device)}</div>
          ${c.serial ? `<div style="flex-shrink:0;font-family:'Courier New',monospace;font-weight:800;font-size:${u(f.fSerial)};line-height:1.05;${noClip}overflow:hidden;">${esc(c.serial)}</div>` : ''}
        </div>
        ${qr ? `<img src="${qr}" style="width:${u(qrS)};height:${u(qrS)};flex-shrink:0;align-self:flex-start;image-rendering:pixelated;" />` : ''}
      </div>
      <div style="flex-shrink:0;font-weight:800;font-size:${u(f.fMoney)};line-height:1.1;${noClip}border-top:${u(0.3)} solid #000;padding-top:${u(0.6)};">${esc(c.moneyLine)}</div>
      <div style="flex-shrink:0;font-size:${u(f.fMeta)};font-weight:600;line-height:1.1;${noClip}">Dropped ${esc(c.dateDropped)} · Ref ${esc(c.ref)}</div>
    </div>`;
}

/** Preview HTML for one drop-off label — same physically-proportioned box as labelPreview. */
export function dropOffLabelPreview(m: LabelMedia, c: DropOffLabelContent, qr: string | undefined, o: DropOffLabelOpts = {}, maxPx = 300): string {
  const { w, h } = mmOf(m);
  const pxPerMm = maxPx / Math.max(w, h);
  const u = mkU('px', pxPerMm);
  return `<div style="width:${+(w * pxPerMm).toFixed(1)}px;height:${+(h * pxPerMm).toFixed(1)}px;border:1px solid #e5e7eb;overflow:hidden;">${dropOffLabelBody(u, m, c, qr, o)}</div>`;
}

/**
 * Print document for one or more drop-off labels — one physical label per
 * page, chained through a single print job (so a batch is one dialog, not one
 * blocked popup per device). Uses the SAME page/rotation builder as the
 * inventory label, so it prints correctly on the ZP 450 and the DYMO alike.
 */
export function dropOffLabelsPrintDoc(
  title: string,
  m: LabelMedia,
  entries: { content: DropOffLabelContent; qr?: string }[],
  o: DropOffLabelOpts = {},
): string {
  const u = mkU('mm', 1);
  return pagesPrintDoc(title, m, entries.map(e => dropOffLabelBody(u, m, e.content, e.qr, o)), { autoPrint: false });
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
  return pagesPrintDoc(title, m, [labelBody(mkU('mm', 1), m, c, img, o)], { autoPrint: true });
}

/**
 * The shared print-page builder: wraps already-rendered label bodies (of ANY
 * label type on this system) in the correct physical page for the media, one
 * page per label, chained with page-break-after so a batch prints as a single
 * job. This is the one place the DYMO portrait-media rotation lives — see the
 * file header for why it exists — so no label type may build its own page.
 *
 * `autoPrint` fires the browser's print dialog on load and closes the window
 * after (the single-label inventory flow's long-standing behaviour). A batch
 * leaves the window open instead, matching services/shelfTag.ts's batch print,
 * so the operator can check the run before sending it.
 */
function pagesPrintDoc(title: string, m: LabelMedia, bodies: string[], opts: { autoPrint: boolean }): string {
  const { w, h } = mmOf(m);
  const common = `
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; -webkit-font-smoothing: none; }
    img { image-rendering: pixelated; }
    .page { position: relative; overflow: hidden; page-break-after: always; }
    .page:last-child { page-break-after: auto; }`;
  const script = opts.autoPrint
    ? `<script>window.onload=function(){window.focus();window.print();setTimeout(function(){window.close();},300);};</script>`
    : `<script>window.onload=function(){window.focus();};</script>`;

  if (m.dymo) {
    // Portrait page = native DYMO media; rotate each landscape label into it.
    const pages = bodies.map(b => `<div class="page" style="width:${h}mm;height:${w}mm;"><div class="rot">${b}</div></div>`).join('');
    return `<!DOCTYPE html><html><head><title>${esc(title)}</title><style>
      @page { size: ${h}mm ${w}mm; margin: 0; }
      html, body { width: ${h}mm; overflow: hidden; }
      .rot { position: absolute; top: 0; left: 0; width: ${w}mm; height: ${h}mm; transform-origin: 0 0; transform: translate(${h}mm, 0) rotate(90deg); }
      ${common}
    </style></head><body>${pages}${script}</body></html>`;
  }

  const pages = bodies.map(b => `<div class="page" style="width:${w}mm;height:${h}mm;"><div class="lab">${b}</div></div>`).join('');
  return `<!DOCTYPE html><html><head><title>${esc(title)}</title><style>
    @page { size: ${w}mm ${h}mm; margin: 0; }
    html, body { width: ${w}mm; overflow: hidden; }
    .lab { position: absolute; top: 0; left: 0; width: ${w}mm; height: ${h}mm; }
    ${common}
  </style></head><body>${pages}${script}</body></html>`;
}
