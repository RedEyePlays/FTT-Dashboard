import { ViewState } from '../types';
import { InvSection, DEFAULT_INV_SECTION, invPath, parseInvPath } from './inventoryNav';

// Top-level view ↔ URL routing, the counterpart to inventoryNav.ts for the whole
// app shell. Reflecting the current page in the URL means a refresh (or a
// bookmarked / shared link) restores it instead of always landing on Dashboard.
// The app is served with a SPA catch-all rewrite, so these real paths resolve on
// reload. Inventory keeps its richer /inventory/<section> routing (delegated
// below); every other page is a flat slug.
//
// Transient form views — 'entry' (Add Item) and 'edit' — have no route of their
// own: they depend on in-memory state (the item being edited), so a refresh
// can't meaningfully restore them and they fall back to a real page.

const VIEW_SLUGS: { view: ViewState; slug: string }[] = [
  { view: 'analytics', slug: 'analytics' },
  { view: 'reports', slug: 'reports' },
  { view: 'pos', slug: 'checkout' },
  { view: 'repairs', slug: 'repairs' },
  { view: 'customers', slug: 'customers' },
  { view: 'dropoff', slug: 'drop-offs' },
  { view: 'notes', slug: 'notes' },
  { view: 'ai', slug: 'ai' },
  { view: 'audit', slug: 'audit' },
  { view: 'users', slug: 'users' },
  { view: 'settings', slug: 'settings' },
  { view: 'timeclock', slug: 'time-clock' },
];

// Views that have no restorable URL of their own.
const TRANSIENT: ViewState[] = ['entry', 'edit'];
export const isRoutableView = (v: ViewState): boolean => !TRANSIENT.includes(v);

/**
 * The URL path for a top-level view. Dashboard → '/', inventory → its section
 * path (/inventory/<section>), mapped views → '/slug'. Views without a route of
 * their own (entry/edit) resolve to '/'.
 */
export const viewPath = (view: ViewState, section: InvSection = DEFAULT_INV_SECTION): string => {
  if (view === 'grid') return invPath(section);
  const slug = VIEW_SLUGS.find(x => x.view === view)?.slug;
  return slug ? `/${slug}` : '/';
};

/**
 * Parse a pathname into a top-level view. Any /inventory route → 'grid'; '/' →
 * 'dashboard'; a known slug → its view. Returns null for an unrecognized path so
 * the caller can fall back (e.g. to the configured landing page).
 */
export const parseViewPath = (pathname: string): ViewState | null => {
  if (parseInvPath(pathname)) return 'grid';
  const clean = pathname.replace(/\/+$/, '');
  if (clean === '' ) return 'dashboard';
  const slug = clean.replace(/^\/+/, '');
  return VIEW_SLUGS.find(x => x.slug === slug)?.view ?? null;
};
