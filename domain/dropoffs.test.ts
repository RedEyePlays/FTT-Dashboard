import { describe, it, expect } from 'vitest';
import {
  deviceBuyerBalance, settleableDropOffs, settlementTotals, dropOffPurchaseCost, settlementDrawerEffect, dropOffAcceptDrawerEffect,
  initSettlementReview, settlementReviewTotals, buildLineAdjustments, settlementDirection, settlementDirectionLabel, buildSettlementFromReview,
  settlementFeeDirection, settlementFeeTotals, withResolvedBuyerId,
} from './dropoffs';
import { DropOff, DropOffStatus, PaidBy, Settlement } from '../types';

const d = (p: Partial<DropOff>): DropOff => ({
  id: 'd', buyerId: 'r1', item: 'iPhone', imei: '', sellerName: '', sellerContact: '',
  purchasePrice: 0, paidBy: 'runner' as PaidBy, dropOffFee: 0, dateDropped: '2026-07-01',
  status: 'accepted' as DropOffStatus, notes: '', ...p,
});

describe('deviceBuyerBalance', () => {
  it('sums fronted cash (buyer-paid only) + all fees, ignoring rejected/settled', () => {
    const dropOffs: DropOff[] = [
      d({ id: '1', buyerId: 'r1', paidBy: 'runner', purchasePrice: 300, dropOffFee: 20, status: 'accepted' }),
      d({ id: '2', buyerId: 'r1', paidBy: 'store', purchasePrice: 500, dropOffFee: 30, status: 'paidout' }),   // store paid → no cash fronted, fee still owed
      d({ id: '3', buyerId: 'r1', paidBy: 'runner', purchasePrice: 100, dropOffFee: 10, status: 'rejected' }), // excluded
      d({ id: '4', buyerId: 'r1', paidBy: 'runner', purchasePrice: 200, dropOffFee: 15, status: 'settled' }),  // excluded
      d({ id: '5', buyerId: 'r2', paidBy: 'runner', purchasePrice: 999, dropOffFee: 99, status: 'accepted' }), // other device buyer
    ];
    const b = deviceBuyerBalance('r1', dropOffs);
    expect(b.cashFronted).toBe(300);      // only #1 (buyer-paid, active)
    expect(b.feesOwed).toBe(50);          // #1 (20) + #2 (30)
    expect(b.net).toBe(350);              // 300 + 50
    expect(b.count).toBe(2);              // #1 and #2
  });

  it('is zero for a device buyer with no active drop-offs', () => {
    const b = deviceBuyerBalance('r9', [d({ buyerId: 'r1', purchasePrice: 100, dropOffFee: 10 })]);
    expect(b).toEqual({ cashFronted: 0, feesOwed: 0, net: 0, count: 0 });
  });

  it('a personal-paid drop-off never adds to cash fronted (same as store), but its fee is still owed', () => {
    const dropOffs: DropOff[] = [
      d({ id: '1', buyerId: 'r1', paidBy: 'personal', purchasePrice: 400, dropOffFee: 25, status: 'accepted' }),
    ];
    const b = deviceBuyerBalance('r1', dropOffs);
    expect(b.cashFronted).toBe(0);
    expect(b.feesOwed).toBe(25);
    expect(b.net).toBe(25);
  });
});

describe('settleableDropOffs', () => {
  it('includes only accepted/paid-out drop-offs for the device buyer', () => {
    const dropOffs: DropOff[] = [
      d({ id: '1', buyerId: 'r1', status: 'accepted' }),
      d({ id: '2', buyerId: 'r1', status: 'paidout' }),
      d({ id: '3', buyerId: 'r1', status: 'pending' }),   // excluded
      d({ id: '4', buyerId: 'r1', status: 'settled' }),   // excluded
      d({ id: '5', buyerId: 'r2', status: 'accepted' }),  // other device buyer
    ];
    expect(settleableDropOffs('r1', dropOffs).map(x => x.id)).toEqual(['1', '2']);
  });

  // Regression for the buyer-double-payment bug: settling must actually flip
  // every included drop-off to 'settled' (services/firestoreDb.ts's
  // settleDeviceBuyer does this atomically alongside the settlement save), or the
  // same drop-offs stay eligible for a second settlement.
  it('drop-offs marked settled after a settlement no longer show up as settleable', () => {
    const before: DropOff[] = [
      d({ id: '1', buyerId: 'r1', status: 'accepted' }),
      d({ id: '2', buyerId: 'r1', status: 'paidout' }),
    ];
    expect(settleableDropOffs('r1', before).map(x => x.id)).toEqual(['1', '2']);

    // Simulate settleDeviceBuyer's atomic write: every settled drop-off flips status.
    const settledIds = new Set(['1', '2']);
    const after: DropOff[] = before.map(x =>
      settledIds.has(x.id) ? { ...x, status: 'settled' as DropOffStatus, settlementId: 'settlement-1' } : x
    );

    expect(settleableDropOffs('r1', after)).toEqual([]);
  });
});

