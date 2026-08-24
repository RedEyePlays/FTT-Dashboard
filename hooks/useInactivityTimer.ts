import { useEffect, useRef } from 'react';

// Any mouse/keyboard/touch/scroll activity counts as "not idle". Deliberately
// broad and passive so it never interferes with normal use of the app.
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'] as const;

/**
 * Fires `onIdle` once after `minutes` of no qualifying activity anywhere in the
 * document, resetting on every event while `enabled`. Pass `minutes <= 0` or
 * `enabled: false` to fully disable — no listeners are attached and no timer
 * runs (used both for the "never" setting and to stop ticking once the app is
 * already locked, so the lock screen's own input doesn't fight this).
 */
export function useInactivityTimer(minutes: number, enabled: boolean, onIdle: () => void): void {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep the latest callback without re-attaching listeners every render.
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!enabled || !(minutes > 0)) return;
    const ms = minutes * 60_000;

    const reset = () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => onIdleRef.current(), ms);
    };

    reset();
    ACTIVITY_EVENTS.forEach(ev => window.addEventListener(ev, reset, { passive: true }));
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      ACTIVITY_EVENTS.forEach(ev => window.removeEventListener(ev, reset));
    };
  }, [minutes, enabled]);
}
