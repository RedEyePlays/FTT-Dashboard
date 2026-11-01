// Inventory sub-section navigation. These map to clean URL routes so a refresh
// or a shared link restores the section, and browser back/forward works. The
// app is served with a SPA catch-all rewrite, so real paths resolve on reload.
//
// THE DEVICES TAB BECAME THREE: Phones, Laptops and Other. A laptop needs its
// own fields (domain/deviceSpecs.ts) and, more to the point, adding from a
// typed tab is what stops the device type being left on its 'Phone' default —
// which is why every laptop in the workspace is currently filed as a phone.
//
// LOW STOCK IS KEPT. The five tabs the shop asked for are Phones | Laptops |
// Accessories | Other | Sold; Low Stock was not among them, but it is an
// existing accessory view and nobody asked for it to go, so it stays as a
// sixth rather than being dropped on the way past.

import { InvTab } from './deviceSpecs';

export type InvSection = InvTab;

export const INV_SECTIONS: { id: InvSection; label: string; slug: string }[] = [
  { id: 'phones', label: 'Phones', slug: 'phones' },
  { id: 'laptops', label: 'Laptops', slug: 'laptops' },
  { id: 'accessories', label: 'Accessories', slug: 'accessories' },
  { id: 'other', label: 'Other', slug: 'other' },
  { id: 'sold', label: 'Sold', slug: 'sold' },
  { id: 'lowstock', label: 'Low Stock', slug: 'low-stock' },
];

export const DEFAULT_INV_SECTION: InvSection = 'phones';

/**
 * Slugs that are no longer tabs but are still in links, bookmarks and the
 * browser history. `/inventory/devices` was the main inventory page for the
 * whole life of the app, so it resolves to Phones rather than 404-ing or
 * silently landing somewhere arbitrary.
 */
const LEGACY_SLUGS: Record<string, InvSection> = { devices: 'phones' };

// Build the path for a section, e.g. 'sold' → '/inventory/sold'.
export const invPath = (s: InvSection): string =>
  '/inventory/' + (INV_SECTIONS.find(x => x.id === s)?.slug ?? 'phones');

// Parse a pathname into a section. '/inventory' (no slug) → the default
// (phones). Returns null when the path isn't an inventory route at all.
export const parseInvPath = (pathname: string): InvSection | null => {
  const m = pathname.replace(/\/+$/, '').match(/^\/inventory(?:\/([a-z-]+))?$/);
  if (!m) return null;
  const slug = m[1];
  if (!slug) return DEFAULT_INV_SECTION;
  return INV_SECTIONS.find(x => x.slug === slug)?.id
    ?? LEGACY_SLUGS[slug]
    ?? DEFAULT_INV_SECTION;
};
