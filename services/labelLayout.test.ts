import { laptopPrintSpecs } from '../domain/deviceSpecs';
import { describe, it, expect } from 'vitest';
import {
  labelPrintDoc, LabelMedia, LabelContent, LabelImages, LabelOpts, MAX_PUSH_DOWN_MM, maxSafePushDownMm,
  shortLabelSku, nonDymoQrSizeMm, nonDymoFontSizesMm, estimateTextWidthMm,
  estimateProportionalTextWidthMm, textColumnWidthMm, deviceSubLine, deviceLabelSpecs,
  extraSpecLine, DYMO_LAPTOP_QR_MM, labelTextHeightMm, labelTextRoomMm, fitsExtraSpec,
  shortRepairCode, issueRowWidthMm, ISSUE_MAX_LINES,
} from './labelLayout';
import { INVENTORY_SKU_PREFIX } from './sku';

// Regression coverage for the "Push content down" / "Line spacing" / content
// padding settings actually reaching the real browser PRINT path
// (labelPrintDoc — the exact function LabelModal/RepairLabelModal's Print
// button calls), not just the preview or PDF export.
//
// IMPORTANT CAVEAT: these are STRING-based smoke tests only — they assert
// the expected CSS values appear in the generated HTML, not that a browser
// actually renders them at the expected pixel position. That distinction
// matters here specifically: two earlier implementations of push-down each
// passed tests exactly like these (the CSS property was present and
// correct) while producing ZERO visible effect on the real, physical ZP 450
// printout — a `transform: translateY(...)` that real label-printer
// drivers don't implement, then a margin-top/negative-margin-bottom pair
// that also failed on the physical driver despite being pixel-verified
// correct in an actual Chromium DOM layout. So "the string is present" is
// NOT sufficient proof this works — it only proves the value reached the
// generated HTML, one necessary link in the chain, not the whole chain.
//
// The current implementation (padding-top with justify-content:flex-start,
// no transform, no margin cancellation) was verified against REAL RENDERED
// GEOMETRY in a headless Chromium (not just string matching) before being
// adopted — measured before/after pixel deltas are recorded in this change's
// PR description, since Playwright/Chromium isn't a project dependency and
// can't run as part of `npm test`/CI. If a future change touches this layout
// again, re-verify with real rendered geometry the same way, not just by
// re-running these string checks.
const media2x1: LabelMedia = { id: '2x1', w: 2, h: 1, label: '2 x 1' };

// Short content (no sub/serial) — plenty of headroom on the 2×1" template, so
// the nominal MAX_PUSH_DOWN_MM ceiling applies unclamped by the per-item
// content-aware limit. Used for the "does the value reach the HTML" tests,
// which want a predictable, un-clamped padding-top to assert against.
const shortContent: LabelContent = { org: 'FlipThatTech', code: 'SKU-1', device: 'iPhone 14' };
const img: LabelImages = {};

// Formatted the same way labelPrintDoc's mm unit emitter does (mkU('mm', 1)):
// a bare number rounded to 3 decimals + "mm".
const mm = (v: number) => `${+v.toFixed(3)}mm`;
const BASE_PAD = 0.85;

describe('labelPrintDoc — push-down offset reaches the real print HTML', () => {
  it('defaults (no pushDownMm) use the base padding-top only, and never emit transform or margin-cancellation (the two previously-broken mechanisms)', () => {
    const opts: LabelOpts = { showBarcode: false, showStatus: false };
    const html = labelPrintDoc('t', media2x1, shortContent, img, opts);
    expect(html).toContain(`padding-top:${mm(BASE_PAD)}`);
    // Locks in that push-down is never implemented via a CSS transform or a
    // margin-top/negative-margin-bottom pair again — both were confirmed by
    // physical printing to have zero effect on the real ZP 450 output
    // despite passing string-based checks like this one.
    expect(html).not.toMatch(/transform\s*:/);
    expect(html).not.toMatch(/margin-top:/);
    expect(html).not.toMatch(/margin-bottom:/);
  });

  it('a configured pushDownMm adds directly to the base padding-top, for content with headroom to use the full nominal ceiling', () => {
    const maxForShort = maxSafePushDownMm(media2x1, shortContent, { showBarcode: false, hasBarcodeImage: false });
    expect(maxForShort).toBe(MAX_PUSH_DOWN_MM); // sanity: short content isn't itself the constraint here
    const opts: LabelOpts = { showBarcode: false, showStatus: false, pushDownMm: MAX_PUSH_DOWN_MM };
    const html = labelPrintDoc('t', media2x1, shortContent, img, opts);
    expect(html).toContain(`padding-top:${mm(BASE_PAD + MAX_PUSH_DOWN_MM)}`);
  });

  it('clamps an out-of-range pushDownMm to the nominal ceiling for content with enough headroom', () => {
    const html = labelPrintDoc('t', media2x1, shortContent, img, { showBarcode: false, showStatus: false, pushDownMm: 99 });
    expect(html).toContain(`padding-top:${mm(BASE_PAD + MAX_PUSH_DOWN_MM)}`);
  });

  it('clamps a negative pushDownMm to 0 (base padding-top only)', () => {
    const html = labelPrintDoc('t', media2x1, shortContent, img, { showBarcode: false, showStatus: false, pushDownMm: -5 });
    expect(html).toContain(`padding-top:${mm(BASE_PAD)}`);
  });

  it('push-down applies in labelPrintDoc for a repair label\'s content too (org/code/device present)', () => {
    const opts: LabelOpts = { showBarcode: true, showStatus: true, pushDownMm: MAX_PUSH_DOWN_MM };
    const html = labelPrintDoc('Repair Label', media2x1, { ...shortContent, status: 'In Repair' }, img, opts);
    expect(html).toContain(`padding-top:${mm(BASE_PAD + MAX_PUSH_DOWN_MM)}`);
  });

  it('Dymo labels are unaffected by pushDownMm (own separately-tuned layout, no override)', () => {
    const dymoMedia: LabelMedia = { id: 'dymo-36x89', w: 89 / 25.4, h: 36 / 25.4, label: 'DYMO', dymo: true };
    const opts: LabelOpts = { showBarcode: false, showStatus: false, pushDownMm: MAX_PUSH_DOWN_MM };
    const html = labelPrintDoc('t', dymoMedia, shortContent, img, opts);
    expect(html).not.toMatch(/padding-top:/);
    // The page-level 90° feed rotation (`transform: translate(...) rotate(90deg)`
    // on `.rot`) is a separate, legitimate mechanism — only a translateY
    // push-down transform should never appear.
    expect(html).not.toMatch(/transform:\s*translateY/);
    expect(maxSafePushDownMm(dymoMedia, shortContent, { showBarcode: false, hasBarcodeImage: false })).toBe(0);
  });
});

