import { describe, it, expect } from 'vitest';
import {
  parseNoteBlocks, toggleChecklistItem, parseInlineSpans, checklistProgress,
  sortNotes, notesForRecord, stampNoteEdit, relativeTime, editedSummary,
} from './notes';
import { Note } from '../types';

const note = (p: Partial<Note>): Note => ({
  id: 'n1', title: 'Page', content: '', color: 'slate', date: '2026-01-01T00:00:00.000Z', ...p,
});

describe('parseNoteBlocks', () => {
  it('parses the bare [] form people actually type, both unchecked and checked', () => {
    const blocks = parseNoteBlocks('[] order screens\n[x] order batteries');
    expect(blocks[0]).toMatchObject({ kind: 'check', text: 'order screens', checked: false });
    expect(blocks[1]).toMatchObject({ kind: 'check', text: 'order batteries', checked: true });
  });

  it('also accepts standard markdown task syntax, capital X, and indentation', () => {
    const blocks = parseNoteBlocks('- [ ] a\n* [X] b\n  [ ] c');
    expect(blocks.map(b => b.kind)).toEqual(['check', 'check', 'check']);
    expect(blocks.map(b => b.checked)).toEqual([false, true, false]);
    expect(blocks.map(b => b.text)).toEqual(['a', 'b', 'c']);
  });

  it('parses h1/h2/h3 headings and plain bullets', () => {
    const blocks = parseNoteBlocks('# Big\n## Med\n### Small\n- point');
    expect(blocks.map(b => b.kind)).toEqual(['h1', 'h2', 'h3', 'bullet']);
    expect(blocks.map(b => b.text)).toEqual(['Big', 'Med', 'Small', 'point']);
  });

  it('treats anything else as plain text and keeps blank lines as spacing', () => {
    const blocks = parseNoteBlocks('hello\n\nworld');
    expect(blocks.map(b => b.kind)).toEqual(['text', 'text', 'text']);
    expect(blocks[1].text).toBe('');
  });

  it('reports each block\'s raw line index so a click can map back to the text', () => {
    expect(parseNoteBlocks('a\n[] b\nc').map(b => b.index)).toEqual([0, 1, 2]);
  });

  it('handles an empty body without throwing', () => {
    expect(parseNoteBlocks('')).toEqual([{ index: 0, kind: 'text', text: '', checked: false }]);
  });

  it('does not mistake a bare # or a [] with no space for a heading/checkbox edge case', () => {
    expect(parseNoteBlocks('#nospace')[0].kind).toBe('text');
    expect(parseNoteBlocks('[]')[0]).toMatchObject({ kind: 'check', text: '', checked: false });
  });
});

describe('toggleChecklistItem', () => {
  it('ticks an unchecked item and leaves the other lines alone', () => {
    expect(toggleChecklistItem('[] a\n[] b', 1)).toBe('[] a\n[x] b');
  });

  it('unticks a checked item', () => {
    expect(toggleChecklistItem('[x] a', 0)).toBe('[ ] a');
  });

  it('preserves bullet prefix and indentation', () => {
    expect(toggleChecklistItem('  - [ ] deep', 0)).toBe('  - [x] deep');
  });

  it('round-trips: toggling twice returns an equivalent, re-parsable line', () => {
    const once = toggleChecklistItem('[] a', 0);
    const twice = toggleChecklistItem(once, 0);
    expect(parseNoteBlocks(twice)[0]).toMatchObject({ kind: 'check', text: 'a', checked: false });
  });

  it('is a no-op for a non-checkbox line or an out-of-range index', () => {
    expect(toggleChecklistItem('just text', 0)).toBe('just text');
    expect(toggleChecklistItem('[] a', 9)).toBe('[] a');
    expect(toggleChecklistItem('[] a', -1)).toBe('[] a');
  });

  it('handles an empty checkbox with no label', () => {
    expect(toggleChecklistItem('[]', 0)).toBe('[x]');
  });
});

describe('parseInlineSpans', () => {
  it('splits bold runs out of surrounding plain text', () => {
    expect(parseInlineSpans('a **b** c')).toEqual([
      { text: 'a ', bold: false }, { text: 'b', bold: true }, { text: ' c', bold: false },
    ]);
  });

  it('supports multiple bold runs on one line', () => {
    expect(parseInlineSpans('**x** and **y**').filter(s => s.bold).map(s => s.text)).toEqual(['x', 'y']);
  });

  it('leaves unmatched ** as literal text rather than swallowing the line', () => {
    expect(parseInlineSpans('a ** b')).toEqual([{ text: 'a ** b', bold: false }]);
  });

  it('returns a single empty span for an empty line', () => {
    expect(parseInlineSpans('')).toEqual([{ text: '', bold: false }]);
  });
});

