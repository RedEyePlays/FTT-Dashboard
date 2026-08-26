import React, { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react';
import { markdownToHtml, htmlToMarkdown, markdownAccelerator } from '../domain/notesHtml';

// A WYSIWYG note body: one contentEditable surface, no edit/preview split, no
// raw markdown ever visible on screen.
//
// Why hand-rolled rather than a library: the realistic options (TipTap /
// ProseMirror, Slate, Lexical) each add 100kB+ to a bundle we just spent a PR
// trimming, and they'd want their own document model — which would mean
// migrating the stored note format away from markdown and rewriting everything
// that reads it (checklist badge, LinkedNotes, search, checklist toggle). The
// formatting surface here is deliberately tiny (bold, h1–h3, bullet, checkbox),
// so the editor is ~200 lines against a format we already own.
//
// The DOM is intentionally UNCONTROLLED. React seeds innerHTML once per note and
// then leaves the browser to own it; we only ever read back out (on input) and
// mutate deliberately (toolbar, checkbox, accelerator). Re-rendering the body
// from state on every keystroke would destroy the caret.

interface Props {
  /** Stable id of the note being edited — changing it re-seeds the surface. */
  noteId: string;
  /** Markdown body. Read on mount/note-change only, NOT on every render. */
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
}

/** The nearest top-level block element for a node inside the editor. */
function blockOf(root: HTMLElement, node: Node | null): HTMLElement | null {
  let n: Node | null = node;
  while (n && n.parentNode !== root) n = n.parentNode;
  return n && n.nodeType === 1 ? (n as HTMLElement) : null;
}

/** Put the caret at the start of a block's editable text. */
function caretToStart(block: HTMLElement) {
  const target = (block.querySelector('.nb-text') as HTMLElement) || block;
  const range = document.createRange();
  range.setStart(target, 0);
  range.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

/** Replace `block` with a new block of `kind`, carrying `text` across. */
function rewriteBlock(block: HTMLElement, kind: string, text: string, checked = false): HTMLElement {
  const md =
    kind === 'h1' ? `# ${text}` :
    kind === 'h2' ? `## ${text}` :
    kind === 'h3' ? `### ${text}` :
    kind === 'bullet' ? `- ${text}` :
    kind === 'check' ? `[${checked ? 'x' : ' '}]${text ? ` ${text}` : ''}` :
    text;
  const holder = document.createElement('div');
  holder.innerHTML = markdownToHtml(md);
  const next = holder.firstElementChild as HTMLElement;
  block.replaceWith(next);
  return next;
}

// Exposes the underlying contentEditable element so the board's toolbar can act
// on the live selection (applyBold / applyBlockKind below).
export const NoteEditor = forwardRef<HTMLDivElement, Props>(function NoteEditor(
  { noteId, value, onChange, placeholder, className }, forwardedRef,
) {
  const ref = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current as HTMLDivElement, []);
  // Latest markdown we emitted, so a parent re-render with the same value never
  // re-seeds the DOM mid-typing (which would drop the caret).
  const emitted = useRef<string>('');

  // Seed once per note. `value` is deliberately NOT a dependency: this must not
  // re-run as the user types.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = markdownToHtml(value);
    emitted.current = value;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const md = htmlToMarkdown(el);
    if (md !== emitted.current) {
      emitted.current = md;
      onChange(md);
    }
  }, [onChange]);

  // `# `, `## `, `[] `, `- ` become real formatting the moment they're
  // recognised — the raw token never stays on screen.
  const applyAccelerator = useCallback(() => {
    const el = ref.current;
    if (!el) return false;
    const sel = window.getSelection();
    const block = blockOf(el, sel?.anchorNode ?? null);
    if (!block) return false;
    // Only fires on a plain block; an existing heading/checkbox shouldn't
    // re-transform because its text happens to start with "- ".
    if ((block.getAttribute('data-nb') || 'text') !== 'text') return false;
    const acc = markdownAccelerator(block.textContent || '');
    if (!acc) return false;
    const next = rewriteBlock(block, acc.kind, '', acc.checked);
    caretToStart(next);
    sync();
    return true;
  }, [sync]);

  const handleInput = useCallback(() => {
    if (applyAccelerator()) return;
    sync();
  }, [applyAccelerator, sync]);

  // Clicking a checkbox toggles it in place while reading — no mode switch.
  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.classList?.contains('nb-check')) return;
    e.preventDefault();
    const block = target.closest('[data-nb="check"]') as HTMLElement | null;
    if (!block) return;
    const next = block.getAttribute('data-checked') === '1' ? '0' : '1';
    block.setAttribute('data-checked', next);
    target.setAttribute('aria-checked', next === '1' ? 'true' : 'false');
    sync();
  }, [sync]);

  // Enter inside a checklist/bullet continues the list; Enter on an empty item
  // exits it back to a plain line — the usual affordance.
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const el = ref.current;
    if (!el || e.key !== 'Enter' || e.shiftKey) return;
    const sel = window.getSelection();
    const block = blockOf(el, sel?.anchorNode ?? null);
    if (!block) return;
    const kind = block.getAttribute('data-nb') || 'text';
    if (kind !== 'check' && kind !== 'bullet') return;
    e.preventDefault();
    const textEl = block.querySelector('.nb-text') as HTMLElement | null;
    const isEmpty = !(textEl?.textContent || '').trim();
    if (isEmpty) {
      // Second Enter on an empty item — drop back to a plain line.
      caretToStart(rewriteBlock(block, 'text', ''));
    } else {
      const holder = document.createElement('div');
      holder.innerHTML = markdownToHtml(kind === 'check' ? '[ ]' : '- ');
      const next = holder.firstElementChild as HTMLElement;
      block.after(next);
      caretToStart(next);
    }
    sync();
  }, [sync]);

  // Paste as plain text: pasting styled HTML from a browser or Word would
  // otherwise inject arbitrary markup this format can't represent.
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
    sync();
  }, [sync]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label="Note body"
      spellCheck={false}
      data-placeholder={placeholder}
      onInput={handleInput}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      className={`nb-editor outline-none ${className || ''}`}
    />
  );
});

/**
 * Toolbar actions, exported so the board can render the buttons in its own
 * layout. Each acts on the current selection/caret inside `editor`.
 */
export function applyBold(editor: HTMLElement | null, sync: () => void) {
  if (!editor) return;
  editor.focus();
  document.execCommand('bold');
  sync();
}

export function applyBlockKind(editor: HTMLElement | null, kind: 'h1' | 'h2' | 'h3' | 'bullet' | 'check' | 'text', sync: () => void) {
  if (!editor) return;
  editor.focus();
  const sel = window.getSelection();
  const block = blockOf(editor, sel?.anchorNode ?? null) || (editor.firstElementChild as HTMLElement | null);
  if (!block) return;
  const current = block.getAttribute('data-nb') || 'text';
  const textEl = block.querySelector('.nb-text') as HTMLElement | null;
  const text = (textEl || block).textContent || '';
  // Pressing the same button again turns the formatting back off.
  const nextKind = current === kind ? 'text' : kind;
  caretToStart(rewriteBlock(block, nextKind, text.trim()));
  sync();
}
