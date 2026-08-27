import { Customer } from '../types';
import { toISODate } from './dates';

// Google review requests. Deliberately dumb about sentiment: every eligible
// customer gets the same request, regardless of anything about how happy
// they seemed — pre-screening by expected sentiment (asking "were you
// happy?" and only sending the link to yes-answers) is exactly what
// Google's review policies prohibit. The only filters here are about NOT
// bothering someone who shouldn't be asked at all.

export interface ReviewEligibilityInput {
  customer: Pick<Customer, 'reviewOptOut' | 'lastReviewRequestedAt'>;
  now: number;
  repeatWindowDays: number;
  // Pass whichever applies to what's being requested — a completed repair
  // checks isWarrantyClaim/isCancelled, a completed sale checks isReversed.
  isWarrantyClaim?: boolean;
  isCancelled?: boolean;
  isReversed?: boolean; // voided or returned sale
}

export interface ReviewEligibility {
  eligible: boolean;
  reason?: 'opted_out' | 'warranty_claim' | 'cancelled' | 'reversed' | 'requested_recently';
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether a review request may be sent right now, and if not, why — never
 * gated on anything about how the visit went beyond "was it an unhappy
 * path" (warranty/void/cancel), and never on predicted sentiment. */
export const isEligibleForReviewRequest = (input: ReviewEligibilityInput): ReviewEligibility => {
  if (input.customer.reviewOptOut) return { eligible: false, reason: 'opted_out' };
  if (input.isWarrantyClaim) return { eligible: false, reason: 'warranty_claim' };
  if (input.isCancelled) return { eligible: false, reason: 'cancelled' };
  if (input.isReversed) return { eligible: false, reason: 'reversed' };
  const last = input.customer.lastReviewRequestedAt;
  if (last && input.now - last < Math.max(0, input.repeatWindowDays) * DAY_MS) return { eligible: false, reason: 'requested_recently' };
  return { eligible: true };
};

export interface ReviewMessageVars { shopName: string; name?: string; link: string }

/** Fill {shopName}, {name} and {link} placeholders. Unknown placeholders are
 * left as-is rather than silently dropped, so a typo in the template is
 * visible in the preview rather than vanishing. */
export const renderReviewMessage = (template: string, vars: ReviewMessageVars): string =>
  template
    .replace(/\{shopName\}/g, vars.shopName)
    .replace(/\{name\}/g, vars.name || 'there')
    .replace(/\{link\}/g, vars.link);

/** A `sms:` URI that pre-fills the message body. iOS and Android disagree on
 * the separator before `body=` (`&` vs `?`) — callers on the UI layer that
 * can read the platform should pass it; defaults to `?` (Android, and most
 * current iOS). */
export const smsDeepLink = (phone: string, message: string, sep: '?' | '&' = '?'): string =>
  `sms:${encodeURIComponent(phone)}${sep}body=${encodeURIComponent(message)}`;

/** A wa.me deep link pre-filled with the message — works without the
 * recipient needing to already be a contact. */
export const whatsappDeepLink = (phone: string, message: string): string =>
  `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`;

// --- Rate limiting ---------------------------------------------------------
// A soft, client-side cap — there's no backend queue to rate-limit through
// (see the PR description: no SMS/email Cloud Function exists yet), so this
// only protects against one staff member firing off a burst of requests in
// one session, not a determined bypass. Counts customers whose
// lastReviewRequestedAt falls on the given date.

export const DEFAULT_DAILY_REVIEW_REQUEST_CAP = 25;

export const reviewRequestsSentOn = (customers: Pick<Customer, 'lastReviewRequestedAt'>[], dateISO: string): number =>
  customers.filter(c => c.lastReviewRequestedAt != null && toISODate(c.lastReviewRequestedAt) === dateISO).length;

export const underDailyReviewRequestCap = (sentToday: number, cap: number = DEFAULT_DAILY_REVIEW_REQUEST_CAP): boolean =>
  sentToday < cap;
