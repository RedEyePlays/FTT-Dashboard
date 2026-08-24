import { describe, it, expect } from 'vitest';
import { canAddStaffNote, sortStaffNotes } from './staffNotes';
import { StaffNote } from '../types';

describe('canAddStaffNote', () => {
  it('requires non-empty trimmed text', () => {
    expect(canAddStaffNote('')).toBe(false);
    expect(canAddStaffNote('   ')).toBe(false);
    expect(canAddStaffNote('Jordan handled a tough return well today.')).toBe(true);
  });
});

describe('sortStaffNotes', () => {
  it('orders most-recent first', () => {
    const notes: StaffNote[] = [
      { id: 'a', ts: 100, text: 'older', authorId: 'u1', authorEmail: 'a@x.com' },
      { id: 'b', ts: 300, text: 'newest', authorId: 'u1', authorEmail: 'a@x.com' },
      { id: 'c', ts: 200, text: 'middle', authorId: 'u1', authorEmail: 'a@x.com' },
    ];
    expect(sortStaffNotes(notes).map(n => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('does not mutate the input array', () => {
    const notes: StaffNote[] = [
      { id: 'a', ts: 1, text: 'x', authorId: 'u1', authorEmail: 'a@x.com' },
      { id: 'b', ts: 2, text: 'y', authorId: 'u1', authorEmail: 'a@x.com' },
    ];
    const copy = [...notes];
    sortStaffNotes(notes);
    expect(notes).toEqual(copy);
  });
});
