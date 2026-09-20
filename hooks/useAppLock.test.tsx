// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useAppLock, APP_LOCK_KEY } from './useAppLock';
import { LockRecord, buildRecord } from '../domain/appLock';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// THE HOLE THIS SUITE GUARDS: the locked flag used to live in sessionStorage,
// which dies with the tab. Lock the screen, close the tab, reopen the app —
// straight back inside, still signed in, no PIN, no password. On a shared
// counter register that made the lock decorative.
//
// Moving it to localStorage makes the existing "genuine sign-out vs the
// transient pre-auth null" care matter MORE: a flag that outlives the browser
// must never greet a different person who signs in afterwards.

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

// Exposes the hook's state/setter as data attributes + window globals so
// tests can drive it via rerenders, same pattern as this codebase's other
// hook-through-a-host-component tests (e.g. SettlementReviewModal.test.tsx).
function Harness({ user, authLoading, idleMs = 0 }: { user: unknown; authLoading: boolean; idleMs?: number }) {
  const [locked, setLocked] = useAppLock(user, authLoading, idleMs);
  (window as any).__setLocked = setLocked;
  return <div data-locked={String(locked)} />;
}

const isLocked = (host: HTMLElement) => host.querySelector('div')!.getAttribute('data-locked') === 'true';
const stored = (): LockRecord | null => {
  const raw = localStorage.getItem(APP_LOCK_KEY);
  return raw ? JSON.parse(raw) as LockRecord : null;
};

const MIN = 60_000;

