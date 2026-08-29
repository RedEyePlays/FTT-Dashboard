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
  // SKU (inventory) or Repair ID (repairs) — very large. OPTIONAL: the
  // wholesale repair label omits it entirely (the owner asked to drop the
  // batch number from the label — "I don't care which wholesale batch it's
  // from"). Inventory and retail repair labels always pass a real value, so
  // their rendered output is byte-for-byte unchanged by this being optional.
  code?: string;
  // Device / accessory name. OPTIONAL: the repair labels (both retail and
  // wholesale) deliberately omit it — a repair tag sits on the device the
  // technician is already holding, so the brand/model line is redundant there.
  // Inventory and accessory labels always pass a real value, so their rendered
  // output is byte-for-byte unchanged by this being optional.
  device?: string;
  sub?: string;     // storage · color · battery health, or repair type
  serial?: string;  // IMEI / serial — large, bold, high-contrast
  status?: string;  // status badge label
  // Reported issue — WHOLESALE REPAIR LABEL ONLY. Rendered as a full-width
  // row beneath the text/QR row (same trick the drop-off label's money line
  // uses: the content that must stay legible never competes with the QR for
  // width). Inventory labels never set it, so it never renders for them.
  issue?: string;
}

/**
 * Which label TYPE is being rendered — the one knob that lets the repair
 * labels re-proportion this shared body without touching the inventory
 * label's own (already correct, separately-tuned) sizing.
 *
 * This is deliberately a variant tag on the SHARED renderer rather than a
 * forked copy of it: same philosophy as the drop-off label lower in this file
 * ("a second label TYPE on this same system, not a second label system"). Only
 * the type scale and the QR scale below vary; the geometry, the flex-shrink:0
 * non-shrink rule, the push-down mechanism and the print page are identical
 * for every variant.
 */
export type LabelVariant = 'inventory' | 'repairRetail' | 'repairWholesale';

// Multiplier on every text size, per variant. `inventory` is 1 by definition —
// it is the baseline these constants were physically print-tested at, and must
// never move as a side effect of a repair-label change.
//
//  • repairRetail 1.15 — this label lost its device/model line (5 content lines
//    down to 4) and its code line shrank from a full "RPR-000123" to "R000123"
//    (10 chars → 7). At the unchanged inventory scale the result read visibly
//    undersized for the space: a sparse tag with a big empty lower half. 1.15
//    spends the freed vertical room on legibility. It is bounded by the
//    worst-case fit check in maxSafePushDownMm/the tests, not picked freehand:
//    4 lines at 1.15× still occupy less height than the inventory label's 5
//    lines at 1.0×, on the tightest (2×1") template.
//  • repairWholesale 0.9 — the owner first asked for smaller text on this
//    one (it had to make room for a brand-new full-width issue row) then,
//    once the full IMEI line was dropped in favor of a short "Wholesale -
//    1234" sub-line, asked for the remaining text bumped back up a bit. 0.9
//    is the largest round increase that still leaves the issue line 2–3
//    readable wrapped lines at 2×1" (proven with measured geometry in
//    labelLayout.test.ts rather than assumed) — up from the original 0.8,
//    which was tuned back when this label still carried a full IMEI line.
const VARIANT_TEXT_SCALE: Record<LabelVariant, number> = {
  inventory: 1,
  repairRetail: 1.15,
  repairWholesale: 0.9,
};

// Multiplier on the computed QR size, per variant. The repair labels' QR
// encodes one short repair number and is scanned from a bench a few inches
// away — not off a shelf across the room like an inventory tag — so it does
// not need the inventory label's generous target. 0.65 is a deliberate ~⅓
// reduction that still lands the 2×1" repair QR at ~7.8mm, i.e. close to the
// 9mm corner QR already shipping and scanning reliably in production on the
// DYMO shelf tag (services/shelfTag.ts) — this codebase's only real-world
// "how small still scans" evidence — for a comparable short payload. As with
// nonDymoQrSizeMm's own note: no physical print + phone-camera scan test was
// possible in this environment; confirm on a real print before relying on it.
// The freed width is reclaimed automatically by the text column (it is
// `flex:1` beside a `flex-shrink:0` QR), so no gap is left behind.
const VARIANT_QR_SCALE: Record<LabelVariant, number> = {
  inventory: 1,
  repairRetail: 0.65,
  repairWholesale: 0.65,
};

