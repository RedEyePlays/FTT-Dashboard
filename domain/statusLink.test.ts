import { describe, it, expect } from 'vitest';
import { statusPageUrl, STATUS_PAGE_ORIGIN } from './statusLink';

describe('statusPageUrl', () => {
  it('points at status.flipthat.tech, never app.flipthat.tech', () => {
    expect(statusPageUrl('RPR-000123')).toContain('status.flipthat.tech');
    expect(statusPageUrl('RPR-000123')).not.toContain('app.flipthat.tech');
  });

  it('includes the ticket as a query param', () => {
    expect(statusPageUrl('RPR-000123')).toBe('https://status.flipthat.tech/?ticket=RPR-000123');
  });

  it('url-encodes the ticket value', () => {
    expect(statusPageUrl('RPR 123/A')).toBe('https://status.flipthat.tech/?ticket=RPR%20123%2FA');
  });

  it('falls back to the bare origin when no ticket is given', () => {
    expect(statusPageUrl('')).toBe(STATUS_PAGE_ORIGIN);
    expect(statusPageUrl('   ')).toBe(STATUS_PAGE_ORIGIN);
  });
});