describe('settlementTotals', () => {
  it('reimburses buyer-fronted cash + all fees', () => {
    const set: DropOff[] = [
      d({ paidBy: 'runner', purchasePrice: 300, dropOffFee: 20 }),
      d({ paidBy: 'store', purchasePrice: 500, dropOffFee: 30 }),  // store paid → not reimbursed, fee still paid
      d({ paidBy: 'runner', purchasePrice: 150, dropOffFee: 10 }),
    ];
    const t = settlementTotals(set);
    expect(t.cashFronted).toBe(450);   // 300 + 150 (buyer-paid only)
    expect(t.totalFees).toBe(60);      // 20 + 30 + 10
    expect(t.amountToPay).toBe(510);   // 450 + 60
  });

  it('is zero for an empty set', () => {
    expect(settlementTotals([])).toEqual({ cashFronted: 0, totalFees: 0, amountToPay: 0 });
  });

  it('a personal-paid drop-off is never reimbursed as fronted cash (same as store)', () => {
    const set: DropOff[] = [
      d({ paidBy: 'personal', purchasePrice: 250, dropOffFee: 15 }),
    ];
    const t = settlementTotals(set);
    expect(t.cashFronted).toBe(0);
    expect(t.totalFees).toBe(15);
    expect(t.amountToPay).toBe(15);
  });
});

describe('dropOffPurchaseCost', () => {
  it('includes both the seller price AND the device buyer fee', () => {
    expect(dropOffPurchaseCost({ purchasePrice: 300, dropOffFee: 20 })).toBe(320);
  });

  it('matches what the settlement pays out for that device (no profit overstatement)', () => {
    // A single buyer-paid drop-off: the device cost recorded on the inventory
    // item must equal the cash + fee the settlement pays the device buyer for it.
    const one = d({ paidBy: 'runner', purchasePrice: 300, dropOffFee: 20 });
    expect(dropOffPurchaseCost(one)).toBe(settlementTotals([one]).amountToPay);
  });

  it('treats missing amounts as zero', () => {
    expect(dropOffPurchaseCost({ purchasePrice: 0, dropOffFee: 0 })).toBe(0);
    expect(dropOffPurchaseCost({ purchasePrice: undefined as any, dropOffFee: undefined as any })).toBe(0);
  });

  it('still counts correctly toward purchaseCost for a personal-paid drop-off, same as store/device buyer', () => {
    // dropOffPurchaseCost is paidBy-agnostic by design — the acquisition cost
    // is the same real cost regardless of whose money paid it.
    expect(dropOffPurchaseCost({ purchasePrice: 250, dropOffFee: 15 })).toBe(265);
  });
});

describe('settlementDrawerEffect', () => {
  it('a cash settlement paying the device buyer is cash OUT of the drawer', () => {
    expect(settlementDrawerEffect({ paymentMethod: 'cash', amountPaid: 250 })).toEqual({ kind: 'cashOut', amount: 250 });
  });

  it('a cash settlement where the device buyer owed the store (negative amountPaid) is cash IN', () => {
    expect(settlementDrawerEffect({ paymentMethod: 'cash', amountPaid: -40 })).toEqual({ kind: 'cashIn', amount: 40 });
  });

  it('e-transfer and other payment methods never touch the drawer, regardless of amount', () => {
    expect(settlementDrawerEffect({ paymentMethod: 'etransfer', amountPaid: 250 })).toBeNull();
    expect(settlementDrawerEffect({ paymentMethod: 'other', amountPaid: 250 })).toBeNull();
    expect(settlementDrawerEffect({ paymentMethod: 'etransfer', amountPaid: -40 })).toBeNull();
  });

  it('a legacy settlement with no paymentMethod recorded defaults to cash (prior behavior)', () => {
    expect(settlementDrawerEffect({ amountPaid: 100 } as Pick<Settlement, 'paymentMethod' | 'amountPaid'>)).toEqual({ kind: 'cashOut', amount: 100 });
  });

  it('produces no entry for a zero (or near-zero) amount', () => {
    expect(settlementDrawerEffect({ paymentMethod: 'cash', amountPaid: 0 })).toBeNull();
    expect(settlementDrawerEffect({ paymentMethod: 'cash', amountPaid: 0.001 })).toBeNull();
  });
});

