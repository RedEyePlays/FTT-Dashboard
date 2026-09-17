import { describe, it, expect } from 'vitest';
import { SalesTransaction } from '../types';
import {
  defaultRefundSplits, impliedRefundSplits, refundDrawerEffect, refundSplitsValid,
  refundSourceLabel, singleRefundSource, returnRefund, collectedOnSale,
} from './pos';
import { taxRemittance, expectedEndingCash, sumDrawerEntries } from './reports';

// The gap this closes: a refund's SOURCE was never asked. The app assumed the
// money went back the way it came in — the sale's cash portion always logged
// as a cash-out on today's drawer, card/e-transfer never touching it. There
// was no way to say "I refunded that out of my own pocket" or "I refunded a
// card sale in cash from the till", and both left the drawer's expected cash
// wrong.

const sale = (over: Partial<SalesTransaction> = {}): SalesTransaction => ({
  id: 'tx1', date: '2026-03-10', customerName: 'A', lines: [],
  subtotal: 1000, tax: 130, totalPaid: 1130, netProfit: 200,
  paymentMethod: 'cash', ...over,
} as SalesTransaction);

describe('the default source — the money goes back the way it came in', () => {
  it('a cash sale refunds out of store cash', () => {
    expect(defaultRefundSplits(sale({ paymentMethod: 'cash' }), 1130))
      .toEqual([{ paidFrom: 'store_cash', amount: 1130 }]);
  });

  it('a card sale refunds back to the card, and does not touch the till', () => {
    const splits = defaultRefundSplits(sale({ paymentMethod: 'card' }), 1130);
    expect(splits).toEqual([{ paidFrom: 'card', amount: 1130 }]);
    expect(refundDrawerEffect(splits)).toBeNull();
  });

  it('an e-transfer sale refunds by e-transfer', () => {
    expect(defaultRefundSplits(sale({ paymentMethod: 'etransfer' }), 1130))
      .toEqual([{ paidFrom: 'etransfer', amount: 1130 }]);
  });

  it('a MIXED sale is split the way it was taken — cash from the till, the rest to the card', () => {
    const tx = sale({ paymentMethod: 'mixed', cashAmount: 500, totalPaid: 1130 });
    expect(defaultRefundSplits(tx, 1130)).toEqual([
      { paidFrom: 'store_cash', amount: 500 },
      { paidFrom: 'card', amount: 630 },
    ]);
  });

  it('a mixed refund smaller than its cash portion comes wholly from the till', () => {
    // A restocking fee ate most of the refund; the cash side covers what's left.
    const tx = sale({ paymentMethod: 'mixed', cashAmount: 500 });
    expect(defaultRefundSplits(tx, 300)).toEqual([{ paidFrom: 'store_cash', amount: 300 }]);
  });

  it('nothing to refund means no source is offered', () => {
    expect(defaultRefundSplits(sale(), 0)).toEqual([]);
  });
});

describe('only store cash moves the drawer', () => {
  it('a store-cash refund is a cash-out', () => {
    expect(refundDrawerEffect([{ paidFrom: 'store_cash', amount: 250 }]))
      .toEqual({ kind: 'cashOut', amount: 250 });
  });

  it("the owner's own pocket never touches the till — the case that had nowhere to go", () => {
    expect(refundDrawerEffect([{ paidFrom: 'personal', amount: 250 }])).toBeNull();
  });

  it('card, e-transfer and other never touch it either', () => {
    expect(refundDrawerEffect([{ paidFrom: 'card', amount: 250 }])).toBeNull();
    expect(refundDrawerEffect([{ paidFrom: 'etransfer', amount: 250 }])).toBeNull();
    expect(refundDrawerEffect([{ paidFrom: 'other', amount: 250 }])).toBeNull();
  });

  it('a CARD sale refunded in cash from the till DOES take it out', () => {
    // Impossible to express before: the old rule derived the drawer effect
    // from the sale's own cash portion, which for a card sale is zero.
    expect(refundDrawerEffect([{ paidFrom: 'store_cash', amount: 1130 }]))
      .toEqual({ kind: 'cashOut', amount: 1130 });
  });

  it('a split takes out only its store-cash part', () => {
    expect(refundDrawerEffect([
      { paidFrom: 'store_cash', amount: 500 },
      { paidFrom: 'personal', amount: 400 },
      { paidFrom: 'card', amount: 230 },
    ])).toEqual({ kind: 'cashOut', amount: 500 });
  });

  it('sums several store-cash rows', () => {
    expect(refundDrawerEffect([
      { paidFrom: 'store_cash', amount: 100.1 },
      { paidFrom: 'store_cash', amount: 100.2 },
    ])).toEqual({ kind: 'cashOut', amount: 200.3 });
  });
});