describe('labelPrintDoc — pushDownMm purely translates, never resizes or truncates content', () => {
  // Regression coverage for the original bug (physical print comparison):
  // pushDownMm=2.5 rendered text visibly LARGER and truncated content that
  // pushDownMm=2.0 rendered correctly, on the tightest template (2×1"),
  // proving pushDown was somehow feeding a size/overflow-driven scale
  // decision rather than a pure position shift. Real rendered geometry
  // (headless Chromium, not just this string comparison) confirmed
  // font-size is byte-identical at every pushDown value both before and
  // after the fix — see the PR description for the measured numbers — this
  // suite locks in the string-level half of that proof for CI.
  const worstCase: LabelContent = {
    // Worst-case realistic content per the task: a long-ish device name, a
    // full storage/color line, and a real 15-digit IMEI, all present at
    // once — the common case for a fully-specified device, not an edge case.
    org: 'FlipThatTech', code: 'FTT-0000029', device: 'iPhone 14 Pro Max',
    sub: '256GB · SILVER', serial: '490154203237518',
  };

  // Extract every emitted `font-size:...` value, in document order, so the
  // set (and the order) can be compared across pushDown values directly.
  const fontSizes = (html: string): string[] => Array.from(html.matchAll(/font-size:([^;"]+)/g)).map(m => m[1]);
  // The text nodes actually present in the rendered body (between the tags),
  // to prove content is never shortened/ellipsis-fabricated at the DOM level
  // — this is the literal string emitted, independent of how a browser
  // later paints/clips it.
  const textNodes = (html: string): string[] => Array.from(html.matchAll(/>([^<>]+)</g)).map(m => m[1]).filter(s => s.trim());

  it('the worst-case content (all five lines) has zero safe headroom on the tightest template — pushDown clamps to 0, never overflowing', () => {
    // This is the exact combination that triggered the original bug report.
    // Real rendered geometry confirmed the OLD basePad (1.4mm) already
    // clipped ~0.55mm off this content even at pushDownMm=0; the new
    // BASE_PAD_MM (0.85mm) was chosen so this content has EXACTLY zero
    // overflow at the baseline, which also means it has zero further room —
    // physically correct: there's nowhere left to push this much content on
    // a 1" tall label without cropping something.
    const max = maxSafePushDownMm(media2x1, worstCase, { showBarcode: false, hasBarcodeImage: false });
    expect(max).toBe(0);
  });

  it('emits byte-identical font-size values and text content at pushDownMm 0, half of the nominal ceiling, and well beyond it — the worst case content clamps to 0 throughout', () => {
    const at = (pushDownMm: number) => labelPrintDoc('t', media2x1, worstCase, img, { showBarcode: false, showStatus: false, pushDownMm });
    const base = at(0);
    const half = at(MAX_PUSH_DOWN_MM / 2);
    const beyond1 = at(1);
    const beyond2 = at(2);
    const wayBeyond = at(99);

    const baseFonts = fontSizes(base);
    expect(baseFonts.length).toBeGreaterThan(0); // sanity: the regex actually matched something
    for (const doc of [half, beyond1, beyond2, wayBeyond]) expect(fontSizes(doc)).toEqual(baseFonts);

    const baseText = textNodes(base);
    for (const doc of [half, beyond1, beyond2, wayBeyond]) expect(textNodes(doc)).toEqual(baseText);
    // All requested values clamp to the SAME zero-headroom result for this
    // content — never growing further apart as the requested value grows.
    expect(half).toBe(base);
    expect(beyond1).toBe(base);
    expect(beyond2).toBe(base);
    expect(wayBeyond).toBe(base);
    // The full, untruncated SKU and serial are literally present in the
    // emitted HTML at every pushDown value — text-overflow:ellipsis is a
    // paint-time CSS behavior, never a DOM-level string edit, so this
    // stays true regardless of how a given renderer visually clips it.
    expect(baseText).toContain(worstCase.code);
    expect(baseText).toContain(worstCase.serial);
    expect(base).toContain(`padding-top:${mm(BASE_PAD)}`);
  });

  it('shorter content on the same tightest template gets real, visible movement — the fix is not "shrink the ceiling for everyone"', () => {
    // Mid case: no serial line (e.g. an accessory, or IMEI not yet known).
    const midCase: LabelContent = { ...worstCase, serial: undefined };
    const midMax = maxSafePushDownMm(media2x1, midCase, { showBarcode: false, hasBarcodeImage: false });
    expect(midMax).toBeGreaterThan(2); // several mm of real headroom, not a fraction of a mm

    // Short case: org/code/device only (e.g. a bare accessory label).
    const shortMax = maxSafePushDownMm(media2x1, shortContent, { showBarcode: false, hasBarcodeImage: false });
    expect(shortMax).toBe(MAX_PUSH_DOWN_MM); // hits the nominal ceiling, plenty of spare room past it

    // And critically: neither case ever needs to touch font-size to get that
    // extra movement — same guarantee as the worst case above.
    const at = (content: LabelContent, pushDownMm: number) =>
      labelPrintDoc('t', media2x1, content, img, { showBarcode: false, showStatus: false, pushDownMm });
    const midBase = fontSizes(at(midCase, 0));
    expect(fontSizes(at(midCase, midMax))).toEqual(midBase);
  });
});

describe('labelPrintDoc — line spacing default + clamp', () => {
  it('defaults to the physically-confirmed known-good 1.1mm gap (no lineGapMm override)', () => {
    const opts: LabelOpts = { showBarcode: false, showStatus: false };
    const html = labelPrintDoc('t', media2x1, shortContent, img, opts);
    expect(html).toContain(`gap:${mm(1.1)}`);
  });

  it('clamps an out-of-range lineGapMm to the [0, 1.5] ceiling', () => {
    const html = labelPrintDoc('t', media2x1, shortContent, img, { showBarcode: false, showStatus: false, lineGapMm: 3 });
    expect(html).toContain(`gap:${mm(1.5)}`);
  });

  it('clamps a negative lineGapMm to 0', () => {
    const html = labelPrintDoc('t', media2x1, shortContent, img, { showBarcode: false, showStatus: false, lineGapMm: -5 });
    expect(html).toContain(`gap:${mm(0)}`);
  });
});

describe('labelPrintDoc — content padding default + override', () => {
  it('defaults to 2.0mm content padding on non-Dymo templates', () => {
    const html = labelPrintDoc('t', media2x1, shortContent, img, { showBarcode: false, showStatus: false });
    expect(html).toContain(`padding:${mm(2.0)}`);
  });

  it('a configured padMm overrides the outer content padding', () => {
    const html = labelPrintDoc('t', media2x1, shortContent, img, { showBarcode: false, showStatus: false, padMm: 4.0 });
    expect(html).toContain(`padding:${mm(4.0)}`);
  });
});

// Label: shorten the displayed SKU (and shrink the QR) so it stops truncating.
describe('shortLabelSku — DISPLAY-ONLY prefix stripping', () => {
  it(`strips the shop's own '${INVENTORY_SKU_PREFIX}-' prefix`, () => {
    expect(shortLabelSku('FTT-0000029')).toBe('0000029');
    expect(shortLabelSku(`${INVENTORY_SKU_PREFIX}-000123`)).toBe('000123');
  });

  it('leaves a value without the current prefix untouched (legacy/foreign SKUs)', () => {
    expect(shortLabelSku('PHN-000001')).toBe('PHN-000001');
    expect(shortLabelSku('X')).toBe('X');
    expect(shortLabelSku('')).toBe('');
  });

  it('is derived from the shared INVENTORY_SKU_PREFIX constant, not a hardcoded literal — proven by re-deriving the same prefix independently', () => {
    // If this were hardcoded to the literal string 'FTT-' instead of reading
    // services/sku.ts's constant, this assertion would still pass today but
    // silently drift the moment the store prefix ever changed. Asserting
    // against a value built from the imported constant (not retyped) is what
    // actually pins the two together.
    const sample = `${INVENTORY_SKU_PREFIX}-042000`;
    expect(shortLabelSku(sample)).toBe(sample.slice(`${INVENTORY_SKU_PREFIX}-`.length));
  });

  it('never mutates the input — the stored SKU is a plain string, untouched by display shortening', () => {
    const sku = 'FTT-0000029';
    const short = shortLabelSku(sku);
    expect(short).not.toBe(sku);
    expect(sku).toBe('FTT-0000029'); // original reference is unchanged (strings are immutable, but this locks the contract in)
  });
});

describe('nonDymoQrSizeMm — Fix 2: smaller QR, real dimensions', () => {
  const size2x1: LabelMedia = { id: '2x1', w: 2, h: 1, label: '2 x 1' };
  const size2x2: LabelMedia = { id: '2x2', w: 2, h: 2, label: '2 x 2' };
  const size2x3: LabelMedia = { id: '2x3', w: 2, h: 3, label: '2 x 3' };
  const size4x6: LabelMedia = { id: '4x6', w: 4, h: 6, label: '4 x 6' };

  it('is meaningfully smaller than the previous 0.6/0.42-of-shorter-side sizing, on every built-in ZP 450 size', () => {
    const oldFormula = (m: LabelMedia) => {
      const IN = 25.4;
      const w = m.w * IN, h = m.h * IN;
      return Math.min(w, h) * (m.h >= 3 ? 0.42 : 0.6);
    };
    for (const m of [size2x1, size2x2, size2x3, size4x6]) {
      const oldS = oldFormula(m);
      const newS = nonDymoQrSizeMm(m);
      expect(newS).toBeLessThan(oldS);
      expect(newS / oldS).toBeLessThan(0.85); // at least a visible ~15%+ reduction, not a rounding-noise change
    }
  });

  it('the 2×1" ZP 450 QR (the template named in the bug report) has concrete, sane real-world dimensions', () => {
    const s = nonDymoQrSizeMm(size2x1);
    expect(s).toBeCloseTo(11.94, 1); // 0.47 × min(50.8mm, 25.4mm)
    // Stays above the 9mm corner QR already shipped and scanning reliably in
    // production on the DYMO shelf tag (services/shelfTag.ts) for the same
    // class of payload (an identifier string) — the closest available
    // real-world precedent for a safe lower bound in this codebase.
    expect(s).toBeGreaterThan(9);
  });

  it('stays proportional across sizes (still driven by the label\'s shorter side, not a flat constant)', () => {
    expect(nonDymoQrSizeMm(size2x2)).toBeGreaterThan(nonDymoQrSizeMm(size2x1));
    expect(nonDymoQrSizeMm(size4x6)).toBeGreaterThan(nonDymoQrSizeMm(size2x3));
  });
});

describe('rendered-geometry evidence — measured text width vs. available column width (not just string presence)', () => {
  const size2x1: LabelMedia = { id: '2x1', w: 2, h: 1, label: '2 x 1' };
  const { fCode, fSerial } = nonDymoFontSizesMm(size2x1);

  it('BEFORE Fix 1 (full "FTT-0000029" SKU): the estimated text width already exceeds the pre-Fix-2 column width — this is the truncation the bug report describes, proven with numbers, not a screenshot', () => {
    const oldQrS = Math.min(...Object.values({ w: 50.8, h: 25.4 })) * 0.6; // old formula, QR enabled
    const oldColW = 50.8 - 2 * 2.0 - (oldQrS + 2);
    const fullSkuWidth = estimateTextWidthMm('FTT-0000029', fCode);
    expect(fullSkuWidth).toBeGreaterThan(oldColW);
  });

  it('AFTER Fix 1 + Fix 2 (shortened SKU "0000029" + the smaller QR): a typical SKU now fits the column with real margin to spare', () => {
    const colW = textColumnWidthMm(size2x1, { showQr: true });
    const typicalSkuWidth = estimateTextWidthMm(shortLabelSku('FTT-0000029'), fCode);
    expect(typicalSkuWidth).toBeLessThan(colW);
    // Not just "fits" — fits with real headroom (at least 15% of the column
    // still spare), proving this isn't a coincidental single-digit win.
    expect(typicalSkuWidth).toBeLessThan(colW * 0.85);
  });

  it('an unusually long SKU still would not fit the column even after Fix 1 + Fix 2 — this is exactly the case Fix 3 (wrap, never ellipsis) exists for', () => {
    const colW = textColumnWidthMm(size2x1, { showQr: true });
    const longSku = shortLabelSku('FTT-0000029999999'); // an unusually long allocation
    const width = estimateTextWidthMm(longSku, fCode);
    expect(width).toBeGreaterThan(colW);
    // And the HTML path actually wraps it (no nowrap/ellipsis) rather than
    // clipping the value mid-string:
    const html = labelPrintDoc('t', size2x1, { org: 'FlipThatTech', code: longSku, device: 'iPhone' }, {}, { showBarcode: false, showStatus: false });
    const codeDivMatch = html.match(new RegExp(`<div style="[^"]*">${longSku}</div>`));
    expect(codeDivMatch).toBeTruthy(); // the code line's own <div>, containing the full unshortened value
    expect(codeDivMatch![0]).toContain('overflow-wrap:anywhere');
    expect(codeDivMatch![0]).not.toContain('white-space:nowrap');
    expect(codeDivMatch![0]).not.toContain('text-overflow:ellipsis');
    expect(html).toContain(longSku); // the full value is still in the DOM, never shortened by CSS overflow
  });

  it('a real 15-digit IMEI does not fit the column on the 2×1" template even after the QR shrink — Fix 3 applies to the serial line too', () => {
    const colW = textColumnWidthMm(size2x1, { showQr: true });
    const imei = '490154203237518'; // 15 digits, the tight case called out explicitly
    const width = estimateTextWidthMm(imei, fSerial);
    expect(width).toBeGreaterThan(colW * 0.7); // tight enough that wrap is a real, not theoretical, safety net
    const html = labelPrintDoc('t', size2x1, { org: 'FlipThatTech', code: '0000029', device: 'iPhone', serial: imei }, {}, { showBarcode: false, showStatus: false });
    expect(html).toContain('overflow-wrap:anywhere');
    expect(html).toContain(imei); // full IMEI present, never ellipsis-clipped
  });
});

describe('deviceSubLine — battery health added to the printed (QR) label', () => {
  it('joins storage · color · battery health, in that order', () => {
    expect(deviceSubLine({ storage: '256GB', color: 'Silver', batteryHealth: '89%' })).toBe('256GB · Silver · Batt 89%');
  });

  it('skips whichever parts are unset, without leaving stray separators', () => {
    expect(deviceSubLine({ storage: '256GB' })).toBe('256GB');
    expect(deviceSubLine({ batteryHealth: '89%' })).toBe('Batt 89%');
    expect(deviceSubLine({ color: 'Silver', batteryHealth: '89%' })).toBe('Silver · Batt 89%');
  });

  it('returns undefined (not an empty string) when nothing is set, so LabelContent.sub is correctly omitted', () => {
    expect(deviceSubLine({})).toBeUndefined();
  });

  it('the battery value reaches the actual rendered label document', () => {
    const html = labelPrintDoc('t', { id: '2x1', w: 2, h: 1, label: '2 x 1' },
      { org: 'FlipThatTech', code: '0000029', device: 'iPhone 14 Pro Max', sub: deviceSubLine({ storage: '256GB', color: 'Silver', batteryHealth: '89%' }) },
      {}, { showBarcode: false, showStatus: false });
    expect(html).toContain('Batt 89%');
  });
});

describe('the QR image element is scaled, not cropped, when shrunk (quiet zone stays intact)', () => {
  it('the <img> gets width/height CSS only — no clip-path/object-fit:cover/overflow that would crop the bitmap (and its baked-in quiet zone)', () => {
    const media: LabelMedia = { id: '2x1', w: 2, h: 1, label: '2 x 1' };
    const html = labelPrintDoc('t', media, { org: 'FlipThatTech', code: '0000029', device: 'iPhone' }, { qr: 'data:image/png;base64,x' }, { showBarcode: false, showStatus: false });
    const imgTagMatch = html.match(/<img src="data:image\/png;base64,x"[^>]*>/);
    expect(imgTagMatch).toBeTruthy();
    const imgTag = imgTagMatch![0];
    expect(imgTag).not.toContain('object-fit');
    expect(imgTag).not.toContain('clip-path');
    expect(imgTag).toContain(`width:${mm(nonDymoQrSizeMm(media))}`);
    expect(imgTag).toContain(`height:${mm(nonDymoQrSizeMm(media))}`);
  });
});

/* ---------------------------------------------------------------------------
 * Label-content simplification: the repair labels (retail + wholesale) drop
 * content the technician doesn't need off the physical tag, and re-proportion
 * what's left. All of it runs through this SAME shared body (labelBody) that
 * renders every inventory label — so each block below pairs its repair-label
 * assertion with the corresponding inventory-label regression check, since the
 * one thing that must NOT happen is a repair-label tweak reaching the
 * inventory label's own (already correct, physically print-tested) output.
 * ------------------------------------------------------------------------- */

describe('shortRepairCode — retail repair label code line, DISPLAY ONLY', () => {
  it('renders "R" + the ticket digits, not the full repair number', () => {
    expect(shortRepairCode('RPR-000123')).toBe('R000123');
    expect(shortRepairCode('RPR-000123')).not.toContain('RPR');
  });

  it('extracts the TRAILING digit run rather than assuming a literal "RPR-" prefix (services/sku.ts owns that format and may change it)', () => {
    expect(shortRepairCode('WHS-000123')).toBe('R000123');
    expect(shortRepairCode('X/9/000123')).toBe('R000123');
    expect(shortRepairCode('000123')).toBe('R000123');
    expect(shortRepairCode('RPR-000123 ')).toBe('R000123'); // trailing whitespace tolerated
  });

  it('leaves a value with no trailing digits COMPLETELY unchanged — no "R" is prepended to a string that has no ticket number in it', () => {
    expect(shortRepairCode('LEGACY')).toBe('LEGACY');
    expect(shortRepairCode('RPR-')).toBe('RPR-');
    expect(shortRepairCode('')).toBe('');
  });

  it('never mutates or shortens the underlying value — it returns a new display string, the ticket number itself is untouched', () => {
    const num = 'RPR-000123';
    expect(shortRepairCode(num)).not.toBe(num);
    expect(num).toBe('RPR-000123');
  });
});

describe('repair labels omit the device/model line; inventory labels still render it', () => {
  const size2x1: LabelMedia = { id: '2x1', w: 2, h: 1, label: '2 x 1' };
  const dymo: LabelMedia = { id: 'dymo-36x89', w: 89 / 25.4, h: 36 / 25.4, label: 'DYMO', dymo: true };
  const base: LabelOpts = { showBarcode: false, showStatus: false };

  const retail: LabelContent = { org: 'FlipThatTech', code: 'R000123', sub: 'Retail repair', serial: '356789101234567' };
  const wholesale: LabelContent = { org: 'FlipThatTech', code: 'WB-45', sub: 'Wholesale repair', serial: '356789101234567', issue: 'Cracked screen, no touch response' };
  const inventory: LabelContent = { org: 'FlipThatTech', code: '0000029', device: 'iPhone 14 Pro Max', sub: '256GB · Silver', serial: '356789101234567' };

  for (const m of [size2x1, dymo]) {
    it(`the retail repair label prints no brand/model text at all (${m.label})`, () => {
      const html = labelPrintDoc('t', m, retail, img, { ...base, variant: 'repairRetail' });
      expect(html).not.toContain('iPhone');
      expect(html).not.toContain('Apple');
      // And it isn't merely an EMPTY device <div> left behind taking up a line:
      // the code line is immediately followed by the sub line.
      expect(html).toContain('R000123');
      expect(html).toContain('Retail repair');
    });

    it(`the wholesale repair label prints no brand/model text at all (${m.label})`, () => {
      const html = labelPrintDoc('t', m, wholesale, img, { ...base, variant: 'repairWholesale' });
      expect(html).not.toContain('iPhone');
    });

    it(`REGRESSION: an inventory label on the same media still renders its device/model line normally (${m.label})`, () => {
      const html = labelPrintDoc('t', m, inventory, img, base);
      expect(html).toContain('iPhone 14 Pro Max');
      const deviceDiv = html.match(/<div style="[^"]*">iPhone 14 Pro Max<\/div>/);
      expect(deviceDiv).toBeTruthy();
      expect(deviceDiv![0]).toContain('font-weight:700');
    });
  }

  it('REGRESSION: an inventory label render is byte-for-byte identical with the variant defaulted vs. explicitly set to "inventory"', () => {
    // i.e. making `device` optional and adding the variant knob changed no
    // existing caller's output, not merely "looks the same".
    expect(labelPrintDoc('t', size2x1, inventory, { qr: 'data:image/png;base64,x', barcode: 'data:image/png;base64,b' }, { showBarcode: true, showStatus: true }))
      .toBe(labelPrintDoc('t', size2x1, inventory, { qr: 'data:image/png;base64,x', barcode: 'data:image/png;base64,b' }, { showBarcode: true, showStatus: true, variant: 'inventory' }));
  });

  it('REGRESSION: the inventory label\'s font sizes and QR size are unchanged by the variant mechanism', () => {
    expect(nonDymoFontSizesMm(size2x1)).toEqual(nonDymoFontSizesMm(size2x1, 'inventory'));
    expect(nonDymoFontSizesMm(size2x1).fCode).toBe(5.2); // the pre-existing physically-tested constant
    expect(nonDymoQrSizeMm(size2x1)).toBe(nonDymoQrSizeMm(size2x1, 'inventory'));
    expect(nonDymoQrSizeMm(size2x1)).toBeCloseTo(11.94, 1);
  });

  it('the device line still counts toward the push-down headroom when present, and stops counting when omitted', () => {
    const withDevice = maxSafePushDownMm(size2x1, inventory, { showBarcode: false, hasBarcodeImage: false });
    const withoutDevice = maxSafePushDownMm(size2x1, { ...inventory, device: undefined }, { showBarcode: false, hasBarcodeImage: false });
    expect(withoutDevice).toBeGreaterThan(withDevice);
  });
});

describe('the repair labels\' QR is measurably smaller than the inventory label\'s, at the same media', () => {
  const size2x1: LabelMedia = { id: '2x1', w: 2, h: 1, label: '2 x 1' };
  const size4x6: LabelMedia = { id: '4x6', w: 4, h: 6, label: '4 x 6' };

  it('is ~65% of the inventory size on every built-in template — a real reduction, not rounding noise', () => {
    for (const m of [size2x1, size4x6]) {
      const inv = nonDymoQrSizeMm(m);
      for (const v of ['repairRetail', 'repairWholesale'] as const) {
        const rep = nonDymoQrSizeMm(m, v);
        expect(rep).toBeLessThan(inv);
        expect(rep / inv).toBeCloseTo(0.65, 2);
      }
    }
  });

  it('the smaller QR reaches the real print HTML at its real mm dimensions, and the text column reclaims the freed width', () => {
    const c: LabelContent = { org: 'FlipThatTech', code: 'R000123', serial: '356789101234567' };
    const html = labelPrintDoc('t', size2x1, c, { qr: 'data:image/png;base64,x' }, { showBarcode: false, showStatus: false, variant: 'repairRetail' });
    const imgTag = html.match(/<img src="data:image\/png;base64,x"[^>]*>/)![0];
    expect(imgTag).toContain(`width:${mm(nonDymoQrSizeMm(size2x1, 'repairRetail'))}`);
    expect(imgTag).not.toContain(`width:${mm(nonDymoQrSizeMm(size2x1))}`);
    // The text column is `flex:1` beside a `flex-shrink:0` QR, so the width the
    // QR gave up is measurably back in the column — no dead gap.
    const repairColW = textColumnWidthMm(size2x1, { showQr: true, variant: 'repairRetail' });
    const inventoryColW = textColumnWidthMm(size2x1, { showQr: true });
    expect(repairColW).toBeGreaterThan(inventoryColW + 3); // several mm of real width, not a sliver
  });
});

describe('retail repair label sizing — what remains reads at a sensible size and still fits', () => {
  const size2x1: LabelMedia = { id: '2x1', w: 2, h: 1, label: '2 x 1' };
  const dymo: LabelMedia = { id: 'dymo-36x89', w: 89 / 25.4, h: 36 / 25.4, label: 'DYMO', dymo: true };
  const retail: LabelContent = { org: 'FlipThatTech', code: 'R000123', sub: 'Retail repair', serial: '356789101234567' };

  it('is scaled UP relative to the inventory label — the fewer, shorter lines are not left rattling around at the old size', () => {
    const inv = nonDymoFontSizesMm(size2x1);
    const rep = nonDymoFontSizesMm(size2x1, 'repairRetail');
    expect(rep.fCode).toBeGreaterThan(inv.fCode);
    expect(rep.fSerial).toBeGreaterThan(inv.fSerial);
  });

  it('the "R000123" code line fits the (now wider) text column at the larger size, with real headroom to spare', () => {
    const colW = textColumnWidthMm(size2x1, { showQr: true, variant: 'repairRetail' });
    const width = estimateTextWidthMm('R000123', nonDymoFontSizesMm(size2x1, 'repairRetail').fCode);
    expect(width).toBeLessThan(colW);
    expect(width).toBeLessThan(colW * 0.85);
  });

  it('the whole retail label still fits vertically at the bigger type — 4 lines at 1.15x take LESS height than the inventory label\'s 5 lines at 1.0x', () => {
    const lineH = (f: { fOrg: number; fCode: number; fDevice: number; fSub: number; fSerial: number }, withDevice: boolean) =>
      f.fOrg + f.fCode + (withDevice ? f.fDevice * 1.05 : 0) + f.fSub + f.fSerial * 1.05;
    const repairH = lineH(nonDymoFontSizesMm(size2x1, 'repairRetail'), false);
    const inventoryH = lineH(nonDymoFontSizesMm(size2x1), true);
    expect(repairH).toBeLessThan(inventoryH);
    // Which means it has at least as much push-down headroom as the
    // inventory label's worst case — i.e. it cannot be the content that
    // overflows the 1"-tall stock.
    expect(maxSafePushDownMm(size2x1, retail, { showBarcode: false, hasBarcodeImage: false }, MAX_PUSH_DOWN_MM))
      .toBeGreaterThanOrEqual(0);
  });

  it('the DYMO template scales by the same factor (the two branches do not drift)', () => {
    const at = (v?: LabelOpts['variant']) => {
      const html = labelPrintDoc('t', dymo, retail, img, { showBarcode: false, showStatus: false, variant: v });
      return Number(html.match(/font-family:'Courier New',monospace;font-weight:800;font-size:([\d.]+)mm/)![1]);
    };
    expect(at('repairRetail')).toBeCloseTo(7.2 * 1.15, 2);
    expect(at()).toBe(7.2); // inventory DYMO code size, untouched
  });
});

describe('wholesale repair label — no line number, smaller text, a readable issue line', () => {
  const size2x1: LabelMedia = { id: '2x1', w: 2, h: 1, label: '2 x 1' };
  const dymo: LabelMedia = { id: 'dymo-36x89', w: 89 / 25.4, h: 36 / 25.4, label: 'DYMO', dymo: true };
  const issue = 'Cracked screen, no touch on the top third, battery drains overnight';
  const wholesale: LabelContent = { org: 'FlipThatTech', code: 'WB-45', sub: 'Wholesale repair', serial: '356789101234567', issue };
  const opts: LabelOpts = { showBarcode: false, showStatus: false, variant: 'repairWholesale' };

  it('renders the batch number but no "· #{line}" line number (the content object simply never carries one)', () => {
    const html = labelPrintDoc('t', size2x1, wholesale, img, opts);
    expect(html).toContain('WB-45');
    expect(html).not.toContain('#1');
    expect(html).not.toContain(' · #');
  });

  it('its text is smaller than the RETAIL repair label\'s, on both branches', () => {
    const w = nonDymoFontSizesMm(size2x1, 'repairWholesale');
    const rtl = nonDymoFontSizesMm(size2x1, 'repairRetail');
    for (const k of ['fOrg', 'fCode', 'fSub', 'fSerial'] as const) expect(w[k]).toBeLessThan(rtl[k]);
    // ...and smaller than the inventory baseline too — this is an absolute
    // reduction the owner asked for, not merely "less than the enlarged one".
    const inv = nonDymoFontSizesMm(size2x1);
    for (const k of ['fOrg', 'fCode', 'fSub', 'fSerial'] as const) expect(w[k]).toBeLessThan(inv[k]);
    const dymoSize = (v: LabelOpts['variant']) =>
      Number(labelPrintDoc('t', dymo, wholesale, img, { ...opts, variant: v })
        .match(/font-family:'Courier New',monospace;font-weight:800;font-size:([\d.]+)mm/)![1]);
    expect(dymoSize('repairWholesale')).toBeLessThan(dymoSize('repairRetail'));
  });

  it('prints the issue text in full, and wraps it rather than truncating or ellipsis-clipping it', () => {
    for (const m of [size2x1, dymo]) {
      const html = labelPrintDoc('t', m, wholesale, img, opts);
      expect(html).toContain(issue); // the WHOLE string, never a sliced prefix
      const issueDiv = html.match(new RegExp(`<div style="[^"]*">${issue}</div>`))![0];
      expect(issueDiv).toContain('overflow-wrap:anywhere');
      expect(issueDiv).not.toContain('white-space:nowrap');
      expect(issueDiv).not.toContain('text-overflow:ellipsis');
      // A measured multi-line cap, the same mechanism the code/serial lines use.
      expect(issueDiv).toMatch(/max-height:/);
    }
  });

  it('the issue is NEVER added to a label that did not ask for one (inventory labels have no issue field set)', () => {
    const html = labelPrintDoc('t', size2x1, { org: 'FlipThatTech', code: '0000029', device: 'iPhone 14' }, img, { showBarcode: false, showStatus: false });
    // No issue row is emitted at all — `line-height:1.15` is the issue row's
    // own signature (the code/serial lines use 1.05, the sub line 1).
    expect(html).not.toContain('line-height:1.15');
    expect(html).not.toContain('Cracked');
  });

  it('MEASURED FIT: a realistic issue wraps within its cap on both templates, at the wholesale text size', () => {
    // Real geometry, not string presence: the issue row runs the FULL label
    // width (it sits beneath the text/QR row, so the QR never eats into it),
    // and estimateTextWidthMm is the same analytical width model the rest of
    // this file's fit proofs use.
    for (const m of [size2x1, dymo]) {
      const rowW = issueRowWidthMm(m);
      const { fIssue } = nonDymoFontSizesMm(m, 'repairWholesale');
      const linesNeeded = Math.ceil(estimateTextWidthMm(issue, fIssue) / rowW);
      expect(linesNeeded).toBeGreaterThan(1);              // it genuinely needs wrapping — the cap is doing real work
      expect(linesNeeded).toBeLessThanOrEqual(ISSUE_MAX_LINES);
    }
  });

  it('MEASURED FIT: the reserved issue row + the remaining text lines still fit the 2×1" stock — push-down stays non-negative and content never has to shrink', () => {
    const head = maxSafePushDownMm(size2x1, wholesale, { showBarcode: false, hasBarcodeImage: false, variant: 'repairWholesale' });
    expect(head).toBeGreaterThanOrEqual(0);
    // The issue row really is accounted for: the same content WITHOUT an issue
    // has strictly more headroom, i.e. the row's height was subtracted, not
    // silently ignored (which is how content ends up printing off the edge).
    const noIssue = maxSafePushDownMm(size2x1, { ...wholesale, issue: undefined }, { showBarcode: false, hasBarcodeImage: false, variant: 'repairWholesale' });
    expect(noIssue).toBeGreaterThan(head);
  });
});

/* ======================================================================== *
 * A LAPTOP'S DEVICE LABEL
 *
 * The second half of "printed labels still think every device is a phone".
 * The shelf tag (services/shelfTag.test.ts) carries all four laptop specs;
 * this label is the tighter format, and what it DROPS is as much the point as
 * what it prints. Both read the split from the one shared definition
 * (domain/deviceSpecs.ts's laptopPrintSpecs) so they cannot disagree.
 * ======================================================================== */

const LAPTOP = {
  deviceType: 'Laptop', cpu: 'i7-12700H', ram: '32GB', storage: '1TB', storageType: 'SSD',
  screenSize: '15.6"', gpu: 'RTX 3050 Ti',
  // A real record keeps whatever was typed into it — nothing clears phone
  // fields off a retyped device (domain/deviceSpecs.ts's strandedFields).
  color: 'Silver', batteryHealth: '89%',
};

describe('deviceSubLine — a laptop gets laptop content, a phone gets phone content', () => {
  it('a laptop reads CPU · storage/RAM', () => {
    expect(deviceSubLine(LAPTOP)).toBe('i7-12700H · 1TB/32GB');
  });

  it('and never the phone fields, even when the record still carries them', () => {
    const sub = deviceSubLine(LAPTOP)!;
    expect(sub).not.toContain('Silver');
    expect(sub).not.toContain('Batt');
    expect(sub).not.toContain('89%');
  });

  it('a phone is untouched, and so is an untyped legacy record', () => {
    const phone = { storage: '256GB', color: 'Silver', batteryHealth: '89%' };
    expect(deviceSubLine({ ...phone, deviceType: 'Phone' })).toBe('256GB · Silver · Batt 89%');
    expect(deviceSubLine(phone)).toBe('256GB · Silver · Batt 89%');
  });

  it('an ACCESSORY never takes the laptop branch, whatever deviceType it carries', () => {
    expect(deviceSubLine({ kind: 'accessory', deviceType: 'Laptop', storage: '256GB', color: 'Silver' }))
      .toBe('256GB · Silver');
  });

  it('every other device type still reads the phone line — a KNOWN gap, not a forgotten one', () => {
    // Tablets, watches, consoles and Desktop PCs fall through deliberately;
    // each needs its own answer and none was asked for. Stated in the PR.
    for (const deviceType of ['Tablet', 'Watch', 'Desktop PC']) {
      expect(deviceSubLine({ deviceType, storage: '256GB', batteryHealth: '89%' })).toBe('256GB · Batt 89%');
    }
  });

  it('collapses cleanly when a laptop has nothing filled in', () => {
    expect(deviceSubLine({ deviceType: 'Laptop' })).toBeUndefined();
    expect(deviceSubLine({ deviceType: 'Laptop', cpu: '  ' })).toBeUndefined();
  });

  it('leaves no stray separator — and no half of a slash pair — around a missing spec', () => {
    expect(deviceSubLine({ deviceType: 'Laptop', ram: '16GB' })).toBe('RAM 16GB');
    expect(deviceSubLine({ deviceType: 'Laptop', cpu: 'i5-1135G7', storage: '512GB' })).toBe('i5-1135G7 · Storage 512GB');
    // storageType alone is no longer printed at all, so it says nothing.
    expect(deviceSubLine({ deviceType: 'Laptop', storageType: 'SSD' })).toBeUndefined();
  });

  it("the owner's laptops TODAY — storage and nothing else — read cleanly", () => {
    expect(deviceSubLine({ kind: 'device', deviceType: 'Laptop', storage: '256GB' })).toBe('Storage 256GB');
  });

  it('reads the SAME string the shelf tag prints on its spec line — one definition, two surfaces', () => {
    expect(deviceSubLine(LAPTOP)).toBe(laptopPrintSpecs(LAPTOP).main);
  });

  it('keeps the GPU and the screen size OFF this line — they are placed separately', () => {
    // Not dropped any more (PR #234 did drop them; the QR label turned out to
    // be the customer-facing one). They are their own LabelContent slots so
    // the label can give the screen size a corner and collapse the GPU line.
    const sub = deviceSubLine(LAPTOP)!;
    expect(sub).not.toContain('RTX');
    expect(sub).not.toContain('15.6');
    expect(deviceLabelSpecs(LAPTOP)).toEqual({ gpu: 'RTX 3050 Ti', screen: '15.6"' });
  });

  it('the laptop line FITS the real text column on the Dymo and the 4x6, with a long CPU name', () => {
    // Re-derived from the same geometry helpers labelBody renders with, so
    // this stays true if the QR size or padding is ever retuned. The numbers
    // were confirmed in headless Chromium against the real rendered label —
    // see the PR description for the measured table.
    const worst = deviceSubLine({ deviceType: 'Laptop', cpu: 'Ryzen 7 5800H', ram: '32GB', storage: '1TB', storageType: 'SSD' })!;
    expect(worst).toBe('Ryzen 7 5800H · 1TB/32GB');
    for (const m of [{ id: 'dymo-36x89', w: 3.5039370078740157, h: 1.4173228346456694, label: 'Dymo', dymo: true },
                     { id: '4x6', w: 4, h: 6, label: '4 x 6' }]) {
      const col = textColumnWidthMm(m, { showQr: true });
      const { fSub } = nonDymoFontSizesMm(m);
      // The Dymo layout sets its own sub size (3.0mm) rather than reading
      // nonDymoFontSizesMm; use the smaller of the two so this is the
      // conservative check on both templates.
      const font = m.dymo ? 3.0 : fSub;
      // The PROPORTIONAL estimator — the sub line is Inter/Arial, not the
      // monospace SKU/serial that estimateTextWidthMm is calibrated for.
      expect(estimateProportionalTextWidthMm(worst, font), `${m.id} sub line must fit its column`).toBeLessThan(col);
    }
  });

  it('the proportional estimator over-estimates the real rendered widths it is calibrated against', () => {
    // Reference points measured in headless Chromium at these exact sizes,
    // against the real font stack ('Inter', system-ui, Arial). Pinned so the
    // ratio cannot be "tuned" later into under-estimating, which would turn a
    // fit check into a false pass and put clipped text on paper.
    const measured: [string, number, number][] = [
      ['512GB · Unlocked · Battery 89%', 4.6, 71.68],
      ['i7-12700H · 32GB · 1TB SSD', 3.0, 39.88],
      ['Ryzen 7 5800H · 32GB · 1TB SSD', 3.0, 47.17],
      ['Ryzen 7 5800H · 32GB · 1TB SSD', 3.4, 53.47],
      ['256GB · Silver · Batt 89%', 3.0, 36.36],
    ];
    for (const [text, font, realMm] of measured) {
      const est = estimateProportionalTextWidthMm(text, font);
      expect(est, `${text} @${font}mm must not be under-estimated`).toBeGreaterThanOrEqual(realMm);
      // …and not so far over that it rejects content that prints fine.
      expect(est).toBeLessThan(realMm * 1.2);
    }
  });

  it('the laptop spec line reaches the actual rendered label document', () => {
    const html = labelPrintDoc('t', { id: '2x1', w: 2, h: 1, label: '2 x 1' },
      { org: 'FlipThatTech', code: '0000029', device: 'Dell XPS 15 9520', sub: deviceSubLine(LAPTOP) },
      {}, { showBarcode: false, showStatus: false });
    expect(html).toContain('i7-12700H · 1TB/32GB');
  });
});

/* ======================================================================== *
 * THE QR LABEL IS CUSTOMER-FACING
 *
 * The owner puts these on laptops in the showcase, so the person reading one
 * is deciding what to buy. PR #234 dropped the GPU and the screen size from
 * it for line budget, on the assumption that the shelf tag was the customer's
 * printout. That was the wrong call about how the label is actually used, and
 * this is the correction: the full spec set, with the QR shrunk to make room.
 *
 * Every measurement below is from headless Chromium against the real rendered
 * label at real millimetre sizes — the table is in the PR description.
 * ======================================================================== */

const DYMO: LabelMedia = { id: 'dymo-36x89', w: 3.5039370078740157, h: 1.4173228346456694, label: 'Dymo 36 x 89', dymo: true };
const lapItem = (p: Record<string, string | undefined> = {}) => ({
  kind: 'device', deviceType: 'Laptop', cpu: 'i7-12700H', ram: '16GB', storage: '256GB',
  screenSize: '15.6"', gpu: 'RTX 3050 Ti', ...p,
});
const lapLabel = (p: Record<string, string | undefined> = {}, media: LabelMedia = DYMO) => {
  const it = lapItem(p);
  return labelPrintDoc('t', media, {
    org: 'FlipThatTech', code: '0000031', device: 'Dell XPS 15 9520',
    sub: deviceSubLine(it), serial: 'FVFXC2ABJK03', status: 'In Stock', ...deviceLabelSpecs(it),
  }, { qr: 'QRDATA' }, { showBarcode: false, showStatus: true });
};

describe('a laptop QR label carries the whole spec set', () => {
  it('prints the name, CPU · storage/RAM, the GPU and the screen size', () => {
    const html = lapLabel();
    expect(html).toContain('Dell XPS 15 9520');
    expect(html).toContain('i7-12700H · 256GB/16GB');
    expect(html).toContain('RTX 3050 Ti');
    expect(html).toContain('15.6&quot;'.replace('&quot;', '"'));
  });

  it('shrinks the QR to make the room — the owner asked for this explicitly', () => {
    expect(DYMO_LAPTOP_QR_MM).toBe(22);
    // The laptop label asks for 22mm; a phone keeps the full-height 33.4mm.
    expect(lapLabel()).toContain('width:22mm;height:22mm');
    const phone = labelPrintDoc('t', DYMO, {
      org: 'FlipThatTech', code: '0000029', device: 'iPhone 14 Pro Max',
      sub: deviceSubLine({ kind: 'device', deviceType: 'Phone', storage: '256GB' }),
      serial: '490154203237518', status: 'In Stock',
    }, { qr: 'QRDATA' }, { showBarcode: false, showStatus: true });
    expect(phone).not.toContain('width:22mm;height:22mm');
    expect(phone).toContain('width:33.4mm');
  });

  it('puts the screen size UNDER the QR, not on a text line', () => {
    const html = lapLabel();
    const qrAt = html.indexOf('QRDATA');
    const screenAt = html.indexOf('15.6"');
    expect(screenAt).toBeGreaterThan(qrAt);          // after the QR, in its column
    // …and not appended to the spec line.
    expect(html).not.toContain('256GB/16GB · 15.6"');
  });

  it('a laptop with no GPU prints no empty slot, no dash, no stray separator', () => {
    const html = lapLabel({ gpu: '' });
    expect(html).toContain('i7-12700H · 256GB/16GB');
    expect(html).toContain('15.6"');                  // the screen still prints
    expect(html).not.toMatch(/>\s*·\s*</);
    expect(html).not.toMatch(/>\s*[-–—]\s*</);
    expect(deviceLabelSpecs(lapItem({ gpu: '' }))).toEqual({ screen: '15.6"' });
  });

  it('a laptop with no screen size keeps the GPU and omits the badge', () => {
    expect(deviceLabelSpecs(lapItem({ screenSize: '' }))).toEqual({ gpu: 'RTX 3050 Ti' });
  });

  it("the owner's laptops TODAY print a clean label — no gaps where the new fields will go", () => {
    // Storage only: no GPU line, no screen badge, and the label keeps its
    // normal proportions because there is nothing extra to make room for.
    const it = { kind: 'device', deviceType: 'Laptop', storage: '256GB' };
    expect(deviceLabelSpecs(it)).toEqual({});
    const html = labelPrintDoc('t', DYMO, {
      org: 'FlipThatTech', code: '0000031', device: 'MacBook Pro 16"',
      sub: deviceSubLine(it), serial: 'FVFXC2ABJK03', status: 'In Stock', ...deviceLabelSpecs(it),
    }, { qr: 'QRDATA' }, { showBarcode: false, showStatus: true });
    expect(html).toContain('Storage 256GB');
    expect(html).toContain('width:33.4mm');           // full-size QR, as before
    expect(html).not.toMatch(/>\s*·\s*</);
  });

  it('a laptop with NO specs at all prints name and code, nothing orphaned', () => {
    const it = { kind: 'device', deviceType: 'Laptop' };
    expect(deviceSubLine(it)).toBeUndefined();
    expect(deviceLabelSpecs(it)).toEqual({});
    const html = labelPrintDoc('t', DYMO, {
      org: 'FlipThatTech', code: '0000031', device: 'HP Pavilion', sub: deviceSubLine(it),
      serial: 'FVFXC2ABJK03', ...deviceLabelSpecs(it),
    }, { qr: 'QRDATA' }, { showBarcode: false, showStatus: false });
    expect(html).toContain('HP Pavilion');
    expect(html).not.toMatch(/>\s*·\s*</);
    expect(html).not.toMatch(/>\s*\/\s*</);
  });

  it('BOTH printouts derive their spec line from the same function', () => {
    // The whole reason laptopPrintSpecs was extracted. Not "they agree today"
    // — they are literally the same call.
    const it = lapItem();
    const { main, gpu, screen } = laptopPrintSpecs(it);
    expect(deviceSubLine(it)).toBe(main);
    expect(deviceLabelSpecs(it)).toEqual({ gpu, screen });
  });
});

describe('the inch templates get one combined line, since they have no corner', () => {
  it('joins the GPU and the screen, and collapses to whichever exists', () => {
    expect(extraSpecLine({ gpu: 'RTX 3050 Ti', screen: '15.6"' })).toBe('RTX 3050 Ti · 15.6"');
    expect(extraSpecLine({ screen: '15.6"' })).toBe('15.6"');
    expect(extraSpecLine({ gpu: 'RTX 3050 Ti' })).toBe('RTX 3050 Ti');
    expect(extraSpecLine({})).toBe('');
    expect(extraSpecLine({ gpu: '  ', screen: '' })).toBe('');
  });

  it('reaches the rendered label, and the push-down budget reserves room for it', () => {
    const m: LabelMedia = { id: '4x6', w: 4, h: 6, label: '4 x 6' };
    expect(lapLabel({}, m)).toContain('RTX 3050 Ti · 15.6"');
    // maxSafePushDownMm must account for the extra line, or push-down could
    // shove it off the bottom.
    // A high ceiling, so the comparison measures the CONTENT budget rather
    // than MAX_PUSH_DOWN_MM, which a 4x6 has enough headroom to hit either
    // way. The extra line must cost exactly its own rendered height.
    const base = { code: '0000031', device: 'Dell XPS 15 9520', sub: 'i7-12700H · 256GB/16GB', serial: 'FVFXC2ABJK03' };
    const opts = { showBarcode: false, hasBarcodeImage: false };
    const without = maxSafePushDownMm(m, base, opts, 999);
    const with_ = maxSafePushDownMm(m, { ...base, gpu: 'RTX 3050 Ti', screen: '15.6"' }, opts, 999);
    const { fSub } = nonDymoFontSizesMm(m);
    expect(+(without - with_).toFixed(2)).toBe(+(fSub + 1.1).toFixed(2));   // line + its gap
  });
});

describe('THE QR STILL SCANS AT 22mm — decoded, not assumed', () => {
  it('round-trips a real SKU through a real decoder at the real printed size', async () => {
    const QRCode = (await import('qrcode')).default;
    const { MultiFormatReader, BarcodeFormat, DecodeHintType, RGBLuminanceSource,
      BinaryBitmap, HybridBinarizer } = await import('@zxing/library');

    const payload = 'FTT-0000031';          // what LabelModal encodes: the full SKU
    const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
    const modules = qr.modules.size;
    const MARGIN = 1;                        // the margin LabelModal passes
    const across = modules + MARGIN * 2;

    // A VERSION 1 symbol, so 22mm is a shade under 1mm per module — roughly
    // double the ~0.5mm where phone cameras start to struggle.
    expect(qr.version).toBe(1);
    const mmPerModule = DYMO_LAPTOP_QR_MM / across;
    expect(mmPerModule).toBeGreaterThan(0.6);

    // Rasterise at exactly the pixel size 22mm occupies on a 203dpi thermal
    // printer — the lowest resolution this shop's label printers run at.
    const DPI = 203;
    const px = Math.round((DYMO_LAPTOP_QR_MM / 25.4) * DPI);
    const scale = px / across;
    const lum = new Uint8ClampedArray(px * px).fill(255);
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const mx = Math.floor(x / scale) - MARGIN;
        const my = Math.floor(y / scale) - MARGIN;
        const dark = mx >= 0 && my >= 0 && mx < modules && my < modules && qr.modules.get(my, mx);
        if (dark) lum[y * px + x] = 0;
      }
    }

    const reader = new MultiFormatReader();
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
    reader.setHints(hints);
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(lum, px, px)));
    expect(reader.decode(bitmap).getText()).toBe(payload);
  });
});

