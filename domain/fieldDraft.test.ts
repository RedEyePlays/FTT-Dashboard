import { describe, it, expect } from 'vitest';
import { DRAFT_COMMIT_MS, draftChanged, numericDraft, shouldSyncDraft } from './fieldDraft';

/**
 * "Editing a part name mid-word jumps the cursor to the end."
 *
 * Every keystroke wrote to Firestore, the subscription echoed the document
 * back, and the input was re-rendered with the round-tripped string — which
 * puts the caret at the end. This is the rule that stops it.
 */

const at = (o: Partial<Parameters<typeof shouldSyncDraft>[0]> = {}) => shouldSyncDraft({
  focused: false, key: 'p1', draftKey: 'p1', saved: 'RTX 4070', seeded: 'RTX 4070', ...o,
});

describe('shouldSyncDraft', () => {
  it('NEVER replaces what the user is typing', () => {
    // The echo of their own save, arriving mid-word. This is the bug.
    expect(at({ focused: true, saved: 'RTX 4070 Windfroce' })).toBe(false);
  });

  it('holds a COLLEAGUE\'s edit too, rather than swapping text under the caret', () => {
    // Indistinguishable from the echo here, and the worse outcome either way.
    // The remote change is still in the document; it lands on blur.
    expect(at({ focused: true, saved: 'Someone else typed this' })).toBe(false);
  });

  it('takes the saved value once the field is left', () => {
    expect(at({ focused: false, saved: 'RTX 4070 Ti', seeded: 'RTX 4070' })).toBe(true);
  });

  it('leaves an idle field alone when nothing actually changed', () => {
    // Otherwise every unrelated re-render resets the field and fights the
    // debounce.
    expect(at({ focused: false, saved: 'RTX 4070', seeded: 'RTX 4070' })).toBe(false);
  });

  it('ALWAYS re-seeds when the row is showing a different part', () => {
    // React reuses the input; without this it would show the old part's text.
    expect(at({ focused: true, key: 'p2', draftKey: 'p1', saved: '32GB DDR5' })).toBe(true);
    expect(at({ focused: false, key: 'p2', draftKey: 'p1' })).toBe(true);
  });
});

describe('what gets committed', () => {
  it('writes nothing when the value did not change', () => {
    // Focus alone used to be enough to trigger a write.
    expect(draftChanged('RTX 4070', 'RTX 4070')).toBe(false);
    expect(draftChanged('RTX 4070 Ti', 'RTX 4070')).toBe(true);
  });

  it('commits often enough that a walked-away edit is not lost', () => {
    expect(DRAFT_COMMIT_MS).toBe(500);
  });
});

describe('numericDraft', () => {
  it('treats BLANK as no value, not as zero', () => {
    // "unknown retail price" and "this part is free" are different facts.
    expect(numericDraft('')).toBeUndefined();
    expect(numericDraft('   ')).toBeUndefined();
    expect(numericDraft('0')).toBe(0);
  });

  it('commits nothing for an unparseable string rather than zeroing a real figure', () => {
    expect(numericDraft('abc')).toBeUndefined();
    expect(numericDraft('-')).toBeUndefined();
  });

  it('reads an ordinary price', () => {
    expect(numericDraft('499.99')).toBe(499.99);
    expect(numericDraft(' 700 ')).toBe(700);
  });
});
