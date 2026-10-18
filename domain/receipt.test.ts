import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AppUser, Expense, Receipt } from '../types';
import { ExpenseCategory } from './expenses';
import * as receiptModule from './receipt';
import {
  applyEdit, canDeleteReceipt, canUseReceipts, clampCategory, correctedFields,
  draftFromReceipt, effectiveFields, expenseFromReceipt, linkReceipt,
  markNotExpense, orphanedReceipts, receiptDay, receiptStatus, searchReceipts,
  unlinkReceipt,
} from './receipt';
import { toISODate } from './dates';
import { can } from '../services/rbac';

/**
 * THE ARCHIVE IS THE PRODUCT, AND NOTHING POSTS WITHOUT A CONFIRM.
 *
 * The owner wants a shoebox that does not lose things — "just in case I forget
 * something or I just need something for my record in the future". The expense
 * entry is an optional action on top of the file, and these tests are written
 * in that order on purpose: a receipt that never becomes an expense is the
 * NORMAL case, not an unfinished one.
 */

const CATEGORIES: ExpenseCategory[] = [
  { key: 'supplies', label: 'Supplies' },
  { key: 'rent', label: 'Rent' },
  { key: 'tools', label: 'Tools' },
  { key: 'old', label: 'Old Thing', archived: true },
];

const ACTOR: Pick<AppUser, 'id' | 'email'> = { id: 'owner-uid', email: 'owner@shop.test' };
const NOW = 1_780_000_000_000;

const receipt = (over: Partial<Receipt> = {}): Receipt => ({
  id: 'r1',
  pages: [{ path: 'receipts/ws/r1/p1.jpg', thumbPath: 'receipts/ws/r1/p1_thumb.jpg' }],
  status: 'unreviewed',
  uploadedBy: ACTOR.id,
  uploadedByEmail: ACTOR.email,
  uploadedAt: NOW,
  ...over,
});

const parsed = (over = {}) => ({
  date: '2026-10-02', total: 84.21, currency: 'CAD', payee: 'Cable Depot',
  tax: 9.73, category: 'supplies', text: 'CABLE DEPOT ... TOTAL 84.21', parsedAt: NOW,
  ...over,
});

let seq = 0;
const newId = () => `exp-${++seq}`;

/* ---------------- A receipt with no expense is the normal case ---------------- */

describe('a receipt exists on its own, forever', () => {
  it('a freshly filed receipt is unreviewed and has no expense', () => {
    const r = receipt();
    expect(r.status).toBe('unreviewed');
    expect(r.linkedExpenseId).toBeUndefined();
    // And that is a resting state, not a to-do: nothing in this module
    // transitions it without being called explicitly.
    expect(receiptStatus(r.status)).toBe('unreviewed');
  });

  it('a stored status that is missing or nonsense reads as unreviewed', () => {
    expect(receiptStatus(undefined)).toBe('unreviewed');
    expect(receiptStatus('whatever')).toBe('unreviewed');
    expect(receiptStatus('linked')).toBe('linked');
    expect(receiptStatus('not_expense')).toBe('not_expense');
  });

  it('MARKING not_expense KEEPS THE IMAGE and the document', () => {
    const r = receipt({ parsed: parsed() });
    const marked = markNotExpense(r, NOW + 1, 'personal');

    expect(marked.status).toBe('not_expense');
    expect(marked.notExpenseReason).toBe('personal');
    // The parts that make it an archive are untouched.
    expect(marked.pages).toEqual(r.pages);
    expect(marked.parsed).toEqual(r.parsed);
    expect(marked.uploadedAt).toBe(r.uploadedAt);
    // It is a real outcome, not a soft delete — there is no deleted flag to set.
    expect('deleted' in marked).toBe(false);
  });

  it('a not_expense receipt is still searchable', () => {
    const marked = markNotExpense(receipt({ parsed: parsed() }), NOW, 'duplicate');
    expect(searchReceipts([marked], {}, toISODate)).toHaveLength(1);
    expect(searchReceipts([marked], { payee: 'cable' }, toISODate)).toHaveLength(1);
  });
});

/* ---------------- Suggestions never overwrite what was typed ---------------- */

