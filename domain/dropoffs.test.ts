import { describe, it, expect } from 'vitest';
import {
  deviceBuyerOutstanding, settleableDropOffs, settlementTotals, settlementDrawerEffect, dropOffAcceptDrawerEffect,
  initSettlementReview, settlementReviewTotals, buildLineAdjustments, buildSettlementFromReview,
  settlementOwedLabel, legacySettlementDirection, legacySettlementDirectionLabel, isLegacySettlement,
  principalFunder, withResolvedBuyerId,
} from './dropoffs';
import { DropOff, DropOffStatus, PaidBy, Settlement } from '../types';

const d = (p: Partial<DropOff>): DropOff => ({
  id: 'd', buyerId: 'r1', item: 'iPhone', imei: '', sellerName: '', sellerContact: '',
  purchasePrice: 0, paidBy: 'runner' as PaidBy, dropOffFee: 0, dateDropped: '2026-07-01',
  status: 'accepted' as DropOffStatus, notes: '', ...p,
});

const base = { id: 's1', buyerId: 'r1', date: '2026-08-01', paymentMethod: 'cash' as const, notes: '' };

// The canonical example from the owner: the store pays $100 for an XR the
// device buyer keeps, and charges a $20 service fee. The buyer owes $120.
const XR = d({ id: 'xr', paidBy: 'store', purchasePrice: 100, dropOffFee: 20, status: 'accepted' });

describe('principalFunder — whose cash actually bought the device', () => {
  it('maps the stored paidBy values onto store / owner / buyer funding', () => {
    expect(principalFunder({ paidBy: 'store' })).toBe('store');
    expect(principalFunder({ paidBy: 'personal' })).toBe('personal');
    expect(principalFunder({ paidBy: 'runner' })).toBe('buyer'); // legacy stored value
  });
});

