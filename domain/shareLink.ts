import { SHARE_LINK_HOST } from './statusLink';
import { isShareCode } from './shareCode';

/**
 * THE LINK, IN THE FORM IT GETS PASTED INTO AN ADVERT.
 *
 * Facebook Marketplace does not make links in a description clickable. What
 * the shop is really writing is a line of text a stranger reads off their
 * phone and types into a browser, so this module exists to make that line as
 * short and as forgiving as it can be:
 *
 *   /b/<code>                 not /build/<26 characters of noise>
 *   flipthat.tech/b/kadamuze  displayed without the scheme, because nobody
 *                             types "https://" and it only makes the line longer
 *
 * The HOST is config (statusLink.ts), never a literal in a component.
 *
 * Pure: no DOM, no Firestore.
 */

/** The short route. The long /build/<token> route still resolves — see below. */
export const SHARE_PATH_PREFIX = 'b';

/** What goes in an ad: no scheme, nothing to type that carries no meaning. */
export const shareLinkDisplay = (code: string, host: string = SHARE_LINK_HOST): string =>
  `${host}/${SHARE_PATH_PREFIX}/${code}`;

/** The real, clickable URL — for the QR code, the browser and the Copy button. */
export const shareLinkUrl = (code: string, host: string = SHARE_LINK_HOST): string =>
  `https://${shareLinkDisplay(code, host)}`;

/**
 * The line that goes into a Marketplace description.
 *
 * "Full specs and photos" rather than "click here": the link is not clickable,
 * and saying what is on the other side is what makes somebody bother typing it.
 */
export const shareAdLine = (code: string, host: string = SHARE_LINK_HOST): string =>
  `Full specs and photos: ${shareLinkDisplay(code, host)}`;

/**
 * Pull a code out of whatever somebody has in their hand.
 *
 * Customers and staff paste all of these, and every one of them means the same
 * build:
 *
 *   kadamuze
 *   /b/kadamuze
 *   flipthat.tech/b/kadamuze
 *   https://www.flipthat.tech/b/kadamuze/
 *   https://status.flipthat.tech/build/b7k2m9qrstvwxyz34567bcdfgh
 *
 * Host-agnostic on purpose: the apex, the www form and the status host are all
 * the same site, and a parser that insisted on one of them would reject a link
 * the shop itself had posted.
 */
export const codeFromShareInput = (input: string): string | null => {
  let s = (input || '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z]+:\/\//, '');          // scheme, if they typed one
  s = s.replace(/[?#].*$/, '');                // query and fragment
  s = s.replace(/\/+$/, '');                   // a trailing slash
  // Either route, on any host, with or without one.
  const m = /(?:^|\/)(?:b|build)\/([a-z0-9]+)$/.exec(s);
  if (m) return m[1];
  // A bare code, with no path at all. A hostname is not a code, so anything
  // still carrying a dot or a slash is rejected rather than half-parsed.
  if (/[./]/.test(s)) return null;
  return /^[a-z0-9]+$/.test(s) ? s : null;
};

/**
 * Which format a stored reference is in. Both resolve; only one is minted.
 *
 * EXISTING LINKS ARE NOT INVALIDATED. A 26-character token in an advert that
 * has been up for a month keeps working exactly as it did — the page and the
 * callable accept both, and the only difference is what a NEW link looks like.
 */
export type ShareRefFormat = 'code' | 'token' | 'custom' | 'invalid';

export const shareRefFormat = (v: unknown): ShareRefFormat => {
  if (typeof v !== 'string') return 'invalid';
  const s = v.trim();
  if (!s) return 'invalid';
  if (isShareCode(s)) return 'code';
  if (/^[a-z0-9]{22,64}$/.test(s)) return 'token';
  if (/^[a-z]{4,24}$/.test(s)) return 'custom';
  return 'invalid';
};

/**
 * The cheap shape check before a lookup — ONE definition, shared by the page
 * router and the callable so the two can never disagree about what is worth
 * asking the database.
 *
 * It is a filter, not a security boundary: the database is what decides
 * whether a reference resolves, and an unknown reference and a revoked one
 * give the same answer.
 */
export const isShareRef = (v: unknown): boolean => shareRefFormat(v) !== 'invalid';