describe('parsed values and entered values are separate, always', () => {
  it('the owner\'s value wins at read time, and the parse survives underneath', () => {
    const r = receipt({ parsed: parsed({ total: 84.21 }), entered: { total: 48.21 } });
    expect(effectiveFields(r).total).toBe(48.21);
    // The original reading is STILL THERE — this is what keeps "was the
    // parsing any good?" answerable a year from now.
    expect(r.parsed!.total).toBe(84.21);
    expect(correctedFields(r)).toEqual(['total']);
  });

  it('applyEdit only ever produces the `entered` object', () => {
    const r = receipt({ parsed: parsed() });
    const next = applyEdit(r, { payee: 'Cable Depot Ltd' });
    expect(next).toEqual({ payee: 'Cable Depot Ltd' });
    // Nothing it returns could be mistaken for a parse.
    expect('parsedAt' in next).toBe(false);
  });

  it('a field the owner deliberately CLEARED stays cleared', () => {
    // The model read a total that is not on the paper. Clearing it must stick,
    // not fall back to the parse on the next render.
    const r = receipt({ parsed: parsed({ total: 999 }), entered: { total: undefined } });
    expect(effectiveFields(r).total).toBeUndefined();
  });

  it('falls through to the parse for anything untouched', () => {
    const r = receipt({ parsed: parsed(), entered: { payee: 'Corrected Co' } });
    const f = effectiveFields(r);
    expect(f.payee).toBe('Corrected Co');
    expect(f.date).toBe('2026-10-02');
    expect(f.total).toBe(84.21);
    expect(f.category).toBe('supplies');
  });

  it('a receipt with no parse at all still reads cleanly', () => {
    const f = effectiveFields(receipt());
    expect(f.total).toBeUndefined();
    expect(f.payee).toBeUndefined();
    expect(correctedFields(receipt())).toEqual([]);
  });
});

/* ---------------- The suggested category is always the shop's own ---------------- */

describe('the suggested category is always one of the workspace\'s own', () => {
  it('accepts an exact key', () => {
    expect(clampCategory('supplies', CATEGORIES)).toBe('supplies');
  });

  it('accepts a label and returns the KEY', () => {
    expect(clampCategory('Rent', CATEGORIES)).toBe('rent');
    expect(clampCategory('rENT', CATEGORIES)).toBe('rent');
  });

  it('REFUSES anything the model invented', () => {
    for (const made of ['Office Supplies', 'Meals & Entertainment', 'misc', '', '  ', 'Supplies ']) {
      const got = clampCategory(made, CATEGORIES);
      expect(got === undefined || CATEGORIES.some(c => c.key === got)).toBe(true);
    }
    expect(clampCategory('Office Supplies', CATEGORIES)).toBeUndefined();
  });

  it('refuses an ARCHIVED category — valid on history, not for filing something new', () => {
    expect(clampCategory('old', CATEGORIES)).toBeUndefined();
    expect(clampCategory('Old Thing', CATEGORIES)).toBeUndefined();
  });

  it('refuses everything when the shop has no categories configured', () => {
    expect(clampCategory('supplies', [])).toBeUndefined();
  });

  it('a draft never carries a category the expense form would reject', () => {
    const r = receipt({ parsed: parsed({ category: 'Totally Made Up' }) });
    expect(draftFromReceipt(r, CATEGORIES).category).toBe('');
    expect(draftFromReceipt(r, CATEGORIES).missing).toContain('category');
  });
});

/* ---------------- NOTHING POSTS WITHOUT AN EXPLICIT CONFIRM ---------------- */

