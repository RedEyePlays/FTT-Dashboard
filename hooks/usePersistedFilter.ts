import { useEffect, useState } from 'react';

// Remembers a filter's last-used value per signed-in user, so re-opening a
// page restores it instead of resetting to the default. Keyed by uid so
// switching accounts on the same device never leaks one user's filter
// choice into another's — a fresh/unrecognized uid just falls back to
// `initial`. Backed by localStorage (per-device, not synced), which is fine
// for a UI convenience like this.
export function usePersistedFilter<T>(key: string, userId: string | undefined, initial: T): [T, (v: T) => void] {
  const storageKey = userId ? `${key}:${userId}` : null;

  const [value, setValue] = useState<T>(() => {
    if (!storageKey) return initial;
    try {
      const raw = localStorage.getItem(storageKey);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  // Re-read when the signed-in user changes (e.g. sign-out/sign-in on the
  // same device), so the previous user's stored value never bleeds through.
  useEffect(() => {
    if (!storageKey) { setValue(initial); return; }
    try {
      const raw = localStorage.getItem(storageKey);
      setValue(raw !== null ? (JSON.parse(raw) as T) : initial);
    } catch {
      setValue(initial);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* ignore quota/serialize errors */ }
  }, [storageKey, value]);

  return [value, setValue];
}
