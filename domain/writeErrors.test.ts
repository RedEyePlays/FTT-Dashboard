import { describe, it, expect } from 'vitest';
import { quickPurchaseSaveError, writeErrorMessage } from './writeErrors';

/**
 * The rule: a screen that kept the user's typing must also tell them what went
 * wrong. Replacing "Saved" with a generic "Something went wrong" would only be
 * a quieter version of the same failure.
 */

describe('writeErrorMessage', () => {
  it('passes through a message the app wrote itself', () => {
    // The SKU allocator's offline refusal is the one that lost a purchase.
    const e = new Error('A SKU cannot be allocated while offline — reconnect and try again.');
    expect(writeErrorMessage(e)).toBe('A SKU cannot be allocated while offline — reconnect and try again.');
  });

  it('adds a full stop so a caller can append its own sentence', () => {
    expect(writeErrorMessage(new Error('Network unreachable'))).toBe('Network unreachable.');
  });

  it('translates the Firestore codes that mean something to a user', () => {
    const at = (code: string) => writeErrorMessage(Object.assign(new Error('[firebase] raw'), { code }));
    expect(at('permission-denied')).toBe("You don't have permission to save this.");
    expect(at('unauthenticated')).toBe('Your session has expired — sign in again.');
    expect(at('already-exists')).toBe('That record already exists.');
  });

  it('reads a connectivity failure as connectivity, however it is coded', () => {
    for (const code of ['unavailable', 'deadline-exceeded', 'failed-precondition', 'cancelled']) {
      expect({ code, msg: writeErrorMessage(Object.assign(new Error('x'), { code })) })
        .toEqual({ code, msg: "Couldn't reach the database — check the connection and try again." });
    }
  });

  it('strips a namespaced code prefix', () => {
    expect(writeErrorMessage(Object.assign(new Error('x'), { code: 'firestore/permission-denied' })))
      .toBe("You don't have permission to save this.");
  });

  it('SAYS IT DOES NOT KNOW rather than inventing a diagnosis', () => {
    expect(writeErrorMessage({})).toBe('The save failed and the reason was not clear.');
    // A raw SDK string is not an explanation, so it is not passed off as one.
    expect(writeErrorMessage(new Error('[Firebase] internal assertion 0xdeadbeef')))
      .toBe('The save failed and the reason was not clear.');
  });

  it('lets the caller name the step that actually failed', () => {
    expect(quickPurchaseSaveError({}))
      .toBe("Couldn't get a SKU — check the connection and try again.");
    // But a real, specific reason always beats the fallback.
    expect(quickPurchaseSaveError(Object.assign(new Error('x'), { code: 'permission-denied' })))
      .toBe("You don't have permission to save this.");
  });
});