describe('NOTHING becomes an Expense without an explicit confirm', () => {
  const complete = () => draftFromReceipt(
    receipt({ parsed: parsed() }), CATEGORIES, { paymentMethod: 'card' },
  );

  it('expenseFromReceipt is the ONLY export that can return an Expense', () => {
    // The feature's main promise, asserted structurally rather than trusted.
    // Every other export is called with plausible arguments and must not
    // produce anything Expense-shaped.
    const draft = complete();
    const r = receipt({ parsed: parsed() });
    const looksLikeExpense = (v: unknown): boolean =>
      !!v && typeof v === 'object' && 'amount' in (v as object) && 'enteredBy' in (v as object);

    const callables = Object.entries(receiptModule)
      .filter(([name, v]) => typeof v === 'function' && name !== 'expenseFromReceipt');
    expect(callables.length).toBeGreaterThan(8);

    for (const [name, fn] of callables) {
      let out: unknown;
      // Each is given arguments it would plausibly see; a throw is fine (it
      // means it did not return an Expense either).
      for (const args of [
        [r, CATEGORIES, {}], [draft, 'r1', 'url', ACTOR, NOW, newId], [r, NOW, 'why'],
        [[r], [], toISODate], [r, {}], ['supplies', CATEGORIES], [() => true],
      ]) {
        try { out = (fn as (...a: unknown[]) => unknown)(...args); } catch { continue; }
        expect({ name, madeAnExpense: looksLikeExpense(out) }).toEqual({ name, madeAnExpense: false });
      }
    }
  });

  it('builds an Expense ONLY from the reviewed draft handed to it', () => {
    const draft = complete();
    const e = expenseFromReceipt(draft, 'r1', 'https://cdn.test/r1.jpg', ACTOR, NOW, newId)!;
    expect(e.amount).toBe(84.21);
    expect(e.date).toBe('2026-10-02');
    expect(e.category).toBe('supplies');
    expect(e.payee).toBe('Cable Depot');
    expect(e.paymentMethod).toBe('card');
    expect(e.enteredBy).toBe(ACTOR.id);
    expect(e.enteredByEmail).toBe(ACTOR.email);
    expect(e.createdAt).toBe(NOW);
  });

  it('takes the CORRECTED figure, not the parse, when they differ', () => {
    // What the owner was looking at when they tapped is what reaches the books.
    const r = receipt({ parsed: parsed({ total: 999 }), entered: { total: 84.21 } });
    const e = expenseFromReceipt(draftFromReceipt(r, CATEGORIES), 'r1', '', ACTOR, NOW, newId)!;
    expect(e.amount).toBe(84.21);
  });

  it('REFUSES an incomplete draft rather than filling a blank with a guess', () => {
    for (const missing of [{ total: undefined }, { date: undefined }, { category: undefined }]) {
      const r = receipt({ parsed: parsed(missing) });
      const draft = draftFromReceipt(r, CATEGORIES);
      expect(draft.complete).toBe(false);
      expect(expenseFromReceipt(draft, 'r1', '', ACTOR, NOW, newId)).toBeNull();
    }
    // An unparseable receipt is the extreme case: no draft, no expense.
    const blank = draftFromReceipt(receipt(), CATEGORIES);
    expect(blank.complete).toBe(false);
    expect(expenseFromReceipt(blank, 'r1', '', ACTOR, NOW, newId)).toBeNull();
  });

  it('refuses a zero, negative or non-finite total', () => {
    for (const total of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = receipt({ parsed: parsed({ total }) });
      expect(draftFromReceipt(r, CATEGORIES).missing).toContain('total');
    }
  });

  it('refuses a malformed date rather than coercing one', () => {
    for (const date of ['02/10/2026', '2026-10', 'October 2', '']) {
      const r = receipt({ parsed: parsed({ date }) });
      expect(draftFromReceipt(r, CATEGORIES).missing).toContain('date');
    }
  });

  it('a draft is inert — it has no id and nothing writes it', () => {
    const draft = complete();
    expect('id' in draft).toBe(false);
    expect(draft).toMatchObject({ complete: true, missing: [] });
  });
});

/* ---------------- Linking, both directions ---------------- */

describe('creating an expense links both ways', () => {
  it('sets attachmentUrl so the expense carries its own proof', () => {
    const e = expenseFromReceipt(
      draftFromReceipt(receipt({ parsed: parsed() }), CATEGORIES),
      'r1', 'https://cdn.test/r1.jpg', ACTOR, NOW, newId,
    )!;
    expect(e.attachmentUrl).toBe('https://cdn.test/r1.jpg');
    // And names its source in plain text too, since a URL can be rotated.
    expect(e.note).toContain('receipt r1');
  });

  it('records the expense id on the receipt', () => {
    const linked = linkReceipt(receipt(), 'exp-9', NOW + 5);
    expect(linked.status).toBe('linked');
    expect(linked.linkedExpenseId).toBe('exp-9');
    expect(linked.updatedAt).toBe(NOW + 5);
  });

  it('omits attachmentUrl rather than storing an empty string', () => {
    const e = expenseFromReceipt(
      draftFromReceipt(receipt({ parsed: parsed() }), CATEGORIES),
      'r1', '', ACTOR, NOW, newId,
    )!;
    expect('attachmentUrl' in e).toBe(false);
  });
});

/* ---------------- Deleting the expense leaves the receipt ---------------- */

