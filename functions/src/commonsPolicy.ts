/**
 * WHICH WIKIMEDIA COMMONS FILE MAY BE USED, AND WHETHER IT IS THE RIGHT ONE.
 *
 * A pure module: deviceImage.ts does the HTTP and the writing, and hands every
 * decision here. Two decisions, both of which fail CLOSED.
 *
 * 1. LICENCE. Commons is not a free-for-all. Every file carries its own terms,
 *    most require attribution, and some are non-commercial or no-derivatives —
 *    which a shop putting the image on a price tag cannot use. So the licence
 *    is READ from the API response and checked against a whitelist; anything
 *    unrecognised is refused. "It's on Commons so it's fine" is how a shop ends
 *    up with a takedown notice.
 *
 * 2. MATCH. A WRONG PHOTO IS WORSE THAN NO PHOTO. A customer looking at an
 *    iPhone 13 Pro listing showing an iPhone 14 has been misled, and the shop
 *    looks careless. So the model string must match closely, and a weak match
 *    stores nothing at all.
 */

/* ---------------- Licence ---------------- */

/**
 * Licence short-names that permit commercial use and modification.
 *
 * CC0 and PD need no attribution; the CC-BY family does, and that credit is
 * stored with the photo and shown wherever it is displayed publicly.
 *
 * Deliberately NOT here: anything -NC (non-commercial — a shop is commercial),
 * anything -ND (no derivatives — resizing is a derivative), "fair use", and
 * every non-free tag. A file whose licence we do not recognise is refused
 * rather than assumed.
 */
const ACCEPTABLE = [
  /^cc0/i,
  /^public domain/i,
  /^pd[-\s]/i,
  /^cc[-\s]by[-\s]?\d/i,            // cc-by-2.0, cc by 4.0
  /^cc[-\s]by[-\s]sa[-\s]?\d/i,     // cc-by-sa-4.0
  /^cc[-\s]?by$/i,
  /^cc[-\s]?by[-\s]?sa$/i,
  /^attribution$/i,
  /^attribution[-\s]share\s?alike$/i,
];

/** Anything matching these is refused even if something above also matches. */
const REFUSED = [
  /\bnc\b/i, /non[-\s]?commercial/i,
  /\bnd\b/i, /no[-\s]?deriv/i,
  /fair[-\s]?use/i, /non[-\s]?free/i, /copyright/i, /all rights reserved/i,
];

export interface CommonsLicence {
  /** `extmetadata.LicenseShortName` — e.g. "CC BY-SA 4.0". */
  shortName?: string;
  /** `extmetadata.UsageTerms`. */
  usageTerms?: string;
  /** `extmetadata.Artist`, which is HTML. */
  artist?: string;
  /** `extmetadata.AttributionRequired` — "true" / "false". */
  attributionRequired?: string;
}

/**
 * May this file be used on a commercial listing?
 *
 * Refusal wins: a string that matches an acceptable pattern AND a refused one
 * (e.g. "CC BY-NC 4.0", which starts like CC-BY) is refused.
 */
export function licenceAllowsCommercialUse(licence: CommonsLicence): boolean {
  const text = `${licence.shortName || ''} ${licence.usageTerms || ''}`.trim();
  if (!text) return false;                          // no licence stated: refuse
  for (const bad of REFUSED) if (bad.test(text)) return false;
  const name = (licence.shortName || '').trim();
  return ACCEPTABLE.some(ok => ok.test(name) || ok.test((licence.usageTerms || '').trim()));
}

