import { describe, it, expect } from 'vitest';
import {
  openLayaways, layawayTotals, layawayAgeDays, isStaleLayaway, cashPortionOfPayment, applyBalancePayment, totalCollectedSoFar,
} from './layaway';
import { SalesTransaction, BalancePayment } from '../types';

const tx = (over: Partial<SalesTransaction> = {}): SalesTransaction => ({
  id: 't1', date: '2026-01-01', customerName: 'Jane', subtotal: 500, tax: 0, platformFee: 0,
  purchaseCost: 100, repairCost: 0, totalCost: 100, totalPaid: 500, netProfit: 400,
  lines: [], ...over,
});

describe('openLayaways / layawayTotals', () => {
  it('includes only non-reversed transactions with a balance owing', () => {
    const list = [
      tx({ id: 'a', balanceOwing: 200, deposit: 300 }),
      tx({ id: 'b' }), // fully paid, no balance
      tx({ id: 'c', balanceOwing: 100, status: 'voided' }),
      tx({ id: 'd', balanceOwing: 50, deposit: 450 }),
    ];
    const open = openLayaways(list);
    expect(open.map(t => t.id)).toEqual(['a', 'd']);
  });

  it('sums count and outstanding balance', () => {
    const list = [tx({ id: 'a', balanceOwing: 200 }), tx({ id: 'b', balanceOwing: 50.5 })];
    expect(layawayTotals(list)).toEqual({ count: 2, outstanding: 250.5 });
  });

  it('is zero for no open layaways', () => {
    expect(layawayTotals([tx()])).toEqual({ count: 0, outstanding: 0 });
  });
});

describe('layawayAgeDays / isStaleLayaway', () => {
  it('computes whole days since the sale date', () => {
    expect(layawayAgeDays({ date: '2026-01-01' }, '2026-01-31')).toBe(30);
    expect(layawayAgeDays({ date: '2026-01-01' }, '2026-01-01')).toBe(0);
  });

  it('flags a layaway at or past the threshold as stale', () => {
    expect(isStaleLayaway({ date: '2026-01-01' }, '2026-03-02', 60)).toBe(true); // 60 days
    expect(isStaleLayaway({ date: '2026-01-01' }, '2026-02-01', 60)).toBe(false); // 31 days
  });
});

describe('cashPortionOfPayment', () => {
  it('banks the whole amount for cash', () => {
    expect(cashPortionOfPayment({ paymentMethod: 'cash', amount: 100 })).toBe(100);
  });
  it('banks only the cash slice for mixed', () => {
    expect(cashPortionOfPayment({ paymentMethod: 'mixed', amount: 100, cashAmount: 40 })).toBe(40);
  });
  it('banks nothing for card or e-transfer', () => {
    expect(cashPortionOfPayment({ paymentMethod: 'card', amount: 100 })).toBe(0);
    expect(cashPortionOfPayment({ paymentMethod: 'etransfer', amount: 100 })).toBe(0);
  });
});

const payment = (over: Partial<BalancePayment> = {}): BalancePayment => ({
  id: 'p1', amount: 100, paymentMethod: 'cash', date: '2026-02-01', at: 1000, ...over,
});

describe('applyBalancePayment', () => {
  it('reduces the balance on a partial payment, keeping the sale open — deposit stays frozen', () => {
    const t = tx({ balanceOwing: 300, deposit: 200 });
    const { transaction, fullyPaid } = applyBalancePayment(t, payment({ amount: 100 }));
    expect(fullyPaid).toBe(false);
    expect(transaction.balanceOwing).toBe(200);
    // deposit is NOT bumped — see applyBalancePayment's doc comment: mutating
    // it would retroactively inflate the original sale date's already-
    // reconciled expected cash once domain/reports.ts recomputes it.
    expect(transaction.deposit).toBe(200);
    expect(transaction.balancePayments).toHaveLength(1);
    expect(transaction.layawayCompletedAt).toBeUndefined();
  });

  it('clears the balance and marks fullyPaid when the payment covers exactly what remains', () => {
    const t = tx({ balanceOwing: 100, deposit: 400 });
    const { transaction, fullyPaid } = applyBalancePayment(t, payment({ amount: 100, at: 5000 }));
    expect(fullyPaid).toBe(true);
    expect(transaction.balanceOwing).toBeUndefined();
    expect(transaction.deposit).toBe(400); // still frozen at the original checkout amount
    expect(transaction.layawayCompletedAt).toBe(5000);
  });

  it('clamps an overpayment to the remaining balance rather than going negative', () => {
    const t = tx({ balanceOwing: 50, deposit: 450 });
    const { transaction, fullyPaid } = applyBalancePayment(t, payment({ amount: 500 }));
    expect(fullyPaid).toBe(true);
    expect(transaction.balancePayments![0].amount).toBe(50); // the stored record reflects the clamp
  });

  it('appends to existing balancePayments rather than replacing them', () => {
    const t = tx({ balanceOwing: 200, deposit: 300, balancePayments: [payment({ id: 'p0', amount: 50 })] });
    const { transaction } = applyBalancePayment(t, payment({ id: 'p1', amount: 100 }));
    expect(transaction.balancePayments!.map(p => p.id)).toEqual(['p0', 'p1']);
  });

  it('does not overwrite an already-stamped layawayCompletedAt on a later (redundant) call', () => {
    const t = tx({ balanceOwing: 0, deposit: 500, layawayCompletedAt: 1234 });
    const { transaction } = applyBalancePayment(t, payment({ amount: 0, at: 9999 }));
    expect(transaction.layawayCompletedAt).toBe(1234);
  });
});

describe('totalCollectedSoFar', () => {
  it('is the full total for a sale that was never a layaway', () => {
    expect(totalCollectedSoFar(tx({ totalPaid: 500 }))).toBe(500);
  });

  it('is deposit + partial payments while a layaway is still open', () => {
    const t = tx({ deposit: 200, balanceOwing: 200, balancePayments: [payment({ amount: 100 })] });
    expect(totalCollectedSoFar(t)).toBe(300);
  });

  it('is the full total once a layaway is fully paid off (balanceOwing cleared)', () => {
    const t = tx({ totalPaid: 500, deposit: 200, balancePayments: [payment({ amount: 300 })] }); // balanceOwing absent = paid off
    expect(totalCollectedSoFar(t)).toBe(500);
  });
});