describe('deleting the linked expense leaves the receipt in place', () => {
  it('reverts it to unreviewed, keeping the image and the parse', () => {
    const linked = linkReceipt(receipt({ parsed: parsed() }), 'exp-1', NOW);
    const after = unlinkReceipt(linked, NOW + 10);

    expect(after.status).toBe('unreviewed');
    expect(after.linkedExpenseId).toBeUndefined();
    // THE POINT: deleting an expense must never take the only copy of the
    // paper with it.
    expect(after.pages).toEqual(linked.pages);
    expect(after.parsed).toEqual(linked.parsed);
  });

  it('orphanedReceipts finds exactly the ones pointing at a dead expense', () => {
    const live = linkReceipt(receipt({ id: 'r-live' }), 'exp-live', NOW);
    const dead = linkReceipt(receipt({ id: 'r-dead' }), 'exp-gone', NOW);
    const filed = receipt({ id: 'r-filed' });
    const notExpense = markNotExpense(receipt({ id: 'r-no' }), NOW);

    const orphans = orphanedReceipts([live, dead, filed, notExpense], [{ id: 'exp-live' }]);
    expect(orphans.map(r => r.id)).toEqual(['r-dead']);
  });

  it('marking not_expense drops a stale link rather than leaving a dangling id', () => {
    const linked = linkReceipt(receipt(), 'exp-1', NOW);
    expect(markNotExpense(linked, NOW + 1).linkedExpenseId).toBeUndefined();
  });
});

/* ---------------- A parse failure is still a filed receipt ---------------- */

describe('a receipt that will not parse is still a filed receipt', () => {
  const failed = receipt({ parsed: { failed: 'the photo could not be read', parsedAt: NOW } });

  it('is viewable, with its image intact', () => {
    expect(failed.pages[0].path).toBeTruthy();
    expect(failed.status).toBe('unreviewed');
  });

  it('is searchable by the day it was filed, since it has no date of its own', () => {
    expect(receiptDay(failed, toISODate)).toBe(toISODate(NOW));
    const day = toISODate(NOW);
    expect(searchReceipts([failed], { from: day, to: day }, toISODate)).toHaveLength(1);
  });

  it('is not hidden by an amount filter it cannot be judged against', () => {
    // No readable total is not evidence of anything. Dropping it here would
    // make a filter quietly shrink the archive.
    expect(searchReceipts([failed], { minAmount: 10, maxAmount: 100 }, toISODate)).toHaveLength(1);
  });

  it('offers an empty draft that refuses to become an expense', () => {
    const draft = draftFromReceipt(failed, CATEGORIES);
    expect(draft.complete).toBe(false);
    expect(expenseFromReceipt(draft, failed.id, '', ACTOR, NOW, newId)).toBeNull();
  });
});

/* ---------------- Search ---------------- */

