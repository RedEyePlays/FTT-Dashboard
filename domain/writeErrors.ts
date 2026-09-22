/**
 * WHAT TO PUT ON SCREEN WHEN A SAVE FAILED.
 *
 * Pure — no DOM, no Firestore. The rule it exists to enforce is that a screen
 * which kept the user's typing must also tell them what actually went wrong.
 * A reported Quick Purchase was lost behind the word "Saved"; replacing that
 * with a generic "Something went wrong" would only be a quieter version of the
 * same failure.
 *
 * So: a message the app itself wrote (the SKU allocator's offline refusal, a
 * permission refusal) is passed through as-is, because it already says the
 * true thing in plain words. A raw Firestore code is translated. Anything
 * genuinely unrecognized falls back to a sentence that says it is unknown
 * rather than pretending to a diagnosis.
 *
 * NEVER include a credential, a token or a password — see the codes below;
 * only the code and our own copy reach the screen.
 */

const codeOf = (e: unknown): string =>
  (typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code || '') : '');

const messageOf = (e: unknown): string =>
  (e instanceof Error ? e.message : typeof e === 'string' ? e : '').trim();

/** Codes that mean "no server right now" rather than "no". */
const CONNECTIVITY = new Set(['unavailable', 'deadline-exceeded', 'failed-precondition', 'cancelled']);

export const BY_CODE: Record<string, string> = {
  'permission-denied': "You don't have permission to save this.",
  unauthenticated: 'Your session has expired — sign in again.',
  'resource-exhausted': 'The database is rate-limiting writes right now. Wait a moment and try again.',
  'invalid-argument': "Something in this entry isn't valid — check the fields and try again.",
  'not-found': "The record this belongs to no longer exists.",
  'already-exists': 'That record already exists.',
};

const CONNECTION_MESSAGE = "Couldn't reach the database — check the connection and try again.";
const UNKNOWN_MESSAGE = 'The save failed and the reason was not clear.';

/**
 * A sentence for a failed write, ending in a full stop so a caller can append
 * its own "Your entry is still here" without producing a run-on.
 */
export const writeErrorMessage = (e: unknown, fallback = UNKNOWN_MESSAGE): string => {
  const code = codeOf(e).replace(/^[a-z]+\//, '');
  if (CONNECTIVITY.has(code)) return CONNECTION_MESSAGE;
  if (BY_CODE[code]) return BY_CODE[code];
  // An error the app raised on purpose already says the true thing — the SKU
  // allocator's offline refusal is the one that matters most here, because it
  // is the exact failure that lost a purchase.
  const msg = messageOf(e);
  if (msg && !/^\[?firebase/i.test(msg)) return msg.endsWith('.') ? msg : `${msg}.`;
  return fallback;
};

/** Quick Purchase's wording, which names the SKU step because that is what fails. */
export const quickPurchaseSaveError = (e: unknown): string =>
  writeErrorMessage(e, "Couldn't get a SKU — check the connection and try again.");
