import {
  AppUser, Expense, ExpensePaymentMethod, Receipt, ReceiptEntered, ReceiptParse,
  ReceiptStatus,
} from '../types';
import { ExpenseCategory } from './expenses';

/**
 * RECEIPTS: THE ARCHIVE IS THE PRODUCT.
 *
 * A button the owner hits to photograph a receipt. The photo is filed and
 * kept. Nothing else is required. The expense entry is an optional action on
 * top of the file, and that ordering drives every rule in here.
 *
 * THE ONE CONSTRAINT THAT OUTRANKS EVERYTHING ELSE: nothing becomes an Expense
 * without an explicit confirm. There is no auto-post in this module, no
 * confidence threshold, and no setting that could introduce one. The only
 * function here that produces an Expense is `expenseFromReceipt`, it takes the
 * reviewed draft as an argument rather than deriving it silently, and the
 * screen calls it from a button. A test asserts that no other export can
 * return an Expense.
 *
 * THE SECOND RULE: a parse never overwrites what a person typed. `parsed` and
 * `entered` are separate fields on the document and are merged at READ time
 * only (`effectiveFields`). If corrections overwrote the parse, "was the
 * parsing any good?" would be permanently unanswerable.
 *
 * Pure: no Firestore, no DOM, no AI.
 */

/* ---------------- Status ---------------- */

export const RECEIPT_STATUSES: ReceiptStatus[] = ['unreviewed', 'linked', 'not_expense'];

export const RECEIPT_STATUS_LABEL: Record<ReceiptStatus, string> = {
  // Named so it does not read as a chore. The archive is meant to fill up with
  // these and most will never be anything else.
  unreviewed: 'Filed',
  linked: 'Expense created',
  not_expense: 'Not an expense',
};

/** Anything stored at all. Accepts a loose value so a legacy doc still reads. */
export const receiptStatus = (v: unknown): ReceiptStatus =>
  v === 'linked' || v === 'not_expense' ? v : 'unreviewed';

/* ---------------- Suggestions vs. what the owner typed ---------------- */

/** The fields a receipt can carry a value for, from either source. */
export interface ReceiptFields {
  date?: string;
  total?: number;
  currency?: string;
  payee?: string;
  tax?: number;
  category?: string;
  note?: string;
}

const has = (v: unknown): boolean =>
  v !== undefined && v !== null && v !== '' && !(typeof v === 'number' && Number.isNaN(v));

/**
 * WHAT TO SHOW: the owner's value where there is one, the parse underneath.
 *
 * Merged here, at read time, and NEVER written back over `parsed`. A field the
 * owner cleared on purpose (an empty string) counts as entered and wins — that
 * is how "the model read a total that is not there" gets corrected to nothing.
 */
export const effectiveFields = (r: Pick<Receipt, 'parsed' | 'entered'>): ReceiptFields => {
  const p = r.parsed || {};
  const e = r.entered || {};
  const pick = <K extends keyof ReceiptFields>(key: K): ReceiptFields[K] => {
    // `key in e` rather than a truthiness check: an explicitly-cleared field is
    // a decision, and the parse must not come back to override it.
    if (e && Object.prototype.hasOwnProperty.call(e, key)) return (e as ReceiptFields)[key];
    return (p as ReceiptFields)[key];
  };
  return {
    date: pick('date'), total: pick('total'), currency: pick('currency'),
    payee: pick('payee'), tax: pick('tax'), category: pick('category'),
    note: e.note,
  };
};

/** Did the owner's value differ from the parse? Used for "how good is this?". */
export const correctedFields = (r: Pick<Receipt, 'parsed' | 'entered'>): string[] => {
  const p = (r.parsed || {}) as Record<string, unknown>;
  const e = (r.entered || {}) as Record<string, unknown>;
  return Object.keys(e)
    .filter(k => k !== 'note')
    .filter(k => has(p[k]) && String(p[k]) !== String(e[k]));
};

/**
 * Record an edit WITHOUT touching the parse.
 *
 * Returns the next `entered` object only — the caller writes it to that one
 * field, so there is no code path in which a correction can reach `parsed`.
 */
export const applyEdit = (
  r: Pick<Receipt, 'entered'>,
  patch: Partial<ReceiptEntered>,
): ReceiptEntered => ({ ...(r.entered || {}), ...patch });

/* ---------------- The suggested category ---------------- */

/**
 * The model's category suggestion, CLAMPED to this workspace's own list.
 *
 * Mirrored by the server copy in functions/src/ai/receiptPolicy.ts, which is
 * the one that actually gates what comes back. This is the second gate, on the
 * stored value, so a document written before a category was archived (or by an
 * older client) still cannot put a category on a draft that the expense form
 * would then reject.
 *
 * An archived category is NOT offered: it is still valid on historical rows
 * but is not something to file anything new under.
 */