describe('checklistProgress', () => {
  it('counts done vs total checkboxes, ignoring non-checkbox lines', () => {
    expect(checklistProgress('# Parts\n[x] a\n[] b\n[x] c\nplain')).toEqual({ done: 2, total: 3 });
  });
  it('reports zero total when the note has no checklist', () => {
    expect(checklistProgress('just prose')).toEqual({ done: 0, total: 0 });
  });
});

describe('sortNotes', () => {
  it('floats pinned notes to the top', () => {
    const notes = [note({ id: 'a' }), note({ id: 'b', pinned: true }), note({ id: 'c' })];
    expect(sortNotes(notes).map(n => n.id)).toEqual(['b', 'a', 'c']);
  });

  it('is stable — equal-priority notes keep their existing order', () => {
    const notes = [note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c' })];
    expect(sortNotes(notes).map(n => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps multiple pinned notes in their relative order', () => {
    const notes = [note({ id: 'a', pinned: true }), note({ id: 'b' }), note({ id: 'c', pinned: true })];
    expect(sortNotes(notes).map(n => n.id)).toEqual(['a', 'c', 'b']);
  });

  it('does not mutate the input array', () => {
    const notes = [note({ id: 'a' }), note({ id: 'b', pinned: true })];
    sortNotes(notes);
    expect(notes.map(n => n.id)).toEqual(['a', 'b']);
  });
});

describe('notesForRecord', () => {
  const notes = [
    note({ id: 'a', linkType: 'customer', linkId: 'c1' }),
    note({ id: 'b', linkType: 'repair', linkId: 'c1' }),   // same id, different type
    note({ id: 'c', linkType: 'customer', linkId: 'c2' }),
    note({ id: 'd' }),                                      // unlinked
    note({ id: 'e', linkType: 'customer', linkId: 'c1', pinned: true }),
  ];

  it('matches on both link type and id, so ids can overlap across record kinds', () => {
    expect(notesForRecord(notes, 'customer', 'c1').map(n => n.id)).toEqual(['e', 'a']);
    expect(notesForRecord(notes, 'repair', 'c1').map(n => n.id)).toEqual(['b']);
  });

  it('returns nothing for a record with no linked notes, and for a blank id', () => {
    expect(notesForRecord(notes, 'inventory', 'i1')).toEqual([]);
    expect(notesForRecord(notes, 'customer', '')).toEqual([]);
  });

  it('applies the pinned-first ordering', () => {
    expect(notesForRecord(notes, 'customer', 'c1')[0].id).toBe('e');
  });
});

describe('stampNoteEdit', () => {
  it('records who edited and when', () => {
    const out = stampNoteEdit(note({}), { id: 'u1', email: 'a@shop.com' }, 1000);
    expect(out).toMatchObject({ updatedAt: 1000, updatedBy: 'u1', updatedByEmail: 'a@shop.com' });
  });

  it('still stamps the time when there is no signed-in user to attribute', () => {
    const out = stampNoteEdit(note({}), null, 1000);
    expect(out.updatedAt).toBe(1000);
    expect(out.updatedBy).toBeUndefined();
  });

  it('does not mutate the original note', () => {
    const n = note({});
    stampNoteEdit(n, { id: 'u1', email: 'a@shop.com' }, 1000);
    expect(n.updatedAt).toBeUndefined();
  });
});

describe('relativeTime / editedSummary', () => {
  const now = Date.parse('2026-08-26T12:00:00Z');
  const ago = (ms: number) => now - ms;

  it('renders minute / hour / day granularity', () => {
    expect(relativeTime(ago(30_000), now)).toBe('just now');
    expect(relativeTime(ago(5 * 60_000), now)).toBe('5m ago');
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3h ago');
    expect(relativeTime(ago(2 * 86_400_000), now)).toBe('2d ago');
  });

  it('falls back to a date past a week', () => {
    expect(relativeTime(ago(30 * 86_400_000), now)).toContain('202');
  });

  it('never renders a negative/future duration as nonsense', () => {
    expect(relativeTime(now + 60_000, now)).toBe('just now');
  });

  it('summarises editor and time together, and returns null when never edited', () => {
    const n = note({ updatedAt: ago(5 * 60_000), updatedByEmail: 'tech@shop.com' });
    expect(editedSummary(n, now)).toBe('last edited by tech@shop.com · 5m ago');
    expect(editedSummary(note({}), now)).toBeNull();
  });

  it('omits the attribution clause when the editor is unknown', () => {
    expect(editedSummary(note({ updatedAt: ago(60_000) }), now)).toBe('last edited 1m ago');
  });
});
