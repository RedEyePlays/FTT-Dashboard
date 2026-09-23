import { PcBuild } from '../types';
import { isoDateToMs } from './dates';

/**
 * THE SHARE LINK FOR A BUILD.
 *
 * The shop posts builds on Facebook Marketplace and wants one link per build
 * showing the specs, the price and what the same parts cost new elsewhere — so
 * a buyer sees the value without phoning.
 *
 * NEW LINKS ARE NO LONGER MINTED HERE. A share reference is now the short
 * readable code in domain/shareCode.ts ("kadamuze"), because these get typed
 * by hand off a Marketplace description. This module keeps the LONG token —
 * every link already in an advert is one of these and must go on resolving,
 * and the counter kiosk still uses `newShareToken` for a credential nobody
 * reads aloud. `isShareToken` below therefore still means exactly what it
 * says: is this one of the long ones. For "could this be any kind of share
 * reference", see domain/shareLink.ts's isShareRef.
 *
 * LINK-ONLY, BY DESIGN. There is no index and no way to browse: the only way
 * to reach a build is to hold its token. That puts the whole weight of access
 * control on the token being unguessable, which is why it is generated from a
 * cryptographically secure source and is long enough that guessing is not a
 * strategy — see SHARE_TOKEN_LENGTH.
 *
 * Pure: no DOM beyond the platform crypto API, no Firestore.
 */

/**
 * 26 characters from a 32-symbol alphabet — 130 bits.
 *
 * The brief asked for at least 22. Guessing one is not a thing anybody can do;
 * the reason to go past the minimum is that these links are pasted into
 * Marketplace posts and text messages, where they live indefinitely, and the
 * cost of a few extra characters is nothing.
 */
export const SHARE_TOKEN_LENGTH = 26;

/**
 * Crockford-ish base32: no vowels (so no token spells anything), and no
 * lookalike pairs (0/O, 1/I/L) because these get read aloud and retyped.
 * URL-safe by construction — nothing here needs escaping.
 */
const ALPHABET = '23456789bcdfghjkmnpqrstvwxyz';

/**
 * A new token, from crypto.getRandomValues.
 *
 * REJECTION SAMPLING, not modulo. `byte % 28` would make the first few symbols
 * of the alphabet measurably likelier than the rest, which quietly costs a
 * couple of bits of entropy; discarding out-of-range bytes costs nothing and
 * keeps the distribution flat.
 *
 * Throws rather than falling back to Math.random if the platform has no secure
 * source: a token that only looks random is worse than an error, because
 * nobody would ever find out.
 */
export const newShareToken = (length: number = SHARE_TOKEN_LENGTH): string => {
  const c = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (!c?.getRandomValues) {
    throw new Error('A share link needs a secure random source, and this browser has none.');
  }
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  let out = '';
  while (out.length < length) {
    const bytes = new Uint8Array(length);
    c.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit) continue;          // discard, don't fold
      out += ALPHABET[b % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
};

/** What a token looks like, for the page's own sanity check before calling. */
export const isShareToken = (v: unknown): boolean =>
  typeof v === 'string' && v.length >= 22 && v.length <= 64 && /^[a-z0-9]+$/.test(v);

/**
 * HOW LONG A SOLD BUILD'S LINK KEEPS WORKING: 30 days.
 *
 * A Marketplace post outlives the sale. Somebody clicking last week's link
 * should be told the machine is gone, not shown a dead page that looks like
 * the shop's site is broken — so a sold build keeps answering, clearly marked
 * "Sold", for a month. After that the link stops resolving entirely, because a
 * listing nobody has touched in a month is not something the shop is still
 * standing behind.
 */
export const SOLD_LINK_GRACE_DAYS = 30;

export type ShareState =
  /** No token, or it was cleared. The page must 404. */
  | 'off'
  /** Live: for sale, on the shelf. */
  | 'live'
  /** Sold or picked up, still inside the grace window. */
  | 'sold'
  /** Sold, and the grace window has passed. The page must 404. */
  | 'expired';

export interface ShareStateInput {
  shareToken?: string;
  status: PcBuild['status'];
  /** When the build reached a terminal state, epoch ms. */
  soldAt?: number;
}

const TERMINAL = new Set(['sold', 'picked_up', 'cancelled']);

/**
 * What a token should resolve to right now.
 *
 * A cancelled build is 'expired' immediately — there is nothing to show and
 * nothing to sell. A sold one runs out the grace period first.
 *
 * `soldAt` missing on a sold build is treated as still inside the window
 * rather than outside it: a build finished before this shipped has no stamp,
 * and silently 404ing a link the shop has already posted is the worse failure.
 */
export const shareState = (b: ShareStateInput, now: number = Date.now()): ShareState => {
  if (!b.shareToken) return 'off';
  if (b.status === 'cancelled') return 'expired';
  if (!TERMINAL.has(b.status)) return 'live';
  if (b.soldAt == null) return 'sold';
  const graceMs = SOLD_LINK_GRACE_DAYS * 24 * 60 * 60 * 1000;
  return now - b.soldAt > graceMs ? 'expired' : 'sold';
};

/** Whether the public page should render anything at all. */
export const isShareVisible = (s: ShareState): boolean => s === 'live' || s === 'sold';

/**
 * The customer-facing status word. Deliberately two states and no more: the
 * internal pipeline (planning → parts ordered → assembling → testing → ready)
 * is the shop's business, and a buyer reading "assembling" on a Marketplace
 * link learns only that it is not ready.
 */
export const publicStatusLabel = (s: ShareState): string => (s === 'sold' ? 'Sold' : 'Available');

/** The full link, for the copy button. */
export const shareUrl = (origin: string, token: string): string =>
  `${origin.replace(/\/+$/, '')}/build/${token}`;

/** The token in `/build/<token>`, or null. The page's own router. */
export const tokenFromPath = (pathname: string): string | null => {
  const m = /^\/build\/([^/?#]+)\/?$/.exec(pathname);
  if (!m) return null;
  const token = decodeURIComponent(m[1]);
  return isShareToken(token) ? token : null;
};

/** Remaining manufacturer warranty in plain words, or null. */
export const warrantyWords = (until: string | undefined, todayISO: string): string | null => {
  if (!until) return null;
  const end = isoDateToMs(until);
  const today = isoDateToMs(todayISO);
  if (!Number.isFinite(end) || !Number.isFinite(today)) return null;
  const days = Math.round((end - today) / (24 * 60 * 60 * 1000));
  if (days < 0) return null;                       // expired: say nothing
  if (days === 0) return 'maker warranty ends today';
  if (days < 45) return `${days} days of maker warranty left`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} months of maker warranty left`;
  return `${Math.floor(months / 12)} years of maker warranty left`;
};
