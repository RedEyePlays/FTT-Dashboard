import { describe, it, expect } from 'vitest';
import {
  SHARE_TOKEN_LENGTH, SOLD_LINK_GRACE_DAYS, isShareToken, isShareVisible,
  newShareToken, publicStatusLabel, shareState, shareUrl, tokenFromPath, warrantyWords,
} from './buildShare';

/**
 * THE SHARE LINK. Link-only means there is no index and no way to browse, so
 * the token being unguessable IS the access control. That is the property
 * worth testing hardest.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 24);

describe('the token', () => {
  it('is long enough that guessing is not a strategy', () => {
    // 26 symbols from a 28-symbol alphabet — comfortably past the 22 asked for.
    expect(SHARE_TOKEN_LENGTH).toBeGreaterThanOrEqual(22);
    expect(newShareToken()).toHaveLength(SHARE_TOKEN_LENGTH);
  });

  it('is URL-safe and never needs escaping', () => {
    for (let i = 0; i < 50; i++) {
      const t = newShareToken();
      expect(t).toMatch(/^[a-z0-9]+$/);
      expect(encodeURIComponent(t)).toBe(t);
    }
  });

  it('DOES NOT REPEAT — a thousand tokens, a thousand values', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) seen.add(newShareToken());
    expect(seen.size).toBe(1000);
  });

  it('uses the whole alphabet roughly evenly — no modulo bias', () => {
    // `byte % 28` would make the first few symbols measurably likelier and
    // quietly cost a couple of bits. Rejection sampling keeps it flat.
    const counts = new Map<string, number>();
    for (let i = 0; i < 400; i++) {
      for (const ch of newShareToken()) counts.set(ch, (counts.get(ch) || 0) + 1);
    }
    expect(counts.size).toBeGreaterThan(20);
    const values = [...counts.values()];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    // A biased implementation shows a ~2× gap between the favoured symbols and
    // the rest; an even one stays well inside this.
    expect(Math.max(...values)).toBeLessThan(mean * 1.6);
    expect(Math.min(...values)).toBeGreaterThan(mean * 0.4);
  });

  it('has no vowels, so no token accidentally spells anything', () => {
    for (let i = 0; i < 100; i++) expect(newShareToken()).not.toMatch(/[aeiou]/);
  });

  it('recognises a real token and refuses a short or odd one', () => {
    expect(isShareToken(newShareToken())).toBe(true);
    expect(isShareToken('short')).toBe(false);
    expect(isShareToken('HAS-UPPERCASE-AND-DASHES-1234')).toBe(false);
    expect(isShareToken('')).toBe(false);
    expect(isShareToken(undefined)).toBe(false);
    expect(isShareToken('../../etc/passwd')).toBe(false);
  });
});

describe('which links resolve', () => {
  const live = { shareToken: 'b7k2m9qrstvwxyz34567bcdfgh', status: 'ready' as const };

  it('a build with no token 404s — there is nothing to show', () => {
    expect(shareState({ status: 'ready' })).toBe('off');
    expect(shareState({ ...live, shareToken: '' })).toBe('off');
  });

  it('CLEARING the token kills the link immediately', () => {
    expect(shareState(live)).toBe('live');
    expect(shareState({ ...live, shareToken: undefined })).toBe('off');
    expect(isShareVisible('off')).toBe(false);
  });

  it('a build still being worked on is live at any pipeline stage', () => {
    for (const status of ['planning', 'parts_ordered', 'assembling', 'testing', 'ready'] as const) {
      expect({ status, s: shareState({ ...live, status }) }).toEqual({ status, s: 'live' });
    }
  });

  it('a SOLD build keeps working for the grace period, then stops', () => {
    // A Marketplace post outlives the sale. Somebody clicking last week's link
    // should be told it is gone, not shown a dead page.
    expect(SOLD_LINK_GRACE_DAYS).toBe(30);
    const sold = { ...live, status: 'sold' as const };
    expect(shareState({ ...sold, soldAt: NOW - 29 * DAY }, NOW)).toBe('sold');
    expect(shareState({ ...sold, soldAt: NOW - 31 * DAY }, NOW)).toBe('expired');
    expect(isShareVisible('sold')).toBe(true);
    expect(isShareVisible('expired')).toBe(false);
  });

  it('a CANCELLED build stops at once — there is nothing to sell', () => {
    expect(shareState({ ...live, status: 'cancelled', soldAt: NOW }, NOW)).toBe('expired');
  });

  it('a sold build with no timestamp keeps working rather than 404ing a posted link', () => {
    expect(shareState({ ...live, status: 'sold' }, NOW)).toBe('sold');
  });

  it('says only Available or Sold — the pipeline is the shop\'s business', () => {
    expect(publicStatusLabel('live')).toBe('Available');
    expect(publicStatusLabel('sold')).toBe('Sold');
  });
});

describe('the link itself', () => {
  it('is <host>/build/<token>, with no double slash', () => {
    expect(shareUrl('https://status.flipthat.tech', 'abc')).toBe('https://status.flipthat.tech/build/abc');
    expect(shareUrl('https://status.flipthat.tech/', 'abc')).toBe('https://status.flipthat.tech/build/abc');
  });

  it('reads the token back out of a path', () => {
    const t = newShareToken();
    expect(tokenFromPath(`/build/${t}`)).toBe(t);
    expect(tokenFromPath(`/build/${t}/`)).toBe(t);
  });

  it('refuses anything that is not a build link', () => {
    for (const p of ['/', '/build', '/build/', '/build/short', '/other/x', '/build/a/b']) {
      expect({ p, t: tokenFromPath(p) }).toEqual({ p, t: null });
    }
  });

  it('refuses a token-shaped path traversal attempt', () => {
    expect(tokenFromPath('/build/..%2F..%2Fetc%2Fpasswd')).toBeNull();
  });
});

describe('remaining maker warranty, in words', () => {
  const today = '2026-09-24';

  it('reads as a person would say it', () => {
    expect(warrantyWords('2026-09-24', today)).toBe('maker warranty ends today');
    expect(warrantyWords('2026-10-04', today)).toBe('10 days of maker warranty left');
    expect(warrantyWords('2027-03-24', today)).toBe('6 months of maker warranty left');
    expect(warrantyWords('2029-09-24', today)).toBe('3 years of maker warranty left');
  });

  it('says NOTHING once it has expired, rather than something negative', () => {
    expect(warrantyWords('2026-09-23', today)).toBeNull();
    expect(warrantyWords(undefined, today)).toBeNull();
    expect(warrantyWords('not a date', today)).toBeNull();
  });
});
