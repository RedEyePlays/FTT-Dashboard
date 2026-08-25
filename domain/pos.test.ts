import { describe, it, expect } from 'vitest';
import { platformFeeAmount, isZeroPricedDevice, cartHasZeroPricedDevice, PricedLine, salesBalanceOwing, isLayaway, searchCheckoutInventory, canVoidSale, isVoided, isReturned, isReversed, canReturnSale, returnRefund, saleAccessoryRestock, saleDeviceListedPlatforms, collectedOnSale, cashCollectedOnSale, saleRefundDrawerEffect, mixedPaymentMismatch } from './pos';
import { InventoryItem, SalesTransaction } from '../types';

const item = (p: Partial<InventoryItem>): InventoryItem => ({
  id: 'x', kind: 'device', item: '', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, date: '', notes: '', ...p,
});

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

describe('salesBalanceOwing', () => {
  it('is the total minus the deposit for a partial payment', () => {
    expect(salesBalanceOwing(500, 200)).toBe(300);
    expect(salesBalanceOwing(99.99, 50)).toBeCloseTo(49.99);
  });
  it('owes nothing when paid in full (deposit absent, 0, or >= total)', () => {
    expect(salesBalanceOwing(500)).toBe(0);
    expect(salesBalanceOwing(500, 0)).toBe(0);
    expect(salesBalanceOwing(500, 500)).toBe(0);
    expect(salesBalanceOwing(500, 600)).toBe(0); // overpayment never goes negative
  });
  it('ignores a negative deposit (treated as paid in full)', () => {
    expect(salesBalanceOwing(500, -10)).toBe(0);
  });
});

describe('isLayaway', () => {
  it('is true only when a balance is still owing', () => {
    expect(isLayaway({ balanceOwing: 300 })).toBe(true);
    expect(isLayaway({ balanceOwing: 0 })).toBe(false);
    expect(isLayaway({})).toBe(false);
  });
});

describe('searchCheckoutInventory', () => {
  const inv: InventoryItem[] = [
    item({ id: 'd1', kind: 'device', item: 'Apple iPhone 14', brand: 'Apple', model: 'iPhone 14', sku: 'PHN-001', imei: '111' }),
    item({ id: 'd2', kind: 'device', item: 'Samsung Galaxy S24', brand: 'Samsung', model: 'Galaxy S24', sku: 'PHN-002' }),
    item({ id: 'sold', kind: 'device', item: 'Apple iPhone 13', sku: 'PHN-003', soldDate: '2026-01-01' }), // sold → excluded
    item({ id: 'a1', kind: 'accessory', item: 'Apple USB-C Cable', sku: 'ACC-001', quantity: 5 }),
    item({ id: 'a0', kind: 'accessory', item: 'Apple Case', sku: 'ACC-002', quantity: 0 }), // out of stock → excluded
  ];

  it('substring-matches name/brand/model across unsold devices + in-stock accessories', () => {
    const ids = searchCheckoutInventory(inv, 'apple').map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining(['d1', 'a1']));
    expect(ids).not.toContain('sold'); // sold device excluded
    expect(ids).not.toContain('a0');   // out-of-stock accessory excluded
  });

  it('matches SKU and IMEI too', () => {
    expect(searchCheckoutInventory(inv, 'phn-002').map(i => i.id)).toEqual(['d2']);
    expect(searchCheckoutInventory(inv, '111').map(i => i.id)).toEqual(['d1']);
  });

  it('honours excludeIds (e.g. already in the cart) and the result limit', () => {
    expect(searchCheckoutInventory(inv, 'apple', { excludeIds: new Set(['d1']) }).map(i => i.id)).not.toContain('d1');
    expect(searchCheckoutInventory(inv, 'a', { limit: 1 })).toHaveLength(1);
  });

  it('returns nothing for a blank query', () => {
    expect(searchCheckoutInventory(inv, '   ')).toEqual([]);
  });
});

describe('void eligibility', () => {
  const tx = (p: Partial<SalesTransaction>): SalesTransaction => ({
    id: 't', date: '2026-07-28', customerName: '', subtotal: 0, tax: 0, platformFee: 0,
    purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines: [], ...p,
  });

  it('allows voiding a same-day, not-yet-voided sale', () => {
    expect(canVoidSale(tx({ date: '2026-07-28' }), '2026-07-28')).toBe(true);
  });
  it('blocks voiding once the day has passed', () => {
    expect(canVoidSale(tx({ date: '2026-07-27' }), '2026-07-28')).toBe(false);
  });
  it('blocks voiding an already-voided sale', () => {
    expect(canVoidSale(tx({ date: '2026-07-28', status: 'voided' }), '2026-07-28')).toBe(false);
    expect(isVoided(tx({ status: 'voided' }))).toBe(true);
    expect(isVoided(tx({}))).toBe(false);
  });
});

