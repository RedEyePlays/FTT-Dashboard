import { StaffNote } from '../types';

// Simple validation: a note needs actual text, trimmed. No rating, category,
// or approval workflow — just a quick free-text log entry.
export function canAddStaffNote(text: string): boolean {
  return text.trim().length > 0;
}

// Most-recent-first — the only ordering this log ever uses.
export function sortStaffNotes(notes: StaffNote[]): StaffNote[] {
  return [...notes].sort((a, b) => b.ts - a.ts);
}
