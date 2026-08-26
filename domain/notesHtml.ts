import { parseNoteBlocks, parseInlineSpans, NoteBlock } from './notes';

// Markdown ⇄ HTML for the WYSIWYG note editor.
//
// The STORAGE format stays markdown. That is deliberate: every existing note is
// already markdown, and everything else that reads a note body — the page list's
// checklist badge, notesForRecord/LinkedNotes, the board's search, and the
// checklist toggle itself — parses that same text. Switching the stored format
// to HTML would mean migrating live notes and rewriting all of those; converting
// at the editor boundary instead means legacy notes load untouched and nothing
// downstream changes.
//
// So the editor's contract is: markdown in → HTML for contentEditable → user
// edits the DOM → HTML back out → markdown stored. Round-trip fidelity is what
// keeps that safe, which is what the tests in notesHtml.test.ts pin down.

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Inline markdown (`**bold**`) → HTML, escaping everything else. */
function inlineToHtml(text: string): string {
  const html = parseInlineSpans(text)
    .map(s => (s.bold ? `<strong>${escapeHtml(s.text)}</strong>` : escapeHtml(s.text)))
    .join('');
  // A completely empty block still needs a caret target, or the browser
  // collapses the line and it can't be clicked into.
  return html || '<br>';
}

/** The data-attribute a block carries so htmlToMarkdown can read its kind back. */
const BLOCK_ATTR = 'data-nb';

function blockToHtml(b: NoteBlock): string {
  const inner = inlineToHtml(b.text);
  switch (b.kind) {
    case 'h1': return `<h1 ${BLOCK_ATTR}="h1">${inner}</h1>`;
    case 'h2': return `<h2 ${BLOCK_ATTR}="h2">${inner}</h2>`;
    case 'h3': return `<h3 ${BLOCK_ATTR}="h3">${inner}</h3>`;
    case 'bullet': return `<div ${BLOCK_ATTR}="bullet"><span class="nb-bullet" contenteditable="false">•</span><span class="nb-text">${inner}</span></div>`;
    case 'check':
      // The box itself is contenteditable="false" so typing never lands inside
      // it and Backspace at the start of the text doesn't eat half a widget.
      return `<div ${BLOCK_ATTR}="check" data-checked="${b.checked ? '1' : '0'}">`
        + `<span class="nb-check" contenteditable="false" role="checkbox" aria-checked="${b.checked}"></span>`
        + `<span class="nb-text">${inner}</span></div>`;
    default: return `<div ${BLOCK_ATTR}="text">${inner}</div>`;
  }
}

/** Markdown note body → contentEditable HTML. */
export function markdownToHtml(md: string): string {
  const blocks = parseNoteBlocks(md ?? '');
  // Every text run passes through escapeHtml above, and the only elements
  // ever emitted are the fixed set below with no dynamic attributes, so this
  // is already safe by construction. sanitizeNoteHtml is still applied here —
  // not just at the innerHTML boundary in NoteEditor.tsx — so that property
  // holds for every current AND future call site without each one having to
  // remember to sanitize separately, and survives a mistake in this function
  // itself (a new block kind that forgets to escape, a template literal typo)
  // rather than relying on getting blockToHtml/inlineToHtml right forever.
  return sanitizeNoteHtml(blocks.map(blockToHtml).join(''));
}

// --- Sanitization ------------------------------------------------------------
// Notes are shared across staff — whatever HTML this produces runs in a
// manager's or owner's session the moment their board loads. Belt-and-braces
// on top of the escaping above: an explicit allowlist of exactly the elements
// and attributes this editor itself ever emits (see blockToHtml). Anything
// else — <script>, <img onerror=...>, a stray style/href/on* attribute,
// javascript: URIs, whatever a future bug or a hand-crafted Firestore write
// contains — never reaches innerHTML. Hand-rolled rather than pulling in
// DOMPurify for the same reason NoteEditor.tsx is hand-rolled instead of a
// rich-text library: the surface here is small and fixed, so an allowlist is
// ~30 lines against a bundle-size cost of zero, versus DOMPurify's ~20kB for
// a general-purpose sanitizer this app doesn't need the generality of.

/** Tag → the exact attributes that tag is allowed to carry. Nothing else survives. */
const ALLOWED_ATTRS: Record<string, ReadonlySet<string>> = {
  H1: new Set([BLOCK_ATTR]),
  H2: new Set([BLOCK_ATTR]),
  H3: new Set([BLOCK_ATTR]),
  DIV: new Set([BLOCK_ATTR, 'data-checked']),
  SPAN: new Set(['class', 'contenteditable', 'role', 'aria-checked']),
  STRONG: new Set([]),
  B: new Set([]),
  BR: new Set([]),
};

// Tags whose entire subtree must be discarded outright — never unwrapped to
// plain text, since for these the "text" (script source, style rules) is
// itself the dangerous part.
const DROP_SUBTREE = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'LINK', 'META']);

function sanitizeElement(root: Element): void {
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 8 /* comment */) { root.removeChild(node); continue; }
    if (node.nodeType !== 1 /* element */) continue;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (DROP_SUBTREE.has(tag)) { el.remove(); continue; }
    const allowed = ALLOWED_ATTRS[tag];
    if (!allowed) {
      // Not a tag this editor emits — sanitize its children, then unwrap:
      // keep any legitimate text/content, drop the wrapper element (and
      // every attribute riding on it, since the element itself is gone).
      sanitizeElement(el);
      while (el.firstChild) root.insertBefore(el.firstChild, el);
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      if (!allowed.has(attr.name.toLowerCase())) el.removeAttribute(attr.name);
    }
    sanitizeElement(el);
  }
}

