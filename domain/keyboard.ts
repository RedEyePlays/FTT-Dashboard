// Guard for global (window/document-level) keyboard shortcuts.
//
// A shortcut handler bound to the window sees every keystroke on the page,
// including the ones meant for whatever field the user is typing into. If such
// a handler calls preventDefault(), the character never reaches that field.
//
// This bit the Calculator's numpad shortcuts: in "Math" mode it bound a window
// keydown handler that called preventDefault() on every digit, with no check
// for the focus target. With the calculator open, digits typed anywhere on the
// page were swallowed — including an IMEI/serial being entered by hand or fired
// in by a keyboard-emulation barcode scanner.

/** Elements that own their keystrokes — a global shortcut must not intercept these. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * True when a global shortcut should stay out of the way: the user is typing
 * into a field, so the keystroke belongs to that field and not to the shortcut.
 */
export function shouldIgnoreGlobalKey(e: Pick<KeyboardEvent, 'target'>): boolean {
  return isTypingTarget(e.target);
}