describe('dropOffAcceptDrawerEffect', () => {
  it('a store-paid drop-off reduces expected drawer cash by the purchase price on accept', () => {
    expect(dropOffAcceptDrawerEffect({ paidBy: 'store', purchasePrice: 275 })).toEqual({ kind: 'cashOut', amount: 275 });
  });

  it('a buyer-paid drop-off never touches the drawer at accept — reimbursed later at settlement', () => {
    expect(dropOffAcceptDrawerEffect({ paidBy: 'runner', purchasePrice: 275 })).toBeNull();
  });

  it('a personal-paid drop-off never touches the drawer either — not store cash, and not a device buyer to reimburse', () => {
    expect(dropOffAcceptDrawerEffect({ paidBy: 'personal', purchasePrice: 275 })).toBeNull();
  });

  it('produces no entry for a zero (or near-zero) store-paid purchase price', () => {
    expect(dropOffAcceptDrawerEffect({ paidBy: 'store', purchasePrice: 0 })).toBeNull();
    expect(dropOffAcceptDrawerEffect({ paidBy: 'store', purchasePrice: 0.001 })).toBeNull();
  });

  it('treats a missing purchase price as zero', () => {
    expect(dropOffAcceptDrawerEffect({ paidBy: 'store', purchasePrice: undefined as any })).toBeNull();
  });
});

describe('pre-settlement review — editable per-device fees, exclusion, totals', () => {
  const dropOffs: DropOff[] = [
    d({ id: '1', buyerId: 'r1', item: 'iPhone 13', purchasePrice: 300, dropOffFee: 20, paidBy: 'runner', status: 'accepted' }),
    d({ id: '2', buyerId: 'r1', item: 'iPhone 14', purchasePrice: 500, dropOffFee: 30, paidBy: 'store', status: 'paidout' }),
    d({ id: '3', buyerId: 'r1', item: 'Pixel 8', purchasePrice: 200, dropOffFee: 15, paidBy: 'runner', status: 'accepted' }),
  ];

  it('initSettlementReview seeds one included, unedited line per drop-off', () => {
    const lines = initSettlementReview(dropOffs);
    expect(lines).toEqual([
      { dropOffId: '1', included: true, fee: 20 },
      { dropOffId: '2', included: true, fee: 30 },
      { dropOffId: '3', included: true, fee: 15 },
    ]);
  });

  it('unedited totals match settlementTotals for the same set (no drift between the two totals functions)', () => {
    const lines = initSettlementReview(dropOffs);
    const totals = settlementReviewTotals(dropOffs, lines, 0);
    const legacy = settlementTotals(dropOffs);
    expect(totals.cashFronted).toBe(legacy.cashFronted);
    expect(totals.totalFees).toBe(legacy.totalFees);
    expect(totals.netAmount).toBe(legacy.amountToPay);
    expect(totals.deviceCount).toBe(3);
  });

  it('editing a per-device fee updates the totals live', () => {
    const lines = initSettlementReview(dropOffs);
    lines[0].fee = 25; // was 20 — a $5 correction
    const totals = settlementReviewTotals(dropOffs, lines, 0);
    expect(totals.totalFees).toBe(70); // 25 + 30 + 15
    expect(totals.netAmount).toBe(500 + 70); // cashFronted (#1 300 + #3 200, both buyer-paid) + fees
  });

  it('editing a per-device fee is recorded as a line adjustment (original vs adjusted)', () => {
    const lines = initSettlementReview(dropOffs);
    lines[0].fee = 25;
    const adjustments = buildLineAdjustments(dropOffs, lines);
    expect(adjustments).toEqual([{ dropOffId: '1', originalFee: 20, adjustedFee: 25 }]);
  });

  it('leaving every fee untouched produces no adjustments', () => {
    const lines = initSettlementReview(dropOffs);
    expect(buildLineAdjustments(dropOffs, lines)).toEqual([]);
  });

  it('excluding a line removes it from totals and from the built settlement\'s dropOffIds, without altering the drop-off itself', () => {
    const lines = initSettlementReview(dropOffs);
    lines[1].included = false; // exclude #2 (store-paid, fee 30)
    const totals = settlementReviewTotals(dropOffs, lines, 0);
    expect(totals.deviceCount).toBe(2);
    expect(totals.totalFees).toBe(35); // 20 + 15, #2 excluded
    const settlement = buildSettlementFromReview({ id: 's1', buyerId: 'r1', date: '2026-08-01', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    expect(settlement.dropOffIds).toEqual(['1', '3']); // #2 left out — stays unsettled, eligible later
    expect(settlement.dropOffIds).not.toContain('2');
  });

  it('an excluded line produces no adjustment entry even if its fee was also edited before being excluded', () => {
    const lines = initSettlementReview(dropOffs);
    lines[1].fee = 999; // edited...
    lines[1].included = false; // ...then excluded
    expect(buildLineAdjustments(dropOffs, lines)).toEqual([]);
  });

  it('a settlement-level adjustment folds into the net amount and is kept with its note', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview(
      { id: 's1', buyerId: 'r1', date: '2026-08-01', paymentMethod: 'cash', notes: '' },
      dropOffs, lines, -10, 'Device buyer agreed to a $10 deduction for a late drop-off',
    );
    expect(settlement.adjustmentAmount).toBe(-10);
    expect(settlement.adjustmentNote).toBe('Device buyer agreed to a $10 deduction for a late drop-off');
    // cashFronted (#1 300 + #3 200) + fees (20+30+15=65) - 10 adjustment
    expect(settlement.amountPaid).toBe(500 + 65 - 10);
  });

  it('a zero settlement-level adjustment (or blank note) is omitted from the built settlement, not stored as noise', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview({ id: 's1', buyerId: 'r1', date: '2026-08-01', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '   ');
    expect(settlement.adjustmentAmount).toBeUndefined();
    expect(settlement.adjustmentNote).toBeUndefined();
  });

  it('buildSettlementFromReview with no edits matches building from settlementTotals directly (no double-accounting)', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview({ id: 's1', buyerId: 'r1', date: '2026-08-01', paymentMethod: 'cash', notes: '' }, dropOffs, lines, 0, '');
    const legacy = settlementTotals(dropOffs);
    expect(settlement.totalPurchaseFronted).toBe(legacy.cashFronted);
    expect(settlement.totalFees).toBe(legacy.totalFees);
    expect(settlement.amountPaid).toBe(legacy.amountToPay);
    expect(settlement.lineAdjustments).toBeUndefined();
  });
});

