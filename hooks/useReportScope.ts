import { useCallback, useMemo, useState } from 'react';
import { AppUser, Location } from '../types';
import { ALL_STORES_SCOPE, StoreScope, canUseScope, resolveScope, visibleScopesFor } from '../domain/storeScope';

/**
 * WHICH STORE'S NUMBERS THE REPORTS ARE SHOWING. MULTI-STORE STAGE 5.
 *
 * ONE filter, shared by every money screen — the Dashboard, Owner Analytics
 * and the Reports tabs. Pick Mississauga on the Dashboard and the P&L is
 * already showing Mississauga when you get there.
 *
 * That is deliberate, and it is the opposite of giving each screen its own
 * dropdown. Three independent filters is how somebody reads a Brampton P&L
 * beside an all-stores Dashboard and reconciles two numbers that were never
 * meant to match.
 *
 * NOT THE SAME THING AS `useActiveStore`, and deliberately a separate key.
 * That one answers "which till is this terminal working?" — a physical fact
 * about where the iPad is, which must not drift because somebody looked at the
 * other shop's figures. This answers "whose numbers am I reading?", which the
 * owner changes all day from one chair. Tying them together would mean
 * glancing at Mississauga's P&L quietly re-pointed the cash drawer.
 *
 * Remembered per device, like the active store, and re-validated on every
 * render: a store somebody has been taken off, or one that has since closed,
 * falls back to the combined books (see `resolveScope`).
 */

const STORAGE_KEY = 'ftt.reportScope';

const readStored = (): string => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    // Private browsing, a locked-down iPad: the remembered scope is a
    // convenience, and the fallback is the combined books, which is safe.
    return '';
  }
};

export interface ReportScope {
  /** The resolved scope: a location id, or '' for the combined books. */
  scope: StoreScope;
  /** What to write on screen, on print and in exports. */
  label: string;
  /** The scopes this viewer may choose; [] when there is no store list. */
  choices: StoreScope[];
  /** True once there is more than one scope to pick between. */
  canScope: boolean;
  setScope: (s: StoreScope) => void;
}

export const useReportScope = (
  appUser: AppUser | null | undefined,
  locations: Location[],
): Omit<ReportScope, 'label'> => {
  const [preferred, setPreferred] = useState<string>(() =>
    (typeof window === 'undefined' ? '' : readStored()));

  const choices = useMemo(() => visibleScopesFor(appUser || undefined, locations), [appUser, locations]);
  const scope = useMemo(
    () => resolveScope(appUser || undefined, locations, preferred),
    [appUser, locations, preferred],
  );

  const setScope = useCallback((s: StoreScope) => {
    // Never settable to a scope the picker would not offer — same second lock
    // as useActiveStore, for the same reason.
    if (!canUseScope(appUser || undefined, locations, s)) return;
    try { window.localStorage.setItem(STORAGE_KEY, s || ''); } catch { /* see readStored */ }
    setPreferred(s || ALL_STORES_SCOPE);
  }, [appUser, locations]);

  return { scope, choices, canScope: choices.length > 1, setScope };
};
