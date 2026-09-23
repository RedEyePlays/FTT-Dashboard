/**
 * THE SHORT SHARE CODE — "kodamuze", not "b7k2m9qrstvwxyz34567bcdfgh".
 *
 * WHY IT CHANGED. The 26-character token is unguessable and unreadable, and
 * the place these links actually live is a Facebook Marketplace description,
 * where links are NOT clickable. A customer has to read the code off their
 * screen and type it into a browser. Nobody types 26 random characters; a lot
 * of people will type eight.
 *
 * PRONOUNCEABLE BY CONSTRUCTION. Consonant, vowel, consonant, vowel — four
 * syllables, always. That is what makes it readable aloud over the phone and
 * typeable from memory after one glance; a random jumble of the same length is
 * neither, however much entropy it carries.
 *
 * THE ALPHABET EXCLUDES ANYTHING AMBIGUOUS. No l (reads as 1 or I), no i, no o
 * (read as 1 and 0), no digits at all, no uppercase — so there is no shift key,
 * no case to get wrong, and nothing that changes meaning when read off a photo
 * of a screen in a shop window. q, x and y are out as well: q needs a u, x is
 * not a syllable, and y is a vowel or a consonant depending on the word.
 *
 * THE TRADE-OFF IS DELIBERATE AND IT IS A REAL ONE — see CODE_SPACE below.
 *
 * Pure: no DOM beyond the platform crypto API, no Firestore.
 */

/** Committed in the repo, not derived, so the code space cannot drift. */
export const CONSONANTS = 'bcdfghjkmnprstvwz';   // no l, q, x, y
export const VOWELS = 'aeu';                      // no i, no o

export const SHARE_CODE_SYLLABLES = 4;
export const SHARE_CODE_LENGTH = SHARE_CODE_SYLLABLES * 2;   // 8

/**
 * HOW MANY CODES EXIST: 17⁴ × 3⁴ = 6,765,201. About 2²², and the honest
 * number — alternating syllables buy readability by spending entropy, and a
 * naive "8 characters from 20" (2.6 × 10¹⁰) would overstate this by four
 * orders of magnitude.
 *
 * That is fine here, and only here. What a code protects is a PC the shop is
 * advertising publicly, with no cost, no customer and no serial on the page
 * (functions/src/publicBuildPolicy.ts). The worst outcome of a guessed code is
 * that somebody sees an advert they were not shown — which is what an advert
 * is for.
 *
 * And it cannot be swept. The lookup is throttled per IP; at even one attempt
 * per second a single address needs 78 days of uninterrupted guessing to cover
 * the space once, and the throttle is far tighter than that. If the shop ever
 * wants more headroom, raising SHARE_CODE_SYLLABLES to 5 multiplies it by 51.
 */
export const CODE_SPACE = Math.pow(CONSONANTS.length, SHARE_CODE_SYLLABLES)
  * Math.pow(VOWELS.length, SHARE_CODE_SYLLABLES);

/**
 * Codes that must never be handed out.
 *
 * Alternating syllables land on real words by accident — that is the point of
 * them — and these go into public adverts under the shop's name. A match is
 * regenerated, never used.
 *
 * Matched as SUBSTRINGS, and the list deliberately includes entries that the
 * alternating pattern cannot actually produce (nothing here has two adjacent
 * consonants). They cost nothing, and the next person to widen the alphabet or
 * change the pattern should not have to rediscover them.
 */
export const BLOCKED_FRAGMENTS = [
  'fuk', 'fuc', 'fak', 'kut', 'kun', 'suk', 'suc', 'puta', 'kaka', 'caca',
  'pupu', 'dupa', 'puke', 'pube', 'pus', 'tit', 'sex', 'seks', 'cum', 'jiz',
  'vag', 'pen', 'bum', 'ass', 'arse', 'crap', 'turd', 'fart', 'shet', 'shat',
  'twat', 'wank', 'knob', 'hoe', 'rape', 'rapa', 'nazi', 'kkk', 'damn', 'hell',
  'bich', 'dik', 'dic', 'prik', 'tard', 'gash', 'muff', 'nut', 'wee',
] as const;

/** Is this code safe to advertise? */
export const isCleanCode = (code: string): boolean => {
  const c = code.toLowerCase();
  return !BLOCKED_FRAGMENTS.some(bad => c.includes(bad));
};