describe('useAppLock', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete (window as any).__setLocked;
  });

  /* --- The reported hole ------------------------------------------------ */

  it('CLOSING THE TAB AND REOPENING STAYS LOCKED', () => {
    // The whole bug: this used to read from sessionStorage, which is gone by
    // the time the app is reopened, so the app rendered unlocked.
    localStorage.setItem(APP_LOCK_KEY, JSON.stringify(buildRecord('u1', true, Date.now(), 4 * MIN)));
    const { host, unmount } = mount(<Harness user={{ uid: 'u1' }} authLoading={false} />);
    expect(isLocked(host)).toBe(true);
    unmount();
  });

  it('a lock persisted only in the OLD sessionStorage no longer lets anyone in', () => {
    // The old location is simply not read any more. A stale lock is not
    // something worth resurrecting, but it must not unlock anything either.
    sessionStorage.setItem(APP_LOCK_KEY, '1');
    const { host, unmount } = mount(<Harness user={{ uid: 'u1' }} authLoading={false} />);
    expect(isLocked(host)).toBe(false);
    unmount();
  });

  it('the old bare "1" format in the NEW location is still honoured as locked', () => {
    localStorage.setItem(APP_LOCK_KEY, '1');
    const { host, unmount } = mount(<Harness user={{ uid: 'u1' }} authLoading={false} />);
    expect(isLocked(host)).toBe(true);
    unmount();
  });

  it('returning after longer than the idle window comes back LOCKED', () => {
    // Closing the tab must never be a way to reset the timer.
    localStorage.setItem(APP_LOCK_KEY, JSON.stringify({
      uid: 'u1', locked: false, seen: Date.now() - 10 * MIN, idleMs: 4 * MIN,
    }));
    const { host, unmount } = mount(<Harness user={{ uid: 'u1' }} authLoading={false} idleMs={4 * MIN} />);
    expect(isLocked(host)).toBe(true);
    unmount();
  });

  it('returning within the idle window does not lock', () => {
    localStorage.setItem(APP_LOCK_KEY, JSON.stringify({
      uid: 'u1', locked: false, seen: Date.now() - 1 * MIN, idleMs: 4 * MIN,
    }));
    const { host, unmount } = mount(<Harness user={{ uid: 'u1' }} authLoading={false} idleMs={4 * MIN} />);
    expect(isLocked(host)).toBe(false);
    unmount();
  });

  it('somebody auto-lock does not apply to is not locked merely by being away', () => {
    localStorage.setItem(APP_LOCK_KEY, JSON.stringify({
      uid: 'u1', locked: false, seen: Date.now() - 10 * MIN, idleMs: 0,
    }));
    const { host, unmount } = mount(<Harness user={{ uid: 'u1' }} authLoading={false} idleMs={0} />);
    expect(isLocked(host)).toBe(false);
    unmount();
  });

  /* --- The pre-auth null tick, which now matters more ------------------- */

  it('a locked session survives the transient pre-auth null render, then auth resolves to the same user (the real refresh path)', () => {
    localStorage.setItem(APP_LOCK_KEY, JSON.stringify(buildRecord('u1', true, Date.now(), 4 * MIN)));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<Harness user={null} authLoading={true} />); });
    expect(isLocked(host)).toBe(true);

    act(() => { root.render(<Harness user={{ uid: 'u1' }} authLoading={false} />); });
    expect(isLocked(host)).toBe(true); // must NOT have been cleared by the transient null

    act(() => root.unmount());
    host.remove();
  });

  it('a genuine sign-out (auth resolved, user null) clears the lock and the record', () => {
    localStorage.setItem(APP_LOCK_KEY, JSON.stringify(buildRecord('u1', true, Date.now(), 4 * MIN)));
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<Harness user={{ uid: 'u1' }} authLoading={false} />); });
    expect(isLocked(host)).toBe(true);

    act(() => { root.render(<Harness user={null} authLoading={false} />); });
    expect(isLocked(host)).toBe(false);
    expect(localStorage.getItem(APP_LOCK_KEY)).toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  /* --- A lock belongs to the person who set it -------------------------- */

  it('A DIFFERENT USER SIGNING IN IS NOT LOCKED by somebody else\'s flag', () => {
    // A flag that outlives the browser must never greet the next person.
    // Obeying it would lock them out of their own freshly signed-in session.
    localStorage.setItem(APP_LOCK_KEY, JSON.stringify(buildRecord('sara', true, Date.now(), 4 * MIN)));
    const { host, unmount } = mount(<Harness user={{ uid: 'ali' }} authLoading={false} />);
    expect(isLocked(host)).toBe(false);
    unmount();
  });

  it('but the SAME user reopening is still locked', () => {
    localStorage.setItem(APP_LOCK_KEY, JSON.stringify(buildRecord('sara', true, Date.now(), 4 * MIN)));
    const { host, unmount } = mount(<Harness user={{ uid: 'sara' }} authLoading={false} />);
    expect(isLocked(host)).toBe(true);
    unmount();
  });

  it('a fresh login after sign-out starts unlocked (no stale lock resurrected)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<Harness user={null} authLoading={false} />); });
    expect(isLocked(host)).toBe(false);

    act(() => { root.render(<Harness user={{ uid: 'u2' }} authLoading={false} />); });
    expect(isLocked(host)).toBe(false);

    act(() => root.unmount());
    host.remove();
  });

  /* --- Writing ---------------------------------------------------------- */

  it('manually locking persists with the owner attached, and unlocking clears it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<Harness user={{ uid: 'u1' }} authLoading={false} idleMs={4 * MIN} />); });

    act(() => { (window as any).__setLocked(true); });
    expect(stored()).toMatchObject({ uid: 'u1', locked: true, idleMs: 4 * MIN });

    act(() => { (window as any).__setLocked(false); });
    expect(stored()).toMatchObject({ uid: 'u1', locked: false });

    act(() => root.unmount());
    host.remove();
  });

  /* --- Storage unavailable (private mode) ------------------------------- */

  it('still locks IN MEMORY when storage throws on every access', () => {
    // A browser in private mode, or with site data blocked, throws on
    // localStorage. The lock must still work for the session in front of you —
    // it just cannot survive the tab, which is the pre-existing behaviour and
    // strictly better than not locking at all.
    const proto = Object.getPrototypeOf(localStorage);
    const original = { get: proto.getItem, set: proto.setItem, remove: proto.removeItem };
    const boom = () => { throw new Error('SecurityError'); };
    proto.getItem = boom; proto.setItem = boom; proto.removeItem = boom;
    try {
      const { host, unmount } = mount(<Harness user={{ uid: 'u1' }} authLoading={false} />);
      expect(isLocked(host)).toBe(false);
      act(() => { (window as any).__setLocked(true); });
      expect(isLocked(host)).toBe(true);
      unmount();
    } finally {
      proto.getItem = original.get; proto.setItem = original.set; proto.removeItem = original.remove;
    }
  });

  it('a corrupt record is ignored rather than crashing the app open', () => {
    localStorage.setItem(APP_LOCK_KEY, '{not json');
    const { host, unmount } = mount(<Harness user={{ uid: 'u1' }} authLoading={false} />);
    expect(isLocked(host)).toBe(false);
    unmount();
  });
});
