import { Note, NoteLinkType, NoteVisibility, Role } from '../types';

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

// --- Visibility --------------------------------------------------------------
// Notes hold purchase prices, supplier settlements and personal numbers. Before
// this, every workspace member could read every note — the Notes nav item was
// unconditional and the view had no gate at all, which is out of step with how
// the app treats the same data everywhere else (inventory cost column, AI
// gating, reports).
//
// STORAGE DECISION: notes stay on the shared workspace meta doc (the same
// document tasks/settings/skuCounters live on), not a split into their own
// Firestore collection with per-doc rules. That means DB-level reads by any
// active workspace member remain technically possible — the same accepted
// tradeoff this app already makes for inventory's cost fields, which are also
// UI-gated rather than collection-split. Enforcement here is therefore
// UI/app-layer, consistently, at every surface a note can reach: the board
// list, the board's search, and LinkedNotes on customer/inventory/repair
// records (see visibleNotes below, and its call sites).
//
// Why not split it (considered, decided against for this change): a real
// per-role `notes` collection needs firestore.rules that key off a
// document-level `visibility` field per the same isManagerUp/isOwnerOf
// primitives already in the ruleset — mechanically straightforward — but this
// repo's own rules file says as much as a warning: "Test them in the Firebase
// console Rules Playground before relying on them in production — they cannot
// be exercised in CI." Getting a security-relevant rule wrong is a silent
// failure mode (over-permissive: nothing breaks, it just leaks) that nothing
// here would catch. It would also require a one-time migration off meta.notes
// that must never re-run and must never resurrect a note deleted after the
// migration — real invariants to get right blind, on shared production data,
// without the ability to verify the rules that gate it in this environment.
// Given that, the safer scope for this change is the tradeoff already accepted
// elsewhere in the app (inventory cost fields) plus thorough UI/app-layer
// enforcement — not a schema migration whose safety net can't be exercised
// here. Revisit if per-role DB-level enforcement becomes a hard requirement.

/**
 * A note with no stored visibility is treated as Managers+, never Everyone.
 * Notes written before this feature existed were authored with no expectation
 * of being employee-visible, so the migration default has to be the
 * restrictive one — defaulting to 'everyone' would retroactively leak them.
 */
export const DEFAULT_NOTE_VISIBILITY: NoteVisibility = 'managers';

export const noteVisibility = (n: Pick<Note, 'visibility'>): NoteVisibility =>
  n.visibility ?? DEFAULT_NOTE_VISIBILITY;

export const NOTE_VISIBILITY_LABEL: Record<NoteVisibility, string> = {
  everyone: 'Everyone',
  managers: 'Managers+',
  owner: 'Owner only',
};

/**
 * Which audiences a role may read. Also the exact set the Firestore query
 * filters on, so the client never asks for documents the rules would refuse
 * (a query returning an unreadable doc fails outright rather than filtering).
 */
export function visibilitiesForRole(role: Role | undefined): NoteVisibility[] {
  switch (role) {
    case 'owner': return ['everyone', 'managers', 'owner'];
    case 'manager': return ['everyone', 'managers'];
    case 'employee':
    case 'technician': return ['everyone'];
    default: return [];
  }
}

export function canSeeNote(role: Role | undefined, note: Pick<Note, 'visibility'>): boolean {
  return visibilitiesForRole(role).includes(noteVisibility(note));
}

/** Every note this role may read, in the board's usual pinned-first order. */
export function visibleNotes(role: Role | undefined, notes: Note[]): Note[] {
  return sortNotes(notes.filter(n => canSeeNote(role, n)));
}

export function hasVisibleNotes(role: Role | undefined, notes: Note[]): boolean {
  return notes.some(n => canSeeNote(role, n));
}

/**
 * Technicians are read-only across the whole workspace — firestore.rules gates
 * general shop writes (including the meta doc notes live on) behind isStaffOf,
 * which excludes them by design. So a technician can never author a page, and
 * the board is worth showing them only when something is already visible.
 */
export const canAuthorNotes = (role: Role | undefined): boolean =>
  role === 'owner' || role === 'manager' || role === 'employee';

/**
 * Whether the Notes tab is worth showing at all — the nav item and the view
 * itself are both gated on this, so the route can't be reached directly either.
 *
 * Deliberately not just hasVisibleNotes: a shop with no notes yet would
 * otherwise have no way to reach the board and write the first one. Anyone who
 * can author gets in; everyone else gets in only if there's something to read.
 */
export function canOpenNotes(role: Role | undefined, notes: Note[]): boolean {
  return canAuthorNotes(role) || hasVisibleNotes(role, notes);
}

/** Only an owner may mark a note owner-only; everyone else can pick the rest. */
export function assignableVisibilities(role: Role | undefined): NoteVisibility[] {
  return role === 'owner' ? ['everyone', 'managers', 'owner'] : ['everyone', 'managers'];
}
