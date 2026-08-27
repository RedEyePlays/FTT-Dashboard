import { PersistedCheckoutState, isPersistedStateFresh } from '../domain/checkoutPersistence';

// sessionStorage, deliberately not localStorage or Firestore: this is
// transient, per-tab UI state for one counter session — not shared data
// other devices/staff need to see, and not something that should survive
// past the browser tab actually closing. sessionStorage already gives us,
// for free, exactly the "different user / different terminal never sees
// this" boundary the clearing rules ask for at the browser-tab level (a
// fresh tab has empty sessionStorage), on top of the explicit key
// namespacing and expiry this module adds for the same-tab case (a shared
// terminal where staff sign in/out without closing the tab).
const read = (key: string): unknown => {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // storage unavailable (private mode, etc.) — fail closed, never throw into the checkout flow
  }
};

const write = (key: string, value: unknown): void => {
  try { sessionStorage.setItem(key, JSON.stringify(value)); }
  catch { /* storage unavailable/full — best-effort only */ }
};

const remove = (key: string): void => {
  try { sessionStorage.removeItem(key); }
  catch { /* ignore */ }
};

export function saveCheckoutState(key: string, state: PersistedCheckoutState): void {
  write(key, state);
}

export function clearCheckoutState(key: string): void {
  remove(key);
}

// Returns null for: nothing saved, malformed data, or an expired save — an
// expired entry is actively removed here too, so a stale blob never lingers
// to be misread later (e.g. by a clock change, or just to keep sessionStorage
// tidy for the rest of the tab's life).
export function loadCheckoutState(key: string, now: number): PersistedCheckoutState | null {
  const raw = read(key);
  if (!raw || typeof raw !== 'object' || typeof (raw as any).savedAt !== 'number') return null;
  const state = raw as PersistedCheckoutState;
  if (!isPersistedStateFresh(state.savedAt, now)) { remove(key); return null; }
  return state;
}
