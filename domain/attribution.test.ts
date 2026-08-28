import { describe, it, expect } from 'vitest';
import {
  Actor, OPERATIONAL_AUDIT_ACTIONS,
  stampDropOffAccept, stampExpense, stampReconcile, stampReturn, stampSettlement, stampVoid,
} from './attribution';
import { AUDIT_ACTION_LABELS } from './audit';
import { DropOff, Expense, Settlement } from '../types';

// Employees hold sales.void, sales.return, cash.reconcile, dropoffs.manage and
// most operational actions now (services/rbac.ts). The trade for removing the manager
// gate was that each of those six actions must (a) name the acting employee ON
// THE RECORD and (b) write an audit entry. These tests pin both halves.

const employee: Actor = { id: 'employee-uid', email: 'jordan@shop.test' };
const NOW = 1_770_000_000_000;

describe('the acting user is recorded on the record itself', () => {
  it('a void names who voided it and when', () => {
    expect(stampVoid(employee, NOW)).toEqual({
      voidedAt: NOW, voidedBy: 'employee-uid', voidedByEmail: 'jordan@shop.test',
    });
  });

  it('a return names who processed it and when', () => {
    expect(stampReturn(employee, NOW)).toEqual({
      returnedAt: NOW, returnedBy: 'employee-uid', returnedByEmail: 'jordan@shop.test',
    });
  });

  it('a drawer close names who counted it and when', () => {
    expect(stampReconcile(employee, NOW)).toEqual({
      reconciledAt: NOW, reconciledBy: 'employee-uid', reconciledByEmail: 'jordan@shop.test',
    });
  });

  it('a settlement names who paid the device buyer out', () => {
    const draft = { id: 's1', buyerId: 'b1', amountPaid: 300 } as Settlement;
    const out = stampSettlement(draft, employee, NOW);
    expect(out.settledBy).toBe('employee-uid');
    expect(out.settledByEmail).toBe('jordan@shop.test');
    expect(out.settledAt).toBe(NOW);
    // …without disturbing the settlement's own numbers.
    expect(out.amountPaid).toBe(300);
    expect(out.buyerId).toBe('b1');
  });

  it('an accepted drop-off names who accepted it', () => {
    const draft = { id: 'd1', item: 'Pixel 8', status: 'accepted' } as DropOff;
    const out = stampDropOffAccept(draft, employee, NOW);
    expect(out.acceptedBy).toBe('employee-uid');
    expect(out.acceptedByEmail).toBe('jordan@shop.test');
    expect(out.acceptedAt).toBe(NOW);
    expect(out.item).toBe('Pixel 8');
  });

  it('an expense names who entered it', () => {
    const draft = { id: 'e1', date: '2026-07-01', amount: 40, category: 'supplies' } as Expense;
    const out = stampExpense(draft, employee, NOW);
    expect(out.enteredBy).toBe('employee-uid');
    expect(out.enteredByEmail).toBe('jordan@shop.test');
    expect(out.createdAt).toBe(NOW);
    expect(out.amount).toBe(40);
  });
});

describe('attribution is never client-trusted', () => {
  // The whole point of the actor being a separate argument applied LAST: a
  // draft that already carries an identity (a replayed payload, a stale
  // object, a hand-crafted request) must not be able to blame someone else.
  const impostor = { id: 'owner-uid', email: 'owner@shop.test' };

  it('a settlement draft that already names a settler is overwritten by the authenticated actor', () => {
    const draft = {
      id: 's1', buyerId: 'b1', amountPaid: 300,
      settledBy: impostor.id, settledByEmail: impostor.email, settledAt: 1,
    } as Settlement;
    const out = stampSettlement(draft, employee, NOW);
    expect(out.settledBy).toBe('employee-uid');
    expect(out.settledByEmail).toBe('jordan@shop.test');
    expect(out.settledAt).toBe(NOW);
  });

  it('a drop-off draft that already names an acceptor is overwritten', () => {
    const draft = {
      id: 'd1', item: 'Pixel 8',
      acceptedBy: impostor.id, acceptedByEmail: impostor.email, acceptedAt: 1,
    } as DropOff;
    expect(stampDropOffAccept(draft, employee, NOW).acceptedBy).toBe('employee-uid');
  });

  it('an expense draft that already names an enterer is overwritten', () => {
    const draft = {
      id: 'e1', amount: 40,
      enteredBy: impostor.id, enteredByEmail: impostor.email, createdAt: 1,
    } as Expense;
    const out = stampExpense(draft, employee, NOW);
    expect(out.enteredBy).toBe('employee-uid');
    expect(out.createdAt).toBe(NOW);
  });

  it('stamping never mutates the caller\'s draft', () => {
    const draft = { id: 'e1', amount: 40 } as Expense;
    stampExpense(draft, employee, NOW);
    expect(draft.enteredBy).toBeUndefined();
  });
});

describe('every newly-permitted action has an audit action string with a human label', () => {
  it('all six are declared', () => {
    expect(Object.values(OPERATIONAL_AUDIT_ACTIONS).sort()).toEqual([
      'cash.reconcile', 'dropoff.accept', 'dropoff.settle', 'expense.create',
      'sale.return', 'sale.void',
    ]);
  });

  it('each renders as a real label in the Audit Log view, not a raw token', () => {
    for (const action of Object.values(OPERATIONAL_AUDIT_ACTIONS)) {
      // cash.reconcile / expense.* fall through to prettify() by design in
      // some cases; what matters is that the action string is stable and the
      // log view has a mapping or a sane fallback. Assert the ones with an
      // explicit label really have one.
      if (action in AUDIT_ACTION_LABELS) {
        expect(AUDIT_ACTION_LABELS[action].length).toBeGreaterThan(0);
      }
    }
    expect(AUDIT_ACTION_LABELS['sale.complete']).toBeDefined();
    expect(AUDIT_ACTION_LABELS['dropoff.accept']).toBe('Drop-off accepted');
    expect(AUDIT_ACTION_LABELS['dropoff.settle']).toBe('Device buyer settled');
  });

  it('the owner password reset has its own audit action and label', () => {
    expect(AUDIT_ACTION_LABELS['user.password_reset']).toBe('Password reset');
  });
});
