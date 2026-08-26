// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { LinkedNotes } from './LinkedNotes';
import { NotesBoard } from './NotesBoard';
import { Note, Role } from '../types';

// domain/notes.test.ts pins down the filtering rules themselves. This suite
// answers the separate question those tests can't: does a restricted note
// actually stay out of what gets RENDERED? A correct predicate wired into the
// wrong place still leaks the note on screen, which is the only failure the
// shop would ever notice.

// React 19 wants this flag before act() will drive effects synchronously.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const note = (over: Partial<Note>): Note => ({
  id: 'n', title: 'Untitled', content: '', color: 'slate',
  date: new Date('2026-01-01').toISOString(), ...over,
});

const LINKED: Note[] = [
  note({ id: 'pub', title: 'Customer wants a call back', visibility: 'everyone', linkType: 'repair', linkId: 'r1' }),
  note({ id: 'mgr', title: 'Supplier settlement terms', visibility: 'managers', linkType: 'repair', linkId: 'r1' }),
  note({ id: 'own', title: 'Payroll plan', visibility: 'owner', linkType: 'repair', linkId: 'r1' }),
  note({ id: 'old', title: 'Legacy untagged page', linkType: 'repair', linkId: 'r1' }),
];

const linkedHtml = (role: Role | undefined) =>
  renderToStaticMarkup(<LinkedNotes notes={LINKED} role={role} linkType="repair" linkId="r1" />);

/**
 * Mount for real and let effects run, then read the resulting DOM.
 *
 * renderToStaticMarkup is enough for a presentational component, but the board
 * picks its opening page in a useEffect — which static rendering never runs. A
 * test of that behaviour against static markup would pass no matter what the
 * effect did, so the board is mounted properly instead.
 */
function mountedHtml(ui: React.ReactElement): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  const html = host.innerHTML;
  act(() => { root.unmount(); });
  host.remove();
  return html;
}

describe('LinkedNotes on a record honours per-note visibility', () => {
  it('a technician viewing a repair sees only the shared page', () => {
    const html = linkedHtml('technician');
    expect(html).toContain('Customer wants a call back');
    expect(html).not.toContain('Supplier settlement terms');
    expect(html).not.toContain('Payroll plan');
    expect(html).not.toContain('Legacy untagged page');
  });

  it('a manager sees shared + Managers+ (incl. untagged legacy) but not owner-only', () => {
    const html = linkedHtml('manager');
    expect(html).toContain('Supplier settlement terms');
    expect(html).toContain('Legacy untagged page');
    expect(html).not.toContain('Payroll plan');
  });

  it('the owner sees everything', () => {
    const html = linkedHtml('owner');
    for (const t of ['Customer wants a call back', 'Supplier settlement terms', 'Payroll plan', 'Legacy untagged page']) {
      expect(html).toContain(t);
    }
  });

  it('renders nothing at all when the only linked notes are hidden', () => {
    const onlyManagers = [note({ id: 'm', title: 'Cost breakdown', visibility: 'managers', linkType: 'repair', linkId: 'r1' })];
    const html = renderToStaticMarkup(
      <LinkedNotes notes={onlyManagers} role="technician" linkType="repair" linkId="r1" />);
    // Not an empty "Linked Notes (0)" heading — the section disappears.
    expect(html).toBe('');
  });

  it('fails closed for an unknown role rather than showing everything', () => {
    expect(linkedHtml(undefined)).toBe('');
  });

  it('counts only what the viewer can see in the heading', () => {
    expect(linkedHtml('technician')).toContain('Linked Notes (1)');
    expect(linkedHtml('owner')).toContain('Linked Notes (4)');
  });
});

describe('NotesBoard page list honours per-note visibility', () => {
  const BOARD: Note[] = [
    note({ id: 'pub', title: 'Front counter script', visibility: 'everyone' }),
    note({ id: 'mgr', title: 'Wholesale margins', visibility: 'managers' }),
    note({ id: 'own', title: 'Bank details', visibility: 'owner' }),
  ];
  const boardHtml = (role: Role) => mountedHtml(
    <NotesBoard notes={BOARD} tasks={[]} role={role} onUpdateNotes={() => {}} onUpdateTasks={() => {}} />);

  it('lists only the shared page for an employee', () => {
    const html = boardHtml('employee');
    expect(html).toContain('Front counter script');
    expect(html).not.toContain('Wholesale margins');
    expect(html).not.toContain('Bank details');
  });

  it('lists shared + Managers+ for a manager, never the owner-only page', () => {
    const html = boardHtml('manager');
    expect(html).toContain('Wholesale margins');
    expect(html).not.toContain('Bank details');
  });

  it('lists everything for the owner', () => {
    expect(boardHtml('owner')).toContain('Bank details');
  });

  it('does not leak a hidden note through the initial selection', () => {
    // The board auto-opens the first page; if that picked from the raw array
    // rather than the visible one, an employee would land straight in a
    // Managers+ note's body.
    const managersFirst = [
      note({ id: 'mgr', title: 'Wholesale margins', content: 'cost is 220', visibility: 'managers' }),
      note({ id: 'pub', title: 'Front counter script', content: 'greet the customer', visibility: 'everyone' }),
    ];
    const html = mountedHtml(
      <NotesBoard notes={managersFirst} tasks={[]} role="employee" onUpdateNotes={() => {}} onUpdateTasks={() => {}} />);
    expect(html).not.toContain('cost is 220');
    expect(html).not.toContain('Wholesale margins');
    // …and the page it DID open is the shared one, so this isn't passing just
    // because nothing rendered at all.
    expect(html).toContain('Front counter script');
    expect(html).toContain('greet the customer');
  });

  it('opens no page at all when the role can see none', () => {
    // A technician CAN read an 'everyone' page, so the board here holds only
    // restricted ones — the case where the empty state is the correct answer.
    const restricted = BOARD.filter(n => n.visibility !== 'everyone');
    const html = mountedHtml(
      <NotesBoard notes={restricted} tasks={[]} role="technician" onUpdateNotes={() => {}} onUpdateTasks={() => {}} />);
    expect(html).toContain('Select a page to edit');
    expect(html).toContain('No pages yet');
    expect(html).not.toContain('Wholesale margins');
    expect(html).not.toContain('Bank details');
  });
});
