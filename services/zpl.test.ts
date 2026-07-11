import { describe, it, expect } from 'vitest';
import { labelDots, buildZpl, LABEL_SIZES, ZplLabelData } from './zpl';

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
});
