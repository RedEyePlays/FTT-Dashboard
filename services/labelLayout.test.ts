import { describe, it, expect } from 'vitest';
import { labelPrintDoc, LabelMedia, LabelContent, LabelImages, LabelOpts } from './labelLayout';

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
    expect(html).toContain(`padding-top:${mm(1.4)}`);
    // Locks in that push-down is never implemented via a CSS transform or a
    // margin-top/negative-margin-bottom pair again — both were confirmed by
    // physical printing to have zero effect on the real ZP 450 output
    // despite passing string-based checks like this one.
    expect(html).not.toMatch(/transform\s*:/);
    expect(html).not.toMatch(/margin-top:/);
    expect(html).not.toMatch(/margin-bottom:/);
  });

  it('a configured pushDownMm adds directly to the base padding-top', () => {
    const opts: LabelOpts = { showBarcode: false, showStatus: false, pushDownMm: 2.5 };
    const html = labelPrintDoc('t', media2x1, content, img, opts);
    expect(html).toContain(`padding-top:${mm(1.4 + 2.5)}`);
  });

  it('clamps an out-of-range pushDownMm to the [0, 2.5] ceiling', () => {
    const html = labelPrintDoc('t', media2x1, content, img, { showBarcode: false, showStatus: false, pushDownMm: 99 });
    expect(html).toContain(`padding-top:${mm(1.4 + 2.5)}`);
  });

  it('clamps a negative pushDownMm to 0 (base padding-top only)', () => {
    const html = labelPrintDoc('t', media2x1, content, img, { showBarcode: false, showStatus: false, pushDownMm: -5 });
    expect(html).toContain(`padding-top:${mm(1.4)}`);
  });

  it('push-down applies in labelPrintDoc for a repair label\'s content too (org/code/device present)', () => {
    const opts: LabelOpts = { showBarcode: true, showStatus: true, pushDownMm: 1.4 };
    const html = labelPrintDoc('Repair Label', media2x1, { ...content, status: 'In Repair' }, img, opts);
    expect(html).toContain(`padding-top:${mm(1.4 + 1.4)}`);
  });

  it('Dymo labels are unaffected by pushDownMm (own separately-tuned layout, no override)', () => {
    const dymoMedia: LabelMedia = { id: 'dymo-36x89', w: 89 / 25.4, h: 36 / 25.4, label: 'DYMO', dymo: true };
    const opts: LabelOpts = { showBarcode: false, showStatus: false, pushDownMm: 2.5 };
    const html = labelPrintDoc('t', dymoMedia, content, img, opts);
    expect(html).not.toMatch(/padding-top:/);
    // The page-level 90° feed rotation (`transform: translate(...) rotate(90deg)`
    // on `.rot`) is a separate, legitimate mechanism — only a translateY
    // push-down transform should never appear.
    expect(html).not.toMatch(/transform:\s*translateY/);
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