describe('return eligibility + refund math', () => {
  const tx = (p: Partial<SalesTransaction>): SalesTransaction => ({
    id: 't', date: '2026-07-28', customerName: '', subtotal: 0, tax: 0, platformFee: 0,
    purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines: [], ...p,
  });

  it('allows returns only after the same-day void window (Void owns same-day)', () => {
    expect(canReturnSale(tx({ date: '2026-07-27' }), '2026-07-28')).toBe(true);  // earlier day → return
    expect(canReturnSale(tx({ date: '2026-07-28' }), '2026-07-28')).toBe(false); // same day → void's job
  });
  it('blocks returning an already voided or returned sale', () => {
    expect(canReturnSale(tx({ date: '2026-07-27', status: 'voided' }), '2026-07-28')).toBe(false);
    expect(canReturnSale(tx({ date: '2026-07-27', status: 'returned' }), '2026-07-28')).toBe(false);
  });

  it('respects a configurable void window, keeping Void and Returns non-overlapping', () => {
    // 2-day void window: today and the 2 prior days are voidable, older is returnable.
    expect(canVoidSale(tx({ date: '2026-07-28' }), '2026-07-28', 2)).toBe(true);   // same day
    expect(canVoidSale(tx({ date: '2026-07-26' }), '2026-07-28', 2)).toBe(true);   // 2 days back (boundary)
    expect(canVoidSale(tx({ date: '2026-07-25' }), '2026-07-28', 2)).toBe(false);  // 3 days back → return
    expect(canReturnSale(tx({ date: '2026-07-26' }), '2026-07-28', 2)).toBe(false);// still in void window
    expect(canReturnSale(tx({ date: '2026-07-25' }), '2026-07-28', 2)).toBe(true); // past window → return
  });

  it('isReturned / isReversed reflect the status', () => {
    expect(isReturned(tx({ status: 'returned' }))).toBe(true);
    expect(isReturned(tx({ status: 'voided' }))).toBe(false);
    expect(isReversed(tx({ status: 'voided' }))).toBe(true);
    expect(isReversed(tx({ status: 'returned' }))).toBe(true);
    expect(isReversed(tx({}))).toBe(false);
  });

  it('refunds the full total when there is no restocking fee', () => {
    expect(returnRefund(500)).toBe(500);
    expect(returnRefund(500, 0)).toBe(500);
  });
  it('refunds total minus the restocking fee', () => {
    expect(returnRefund(500, 50)).toBe(450);
    expect(returnRefund(99.99, 10)).toBeCloseTo(89.99);
  });
  it('clamps the fee so the refund never goes negative', () => {
    expect(returnRefund(500, 600)).toBe(0);
    expect(returnRefund(500, -10)).toBe(500);
  });
});

describe('saleAccessoryRestock', () => {
  const tx = (lines: any[]): SalesTransaction => ({
    id: 't', date: '2026-07-28', customerName: '', subtotal: 0, tax: 0, platformFee: 0,
    purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines,
  });

  it('produces one positive delta per accessory line, summed by id, ignoring devices + custom', () => {
    const updates = saleAccessoryRestock(tx([
      { inventoryId: 'a1', kind: 'accessory', name: 'Cable', quantity: 2, unitPrice: 10 },
      { inventoryId: 'a1', kind: 'accessory', name: 'Cable', quantity: 1, unitPrice: 10 },
      { inventoryId: 'd1', kind: 'device', name: 'Phone', quantity: 1, unitPrice: 500 },
      { inventoryId: '', kind: 'accessory', name: 'Custom', quantity: 5, unitPrice: 3 },
    ]));
    expect(updates).toEqual([{ id: 'a1', delta: 3 }]); // 2+1 restocked; device + custom excluded
  });
  it('is empty for a device-only sale', () => {
    expect(saleAccessoryRestock(tx([{ inventoryId: 'd1', kind: 'device', name: 'Phone', quantity: 1, unitPrice: 500 }]))).toEqual([]);
  });
});

describe('collectedOnSale / cashCollectedOnSale (void + return refund base)', () => {
  const base = { totalPaid: 500, deposit: undefined as number | undefined, balanceOwing: undefined as number | undefined, paymentMethod: 'cash' as const, cashAmount: undefined as number | undefined };

  it('a fully-paid sale collected the full totalPaid', () => {
    expect(collectedOnSale(base)).toBe(500);
  });
  it('a layaway only collected its deposit, never the full total', () => {
    expect(collectedOnSale({ ...base, deposit: 150, balanceOwing: 350 })).toBe(150);
  });

  it('a cash sale\'s cash-collected is the whole amount', () => {
    expect(cashCollectedOnSale({ ...base, paymentMethod: 'cash' })).toBe(500);
  });
  it('a card sale never collected any cash', () => {
    expect(cashCollectedOnSale({ ...base, paymentMethod: 'card' })).toBe(0);
  });
  it('a mixed sale\'s cash-collected is only the recorded cash portion', () => {
    expect(cashCollectedOnSale({ ...base, paymentMethod: 'mixed', cashAmount: 200 })).toBe(200);
  });
  it('a mixed layaway\'s cash-collected is capped by the deposit\'s cash portion', () => {
    // Deposit was $150, of which $60 was recorded as the cash portion.
    expect(cashCollectedOnSale({ ...base, paymentMethod: 'mixed', cashAmount: 60, deposit: 150, balanceOwing: 350 })).toBe(60);
  });
  it('treats a missing cashAmount on a mixed sale as zero', () => {
    expect(cashCollectedOnSale({ ...base, paymentMethod: 'mixed', cashAmount: undefined })).toBe(0);
  });
});

