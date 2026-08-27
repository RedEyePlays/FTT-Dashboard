import { describe, it, expect } from 'vitest';
import { labelDots, buildZpl, LABEL_SIZES, ZplLabelData } from './zpl';
import { mergeLabelSizes } from '../domain/settings';

const dims = (id: string) => LABEL_SIZES.find(s => s.id === id)!;
const data: ZplLabelData = {
  org: 'FlipThatTech',
  idLine: 'RPR-000123',
  device: 'Apple iPhone 14 Pro',
  imei: '356789101234567',
  issue: 'Cracked screen',
  qrData: 'repair_abc123',
};

describe('labelDots', () => {
  it('2x1 @ 203 dpi -> 406 x 203 dots', () => {
    expect(labelDots(2, 203)).toBe(406);
    expect(labelDots(1, 203)).toBe(203);
  });
  it('scales with 300 dpi', () => {
    expect(labelDots(2, 300)).toBe(600);
    expect(labelDots(1, 300)).toBe(300);
  });
});

describe('buildZpl', () => {
  it('emits a well-formed ZPL II label at the exact stock dot size', () => {
    const z = buildZpl(data, dims('2x1'), 203);
    expect(z.startsWith('^XA')).toBe(true);
    expect(z.trimEnd().endsWith('^XZ')).toBe(true);
    expect(z).toContain('^PW406');
    expect(z).toContain('^LL203');
    expect(z).toContain('^LH0,0');
    expect(z).toContain('^CI28');
  });

  it('includes all required label fields + a QR encoding the id', () => {
    const z = buildZpl(data, dims('2x1'), 203);
    expect(z).toContain('FlipThatTech');
    expect(z).toContain('RPR-000123');
    expect(z).toContain('Apple iPhone 14 Pro');
    expect(z).toContain('356789101234567');
    expect(z).toContain('Cracked screen');
    expect(z).toContain('^BQN,2,');
    expect(z).toContain('MA,repair_abc123');
  });

  it('honors DPI + optional density', () => {
    const z = buildZpl(data, dims('4x6'), 300, 10);
    expect(z).toContain('^PW1200'); // 4in * 300
    expect(z).toContain('^LL1800'); // 6in * 300
    expect(z).toContain('^MD10');
  });

  it('omits ^MD when no density is given', () => {
    expect(buildZpl(data, dims('2x1'), 203)).not.toContain('^MD');
  });

  it('sanitizes control chars and folds the wholesale middot', () => {
    const z = buildZpl({ ...data, idLine: 'WB-45 · #3', device: 'A^B~C' }, dims('2x2'), 203);
    expect(z).toContain('WB-45 - #3');
    expect(z).not.toMatch(/\^A0N,[0-9]+,[0-9]+\^FB[0-9]+,1,0,L,0\^FDA\^B/); // ^/~ stripped from data
    expect(z).toContain('A B C');
  });

  it('prints a user-added custom size the same way (sourced from the merged list)', () => {
    // A size someone adds in Settings must work on the Zebra path with no extra
    // wiring — buildZpl just takes the chosen dims from the merged list.
    const merged = mergeLabelSizes([{ id: 'custom-3x2', label: '3 × 2', w: 3, h: 2 }]);
    const custom = merged.find(s => s.id === 'custom-3x2')!;
    const z = buildZpl(data, custom, 203);
    expect(z).toContain('^PW609'); // 3in * 203
    expect(z).toContain('^LL406'); // 2in * 203
    expect(z).toContain('RPR-000123');
  });
});

describe('buildZpl — push-down / padding / line-spacing (Zebra direct-print path)', () => {
  // The "Push content down" (and content padding / line spacing) Settings
  // previously reached the browser/PDF label paths but were silently
  // ignored here — a real fault: RepairLabelModal makes this the PRIMARY
  // print button whenever a Zebra device is selected, so a shop printing
  // directly to a networked Zebra printer would see zero effect from any of
  // the three settings no matter what they were set to.

  // Extract the y-coordinate ZPL gives the org field's ^FO command
  // (^FOx,y...^FD<org text>^FS) so movement can be measured directly.
  const orgFieldY = (z: string): number => {
    const m = z.match(/\^FO(\d+),(\d+)\^A0N,\d+,\d+\^FB\d+,1,0,L,0\^FDFlipThatTech\^FS/);
    if (!m) throw new Error('org field not found in ZPL output');
    return parseInt(m[2], 10);
  };
  const fontSizes = (z: string): string[] => Array.from(z.matchAll(/\^A0N,(\d+),\d+/g)).map(m => m[1]);

  it('with no spacing override, behaves exactly as before (built-in 0.06in padding, no push-down)', () => {
    const z = buildZpl(data, dims('2x1'), 203);
    expect(orgFieldY(z)).toBe(labelDots(0.06, 203));
  });

  it('pushDownMm moves every field down by the same offset, without touching font sizes', () => {
    const base = buildZpl(data, dims('2x1'), 203);
    const pushed = buildZpl(data, dims('2x1'), 203, undefined, { pushDownMm: 1 });
    const deltaDots = orgFieldY(pushed) - orgFieldY(base);
    // 1mm at 203dpi
    expect(deltaDots).toBe(Math.round((1 / 25.4) * 203));
    expect(fontSizes(pushed)).toEqual(fontSizes(base)); // never resized
  });

  it('a short label (no imei/issue) gets real, visible push-down movement — not clamped to near-zero', () => {
    const shortData: ZplLabelData = { org: 'FlipThatTech', idLine: 'RPR-1', device: 'AirPods', qrData: 'x' };
    const base = buildZpl(shortData, dims('2x1'), 203);
    const pushed = buildZpl(shortData, dims('2x1'), 203, undefined, { pushDownMm: 4 });
    const deltaMm = ((orgFieldY(pushed) - orgFieldY(base)) / 203) * 25.4;
    expect(deltaMm).toBeGreaterThan(3); // most of the requested 4mm actually applied
  });

  it('a fully-specified label (org+id+device+imei+issue, the worst case) clamps push-down instead of letting content run off the bottom edge', () => {
    const h = labelDots(1, 203); // 2x1 label height in dots
    const withHugePush = buildZpl(data, dims('2x1'), 203, undefined, { pushDownMm: 99 });
    // Every field's own ^FOx,y start position must stay within the label.
    const allY = Array.from(withHugePush.matchAll(/\^FO\d+,(\d+)\^A0N/g)).map(m => parseInt(m[1], 10));
    for (const y of allY) expect(y).toBeLessThan(h);
    // Font sizes are still completely unaffected by the clamp.
    expect(fontSizes(withHugePush)).toEqual(fontSizes(buildZpl(data, dims('2x1'), 203)));
  });

  it('padMm overrides the built-in 0.06in padding', () => {
    const z = buildZpl(data, dims('2x1'), 203, undefined, { padMm: 2.0 });
    expect(orgFieldY(z)).toBe(Math.round((2.0 / 25.4) * 203));
  });
});

describe('LABEL_SIZES (built-ins)', () => {
  it('exposes the 5 shared built-in presets', () => {
    expect(LABEL_SIZES.map(s => s.id)).toEqual(['dymo-36x89', '2x1', '2x2', '2x3', '4x6']);
  });
});
