import { describe, it, expect } from 'vitest';
import {
  SalesTransaction, CashReconciliation, CashDrawerEntry, Expense, Settlement, StaffBonus,
} from '../types';
import {
  buildDayLedger, cashOnly, shortfallWalk, rowsForWalkLine, dayLedgerFacts,
  trimForViewer, ledgerCsvRows, attributeDrawerEntry, isUnattributed, sortLedger,
  LedgerRow,
} from './dayLedger';
import { expectedEndingCash } from './reports';

// When the drawer is short, this is the page that answers "what happened to
// the money that day?". Two things it must never do: invent a number (the
// stored expectedCash can be stale after an offline write) and show a manager
// what the shop makes per unit.

const DATE = '2026-09-19';
const T = (h: number, m = 0) => Date.UTC(2026, 8, 19, h, m);

const sale = (over: Partial<SalesTransaction> = {}): SalesTransaction => ({
  id: 's1', date: DATE, createdAt: T(10), customerName: 'Ali',
  paymentMethod: 'cash', subtotal: 100, tax: 0, platformFee: 0,
  purchaseCost: 40, repairCost: 0, totalCost: 40, totalPaid: 100, netProfit: 60,
  lines: [{ kind: 'device', name: 'iPhone 12', quantity: 1, unitPrice: 100 }],
  ...over,
});

const entry = (over: Partial<CashDrawerEntry> = {}): CashDrawerEntry =>
  ({ id: 'c1', amount: 50, note: 'top-up', at: T(11), by: 'u1', byEmail: 'ali@shop.test', ...over });

const recon = (over: Partial<CashReconciliation> = {}): CashReconciliation => ({
  id: DATE, date: DATE, openingFloat: 200,
  expectedCash: 99999, variance: 99999,   // deliberately absurd — never read
  openedAt: T(9), openedBy: 'u1', openedByEmail: 'ali@shop.test',
  recordedBy: 'u1', recordedAt: T(9),
  ...over,
});

/* ---------------- The trail ---------------- */