export const clampCategory = (
  suggested: unknown,
  categories: ExpenseCategory[],
): string | undefined => {
  const key = typeof suggested === 'string' ? suggested.trim() : '';
  if (!key) return undefined;
  const live = categories.filter(c => !c.archived);
  const exact = live.find(c => c.key === key);
  if (exact) return exact.key;
  // A label match is allowed because that is what a model reads off a list,
  // but it still has to land on a real key.
  const byLabel = live.find(c => c.label.toLowerCase() === key.toLowerCase());
  return byLabel ? byLabel.key : undefined;
};

/* ---------------- The draft, and the ONE path to an Expense ---------------- */

/**
 * What the review screen shows: the merged values, plus what is missing.
 *
 * A draft is NOT an expense and cannot become one by itself. It carries no id
 * and nothing writes it anywhere.
 */
export interface ExpenseDraft {
  date: string;
  amount: number;
  category: string;
  payee: string;
  note: string;
  paymentMethod: ExpensePaymentMethod;
  /** Fields with no usable value — the screen marks these for typing. */
  missing: (keyof ReceiptFields)[];
  /** True when every field the Expense requires is present. */
  complete: boolean;
}

export const draftFromReceipt = (
  r: Pick<Receipt, 'parsed' | 'entered'>,
  categories: ExpenseCategory[],
  defaults: { paymentMethod?: ExpensePaymentMethod } = {},
): ExpenseDraft => {
  const f = effectiveFields(r);
  const category = clampCategory(f.category, categories) || '';
  const amount = typeof f.total === 'number' && Number.isFinite(f.total) && f.total > 0 ? f.total : 0;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? f.date! : '';
  const missing: (keyof ReceiptFields)[] = [];
  if (!date) missing.push('date');
  if (!amount) missing.push('total');
  if (!category) missing.push('category');
  return {
    date, amount, category,
    payee: f.payee || '',
    note: f.note || '',
    paymentMethod: defaults.paymentMethod || 'other',
    missing,
    complete: missing.length === 0,
  };
};

/**
 * THE ONLY FUNCTION IN THIS CODEBASE THAT TURNS A RECEIPT INTO AN EXPENSE.
 *
 * It takes the REVIEWED draft, not the receipt's parse, so the values that
 * reach the books are the ones the owner was looking at when they tapped. It
 * refuses an incomplete draft rather than filling a blank with a guess.
 *
 * It returns the Expense; it does not write it. The caller hands it to the
 * existing expense write path (App.tsx's handleSaveExpense), which is the only
 * route into the P&L and already carries the rules, the audit entry and the
 * cash-drawer link. No second write route to the books is added anywhere.
 *
 * `attachmentUrl` is set to the receipt image so the expense carries its own
 * proof, and the caller records the expense id on the receipt — both
 * directions, so neither screen is a dead end.
 */
export const expenseFromReceipt = (
  draft: ExpenseDraft,
  receiptId: string,
  attachmentUrl: string,
  actor: Pick<AppUser, 'id' | 'email'>,
  now: number,
  newId: () => string,
): Expense | null => {
  if (!draft.complete) return null;
  return {
    id: newId(),
    date: draft.date,
    amount: draft.amount,
    category: draft.category,
    paymentMethod: draft.paymentMethod,
    ...(draft.payee ? { payee: draft.payee } : {}),
    // The receipt id goes in the note so the expense names its source in plain
    // text as well as through attachmentUrl, which is a URL and may be rotated.
    note: [draft.note, `receipt ${receiptId}`].filter(Boolean).join(' · '),
    ...(attachmentUrl ? { attachmentUrl } : {}),
    enteredBy: actor.id,
    enteredByEmail: actor.email,
    createdAt: now,
  };
};

/* ---------------- Status transitions ---------------- */

/** Mark it linked. Only ever called right after an Expense was created. */
export const linkReceipt = (r: Receipt, expenseId: string, now: number): Receipt =>
  ({ ...r, status: 'linked', linkedExpenseId: expenseId, updatedAt: now });

/**
 * ONE TAP, AND IT MUST NEVER FEEL LIKE DELETING.
 *
 * The image and the document both stay, and it stays searchable. That is why
 * this is a status and not a flag on a deleted row.
 */
export const markNotExpense = (r: Receipt, now: number, reason?: string): Receipt => ({
  ...r,
  status: 'not_expense',
  ...(reason ? { notExpenseReason: reason } : {}),
  // A receipt that was linked and is now "not an expense" loses the link — the
  // expense it pointed at is the caller's to remove, and a dangling id reads as
  // if one still exists.
  linkedExpenseId: undefined,
  updatedAt: now,
});

