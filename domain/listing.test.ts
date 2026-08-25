import { describe, it, expect } from 'vitest';
import { LISTING_PLATFORMS, listingPlatformLabel, listingPlatformsLabel, hasListedElsewhere } from './listing';

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
