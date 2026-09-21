import { Role } from '../types';
import { can } from '../services/rbac';

/**
 * WHICH COLLECTIONS A ROLE MAY ACTUALLY SUBSCRIBE TO, and what to do when a
 * subscription is refused.
 *
 * THE BUG: opening Drop-Offs, Time Clock or Reports enabled the deferred
 * subscriptions, which then attached listeners to ALL of dropOffs,
 * settlements, timeEntries, payPeriods, payPeriodApprovals, staffBonuses and
 * kioskStaff regardless of role. An employee may not read the last two, so
 * Firestore rejected those listeners, the shared error handler called
 * setDbError, and App swapped the ENTIRE app for "Couldn't reach the
 * database". It was never a connection problem — it was a permission denial
 * wearing the wrong message. Owners never saw it, which is why it went
 * unnoticed.
 *
 * Two rules come out of that, and this module holds both:
 *
 *   1. Don't attach a listener the rules will refuse. The gate mirrors
 *      firestore.rules via services/rbac.ts's `can`, not role strings
 *      sprinkled inline, so the two can be compared.
 *   2. A refusal on ONE optional collection must never take down the whole
 *      app. Permission-denied leaves that collection empty and carries on.
 *
 * Pure: no Firestore, no DOM.
 */

/** The deferred (extended) collections, and who firestore.rules lets read each. */
export type DeferredCollection =
  | 'dropOffs' | 'settlements' | 'timeEntries'
  | 'payPeriods' | 'payPeriodApprovals' | 'staffBonuses' | 'kioskStaff';

/**
 * May this role subscribe to this collection?
 *
 * Mirrors firestore.rules exactly:
 *
 *   dropOffs           activeMemberOf              → every human role
 *   settlements        activeMemberOf              → every human role
 *   timeEntries        activeMemberOf (+ kiosk)    → every human role
 *   payPeriods         activeMemberOf              → every human role
 *   payPeriodApprovals activeMemberOf              → every human role
 *   staffBonuses       isManagerUp (+ own rows)    → owner / manager
 *   kioskStaff         isManagerUp (+ the kiosk)   → owner / manager
 *
 * The two manager-up ones map to `payroll.manage`, which services/rbac.ts
 * grants to exactly owner and manager — the same pair `isManagerUp` names.
 *
 * ON staffBonuses AND AN EMPLOYEE'S OWN ROWS: the rule also allows a member to
 * read a bonus whose userId is theirs, but a COLLECTION-WIDE list is evaluated
 * against every document it would return, so an employee's unfiltered listen
 * is refused regardless. Subscribing them to nothing is therefore the honest
 * equivalent, and domain/bonuses.ts's visibleBonuses already filters what they
 * would be shown. A self-scoped query could be added later; it is not what
 * broke here.
 *
 * The KIOSK device is excluded from every one of these: it has its own
 * subscription path (kioskStaff + a bounded timeEntries read) and must never
 * pick up the dashboard's set.
 */
export const canSubscribeTo = (role: Role | undefined, coll: DeferredCollection): boolean => {
  if (!role || role === 'kiosk') return false;
  if (coll === 'staffBonuses' || coll === 'kioskStaff') return can(role, 'payroll.manage');
  return true;
};

/** The deferred collections this role should actually attach listeners for. */
export const deferredCollectionsFor = (role: Role | undefined): DeferredCollection[] =>
  ([
    'dropOffs', 'settlements', 'timeEntries',
    'payPeriods', 'payPeriodApprovals', 'staffBonuses', 'kioskStaff',
  ] as DeferredCollection[]).filter(c => canSubscribeTo(role, c));

/* ---------------- Classifying a failure ---------------- */

/**
 * Is this a permission refusal rather than a connectivity problem?
 *
 * Firestore reports it as `code: 'permission-denied'`; the message is checked
 * too because the SDK is not consistent about surfacing the code on every
 * listener error path.
 */
export const isPermissionDenied = (e: unknown): boolean => {
  const code = String((e as { code?: unknown })?.code ?? '');
  const message = String((e as { message?: unknown })?.message ?? '');
  return /permission[-_ ]denied|insufficient permissions|missing or insufficient/i.test(`${code} ${message}`);
};

export type SubscriptionFailure =
  /** Leave the collection empty and carry on — the app stays up. */
  | 'ignore'
  /** Show the error screen. */
  | 'fatal';

/**
 * What to do when a subscription fails.
 *
 * A permission denial on an OPTIONAL collection is never fatal: the rest of
 * the app works perfectly well without that data, and blanking the whole
 * screen over it is what turned a missing bonus list into "Couldn't reach the
 * database" for every employee who opened Drop-Offs.
 *
 * A permission denial on a CORE collection is still not a connectivity
 * problem, so it is reported as what it is — see dbErrorMessage.
 */
export const failureAction = (e: unknown, optional: boolean): SubscriptionFailure =>
  optional && isPermissionDenied(e) ? 'ignore' : 'fatal';

/* ---------------- What the error screen says ---------------- */

export interface DbError {
  /** 'permission' or 'connection' — the screen's heading follows this. */
  kind: 'permission' | 'connection';
  message: string;
}

export const CONNECTION_HEADING = "Couldn't reach the database";
export const PERMISSION_HEADING = "You don't have access to that";

/**
 * The heading and the detail must match the CAUSE.
 *
 * "Couldn't reach the database" sent people to check their wifi over a
 * permission denial. A message that misnames the problem costs more time than
 * no message at all.
 */
export const dbErrorFor = (e: unknown): DbError =>
  isPermissionDenied(e)
    ? {
      kind: 'permission',
      message: 'Your account is not allowed to read some of this data. Ask the owner to check your role — this is not a connection problem.',
    }
    : {
      kind: 'connection',
      message: String((e as { message?: unknown })?.message ?? '') || 'Failed to load data',
    };

export const dbErrorHeading = (kind: DbError['kind']): string =>
  kind === 'permission' ? PERMISSION_HEADING : CONNECTION_HEADING;