describe('one time-ordered list of every movement', () => {
  it('sorts by time, oldest first', () => {
    const rows = buildDayLedger({
      date: DATE,
      sales: [sale({ id: 'late', createdAt: T(17) }), sale({ id: 'early', createdAt: T(8) })],
      recon: recon({ cashIn: [entry({ at: T(11) })] }),
    });
    const times = rows.map(r => r.at!);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('a row with NO time sorts last, not to 1970', () => {
    // Unknown is unknown. Placing it before the drawer opened would invent a
    // sequence that never happened.
    const rows = sortLedger([
      { id: 'b', kind: 'cash_in', label: 'x', amount: 1, cashAmount: 1, method: 'cash' },
      { id: 'a', at: T(12), kind: 'cash_in', label: 'y', amount: 1, cashAmount: 1, method: 'cash' },
    ] as LedgerRow[]);
    expect(rows.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('a voided or returned sale is marked, not hidden', () => {
    const rows = buildDayLedger({
      date: DATE,
      sales: [sale({ id: 'v', status: 'voided', voidedAt: T(12), voidedByEmail: 'mgr@shop.test' })],
    });
    expect(rows.find(r => r.id === 'sale:v')!.voided).toBe(true);
    expect(rows.find(r => r.id === 'refund:v')).toBeTruthy();
  });

  it('the drawer open and the count are rows of their own', () => {
    const rows = buildDayLedger({
      date: DATE, sales: [],
      recon: recon({ countedCash: 300, reconciledAt: T(19), reconciledByEmail: 'ali@shop.test' }),
    });
    expect(rows.map(r => r.kind)).toEqual(['drawer_open', 'drawer_reconcile']);
  });

  it('nothing at all before the books start date', () => {
    expect(buildDayLedger({ date: DATE, sales: [sale()], booksStartDate: '2026-10-01' })).toEqual([]);
  });
});

describe('a mixed-payment sale is split correctly', () => {
  const rows = buildDayLedger({
    date: DATE,
    sales: [sale({ paymentMethod: 'mixed', totalPaid: 100, cashAmount: 40, cardAmount: 60 })],
  });
  const row = rows[0];

  it('records the whole sale as the amount', () => {
    expect(row.amount).toBe(100);
  });

  it('but only the CASH half as the till effect', () => {
    expect(row.cashAmount).toBe(40);
    expect(row.method).toBe('mixed');
  });

  it('and it survives the cash-only filter with its cash figure', () => {
    expect(cashOnly(rows).map(r => r.cashAmount)).toEqual([40]);
  });
});

describe('a refund reduces cash ONLY for its store_cash portion', () => {
  // A card reversal or a refund out of the owner's own pocket is real money
  // and belongs in the All-money view, but it never moved the till.
  const refundRows = (over: Partial<SalesTransaction>) => buildDayLedger({
    date: DATE,
    sales: [sale({ id: 'r', status: 'returned', returnedAt: T(15), refundAmount: 100, ...over })],
  }).filter(r => r.kind === 'refund');

  it('a store-cash refund takes the money out of the drawer', () => {
    const [r] = refundRows({ refundPaidFrom: 'store_cash' });
    expect(r.amount).toBe(-100);
    expect(r.cashAmount).toBe(-100);
  });

  it('a card refund moves real money but NOT the till', () => {
    const [r] = refundRows({ refundPaidFrom: 'card' });
    expect(r.amount).toBe(-100);
    expect(r.cashAmount).toBe(0);
    expect(cashOnly([r])).toEqual([]);
  });

  it("a refund from the owner's own pocket does not touch the drawer either", () => {
    const [r] = refundRows({ refundPaidFrom: 'personal' });
    expect(r.cashAmount).toBe(0);
    expect(r.method).toBe('personal');
  });

  it('a split refund takes out only the store-cash part', () => {
    const [r] = refundRows({ refundSplits: [{ paidFrom: 'store_cash', amount: 30 }, { paidFrom: 'card', amount: 70 }] });
    expect(r.amount).toBe(-100);
    expect(r.cashAmount).toBe(-30);
    expect(r.method).toBe('mixed');
  });
});

describe('an expense, settlement or bonus does not double-count the till', () => {
  // Each of these already writes its own drawer entry. Counting the till
  // effect twice would double the very shortfall the page exists to explain.
  const expense: Expense = {
    id: 'x1', date: DATE, amount: 80, category: 'Supplies', paymentMethod: 'cash',
    enteredBy: 'u1', enteredByEmail: 'ali@shop.test', createdAt: T(13),
  };
  const bonus: StaffBonus = {
    id: 'b1', userId: 'u2', userEmail: 'sam@shop.test', amount: 50, date: DATE,
    reason: 'great week', paidFrom: 'store_cash', createdBy: 'u1', createdAt: T(16),
  };
  const settlement: Settlement = {
    id: 'st1', buyerId: 'buy1', date: DATE, dropOffIds: [], totalFees: 40,
    storeCashIn: 240, paymentMethod: 'cash', notes: '', settledAt: T(14),
  };
  const rows = buildDayLedger({
    date: DATE, sales: [],
    recon: recon({ cashOut: [entry({ id: 'e1', amount: 80, source: 'expenseCashOut', refType: 'expense', refId: 'x1' })] }),
    expenses: [expense], bonuses: [bonus], settlements: [settlement],
  });

  it('the expense appears as a spend with no second till movement', () => {
    const x = rows.find(r => r.kind === 'expense')!;
    expect(x.amount).toBe(-80);
    expect(x.cashAmount).toBe(0);
  });

  it('the drawer entry is the one that moves the till, and it links back', () => {
    const c = rows.find(r => r.kind === 'cash_out')!;
    expect(c.cashAmount).toBe(-80);
    expect(c.link).toEqual({ type: 'expense', id: 'x1' });
    expect(c.label).toBe('Expense paid from till');
  });

  it('the settlement records the cash collected', () => {
    expect(rows.find(r => r.kind === 'settlement')!.amount).toBe(240);
  });

  it('the bonus is money out', () => {
    expect(rows.find(r => r.kind === 'bonus')!.amount).toBe(-50);
  });

  it('a bonus the viewer may not see simply is not passed in', () => {
    // The caller applies the payroll-visibility rule, the same one the Time
    // Clock uses — this module never decides who may see a colleague's pay.
    expect(buildDayLedger({ date: DATE, sales: [], bonuses: [] }).some(r => r.kind === 'bonus')).toBe(false);
  });
});

/* ---------------- The shortfall walk ---------------- */

describe('the walk adds up to expected', () => {
  const r = recon({
    cashIn: [entry({ id: 'i1', amount: 50 })],
    cashOut: [entry({ id: 'o1', amount: 80 })],
    withdrawals: [entry({ id: 'w1', amount: 100 })],
    countedCash: 400,
  });
  const walk = shortfallWalk(r, 400);

  it('float + cash sales + cash in − cash out − withdrawals = expected', () => {
    expect(walk.expected).toBe(200 + 400 + 50 - 80 - 100);
    expect(walk.expected).toBe(expectedEndingCash({
      openingFloat: 200, cashSales: 400, cashIn: 50, cashOut: 80, withdrawals: 100,
    }));
  });

  it('the steps are the same numbers, in the order they are read out', () => {
    expect(walk.steps.map(s => [s.key, s.amount])).toEqual([
      ['openingFloat', 200], ['cashSales', 400], ['cashIn', 50],
      ['cashOut', 80], ['withdrawals', 100], ['expected', 470],
      ['counted', 400], ['variance', -70],
    ]);
  });

  it('reports the shortfall against the COUNT', () => {
    expect(walk.variance).toBe(-70);
    expect(walk.steps.find(s => s.key === 'variance')!.label).toBe('Short');
  });

  it('NEVER trusts the stored expectedCash or variance', () => {
    // An offline drawer write is a field merge that deliberately does not
    // write them, so they can be stale. These are set to an absurd figure in
    // the fixture precisely so a read of them would be obvious.
    expect(walk.expected).not.toBe(r.expectedCash);
    expect(walk.variance).not.toBe(r.variance);
  });

  it('an uncounted day has no shortfall to report', () => {
    const open = shortfallWalk(recon(), 400);
    expect(open.counted).toBeNull();
    expect(open.variance).toBe(0);
    expect(open.steps.map(s => s.key)).not.toContain('variance');
  });

  it('every line filters the trail to the rows it is made of', () => {
    const rows = buildDayLedger({ date: DATE, sales: [sale()], recon: r });
    expect(rowsForWalkLine(rows, 'cashSales').map(x => x.id)).toEqual(['sale:s1']);
    expect(rowsForWalkLine(rows, 'withdrawals').map(x => x.id)).toEqual(['withdrawals:w1']);
    expect(rowsForWalkLine(rows, 'openingFloat').map(x => x.kind)).toEqual(['drawer_open']);
  });
});

/* ---------------- Facts, never accusations ---------------- */

describe('what to look at when a day does not balance', () => {
  const r = recon({
    countedCash: 100, reconciledAt: T(18),
    cashOut: [
      // Written before attribution existed: no `by`, no `at`, no note.
      { id: 'old', amount: 200 } as CashDrawerEntry,
      entry({ id: 'later', amount: 25, at: T(20), note: 'after the count' }),
    ],
  });
  const rows = buildDayLedger({ date: DATE, sales: [], recon: r });
  const facts = dayLedgerFacts(rows, r, { fromDate: '2026-09-18', stillOpen: true });

  it('counts the unattributed entries and their total', () => {
    expect(facts.unattributedCount).toBe(1);
    expect(facts.unattributedTotal).toBe(200);
  });

  it('counts entries with no note', () => {
    expect(facts.noNoteCount).toBe(1);
  });

  it('lists movements logged AFTER the drawer was counted', () => {
    expect(facts.afterReconcile.map(x => x.id)).toEqual(['cashOut:later']);
  });

  it('says when the previous day was never closed', () => {
    expect(facts.previousDayNeverClosed).toBe(true);
    expect(facts.previousDayDate).toBe('2026-09-18');
  });

  it('an old entry is shown as unattributed, never back-filled with a guess', () => {
    const old = rows.find(x => x.id === 'cashOut:old')!;
    expect(old.unattributed).toBe(true);
    expect(old.who).toBeUndefined();
    expect(old.at).toBeUndefined();
  });
});

/* ---------------- Who sees what ---------------- */

describe('a manager can explain a shortfall without seeing the margin', () => {
  const rows = buildDayLedger({ date: DATE, sales: [sale()], recon: recon({ cashIn: [entry()] }) });

  it('the owner sees cost and margin', () => {
    const owner = trimForViewer(rows, { canSeeCost: true });
    expect(owner.find(r => r.kind === 'sale')!.margin).toBe(60);
  });

  it('a manager sees the movement but NOT what the shop makes on it', () => {
    const mgr = trimForViewer(rows, { canSeeCost: false });
    const s = mgr.find(r => r.kind === 'sale')!;
    expect(s.amount).toBe(100);
    expect(s.cost).toBeUndefined();
    expect(s.margin).toBeUndefined();
    expect('margin' in s).toBe(false);
  });

  it('the fields are REMOVED, so the export cannot leak what the screen hides', () => {
    const csv = ledgerCsvRows(trimForViewer(rows, { canSeeCost: false }));
    expect(csv.every(r => !('cost' in r) && !('margin' in r))).toBe(true);
    expect(ledgerCsvRows(trimForViewer(rows, { canSeeCost: true })).some(r => 'margin' in r)).toBe(true);
  });

  it('the export is one row per movement, in the same order', () => {
    const csv = ledgerCsvRows(trimForViewer(rows, { canSeeCost: true }));
    expect(csv).toHaveLength(rows.length);
    expect(csv.map(r => r.what)).toEqual(rows.map(r => r.label));
  });

  it('an unattributed row says so in the export rather than naming anyone', () => {
    const csv = ledgerCsvRows([{ id: 'x', kind: 'cash_out', label: 'Cash out', amount: -5, cashAmount: -5, method: 'cash' }]);
    expect(csv[0].who).toBe('unattributed');
  });
});

/* ---------------- Attribution on the way in ---------------- */

describe('stamping attribution onto a drawer entry', () => {
  const ctx = { at: T(12), by: 'u1', byEmail: 'ali@shop.test', source: 'staffBonus', refId: 'b1' };

  it('fills in who, when, the path and the record it came from', () => {
    expect(attributeDrawerEntry({ id: 'e', amount: 50 }, ctx)).toEqual({
      id: 'e', amount: 50, at: T(12), by: 'u1', byEmail: 'ali@shop.test',
      source: 'staffBonus', refType: 'bonus', refId: 'b1',
    });
  });

  it('NEVER overwrites a field the entry already carries', () => {
    // Re-saving the Reports editor's lists must keep whoever actually made
    // each entry, not credit them all to whoever last pressed Save.
    const existing = attributeDrawerEntry(
      { id: 'e', amount: 50, at: T(9), by: 'u2', byEmail: 'sam@shop.test', source: 'logCashMovement' },
      ctx,
    );
    expect(existing.by).toBe('u2');
    expect(existing.at).toBe(T(9));
    expect(existing.source).toBe('logCashMovement');
    expect(existing.refType).toBe('manual');
  });

  it('leaves an entry with no known path unattributed rather than guessing', () => {
    const e = attributeDrawerEntry({ id: 'e', amount: 5 }, { at: T(12) });
    expect(isUnattributed(e)).toBe(true);
    expect(e.source).toBeUndefined();
    expect(e.refType).toBeUndefined();
  });
});