/**
 * Strip everything except the small fixed set of elements/attributes this
 * editor itself ever produces. Safe to run on ANY string, including one that
 * didn't come from markdownToHtml (a stored note edited outside the app, an
 * older/different code path) — the allowlist has no notion of "trusted
 * input," it only recognises shapes and discards everything it doesn't.
 *
 * Parsed via DOMParser rather than `el.innerHTML = html` on a live element:
 * a live (even detached) element can still kick off side effects while
 * merely PARSING hostile markup — an <img onerror=...> can fire its handler
 * as soon as the broken image load resolves, independent of whether the
 * element is attached to the document. A DOMParser document is inert; it
 * never triggers resource loads or fires events, so untrusted HTML can be
 * parsed and picked apart with nothing able to execute along the way.
 */
export function sanitizeNoteHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  sanitizeElement(doc.body);
  return doc.body.innerHTML;
}

// --- HTML → markdown --------------------------------------------------------

/** Inline HTML → markdown text for one block, honouring bold and hard breaks. */
function inlineToMarkdown(el: Element | null): string {
  if (!el) return '';
  let out = '';
  const walk = (node: Node, bold: boolean) => {
    if (node.nodeType === 3) { // text
      out += (node.nodeValue || '');
      return;
    }
    if (node.nodeType !== 1) return;
    const e = node as Element;
    const tag = e.tagName.toUpperCase();
    // The checkbox/bullet widgets are decoration — never part of the text.
    if (e.classList?.contains('nb-check') || e.classList?.contains('nb-bullet')) return;
    if (tag === 'BR') { return; }
    const nowBold = bold || tag === 'STRONG' || tag === 'B';
    const before = out.length;
    for (const child of Array.from(e.childNodes)) walk(child, nowBold);
    // Wrap this element's own contribution once, at the outermost bold element,
    // so nested <b><strong> doesn't emit `****text****`.
    if (nowBold && !bold) {
      const inner = out.slice(before);
      if (inner.trim()) out = out.slice(0, before) + `**${inner}**`;
    }
  };
  for (const child of Array.from(el.childNodes)) walk(child, false);
  // Collapse the non-breaking spaces contentEditable inserts, and trim the
  // trailing whitespace browsers leave behind on an emptied line.
  return out.replace(/ /g, ' ').replace(/\s+$/, '');
}

/**
 * contentEditable HTML → markdown note body.
 *
 * Reads each top-level block's `data-nb` kind where present, and falls back to
 * the tag name when the browser has produced a block we didn't author (pasting,
 * or Enter splitting a line, both routinely create bare <div>/<p>/<h*>).
 */
export function htmlToMarkdown(root: Element | null): string {
  if (!root) return '';
  const lines: string[] = [];

  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === 3) {
      // A bare text node at the top level (some browsers do this for the first
      // line) is still a line of content.
      const t = (node.nodeValue || '').replace(/ /g, ' ').trim();
      if (t) lines.push(t);
      continue;
    }
    if (node.nodeType !== 1) continue;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (tag === 'BR') { lines.push(''); continue; }

    const kind = el.getAttribute(BLOCK_ATTR)
      || (tag === 'H1' ? 'h1' : tag === 'H2' ? 'h2' : tag === 'H3' ? 'h3' : 'text');
    const textEl = el.querySelector('.nb-text') || el;
    const text = inlineToMarkdown(textEl);

    switch (kind) {
      case 'h1': lines.push(`# ${text}`); break;
      case 'h2': lines.push(`## ${text}`); break;
      case 'h3': lines.push(`### ${text}`); break;
      case 'bullet': lines.push(`- ${text}`); break;
      case 'check': lines.push(`[${el.getAttribute('data-checked') === '1' ? 'x' : ' '}]${text ? ` ${text}` : ''}`); break;
      default: lines.push(text);
    }
  }

  // Drop trailing blank lines the browser leaves behind, but keep interior ones
  // (they're deliberate spacing the user typed).
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

// --- Markdown accelerators --------------------------------------------------

/**
 * The block kind a just-typed markdown prefix should turn into, plus how many
 * characters to strip. Returns null when the text isn't an accelerator — so the
 * raw `# ` / `[] ` never stays on screen, it becomes real formatting the moment
 * it's recognised.
 */
export function markdownAccelerator(lineText: string):
  | { kind: 'h1' | 'h2' | 'h3' | 'bullet' | 'check'; checked?: boolean; strip: number }
  | null {
  const m = /^(###|##|#|\[[ xX]?\]|[-*])[\s ]$/.exec(lineText);
  if (!m) return null;
  const token = m[1];
  const strip = m[0].length;
  if (token === '#') return { kind: 'h1', strip };
  if (token === '##') return { kind: 'h2', strip };
  if (token === '###') return { kind: 'h3', strip };
  if (token === '-' || token === '*') return { kind: 'bullet', strip };
  return { kind: 'check', checked: /x/i.test(token), strip };
}
