import { describe, it, expect } from 'vitest';
import { runnerBalance, settleableDropOffs, settlementTotals, dropOffPurchaseCost, settlementDrawerEffect, dropOffAcceptDrawerEffect } from './dropoffs';
import { DropOff, DropOffStatus, PaidBy, Settlement } from '../types';

const d = (p: Partial<DropOff>): DropOff => ({
  id: 'd', runnerId: 'r1', item: 'iPhone', imei: '', sellerName: '', sellerContact: '',
  purchasePrice: 0, paidBy: 'runner' as PaidBy, dropOffFee: 0, dateDropped: '2026-07-01',
  status: 'accepted' as DropOffStatus, notes: '', ...p,
});

describe('runnerBalance', () => {
  it('sums fronted cash (runner-paid only) + all fees, ignoring rejected/settled', () => {
    const dropOffs: DropOff[] = [
      d({ id: '1', runnerId: 'r1', paidBy: 'runner', purchasePrice: 300, dropOffFee: 20, status: 'accepted' }),
      d({ id: '2', runnerId: 'r1', paidBy: 'store', purchasePrice: 500, dropOffFee: 30, status: 'paidout' }),   // store paid → no cash fronted, fee still owed
      d({ id: '3', runnerId: 'r1', paidBy: 'runner', purchasePrice: 100, dropOffFee: 10, status: 'rejected' }), // excluded
      d({ id: '4', runnerId: 'r1', paidBy: 'runner', purchasePrice: 200, dropOffFee: 15, status: 'settled' }),  // excluded
      d({ id: '5', runnerId: 'r2', paidBy: 'runner', purchasePrice: 999, dropOffFee: 99, status: 'accepted' }), // other runner
    ];
    const b = runnerBalance('r1', dropOffs);
    expect(b.cashFronted).toBe(300);      // only #1 (runner-paid, active)
    expect(b.feesOwed).toBe(50);          // #1 (20) + #2 (30)
    expect(b.net).toBe(350);              // 300 + 50
    expect(b.count).toBe(2);              // #1 and #2
  });

  it('is zero for a runner with no active drop-offs', () => {
    const b = runnerBalance('r9', [d({ runnerId: 'r1', purchasePrice: 100, dropOffFee: 10 })]);
    expect(b).toEqual({ cashFronted: 0, feesOwed: 0, net: 0, count: 0 });
  });
});

describe('settleableDropOffs', () => {
  it('includes only accepted/paid-out drop-offs for the runner', () => {
    const dropOffs: DropOff[] = [
      d({ id: '1', runnerId: 'r1', status: 'accepted' }),
      d({ id: '2', runnerId: 'r1', status: 'paidout' }),
      d({ id: '3', runnerId: 'r1', status: 'pending' }),   // excluded
      d({ id: '4', runnerId: 'r1', status: 'settled' }),   // excluded
      d({ id: '5', runnerId: 'r2', status: 'accepted' }),  // other runner
    ];
    expect(settleableDropOffs('r1', dropOffs).map(x => x.id)).toEqual(['1', '2']);
  });
});

describe('settlementTotals', () => {
  it('reimburses runner-fronted cash + all fees', () => {
    const set: DropOff[] = [
      d({ paidBy: 'runner', purchasePrice: 300, dropOffFee: 20 }),
      d({ paidBy: 'store', purchasePrice: 500, dropOffFee: 30 }),  // store paid → not reimbursed, fee still paid
      d({ paidBy: 'runner', purchasePrice: 150, dropOffFee: 10 }),
    ];
    const t = settlementTotals(set);
    expect(t.cashFronted).toBe(450);   // 300 + 150 (runner-paid only)
    expect(t.totalFees).toBe(60);      // 20 + 30 + 10
    expect(t.amountToPay).toBe(510);   // 450 + 60
  });

  it('is zero for an empty set', () => {
    expect(settlementTotals([])).toEqual({ cashFronted: 0, totalFees: 0, amountToPay: 0 });
  });
});

describe('dropOffPurchaseCost', () => {
  it('includes both the seller price AND the runner fee', () => {
    expect(dropOffPurchaseCost({ purchasePrice: 300, dropOffFee: 20 })).toBe(320);
  });

  it('matches what the settlement pays out for that device (no profit overstatement)', () => {
    // A single runner-paid drop-off: the device cost recorded on the inventory
    // item must equal the cash + fee the settlement pays the runner for it.
    const one = d({ paidBy: 'runner', purchasePrice: 300, dropOffFee: 20 });
    expect(dropOffPurchaseCost(one)).toBe(settlementTotals([one]).amountToPay);
  });

  it('treats missing amounts as zero', () => {
    expect(dropOffPurchaseCost({ purchasePrice: 0, dropOffFee: 0 })).toBe(0);
    expect(dropOffPurchaseCost({ purchasePrice: undefined as any, dropOffFee: undefined as any })).toBe(0);
  });
});

describe('settlementDrawerEffect', () => {
  it('a cash settlement paying the runner is cash OUT of the drawer', () => {
    expect(settlementDrawerEffect({ paymentMethod: 'cash', amountPaid: 250 })).toEqual({ kind: 'cashOut', amount: 250 });
  });

  it('a cash settlement where the runner owed the store (negative amountPaid) is cash IN', () => {
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

  it('a runner-paid drop-off never touches the drawer at accept — reimbursed later at settlement', () => {
    expect(dropOffAcceptDrawerEffect({ paidBy: 'runner', purchasePrice: 275 })).toBeNull();
  });

  it('produces no entry for a zero (or near-zero) store-paid purchase price', () => {
    expect(dropOffAcceptDrawerEffect({ paidBy: 'store', purchasePrice: 0 })).toBeNull();
    expect(dropOffAcceptDrawerEffect({ paidBy: 'store', purchasePrice: 0.001 })).toBeNull();
  });

  it('treats a missing purchase price as zero', () => {
    expect(dropOffAcceptDrawerEffect({ paidBy: 'store', purchasePrice: undefined as any })).toBeNull();
  });
});
