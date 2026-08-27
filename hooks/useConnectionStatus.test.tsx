// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// onSnapshotsInSync's callback is captured here so tests can fire it manually
// to simulate "the local cache has caught up with the server" without a real
// Firestore connection.
let syncCallback: (() => void) | null = null;
vi.mock('firebase/firestore', () => ({
  onSnapshotsInSync: (_db: unknown, cb: () => void) => { syncCallback = cb; return () => { syncCallback = null; }; },
}));
vi.mock('../services/firebase', () => ({ db: {} }));

const { useConnectionStatus } = await import('./useConnectionStatus');

const setOnline = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
};

function mount<T>(useHook: () => T) {
  let val!: T;
  function Harness() { val = useHook(); return null; }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<Harness />); });
  return { get val() { return val; }, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

describe('useConnectionStatus', () => {
  afterEach(() => setOnline(true));

  it('starts online with no navigator.onLine listener firing yet', () => {
    setOnline(true);
    const h = mount(() => useConnectionStatus());
    expect(h.val).toBe('online');
    h.unmount();
  });

  it('flips to offline the instant the browser reports it, with no dependency on Firestore sync', () => {
    setOnline(true);
    const h = mount(() => useConnectionStatus());
    act(() => setOnline(false));
    expect(h.val).toBe('offline');
    h.unmount();
  });

  it('reports "reconnected" only once Firestore has actually synced back up, not merely when the browser reports online', () => {
    setOnline(true);
    const h = mount(() => useConnectionStatus());
    act(() => setOnline(false));
    expect(h.val).toBe('offline');

    act(() => setOnline(true));
    // Browser says online again, but Firestore hasn't confirmed a sync yet —
    // still not the transient "reconnected" state.
    expect(h.val).toBe('online');

    act(() => { syncCallback?.(); });
    expect(h.val).toBe('reconnected');
    h.unmount();
  });

  it('the reconnected state is transient and settles back to online', () => {
    vi.useFakeTimers();
    setOnline(true);
    const h = mount(() => useConnectionStatus());
    act(() => setOnline(false));
    act(() => setOnline(true));
    act(() => { syncCallback?.(); });
    expect(h.val).toBe('reconnected');
    act(() => { vi.advanceTimersByTime(4001); });
    expect(h.val).toBe('online');
    h.unmount();
    vi.useRealTimers();
  });
});