describe('return refund composition (App.tsx handleReturnSale\'s exact formula)', () => {
  const base = { totalPaid: 500, deposit: undefined as number | undefined, balanceOwing: undefined as number | undefined, paymentMethod: 'cash' as const, cashAmount: undefined as number | undefined };

  it('a cash sale refunds the full total minus the restocking fee, all as cash', () => {
    const tx = { ...base, paymentMethod: 'cash' as const };
    expect(returnRefund(collectedOnSale(tx), 50)).toBe(450);       // total refund to the customer
    expect(returnRefund(cashCollectedOnSale(tx), 50)).toBe(450);   // same amount, all cash
  });

  it('a layaway return refunds only the deposit collected, not the full totalPaid', () => {
    const tx = { ...base, deposit: 150, balanceOwing: 350 };
    expect(returnRefund(collectedOnSale(tx), undefined)).toBe(150); // NOT tx.totalPaid (500)
  });

  it('a mixed-payment return only deducts the cash portion from the drawer, while the total refund covers both', () => {
    const tx = { ...base, paymentMethod: 'mixed' as const, cashAmount: 200 }; // $200 cash + $300 card of $500
    expect(returnRefund(collectedOnSale(tx), undefined)).toBe(500);     // full refund to the customer
    expect(returnRefund(cashCollectedOnSale(tx), undefined)).toBe(200); // only the cash portion hits the drawer
  });

  it('a card-only return never produces a cash drawer effect', () => {
    const tx = { ...base, paymentMethod: 'card' as const };
    expect(saleRefundDrawerEffect(returnRefund(cashCollectedOnSale(tx), undefined))).toBeNull();
  });
});

describe('mixedPaymentMismatch', () => {
  it('is false when cash + card + etransfer exactly sum to the collected amount', () => {
    expect(mixedPaymentMismatch({ cash: 200, card: 250, etransfer: 50 }, 500)).toBe(false);
  });
  it('is true when the parts sum to less than the collected amount', () => {
    expect(mixedPaymentMismatch({ cash: 200, card: 250, etransfer: 0 }, 500)).toBe(true);
  });
  it('is true when the parts sum to more than the collected amount', () => {
    expect(mixedPaymentMismatch({ cash: 300, card: 250, etransfer: 0 }, 500)).toBe(true);
  });
  it('treats missing parts as zero', () => {
    expect(mixedPaymentMismatch({ cash: 500 }, 500)).toBe(false);
    expect(mixedPaymentMismatch({}, 500)).toBe(true);
  });
  it('is exact to the cent, not fooled by floating-point drift', () => {
    expect(mixedPaymentMismatch({ cash: 100.1, card: 100.2, etransfer: 0 }, 200.3)).toBe(false);
  });
  it('clamps a negative part to zero rather than letting it cancel out a mismatch', () => {
    expect(mixedPaymentMismatch({ cash: 600, card: -100, etransfer: 0 }, 500)).toBe(true); // 600, not 500
  });
});

describe('saleRefundDrawerEffect', () => {
  it('a nonzero cash refund is cash OUT of the drawer', () => {
    expect(saleRefundDrawerEffect(250)).toEqual({ kind: 'cashOut', amount: 250 });
  });
  it('produces no entry for a zero or near-zero amount (a card/e-transfer refund)', () => {
    expect(saleRefundDrawerEffect(0)).toBeNull();
    expect(saleRefundDrawerEffect(0.001)).toBeNull();
  });
});

describe('saleDeviceListedPlatforms', () => {
  it('maps each device line to its listedPlatforms snapshot, keyed by inventoryId', () => {
    const tx: Pick<SalesTransaction, 'lines'> = {
      lines: [
        { inventoryId: 'd1', kind: 'device', name: 'Phone A', quantity: 1, unitPrice: 500, listedPlatforms: ['kijiji', 'facebook'] },
        { inventoryId: 'd2', kind: 'device', name: 'Phone B', quantity: 1, unitPrice: 300 }, // never listed elsewhere
        { inventoryId: 'a1', kind: 'accessory', name: 'Case', quantity: 1, unitPrice: 10 },
      ],
    };
    const byId = saleDeviceListedPlatforms(tx);
    expect(byId.get('d1')).toEqual(['kijiji', 'facebook']);
    expect(byId.get('d2')).toBeUndefined();
    expect(byId.has('a1')).toBe(false); // accessory lines are irrelevant here
  });

  it('ignores custom device lines with no inventoryId', () => {
    const tx: Pick<SalesTransaction, 'lines'> = {
      lines: [{ kind: 'device', name: 'Custom device', quantity: 1, unitPrice: 200, listedPlatforms: ['ebay'] }],
    };
    expect(saleDeviceListedPlatforms(tx).size).toBe(0);
  });
});
