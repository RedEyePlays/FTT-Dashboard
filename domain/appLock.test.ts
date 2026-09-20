import { describe, it, expect } from 'vitest';
import {
  LockRecord, initialLocked, lockedAfterAuth, awayTooLong, buildRecord, isEmptyRecord,
} from './appLock';

// THE HOLE: the locked flag lived in sessionStorage, which dies with the tab.
// Lock the screen, close the tab, reopen the app — straight back inside, still
// signed in, no PIN, no password. On a shared register that made the lock
// decorative.

const NOW = 1_700_000_000_000;
const MIN = 60_000;

describe('a closed tab must not walk past the lock', () => {
  it('a persisted lock is still a lock when the app reopens', () => {
    expect(initialLocked({ uid: 'u1', locked: true, seen: NOW - 5 * MIN }, NOW)).toBe(true);
  });

  it('nothing persisted means nothing locked', () => {
    expect(initialLocked(null, NOW)).toBe(false);
    expect(initialLocked({}, NOW)).toBe(false);
    expect(isEmptyRecord({ uid: 'u1' })).toBe(true);
  });
});

describe('closing the tab never resets the idle timer', () => {
  const armed = (seen: number): LockRecord => ({ uid: 'u1', locked: false, seen, idleMs: 4 * MIN });

  it('away LONGER than the idle window comes back locked', () => {
    // Otherwise the way past a lock that was about to fire is to close the tab
    // and reopen it, and the count starts again from zero.
    expect(awayTooLong(armed(NOW - 5 * MIN), NOW)).toBe(true);
    expect(initialLocked(armed(NOW - 5 * MIN), NOW)).toBe(true);
  });

  it('away for less than it does not', () => {
    expect(awayTooLong(armed(NOW - 1 * MIN), NOW)).toBe(false);
    expect(initialLocked(armed(NOW - 1 * MIN), NOW)).toBe(false);
  });

  it('exactly the window counts as too long', () => {
    expect(awayTooLong(armed(NOW - 4 * MIN), NOW)).toBe(true);
  });

  it('somebody who was never on a timer is not locked merely by being away', () => {
    // idleMs 0 = auto-lock does not apply to that person on that device.
    expect(awayTooLong({ uid: 'u1', seen: NOW - 30 * MIN, idleMs: 0 }, NOW)).toBe(false);
    expect(awayTooLong({ uid: 'u1', seen: NOW - 30 * MIN }, NOW)).toBe(false);
  });

  it('a record with no heartbeat cannot be judged, so it is not used to lock', () => {
    expect(awayTooLong({ uid: 'u1', idleMs: 4 * MIN }, NOW)).toBe(false);
    expect(awayTooLong(null, NOW)).toBe(false);
  });
});

describe('a lock belongs to the person who set it', () => {
  const rec: LockRecord = { uid: 'sara', locked: true, seen: NOW };

  it('the same person signing back in is still locked', () => {
    expect(lockedAfterAuth(rec, 'sara', true)).toBe(true);
  });

  it('a DIFFERENT person signing in is NOT locked by it', () => {
    // A flag that now outlives the browser must never greet somebody else.
    // Obeying it would lock a person out of their own fresh session.
    expect(lockedAfterAuth(rec, 'ali', true)).toBe(false);
  });

  it('a genuine sign-out clears it', () => {
    expect(lockedAfterAuth(rec, undefined, true)).toBe(false);
  });

  it('a record with no owner does not contradict the live state', () => {
    // The old sessionStorage format ('1') had no uid, and a lock set during
    // this very session has not been reconciled against anything yet.
    expect(lockedAfterAuth({ locked: true }, 'sara', true)).toBe(true);
    expect(lockedAfterAuth(null, 'sara', true)).toBe(true);
    expect(lockedAfterAuth(null, 'sara', false)).toBe(false);
  });
});

describe('what gets written', () => {
  it('carries the owner, the state, the heartbeat and the window in force', () => {
    expect(buildRecord('u1', true, NOW, 4 * MIN)).toEqual({
      uid: 'u1', locked: true, seen: NOW, idleMs: 4 * MIN,
    });
  });

  it('omits the uid when there is nobody signed in, rather than writing undefined', () => {
    expect(buildRecord(undefined, true, NOW, 0)).toEqual({ locked: true, seen: NOW, idleMs: 0 });
  });

  it('never writes a negative idle window', () => {
    expect(buildRecord('u1', false, NOW, -5).idleMs).toBe(0);
  });
});
