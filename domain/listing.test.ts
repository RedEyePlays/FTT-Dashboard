import { describe, it, expect } from 'vitest';
import {
  LISTING_PLATFORMS, listingPlatformLabel, listingPlatformsLabel, hasListedElsewhere,
  listedElsewhereTitle, LISTED_ELSEWHERE_HINT,
} from './listing';

describe('LISTING_PLATFORMS', () => {
  it('exposes the 5 required platforms', () => {
    expect(LISTING_PLATFORMS.map(p => p.value)).toEqual(['bestbuy', 'kijiji', 'facebook', 'ebay', 'other']);
  });
});

describe('listingPlatformLabel', () => {
  it('maps each platform id to its display label', () => {
    expect(listingPlatformLabel('bestbuy')).toBe('Best Buy');
    expect(listingPlatformLabel('kijiji')).toBe('Kijiji');
    expect(listingPlatformLabel('facebook')).toBe('Facebook Marketplace');
    expect(listingPlatformLabel('ebay')).toBe('eBay');
    expect(listingPlatformLabel('other')).toBe('Other');
  });
});

describe('listingPlatformsLabel', () => {
  it('joins multiple platforms for a multi-platform item', () => {
    expect(listingPlatformsLabel(['bestbuy', 'ebay'])).toBe('Best Buy, eBay');
  });
  it('is a single label for one platform', () => {
    expect(listingPlatformsLabel(['kijiji'])).toBe('Kijiji');
  });
  it('is empty for none/undefined', () => {
    expect(listingPlatformsLabel([])).toBe('');
    expect(listingPlatformsLabel(undefined)).toBe('');
  });
});

describe('listedElsewhereTitle', () => {
  // The in-table/in-card indicator is now an ICON with no text, so
  // pointing at it must answer "which site?" immediately — the
  // platform names lead, and the explanation follows.
  it('LEADS with the platform name, so the hover answers the question at once', () => {
    expect(listedElsewhereTitle(['bestbuy']).startsWith('Best Buy')).toBe(true);
    expect(listedElsewhereTitle(['bestbuy', 'ebay']).startsWith('Best Buy, eBay')).toBe(true);
  });
  it('still carries the explanation, after the names', () => {
    expect(listedElsewhereTitle(['ebay'])).toContain(LISTED_ELSEWHERE_HINT);
    expect(LISTED_ELSEWHERE_HINT)
      .toBe('Also listed elsewhere — Quick Sale will warn before selling this in-store');
  });
  it('names every platform in FULL — no short forms, since width is no longer a constraint', () => {
    expect(listedElsewhereTitle(['bestbuy', 'facebook'])).toContain('Best Buy, Facebook Marketplace');
  });
  it('falls back to the bare hint when there are no platforms', () => {
    expect(listedElsewhereTitle([])).toBe(LISTED_ELSEWHERE_HINT);
    expect(listedElsewhereTitle(undefined)).toBe(LISTED_ELSEWHERE_HINT);
  });
});

describe('hasListedElsewhere', () => {
  it('true when any row has at least one platform', () => {
    expect(hasListedElsewhere([{ listedPlatforms: [] }, { listedPlatforms: ['ebay' as const] }])).toBe(true);
  });
  it('false when no row has any platform', () => {
    expect(hasListedElsewhere([{ listedPlatforms: [] }, { listedPlatforms: undefined }, {}])).toBe(false);
  });
  it('false for an empty set', () => {
    expect(hasListedElsewhere([])).toBe(false);
  });
});