/** The shape: eight letters, strictly alternating consonant and vowel. */
export const isShareCode = (v: unknown): boolean => {
  if (typeof v !== 'string' || v.length !== SHARE_CODE_LENGTH) return false;
  for (let i = 0; i < v.length; i++) {
    const set = i % 2 === 0 ? CONSONANTS : VOWELS;
    if (!set.includes(v[i])) return false;
  }
  return true;
};

/**
 * One symbol from `alphabet`, uniformly.
 *
 * REJECTION SAMPLING, not modulo — carried over from the long token unchanged,
 * and for the same reason: `byte % 17` would make the first few consonants
 * measurably likelier than the last few, which is a bias nobody would ever
 * notice and which quietly shrinks an already small space.
 *
 * THROWS rather than falling back to Math.random when there is no secure
 * source. A code that only looks random is worse than an error, because
 * nobody would find out.
 */
const pick = (alphabet: string, crypto: Crypto): string => {
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  const bytes = new Uint8Array(8);
  for (;;) {
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= limit) continue;              // discard, don't fold
      return alphabet[b % alphabet.length];
    }
  }
};

const secureCrypto = (): Crypto => {
  const c = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (!c?.getRandomValues) {
    throw new Error('A share link needs a secure random source, and this browser has none.');
  }
  return c;
};

/** One candidate, without the cleanliness check. Exported for the tests. */
export const rawShareCode = (): string => {
  const c = secureCrypto();
  let out = '';
  for (let i = 0; i < SHARE_CODE_SYLLABLES; i++) {
    out += pick(CONSONANTS, c) + pick(VOWELS, c);
  }
  return out;
};

/** How many times a generator tries before giving up and saying so. */
export const MAX_CODE_ATTEMPTS = 12;

/**
 * A new code, checked against the blocklist and against whatever is already in
 * use.
 *
 * `isTaken` is injected rather than looked up here, because this module knows
 * nothing about Firestore and the caller already holds every build.
 *
 * GIVES UP LOUDLY. After MAX_CODE_ATTEMPTS it throws rather than reusing a
 * code or returning something unchecked — a duplicate code would point two
 * adverts at one machine, and silence is how that ships.
 */
export const newShareCode = (
  isTaken: (code: string) => boolean = () => false,
  /** The candidate source. Injected only so the blocklist skip is testable. */
  gen: () => string = rawShareCode,
): string => {
  for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
    const code = gen();
    if (!isCleanCode(code)) continue;
    if (isTaken(code)) continue;
    return code;
  }
  throw new Error('Could not make a unique link code. Please try again.');
};

/* ---------------- The owner's own code ---------------- */

export type CustomCodeError =
  | 'empty'
  | 'charset'
  | 'length'
  | 'blocked'
  | 'taken';

export const CUSTOM_CODE_MIN = 4;
export const CUSTOM_CODE_MAX = 24;

export const CUSTOM_CODE_MESSAGE: Record<CustomCodeError, string> = {
  empty: 'Type a code, or leave it blank for a generated one.',
  length: `A code is ${CUSTOM_CODE_MIN}–${CUSTOM_CODE_MAX} letters long.`,
  charset: 'Letters only, and not l, i, o, q, x or y — they get misread off a screen.',
  blocked: 'That one is a bit close to a word we would rather not put in an advert.',
  taken: 'Another build is already using that code.',
};

/**
 * "reaper" typed by the owner, checked.
 *
 * The character rules are the generator's, minus the alternating pattern: a
 * word the owner chose is readable by definition, and forcing "reaper" to be
 * consonant-vowel-consonant-vowel would reject the one thing this feature is
 * for. Everything else holds — lowercase only, the safe alphabet, the
 * blocklist, and uniqueness.
 */
export const validateCustomCode = (
  raw: string,
  isTaken: (code: string) => boolean = () => false,
): { ok: true; code: string } | { ok: false; error: CustomCodeError } => {
  const code = (raw || '').trim().toLowerCase();
  if (!code) return { ok: false, error: 'empty' };
  if (code.length < CUSTOM_CODE_MIN || code.length > CUSTOM_CODE_MAX) {
    return { ok: false, error: 'length' };
  }
  const allowed = CONSONANTS + VOWELS;
  if (![...code].every(ch => allowed.includes(ch))) return { ok: false, error: 'charset' };
  if (!isCleanCode(code)) return { ok: false, error: 'blocked' };
  if (isTaken(code)) return { ok: false, error: 'taken' };
  return { ok: true, code };
};
