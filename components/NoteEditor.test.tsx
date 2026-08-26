// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { NoteEditor } from './NoteEditor';

// The full stored-XSS path, mounted for real: a note whose stored content
// (markdown) carries an XSS payload is loaded into the actual editor
// component (React 19 act(), happy-dom) exactly the way a manager opening
// the board would load it, and paste is exercised through the same
// ClipboardEvent shape the browser delivers. Confirms the payload renders
// inert in the live DOM — no script element, no event-handler attribute,
// nothing that could execute in the viewer's session — not just that the
// pure markdownToHtml/sanitizeNoteHtml functions look right in isolation.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(value: string) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const ref = React.createRef<HTMLDivElement>();
  act(() => {
    root.render(<NoteEditor ref={ref} noteId="n1" value={value} onChange={() => {}} />);
  });
  return { editor: () => host.querySelector('[contenteditable]') as HTMLElement, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

describe('NoteEditor renders a stored XSS payload inert', () => {
  it('a malicious stored note produces no script element and no event-handler attributes', () => {
    const malicious = [
      '# Report <script>window.__notePwned = true</script>',
      '[x] done <img src=x onerror="window.__notePwned = true">',
      'plain <svg/onload=alert(1)> text with a <a href="javascript:alert(1)">link</a>',
    ].join('\n');
    const h = mount(malicious);
    const el = h.editor();
    expect(el).toBeTruthy();
    expect(el.querySelector('script')).toBeNull();
    for (const node of Array.from(el.querySelectorAll('*'))) {
      for (const attr of Array.from(node.attributes)) {
        expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
        expect((attr.value || '').toLowerCase()).not.toContain('javascript:');
      }
    }
    expect((window as any).__notePwned).toBeUndefined();
    // The legitimate text content still made it through — sanitizing isn't
    // silently eating the whole note, just the dangerous markup.
    expect(el.textContent).toContain('Report');
    expect(el.textContent).toContain('done');
    h.unmount();
  });

  it('pasting rich/HTML clipboard content is inserted only through the plain-text path, never as markup', () => {
    // happy-dom doesn't implement document.execCommand (real browsers do —
    // it's deprecated but universal, see NoteEditor.tsx's own top comment).
    // Stub it to actually insert the given string as a plain text node, the
    // same effect a real browser's insertText produces, so the assertions
    // below exercise real inserted content rather than a no-op.
    const execCommand = vi.fn((cmd: string, _ui: boolean, value?: string) => {
      if (cmd === 'insertText' && value) {
        const sel = window.getSelection();
        const range = sel?.rangeCount ? sel.getRangeAt(0) : null;
        const target = range?.startContainer.nodeType === 1 ? (range.startContainer as Element) : range?.startContainer.parentElement;
        (target || document.body).appendChild(document.createTextNode(value));
      }
      return true;
    });
    (document as any).execCommand = execCommand;

    const h = mount('');
    const el = h.editor();

    // Establish a real caret inside the editor first — a browser paste always
    // targets the current selection, and with none set (nothing focused/
    // clicked yet) there's nowhere for the inserted text to land.
    const target = el.querySelector('.nb-text') || el;
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    // A malicious clipboard carries BOTH a rich HTML form (what a copied web
    // page snippet looks like) and a plain-text form — the handler must use
    // ONLY the plain-text one, regardless of what the rich form contains.
    const html = '<img src=x onerror="window.__pastePwned = true"><b>bold</b>';
    const plain = '<img src=x onerror="alert(1)">bold-ish text';
    const clipboardData = {
      getData: (type: string) => (type === 'text/plain' ? plain : html),
    } as unknown as DataTransfer;

    act(() => {
      const event = new (window as any).Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: clipboardData });
      el.dispatchEvent(event);
    });

    // The handler must have gone through insertText with the PLAIN form —
    // never insertHTML, and never the rich `html` string at all.
    expect(execCommand).toHaveBeenCalledWith('insertText', false, plain);
    expect(execCommand.mock.calls.every(c => c[0] === 'insertText')).toBe(true);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('b')).toBeNull();
    expect((window as any).__pastePwned).toBeUndefined();
    // What actually landed is the plain-text form, angle brackets and all,
    // as literal inert characters — never interpreted as an <img> tag.
    expect(el.textContent).toContain('bold-ish text');
    expect(el.textContent).toContain('<img src=x onerror="alert(1)">');
    h.unmount();
    delete (document as any).execCommand;
  });
});