describe('THE REGRESSION THAT MATTERS: the phone label is byte-identical', () => {
  // The laptop work is additive. The only way to prove a shared renderer was
  // not disturbed is to compare the whole document, not spot-check it.
  const phoneDoc = (m: LabelMedia) => labelPrintDoc('t', m, {
    org: 'FlipThatTech', code: '0000029', device: 'iPhone 14 Pro Max',
    sub: deviceSubLine({ kind: 'device', deviceType: 'Phone', storage: '256GB', color: 'Silver', batteryHealth: '89%' }),
    serial: '490154203237518', status: 'In Stock',
  }, { qr: 'QRDATA' }, { showBarcode: false, showStatus: true });

  it('a phone carries no laptop slots at all, so no laptop branch can reach it', () => {
    expect(deviceLabelSpecs({ kind: 'device', deviceType: 'Phone', gpu: 'RTX 3050 Ti', screenSize: '6.1"' })).toEqual({});
    expect(deviceLabelSpecs({ kind: 'accessory', deviceType: 'Laptop', gpu: 'RTX 3050 Ti' })).toEqual({});
    expect(deviceLabelSpecs({ kind: 'device' })).toEqual({});
  });

  it('and the rendered document contains not one byte of the laptop layout', () => {
    for (const m of [DYMO, { id: '4x6', w: 4, h: 6, label: '4 x 6' } as LabelMedia]) {
      const html = phoneDoc(m);
      // The laptop proportions: a 22mm QR, the 5.2mm SKU, the 0.7mm gap.
      expect(html).not.toContain('width:22mm;height:22mm');
      expect(html).not.toContain('font-size:5.2mm');
      expect(html).not.toContain('gap:0.7mm');
      // And the phone's own proportions are still exactly what they were.
      if (m.dymo) {
        expect(html).toContain('font-size:7.2mm');   // the full-size SKU
        expect(html).toContain('gap:1.1mm');
        expect(html).toContain('width:33.4mm');
      }
    }
  });

  it('an empty gpu/screen adds no markup and no whitespace', () => {
    // Load-bearing: the laptop lines are folded onto their neighbours'
    // source lines precisely so an absent one emits nothing — not even the
    // newline and indent that would otherwise break byte-identity.
    const withSlots = labelPrintDoc('t', DYMO, {
      org: 'FlipThatTech', code: '0000029', device: 'iPhone 14 Pro Max',
      sub: 'x', serial: 'y', status: 'In Stock', gpu: '', screen: '',
    }, { qr: 'QRDATA' }, { showBarcode: false, showStatus: true });
    const without = labelPrintDoc('t', DYMO, {
      org: 'FlipThatTech', code: '0000029', device: 'iPhone 14 Pro Max',
      sub: 'x', serial: 'y', status: 'In Stock',
    }, { qr: 'QRDATA' }, { showBarcode: false, showStatus: true });
    expect(withSlots).toBe(without);
  });

  /**
   * THE WHOLE DOCUMENT, PINNED BY HASH.
   *
   * The structural checks above say "no laptop proportions leaked in". This
   * says "not one byte changed", which is a different and stronger claim —
   * and it is the one that catches the failure mode this change actually
   * risked: a conditional template line emitting its newline and indentation
   * even when empty, which the earlier draft did and no structural assertion
   * noticed.
   *
   * The digests were taken from `main` BEFORE this change, by rendering these
   * exact four documents and hashing them. If one of these fails, a phone or
   * accessory label moved — which this change is not allowed to do. Do not
   * refresh a digest to make it pass; find what moved.
   */
  const sha = async (t: string) => {
    const { createHash } = await import('crypto');
    return createHash('sha256').update(t).digest('hex').slice(0, 32);
  };
  const accDoc = (m: LabelMedia) => labelPrintDoc('t', m,
    { org: 'FlipThatTech', code: 'UPC123', device: 'USB-C Cable' },
    { qr: 'QRDATA' }, { showBarcode: false, showStatus: false });

  it.each([
    ['phone · dymo-36x89', () => phoneDoc(DYMO), 'df2ba2fb938c0422f6aa3acc59c54d0e'],
    ['phone · 4x6', () => phoneDoc({ id: '4x6', w: 4, h: 6, label: '4 x 6' }), '8e51ca93e8fbb231d18edf5590201d29'],
    ['accessory · dymo-36x89', () => accDoc(DYMO), '1f997be8e9621ab4875ebec3185f5598'],
    ['accessory · 4x6', () => accDoc({ id: '4x6', w: 4, h: 6, label: '4 x 6' }), '62e45bc52ece4debef05e1bf235d81e9'],
  ])('%s renders exactly the bytes main rendered', async (_name, render, digest) => {
    expect(await sha(render())).toBe(digest);
  });
});

