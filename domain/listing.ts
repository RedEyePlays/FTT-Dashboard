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

// NOTE: the in-table indicator carries NO text at all any more — it's a
// tiny icon, and the platform name lives in its hover/accessible label
// (listedElsewhereTitle below). The short-label map and badge-text helper
// that used to size a name into that cell went with it rather than being
// left behind as unused exports.

/**
 * The hover text on a listed-elsewhere indicator.
 *
 * Leads with the PLATFORM NAMES — "Best Buy", "Best Buy, eBay" — because
 * the indicator is now icon-only: pointing at it must answer "which site
 * is this on?" immediately, not after a sentence of explanation. The
 * explanation follows, so the flag still says what it means to anyone
 * seeing it for the first time.
 *
 * This is also the accessible name of the icon (aria-label), so a
 * screen reader announces the site rather than "image".
 */
export const LISTED_ELSEWHERE_HINT =
  'Also listed elsewhere — Quick Sale will warn before selling this in-store';

export function listedElsewhereTitle(platforms?: ListingPlatform[]): string {
  const label = listingPlatformsLabel(platforms);
  return label ? `${label} — ${LISTED_ELSEWHERE_HINT}` : LISTED_ELSEWHERE_HINT;
}

/** Any row in the set flagged as listed elsewhere — gates the Quick Sale warning. */
export function hasListedElsewhere<T extends { listedPlatforms?: ListingPlatform[] }>(rows: T[]): boolean {
  return rows.some(r => (r.listedPlatforms?.length || 0) > 0);
}