describe('deviceBuyerOutstanding — what the buyer owes the store right now', () => {
  it('store-funded principal is owed back, buyer-funded is not, and every fee is owed', () => {
    const dropOffs: DropOff[] = [
      d({ id: '1', paidBy: 'runner', purchasePrice: 300, dropOffFee: 20, status: 'accepted' }), // his own money → no principal
      d({ id: '2', paidBy: 'store', purchasePrice: 500, dropOffFee: 30, status: 'paidout' }),   // store advanced $500
      d({ id: '3', paidBy: 'store', purchasePrice: 100, dropOffFee: 10, status: 'rejected' }),  // excluded
      d({ id: '4', paidBy: 'store', purchasePrice: 200, dropOffFee: 15, status: 'settled' }),   // excluded — already collected
      d({ id: '5', buyerId: 'r2', paidBy: 'store', purchasePrice: 999, dropOffFee: 99 }),       // other buyer
    ];
    const o = deviceBuyerOutstanding('r1', dropOffs);
    expect(o.principalStoreFunded).toBe(500);
    expect(o.principalPersonalFunded).toBe(0);
    expect(o.principalOwed).toBe(500);
    expect(o.feesOwed).toBe(50);   // 20 + 30
    expect(o.totalOwed).toBe(550);
    expect(o.count).toBe(2);
  });

  it('owner-funded principal is still owed by the buyer, tracked separately from store cash', () => {
    const o = deviceBuyerOutstanding('r1', [d({ id: '1', paidBy: 'personal', purchasePrice: 100, dropOffFee: 20 })]);
    expect(o.principalPersonalFunded).toBe(100);
    expect(o.principalStoreFunded).toBe(0);
    expect(o.principalOwed).toBe(100);
    expect(o.totalOwed).toBe(120);
  });

  it('is zero for a buyer with nothing outstanding', () => {
    expect(deviceBuyerOutstanding('nobody', [])).toEqual({
      principalStoreFunded: 0, principalPersonalFunded: 0, principalOwed: 0,
      feesOwed: 0, totalOwed: 0, count: 0,
    });
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

  // Regression for the double-settlement bug (now: the buyer being billed and
  // collected from twice): settling must actually flip every included drop-off
  // to 'settled' (services/firestoreDb.ts's settleDeviceBuyer does this
  // atomically alongside the settlement save), or the same drop-offs stay
  // eligible for a second settlement. The guard survives the financing rework.
  it('drop-offs marked settled after a settlement can never be settled a second time', () => {
    const before: DropOff[] = [
      d({ id: '1', buyerId: 'r1', status: 'accepted' }),
      d({ id: '2', buyerId: 'r1', status: 'paidout' }),
    ];
    expect(settleableDropOffs('r1', before).map(x => x.id)).toEqual(['1', '2']);

    const settledIds = new Set(['1', '2']);
    const after: DropOff[] = before.map(x =>
      settledIds.has(x.id) ? { ...x, status: 'settled' as DropOffStatus, settlementId: 'settlement-1' } : x
    );

    expect(settleableDropOffs('r1', after)).toEqual([]);
    // ...and nothing is left outstanding for that buyer either.
    expect(deviceBuyerOutstanding('r1', after).totalOwed).toBe(0);
  });
});

describe('settlementTotals — the buyer owes the store, principal and fee kept apart', () => {
  it('store-funded $100 device + $20 fee → the buyer owes $120', () => {
    const t = settlementTotals([XR]);
    expect(t.principalOwed).toBe(100);
    expect(t.feesOwed).toBe(20);
    expect(t.totalOwed).toBe(120);
    expect(t.storeCashIn).toBe(120); // all of it is the store's money
  });

  it('buyer-funded device + $20 fee → the buyer owes the $20 fee only', () => {
    const t = settlementTotals([d({ paidBy: 'runner', purchasePrice: 100, dropOffFee: 20 })]);
    expect(t.principalOwed).toBe(0);
    expect(t.feesOwed).toBe(20);
    expect(t.totalOwed).toBe(20);
    expect(t.storeCashIn).toBe(20);
  });

  it('owner-funded: the buyer owes principal + fee, but only the fee is store cash', () => {
    const t = settlementTotals([d({ paidBy: 'personal', purchasePrice: 100, dropOffFee: 20 })]);
    expect(t.principalOwed).toBe(100);
    expect(t.principalPersonalFunded).toBe(100);
    expect(t.totalOwed).toBe(120);
    expect(t.storeCashIn).toBe(20); // the $100 repays the owner, not the till
  });

  it('is zero for an empty set', () => {
    const t = settlementTotals([]);
    expect(t.totalOwed).toBe(0);
    expect(t.storeCashIn).toBe(0);
    expect(t.deviceCount).toBe(0);
  });
});

describe('settlementDrawerEffect — cash comes IN when a buyer settles up', () => {
  it('a cash settlement collects storeCashIn into the drawer', () => {
    const s = buildSettlementFromReview(base, [XR], initSettlementReview([XR]), 0, '');
    expect(settlementDrawerEffect(s)).toEqual({ kind: 'cashIn', amount: 120 });
  });

  it('owner-funded principal never enters the till — only the fee does', () => {
    const dropOffs = [d({ id: 'p', paidBy: 'personal', purchasePrice: 100, dropOffFee: 20 })];
    const s = buildSettlementFromReview(base, dropOffs, initSettlementReview(dropOffs), 0, '');
    expect(s.amountOwed).toBe(120);
    expect(settlementDrawerEffect(s)).toEqual({ kind: 'cashIn', amount: 20 });
  });

  it('e-transfer and other payment methods never touch the drawer, regardless of amount', () => {
    const s = buildSettlementFromReview({ ...base, paymentMethod: 'etransfer' }, [XR], initSettlementReview([XR]), 0, '');
    expect(settlementDrawerEffect(s)).toBeNull();
  });

  it('produces no entry for a zero (or near-zero) collection', () => {
    expect(settlementDrawerEffect({ model: 'financing', storeCashIn: 0, paymentMethod: 'cash' })).toBeNull();
    expect(settlementDrawerEffect({ model: 'financing', storeCashIn: 0.004, paymentMethod: 'cash' })).toBeNull();
  });

  it('a settlement-level credit larger than everything owed pushes cash back OUT', () => {
    expect(settlementDrawerEffect({ model: 'financing', storeCashIn: -30, paymentMethod: 'cash' }))
      .toEqual({ kind: 'cashOut', amount: 30 });
  });

  // Historical records are read exactly as they were written — no migration,
  // no reinterpretation (same no-migration pattern as buyerId ← runnerId).
  it('a LEGACY settlement keeps its original meaning: positive amountPaid was cash OUT', () => {
    expect(settlementDrawerEffect({ amountPaid: 320, paymentMethod: 'cash' })).toEqual({ kind: 'cashOut', amount: 320 });
    expect(settlementDrawerEffect({ amountPaid: -40, paymentMethod: 'cash' })).toEqual({ kind: 'cashIn', amount: 40 });
  });

  it('a legacy settlement with no paymentMethod recorded defaults to cash (prior behavior)', () => {
    expect(settlementDrawerEffect({ amountPaid: 100 })).toEqual({ kind: 'cashOut', amount: 100 });
  });
});

describe('dropOffAcceptDrawerEffect', () => {
  it('a store-funded drop-off advances cash out of the till on accept', () => {
    expect(dropOffAcceptDrawerEffect({ paidBy: 'store', purchasePrice: 100 })).toEqual({ kind: 'cashOut', amount: 100 });
  });

  it('a buyer-funded drop-off never touches the drawer — it was his own money', () => {
    expect(dropOffAcceptDrawerEffect({ paidBy: 'runner', purchasePrice: 500 })).toBeNull();
  });

  it('an owner-funded drop-off never touches the drawer either', () => {
    expect(dropOffAcceptDrawerEffect({ paidBy: 'personal', purchasePrice: 500 })).toBeNull();
  });

  it('produces no entry for a zero (or near-zero) store-funded purchase price', () => {
    expect(dropOffAcceptDrawerEffect({ paidBy: 'store', purchasePrice: 0 })).toBeNull();
    expect(dropOffAcceptDrawerEffect({ paidBy: 'store', purchasePrice: 0.004 })).toBeNull();
  });
});

// The end-to-end money question: across accept-then-settle, how much better
// off is the till? Exactly the service fee — never the device price.
describe('net drawer effect across accept + settle', () => {
  const netDrawer = (dropOff: DropOff): number => {
    const accept = dropOffAcceptDrawerEffect(dropOff);
    const settlement = buildSettlementFromReview(base, [dropOff], initSettlementReview([dropOff]), 0, '');
    const settle = settlementDrawerEffect(settlement);
    const signed = (e: { kind: string; amount: number } | null) => (e ? (e.kind === 'cashIn' ? e.amount : -e.amount) : 0);
    return Math.round((signed(accept) + signed(settle)) * 100) / 100;
  };

  it('store-funded $100 device + $20 fee: −$100 at accept, +$120 at settle, net +$20', () => {
    expect(dropOffAcceptDrawerEffect(XR)).toEqual({ kind: 'cashOut', amount: 100 });
    expect(netDrawer(XR)).toBe(20);
  });

  it('buyer-funded: no movement at accept, +$20 at settle, net +$20', () => {
    const buyerFunded = d({ paidBy: 'runner', purchasePrice: 100, dropOffFee: 20 });
    expect(dropOffAcceptDrawerEffect(buyerFunded)).toBeNull();
    expect(netDrawer(buyerFunded)).toBe(20);
  });

  it('owner-funded: no movement at accept, +$20 (fee only) at settle, net +$20', () => {
    const ownerFunded = d({ paidBy: 'personal', purchasePrice: 100, dropOffFee: 20 });
    expect(dropOffAcceptDrawerEffect(ownerFunded)).toBeNull();
    expect(netDrawer(ownerFunded)).toBe(20);
  });
});

describe('pre-settlement review — editable per-device fees, exclusion, totals', () => {
  const dropOffs: DropOff[] = [
    d({ id: '1', item: 'iPhone 13', purchasePrice: 300, dropOffFee: 20, paidBy: 'runner', status: 'accepted' }),
    d({ id: '2', item: 'iPhone 14', purchasePrice: 500, dropOffFee: 30, paidBy: 'store', status: 'paidout' }),
    d({ id: '3', item: 'Pixel 8', purchasePrice: 200, dropOffFee: 15, paidBy: 'runner', status: 'accepted' }),
  ];

  it('initSettlementReview seeds one included, unedited line per drop-off', () => {
    expect(initSettlementReview(dropOffs)).toEqual([
      { dropOffId: '1', included: true, fee: 20 },
      { dropOffId: '2', included: true, fee: 30 },
      { dropOffId: '3', included: true, fee: 15 },
    ]);
  });

  it('unedited review totals are exactly settlementTotals (one implementation, no drift)', () => {
    expect(settlementReviewTotals(dropOffs, initSettlementReview(dropOffs), 0)).toEqual(settlementTotals(dropOffs));
  });

  it('editing a per-device fee updates the totals live', () => {
    const lines = initSettlementReview(dropOffs);
    lines[0].fee = 25; // was 20 — a $5 correction
    const totals = settlementReviewTotals(dropOffs, lines, 0);
    expect(totals.feesOwed).toBe(70);      // 25 + 30 + 15
    expect(totals.principalOwed).toBe(500); // only #2 was store-funded
    expect(totals.totalOwed).toBe(570);
  });

  it('editing a per-device fee is recorded as a line adjustment (original vs adjusted)', () => {
    const lines = initSettlementReview(dropOffs);
    lines[0].fee = 25;
    expect(buildLineAdjustments(dropOffs, lines)).toEqual([{ dropOffId: '1', originalFee: 20, adjustedFee: 25 }]);
  });

  it('leaving every fee untouched produces no adjustments', () => {
    expect(buildLineAdjustments(dropOffs, initSettlementReview(dropOffs))).toEqual([]);
  });

  it('excluding a line removes it from totals and from the built settlement\'s dropOffIds, without altering the drop-off itself', () => {
    const lines = initSettlementReview(dropOffs);
    lines[1].included = false; // exclude #2 (store-funded $500, fee 30)
    const totals = settlementReviewTotals(dropOffs, lines, 0);
    expect(totals.deviceCount).toBe(2);
    expect(totals.feesOwed).toBe(35);      // 20 + 15
    expect(totals.principalOwed).toBe(0);  // the only store-funded line is gone
    const settlement = buildSettlementFromReview(base, dropOffs, lines, 0, '');
    expect(settlement.dropOffIds).toEqual(['1', '3']); // #2 stays unsettled, eligible later
  });

  it('an excluded line produces no adjustment entry even if its fee was also edited before being excluded', () => {
    const lines = initSettlementReview(dropOffs);
    lines[1].fee = 999;
    lines[1].included = false;
    expect(buildLineAdjustments(dropOffs, lines)).toEqual([]);
  });

  it('a settlement-level adjustment folds into what the buyer owes and is kept with its note', () => {
    const lines = initSettlementReview(dropOffs);
    const settlement = buildSettlementFromReview(base, dropOffs, lines, -10, 'Agreed $10 credit for a late drop-off');
    expect(settlement.adjustmentAmount).toBe(-10);
    expect(settlement.adjustmentNote).toBe('Agreed $10 credit for a late drop-off');
    expect(settlement.principalOwed).toBe(500);
    expect(settlement.totalFees).toBe(65);
    expect(settlement.amountOwed).toBe(500 + 65 - 10);
    expect(settlement.storeCashIn).toBe(500 + 65 - 10);
  });

  it('a zero settlement-level adjustment (or blank note) is omitted from the built settlement, not stored as noise', () => {
    const settlement = buildSettlementFromReview(base, dropOffs, initSettlementReview(dropOffs), 0, '   ');
    expect(settlement.adjustmentAmount).toBeUndefined();
    expect(settlement.adjustmentNote).toBeUndefined();
  });

  it('buildSettlementFromReview stamps the financing model and never writes the legacy fields', () => {
    const settlement = buildSettlementFromReview(base, [XR], initSettlementReview([XR]), 0, '');
    expect(settlement.model).toBe('financing');
    expect(isLegacySettlement(settlement)).toBe(false);
    expect(settlement.principalOwed).toBe(100);
    expect(settlement.totalFees).toBe(20);
    expect(settlement.amountOwed).toBe(120);
    expect(settlement.totalPurchaseFronted).toBeUndefined();
    expect(settlement.amountPaid).toBeUndefined();
  });
});

describe('settlementOwedLabel — plain words on the page the buyer signs', () => {
  it('states that the buyer owes the store', () => {
    expect(settlementOwedLabel(120)).toBe('Device buyer owes store $120.00');
  });

  it('reads as even at (or extremely near) zero', () => {
    expect(settlementOwedLabel(0)).toBe('Settled even — no balance either way');
    expect(settlementOwedLabel(0.001)).toBe('Settled even — no balance either way');
  });

  it('only a credit bigger than what is owed reverses it', () => {
    expect(settlementOwedLabel(-40)).toBe('Store owes device buyer $40.00');
  });
});

describe('legacy settlements are recognised and described as originally recorded', () => {
  const legacy: Settlement = {
    id: 's-old', buyerId: 'r1', date: '2026-07-05', dropOffIds: ['1'],
    totalPurchaseFronted: 300, totalFees: 20, amountPaid: 320, notes: '',
  };

  it('a record with no model is legacy; one built today is not', () => {
    expect(isLegacySettlement(legacy)).toBe(true);
    expect(isLegacySettlement(buildSettlementFromReview(base, [XR], initSettlementReview([XR]), 0, ''))).toBe(false);
  });

  it('describes a legacy record in the past tense, as it was recorded', () => {
    expect(legacySettlementDirection(legacy.amountPaid)).toBe('store_pays_buyer');
    expect(legacySettlementDirectionLabel(320)).toBe('Store paid device buyer $320.00');
    expect(legacySettlementDirectionLabel(-40)).toBe('Device buyer owed store $40.00');
    expect(legacySettlementDirectionLabel(0)).toBe('Settled even — no balance either way');
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
    const legacy = [
      { id: '1', runnerId: 'r1', paidBy: 'runner', purchasePrice: 300, dropOffFee: 20, status: 'accepted' },
      { id: '2', runnerId: 'r1', paidBy: 'store', purchasePrice: 500, dropOffFee: 30, status: 'paidout' },
      { id: '3', runnerId: 'r2', paidBy: 'runner', purchasePrice: 999, dropOffFee: 99, status: 'accepted' },
    ].map(withResolvedBuyerId<DropOff>);
    const o = deviceBuyerOutstanding('r1', legacy);
    expect(o.count).toBe(2);
    expect(o.principalOwed).toBe(500);
    expect(o.feesOwed).toBe(50);
    expect(settleableDropOffs('r1', legacy).map(x => x.id)).toEqual(['1', '2']);
  });
});
