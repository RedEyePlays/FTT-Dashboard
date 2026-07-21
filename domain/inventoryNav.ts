// Inventory sub-section navigation. These map to clean URL routes so a refresh
// or a shared link restores the section, and browser back/forward works. The
// app is served with a SPA catch-all rewrite, so real paths resolve on reload.

export type InvSection = 'devices' | 'accessories' | 'sold' | 'lowstock';

export const INV_SECTIONS: { id: InvSection; label: string; slug: string }[] = [
  { id: 'devices', label: 'Devices', slug: 'devices' },
  { id: 'accessories', label: 'Accessories', slug: 'accessories' },
  { id: 'sold', label: 'Sold', slug: 'sold' },
  { id: 'lowstock', label: 'Low Stock', slug: 'low-stock' },
];

export const DEFAULT_INV_SECTION: InvSection = 'devices';

// Build the path for a section, e.g. 'sold' → '/inventory/sold'.
export const invPath = (s: InvSection): string =>
  '/inventory/' + (INV_SECTIONS.find(x => x.id === s)?.slug ?? 'devices');

// Parse a pathname into a section. '/inventory' (no slug) → the default
// (devices). Returns null when the path isn't an inventory route at all.
export const parseInvPath = (pathname: string): InvSection | null => {
  const m = pathname.replace(/\/+$/, '').match(/^\/inventory(?:\/([a-z-]+))?$/);
  if (!m) return null;
  const slug = m[1];
  if (!slug) return DEFAULT_INV_SECTION;
  return INV_SECTIONS.find(x => x.slug === slug)?.id ?? DEFAULT_INV_SECTION;
};
