import { describe, it, expect } from 'vitest';
import { labelPrintDoc, LabelMedia, LabelContent, LabelImages, LabelOpts, MAX_PUSH_DOWN_MM } from './labelLayout';

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
// adopted — measured before/after pixel deltas for all three settings are
// recorded in this change's PR description, since Playwright/Chromium isn't
// a project dependency and can't run as part of `npm test`/CI. If a future
// change touches this layout again, re-verify with real rendered geometry
// the same way, not just by re-running these string checks.
const media2x1: LabelMedia = { id: '2x1', w: 2, h: 1, label: '2 x 1' };
const content: LabelContent = {
  org: 'FlipThatTech', code: 'SKU-1', device: 'iPhone 14',
  sub: '128GB · Black', serial: '123456789012345',
};
const img: LabelImages = {};

// Formatted the same way labelPrintDoc's mm unit emitter does (mkU('mm', 1)):
// a bare number rounded to 3 decimals + "mm".
const mm = (v: number) => `${+v.toFixed(3)}mm`;

describe('labelPrintDoc — push-down offset reaches the real print HTML', () => {
  it('defaults (no pushDownMm) use the base padding-top only, and never emit transform or margin-cancellation (the two previously-broken mechanisms)', () => {
    const opts: LabelOpts = { showBarcode: false, showStatus: false };
    const html = labelPrintDoc('t', media2x1, content, img, opts);
    expect(html).toContain(`padding-top:${mm(0.35)}`);
    // Locks in that push-down is never implemented via a CSS transform or a
    // margin-top/negative-margin-bottom pair again — both were confirmed by
    // physical printing to have zero effect on the real ZP 450 output
    // despite passing string-based checks like this one.
    expect(html).not.toMatch(/transform\s*:/);
    expect(html).not.toMatch(/margin-top:/);
    expect(html).not.toMatch(/margin-bottom:/);
  });

  it('a configured pushDownMm adds directly to the base padding-top', () => {
    const opts: LabelOpts = { showBarcode: false, showStatus: false, pushDownMm: MAX_PUSH_DOWN_MM };
    const html = labelPrintDoc('t', media2x1, content, img, opts);
    expect(html).toContain(`padding-top:${mm(0.35 + MAX_PUSH_DOWN_MM)}`);
  });

  it('clamps an out-of-range pushDownMm to the [0, MAX_PUSH_DOWN_MM] ceiling', () => {
    const html = labelPrintDoc('t', media2x1, content, img, { showBarcode: false, showStatus: false, pushDownMm: 99 });
    expect(html).toContain(`padding-top:${mm(0.35 + MAX_PUSH_DOWN_MM)}`);
  });

  it('clamps a negative pushDownMm to 0 (base padding-top only)', () => {
    const html = labelPrintDoc('t', media2x1, content, img, { showBarcode: false, showStatus: false, pushDownMm: -5 });
    expect(html).toContain(`padding-top:${mm(0.35)}`);
  });

  it('push-down applies in labelPrintDoc for a repair label\'s content too (org/code/device present)', () => {
    const opts: LabelOpts = { showBarcode: true, showStatus: true, pushDownMm: MAX_PUSH_DOWN_MM };
    const html = labelPrintDoc('Repair Label', media2x1, { ...content, status: 'In Repair' }, img, opts);
    expect(html).toContain(`padding-top:${mm(0.35 + MAX_PUSH_DOWN_MM)}`);
  });

  it('Dymo labels are unaffected by pushDownMm (own separately-tuned layout, no override)', () => {
    const dymoMedia: LabelMedia = { id: 'dymo-36x89', w: 89 / 25.4, h: 36 / 25.4, label: 'DYMO', dymo: true };
    const opts: LabelOpts = { showBarcode: false, showStatus: false, pushDownMm: MAX_PUSH_DOWN_MM };
    const html = labelPrintDoc('t', dymoMedia, content, img, opts);
    expect(html).not.toMatch(/padding-top:/);
    // The page-level 90° feed rotation (`transform: translate(...) rotate(90deg)`
    // on `.rot`) is a separate, legitimate mechanism — only a translateY
    // push-down transform should never appear.
    expect(html).not.toMatch(/transform:\s*translateY/);
  });
});

