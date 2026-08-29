import { ListingPlatform } from '../types';

// Multi-platform listing safeguards: an item can be flagged as ALSO listed on
// one or more external marketplaces while it's sitting in-store inventory, so
// Quick Sale can warn before double-selling it. Pure display/decision helpers
// live here; the warning-gate state lives in hooks/useCheckout.ts (mirrors
// its existing $0-price safeguard pattern) and the post-sale reminder is
// built where a sale actually commits (App.tsx's handleSellCart).

export const LISTING_PLATFORMS: { value: ListingPlatform; label: string }[] = [
  { value: 'bestbuy', label: 'Best Buy' },
  { value: 'kijiji', label: 'Kijiji' },
  { value: 'facebook', label: 'Facebook Marketplace' },
  { value: 'ebay', label: 'eBay' },
  { value: 'other', label: 'Other' },
];

const LABEL_OF = new Map(LISTING_PLATFORMS.map(p => [p.value, p.label]));

export const listingPlatformLabel = (p: ListingPlatform): string => LABEL_OF.get(p) || p;

/** "Best Buy, eBay" — the platform list rendered into warning/reminder text. */
export const listingPlatformsLabel = (platforms?: ListingPlatform[]): string =>
  (platforms || []).map(listingPlatformLabel).join(', ');

// Short forms for the ONE place a platform name has to fit a narrow fixed
// column (the inventory table's Item cell) rather than a free-flowing
// sentence. Only 'facebook' actually differs — "Facebook Marketplace" is the
// single label wide enough to blow out that column on its own. Every other
// platform reuses its normal label, so there is no second naming scheme to
// keep in sync: this map is a fallback, not a parallel set of names.
const SHORT_LABEL_OF: Partial<Record<ListingPlatform, string>> = { facebook: 'Facebook' };

export const listingPlatformShortLabel = (p: ListingPlatform): string =>
  SHORT_LABEL_OF[p] || listingPlatformLabel(p);

/**
 * The most compact honest rendering of a device's listings, for an indicator
 * that shares a narrow cell with editable content: the (short) platform name
 * when there's exactly one, otherwise a count. The count form is deliberate —
 * with 2+ platforms even short names ("Best Buy, eBay") push past the column,
 * and the exact list is always one hover away in listedElsewhereTitle below.
 */
export function listingBadgeText(platforms?: ListingPlatform[]): string {
  const ps = platforms || [];
  if (ps.length === 0) return '';
  return ps.length === 1 ? listingPlatformShortLabel(ps[0]) : `${ps.length} sites`;
}

/**
 * The hover text on a listed-elsewhere indicator. Leads with the same sentence
 * the mobile item card's badge carries (so the two views explain the flag
 * identically), then names every platform — which is what makes the compact
 * "N sites" badge above safe to show in a narrow cell.
 */
export const LISTED_ELSEWHERE_HINT =
  'Also listed elsewhere — Quick Sale will warn before selling this in-store';

export function listedElsewhereTitle(platforms?: ListingPlatform[]): string {
  const label = listingPlatformsLabel(platforms);
  return label ? `${LISTED_ELSEWHERE_HINT}. Listed on: ${label}` : LISTED_ELSEWHERE_HINT;
}

/** Any row in the set flagged as listed elsewhere — gates the Quick Sale warning. */
export function hasListedElsewhere<T extends { listedPlatforms?: ListingPlatform[] }>(rows: T[]): boolean {
  return rows.some(r => (r.listedPlatforms?.length || 0) > 0);
}
