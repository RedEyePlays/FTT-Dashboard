// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { useSubmitGuard, useKeyedSubmitGuard } from './useSubmitGuard';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount<T>(useHook: () => T) {
  let val!: T;
  function Harness() { val = useHook(); return null; }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<Harness />); });
  return { get val() { return val; }, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

describe('useSubmitGuard', () => {
  it('a second run() call while the first is still marked in-flight is a no-op', () => {
    const fn = vi.fn();
    const h = mount(() => useSubmitGuard(10000));
    act(() => { h.val.run(fn); h.val.run(fn); });
    expect(fn).toHaveBeenCalledTimes(1);
    h.unmount();
  });

  it('run() is allowed again after the cooldown elapses', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const h = mount(() => useSubmitGuard(1000));
    act(() => { h.val.run(fn); });
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1001); });
    act(() => { h.val.run(fn); });
    expect(fn).toHaveBeenCalledTimes(2);
    h.unmount();
    vi.useRealTimers();
  });
});

describe('useKeyedSubmitGuard', () => {
  it('a second run() for the SAME key while in-flight is a no-op, but a different key is unaffected', () => {
    const fn = vi.fn();
    const h = mount(() => useKeyedSubmitGuard(10000));
    act(() => {
      h.val.run('row-1', fn);
      h.val.run('row-1', fn); // same key, blocked
      h.val.run('row-2', fn); // different key, allowed
    });
    expect(fn).toHaveBeenCalledTimes(2);
    h.unmount();
  });

  it('isPending reflects only the keys currently in flight', () => {
    vi.useFakeTimers();
    const h = mount(() => useKeyedSubmitGuard(1000));
    act(() => { h.val.run('row-1', () => {}); });
    expect(h.val.isPending('row-1')).toBe(true);
    expect(h.val.isPending('row-2')).toBe(false);
    act(() => { vi.advanceTimersByTime(1001); });
    expect(h.val.isPending('row-1')).toBe(false);
    h.unmount();
    vi.useRealTimers();
  });
});