describe('the splits must add up — same rule as the checkout mixed payment', () => {
  it('a single source covering the whole refund is valid', () => {
    expect(refundSplitsValid([{ paidFrom: 'store_cash', amount: 1130 }], 1130).valid).toBe(true);
  });

  it('under-assigned is rejected, and says how much is left', () => {
    const v = refundSplitsValid([{ paidFrom: 'store_cash', amount: 500 }], 1130);
    expect(v.valid).toBe(false);
    expect(v.remaining).toBe(630);
    expect(v.error).toContain('630.00');
  });

  it('over-assigned is rejected too', () => {
    const v = refundSplitsValid([{ paidFrom: 'store_cash', amount: 1200 }], 1130);
    expect(v.valid).toBe(false);
    expect(v.error).toContain('70.00');
  });

  it('exact to the cent, not fooled by floating-point drift', () => {
    expect(refundSplitsValid(
      [{ paidFrom: 'store_cash', amount: 100.1 }, { paidFrom: 'card', amount: 100.2 }], 200.3,
    ).valid).toBe(true);
  });

  it('clamps a negative row rather than letting it cancel out a mismatch', () => {
    // 600, not 500 — exactly how mixedPaymentMismatch treats a stray "-".
    const v = refundSplitsValid(
      [{ paidFrom: 'store_cash', amount: 600 }, { paidFrom: 'card', amount: -100 }], 500,
    );
    expect(v.valid).toBe(false);
  });

  it('no source chosen is rejected when there IS something to refund', () => {
    expect(refundSplitsValid([], 1130).valid).toBe(false);
  });

  it('a $0 refund needs no source at all', () => {
    // A return whose restocking fee swallowed the whole refund.
    expect(refundSplitsValid([], 0).valid).toBe(true);
  });
});

describe('historical records keep reading exactly as they did', () => {
  it('a pre-feature voided CASH sale still reads as refunded from store cash', () => {
    const tx = sale({ status: 'voided', paymentMethod: 'cash' });
    expect(impliedRefundSplits(tx)).toEqual([{ paidFrom: 'store_cash', amount: 1130 }]);
  });

  it('a pre-feature voided CARD sale still reads as refunded to the card', () => {
    const tx = sale({ status: 'voided', paymentMethod: 'card' });
    expect(impliedRefundSplits(tx)).toEqual([{ paidFrom: 'card', amount: 1130 }]);
  });

  it('a pre-feature RETURN uses its recorded refund amount, not the sale total', () => {
    const tx = sale({ status: 'returned', paymentMethod: 'cash', refundAmount: 1000, restockingFee: 130 });
    expect(impliedRefundSplits(tx)).toEqual([{ paidFrom: 'store_cash', amount: 1000 }]);
  });

  it('a record WITH stored splits is shown exactly as stored, never re-derived', () => {
    const tx = sale({
      status: 'returned', paymentMethod: 'card', refundAmount: 1130,
      refundSplits: [{ paidFrom: 'personal', amount: 1130 }],
    });
    expect(impliedRefundSplits(tx)).toEqual([{ paidFrom: 'personal', amount: 1130 }]);
  });

  it('the single-source shorthand is honoured when no split array was written', () => {
    const tx = sale({ status: 'voided', paymentMethod: 'card', refundPaidFrom: 'store_cash' });
    expect(impliedRefundSplits(tx)).toEqual([{ paidFrom: 'store_cash', amount: 1130 }]);
  });
});