describe('search', () => {
  const a = receipt({ id: 'a', uploadedAt: NOW, parsed: parsed({ date: '2026-10-02', total: 84.21, payee: 'Cable Depot', text: 'CABLE DEPOT ... TOTAL 84.21' }) });
  const b = receipt({ id: 'b', uploadedAt: NOW + 1000, parsed: parsed({ date: '2026-09-15', total: 1200, payee: 'Landlord Inc', category: 'rent', text: 'LANDLORD INC october rent' }) });
  const c = markNotExpense(receipt({ id: 'c', uploadedAt: NOW + 2000, parsed: parsed({ date: '2026-10-05', total: 12, payee: 'Coffee Bar', text: 'COFFEE BAR flat white' }) }), NOW);
  const all = [a, b, c];

  it('is NEWEST FIRST', () => {
    expect(searchReceipts(all, {}, toISODate).map(r => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('DOES NOT HIDE unreviewed by default — no status means every status', () => {
    expect(searchReceipts(all, {}, toISODate)).toHaveLength(3);
    expect(searchReceipts(all, { statuses: [] }, toISODate)).toHaveLength(3);
  });

  it('filters by date range on the receipt\'s own date', () => {
    expect(searchReceipts(all, { from: '2026-10-01' }, toISODate).map(r => r.id)).toEqual(['c', 'a']);
    expect(searchReceipts(all, { to: '2026-09-30' }, toISODate).map(r => r.id)).toEqual(['b']);
  });

  it('filters by payee, case-insensitively and on a partial', () => {
    expect(searchReceipts(all, { payee: 'landlord' }, toISODate).map(r => r.id)).toEqual(['b']);
    expect(searchReceipts(all, { payee: 'depot' }, toISODate).map(r => r.id)).toEqual(['a']);
  });

  it('filters by amount range', () => {
    expect(searchReceipts(all, { minAmount: 100 }, toISODate).map(r => r.id)).toEqual(['b']);
    expect(searchReceipts(all, { maxAmount: 50 }, toISODate).map(r => r.id)).toEqual(['c']);
  });

  it('filters by status when asked', () => {
    expect(searchReceipts(all, { statuses: ['not_expense'] }, toISODate).map(r => r.id)).toEqual(['c']);
    expect(searchReceipts(all, { statuses: ['unreviewed'] }, toISODate).map(r => r.id)).toEqual(['b', 'a']);
  });

  it('searches the text read off the receipt', () => {
    expect(searchReceipts(all, { text: 'CABLE DEPOT' }, toISODate).map(r => r.id)).toEqual(['a']);
    expect(searchReceipts(all, { text: 'nothing here' }, toISODate)).toEqual([]);
  });

  it('a corrected payee is what gets searched, not the parse', () => {
    const fixed = receipt({ id: 'd', parsed: parsed({ payee: 'CBL DPT' }), entered: { payee: 'Cable Depot' } });
    expect(searchReceipts([fixed], { payee: 'Cable Depot' }, toISODate)).toHaveLength(1);
  });
});

/* ---------------- Who may use it ---------------- */

describe('who may scan, and who may delete', () => {
  it('scanning follows expenses.add — the tier that may already file an expense', () => {
    expect(canUseReceipts(() => true)).toBe(true);
    expect(canUseReceipts(() => false)).toBe(false);
  });

  it('deleting is the owner-only half of the expense split', () => {
    expect(canDeleteReceipt(() => true)).toBe(true);
    expect(canDeleteReceipt(() => false)).toBe(false);
  });

  it('the real rbac table puts receipts at owner+manager, and delete at owner', () => {
    // Asserted against the actual permission table rather than a stub, so
    // this cannot silently drift from services/rbac.ts.
    for (const role of ['owner', 'manager'] as const) {
      expect({ role, scan: canUseReceipts(p => can(role, p)) }).toEqual({ role, scan: true });
    }
    for (const role of ['employee', 'technician', 'kiosk'] as const) {
      expect({ role, scan: canUseReceipts(p => can(role, p)) }).toEqual({ role, scan: false });
    }
    // Delete: owner only.
    expect(canDeleteReceipt(p => can('owner', p))).toBe(true);
    expect(canDeleteReceipt(p => can('manager', p))).toBe(false);
  });
});

/* ---------------- The promise, asserted against the source ---------------- */

describe('no code path creates an Expense without the confirm', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  /**
   * Strip comments before scanning.
   *
   * A plain substring scan over the source fires on the PROSE — both files say
   * in their header comment that they never write an expense, which a naive
   * regex reads as evidence that they do. Scanning the code only is the
   * difference between a test that means something and one that has to be
   * loosened until it doesn't.
   */
  const code = (p: string): string =>
    read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the capture hook never writes an expense', () => {
    // Upload, queue and parse must have no route to the books at all. If a
    // "high confidence auto-post" is ever added, it would land here first.
    const hook = code('hooks/useReceiptCapture.ts');
    expect(hook).not.toMatch(/saveExpense\s*\(/);
    expect(hook).not.toMatch(/expenseFromReceipt/);
    expect(hook).not.toMatch(/from '\.\.\/domain\/receipt'/);
  });

  it('the parse policy never writes an expense', () => {
    const policy = code('functions/src/ai/receiptPolicy.ts');
    // It is pure: no Firestore handle exists in it to write one with.
    expect(policy).not.toMatch(/firebase-admin|firestore|saveExpense/);
  });

  it('App wires expense creation to exactly ONE receipt callback', () => {
    const app = read('App.tsx');
    // One handler, and it is reached from the review screen's button only.
    expect((app.match(/handleCreateExpenseFromReceipt/g) || []).length).toBe(2);
    const handler = app.slice(app.indexOf('const handleCreateExpenseFromReceipt'));
    const body = handler.slice(0, handler.indexOf('\n  };'));
    // It goes through the EXISTING expense write path — no second route to the
    // P&L is added.
    expect(body).toMatch(/handleSaveExpense\(expense, true\)/);
    expect(body).not.toMatch(/saveExpense\(/);
  });

  it('the receipts screen has exactly one expense-creating control', () => {
    const view = read('components/ReceiptsView.tsx');
    // onCreateExpense is called from one place: the button.
    expect((view.match(/onCreateExpense\(draft\)/g) || []).length).toBe(1);
    // And it is in a click handler, not an effect.
    expect(view).not.toMatch(/useEffect\([^)]*onCreateExpense/);
  });
});