/**
 * The linked expense was deleted. THE RECEIPT STAYS, as unreviewed.
 *
 * Back to the resting state rather than to anything that reads as an error:
 * the photo is still a photo of a real receipt, and the owner may well link it
 * again. Deleting an expense must never take the only copy of the paper with
 * it.
 */
export const unlinkReceipt = (r: Receipt, now: number): Receipt => ({
  ...r, status: 'unreviewed', linkedExpenseId: undefined, updatedAt: now,
});

/** Receipts pointing at an expense that no longer exists. */
export const orphanedReceipts = (receipts: Receipt[], expenses: Pick<Expense, 'id'>[]): Receipt[] => {
  const live = new Set(expenses.map(e => e.id));
  return receipts.filter(r => r.status === 'linked' && !!r.linkedExpenseId && !live.has(r.linkedExpenseId));
};

/* ---------------- Search ---------------- */

export interface ReceiptQuery {
  /** YYYY-MM-DD, inclusive. Matched against the receipt's effective date, or its upload day. */
  from?: string;
  to?: string;
  payee?: string;
  minAmount?: number;
  maxAmount?: number;
  /** Empty or absent means EVERY status — see the note on defaults below. */
  statuses?: ReceiptStatus[];
  /** Full-text over the parsed text, payee and note. A bonus, not a filter. */
  text?: string;
}

/** The day a receipt belongs to: its own date if known, else the day it was filed. */
export const receiptDay = (r: Receipt, toISO: (ms: number) => string): string =>
  effectiveFields(r).date || toISO(r.uploadedAt);

/**
 * NEWEST FIRST, AND NO DEFAULT THAT HIDES `unreviewed`.
 *
 * An empty `statuses` means all of them. That is deliberate and is the whole
 * reason this takes a list rather than a single optional status: 'unreviewed'
 * is the normal resting state of a filed receipt, not a backlog to clear, and
 * a list that defaulted to hiding it would hide most of the archive.
 */
export const searchReceipts = (
  receipts: Receipt[],
  q: ReceiptQuery,
  toISO: (ms: number) => string,
): Receipt[] => {
  const needle = (q.text || '').trim().toLowerCase();
  const payee = (q.payee || '').trim().toLowerCase();
  const wanted = new Set(q.statuses || []);

  return receipts
    .filter(r => {
      if (wanted.size > 0 && !wanted.has(receiptStatus(r.status))) return false;

      const day = receiptDay(r, toISO);
      if (q.from && day < q.from) return false;
      if (q.to && day > q.to) return false;

      const f = effectiveFields(r);
      if (payee && !(f.payee || '').toLowerCase().includes(payee)) return false;

      // An amount filter only excludes a receipt whose amount is KNOWN and
      // outside the range. One with no readable total is not evidence of
      // anything and must not vanish from the archive because of a filter it
      // cannot be judged against.
      const amount = typeof f.total === 'number' ? f.total : undefined;
      if (q.minAmount != null && amount != null && amount < q.minAmount) return false;
      if (q.maxAmount != null && amount != null && amount > q.maxAmount) return false;

      if (needle) {
        const hay = [f.payee, f.note, r.parsed?.text, r.notExpenseReason]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
};

/* ---------------- Who may use it ---------------- */

/**
 * SCANNING IS MANAGER-UP, matching `expenses` exactly.
 *
 * The reasoning, since it was a real choice: a manager already creates and
 * edits their own expense entries (services/rbac.ts's 'expenses.add', and the
 * firestore.rules expenses block), and a receipt is strictly less powerful
 * than the expense it might become — filing one moves no money and touches no
 * P&L figure. Refusing the photo while allowing the expense would mean a
 * manager typing an expense from paper they are not allowed to photograph,
 * which protects nothing and loses the archive precisely when the owner is
 * away. So: the same tier, and a receipt is never more visible than the
 * expense it would become.
 *
 * Employees, technicians and the kiosk: no. They hold no expense permission at
 * all (an employee has no expense access whatsoever — amounts are
 * cost-sensitive), and a receipt is a financial record.
 *
 * DELETING is owner-only and separate — see canDeleteReceipt.
 */
export const canUseReceipts = (can: (p: 'expenses.add') => boolean): boolean => can('expenses.add');

/**
 * Deleting a receipt is OWNER-ONLY and deliberate.
 *
 * `expenses.viewAll` is the owner-only half of the expense split, so it names
 * the owner tier without inventing a permission. Marking something
 * not_expense is the ordinary way to say "this is not a business cost" and it
 * keeps the image; deletion is for a photo that should never have been taken.
 */
export const canDeleteReceipt = (can: (p: 'expenses.viewAll') => boolean): boolean => can('expenses.viewAll');
