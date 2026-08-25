import { useEffect } from 'react';

// Shared Escape-to-close handler for hand-rolled modals that don't use
// ResponsiveDialog. Pass the same close function the modal's own
// backdrop/Cancel/X button already calls (e.g. a `requestClose` that guards
// on unsaved changes) — never bypass an existing guard.
export function useEscapeKey(onEscape: () => void, active: boolean = true): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, onEscape]);
}