/** Strip the HTML Commons returns in `Artist` down to a readable name. */
export function plainArtist(artistHtml?: string): string {
  return (artistHtml || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

/**
 * The credit line stored with the photo and shown wherever it appears.
 *
 * Always names the licence, and names the author when the file has one —
 * which is the attribution CC-BY requires. A public-domain file with no author
 * still gets a line, because saying where an image came from is good manners
 * even when it is not a legal condition.
 */
export function creditLine(licence: CommonsLicence, fileTitle: string): string {
  const artist = plainArtist(licence.artist);
  const name = (licence.shortName || 'Wikimedia Commons').trim();
  const file = fileTitle.replace(/^File:/i, '').replace(/\.[a-z0-9]+$/i, '');
  return artist
    ? `${artist} / Wikimedia Commons / ${name}`
    : `${file} / Wikimedia Commons / ${name}`;
}

/* ---------------- Match confidence ---------------- */

/** Lowercase, strip punctuation, collapse spaces. */
export function normalizeModel(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[_\-–—]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Words that appear in Commons filenames and say nothing about which model it
 * is. Stripped before comparing so "iPhone 13 Pro white background.jpg" is not
 * penalised for the words "white background".
 */
const NOISE = new Set([
  'file', 'jpg', 'jpeg', 'png', 'svg', 'photo', 'image', 'picture', 'img',
  'white', 'black', 'background', 'front', 'back', 'side', 'view', 'closeup',
  'close', 'up', 'isolated', 'cutout', 'transparent', 'vs', 'and', 'the', 'a',
]);

const tokens = (s: string): string[] =>
  normalizeModel(s).split(' ').filter(t => t && !NOISE.has(t));

/**
 * How well a Commons file title matches the model we asked for, 0..1.
 *
 * Every model token must appear — "iPhone 13" must not match "iPhone 13 Pro",
 * and more importantly "iPhone 13 Pro" must not match a file that is only
 * about the iPhone 13. Missing even one token collapses the score, because in
 * phone model names the distinguishing word is usually the last one.
 *
 * Extra words in the title are tolerated but cost a little, so between two
 * files that both contain every token the tighter title wins.
 */
export function matchConfidence(model: string, fileTitle: string): number {
  const want = tokens(model);
  const got = new Set(tokens(fileTitle));
  if (want.length === 0 || got.size === 0) return 0;

  const hits = want.filter(t => got.has(t)).length;
  if (hits < want.length) return 0;          // every token, or nothing

  // All present. Penalise a title stuffed with unrelated words.
  const extra = Math.max(0, got.size - want.length);
  return Math.max(0.5, 1 - extra * 0.08);
}

/**
 * The bar a candidate must clear.
 *
 * Set where it is because matchConfidence already returns 0 for any missing
 * token; this threshold is about rejecting titles that contain the model AND
 * a pile of other things ("Comparison of iPhone 13 Pro, 14 Pro and 15 Pro").
 */
export const MIN_MATCH_CONFIDENCE = 0.6;

export interface Candidate {
  title: string;
  licence: CommonsLicence;
  /** Pixel width of the original, used to skip icons and thumbnails. */
  width?: number;
}

/** A usable image is big enough to resize DOWN from. */
export const MIN_SOURCE_WIDTH = 500;

/**
 * The best candidate, or null.
 *
 * Null is a perfectly good answer and the caller treats it as one: no photo
 * found means no photo, quietly. Nothing is shown to staff, because "we
 * couldn't find a picture of your phone" is not information anybody needs.
 */
export function pickBest(model: string, candidates: Candidate[]): Candidate | null {
  let best: Candidate | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    if ((c.width ?? 0) < MIN_SOURCE_WIDTH) continue;
    if (!licenceAllowsCommercialUse(c.licence)) continue;
    const score = matchConfidence(model, c.title);
    if (score < MIN_MATCH_CONFIDENCE) continue;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

/**
 * The search phrase. Brand AND model, because "13 Pro" alone finds nothing
 * useful and "Apple" alone finds everything.
 */
export function searchPhrase(brand: string, model: string): string {
  const b = (brand || '').trim();
  const m = (model || '').trim();
  if (!m) return '';
  return normalizeModel(m).includes(normalizeModel(b)) || !b ? m : `${b} ${m}`;
}

/**
 * THE CACHE KEY: the MODEL, not the device.
 *
 * Two iPhone 13 Pros must not cost two fetches or two stored copies. Keyed on
 * the normalized brand+model so "iPhone 13 Pro" and "iphone  13   pro" are the
 * same entry, and stored per workspace.
 */
export function modelCacheKey(brand: string, model: string): string {
  const key = normalizeModel(searchPhrase(brand, model)).replace(/ /g, '-');
  return key.slice(0, 140);
}

/** Is there enough to search on at all? */
export function canSearch(brand: string, model: string): boolean {
  return tokens(searchPhrase(brand, model)).length >= 2;
}
