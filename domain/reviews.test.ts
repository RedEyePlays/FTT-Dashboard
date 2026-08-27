import { describe, it, expect } from 'vitest';
import {
  isEligibleForReviewRequest, renderReviewMessage, smsDeepLink, whatsappDeepLink,
  reviewRequestsSentOn, underDailyReviewRequestCap, DEFAULT_DAILY_REVIEW_REQUEST_CAP,
} from './reviews';

const NOW = new Date('2026-07-15T12:00:00Z').getTime();

describe('isEligibleForReviewRequest', () => {
  it('is eligible with no flags and no prior request', () => {
    expect(isEligibleForReviewRequest({ customer: {}, now: NOW, repeatWindowDays: 90 })).toEqual({ eligible: true });
  });

  it('never sends to an opted-out customer', () => {
    expect(isEligibleForReviewRequest({ customer: { reviewOptOut: true }, now: NOW, repeatWindowDays: 90 }))
      .toEqual({ eligible: false, reason: 'opted_out' });
  });

  it('skips a warranty claim', () => {
    expect(isEligibleForReviewRequest({ customer: {}, now: NOW, repeatWindowDays: 90, isWarrantyClaim: true }))
      .toEqual({ eligible: false, reason: 'warranty_claim' });
  });

  it('skips a cancelled repair', () => {
    expect(isEligibleForReviewRequest({ customer: {}, now: NOW, repeatWindowDays: 90, isCancelled: true }))
      .toEqual({ eligible: false, reason: 'cancelled' });
  });

  it('skips a reversed (voided/returned) sale', () => {
    expect(isEligibleForReviewRequest({ customer: {}, now: NOW, repeatWindowDays: 90, isReversed: true }))
      .toEqual({ eligible: false, reason: 'reversed' });
  });

  it('never re-requests within the configured window', () => {
    const requestedAt = NOW - 30 * 24 * 60 * 60 * 1000; // 30 days ago
    expect(isEligibleForReviewRequest({ customer: { lastReviewRequestedAt: requestedAt }, now: NOW, repeatWindowDays: 90 }))
      .toEqual({ eligible: false, reason: 'requested_recently' });
  });

  it('is eligible again once the window has fully elapsed', () => {
    const requestedAt = NOW - 91 * 24 * 60 * 60 * 1000; // 91 days ago
    expect(isEligibleForReviewRequest({ customer: { lastReviewRequestedAt: requestedAt }, now: NOW, repeatWindowDays: 90 }))
      .toEqual({ eligible: true });
  });

  it('exactly at the window boundary (90 days elapsed) is eligible — the window has fully passed', () => {
    const requestedAt = NOW - 90 * 24 * 60 * 60 * 1000; // exactly 90 days ago
    expect(isEligibleForReviewRequest({ customer: { lastReviewRequestedAt: requestedAt }, now: NOW, repeatWindowDays: 90 }).eligible).toBe(true);
  });
});

describe('renderReviewMessage', () => {
  it('fills shopName, name and link', () => {
    const msg = renderReviewMessage('Hi {name}, thanks for choosing {shopName}! {link}', { shopName: 'FlipThatTech', name: 'Jane', link: 'https://g.page/x' });
    expect(msg).toBe('Hi Jane, thanks for choosing FlipThatTech! https://g.page/x');
  });

  it('falls back to a generic greeting when no name is given', () => {
    const msg = renderReviewMessage('Hi {name}!', { shopName: 'S', link: 'L' });
    expect(msg).toBe('Hi there!');
  });
});

describe('deep links', () => {
  it('smsDeepLink encodes the phone and message, defaulting to a ? separator', () => {
    expect(smsDeepLink('555-1234', 'Leave us a review!')).toBe('sms:555-1234?body=Leave%20us%20a%20review!');
  });
  it('smsDeepLink accepts an explicit & separator for iOS', () => {
    expect(smsDeepLink('555-1234', 'hi', '&')).toBe('sms:555-1234&body=hi');
  });
  it('whatsappDeepLink strips non-digits from the phone number', () => {
    expect(whatsappDeepLink('+1 (555) 123-4567', 'hi')).toBe('https://wa.me/15551234567?text=hi');
  });
});

describe('rate limiting', () => {
  it('counts requests sent on a given date', () => {
    const customers = [
      { lastReviewRequestedAt: new Date('2026-07-15T10:00:00Z').getTime() },
      { lastReviewRequestedAt: new Date('2026-07-15T20:00:00Z').getTime() },
      { lastReviewRequestedAt: new Date('2026-07-14T10:00:00Z').getTime() },
      {},
    ];
    expect(reviewRequestsSentOn(customers, '2026-07-15')).toBe(2);
  });

  it('the default cap is a sane positive number', () => {
    expect(DEFAULT_DAILY_REVIEW_REQUEST_CAP).toBeGreaterThan(0);
  });

  it('under/at/over the cap', () => {
    expect(underDailyReviewRequestCap(0, 5)).toBe(true);
    expect(underDailyReviewRequestCap(4, 5)).toBe(true);
    expect(underDailyReviewRequestCap(5, 5)).toBe(false);
    expect(underDailyReviewRequestCap(6, 5)).toBe(false);
  });
});