/* ======================================================================== *
 * A LABEL MUST NEVER OVERFLOW ITS MEDIA
 *
 * A laptop printed at 2 × 1" on a Zebra came out across TWO labels — text on
 * the first, the QR and the screen size alone on the second. On a roll
 * printer that burns a label every time and nobody notices until the roll is
 * gone.
 *
 * The content is now sized by the LAYOUT (labelTextHeightMm / fitsExtraSpec),
 * not left to `overflow:hidden` — which holds in Chromium but which this file
 * already documents real label-printer drivers failing to honour.
 *
 * Verified against all five built-in media; the measured table is in the PR.
 * ======================================================================== */

const ALL_MEDIA: LabelMedia[] = [
  { id: 'dymo-36x89', w: 3.5039370078740157, h: 1.4173228346456694, label: 'DYMO 36 × 89 mm', dymo: true },
  { id: '2x1', w: 2, h: 1, label: '2 × 1"' },
  { id: '2x2', w: 2, h: 2, label: '2 × 2"' },
  { id: '2x3', w: 2, h: 3, label: '2 × 3"' },
  { id: '4x6', w: 4, h: 6, label: '4 × 6"' },
];

// The exact item from the report, and the longest realistic one.
const REPORTED = { kind: 'device', deviceType: 'Laptop', cpu: 'Ryzen 3 3200U', ram: '8GB', storage: '256GB', screenSize: '15.6"' };
const LONGEST = { kind: 'device', deviceType: 'Laptop', cpu: 'Ryzen 7 5800H', ram: '32GB', storage: '1TB', screenSize: '17.3"', gpu: 'GeForce RTX 4060 Laptop' };
const content = (it: Record<string, string>, device: string) => ({
  org: 'FlipThatTech', code: '000718', device, sub: deviceSubLine(it),
  serial: '5CD9245XYZ', status: 'In Stock', ...deviceLabelSpecs(it),
});
const FIT_OPTS = { showQr: true, showStatus: true, showBarcode: false, hasBarcodeImage: false };