describe('settlementDirection / settlementDirectionLabel — stating the net direction in plain words', () => {
  it('a positive net amount means the store pays the device buyer', () => {
    expect(settlementDirection(150)).toBe('store_pays_buyer');
    expect(settlementDirectionLabel(150)).toBe('Store pays device buyer $150.00');
  });

  it('a negative net amount means the device buyer owes the store', () => {
    expect(settlementDirection(-40)).toBe('buyer_owes_store');
    expect(settlementDirectionLabel(-40)).toBe('Device buyer owes store $40.00');
  });

  it('a net amount at (or extremely near) zero reads as settled even, not as either direction', () => {
    expect(settlementDirection(0)).toBe('even');
    expect(settlementDirection(0.001)).toBe('even');
    expect(settlementDirectionLabel(0)).toBe('Settled even — no balance either way');
  });
});


const st = (p: Partial<Settlement>): Settlement => ({
  id: 's', buyerId: 'r1', date: '2026-07-05', dropOffIds: [],
  totalPurchaseFronted: 0, totalFees: 0, amountPaid: 0, notes: '', ...p,
});

describe('settlementFeeDirection — who owes the drop-off fee to whom', () => {
  it('an explicit feeDirection always wins, in both directions', () => {
    expect(settlementFeeDirection({ feeDirection: 'buyer_owes_store', amountPaid: 500 })).toBe('buyer_owes_store');
    expect(settlementFeeDirection({ feeDirection: 'store_pays_buyer', amountPaid: -500 })).toBe('store_pays_buyer');
  });

  it('a LEGACY record with no feeDirection derives it from the sign of amountPaid — no migration needed', () => {
    expect(settlementFeeDirection({ amountPaid: -40 })).toBe('buyer_owes_store');
    expect(settlementFeeDirection({ amountPaid: 250 })).toBe('store_pays_buyer');
  });

  it('a legacy zero-net settlement resolves to store_pays_buyer (contributes 0 either way)', () => {
    expect(settlementFeeDirection({ amountPaid: 0 })).toBe('store_pays_buyer');
  });
});

describe('settlementFeeTotals', () => {
  it('splits fees into collected (income) and paid (expense) and nets them', () => {
    const t = settlementFeeTotals([
      st({ id: 'a', totalFees: 50, amountPaid: -50 }),                                   // legacy, buyer owes
      st({ id: 'b', totalFees: 20, amountPaid: 220, feeDirection: 'store_pays_buyer' }),  // explicit, store pays
      st({ id: 'c', totalFees: 5, amountPaid: 5, feeDirection: 'buyer_owes_store' }),     // explicit wins over sign
    ]);
    expect(t.feesCollected).toBe(55); // 50 + 5
    expect(t.feesPaid).toBe(20);
    expect(t.netContribution).toBe(35);
  });

  it('is all-zero for no settlements', () => {
    expect(settlementFeeTotals([])).toEqual({ feesCollected: 0, feesPaid: 0, netContribution: 0 });
  });
});

