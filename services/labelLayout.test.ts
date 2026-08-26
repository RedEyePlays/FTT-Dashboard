import { describe, it, expect } from 'vitest';
import { labelPrintDoc, LabelMedia, LabelContent, LabelImages, LabelOpts } from './labelLayout';

// Regression coverage for the "Push content down" / "Line spacing" settings
// actually reaching the real browser PRINT path (labelPrintDoc — the exact
// function LabelModal/RepairLabelModal's Print button calls), not just the
// preview or PDF export. A prior implementation used `transform:
// translateY(...)` for push-down, which was confirmed (via PDF content-
// stream inspection) to correctly shift content in Chromium's own
// print/PDF pipeline, but produced ZERO visible effect on the actual
// physical ZP 450 printout — real label-printer drivers commonly flatten
// HTML through a box-model-only renderer that doesn't implement CSS
// transforms. It was replaced with a margin-top/margin-bottom trick that
// achieves the identical shift through the box model instead (verified
// pixel-for-pixel identical to translateY in a real browser layout).
const media2x1: LabelMedia = { id: '2x1', w: 2, h: 1, label: '2 x 1' };
const content: LabelContent = {
  org: 'FlipThatTech', code: 'SKU-1', device: 'iPhone 14',
  sub: '128GB · Black', serial: '123456789012345',
};
const img: LabelImages = {};

// The margin box in mm, formatted the same way labelPrintDoc's mm unit
// emitter does (mkU('mm', 1)): a bare number rounded to 3 decimals + "mm".
const mm = (v: number) => `${+v.toFixed(3)}mm`;

describe('labelPrintDoc — push-down offset reaches the real print HTML', () => {
  it('defaults (no pushDownMm) produce zero net margin shift, and never emit a CSS transform', () => {
    const opts: LabelOpts = { showBarcode: false, showStatus: false };
    const html = labelPrintDoc('t', media2x1, content, img, opts);
    expect(html).toContain(`margin-top:${mm(0)};margin-bottom:${mm(-0)};`);
    // Locks in that push-down is never implemented via `transform` again —
    // that's the exact mechanism physical print testing showed gets ignored
    // by the ZP 450's driver.
    expect(html).not.toMatch(/transform\s*:/);
  });

  it('a configured pushDownMm produces the matching margin-top / negative margin-bottom pair', () => {
    const opts: LabelOpts = { showBarcode: false, showStatus: false, pushDownMm: 2.5 };
    const html = labelPrintDoc('t', media2x1, content, img, opts);
    expect(html).toContain(`margin-top:${mm(2.5)};margin-bottom:${mm(-2.5)};`);
  });

  it('push-down applies in labelPrintDoc for a repair label\'s content too (org/code/device present)', () => {
    const opts: LabelOpts = { showBarcode: true, showStatus: true, pushDownMm: 1.4 };
    const html = labelPrintDoc('Repair Label', media2x1, { ...content, status: 'In Repair' }, img, opts);
    expect(html).toContain(`margin-top:${mm(1.4)};margin-bottom:${mm(-1.4)};`);
  });

  it('Dymo labels are unaffected by pushDownMm (own separately-tuned layout, no override)', () => {
    const dymoMedia: LabelMedia = { id: 'dymo-36x89', w: 89 / 25.4, h: 36 / 25.4, label: 'DYMO', dymo: true };
    const opts: LabelOpts = { showBarcode: false, showStatus: false, pushDownMm: 2.5 };
    const html = labelPrintDoc('t', dymoMedia, content, img, opts);
    expect(html).not.toContain('margin-top:2.5mm');
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

describe('labelPrintDoc — padding default', () => {
  it('defaults to 2.0mm content padding on non-Dymo templates', () => {
    const html = labelPrintDoc('t', media2x1, content, img, { showBarcode: false, showStatus: false });
    expect(html).toContain(`padding:${mm(2.0)}`);
  });
});