describe('labelPrintDoc — pushDownMm purely translates, never resizes or truncates content', () => {
  // Regression coverage for the actual bug (physical print comparison):
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

  it('emits byte-identical font-size values and text content at pushDownMm 0, half-max, max, and beyond-max (still clamped)', () => {
    const at = (pushDownMm: number) => labelPrintDoc('t', media2x1, worstCase, img, { showBarcode: false, showStatus: false, pushDownMm });
    const base = at(0);
    const half = at(MAX_PUSH_DOWN_MM / 2);
    const max = at(MAX_PUSH_DOWN_MM);
    // Values well beyond the ceiling (matching the task's "0, 1, 2, and max"
    // spread against the old 2.5mm range) — must clamp to the same result
    // as pushDownMm=MAX_PUSH_DOWN_MM exactly, never grow past it.
    const beyond1 = at(1);
    const beyond2 = at(2);

    const baseFonts = fontSizes(base);
    expect(baseFonts.length).toBeGreaterThan(0); // sanity: the regex actually matched something
    for (const doc of [half, max, beyond1, beyond2]) expect(fontSizes(doc)).toEqual(baseFonts);

    const baseText = textNodes(base);
    for (const doc of [half, max, beyond1, beyond2]) expect(textNodes(doc)).toEqual(baseText);
    expect(beyond1).toBe(max);
    expect(beyond2).toBe(max);
    // The full, untruncated SKU and serial are literally present in the
    // emitted HTML at every pushDown value — text-overflow:ellipsis is a
    // paint-time CSS behavior, never a DOM-level string edit, so this
    // stays true regardless of how a given renderer visually clips it.
    expect(baseText).toContain(worstCase.code);
    expect(baseText).toContain(worstCase.serial);

    // Only the padding-top offset itself differs between the three docs.
    expect(base).toContain(`padding-top:${mm(0.35)}`);
    expect(half).toContain(`padding-top:${mm(0.35 + MAX_PUSH_DOWN_MM / 2)}`);
    expect(max).toContain(`padding-top:${mm(0.35 + MAX_PUSH_DOWN_MM)}`);
  });
});

describe('labelPrintDoc — line spacing default + clamp', () => {
  it('defaults to the physically-confirmed known-good 1.1mm gap (no lineGapMm override)', () => {
    const opts: LabelOpts = { showBarcode: false, showStatus: false };
    const html = labelPrintDoc('t', media2x1, content, img, opts);
    expect(html).toContain(`gap:${mm(1.1)}`);
  });

  it('clamps an out-of-range lineGapMm to the [0, 1.5] ceiling', () => {
    const html = labelPrintDoc('t', media2x1, content, img, { showBarcode: false, showStatus: false, lineGapMm: 3 });
    expect(html).toContain(`gap:${mm(1.5)}`);
  });

  it('clamps a negative lineGapMm to 0', () => {
    const html = labelPrintDoc('t', media2x1, content, img, { showBarcode: false, showStatus: false, lineGapMm: -5 });
    expect(html).toContain(`gap:${mm(0)}`);
  });
});

describe('labelPrintDoc — content padding default + override', () => {
  it('defaults to 2.0mm content padding on non-Dymo templates', () => {
    const html = labelPrintDoc('t', media2x1, content, img, { showBarcode: false, showStatus: false });
    expect(html).toContain(`padding:${mm(2.0)}`);
  });

  it('a configured padMm overrides the outer content padding', () => {
    const html = labelPrintDoc('t', media2x1, content, img, { showBarcode: false, showStatus: false, padMm: 4.0 });
    expect(html).toContain(`padding:${mm(4.0)}`);
  });
});
