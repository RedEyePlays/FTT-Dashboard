import { Expense, RecurringExpense, RecurringFrequency, RecurringAmountMode } from '../types';
import { toISODate, shiftISODate } from './dates';

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// --- Categories ---------------------------------------------------------

export interface ExpenseCategory {
  key: string;
  label: string;
  // Wages is tracked here for visibility (an owner may want to log a one-off
  // bonus or contractor payment without running it through the full payroll
  // system) but must NEVER be subtracted a second time in the P&L — payroll
  // is already subtracted separately from PayPeriodPaid.gross (see
  // domain/reports.ts). A category flagged excludeFromPL is informational
  // only: it shows up in the expense list and the by-category breakdown, but
  // is skipped when summing the P&L's expense total.
  excludeFromPL?: boolean;
  archived?: boolean;
}

// Sensible defaults for a repair shop. Owner-editable via Settings
// (AppSettings.expenses.categories) — these are only the seed values.
export const DEFAULT_EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { key: 'rent', label: 'Rent' },
  { key: 'utilities', label: 'Utilities' },
  { key: 'parts_inventory', label: 'Parts & Inventory (non-COGS)' },
  { key: 'tools_equipment', label: 'Tools & Equipment' },
  { key: 'software', label: 'Software/Subscriptions' },
  { key: 'advertising', label: 'Advertising' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'bank_fees', label: 'Bank/Merchant Fees' },
  { key: 'vehicle_fuel', label: 'Vehicle/Fuel' },
  { key: 'wages', label: 'Wages', excludeFromPL: true },
  { key: 'other', label: 'Other' },
];

// --- Filtering / totals ---------------------------------------------------

const order = (a: string, b: string): [string, string] => a <= b ? [a, b] : [b, a];
const inRange = (dateISO: string, lo: string, hi: string): boolean => !!dateISO && dateISO >= lo && dateISO <= hi;

export const expensesInRange = (expenses: Expense[], start: string, end: string): Expense[] => {
  const [lo, hi] = order(start, end);
  return expenses.filter(e => inRange(e.date, lo, hi));
};

/** Every non-archived category flagged excludeFromPL, by key — used to keep
 * a category (Wages) out of the P&L total without hardcoding its name. */
export const excludedFromPLKeys = (categories: ExpenseCategory[]): Set<string> =>
  new Set(categories.filter(c => c.excludeFromPL).map(c => c.key));

/** The P&L expense total: every expense in range, EXCEPT categories flagged
 * excludeFromPL (Wages — already subtracted via payroll). This is the sole
 * total domain/reports.ts's profitAndLoss subtracts, so a category can only
 * double-count against payroll by explicitly being un-flagged, never by
 * accident. */
export const plExpenseTotal = (expenses: Expense[], categories: ExpenseCategory[], start: string, end: string): number => {
  const excluded = excludedFromPLKeys(categories);
  return round2(expensesInRange(expenses, start, end)
    .filter(e => !excluded.has(e.category))
    .reduce((s, e) => s + (e.amount || 0), 0));
};

export interface CategoryTotal { category: string; label: string; total: number; excludedFromPL: boolean }

/** Every category's total in range, informational (includes excludeFromPL
 * categories like Wages) — this is what the report screen displays; only
 * plExpenseTotal decides what feeds net profit. */
export const expenseTotalsByCategory = (expenses: Expense[], categories: ExpenseCategory[], start: string, end: string): CategoryTotal[] => {
  const byKey = new Map(categories.map(c => [c.key, c]));
  const totals = new Map<string, number>();
  for (const e of expensesInRange(expenses, start, end)) {
    totals.set(e.category, round2((totals.get(e.category) || 0) + (e.amount || 0)));
  }
  return [...totals.entries()]
    .map(([category, total]) => {
      const cat = byKey.get(category);
      return { category, label: cat?.label || category, total, excludedFromPL: !!cat?.excludeFromPL };
    })
    .sort((a, b) => b.total - a.total);
};

// --- Recurring expenses ---------------------------------------------------

/** One period forward, clamping day-of-month overflow (Jan 31 + 1 month
 * lands on the last day of February, not rolling into March). */
const addPeriod = (dateISO: string, frequency: RecurringFrequency): string => {
  if (frequency === 'weekly') return shiftISODate(dateISO, 7);
  const d = new Date(`${dateISO}T00:00:00`);
  const day = d.getDate();
  if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  if (d.getDate() !== day) d.setDate(0); // rolls back to the last real day of the intended month
  return toISODate(d);
};

/** The period key an occurrence date is recorded under — monthly/yearly key
 * by calendar (so the day-of-month drifting via addPeriod's clamping still
 * lands in the right bucket); weekly keys by its own exact date, since
 * weekly occurrences are just every 7th day from startDate. */
const periodKeyFor = (dateISO: string, frequency: RecurringFrequency): string => {
  if (frequency === 'monthly') return dateISO.slice(0, 7);
  if (frequency === 'yearly') return dateISO.slice(0, 4);
  return dateISO;
};

export interface DuePeriod { key: string; date: string }

