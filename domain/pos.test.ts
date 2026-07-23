import { describe, it, expect } from 'vitest';
import { platformFeeAmount, isZeroPricedDevice, cartHasZeroPricedDevice, PricedLine } from './pos';

describe('platformFeeAmount', () => {
  it('computes the dollar fee for a subtotal and percent', () => {
    expect(platformFeeAmount(100, 13.25)).toBeCloseTo(13.25);
    expect(platformFeeAmount(200, 0)).toBe(0);
  });
  it('never returns a negative fee', () => {
    expect(platformFeeAmount(-50, 10)).toBe(0);
    expect(platformFeeAmount(100, -10)).toBe(0);
  });
});

const dev = (unitPrice: number): PricedLine => ({ kind: 'device', unitPrice });
const acc = (unitPrice: number): PricedLine => ({ kind: 'accessory', unitPrice });

describe('isZeroPricedDevice', () => {
  it('flags a device priced at $0 or less', () => {
    expect(isZeroPricedDevice(dev(0))).toBe(true);
    expect(isZeroPricedDevice(dev(-5))).toBe(true);
    expect(isZeroPricedDevice({ kind: 'device', unitPrice: NaN as any })).toBe(true); // no price set
  });
  it('does not flag a priced device', () => {
    expect(isZeroPricedDevice(dev(199.99))).toBe(false);
  });
  it('never flags an accessory, even at $0 (only devices are guarded)', () => {
    expect(isZeroPricedDevice(acc(0))).toBe(false);
    expect(isZeroPricedDevice(acc(5))).toBe(false);
  });
});

describe('cartHasZeroPricedDevice', () => {
  it('is true when any device line is $0', () => {
    expect(cartHasZeroPricedDevice([dev(150), acc(0), dev(0)])).toBe(true);
  });
  it('is false when every device line has a price', () => {
    expect(cartHasZeroPricedDevice([dev(150), acc(0), acc(20)])).toBe(false);
  });
  it('is false for an empty cart', () => {
    expect(cartHasZeroPricedDevice([])).toBe(false);
  });
});
