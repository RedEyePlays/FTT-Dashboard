import {
  SalesTransaction, CashReconciliation, CashDrawerEntry, Expense, Settlement, StaffBonus,
} from '../types';
import { impliedRefundSplits } from './pos';
import { cashCollectedOnTx, expectedEndingCash, sumDrawerEntries, recomputedVariance } from './reports';

/**
 * THE DAY MONEY TRAIL.
 *
 * When the drawer is short, "what happened to the money that day?" used to be
 * a dead end: the Day History tab showed totals and nothing else. This module
 * turns one calendar day into a single time-ordered list of every movement,
 * plus the walk from the opening float down to the shortfall.
 *
 * Pure — no Firestore, no DOM, no clock. The screen and the CSV export both
 * render exactly these rows, so what you read on screen is what you export.
 *
 * TWO RULES THIS MODULE KEEPS:
 *
 *  1. The math is the EXISTING math. expectedEndingCash, sumDrawerEntries and
 *     recomputedVariance are imported, never re-implemented — a second copy
 *     would drift, and the one place it drifted would be the screen somebody
 *     uses to settle an accusation.
 *
 *  2. Stored expectedCash/variance are NEVER trusted. An offline drawer write
 *     is a field merge that deliberately does not write them, so the stored
 *     figures can be stale until the next online write. Everything here is
 *     derived from the parts.
 */

export type LedgerKind =
  | 'sale' | 'refund' | 'cash_in' | 'cash_out' | 'withdrawal'
  | 'expense' | 'settlement' | 'bonus' | 'purchase'
  | 'drawer_open' | 'drawer_reconcile';

export type LedgerMethod = 'cash' | 'card' | 'etransfer' | 'mixed' | 'personal' | 'other' | 'none';

export interface LedgerLink {
  type: 'sale' | 'expense' | 'settlement' | 'bonus' | 'drawer' | 'dropoff' | 'purchase';
  id: string;
}

export interface LedgerRow {
  id: string;
  /** Epoch ms. Absent when the record carries no time at all (legacy rows). */
  at?: number;
  kind: LedgerKind;
  /** What it was, in the words the shop uses. */
  label: string;
  /** Who did it — a name or an email. Absent means unattributed. */
  who?: string;
  /** Signed: positive is money INTO the store, negative is money out. */
  amount: number;
  /** The part of `amount` that moved the physical till. Signed the same way. */
  cashAmount: number;
  method: LedgerMethod;
  note?: string;
  link?: LedgerLink;
  /** A drawer entry with nobody recorded against it. Never guessed at. */
  unattributed?: boolean;
  voided?: boolean;
  returned?: boolean;
  /** Owner-only. Trimmed out for a manager by trimForViewer. */
  cost?: number;
  margin?: number;
}

