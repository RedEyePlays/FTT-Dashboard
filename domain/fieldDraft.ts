/**
 * WHEN A LIVE FIELD MAY ACCEPT A NEW VALUE FROM UNDERNEATH IT.
 *
 * THE BUG: PC Builds' part fields were fully controlled off the saved build,
 * and every keystroke wrote to Firestore. The subscription echoed the document
 * back, React re-rendered the input with the round-tripped string, and the
 * browser put the caret at the END — so correcting one letter in the middle of
 * "RTX 4070 Windfroce" was impossible without retyping the rest. Every field on
 * the row had it, and so did the build name.
 *
 * The fix is a local draft while focused, committed on blur or after a short
 * pause. This module holds the one decision that makes it safe, so it can be
 * reasoned about and tested without a DOM:
 *
 *   WHILE A FIELD IS FOCUSED, NOTHING MAY REPLACE WHAT THE USER IS TYPING.
 *
 * Not the echo of their own save, and not a colleague's edit arriving on the
 * subscription — both look identical from here, and silently swapping the text
 * under someone's caret is the worse outcome in either case. A remote change
 * made while they were typing is still in the document; it lands the moment
 * they leave the field.
 *
 * Pure: no DOM, no React, no Firestore.
 */

export interface DraftSyncInput {
  /** Is the user in this field right now? */
  focused: boolean;
  /**
   * Identity of the thing being edited — a part id, a build id. A change here
   * means this input is now showing a DIFFERENT record (the row was reused by
   * React), which must always re-seed regardless of focus.
   */
  key: string;
  /** The key the current draft was seeded from. */
  draftKey: string;
  /** The value now in the saved record. */
  saved: string;
  /** What the draft was seeded with, so an unchanged save is not a change. */
  seeded: string;
}

/**
 * Should the draft be re-seeded from the saved value?
 *
 * - A different record: always. The input is being reused for another row.
 * - Focused: never. See above.
 * - Otherwise: only when the saved value actually differs from what this
 *   draft was seeded with, so an idle field is not reset on every unrelated
 *   re-render (which would also fight the debounce).
 */
export const shouldSyncDraft = (i: DraftSyncInput): boolean => {
  if (i.key !== i.draftKey) return true;
  if (i.focused) return false;
  return i.saved !== i.seeded;
};

/** The default pause before an unblurred edit is committed anyway. */
export const DRAFT_COMMIT_MS = 500;

/**
 * Is this draft worth writing?
 *
 * Nothing is written when the value has not actually changed — which matters
 * because focus alone used to be enough to trigger a write, and a write per
 * keystroke was both a real Firestore cost and the thing that caused the
 * round-trip in the first place.
 */
export const draftChanged = (draft: string, saved: string): boolean => draft !== saved;

/**
 * The number a numeric draft commits to.
 *
 * Blank means "no value" rather than zero, which is the difference between a
 * part whose retail price is unknown and one that is genuinely free. An
 * unparseable string commits nothing at all rather than silently becoming 0
 * and overwriting a real figure.
 */
export const numericDraft = (draft: string): number | undefined => {
  const t = draft.trim();
  if (t === '') return undefined;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : undefined;
};
