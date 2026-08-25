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

/** Any row in the set flagged as listed elsewhere — gates the Quick Sale warning. */
export function hasListedElsewhere<T extends { listedPlatforms?: ListingPlatform[] }>(rows: T[]): boolean {
  return rows.some(r => (r.listedPlatforms?.length || 0) > 0);
}
