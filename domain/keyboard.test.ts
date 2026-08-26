import { describe, it, expect } from 'vitest';
import { isTypingTarget, shouldIgnoreGlobalKey } from './keyboard';

// Minimal element stand-ins — this runs in the `node` environment (see
// vitest.config.ts), so there's no real DOM to build against.
const el = (tagName: string, isContentEditable = false) =>
  ({ tagName, isContentEditable } as unknown as HTMLElement);

describe('isTypingTarget', () => {
  it('claims the keystroke for text-entry elements', () => {
    expect(isTypingTarget(el('INPUT'))).toBe(true);
    expect(isTypingTarget(el('TEXTAREA'))).toBe(true);
    expect(isTypingTarget(el('SELECT'))).toBe(true);
  });

  it('is case-insensitive about tag names (JSX/XHTML casing)', () => {
    expect(isTypingTarget(el('input'))).toBe(true);
    expect(isTypingTarget(el('TextArea'))).toBe(true);
  });

  it('claims contentEditable regions', () => {
    expect(isTypingTarget(el('DIV', true))).toBe(true);
  });

  it('leaves ordinary elements to global shortcuts', () => {
    expect(isTypingTarget(el('DIV'))).toBe(false);
    expect(isTypingTarget(el('BODY'))).toBe(false);
    expect(isTypingTarget(el('BUTTON'))).toBe(false);
  });

  it('handles a missing or non-element target without throwing', () => {
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget({} as EventTarget)).toBe(false);
  });
});

describe('shouldIgnoreGlobalKey', () => {
  it('tells a global handler to stand down while a field is focused', () => {
    expect(shouldIgnoreGlobalKey({ target: el('INPUT') })).toBe(true);
  });

  it('lets a global handler run when nothing is being typed into', () => {
    expect(shouldIgnoreGlobalKey({ target: el('BODY') })).toBe(false);
  });

  // The scanner case: a barcode scanner fires a burst of digit keydowns at the
  // focused IMEI field. Every one of them must be left alone by any global
  // numpad/shortcut handler, or characters go missing from the scan.
  it('stands down for every keystroke of a scanned burst, not just the first', () => {
    const imei = '353915098765432';
    const target = el('INPUT');
    const decisions = [...imei].map(() => shouldIgnoreGlobalKey({ target }));
    expect(decisions).toHaveLength(15);
    expect(decisions.every(Boolean)).toBe(true);
  });
});
