import { describe, it, expect } from 'vitest';
import {
  LISTING_PLATFORMS, listingPlatformLabel, listingPlatformsLabel, hasListedElsewhere,
  listingPlatformShortLabel, listingBadgeText, listedElsewhereTitle, LISTED_ELSEWHERE_HINT,
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

describe('listingPlatformShortLabel', () => {
  it('shortens only the one label wide enough to blow out a narrow column', () => {
    expect(listingPlatformShortLabel('facebook')).toBe('Facebook');
  });
  it('reuses the normal label for every other platform — no parallel naming scheme', () => {
    for (const p of ['bestbuy', 'kijiji', 'ebay', 'other'] as const) {
      expect(listingPlatformShortLabel(p)).toBe(listingPlatformLabel(p));
    }
  });
});

describe('listingBadgeText', () => {
  it('names the platform when there is exactly one', () => {
    expect(listingBadgeText(['bestbuy'])).toBe('Best Buy');
    expect(listingBadgeText(['ebay'])).toBe('eBay');
  });
  it('uses the SHORT name for the one long label, even alone', () => {
    expect(listingBadgeText(['facebook'])).toBe('Facebook');
  });
  it('collapses 2+ platforms to a count rather than a list that would overflow the cell', () => {
    expect(listingBadgeText(['bestbuy', 'ebay'])).toBe('2 sites');
    expect(listingBadgeText(['bestbuy', 'kijiji', 'facebook', 'ebay'])).toBe('4 sites');
  });
  it('stays short no matter how many platforms are set', () => {
    expect(listingBadgeText(LISTING_PLATFORMS.map(p => p.value)).length).toBeLessThanOrEqual(8);
  });
  it('is empty for none/undefined, so nothing renders for an unlisted item', () => {
    expect(listingBadgeText([])).toBe('');
    expect(listingBadgeText(undefined)).toBe('');
  });
});

describe('listedElsewhereTitle', () => {
  it('leads with the same sentence the mobile item card badge carries', () => {
    expect(listedElsewhereTitle(['ebay'])).toContain(LISTED_ELSEWHERE_HINT);
    expect(LISTED_ELSEWHERE_HINT)
      .toBe('Also listed elsewhere — Quick Sale will warn before selling this in-store');
  });
  it('names every platform in full — what makes the compact badge safe', () => {
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