describe('every media fits a laptop on ONE label', () => {
  // Every media EXCEPT 2 × 1" fits outright, with no allowance of any kind.
  const FITTING_MEDIA = ALL_MEDIA.filter(m => !m.dymo && m.id !== '2x1');

  it.each(FITTING_MEDIA.map(m => [m.label, m] as const))(
    '%s — the reported item fits, with room to spare', (_l, m) => {
      const c = content(REPORTED, 'HP Pavillion 255 G7');
      const rendered = fitsExtraSpec(m, c, FIT_OPTS) ? c : { ...c, gpu: '', screen: '' };
      expect(labelTextHeightMm(m, rendered, FIT_OPTS)).toBeLessThanOrEqual(labelTextRoomMm(m, c, FIT_OPTS));
    });

  it.each(FITTING_MEDIA.map(m => [m.label, m] as const))(
    '%s — the LONGEST realistic laptop fits too', (_l, m) => {
      const c = content(LONGEST, 'Lenovo Legion Pro 7i Gen 8');
      const rendered = fitsExtraSpec(m, c, FIT_OPTS) ? c : { ...c, gpu: '', screen: '' };
      expect(labelTextHeightMm(m, rendered, FIT_OPTS)).toBeLessThanOrEqual(labelTextRoomMm(m, c, FIT_OPTS));
    });

  /**
   * THE 2 × 1" CAVEAT, asserted as what is actually true rather than hidden
   * behind a tolerance.
   *
   * That stock cannot hold the five shared lines plus the status pill even
   * for a PHONE: 3.01mm over, before any laptop content exists. The laptop
   * extras are dropped there, which returns a laptop to exactly the footprint
   * a phone has always had on that media. Going further means re-cutting
   * every phone label in the shop, which is the owner's call and is written
   * up in the PR — so the test states the parity, not a fiction about fitting.
   */
  it('a laptop at 2 × 1" is no taller than a PHONE at 2 × 1" — the extras are gone', () => {
    const m = ALL_MEDIA.find(x => x.id === '2x1')!;
    const phone = content({ kind: 'device', deviceType: 'Phone', storage: '256GB', color: 'Silver', batteryHealth: '89%' }, 'iPhone 14 Pro Max');
    const lap = content(LONGEST, 'Lenovo Legion Pro 7i Gen 8');
    expect(fitsExtraSpec(m, lap, FIT_OPTS)).toBe(false);
    const dropped = { ...lap, gpu: '', screen: '' };
    expect(labelTextHeightMm(m, dropped, FIT_OPTS)).toBeLessThanOrEqual(labelTextHeightMm(m, phone, FIT_OPTS));
  });

  it('the layout — not the browser — is what removes it', () => {
    // The rendered document must simply not contain the dropped content.
    const m = ALL_MEDIA.find(x => x.id === '2x1')!;
    const html = labelPrintDoc('t', m, content(REPORTED, 'HP Pavillion 255 G7'), { qr: 'QRDATA' },
      { showBarcode: false, showStatus: true });
    expect(html).not.toContain('15.6"');
    // …and everything that must stay, stays.
    expect(html).toContain('HP Pavillion 255 G7');
    expect(html).toContain('Ryzen 3 3200U · 256GB/8GB');
    expect(html).toContain('000718');
    expect(html).toContain('QRDATA');     // the QR is never dropped
  });

  it('bigger media KEEP the screen size — this is a fit rule, not a ban', () => {
    for (const id of ['2x2', '2x3', '4x6']) {
      const m = ALL_MEDIA.find(x => x.id === id)!;
      const html = labelPrintDoc('t', m, content(REPORTED, 'HP Pavillion 255 G7'), { qr: 'QRDATA' },
        { showBarcode: false, showStatus: true });
      expect(html, `${id} should keep the screen size`).toContain('15.6"');
    }
  });

  it('the DYMO keeps the full set, in its own corner layout', () => {
    const m = ALL_MEDIA.find(x => x.dymo)!;
    const html = labelPrintDoc('t', m, content(LONGEST, 'Lenovo Legion Pro 7i Gen 8'), { qr: 'QRDATA' },
      { showBarcode: false, showStatus: true });
    expect(html).toContain('17.3"');
    expect(html).toContain('GeForce RTX 4060 Laptop');
  });

  it('a laptop with no GPU and no screen size prints no empty line at all', () => {
    for (const m of ALL_MEDIA) {
      const it = { kind: 'device', deviceType: 'Laptop', cpu: 'i5-1135G7', ram: '8GB', storage: '256GB' };
      const c = content(it, 'HP Pavilion');
      expect(extraSpecLine(c)).toBe('');
      expect(fitsExtraSpec(m, c, FIT_OPTS)).toBe(false);
      const html = labelPrintDoc('t', m, c, { qr: 'QRDATA' }, { showBarcode: false, showStatus: true });
      expect(html).not.toMatch(/>\s*·\s*</);
      expect(html).toContain('i5-1135G7 · 256GB/8GB');
    }
  });
});

