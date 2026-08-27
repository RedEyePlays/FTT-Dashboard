// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { assertOnline, OfflineError } from './functionsGuard';

const setOnline = (value: boolean) => {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
};

describe('assertOnline', () => {
  const original = navigator.onLine;
  afterEach(() => setOnline(original));

  it('does nothing while online', () => {
    setOnline(true);
    expect(() => assertOnline()).not.toThrow();
  });

  it('throws an OfflineError while offline', () => {
    setOnline(false);
    expect(() => assertOnline()).toThrow(OfflineError);
  });

  it('OfflineError has a distinguishable name and a clear message', () => {
    setOnline(false);
    try {
      assertOnline();
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(OfflineError);
      expect((e as Error).name).toBe('OfflineError');
      expect((e as Error).message).toMatch(/internet connection/i);
    }
  });
});
