import { Note, NoteLinkType } from '../types';

// Pure logic for the Notes workspace: a deliberately tiny markdown-ish block
// format, checklist toggling, ordering, and record links. Kept here (not in the
// component) so the parsing rules are testable and the board stays presentational.
//
// The note body remains a single plain-text string — the format lives in the
// text itself, so there's no separate block data model to migrate, and a note
// typed before this existed still reads fine.

/** One parsed line of a note body. `index` is the line's position in the raw text. */
export interface NoteBlock {
  index: number;
  kind: 'h1' | 'h2' | 'h3' | 'check' | 'bullet' | 'text';
  text: string;
  /** Only meaningful for `check` blocks. */
  checked: boolean;
}

// `[] item`, `[ ] item`, `[x] item`, optionally bulleted (`- [ ] item`) and/or
// indented. The bare `[]` form is what the toolbar inserts and what people
// naturally type; the `- [ ]` form is standard markdown, so both are accepted.
const CHECK_RE = /^(\s*)([-*]\s+)?\[([ xX]?)\]\s?(.*)$/;
const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*]\s+(.*)$/;

/** Split a note body into renderable blocks, one per line. */
export function parseNoteBlocks(content: string): NoteBlock[] {
  return (content ?? '').split('\n').map((line, index) => {
    const check = CHECK_RE.exec(line);
    if (check) {
      return { index, kind: 'check' as const, text: check[4], checked: check[3].toLowerCase() === 'x' };
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const kind = (['h1', 'h2', 'h3'] as const)[heading[1].length - 1];
      return { index, kind, text: heading[2], checked: false };
    }
    const bullet = BULLET_RE.exec(line);
    if (bullet) return { index, kind: 'bullet' as const, text: bullet[2], checked: false };
    return { index, kind: 'text' as const, text: line, checked: false };
  });
}

/**
 * Flip the checkbox on one line, returning the new body. Checked state lives in
 * the text itself (`[ ]` ⇄ `[x]`), so ticking an item is an ordinary note edit
 * and persists through the same save path as typing — nothing extra to store.
 * A line that isn't a checkbox (or an out-of-range index) is left untouched.
 */
export function toggleChecklistItem(content: string, lineIndex: number): string {
  const lines = (content ?? '').split('\n');
  const line = lines[lineIndex];
  if (line === undefined) return content ?? '';
  const m = CHECK_RE.exec(line);
  if (!m) return content ?? '';
  const [, indent, bullet, state, text] = m;
  const nextState = state.toLowerCase() === 'x' ? ' ' : 'x';
  lines[lineIndex] = `${indent}${bullet || ''}[${nextState}]${text ? ` ${text}` : ''}`;
  return lines.join('\n');
}

/** Inline run of text, flagged bold where wrapped in `**`. */
export interface InlineSpan { text: string; bold: boolean }

/**
 * Split a line into bold/plain runs. Unmatched `**` is left as literal text
 * rather than swallowing the rest of the line.
 */
export function parseInlineSpans(text: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index), bold: false });
    spans.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), bold: false });
  return spans.length ? spans : [{ text: '', bold: false }];
}

/** Checklist progress for a note, for the compact "3/7" badge in the page list. */
export function checklistProgress(content: string): { done: number; total: number } {
  const checks = parseNoteBlocks(content).filter(b => b.kind === 'check');
  return { done: checks.filter(c => c.checked).length, total: checks.length };
}

/**
 * Pinned notes first, everything else keeping its existing relative order (the
 * board prepends new notes, so that order is already "newest first" and worth
 * preserving). Stable — equal-priority notes never reshuffle between renders.
 */
export function sortNotes(notes: Note[]): Note[] {
  return notes
    .map((note, i) => ({ note, i }))
    .sort((a, b) => (Number(!!b.note.pinned) - Number(!!a.note.pinned)) || (a.i - b.i))
    .map(x => x.note);
}

/** Notes attached to one record — the record-detail side of the link. */
export function notesForRecord(notes: Note[], linkType: NoteLinkType, linkId: string): Note[] {
  if (!linkId) return [];
  return sortNotes(notes.filter(n => n.linkType === linkType && n.linkId === linkId));
}

/**
 * Stamp authorship onto an edited note. Every save records who touched it,
 * since these pages are shared and "who changed this" is the whole point of
 * showing the metadata.
 */
export function stampNoteEdit(note: Note, user: { id: string; email: string } | null | undefined, now: number): Note {
  return {
    ...note,
    updatedAt: now,
    ...(user ? { updatedBy: user.id, updatedByEmail: user.email } : {}),
  };
}

/** Compact relative time ("just now", "5m ago", "3d ago") for the edited line. */
export function relativeTime(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** "last edited by alice@shop.com · 5m ago", or null when never edited. */
export function editedSummary(note: Note, now: number): string | null {
  if (!note.updatedAt) return null;
  const who = note.updatedByEmail ? `by ${note.updatedByEmail} · ` : '';
  return `last edited ${who}${relativeTime(note.updatedAt, now)}`;
}