describe('the height model is accurate, and errs HIGH', () => {
  // Reference heights measured in headless Chromium against the real rendered
  // label. Pinned so the model cannot drift back into under-estimating, which
  // is what let the content overflow in the first place.
  it.each([
    ['2x1', '2x1', 24.59, { kind: 'device', deviceType: 'Phone', storage: '256GB', color: 'Silver', batteryHealth: '89%' }, 'iPhone 14 Pro Max'],
    ['2x1 laptop', '2x1', 28.49, REPORTED, 'HP Pavillion 255 G7'],
    ['2x2 laptop (serial wraps)', '2x2', 32.27, REPORTED, 'HP Pavillion 255 G7'],
    ['4x6 laptop', '4x6', 33.99, REPORTED, 'HP Pavillion 255 G7'],
  ] as const)('%s', (_n, id, measured, it, device) => {
    const m = ALL_MEDIA.find(x => x.id === id)!;
    const modelled = labelTextHeightMm(m, content(it as Record<string, string>, device), FIT_OPTS);
    // Never under — an under-estimate says "fits" about content that does not.
    expect(modelled).toBeGreaterThanOrEqual(measured);
    // …and not so far over that it drops content needlessly.
    expect(modelled).toBeLessThan(measured + 1.5);
  });

  it('counts the status pill, which is taller than the org line it shares a row with', () => {
    const m = ALL_MEDIA.find(x => x.id === '2x1')!;
    const c = content(REPORTED, 'HP Pavillion 255 G7');
    const withPill = labelTextHeightMm(m, c, FIT_OPTS);
    const without = labelTextHeightMm(m, c, { ...FIT_OPTS, showStatus: false });
    expect(withPill).toBeGreaterThan(without);
  });

  it('counts a serial that WRAPS because the QR squeezed the column', () => {
    // 2 × 2" has the widest QR relative to its width, leaving a 20.9mm column
    // — narrower than a 10-character monospace serial, so that line is two.
    const m = ALL_MEDIA.find(x => x.id === '2x2')!;
    const c = content(REPORTED, 'HP Pavillion 255 G7');
    const long = labelTextHeightMm(m, { ...c, serial: '5CD9245XYZ' }, FIT_OPTS);
    const short = labelTextHeightMm(m, { ...c, serial: 'A1' }, FIT_OPTS);
    expect(long).toBeGreaterThan(short);
  });
});
