import { describe, it, expect } from 'vitest';
import { Role } from '../types';
import {
  canSubscribeTo, deferredCollectionsFor, isPermissionDenied, failureAction,
  dbErrorFor, dbErrorHeading, CONNECTION_HEADING, PERMISSION_HEADING,
  DeferredCollection, CORE_COLLECTIONS, isCoreCollection, sectionUnavailableNotice,
} from './subscriptionAccess';

// THE BUG: opening Drop-Offs, Time Clock or Reports subscribed to ALL the
// deferred collections regardless of role. An employee may not read
// staffBonuses or kioskStaff, so Firestore rejected those listeners and the
// shared handler swapped the ENTIRE app for "Couldn't reach the database".
// It was never a connection problem — it was a permission denial wearing the
// wrong message. Owners never saw it, which is why it went unnoticed.

const EMPLOYEE_SAFE: DeferredCollection[] =
  ['dropOffs', 'settlements', 'timeEntries', 'payPeriods', 'payPeriodApprovals'];

describe('only subscribe to what the rules allow', () => {
  it('an EMPLOYEE gets the five they can read, and neither of the two they cannot', () => {
    expect(deferredCollectionsFor('employee')).toEqual(EMPLOYEE_SAFE);
    expect(canSubscribeTo('employee', 'staffBonuses')).toBe(false);
    expect(canSubscribeTo('employee', 'kioskStaff')).toBe(false);
  });

  it('a TECHNICIAN is treated the same way', () => {
    expect(deferredCollectionsFor('technician')).toEqual(EMPLOYEE_SAFE);
  });

  it('a MANAGER still gets both of the manager-up collections', () => {
    expect(canSubscribeTo('manager', 'staffBonuses')).toBe(true);
    expect(canSubscribeTo('manager', 'kioskStaff')).toBe(true);
    expect(deferredCollectionsFor('manager')).toHaveLength(7);
  });

  it('an OWNER gets everything', () => {
    expect(deferredCollectionsFor('owner')).toHaveLength(7);
  });

  it('the KIOSK device gets NONE of them — it has its own path', () => {
    // It must never pick up the dashboard's subscription set.
    expect(deferredCollectionsFor('kiosk')).toEqual([]);
    expect(canSubscribeTo('kiosk', 'timeEntries')).toBe(false);
  });

  it('no role at all subscribes to nothing, rather than defaulting open', () => {
    expect(deferredCollectionsFor(undefined)).toEqual([]);
  });

  it('the gate matches firestore.rules: exactly owner and manager on the two', () => {
    // staffBonuses  → isManagerUp (+ own rows)
    // kioskStaff    → isManagerUp (+ the kiosk device)
    for (const coll of ['staffBonuses', 'kioskStaff'] as DeferredCollection[]) {
      const allowed = (['owner', 'manager', 'employee', 'technician', 'kiosk'] as Role[])
        .filter(r => canSubscribeTo(r, coll));
      expect(allowed).toEqual(['owner', 'manager']);
    }
  });
});

describe('telling a permission denial from a dropped connection', () => {
  it('recognises what Firestore actually reports', () => {
    expect(isPermissionDenied({ code: 'permission-denied', message: 'x' })).toBe(true);
    expect(isPermissionDenied({ message: 'Missing or insufficient permissions.' })).toBe(true);
    expect(isPermissionDenied({ code: 'firestore/permission-denied' })).toBe(true);
  });

  it('does not mistake a real connectivity failure for one', () => {
    expect(isPermissionDenied({ code: 'unavailable', message: 'client is offline' })).toBe(false);
    expect(isPermissionDenied(new Error('Failed to get document because the client is offline'))).toBe(false);
    expect(isPermissionDenied(undefined)).toBe(false);
  });
});

describe('one refused subscription must not take down the app', () => {
  const denied = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };
  const offline = { code: 'unavailable', message: 'client is offline' };

  it('a permission denial on an OPTIONAL collection is ignored', () => {
    // The rest of the app works perfectly well without that data.
    expect(failureAction(denied, true)).toBe('ignore');
  });

  it('but a CONNECTIVITY failure on the same collection still reports', () => {
    expect(failureAction(offline, true)).toBe('fatal');
  });

  it('and a denial on a CORE collection is never ignored', () => {
    expect(failureAction(denied, false)).toBe('fatal');
  });
});

