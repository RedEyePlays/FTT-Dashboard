import { useCallback, useEffect, useRef, useState } from 'react';
import { DRAFT_COMMIT_MS, draftChanged, shouldSyncDraft } from '../domain/fieldDraft';

/**
 * A TEXT FIELD THAT DOES NOT LOSE THE CARET.
 *
 * Binds an input to a local draft instead of straight to the saved record, and
 * commits on blur or after a short pause. See domain/fieldDraft.ts for the rule
 * this enforces and the bug it exists for — in short, a fully-controlled input
 * whose value round-trips through Firestore resets the caret to the end on
 * every keystroke, so a typo in the middle of a part name could not be fixed.
 *
 * Also removes a Firestore write PER CHARACTER, which was real cost and load.
 *
 * Usage:
 *   const name = useFieldDraft(part.name, part.id, v => onChange({ name: v }));
 *   <input {...name.bind} />
 */
export function useFieldDraft(
  saved: string,
  /** Identity of the record being edited — a part id. Changing it re-seeds. */
  key: string,
  commit: (value: string) => void,
  commitMs: number = DRAFT_COMMIT_MS,
) {
  const [draft, setDraft] = useState(saved);
  const focusedRef = useRef(false);
  // What this draft was seeded from, so an unrelated re-render does not reset it.
  const seededRef = useRef(saved);
  const keyRef = useRef(key);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held in a ref so the debounce always calls the CURRENT commit, not the one
  // captured when the timer was set.
  const commitRef = useRef(commit);
  useEffect(() => { commitRef.current = commit; }, [commit]);

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  // Re-seed from the saved value, but only when that is safe.
  useEffect(() => {
    if (!shouldSyncDraft({
      focused: focusedRef.current, key, draftKey: keyRef.current, saved, seeded: seededRef.current,
    })) return;
    clearTimer();
    keyRef.current = key;
    seededRef.current = saved;
    setDraft(saved);
  }, [saved, key]);

  const flush = useCallback((value: string) => {
    clearTimer();
    if (!draftChanged(value, seededRef.current)) return;
    seededRef.current = value;
    commitRef.current(value);
  }, []);

  const onChange = useCallback((e: { target: { value: string } }) => {
    const value = e.target.value;
    setDraft(value);
    // The safety net: somebody types and then walks away without blurring —
    // switching tabs, being called to the counter — and the edit still lands.
    clearTimer();
    timerRef.current = setTimeout(() => flush(value), commitMs);
  }, [commitMs, flush]);

  const onFocus = useCallback(() => { focusedRef.current = true; }, []);

  const onBlur = useCallback((e: { target: { value: string } }) => {
    focusedRef.current = false;
    flush(e.target.value);
  }, [flush]);

  // A field unmounted mid-edit (the row removed, the build closed) still
  // commits what was typed rather than dropping it.
  useEffect(() => () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  return {
    value: draft,
    setDraft,
    bind: { value: draft, onChange, onFocus, onBlur },
  };
}
