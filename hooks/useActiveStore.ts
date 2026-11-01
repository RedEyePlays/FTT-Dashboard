import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppUser, Location } from '../types';
import { permittedLocations, resolveActiveLocation } from '../domain/locations';

/**
 * WHICH STORE THIS TERMINAL IS WORKING AT.
 *
 * Multi-store stage 2. The cash drawer is now per store, so every cash action
 * needs an answer to "whose till is this?" — and the answer must not be a
 * guess, because the wrong one puts real money on the wrong day.
 *
 * Where the answer comes from, in order:
 *
 *  1. what this device chose last (localStorage — a terminal is physically in
 *     one shop, so the choice belongs to the device, not to the account);
 *  2. the first store this person is permitted to work at
 *     (domain/locations.ts's permittedLocations — the owner holds all of them,
 *     everyone else holds their list, and an empty list means the default
 *     store rather than nothing).
 *
 * A remembered choice is honoured only while the person may still work there:
 * taken off a store, or that store closing, falls back rather than leaving
 * somebody pointed at a till they cannot write to.
 *
 * WITH NO STORE LIST CONFIGURED THIS RETURNS ''. Everything downstream treats
 * that as "one shop, exactly as before" — bare-date drawer ids, no filtering.
 * Stage 2 stays invisible until the owner has created locations in stage 1.
 */

const STORAGE_KEY = 'ftt.activeLocationId';

const readStored = (): string => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    // Private browsing, a locked-down iPad, storage full: the remembered
    // choice is a convenience, never the thing correctness rests on.
    return '';
  }
};

export interface ActiveStore {
  /** The resolved store id, or '' when the workspace has no store list. */
  activeLocationId: string;
  activeLocation?: Location;
  /** The stores this person may switch between — one entry for most staff. */
  permitted: Location[];
  /** True once there is more than one store to choose from. */
  canSwitch: boolean;
  setActiveLocationId: (id: string) => void;
}

export const useActiveStore = (
  appUser: AppUser | null | undefined,
  locations: Location[],
): ActiveStore => {
  const [preferred, setPreferred] = useState<string>(() =>
    (typeof window === 'undefined' ? '' : readStored()));

  const permitted = useMemo(() => permittedLocations(appUser || undefined, locations), [appUser, locations]);
  const activeLocation = useMemo(
    () => resolveActiveLocation(appUser || undefined, locations, preferred),
    [appUser, locations, preferred],
  );
  const activeLocationId = activeLocation?.id || '';

  // Write back the RESOLVED id, not the raw preference, so a stale stored
  // value (a store since closed, or access removed) is replaced rather than
  // kept to be re-resolved on every load.
  useEffect(() => {
    if (!activeLocationId || activeLocationId === preferred) return;
    try { window.localStorage.setItem(STORAGE_KEY, activeLocationId); } catch { /* see readStored */ }
    setPreferred(activeLocationId);
  }, [activeLocationId, preferred]);

  const setActiveLocationId = useCallback((id: string) => {
    // Never settable to a store this person may not work at — the picker only
    // offers permitted ones, and this is the second lock on that.
    if (!permitted.some(l => l.id === id)) return;
    try { window.localStorage.setItem(STORAGE_KEY, id); } catch { /* see readStored */ }
    setPreferred(id);
  }, [permitted]);

  return {
    activeLocationId,
    activeLocation,
    permitted,
    canSwitch: permitted.length > 1,
    setActiveLocationId,
  };
};