export interface DayLedgerInput {
  date: string;                       // YYYY-MM-DD
  sales: SalesTransaction[];
  recon?: CashReconciliation;
  expenses?: Expense[];
  settlements?: Settlement[];
  /** Already filtered to what this viewer may see (domain/bonuses.ts). */
  bonuses?: StaffBonus[];
  /** Reports and history ignore anything before this date. */
  booksStartDate?: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const money = (n: number): string => `$${Math.abs(n).toFixed(2)}`;

/* ---------------- Attribution on a drawer entry ---------------- */

/**
 * Where a drawer entry came from, derived from the code path that wrote it.
 *
 * Entries written before attribution existed carry none of this. They are
 * shown as "unattributed" and are NEVER back-filled — a guess on a page
 * somebody uses to work out where money went is worse than an honest gap.
 */
export const DRAWER_SOURCE_LABEL: Record<string, string> = {
  quickPurchase: 'Device purchase',
  collectBalance: 'Layaway balance collected',
  voidSale: 'Refund — sale voided',
  returnSale: 'Refund — sale returned',
  openDrawer: 'Drawer opened',
  logCashMovement: 'Cash movement',
  expenseCashOut: 'Expense paid from till',
  recurringExpenseCashOut: 'Recurring expense paid from till',
  dropOffAccept: 'Drop-off paid out',
  settleDeviceBuyer: 'Device buyer settlement',
  staffBonus: 'Staff bonus paid',
  autoInventoryPurchase: 'Inventory purchase',
  reportsReconcile: 'Drawer counted',
  reportsEditNoCount: 'Drawer entry edited',
  closeDrawerModal: 'Drawer closed',
};

/** The refType a given write path produces, for the row's link. */
export const DRAWER_SOURCE_REF: Record<string, NonNullable<CashDrawerEntry['refType']>> = {
  quickPurchase: 'purchase',
  collectBalance: 'layaway',
  voidSale: 'sale',
  returnSale: 'sale',
  logCashMovement: 'manual',
  expenseCashOut: 'expense',
  recurringExpenseCashOut: 'expense',
  dropOffAccept: 'dropoff',
  settleDeviceBuyer: 'settlement',
  staffBonus: 'bonus',
  autoInventoryPurchase: 'purchase',
};

const REF_LINK_TYPE: Record<string, LedgerLink['type']> = {
  sale: 'sale', expense: 'expense', settlement: 'settlement', bonus: 'bonus',
  dropoff: 'dropoff', purchase: 'purchase', layaway: 'sale', manual: 'drawer',
};

/**
 * Stamp attribution onto a drawer entry being written.
 *
 * NEVER overwrites a field the entry already carries — a caller that knows
 * better than the write path wins, and a re-save of an existing entry keeps
 * the person who actually made it rather than whoever last pressed Save.
 */
export const attributeDrawerEntry = (
  entry: CashDrawerEntry,
  ctx: { at: number; by?: string; byEmail?: string; source?: string; refId?: string },
): CashDrawerEntry => {
  const source = entry.source ?? ctx.source;
  const refType = entry.refType ?? (source ? DRAWER_SOURCE_REF[source] : undefined);
  return {
    ...entry,
    at: entry.at ?? ctx.at,
    ...(entry.by ?? ctx.by ? { by: entry.by ?? ctx.by } : {}),
    ...(entry.byEmail ?? ctx.byEmail ? { byEmail: entry.byEmail ?? ctx.byEmail } : {}),
    ...(source ? { source } : {}),
    ...(refType ? { refType } : {}),
    ...(entry.refId ?? ctx.refId ? { refId: entry.refId ?? ctx.refId } : {}),
  };
};

/** True for an entry that cannot say who moved the money. */
export const isUnattributed = (e: CashDrawerEntry): boolean => !e.by && !e.byEmail;

/* ---------------- Building the rows ---------------- */

const saleMethodOf = (t: SalesTransaction): LedgerMethod => {
  if (t.paymentMethod === 'mixed') return 'mixed';
  if (t.paymentMethod === 'cash' || t.paymentMethod === 'card' || t.paymentMethod === 'etransfer') return t.paymentMethod;
  return 'other';
};

const saleLabel = (t: SalesTransaction): string => {
  const what = t.lines?.length === 1 ? t.lines[0].name : `${t.lines?.length || 0} items`;
  return `Sale — ${what}${t.customerName ? ` · ${t.customerName}` : ''}`;
};

const drawerRows = (
  recon: CashReconciliation | undefined,
  key: 'cashIn' | 'cashOut' | 'withdrawals',
  kind: LedgerKind,
  sign: 1 | -1,
): LedgerRow[] =>
  (recon?.[key] || []).map(e => ({
    id: `${key}:${e.id}`,
    at: e.at,
    kind,
    label: (e.source && DRAWER_SOURCE_LABEL[e.source])
      || (kind === 'cash_in' ? 'Cash in' : kind === 'withdrawal' ? 'Withdrawal' : 'Cash out'),
    who: e.by ? (e.byEmail || e.by) : e.byEmail,
    amount: round2(sign * Math.max(0, e.amount || 0)),
    cashAmount: round2(sign * Math.max(0, e.amount || 0)),
    method: 'cash' as const,
    note: e.note,
    link: e.refType && e.refId
      ? { type: REF_LINK_TYPE[e.refType] || 'drawer', id: e.refId }
      : { type: 'drawer' as const, id: recon?.date || '' },
    unattributed: isUnattributed(e) || undefined,
  }));

/**
 * Every money movement on one calendar day, oldest first.
 *
 * A row with no time at all sorts to the END rather than to 1970: an unknown
 * time is unknown, and pretending it happened before the drawer was opened
 * would invent a sequence that never existed.
 */
export const buildDayLedger = (input: DayLedgerInput): LedgerRow[] => {
  const { date, sales, recon, expenses = [], settlements = [], bonuses = [], booksStartDate } = input;
  if (booksStartDate && date < booksStartDate) return [];

  const rows: LedgerRow[] = [];

  // --- Sales, with their payment split, voided/returned marked ------------
  for (const t of sales.filter(s => s.date === date)) {
    const cash = cashCollectedOnTx(t);
    rows.push({
      id: `sale:${t.id}`,
      at: t.createdAt,
      kind: 'sale',
      label: saleLabel(t),
      amount: round2(t.totalPaid || 0),
      cashAmount: round2(cash),
      method: saleMethodOf(t),
      note: t.notes,
      link: { type: 'sale', id: t.id },
      voided: t.status === 'voided' || undefined,
      returned: t.status === 'returned' || undefined,
      cost: round2(t.totalCost || 0),
      margin: round2(t.netProfit || 0),
    });

    // --- Refunds, with the source they were actually paid back from ------
    if (t.status === 'voided' || t.status === 'returned') {
      const splits = impliedRefundSplits(t);
      const total = round2(splits.reduce((s, r) => s + Math.max(0, r.amount || 0), 0));
      // Only the store_cash portion ever leaves the till. A card reversal or
      // a refund out of the owner's own pocket is real money, and appears in
      // the All-money view, but it does NOT move the drawer.
      const fromTill = round2(splits.filter(s => s.paidFrom === 'store_cash')
        .reduce((s, r) => s + Math.max(0, r.amount || 0), 0));
      if (total >= 0.005) {
        const sole = splits.length === 1 ? splits[0].paidFrom : undefined;
        rows.push({
          id: `refund:${t.id}`,
          at: t.status === 'voided' ? t.voidedAt : t.returnedAt,
          kind: 'refund',
          label: `Refund — ${t.status === 'voided' ? 'voided' : 'returned'} sale${t.customerName ? ` · ${t.customerName}` : ''}`,
          who: t.status === 'voided' ? (t.voidedByEmail || t.voidedBy) : (t.returnedByEmail || t.returnedBy),
          amount: -total,
          // `|| 0` so a refund that never touched the till reads as 0, not -0.
          cashAmount: -fromTill || 0,
          method: splits.length > 1 ? 'mixed'
            : sole === 'store_cash' ? 'cash'
              : sole === 'personal' ? 'personal'
                : sole === 'card' ? 'card'
                  : sole === 'etransfer' ? 'etransfer' : 'other',
          note: t.restockingFee ? `Restocking fee ${money(t.restockingFee)} withheld` : undefined,
          link: { type: 'sale', id: t.id },
        });
      }
    }
  }

  // --- Drawer movements ---------------------------------------------------
  rows.push(...drawerRows(recon, 'cashIn', 'cash_in', 1));
  rows.push(...drawerRows(recon, 'cashOut', 'cash_out', -1));
  rows.push(...drawerRows(recon, 'withdrawals', 'withdrawal', -1));

  // --- Expenses dated that day -------------------------------------------
  // The drawer's own cash-out entry already carries the till effect, so an
  // expense row records the SPEND, not a second movement of the same cash.
  for (const x of expenses.filter(e => e.date === date)) {
    const isCash = x.paymentMethod === 'cash';
    rows.push({
      id: `expense:${x.id}`,
      at: x.createdAt,
      kind: 'expense',
      label: `Expense — ${x.category}${x.payee ? ` · ${x.payee}` : ''}`,
      who: x.enteredByEmail || x.enteredBy,
      amount: -round2(x.amount || 0),
      // Zero: the matching drawer cashOut entry is the till movement. Counting
      // it here as well would double the shortfall it is meant to explain.
      cashAmount: 0,
      method: isCash ? 'cash' : x.paymentMethod === 'card' ? 'card' : x.paymentMethod === 'etransfer' ? 'etransfer' : 'other',
      note: x.note,
      link: { type: 'expense', id: x.id },
    });
  }

  // --- Settlement cash collected -----------------------------------------
  for (const s of settlements.filter(x => x.date === date)) {
    const collected = round2(s.storeCashIn ?? 0);
    if (collected < 0.005) continue;
    rows.push({
      id: `settlement:${s.id}`,
      at: s.settledAt,
      kind: 'settlement',
      label: 'Device buyer settlement',
      who: s.settledByEmail || s.settledBy,
      amount: collected,
      cashAmount: 0, // the drawer's own cashIn entry carries the till effect
      method: (s.paymentMethod ?? 'cash') === 'cash' ? 'cash' : s.paymentMethod === 'etransfer' ? 'etransfer' : 'other',
      note: s.notes || undefined,
      link: { type: 'settlement', id: s.id },
    });
  }

  // --- Staff bonuses paid -------------------------------------------------
  // `bonuses` is pre-filtered by the caller to what this viewer may see, the
  // same payroll-visibility rule the Time Clock uses.
  for (const b of bonuses.filter(x => x.date === date)) {
    rows.push({
      id: `bonus:${b.id}`,
      at: b.createdAt,
      kind: 'bonus',
      label: `Staff bonus — ${b.userEmail}`,
      who: b.createdByEmail || b.createdBy,
      amount: -round2(b.amount || 0),
      cashAmount: 0, // the drawer's own cashOut entry carries the till effect
      method: b.paidFrom === 'store_cash' ? 'cash' : b.paidFrom === 'personal' ? 'personal' : 'other',
      note: b.reason,
      link: { type: 'bonus', id: b.id },
    });
  }

  // --- The drawer's own stamps, as rows ----------------------------------
  if (recon?.openedAt) {
    rows.push({
      id: `drawer_open:${recon.date}`,
      at: recon.openedAt,
      kind: 'drawer_open',
      label: `Drawer opened — float ${money(recon.openingFloat || 0)}`,
      who: recon.openedByEmail || recon.openedBy,
      amount: 0,
      cashAmount: 0,
      method: 'none',
      link: { type: 'drawer', id: recon.date },
    });
  }
  if (recon?.reconciledAt) {
    rows.push({
      id: `drawer_reconcile:${recon.date}`,
      at: recon.reconciledAt,
      kind: 'drawer_reconcile',
      label: `Drawer counted — ${money(recon.countedCash || 0)}`,
      who: recon.reconciledByEmail || recon.reconciledBy,
      amount: 0,
      cashAmount: 0,
      method: 'none',
      note: recon.note,
      link: { type: 'drawer', id: recon.date },
    });
  }

  return sortLedger(rows);
};

/** Oldest first; rows with no time at all go last, in a stable order. */
export const sortLedger = (rows: LedgerRow[]): LedgerRow[] =>
  [...rows].sort((a, b) => {
    if (a.at == null && b.at == null) return a.id.localeCompare(b.id);
    if (a.at == null) return 1;
    if (b.at == null) return -1;
    return a.at - b.at || a.id.localeCompare(b.id);
  });

/** "Cash only" — the movements that actually touched the till. */
export const cashOnly = (rows: LedgerRow[]): LedgerRow[] =>
  rows.filter(r => Math.abs(r.cashAmount) >= 0.005 || r.kind === 'drawer_open' || r.kind === 'drawer_reconcile');

/* ---------------- The shortfall walk ---------------- */

export type WalkLine =
  | 'openingFloat' | 'cashSales' | 'cashIn' | 'cashOut' | 'withdrawals'
  | 'expected' | 'counted' | 'variance';

export interface WalkStep {
  key: WalkLine;
  label: string;
  amount: number;
  /** '+', '−', or '=' — how this line enters the sum. */
  op: '+' | '−' | '=';
}

export interface ShortfallWalk {
  steps: WalkStep[];
  expected: number;
  counted: number | null;
  variance: number;
  /** The day was counted; without a count there is no shortfall to explain. */
  counted_: boolean;
}

/**
 * Opening float / + cash sales / + cash in / − cash out / − withdrawals
 * = expected, against the count.
 *
 * Uses expectedEndingCash and recomputedVariance — the same functions the
 * drawer screen and the carry-over use. The stored expectedCash/variance on
 * the record are deliberately ignored: an offline merge write leaves them
 * stale, and a shortfall page reading a stale number is the one place that
 * must not happen.
 */
export const shortfallWalk = (
  recon: CashReconciliation | undefined,
  cashSales: number,
  openingFloat?: number,
): ShortfallWalk => {
  const float = round2(openingFloat ?? recon?.openingFloat ?? 0);
  const cashIn = sumDrawerEntries(recon?.cashIn);
  const cashOut = sumDrawerEntries(recon?.cashOut);
  const withdrawals = sumDrawerEntries(recon?.withdrawals);
  const expected = expectedEndingCash({
    openingFloat: float, cashSales, cashIn, cashOut, withdrawals,
  });
  const counted = recon?.countedCash ?? null;
  const variance = recon?.countedCash == null
    ? 0
    : round2(recon.countedCash - expected);

  const steps: WalkStep[] = [
    { key: 'openingFloat', label: 'Opening float', amount: float, op: '+' },
    { key: 'cashSales', label: 'Cash sales', amount: round2(cashSales), op: '+' },
    { key: 'cashIn', label: 'Cash in', amount: cashIn, op: '+' },
    { key: 'cashOut', label: 'Cash out', amount: cashOut, op: '−' },
    { key: 'withdrawals', label: 'Withdrawals', amount: withdrawals, op: '−' },
    { key: 'expected', label: 'Expected in drawer', amount: expected, op: '=' },
  ];
  if (counted != null) {
    steps.push({ key: 'counted', label: 'Counted', amount: round2(counted), op: '=' });
    steps.push({
      key: 'variance',
      label: variance < 0 ? 'Short' : variance > 0 ? 'Over' : 'Balanced',
      amount: round2(variance),
      op: '=',
    });
  }
  return { steps, expected, counted, variance, counted_: counted != null };
};

/** Which rows a walk line is made of, for click-to-filter. */
export const rowsForWalkLine = (rows: LedgerRow[], key: WalkLine): LedgerRow[] => {
  switch (key) {
    case 'openingFloat': return rows.filter(r => r.kind === 'drawer_open');
    case 'cashSales': return rows.filter(r => r.kind === 'sale' && r.cashAmount >= 0.005);
    case 'cashIn': return rows.filter(r => r.kind === 'cash_in');
    case 'cashOut': return rows.filter(r => r.kind === 'cash_out');
    case 'withdrawals': return rows.filter(r => r.kind === 'withdrawal');
    case 'counted':
    case 'variance': return rows.filter(r => r.kind === 'drawer_reconcile');
    case 'expected':
    default: return cashOnly(rows);
  }
};

/* ---------------- Facts to check, never accusations ---------------- */

export interface DayLedgerFacts {
  unattributedCount: number;
  unattributedTotal: number;
  noNoteCount: number;
  /** Movements logged AFTER the drawer was counted. */
  afterReconcile: LedgerRow[];
  /** The previous day was opened and never closed (drawerCarryOver knows). */
  previousDayNeverClosed: boolean;
  previousDayDate?: string;
}

/**
 * What to LOOK at when a day doesn't balance.
 *
 * Deliberately facts, not conclusions: "3 entries have nobody recorded against
 * them" is checkable, "somebody took $200" is an accusation this page has no
 * business making. Nothing here names a suspect or implies one.
 */
export const dayLedgerFacts = (
  rows: LedgerRow[],
  recon: CashReconciliation | undefined,
  carry?: { fromDate: string; stillOpen: boolean } | null,
): DayLedgerFacts => {
  const drawerRowsOnly = rows.filter(r => r.kind === 'cash_in' || r.kind === 'cash_out' || r.kind === 'withdrawal');
  const unattributed = drawerRowsOnly.filter(r => r.unattributed);
  return {
    unattributedCount: unattributed.length,
    unattributedTotal: round2(unattributed.reduce((s, r) => s + Math.abs(r.amount), 0)),
    noNoteCount: drawerRowsOnly.filter(r => !r.note || !r.note.trim()).length,
    afterReconcile: recon?.reconciledAt
      ? rows.filter(r => r.kind !== 'drawer_reconcile' && r.at != null && r.at > recon.reconciledAt!)
      : [],
    previousDayNeverClosed: !!carry?.stillOpen,
    previousDayDate: carry?.stillOpen ? carry.fromDate : undefined,
  };
};

/* ---------------- Who sees what ---------------- */

export interface LedgerViewer {
  /** reports.profit.detailed — owner by default. Managers do NOT have it. */
  canSeeCost: boolean;
}

/**
 * A manager with cash.reconcile must be able to explain a shortfall without
 * being shown what the shop makes per unit. Cost and margin are removed from
 * the rows themselves, not merely hidden by the table — so the CSV export
 * cannot leak what the screen withholds.
 */
export const trimForViewer = (rows: LedgerRow[], viewer: LedgerViewer): LedgerRow[] =>
  viewer.canSeeCost
    ? rows
    : rows.map(({ cost: _cost, margin: _margin, ...rest }) => rest);

/* ---------------- Export ---------------- */

export const LEDGER_CSV_COLUMNS = [
  'time', 'what', 'who', 'amount', 'cashEffect', 'method', 'note', 'reference',
] as const;

const timeLabel = (at?: number): string =>
  at == null ? '' : new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * One row per movement, the same columns and the same permission trimming as
 * the screen — `rows` must already have been through trimForViewer.
 */
export const ledgerCsvRows = (rows: LedgerRow[]): Record<string, string>[] =>
  rows.map(r => {
    const base: Record<string, string> = {
      time: timeLabel(r.at),
      what: r.label + (r.voided ? ' (voided)' : r.returned ? ' (returned)' : ''),
      who: r.who || 'unattributed',
      amount: r.amount.toFixed(2),
      cashEffect: r.cashAmount.toFixed(2),
      method: r.method,
      note: r.note || '',
      reference: r.link ? `${r.link.type}:${r.link.id}` : '',
    };
    if (r.cost != null) base.cost = r.cost.toFixed(2);
    if (r.margin != null) base.margin = r.margin.toFixed(2);
    return base;
  });

export { recomputedVariance };
