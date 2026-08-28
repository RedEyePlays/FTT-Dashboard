import { DropOff, Expense, Settlement } from '../types';

// Staff attribution for the six operational actions employees were granted
// (sales.void, sales.return, cash.reconcile, dropoffs.manage's accept +
// settle) — see services/rbac.ts. (The expense grant was later rolled back:
// expenses.add is owner/manager only.)
//
// WHY THIS MODULE EXISTS
// ----------------------
// The owner's decision was to trust employees with these actions rather than
// gate them behind a manager. Oversight then rests entirely on two things:
//
//   1. an audit entry (App.tsx's audit(), which stamps the acting user), and
//   2. the acting user being recorded ON THE RECORD ITSELF, so the void, the
//      drawer close, the payout and the expense each name a person without
//      having to cross-reference the audit log.
//
// Every stamper here takes the `actor` as its own argument, separate from the
// draft record, and applies it LAST. That ordering is the point: a draft that
// already carried a voidedBy/settledBy/enteredBy (a hand-crafted payload, a
// stale object, a replayed request) cannot override the identity the caller
// passes in. Callers must pass the AUTHENTICATED user — App.tsx passes
// `appUser`, which comes from the signed-in Firebase user's registry document,
// never from form state.
//
// Pure and side-effect free so each guarantee is unit-testable without
// Firestore — same convention as domain/pos.ts, domain/reports.ts, etc.

/** The authenticated acting user. Always the signed-in identity, never form input. */
export interface Actor {
  id: string;
  email: string;
}

/** The audit action string each of the six granted actions must emit. */
export const OPERATIONAL_AUDIT_ACTIONS = {
  void: 'sale.void',
  return: 'sale.return',
  reconcile: 'cash.reconcile',
  dropOffAccept: 'dropoff.accept',
  settle: 'dropoff.settle',
  expense: 'expense.create',
} as const;

export interface VoidStamp {
  voidedAt: number;
  voidedBy: string;
  voidedByEmail: string;
}
export const stampVoid = (actor: Actor, now: number): VoidStamp => ({
  voidedAt: now, voidedBy: actor.id, voidedByEmail: actor.email,
});

export interface ReturnStamp {
  returnedAt: number;
  returnedBy: string;
  returnedByEmail: string;
}
export const stampReturn = (actor: Actor, now: number): ReturnStamp => ({
  returnedAt: now, returnedBy: actor.id, returnedByEmail: actor.email,
});

export interface ReconcileStamp {
  reconciledAt: number;
  reconciledBy: string;
  reconciledByEmail: string;
}
export const stampReconcile = (actor: Actor, now: number): ReconcileStamp => ({
  reconciledAt: now, reconciledBy: actor.id, reconciledByEmail: actor.email,
});

/** Stamp the settling user onto a settlement draft (actor wins over the draft). */
export const stampSettlement = (settlement: Settlement, actor: Actor, now: number): Settlement => ({
  ...settlement,
  settledBy: actor.id, settledByEmail: actor.email, settledAt: now,
});

/** Stamp the accepting user onto a drop-off (actor wins over the draft). */
export const stampDropOffAccept = (dropOff: DropOff, actor: Actor, now: number): DropOff => ({
  ...dropOff,
  acceptedBy: actor.id, acceptedByEmail: actor.email, acceptedAt: now,
});

/** Stamp the entering user onto a new expense (actor wins over the draft). */
export const stampExpense = (expense: Expense, actor: Actor, now: number): Expense => ({
  ...expense,
  enteredBy: actor.id, enteredByEmail: actor.email, createdAt: now,
});