const MAX_PERIODS = 500; // guards a runaway loop; ~40 years of weekly periods

/** Every period from startDate through now that hasn't already been
 * generated or explicitly skipped — the "generate once per period, and it's
 * skippable" contract. Ordered oldest first. */
export const duePeriodsFor = (r: RecurringExpense, now: number): DuePeriod[] => {
  if (!r.active || !r.startDate) return [];
  const nowISO = toISODate(now);
  if (r.startDate > nowISO) return [];
  const done = new Set([...(r.generatedPeriods || []), ...(r.skippedPeriods || [])]);
  const out: DuePeriod[] = [];
  let cursor = r.startDate;
  let guard = 0;
  while (cursor <= nowISO && guard++ < MAX_PERIODS) {
    const key = periodKeyFor(cursor, r.frequency);
    if (!done.has(key)) out.push({ key, date: cursor });
    cursor = addPeriod(cursor, r.frequency);
  }
  return out;
};

/** A template with no authoritative amount of its own — utilities, phone,
 * card-processing fees. `amountMode` is optional so every template written
 * before this feature keeps behaving exactly as before ('fixed'). */
export const amountModeOf = (r: Pick<RecurringExpense, 'amountMode'>): RecurringAmountMode => r.amountMode || 'fixed';
export const isVariableRecurring = (r: Pick<RecurringExpense, 'amountMode'>): boolean => amountModeOf(r) === 'variable';

/**
 * The amount a due period would post at, or null when it CANNOT post yet.
 *
 * Fixed: the template's stored amount (must be > 0).
 * Variable: ONLY an amount explicitly entered by a person for this period.
 * `estimatedAmount` is deliberately never consulted here — it is a UI prefill
 * hint, nothing more. A variable bill that nobody has typed a figure for
 * returns null and therefore stays pending; silently posting last month's
 * utility figure as if it were the real one would corrupt the P&L.
 */
export const resolveRecurringAmount = (r: RecurringExpense, enteredAmount?: number): number | null => {
  if (isVariableRecurring(r)) {
    return typeof enteredAmount === 'number' && enteredAmount > 0 ? round2(enteredAmount) : null;
  }
  // A fixed template may still be overridden at generation time (an owner
  // correcting a one-off rent change) — but it never NEEDS the override.
  const amount = typeof enteredAmount === 'number' && enteredAmount > 0 ? enteredAmount : r.amount;
  return amount > 0 ? round2(amount) : null;
};

/** The last `n` posted amounts for a template, newest first — shown when
 * entering a variable bill so an unusual figure is obvious ("last 3: $142,
 * $138, $151"). Reads the ordinary Expense ledger; no parallel history. */
export const lastAmountsForRecurring = (expenses: Expense[], recurringId: string, n = 3): number[] =>
  expenses
    .filter(e => e.recurringId === recurringId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, n)
    .map(e => e.amount);

/** Build the (unsaved) Expense draft for one due period. Pure — the caller
 * assigns an id and persists it.
 *
 * Throws when the period has no usable amount (a variable bill nobody has
 * entered a figure for). That is deliberate and load-bearing: there is no
 * code path that turns a variable template into a real Expense without a
 * real, human-entered number.
 */
export const buildRecurringExpense = (
  r: RecurringExpense,
  period: DuePeriod,
  user: { id: string; email: string },
  now: number,
  enteredAmount?: number,
): Omit<Expense, 'id'> => {
  const amount = resolveRecurringAmount(r, enteredAmount);
  if (amount === null) {
    throw new Error(`Recurring expense ${r.id} (${amountModeOf(r)}) has no amount for period ${period.key}`);
  }
  return {
    date: period.date,
    amount,
    category: r.category,
    paymentMethod: r.paymentMethod,
    payee: r.payee,
    note: r.note,
    enteredBy: user.id,
    enteredByEmail: user.email,
    createdAt: now,
    recurringId: r.id,
    recurringPeriod: period.key,
  };
};

// --- Visibility ------------------------------------------------------------

/**
 * The expense rows a viewer is allowed to BROWSE.
 *
 * Owner (expenses.viewAll) sees the whole ledger. A manager holds only
 * expenses.add, so their list is scoped to entries they submitted themselves,
 * keyed on the server-stamped `enteredBy` field — no parallel ownership
 * mechanism.
 *
 * IMPORTANT: this is a BROWSE filter for the expense-list UI only. It must
 * never be applied to ProfitLossInput.expenses — net profit subtracts every
 * workspace expense regardless of who may browse the ledger (see
 * domain/reports.ts).
 */
export const visibleExpensesFor = (
  expenses: Expense[],
  viewer: { id: string; canViewAll: boolean },
): Expense[] => viewer.canViewAll ? expenses : expenses.filter(e => e.enteredBy === viewer.id);

/** Whether a viewer may edit/delete one specific expense: owners any, a
 * manager only their own entries. Mirrors firestore.rules' expenses block. */
export const canMutateExpense = (
  expense: Pick<Expense, 'enteredBy'>,
  viewer: { id: string; canViewAll: boolean },
): boolean => viewer.canViewAll || expense.enteredBy === viewer.id;
