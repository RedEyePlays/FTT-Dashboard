// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useAppLock, APP_LOCK_KEY } from './useAppLock';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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
function Harness({ user, authLoading }: { user: unknown; authLoading: boolean }) {
  const [locked, setLocked] = useAppLock(user, authLoading);
  (window as any).__setLocked = setLocked;
  return <div data-locked={String(locked)} />;
}

const isLocked = (host: HTMLElement) => host.querySelector('div')!.getAttribute('data-locked') === 'true';

describe('useAppLock', () => {
  beforeEach(() => {
    sessionStorage.clear();
    delete (window as any).__setLocked;
  });

  it('reads a persisted lock from sessionStorage on mount', () => {
    sessionStorage.setItem(APP_LOCK_KEY, '1');
    const { host, unmount } = mount(<Harness user={{ uid: 'u1' }} authLoading={false} />);
    expect(isLocked(host)).toBe(true);
    unmount();
  });

  it('a locked session stays locked across the transient pre-auth null render, then auth resolves to the same authenticated user (the real refresh path)', () => {
    sessionStorage.setItem(APP_LOCK_KEY, '1');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<Harness user={null} authLoading={true} />); });
    expect(isLocked(host)).toBe(true);

    act(() => { root.render(<Harness user={{ uid: 'u1' }} authLoading={false} />); });
    expect(isLocked(host)).toBe(true); // must NOT have been cleared by the transient null render

    act(() => root.unmount());
    host.remove();
  });

  it('a genuine sign-out (auth resolved, user null) clears the lock', () => {
    sessionStorage.setItem(APP_LOCK_KEY, '1');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<Harness user={{ uid: 'u1' }} authLoading={false} />); });
    expect(isLocked(host)).toBe(true);

    act(() => { root.render(<Harness user={null} authLoading={false} />); }); // real sign-out: auth resolved, no user
    expect(isLocked(host)).toBe(false);
    expect(sessionStorage.getItem(APP_LOCK_KEY)).toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  it('a fresh login after sign-out starts unlocked (no stale lock resurrected)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    // Sign-out already happened; nothing persisted.
    act(() => { root.render(<Harness user={null} authLoading={false} />); });
    expect(isLocked(host)).toBe(false);

    // A different (or the same) user logs back in.
    act(() => { root.render(<Harness user={{ uid: 'u2' }} authLoading={false} />); });
    expect(isLocked(host)).toBe(false);
    expect(sessionStorage.getItem(APP_LOCK_KEY)).toBeNull();

    act(() => root.unmount());
    host.remove();
  });

  it('manually locking persists to sessionStorage, and unlocking removes it', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<Harness user={{ uid: 'u1' }} authLoading={false} />); });
    expect(sessionStorage.getItem(APP_LOCK_KEY)).toBeNull();

    act(() => { (window as any).__setLocked(true); });
    expect(sessionStorage.getItem(APP_LOCK_KEY)).toBe('1');

    act(() => { (window as any).__setLocked(false); });
    expect(sessionStorage.getItem(APP_LOCK_KEY)).toBeNull();

    act(() => root.unmount());
    host.remove();
  });
});