describe('the message matches the cause', () => {
  it('a permission denial does NOT say the database was unreachable', () => {
    // That heading sent people to check their wifi over a role problem, which
    // costs more time than no message at all.
    const e = dbErrorFor({ code: 'permission-denied', message: 'Missing or insufficient permissions.' });
    expect(e.kind).toBe('permission');
    expect(dbErrorHeading(e.kind)).toBe(PERMISSION_HEADING);
    expect(dbErrorHeading(e.kind)).not.toBe(CONNECTION_HEADING);
    expect(e.message).toMatch(/not a connection problem/i);
    expect(e.message).toMatch(/role/i);
  });

  it('a connectivity failure keeps the original heading and the real error', () => {
    const e = dbErrorFor({ code: 'unavailable', message: 'client is offline' });
    expect(e.kind).toBe('connection');
    expect(dbErrorHeading(e.kind)).toBe(CONNECTION_HEADING);
    expect(e.message).toBe('client is offline');
  });

  it('an error with no message at all still says something', () => {
    expect(dbErrorFor({}).message).toBe('Failed to load data');
  });
});

/**
 * THE SAME BUG, ONE LAYER UP. The day PR #209 shipped, EVERY account got
 * "You don't have access to that" until firestore.rules were deployed —
 * because one new collection (pcBuilds) had been subscribed at startup
 * alongside the core ones, so a denial on a feature nobody was using yet
 * blanked the till, inventory and repairs too.
 */
describe('core vs optional at startup', () => {
  const DENIED = { code: 'permission-denied', message: 'Missing or insufficient permissions.' };

  it('core is the minimum the app cannot run without — and nothing more', () => {
    expect(CORE_COLLECTIONS).toEqual(
      ['inventory', 'accessories', 'salesTransactions', 'customers', 'meta'],
    );
  });

  /**
   * The startup handler's decision, exactly as hooks/useWorkspaceData.ts
   * makes it: fatal blanks the app, ignore empties one section.
   */
  const runStartup = (denied: string[]) => {
    const subscribed = [
      'inventory', 'accessories', 'runners', 'customers',
      'salesTransactions', 'repairs', 'repairBatches', 'pcBuilds', 'activityLog', 'meta',
    ];
    let appDown = false;
    const empty: string[] = [];
    for (const coll of subscribed) {
      if (!denied.includes(coll)) continue;
      if (failureAction(DENIED, !isCoreCollection(coll)) === 'ignore') empty.push(coll);
      else appDown = true;
    }
    return { appDown, empty, works: (c: string) => !appDown && !empty.includes(c) };
  };

  it('A DENIAL ON pcBuilds LEAVES QUICK SALE, INVENTORY AND REPAIRS WORKING', () => {
    const r = runStartup(['pcBuilds']);
    expect(r.appDown).toBe(false);          // this is the regression
    expect(r.empty).toEqual(['pcBuilds']);  // and only that section is affected
    // The collections those three screens are actually built from.
    expect(r.works('salesTransactions')).toBe(true);  // Quick Sale
    expect(r.works('inventory')).toBe(true);          // Inventory
    expect(r.works('accessories')).toBe(true);
    expect(r.works('customers')).toBe(true);
    expect(r.works('repairs')).toBe(true);            // Repairs
  });

  it('but losing INVENTORY does take the app down, as it must', () => {
    expect(runStartup(['inventory']).appDown).toBe(true);
  });

  it('a new collection is OPTIONAL until someone makes the case', () => {
    for (const coll of ['pcBuilds', 'repairs', 'repairBatches', 'runners', 'activityLog', 'somethingAddedNextYear']) {
      expect({ coll, core: isCoreCollection(coll) }).toEqual({ coll, core: false });
    }
  });

  it('a denial on a CORE collection is still fatal — there is no app without stock', () => {
    for (const coll of CORE_COLLECTIONS) {
      expect({ coll, action: failureAction(DENIED, !isCoreCollection(coll)) })
        .toEqual({ coll, action: 'fatal' });
    }
  });

  it('a CONNECTIVITY failure is fatal even on an optional collection', () => {
    // Losing the database is not the same as being refused one collection.
    expect(failureAction({ code: 'unavailable', message: 'client is offline' }, true)).toBe('fatal');
  });

  it('the section notice names the section and the likely cause', () => {
    const notice = sectionUnavailableNotice('PC Builds');
    expect(notice).toContain('PC Builds');
    expect(notice).toMatch(/deploy database rules/i);
    expect(notice).toMatch(/Everything else still works/i);
  });
});
