import { useCallback, useRef, useState } from 'react';

// Re-entrancy guard for write-once UI actions whose write handlers are
// fire-and-forget (Quick Purchase save, drop-off Accept / Add to Inventory,
// runner settlement — see App.tsx: none of these return a promise the caller
// awaits, they kick off a Firestore write and the real confirmation is the
// next live-data snapshot, which can take a real amount of time to land).
// That means the local state/props a button's `disabled` normally depends on
// can stay stale for a while after the first click — exactly the gap an
// impatient second tap at a busy counter slips through, producing a second
// inventory item, a second cash-drawer entry, a second settlement.
//
// `run` marks the action in-flight the instant it's invoked — synchronously,
// before the wrapped function does anything — which is what actually blocks
// a same-tick/same-frame re-click (state alone can't: state updates are
// async). It then holds that flag for `cooldownMs` after the call returns,
// long enough to bridge a normal round trip, and always clears on its own
// afterward — a genuine failure never leaves a button stuck disabled.
const DEFAULT_COOLDOWN_MS = 2500;

/** Guard for a single write-once action (one button, one flag). */
export function useSubmitGuard(cooldownMs = DEFAULT_COOLDOWN_MS) {
  const inFlightRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const run = useCallback((fn: () => void) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setIsSubmitting(true);
    fn();
    setTimeout(() => {
      inFlightRef.current = false;
      setIsSubmitting(false);
    }, cooldownMs);
  }, [cooldownMs]);

  return { isSubmitting, run };
}

/**
 * Same guard, keyed — for a list where each row's action (Accept, Add to
 * Inventory, …) is independent and only THAT row should show busy/disabled,
 * not the whole list.
 */
export function useKeyedSubmitGuard(cooldownMs = DEFAULT_COOLDOWN_MS) {
  const inFlightRef = useRef<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  const run = useCallback((key: string, fn: () => void) => {
    if (inFlightRef.current.has(key)) return;
    inFlightRef.current.add(key);
    setPending(new Set(inFlightRef.current));
    fn();
    setTimeout(() => {
      inFlightRef.current.delete(key);
      setPending(new Set(inFlightRef.current));
    }, cooldownMs);
  }, [cooldownMs]);

  const isPending = useCallback((key: string) => pending.has(key), [pending]);
  return { isPending, run };
}
