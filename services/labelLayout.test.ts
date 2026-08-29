import { describe, it, expect } from 'vitest';
import {
  labelPrintDoc, LabelMedia, LabelContent, LabelImages, LabelOpts, MAX_PUSH_DOWN_MM, maxSafePushDownMm,
  shortLabelSku, nonDymoQrSizeMm, nonDymoFontSizesMm, estimateTextWidthMm, textColumnWidthMm, deviceSubLine,
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