// How many lines the wholesale label's issue row is allowed to wrap to. The
// non-truncation rule this file follows everywhere (wrap, never ellipsis)
// means the issue is never cut mid-word by CSS; this cap is what stops a
// pathologically long issue from pushing the whole row past the label edge,
// and it is the same "measured multi-line cap" the code/serial lines already
// use (`max-height: font-size × lines × line-height`). 3 lines at the
// wholesale scale is ~2× a typical "Cracked screen, no touch" issue.
export const ISSUE_MAX_LINES = 3;

// The two variant factors above, exposed for the OTHER renderers of these same
// labels — the jsPDF export in components/RepairLabelModal.tsx lays each line
// out by hand and has to scale by exactly the same numbers, or the PDF and the
// browser print would drift apart. Same reasoning as nonDymoFontSizesMm being
// the single source shared by labelBody and maxSafePushDownMm.
export const labelTextScale = (variant: LabelVariant = 'inventory'): number => VARIANT_TEXT_SCALE[variant] ?? 1;
export const labelQrScale = (variant: LabelVariant = 'inventory'): number => VARIANT_QR_SCALE[variant] ?? 1;

export interface LabelImages { qr?: string; barcode?: string; }
export interface LabelOpts {
  showBarcode: boolean;
  showStatus: boolean;
  barcodeOnly?: boolean;
  // Which label TYPE this render is — see LabelVariant. Undefined means
  // 'inventory', so every existing caller keeps byte-identical output.
  variant?: LabelVariant;
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
  c: Pick<LabelContent, 'code' | 'device' | 'sub' | 'serial' | 'issue'>,
  opts: { padMm?: number; lineGapMm?: number; showBarcode: boolean; hasBarcodeImage: boolean; variant?: LabelVariant },
  ceilingMm: number = MAX_PUSH_DOWN_MM,
): number {
  if (m.dymo) return 0; // Dymo keeps its own separately-tuned layout; push-down never applies there.
  const { h } = mmOf(m);
  const pad = opts.padMm ?? 2.0;
  const lineGap = clamp(opts.lineGapMm ?? 1.1, 0, 1.5);
  const showBarcode = opts.showBarcode && opts.hasBarcodeImage;
  const bcH = showBarcode ? h * 0.14 : 0;
  const variant = opts.variant ?? 'inventory';
  // The wholesale issue row lives OUTSIDE the pushed-down text column (it's a
  // full-width row beneath it, like the drop-off label's money line), so it
  // eats into the space that column has available — exactly the way the
  // barcode row already does.
  const { fIssue } = nonDymoFontSizesMm(m, variant);
  const issueH = c.issue ? fIssue * ISSUE_MAX_LINES * 1.15 + 1 : 0;
  const available = (h - pad * 2) - (showBarcode ? bcH + 1 : 0) - issueH;

  const { fOrg, fCode, fDevice, fSub, fSerial } = nonDymoFontSizesMm(m, variant);
  // Rendered line-box heights = font-size × line-height (matches the
  // line-height values labelBody actually sets on each line below). The
  // device and code lines are conditional now that the wholesale repair
  // label omits both, the same way `sub` and `serial` already were —
  // inventory and retail repair labels always pass a code, so their result
  // is unchanged.
  const lineHeights = [fOrg * 1];
  if (c.code) lineHeights.push(fCode * 1);
  if (c.device) lineHeights.push(fDevice * 1.05);
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
export function nonDymoFontSizesMm(m: LabelMedia, variant: LabelVariant = 'inventory'): { fOrg: number; fCode: number; fDevice: number; fSub: number; fSerial: number; fIssue: number } {
  const large = m.w >= 4;
  const s = VARIANT_TEXT_SCALE[variant] ?? 1;
  const r = (n: number) => +(n * s).toFixed(2);
  return {
    fOrg: r(large ? 3.2 : 2.6),
    fCode: r(large ? 7.5 : 5.2),
    fDevice: r(large ? 4.6 : 3.6),
    fSub: r(large ? 3.4 : 2.8),
    fSerial: r(large ? 4.4 : 3.6),
    // The wholesale issue row. Sized off the `sub` line rather than given its
    // own independent constant so it moves with the variant scale like every
    // other line, and reads as body text, not a heading.
    fIssue: r(large ? 3.4 : 2.8),
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
export function nonDymoQrSizeMm(m: LabelMedia, variant: LabelVariant = 'inventory'): number {
  const { w, h } = mmOf(m);
  const base = Math.min(w, h) * (m.h >= 3 ? 0.34 : 0.47);
  return +(base * (VARIANT_QR_SCALE[variant] ?? 1)).toFixed(2);
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
export function textColumnWidthMm(m: LabelMedia, opts: { padMm?: number; showQr: boolean; variant?: LabelVariant }): number {
  const { w } = mmOf(m);
  const pad = opts.padMm ?? 2.0;
  const qrGap = 2; // matches labelBody's `gap:${u(2)}` on the text/QR row
  const qrW = opts.showQr ? nonDymoQrSizeMm(m, opts.variant ?? 'inventory') + qrGap : 0;
  return +(w - pad * 2 - qrW).toFixed(2);
}

/**
 * The width (mm) available to the wholesale label's full-width issue row: the
 * whole label minus padding, since that row sits BENEATH the text/QR row and
 * so never competes with the QR for width (same deliberate arrangement as the
 * drop-off label's money line). Exported so the fit tests can prove, with real
 * measured geometry, that a realistic issue wraps within ISSUE_MAX_LINES
 * instead of only asserting the string is present.
 */
export function issueRowWidthMm(m: LabelMedia, opts: { padMm?: number } = {}): number {
  const { w } = mmOf(m);
  const pad = opts.padMm ?? 2.0;
  return +(w - pad * 2).toFixed(2);
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

/**
 * The RETAIL REPAIR label's code line, DISPLAY ONLY: a single "R" plus the
 * ticket's numeric suffix — "RPR-000123" prints as "R000123".
 *
 * Same rationale (and same display-only contract) as shortLabelSku above: the
 * alphabetic prefix is identical on every ticket this shop issues, so on a tag
 * that already prints the store name it is pure wasted width on the largest,
 * most clip-prone line of the label. The stored `repair.repairNumber`, the
 * CODE128 barcode payload and the QR payload all keep the FULL value, so a
 * scan still resolves the real ticket.
 *
 * The digits are taken with a trailing-digit-run regex rather than by slicing
 * a hardcoded "RPR-" literal, because the repair-number prefix format is
 * services/sku.ts's concern and may change.
 *
 * FALLBACK: a value with NO trailing digits at all (foreign/legacy data) is
 * returned completely unchanged — no "R" is prepended — since "R" + an
 * arbitrary string would be a fabricated identifier, not a shortening.
 */
export function shortRepairCode(repairNumber: string): string {
  const digits = (repairNumber || '').match(/(\d+)\s*$/);
  return digits ? `R${digits[1]}` : repairNumber;
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
  const variant = o.variant ?? 'inventory';
  // Never ellipsis — wrap the value instead. The same rule (and the same CSS)
  // the code/serial lines below already use, applied to the wholesale issue
  // row: a half-printed fault description is worse than a wrapped one.
  const noClip = 'overflow-wrap:anywhere;word-break:break-all;';

  const pill = showStatus
    ? `<span style="align-self:flex-start;border:${u(0.3)} solid #000;border-radius:${u(1.4)};padding:${u(0.4)} ${u(1.2)};font-size:${u(dymo ? 2.6 : 2.2)};font-weight:800;text-transform:uppercase;letter-spacing:.4px;line-height:1;white-space:nowrap;">${esc(c.status)}</span>`
    : '';

  if (dymo) {
    // Landscape 89 × 36 mm: text column on the left, large square QR on the
    // right, full-width barcode across the bottom.
    // Scaled per label type (see VARIANT_TEXT_SCALE); ×1 for inventory, so the
    // inventory label's separately-tuned DYMO sizes are literally unchanged.
    const ts = VARIANT_TEXT_SCALE[variant] ?? 1;
    const t = (n: number) => +(n * ts).toFixed(2);
    const fOrg = t(2.7), fCode = t(7.2), fDevice = t(4.4), fSub = t(3.0), fSerial = t(4.2);
    const fIssue = t(3.0);
    const gap = 1.0;
    const bcH = showBarcode ? 5.5 : 0;
    const { h } = mmOf(m);
    // Full-width issue row (wholesale only) sits between the text/QR row and
    // the barcode, so it takes its height off the top region — which is what
    // the QR is sized from.
    const issueH = c.issue ? +(fIssue * ISSUE_MAX_LINES * 1.15).toFixed(2) : 0;
    // QR fills the height of the top region (label height − padding − barcode
    // − issue row), then scales by the variant's QR factor.
    const qrS = +((h - pad * 2 - (bcH ? bcH + gap : 0) - (issueH ? issueH + gap : 0)) * (VARIANT_QR_SCALE[variant] ?? 1)).toFixed(2);
    return `
      <div style="box-sizing:border-box;width:100%;height:100%;padding:${u(pad)};background:#fff;color:#000;
        font-family:'Inter',system-ui,Arial,sans-serif;display:flex;flex-direction:column;gap:${u(gap)};overflow:hidden;">
        <div style="flex:1;min-height:0;display:flex;gap:${u(2)};">
          <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:${u(1.1)};">
            <div style="font-weight:800;font-size:${u(fOrg)};letter-spacing:.5px;line-height:1;">${esc(c.org)}</div>
            ${c.code ? `<div style="font-family:'Courier New',monospace;font-weight:800;font-size:${u(fCode)};line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.code)}</div>` : ''}
            ${c.device ? `<div style="font-weight:700;font-size:${u(fDevice)};line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.device)}</div>` : ''}
            ${c.sub ? `<div style="font-size:${u(fSub)};font-weight:600;color:#000;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.sub)}</div>` : ''}
            ${c.serial ? `<div style="font-family:'Courier New',monospace;font-weight:800;font-size:${u(fSerial)};color:#000;line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.serial)}</div>` : ''}
            ${pill}
          </div>
          ${img.qr ? `<img src="${img.qr}" style="width:${u(qrS)};height:${u(qrS)};flex-shrink:0;align-self:center;image-rendering:pixelated;" />` : ''}
        </div>
        ${c.issue ? `<div style="flex-shrink:0;font-weight:600;font-size:${u(fIssue)};line-height:1.15;max-height:${u(fIssue * ISSUE_MAX_LINES * 1.15)};${noClip}overflow:hidden;">${esc(c.issue)}</div>` : ''}
        ${showBarcode ? `<img src="${img.barcode}" style="width:100%;height:${u(bcH)};object-fit:fill;" />` : ''}
      </div>`;
  }

  // Generic layout for the inch (thermal roll) templates: branding row, text +
  // QR, optional barcode. Bigger, bolder, high-contrast — same content rules.
  const { w, h } = mmOf(m);
  const { fOrg, fCode, fDevice, fSub, fSerial, fIssue } = nonDymoFontSizesMm(m, variant);
  const qrS = nonDymoQrSizeMm(m, variant);
  const bcH = showBarcode ? h * 0.14 : 0;
  // Full-width issue row (wholesale repair label only) — see the drop-off
  // label's money row for the same deliberate arrangement: content that must
  // stay legible goes on its OWN full-width row so it never competes with the
  // QR for width. Its height is reserved here and subtracted in
  // maxSafePushDownMm identically, so the two can't drift.
  const issueH = c.issue ? +(fIssue * ISSUE_MAX_LINES * 1.15).toFixed(2) : 0;
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
    maxSafePushDownMm(m, c, { padMm: o.padMm, lineGapMm: o.lineGapMm, showBarcode: o.showBarcode, hasBarcodeImage: !!img.barcode, variant }),
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
          ${c.code ? `<div style="flex-shrink:0;font-family:'Courier New',monospace;font-weight:800;font-size:${u(fCode)};line-height:1.05;max-height:${u(fCode * 2.1)};overflow-wrap:anywhere;word-break:break-all;overflow:hidden;">${esc(c.code)}</div>` : ''}
          ${c.device ? `<div style="flex-shrink:0;font-weight:700;font-size:${u(fDevice)};line-height:1.05;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.device)}</div>` : ''}
          ${c.sub ? `<div style="flex-shrink:0;font-size:${u(fSub)};font-weight:600;color:#000;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(c.sub)}</div>` : ''}
          ${c.serial ? `<div style="flex-shrink:0;font-family:'Courier New',monospace;font-weight:800;font-size:${u(fSerial)};color:#000;line-height:1.05;max-height:${u(fSerial * 2.1)};overflow-wrap:anywhere;word-break:break-all;overflow:hidden;">${esc(c.serial)}</div>` : ''}
        </div>
        ${img.qr ? `<img src="${img.qr}" style="width:${u(qrS)};height:${u(qrS)};flex-shrink:0;align-self:center;image-rendering:pixelated;" />` : ''}
      </div>
      ${c.issue ? `<div style="flex-shrink:0;font-weight:600;font-size:${u(fIssue)};line-height:1.15;max-height:${u(issueH)};${noClip}overflow:hidden;">${esc(c.issue)}</div>` : ''}
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
  // Neither of these is PRINTED on the label any more (the bottom
  // "Dropped {date} · Ref {id}" meta row was removed at the owner's request —
  // the label ends at the money line). They stay on the content shape because
  // they're still real, populated drop-off facts other code reads: `ref` names
  // the print job in services/dropOffLabel.ts's dropOffLabelsPrintDoc title.
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
// inventory label's 2.0mm because this label carries a full-width money row
// under the text/QR row and needs the vertical room. (It used to carry two
// such rows — money + a date/ref meta row — before the meta row was removed;
// the tighter padding is kept as-is, physically tested, rather than re-tuned
// on the back of a content removal that only ever frees space.)
const DROPOFF_PAD_MM = 1.6;
const DROPOFF_QR_GAP_MM = 2;

/**
 * Font sizes (mm) for the drop-off label, scaled from the DYMO 89mm landscape
 * template the shop actually prints on so the same layout works on every
 * configured stock size. The single source both the body and the fit
 * calculation below read, so the two can never drift (same arrangement as
 * nonDymoFontSizesMm).
 */
export function dropOffFontSizesMm(m: LabelMedia): {
  fOrg: number; fBuyer: number; fDevice: number; fMoney: number;
} {
  const { w } = mmOf(m);
  const s = clamp(w / 89, 0.6, 1.2);
  const r = (n: number) => +(n * s).toFixed(2);
  // No `fMeta`: the bottom meta row ("Dropped {date} · Ref {id}") was removed
  // from this label at the owner's request — the label now ENDS at the money
  // line — so the size that only ever fed that row is gone with it rather
  // than left behind as an unused export.
  // No `fSerial` either, for the same reason: the label no longer PRINTS the
  // IMEI/serial as text (removed at the owner's request) — the QR is the
  // only place it appears now.
  return { fOrg: r(2.7), fBuyer: r(5.0), fDevice: r(4.0), fMoney: r(4.0) };
}

/**
 * The QR's rendered size (mm) — a comfortably scannable square. This label
 * gets scanned off a shelf or a bin, so it's sized generously (0.55 of the
 * short side, well above the 9mm floor and the inventory label's text-heavy
 * 0.34/0.47), capped so the full-width money row beneath still gets its
 * height.
 *
 * Used to shrink to make room for a printed serial line next to it — the
 * label no longer prints the IMEI/serial as text at all (removed at the
 * owner's request; the QR is the only place it appears now), so there is
 * nothing else on this row for the QR to negotiate width with, and the size
 * is now a fixed function of the media alone.
 */
export function dropOffQrSizeMm(
  m: LabelMedia,
  opts: { padMm?: number } = {},
): number {
  const { w, h } = mmOf(m);
  const pad = opts.padMm ?? DROPOFF_PAD_MM;
  // 0.42/0.47 (down from 0.55/0.62) — a further, explicit size-down of an
  // already-scannable QR, per the owner's request. Still comfortably above
  // the ~9mm floor proven scannable on the shelf tag's own IMEI QR
  // (services/shelfTag.ts) at any configured label size.
  return +Math.min(Math.min(w, h) * 0.42, (h - pad * 2) * 0.47).toFixed(2);
}

/**
 * The width (mm) left for the top block's text beside the QR — the drop-off
 * label's counterpart to textColumnWidthMm, computed from the SAME subtraction
 * the flex row below actually performs, so tests can prove the fit with real
 * numbers instead of only asserting a string is present.
 */
export function dropOffTextColumnWidthMm(
  m: LabelMedia,
  opts: { padMm?: number; showQr: boolean },
): number {
  const { w } = mmOf(m);
  const pad = opts.padMm ?? DROPOFF_PAD_MM;
  const qrW = opts.showQr ? dropOffQrSizeMm(m, { padMm: opts.padMm }) + DROPOFF_QR_GAP_MM : 0;
  return +(w - pad * 2 - qrW).toFixed(2);
}

/**
 * The drop-off label body, sized to fill its parent — same contract as
 * labelBody, so it drops straight into the shared preview box and print page.
 *
 * Layout: store name / buyer / device in a left column with the QR beside
 * it, then the money line across the FULL label width beneath — and the
 * label ENDS there (no date/reference meta row; removed at the owner's
 * request). Putting the money on its own full-width row (rather
 * than in the QR-adjacent column) is deliberate: the figures are the most
 * clip-sensitive content on the label, and this way the QR never competes
 * with them for width at all.
 *
 * Both the text column and the QR are VERTICALLY CENTERED in the top row
 * (`justify-content:center` / `align-self:center`, previously both
 * flex-start). Once the serial line and the date/ref meta row were removed
 * this label had noticeably more height than content, and top-aligning both
 * left all of that as one dead band under the text and beside the QR. The
 * money row keeps its own separate rule about staying last. The divider
 * line that used to sit above the money row was removed at the owner's
 * request too — the size and weight jump already separates it.
 *
 * `flex-shrink:0` on every line is load-bearing for the same reason it is on
 * the inventory label and the shelf tag (see labelBody's long comment): a flex
 * column's default flex-shrink:1 SILENTLY COMPRESSES lines to fit rather than
 * letting them overflow, which on a physical print reads as squashed/cut-off
 * text. With it, content either fits or cleanly clips — and the money line
 * that must never clip wraps instead of clipping.
 *
 * The IMEI/serial is deliberately NOT printed as text here (removed at the
 * owner's request) — it still goes into the QR (see dropOffLabelContent /
 * serialQr in services/dropOffLabel.ts), which is the only place it appears
 * on the label now.
 */
function dropOffLabelBody(u: U, m: LabelMedia, c: DropOffLabelContent, qr: string | undefined, o: DropOffLabelOpts): string {
  const pad = o.padMm ?? DROPOFF_PAD_MM;
  const lineGap = clamp(o.lineGapMm ?? 0.9, 0, 1.5);
  const f = dropOffFontSizesMm(m);
  const qrS = dropOffQrSizeMm(m, { padMm: o.padMm });
  // Never ellipsis: wrap the value instead. Same rule (and same CSS) the
  // inventory label's code line uses.
  const noClip = 'overflow-wrap:anywhere;word-break:break-all;';
  return `
    <div style="box-sizing:border-box;width:100%;height:100%;padding:${u(pad)};background:#fff;color:#000;
      font-family:'Inter',system-ui,Arial,sans-serif;display:flex;flex-direction:column;gap:${u(lineGap)};overflow:hidden;">
      <div style="flex:1;min-height:0;display:flex;gap:${u(DROPOFF_QR_GAP_MM)};">
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:${u(lineGap)};overflow:hidden;">
          <div style="flex-shrink:0;font-weight:800;font-size:${u(f.fOrg)};letter-spacing:.5px;line-height:1;text-transform:uppercase;">${esc(c.org)}</div>
          <div style="flex-shrink:0;font-weight:800;font-size:${u(f.fBuyer)};line-height:1.05;${noClip}overflow:hidden;">${esc(c.buyerName)}</div>
          <div style="flex-shrink:0;font-weight:700;font-size:${u(f.fDevice)};line-height:1.05;${noClip}overflow:hidden;">${esc(c.device)}</div>
        </div>
        ${qr ? `<img src="${qr}" style="width:${u(qrS)};height:${u(qrS)};flex-shrink:0;align-self:center;image-rendering:pixelated;" />` : ''}
      </div>
      <div style="flex-shrink:0;font-weight:800;font-size:${u(f.fMoney)};line-height:1.1;${noClip}">${esc(c.moneyLine)}</div>
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