describe('the stored shorthand', () => {
  it('is set for a single-source refund', () => {
    expect(singleRefundSource([{ paidFrom: 'personal', amount: 500 }])).toBe('personal');
  });
  it('is left unset for a genuine split, so the array stays the only truth', () => {
    expect(singleRefundSource([
      { paidFrom: 'store_cash', amount: 500 }, { paidFrom: 'card', amount: 500 },
    ])).toBeUndefined();
  });
  it('ignores zero rows when deciding', () => {
    expect(singleRefundSource([
      { paidFrom: 'store_cash', amount: 500 }, { paidFrom: 'card', amount: 0 },
    ])).toBe('store_cash');
  });
});

describe('wording', () => {
  it('names a single source plainly', () => {
    expect(refundSourceLabel([{ paidFrom: 'personal', amount: 500 }])).toBe("Owner's personal cash");
  });
  it('itemizes a split with its amounts', () => {
    expect(refundSourceLabel([
      { paidFrom: 'store_cash', amount: 500 }, { paidFrom: 'card', amount: 630 },
    ])).toBe('Store cash $500.00 + Card $630.00');
  });
});

describe('the refund source changes the DRAWER and nothing else', () => {
  // The rule the whole feature rests on: a refund reduces sales, revenue and
  // tax identically no matter where the money came from. Only the till and
  // the record move.
  const reversed = (refundSplits: SalesTransaction['refundSplits']): SalesTransaction =>
    sale({ id: 'r1', status: 'returned', refundAmount: 1130, refundSplits });

  it('the sales-tax report is byte-identical across every refund source', () => {
    const fromTill = taxRemittance([reversed([{ paidFrom: 'store_cash', amount: 1130 }])], '2026-01-01', '2026-12-31');
    const fromPocket = taxRemittance([reversed([{ paidFrom: 'personal', amount: 1130 }])], '2026-01-01', '2026-12-31');
    const toCard = taxRemittance([reversed([{ paidFrom: 'card', amount: 1130 }])], '2026-01-01', '2026-12-31');
    expect(fromPocket).toEqual(fromTill);
    expect(toCard).toEqual(fromTill);
  });

  it('a reversed sale contributes no taxable sales either way — the reversal is what matters', () => {
    const report = taxRemittance([reversed([{ paidFrom: 'personal', amount: 1130 }])], '2026-01-01', '2026-12-31');
    expect(report.totalTaxCollected).toBe(0);
    expect(report.totalTaxableSales).toBe(0);
    expect(report.totalSalesCount).toBe(0);
  });

  it('but the till DOES differ: refunding from the owner leaves it $1130 higher', () => {
    const day = (splits: SalesTransaction['refundSplits']) => {
      const effect = refundDrawerEffect(splits || []);
      return expectedEndingCash({
        openingFloat: 2000, cashSales: 0,
        cashOut: sumDrawerEntries(effect ? [{ amount: effect.amount }] : []),
      });
    };
    expect(day([{ paidFrom: 'store_cash', amount: 1130 }])).toBe(870);
    expect(day([{ paidFrom: 'personal', amount: 1130 }])).toBe(2000);
  });
});

describe('what App.tsx actually computes, end to end', () => {
  it('a return: refund is collected − fee, and the default source covers it exactly', () => {
    const tx = sale({ paymentMethod: 'cash', totalPaid: 1130 });
    const refund = returnRefund(collectedOnSale(tx), 130);
    expect(refund).toBe(1000);
    const splits = defaultRefundSplits(tx, refund);
    expect(refundSplitsValid(splits, refund).valid).toBe(true);
    expect(refundDrawerEffect(splits)).toEqual({ kind: 'cashOut', amount: 1000 });
  });

  it('a layaway void refunds only the deposit collected, from the till', () => {
    const tx = sale({ paymentMethod: 'cash', totalPaid: 1130, deposit: 200, balanceOwing: 930 });
    const refund = collectedOnSale(tx);
    expect(refund).toBe(200);
    expect(refundDrawerEffect(defaultRefundSplits(tx, refund))).toEqual({ kind: 'cashOut', amount: 200 });
  });
});