describe('settlementDrawerEffect is UNCHANGED by the fee-direction work', () => {
  // Pinning the cash side explicitly: the task's premise is that the sign of
  // amountPaid was ALREADY correct here, which is exactly what makes deriving
  // a legacy record's fee direction from that sign safe.
  it('buyer owes the store → cash IN, store pays the buyer → cash OUT, in both explicit directions', () => {
    expect(settlementDrawerEffect({ paymentMethod: 'cash', amountPaid: -75 })).toEqual({ kind: 'cashIn', amount: 75 });
    expect(settlementDrawerEffect({ paymentMethod: 'cash', amountPaid: 75 })).toEqual({ kind: 'cashOut', amount: 75 });
  });

  it('agrees with settlementFeeDirection on which way a legacy settlement went', () => {
    const owes = st({ totalFees: 30, amountPaid: -30, paymentMethod: 'cash' });
    expect(settlementFeeDirection(owes)).toBe('buyer_owes_store');
    expect(settlementDrawerEffect(owes)?.kind).toBe('cashIn');

    const pays = st({ totalFees: 30, amountPaid: 230, paymentMethod: 'cash' });
    expect(settlementFeeDirection(pays)).toBe('store_pays_buyer');
    expect(settlementDrawerEffect(pays)?.kind).toBe('cashOut');
  });
});

describe('buildSettlementFromReview stamps an explicit feeDirection', () => {
  const dropOffs = [d({ id: '1', paidBy: 'runner', purchasePrice: 300, dropOffFee: 20 })];
  const lines = initSettlementReview(dropOffs);
  const base = { id: 'S-1', buyerId: 'r1', date: '2026-08-15', paymentMethod: 'cash' as const, notes: '' };

  it('a positive net records store_pays_buyer', () => {
    expect(buildSettlementFromReview(base, dropOffs, lines, 0, '').feeDirection).toBe('store_pays_buyer');
  });

  it('a negative net (a large deduction) records buyer_owes_store', () => {
    expect(buildSettlementFromReview(base, dropOffs, lines, -400, 'prior overpayment').feeDirection).toBe('buyer_owes_store');
  });
});

describe('withResolvedBuyerId — legacy runnerId normalization at the read boundary', () => {
  it('backfills buyerId from a legacy drop-off that only has runnerId', () => {
    const raw = { id: 'd1', runnerId: 'r7', item: 'iPhone', paidBy: 'runner', purchasePrice: 100, dropOffFee: 10 };
    expect(withResolvedBuyerId<DropOff>(raw as any).buyerId).toBe('r7');
  });

  it('backfills buyerId on a legacy settlement too', () => {
    const raw = { id: 's1', runnerId: 'r7', date: '2026-07-05', totalFees: 10, amountPaid: 10 };
    expect(withResolvedBuyerId<Settlement>(raw as any).buyerId).toBe('r7');
  });

  it('leaves an already-migrated record alone — an explicit buyerId always wins', () => {
    const raw = { id: 'd1', buyerId: 'new', runnerId: 'old' };
    expect(withResolvedBuyerId<DropOff>(raw as any).buyerId).toBe('new');
  });

  it('passes through a record with neither field rather than inventing one', () => {
    expect(withResolvedBuyerId<DropOff>({ id: 'd1' } as any).buyerId).toBeUndefined();
  });

  it('normalized legacy drop-offs then resolve to their buyer through the normal domain path', () => {
    // The end-to-end guarantee: no existing drop-off is orphaned by the rename.
    const legacy = [
      { id: '1', runnerId: 'r1', paidBy: 'runner', purchasePrice: 300, dropOffFee: 20, status: 'accepted' },
      { id: '2', runnerId: 'r1', paidBy: 'store', purchasePrice: 500, dropOffFee: 30, status: 'paidout' },
      { id: '3', runnerId: 'r2', paidBy: 'runner', purchasePrice: 999, dropOffFee: 99, status: 'accepted' },
    ].map(withResolvedBuyerId<DropOff>);
    const b = deviceBuyerBalance('r1', legacy);
    expect(b.count).toBe(2);
    expect(b.cashFronted).toBe(300);
    expect(b.feesOwed).toBe(50);
    expect(settleableDropOffs('r1', legacy).map(x => x.id)).toEqual(['1', '2']);
  });
});
