import { describe, it, expect } from 'vitest';
import { mixedSaleTax, taxAppliesForSale } from './pos';

// The reported bug: on a mixed sale the shop charges tax on the card portion
// and not on the cash, and the checkout "showed a bug".
//
// Two things were wrong:
//  1. There was NO WAY to say it. The mixed branch just read a hand-typed
//     "Tax Collected" box, so the cashier had to work the figure out
//     themselves — and a blank box silently meant $0 tax on the whole sale.
//  2. The totals row still read "Tax (13%)" beside that hand-typed number.
//     On a $1000 sale with tax on only the $500 card half, the screen said
//     "Tax (13%)  $65.00" — and $65 is not 13% of $1000.

const RATE = 13;

describe('mixedSaleTax — cash is a tax-free payment toward the goods', () => {
  it("the reported case: $1000 of goods, $500 cash, tax on the rest", () => {
    // $500 of goods left uncovered by the cash → taxed at 13% → $65,
    // so the card side collects $565 and the sale totals $1065.
    expect(mixedSaleTax({ taxableBase: 1000, cashAmount: 500, taxRate: RATE, cashTaxed: false })).toBe(65);
  });

  it('taxes the WHOLE base when the shop charges tax on cash too', () => {
    expect(mixedSaleTax({ taxableBase: 1000, cashAmount: 500, taxRate: RATE, cashTaxed: true })).toBe(130);
  });

  it('no cash at all means the whole sale is taxed', () => {
    expect(mixedSaleTax({ taxableBase: 1000, cashAmount: 0, taxRate: RATE, cashTaxed: false })).toBe(130);
  });

  it('cash covering the whole sale leaves nothing to tax', () => {
    expect(mixedSaleTax({ taxableBase: 1000, cashAmount: 1000, taxRate: RATE, cashTaxed: false })).toBe(0);
  });

  it('never goes negative when the cash exceeds the taxable base', () => {
    // A cash-heavy split, or a cart whose taxable lines are worth less than
    // the cash tendered — tax is 0, never a credit.
    expect(mixedSaleTax({ taxableBase: 400, cashAmount: 900, taxRate: RATE, cashTaxed: false })).toBe(0);
  });

  it('is 0 at a 0% rate, and on an empty cart', () => {
    expect(mixedSaleTax({ taxableBase: 1000, cashAmount: 200, taxRate: 0, cashTaxed: false })).toBe(0);
    expect(mixedSaleTax({ taxableBase: 0, cashAmount: 0, taxRate: RATE, cashTaxed: false })).toBe(0);
  });

  it('tolerates junk/negative inputs rather than producing a negative tax', () => {
    expect(mixedSaleTax({ taxableBase: -100, cashAmount: 0, taxRate: RATE, cashTaxed: false })).toBe(0);
    expect(mixedSaleTax({ taxableBase: 1000, cashAmount: -50, taxRate: RATE, cashTaxed: false })).toBe(130);
    expect(mixedSaleTax({ taxableBase: 1000, cashAmount: 0, taxRate: -5, cashTaxed: false })).toBe(0);
  });

  it('only the TAXABLE base counts — a non-taxable line is already excluded', () => {
    // The caller passes taxableBase, not subtotal: a $1000 cart with $300
    // of non-taxable lines and $200 cash taxes 700 − 200 = 500.
    expect(mixedSaleTax({ taxableBase: 700, cashAmount: 200, taxRate: RATE, cashTaxed: false })).toBe(65);
  });
});

describe('taxAppliesForSale is unchanged for mixed — and that is correct', () => {
  it('a mixed sale is still a taxed sale even when its cash half is untaxed', () => {
    // Tax genuinely does apply to the non-cash part. This predicate answers
    // "is this sale taxed at all"; mixedSaleTax answers "how much".
    expect(taxAppliesForSale('mixed', 'none', 'none')).toBe(true);
    expect(taxAppliesForSale('mixed', 'separate', 'none')).toBe(true);
  });

  it('the cash-only and e-transfer-only rules are untouched', () => {
    expect(taxAppliesForSale('cash', 'none', 'none')).toBe(false);
    expect(taxAppliesForSale('cash', 'separate', 'none')).toBe(true);
    expect(taxAppliesForSale('etransfer', 'none', 'none')).toBe(false);
    expect(taxAppliesForSale('card', 'none', 'none')).toBe(true);
  });
});
