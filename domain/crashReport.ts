/**
 * WHAT A CRASH LOOKS LIKE WHEN SOMEBODY HAS TO REPORT IT.
 *
 * The owner hit "Inventory hit an error" with a Try again button and nothing
 * else — no message, no stack, no id. Diagnosing it meant asking him to open
 * dev tools in the middle of a shift, which is not a thing a shop owner should
 * have to do.
 *
 * Pure so the formatting is testable without a DOM: the text produced here is
 * exactly what the Copy details button puts on the clipboard, and exactly what
 * gets pasted into a bug report.
 */

export interface CrashReport {
  /** Which screen broke, in the words the app uses for it. */
  screen: string;
  message: string;
  /** The error's own stack, when it has one. */
  stack?: string;
  /** React's component stack — usually the more useful of the two. */
  componentStack?: string;
  at: number;
  /** Who was looking at it. An email, since that is what identifies a login. */
  user?: string;
  appVersion?: string;
}

/** A short id somebody can read down the phone and we can grep for. */
export const crashId = (r: Pick<CrashReport, 'screen' | 'message' | 'at'>): string => {
  let h = 0;
  const basis = `${r.screen}|${r.message}|${Math.floor(r.at / 1000)}`;
  for (let i = 0; i < basis.length; i++) h = (Math.imul(31, h) + basis.charCodeAt(i)) | 0;
  return `ERR-${(h >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(0, 7)}`;
};

/**
 * The block of text the Copy details button produces.
 *
 * Deliberately plain text, not JSON: it gets pasted into a message to a human,
 * and a human should be able to read the first two lines and know what broke.
 */
export const formatCrashDetails = (r: CrashReport): string => [
  `${crashId(r)} — ${r.screen}`,
  new Date(r.at).toISOString(),
  r.appVersion ? `App version: ${r.appVersion}` : null,
  r.user ? `User: ${r.user}` : null,
  '',
  `Error: ${r.message || '(no message)'}`,
  r.stack ? `\nStack:\n${r.stack}` : null,
  r.componentStack ? `\nComponent stack:${r.componentStack}` : null,
].filter(v => v !== null).join('\n');

/**
 * The one-line summary written to the activity trail.
 *
 * A crash nobody screenshots is still recoverable after the fact — this is the
 * line that makes that true. No stack here: the activity feed is read by staff,
 * and the full detail lives on the screen and in the error reporter.
 */
export const crashActivityLine = (r: CrashReport): string =>
  `${r.screen} hit an error (${crashId(r)}): ${truncate(r.message || 'unknown error', 140)}`;

const truncate = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
