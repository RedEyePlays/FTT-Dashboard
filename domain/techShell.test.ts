import { describe, it, expect } from 'vitest';
import { ViewState } from '../types';
import { TECH_SCREENS, TechScreen, techScreenFor } from './techShell';
import { can } from '../services/rbac';

/**
 * A TECHNICIAN CAN REACH PC BUILDS, AND NOTHING ELSE.
 *
 * PR #211 granted technicians 'builds.manage'. It changed nothing in practice:
 * the technician shell is a separate app, hard-wired to the repairs view with
 * no navigation of any kind, so the permission was unreachable.
 *
 * This is the clamp that replaced the hard-wiring. It is a whitelist, which is
 * the property worth testing: a view added next year is unreachable here
 * without somebody choosing to add it.
 */

/**
 * Every view in the app, so "no other route" is asserted exhaustively.
 *
 * Built from a Record keyed by ViewState so the COMPILER enforces it stays
 * complete: adding a view to the union without adding it here fails the
 * typecheck, rather than silently shrinking what this file covers.
 */
const ALL_VIEWS = Object.keys({
  dashboard: 1, analytics: 1, reports: 1, entry: 1, edit: 1, grid: 1, notes: 1,
  ai: 1, pos: 1, quickpurchase: 1, dropoff: 1, repairs: 1, customers: 1,
  users: 1, audit: 1, settings: 1, timeclock: 1, closeout: 1, layaways: 1,
  pcbuilds: 1,
} satisfies Record<ViewState, 1>) as ViewState[];

describe('the technician shell has exactly two screens', () => {
  it('is a whitelist of two, and that is the whole list', () => {
    expect(TECH_SCREENS).toEqual(['repairs', 'pcbuilds']);
  });

  it('repairs is the default, unchanged', () => {
    expect(techScreenFor(undefined, true)).toBe('repairs');
    expect(techScreenFor('repairs', true)).toBe('repairs');
  });

  it('PC BUILDS IS REACHABLE — the whole point of the change', () => {
    expect(techScreenFor('pcbuilds', true)).toBe('pcbuilds');
  });

  it('NO OTHER VIEW IS REACHABLE, by any route', () => {
    // Inventory, Reports, Customers, Settings and everything else — including
    // anything a URL could carry, since this is the only way in.
    const reachable = ALL_VIEWS.filter(v => techScreenFor(v, true) === v);
    expect(reachable).toEqual(['repairs', 'pcbuilds']);

    // Named explicitly, because these are the ones the owner asked about.
    for (const v of ['grid', 'reports', 'customers', 'settings', 'analytics', 'pos', 'users', 'audit'] as ViewState[]) {
      expect({ v, lands: techScreenFor(v, true) }).toEqual({ v, lands: 'repairs' });
    }
  });

  it('a view added next year is unreachable until somebody adds it here', () => {
    expect(techScreenFor('some-future-view' as ViewState, true)).toBe('repairs');
    expect(techScreenFor('' as ViewState, true)).toBe('repairs');
  });
});

describe('the builds screen needs the permission', () => {
  it('without builds.manage it cannot be resolved to at all', () => {
    // Not merely hidden: there is no state in which it renders.
    expect(techScreenFor('pcbuilds', false)).toBe('repairs');
    for (const v of ALL_VIEWS) {
      expect({ v, lands: techScreenFor(v, false) }).toEqual({ v, lands: 'repairs' });
    }
  });

  it('so revoking it while that screen is open falls back on the next render', () => {
    const open: TechScreen = 'pcbuilds';
    expect(techScreenFor(open, true)).toBe('pcbuilds');
    expect(techScreenFor(open, false)).toBe('repairs');
  });

  it('and a technician is the role that holds it', () => {
    expect(can('technician', 'builds.manage')).toBe(true);
    expect(can('kiosk', 'builds.manage')).toBe(false);
  });
});
