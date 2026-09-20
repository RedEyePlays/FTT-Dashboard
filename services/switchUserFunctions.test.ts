import { describe, it, expect } from 'vitest';
import { switchErrorMessage } from './switchUserFunctions';
import { OfflineError } from './functionsGuard';

// THE OFFLINE CASE IS THE MOST IMPORTANT FAILURE IN THIS FEATURE. The PIN is
// checked by a Cloud Function, so with no connection there is nothing to try.
// What must never happen is the quiet failure: the previous person's session
// silently kept while the screen implies a switch took, and the next person
// rings a sale under a name that is not theirs.

describe('what the register is told when a switch fails', () => {
  it('offline says so plainly, and says what to do instead', () => {
    const msg = switchErrorMessage(new OfflineError());
    expect(msg).toBe("Can't switch users while offline — sign in with a password.");
  });

  it('a network-shaped callable error reads as offline too', () => {
    // Firebase reports a dropped connection as 'unavailable' or a deadline,
    // neither of which means "wrong PIN" — showing that would send somebody
    // hunting for a typo that isn't there.
    expect(switchErrorMessage({ code: 'functions/unavailable', message: 'x' }))
      .toMatch(/offline/i);
    expect(switchErrorMessage({ code: 'functions/deadline-exceeded', message: 'x' }))
      .toMatch(/offline/i);
    expect(switchErrorMessage({ code: '', message: 'A network error occurred' }))
      .toMatch(/offline/i);
  });

  it('the callable\'s own wording is passed through untouched', () => {
    // Those messages are already written for the counter — wrong PIN, cooling
    // down, no PIN set. Re-wording them here would put a second, drifting copy
    // of each one in the client.
    expect(switchErrorMessage({ code: 'functions/permission-denied', message: "That PIN didn't match." }))
      .toBe("That PIN didn't match.");
    expect(switchErrorMessage({ code: 'functions/failed-precondition', message: 'No PIN is set for that account. Sign in with an email and password instead.' }))
      .toMatch(/email and password/);
  });

  it('an error with nothing useful still tells the person what to do', () => {
    expect(switchErrorMessage({})).toBe('Could not switch users. Sign in with a password.');
    expect(switchErrorMessage(undefined)).toBe('Could not switch users. Sign in with a password.');
  });

  it('never leaks a hash, a salt or the PIN into what is shown', () => {
    const msg = switchErrorMessage({ code: 'x', message: "That PIN didn't match." });
    expect(msg).not.toMatch(/hash|salt|pbkdf2|iteration/i);
  });
});
