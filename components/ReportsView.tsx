import React, { useMemo, useState } from 'react';
import { Wallet, Receipt, Download, Save, AlertTriangle, CheckCircle2, Plus, Trash2, Scale, FileArchive, Truck, DoorOpen, History, LockOpen, Banknote, Pencil, Repeat, SkipForward } from 'lucide-react';
import { SalesTransaction, CashReconciliation, CashDrawerEntry, InventoryItem, PayPeriodPaid, Settlement, DeviceBuyer, Repair, Customer, AuditEntry, ActivityEntry, TimeEntry, AppUser, Expense, RecurringExpense, ExpensePaymentMethod, RecurringFrequency, RecurringAmountMode } from '../types';
import {
  ExpenseCategory, duePeriodsFor, DuePeriod, isVariableRecurring, lastAmountsForRecurring,
  visibleExpensesFor, canMutateExpense,
} from '../domain/expenses';
import { useEscapeKey } from '../hooks/useEscapeKey';
import {
  expectedCashForDate, expectedEndingCash, sumDrawerEntries, reconcileCash, taxRemittance, taxReportCsvRows, TaxGrouping,
  profitAndLoss, profitLossCsvRows, settlementHistory, yearEndSummary, yearEndCsvRows, ProfitLossInput, ReconciliationInput,
  cashSalesAfterClose,
  cashDrawerSummary,
} from '../domain/reports';
import { computeAnalytics, presetRange } from '../domain/analytics';
import { entriesOnDate, workedHours } from '../domain/timeclock';
import { toCSV, triggerDownload } from '../services/backup';
import { newId } from '../domain/ids';
import { toISODate, todayISO } from '../domain/dates';

type SaveReconciliation = (r: ReconciliationInput) => void;

interface Props {
  salesTransactions: SalesTransaction[];
  cashReconciliations: CashReconciliation[];
  inventory: InventoryItem[];
  payPeriods: PayPeriodPaid[];
  settlements: Settlement[];
  deviceBuyers: DeviceBuyer[];
  expenses: Expense[];
  expenseCategories: ExpenseCategory[];
  recurringExpenses: RecurringExpense[];
  // The expense ledger's two permissions (services/rbac.ts):
  //   canAddExpense      (expenses.add, owner + manager) — may enter an
  //     expense, and see/edit/delete ONLY the ones they entered themselves.
  //   canViewAllExpenses (expenses.viewAll, owner only) — the full ledger,
  //     its totals and per-category breakdown, plus recurring-template config.
  // An employee/technician holds neither and never sees the tab at all.
  canAddExpense: boolean;
  canViewAllExpenses: boolean;
  currentUserId: string;
  onSaveExpense: (e: Expense, isNew: boolean) => void;
  onDeleteExpense: (e: Expense) => void;
  onSaveRecurringExpense: (r: RecurringExpense, isNew: boolean) => void;
  onDeleteRecurringExpense: (id: string) => void;
  // `enteredAmount` is required for a VARIABLE template and optional for a
  // fixed one — see domain/expenses.ts's buildRecurringExpense.
  onGenerateRecurringExpense: (r: RecurringExpense, period: DuePeriod, enteredAmount?: number) => void;
  onSkipRecurringPeriod: (r: RecurringExpense, periodKey: string) => void;
  onSaveReconciliation: SaveReconciliation;
  defaultOpeningFloat?: number;
  // Profit visibility (reports.profit.summary) and reconcile access
  // (cash.reconcile) are DIFFERENT permissions that happen to both reach this
  // view — an employee commonly has the second without the first. Each tab
  // that reveals revenue/cost/margin/profit is gated on canViewProfit
  // directly, INSIDE this component, rather than trusting that whoever
  // rendered <ReportsView> already restricted what's visible (that
  // ancestor-only gate — cash.reconcile guarding the entire section — is
  // exactly the bug this was added to fix).
  canReconcile: boolean;
  canViewProfit: boolean;
  // Daily History tab — everything that happened on a given day, reusing the
  // same underlying data every other view already reads (no parallel state).
  repairs: Repair[];
  customers: Customer[];
  auditLogs: AuditEntry[];
  activity: ActivityEntry[];
  timeEntries: TimeEntry[];
  users: AppUser[];
}

type TabId = 'history' | 'cash' | 'tax' | 'pnl' | 'expenses' | 'yearend' | 'settlements';
const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'history', label: 'Daily History', icon: <History className="w-4 h-4" /> },
  { id: 'cash', label: 'Cash Reconciliation', icon: <Wallet className="w-4 h-4" /> },
  { id: 'tax', label: 'Sales Tax', icon: <Receipt className="w-4 h-4" /> },
  { id: 'pnl', label: 'Profit & Loss', icon: <Scale className="w-4 h-4" /> },
  { id: 'expenses', label: 'Expenses', icon: <Banknote className="w-4 h-4" /> },
  { id: 'settlements', label: 'Device Buyer Settlements', icon: <Truck className="w-4 h-4" /> },
  { id: 'yearend', label: 'Year-End Export', icon: <FileArchive className="w-4 h-4" /> },
];

const money = (n: number) => `$${(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthStartISO = () => { const d = new Date(); return toISODate(new Date(d.getFullYear(), d.getMonth(), 1)); };

const card = 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl';
const input = 'px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
const label = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

// Which permission each tab actually requires. 'cash' needs cash.reconcile;
// 'expenses' needs EITHER half of the expense split — expenses.add (a manager,
// who gets a "my submitted expenses" view) or expenses.viewAll (the owner, who
// gets the whole ledger). Either is independent of profit visibility, since
// logging spend isn't the same as seeing margin; every other tab (history, tax, pnl, settlements, yearend)
// surfaces revenue/cost/margin/profit and needs canViewProfit
// (reports.profit.summary). Daily History's Sales/Revenue/Gross-Profit block
// and the settlement tab's fee-income totals are why those two are in this
// group, not just the obviously financial pnl/yearend tabs.
const tabAllowed = (id: TabId, perms: { canReconcile: boolean; canViewProfit: boolean; canAddExpense: boolean; canViewAllExpenses: boolean }): boolean => {
  if (id === 'cash') return perms.canReconcile;
  if (id === 'expenses') return perms.canAddExpense || perms.canViewAllExpenses;
  return perms.canViewProfit;
};

export const ReportsView: React.FC<Props> = ({
  salesTransactions, cashReconciliations, inventory, payPeriods, settlements, deviceBuyers, onSaveReconciliation,
  repairs, customers, auditLogs, activity, timeEntries, users, expenses, expenseCategories,
  recurringExpenses, canAddExpense, canViewAllExpenses, currentUserId, canReconcile, canViewProfit,
  onSaveExpense, onDeleteExpense,
  onSaveRecurringExpense, onDeleteRecurringExpense, onGenerateRecurringExpense, onSkipRecurringPeriod,
}) => {
  const perms = { canReconcile, canViewProfit, canAddExpense, canViewAllExpenses };
  const tabs = TABS.filter(t => tabAllowed(t.id, perms));
  // Default to the first tab this role can actually see — never a fixed
  // 'history', which a cash.reconcile-only employee (canViewProfit: false)
  // isn't permitted to view at all.
  const [tab, setTab] = useState<TabId>(() => tabs[0]?.id ?? 'cash');
  // Shared input set for the P&L / settlement / year-end reports.
  //
  // NOTE (deliberate, load-bearing): `expenses` here is the FULL workspace
  // array, never the per-viewer filtered one. The expenses.viewAll split
  // changes who may BROWSE the ledger, not what the accounting includes — net
  // profit must keep subtracting every workspace expense. The own-entries
  // filter lives exclusively in ExpensesTab (via visibleExpensesFor); it must
  // never be applied to ProfitLossInput.
  const plInput: ProfitLossInput = { transactions: salesTransactions, inventory, payPeriods, cashReconciliations, settlements, expenses, expenseCategories };
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${tab === t.id ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'}`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      {/* Every block below re-checks tabAllowed itself — belt and suspenders
          on top of the tabs[] filter above, so this component never renders a
          money figure whose access it hasn't verified directly. */}
      {tab === 'history' && tabAllowed('history', perms) && (
        <DailyHistoryTab
          salesTransactions={salesTransactions} cashReconciliations={cashReconciliations}
          repairs={repairs} inventory={inventory} customers={customers} auditLogs={auditLogs} activity={activity}
          timeEntries={timeEntries} users={users} settlements={settlements}
        />
      )}
      {tab === 'cash' && tabAllowed('cash', perms) && <CashReconTab salesTransactions={salesTransactions} cashReconciliations={cashReconciliations} onSave={onSaveReconciliation} />}
      {tab === 'tax' && tabAllowed('tax', perms) && <TaxReportTab salesTransactions={salesTransactions} />}
      {tab === 'pnl' && tabAllowed('pnl', perms) && <ProfitLossTab plInput={plInput} showExpenseCategories={canViewAllExpenses} />}
      {tab === 'expenses' && tabAllowed('expenses', perms) && (
        <ExpensesTab
          expenses={expenses} categories={expenseCategories} recurringExpenses={recurringExpenses}
          canViewAll={canViewAllExpenses} currentUserId={currentUserId}
          onSaveExpense={onSaveExpense} onDeleteExpense={onDeleteExpense}
          onSaveRecurringExpense={onSaveRecurringExpense} onDeleteRecurringExpense={onDeleteRecurringExpense}
          onGenerateRecurringExpense={onGenerateRecurringExpense} onSkipRecurringPeriod={onSkipRecurringPeriod}
        />
      )}
      {tab === 'settlements' && tabAllowed('settlements', perms) && <SettlementsTab settlements={settlements} deviceBuyers={deviceBuyers} />}
      {tab === 'yearend' && tabAllowed('yearend', perms) && <YearEndTab plInput={plInput} showExpenseCategories={canViewAllExpenses} />}
    </div>
  );
};

/* ---------------- Daily History ---------------- */
// Gated on canViewProfit (reports.profit.summary), not cash.reconcile — it
// shows Revenue and Gross Profit alongside the day's cash/hours/flags, so it
// needs the profit permission even though an employee can otherwise reach
// this whole view via cash.reconcile alone. Pulls together everything that
// happened on one picked date — the Close Out screen's summary, but for any
// past date, not just today. Every figure is read from the same domain
// functions the other tabs/screens already use (computeAnalytics,
// cashDrawerSummary, entriesOnDate/workedHours) — nothing here is a second
// calculation.
const DailyHistoryTab: React.FC<{
  salesTransactions: SalesTransaction[];
  cashReconciliations: CashReconciliation[];
  repairs: Repair[];
  inventory: InventoryItem[];
  customers: Customer[];
  auditLogs: AuditEntry[];
  activity: ActivityEntry[];
  timeEntries: TimeEntry[];
  users: AppUser[];
  // Device-buyer settlements — fee income only (see domain/analytics.ts), so a
  // day's history reconciles with the P&L tab for the same date.
  settlements: Settlement[];
}> = ({ salesTransactions, cashReconciliations, repairs, inventory, customers, auditLogs, activity, timeEntries, users, settlements }) => {
  const [date, setDate] = useState(todayISO());
  const now = Date.now();

  // Same sales/profit/repairs-completed math Owner Analytics and Close Out
  // both use — a single-day custom range around the picked date.
  const range = useMemo(() => presetRange('custom', now, { start: date, end: date }), [date, now]);
  const a = useMemo(
    () => computeAnalytics(range, { salesTransactions, repairs, inventory, customers, auditLogs, activity, settlements }, now),
    [range, salesTransactions, repairs, inventory, customers, auditLogs, activity, settlements, now],
  );
  const eod = a.eod;

  // Same cash-reconciliation figures the Cash Reconciliation tab / Close Out
  // read for a day — the saved record (if any) plus that day's cash sales.
  const cashSales = useMemo(() => expectedCashForDate(salesTransactions, date), [salesTransactions, date]);
  const recon = cashReconciliations.find(r => r.date === date);
  const drawer = useMemo(() => cashDrawerSummary(recon, cashSales), [recon, cashSales]);
  const reconciled = !!recon?.reconciledAt;
  const variance = recon?.variance || 0;
  const varianceOk = Math.abs(variance) < 0.005;

  // Same per-shift data the Time Clock's Daily Hours view reads — just scoped
  // to entries whose clock-in falls on this one date instead of a range.
  const nameById = useMemo(() => new Map(users.map(u => [u.id, u.email.split('@')[0]])), [users]);
  const dayEntries = useMemo(() => entriesOnDate(timeEntries, date), [timeEntries, date]);
  const hoursByUser = useMemo(() => {
    const byUser = new Map<string, number>();
    for (const e of dayEntries) byUser.set(e.userId, (byUser.get(e.userId) || 0) + workedHours(e, now));
    return [...byUser.entries()]
      .map(([userId, hours]) => ({ userId, name: nameById.get(userId) || userId, hours }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }, [dayEntries, nameById, now]);

  // A shift that started this day and still has no clock-out — same
  // isMissedClockOut concept the Time Clock view flags, scoped to this date
  // rather than "still open as of right now."
  const missedThatDay = useMemo(() => dayEntries.filter(e => !e.clockOut), [dayEntries]);

  const isToday = date === todayISO();

  return (
    <div className="space-y-6">
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <label className={label}>Date</label>
            <input type="date" max={todayISO()} value={date} onChange={e => setDate(e.target.value)} className={input} />
          </div>
          {!isToday && (
            <button onClick={() => setDate(todayISO())} className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">Jump to today</button>
          )}
        </div>
      </div>

      {/* --- Sales & repairs -------------------------------------------------- */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">Sales & Repairs</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Stat label="Sales" value={String(eod.sales)} />
          <Stat label="Revenue" value={money(eod.revenue)} />
          <Stat label="Gross Profit" value={money(eod.grossProfit)} tone={eod.grossProfit >= 0 ? 'good' : 'bad'} />
          <Stat label="Repairs Completed" value={String(eod.repairsCompleted)} />
        </div>
      </div>

      {/* --- Cash reconciliation ------------------------------------------------ */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">Cash Drawer</h3>
        {!drawer.opened ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" /> Drawer was never opened this day.
          </div>
        ) : reconciled ? (
          <div className="flex flex-wrap items-center gap-4">
            <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${varianceOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
              {varianceOk ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              Reconciled{varianceOk ? ' — balanced' : ` — ${variance > 0 ? 'over' : 'short'} ${money(Math.abs(variance))}`}
            </span>
            <span className="text-xs text-slate-400">
              Opening {money(drawer.openingFloat)} · Cash in {money(drawer.cashIn)} · Cash out {money(drawer.cashOut)} · Expected {money(drawer.expected)} · Counted {money(recon?.countedCash || 0)}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-amber-600 dark:text-amber-400">
            <LockOpen className="w-4 h-4" /> Not reconciled — opening {money(drawer.openingFloat)}, expected {money(drawer.expected)}
          </div>
        )}
      </div>

      {/* --- Hours worked --------------------------------------------------- */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">Hours Worked</h3>
        {hoursByUser.length === 0 ? (
          <p className="text-sm text-slate-400">No shifts recorded this day.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {hoursByUser.map(h => (
              <div key={h.userId} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-slate-700 dark:text-slate-200 capitalize">{h.name}</span>
                <span className="font-semibold text-slate-900 dark:text-white tabular-nums">{h.hours.toFixed(2)} hrs</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* --- Flags ------------------------------------------------------------ */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">Flags</h3>
        {missedThatDay.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="w-4 h-4" /> Nothing flagged for this day.</div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {missedThatDay.map(e => (
              <li key={e.id} className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> {nameById.get(e.userId) || e.userId} never clocked out this day.
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; tone?: 'good' | 'bad' }> = ({ label: l, value, tone }) => (
  <div>
    <p className="text-[11px] uppercase tracking-wide text-slate-400">{l}</p>
    <p className={`text-xl font-bold tabular-nums ${tone === 'good' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'bad' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{value}</p>
  </div>
);

/* ---------------- Cash reconciliation ---------------- */
const num = (v: string) => parseFloat(v) || 0;

const BreakdownRow: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
    <span>{label}</span><span>{value < 0 ? `−${money(Math.abs(value))}` : money(value)}</span>
  </div>
);

// Editable list of cash-drawer entries (amount + note). Its date + who-logged-it
// come from the parent reconciliation record, so each row is just money leaving.
const EntryList: React.FC<{ title: string; entries: CashDrawerEntry[]; onChange: (e: CashDrawerEntry[]) => void; notePlaceholder: string }> = ({ title, entries, onChange, notePlaceholder }) => {
  const set = (id: string, patch: Partial<CashDrawerEntry>) => onChange(entries.map(e => e.id === id ? { ...e, ...patch } : e));
  const total = sumDrawerEntries(entries);
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</span>
        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{money(total)}</span>
      </div>
      {entries.map(e => (
        <div key={e.id} className="flex items-center gap-2">
          <input type="number" step="0.01" min="0" value={e.amount || ''} onChange={ev => set(e.id, { amount: num(ev.target.value) })} placeholder="0.00" className={`${input} w-24`} />
          <input value={e.note || ''} onChange={ev => set(e.id, { note: ev.target.value })} placeholder={notePlaceholder} className={`${input} flex-1 min-w-0`} />
          <button onClick={() => onChange(entries.filter(x => x.id !== e.id))} className="p-1.5 text-slate-400 hover:text-rose-500" aria-label="Remove entry"><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
      <button onClick={() => onChange([...entries, { id: newId(), amount: 0 }])} className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
        <Plus className="w-3.5 h-3.5" /> Add entry
      </button>
    </div>
  );
};

const CashReconTab: React.FC<{
  salesTransactions: SalesTransaction[];
  cashReconciliations: CashReconciliation[];
  onSave: SaveReconciliation;
}> = ({ salesTransactions, cashReconciliations, onSave }) => {
  const [date, setDate] = useState(todayISO());
  const cashSales = useMemo(() => expectedCashForDate(salesTransactions, date), [salesTransactions, date]);
  const saved = cashReconciliations.find(r => r.date === date);
  // Cash taken in after this day was counted. The sale still counts as that
  // day's revenue and profit — this is only about the money not having been in
  // the drawer at count time, which is otherwise an unexplainable variance.
  const afterClose = useMemo(
    () => cashSalesAfterClose(salesTransactions, date, saved?.reconciledAt),
    [salesTransactions, date, saved?.reconciledAt],
  );
  // The drawer must have been explicitly opened for this day; otherwise we flag
  // it rather than silently assuming a starting float.
  const wasOpened = !!saved?.openedAt;

  const [openingFloat, setOpeningFloat] = useState('');
  const [cashIn, setCashIn] = useState<CashDrawerEntry[]>([]);
  const [cashOut, setCashOut] = useState<CashDrawerEntry[]>([]);
  const [withdrawals, setWithdrawals] = useState<CashDrawerEntry[]>([]);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  // Reload the editable fields whenever the selected day (or its saved record) changes.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (loadedFor !== date) {
    setLoadedFor(date);
    // Only prefill the float from a real open/save — never a silent default.
    setOpeningFloat(saved?.openingFloat != null ? String(saved.openingFloat) : '');
    setCashIn(saved?.cashIn ? saved.cashIn.map(e => ({ ...e })) : []);
    setCashOut(saved?.cashOut ? saved.cashOut.map(e => ({ ...e })) : []);
    setWithdrawals(saved?.withdrawals ? saved.withdrawals.map(e => ({ ...e })) : []);
    // A day may already have cash movements logged but not yet been counted —
    // leave the count blank in that case so it still reads as un-reconciled.
    setCounted(saved && saved.countedCash != null ? String(saved.countedCash) : '');
    setNote(saved?.note || '');
  }

  const openingNum = num(openingFloat);
  const cashInTotal = sumDrawerEntries(cashIn);
  const cashOutTotal = sumDrawerEntries(cashOut);
  const withdrawalTotal = sumDrawerEntries(withdrawals);
  const expected = expectedEndingCash({ openingFloat: openingNum, cashSales, cashIn: cashInTotal, cashOut: cashOutTotal, withdrawals: withdrawalTotal });
  const countedNum = num(counted);
  const { variance, direction } = reconcileCash(countedNum, expected);
  const hasCount = counted.trim() !== '';
  // A discrepancy (over/short) must be explained before it can be saved.
  const needsNote = hasCount && direction !== 'balanced' && !note.trim();
  const canSave = hasCount && !needsNote;

  const cleanEntries = (list: CashDrawerEntry[]) => list.filter(e => (e.amount || 0) > 0).map(e => ({ id: e.id, amount: e.amount, note: e.note?.trim() || undefined }));

  const save = () => {
    if (!canSave) return;
    onSave({
      date,
      openingFloat: openingNum,
      cashIn: cleanEntries(cashIn), cashOut: cleanEntries(cashOut), withdrawals: cleanEntries(withdrawals),
      countedCash: countedNum,
      note: note.trim() || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className={`${card} p-5 space-y-4`}>
        {afterClose > 0 && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm bg-indigo-50 dark:bg-indigo-900/20 text-indigo-800 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-900/40">
            <Banknote className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>{money(afterClose)} in cash sales came in after this day was counted.</strong>{' '}
              Those sales still count toward the day's revenue and profit — but that cash wasn't in the drawer when you
              counted it, so expect the till to run over by this amount. Re-count and save again to fold it in.
            </span>
          </div>
        )}
        {!wasOpened && (
          <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-900/40">
            <DoorOpen className="w-4 h-4 shrink-0 mt-0.5" />
            <span>The drawer wasn't opened for this day, so no starting float was recorded. Enter the float you started with below before reconciling — don't leave it assumed.</span>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className={label}>Date</label>
            <input type="date" max={todayISO()} value={date} onChange={e => setDate(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Opening float{wasOpened ? '' : ' (not opened)'}</label>
            <input type="number" step="0.01" min="0" value={openingFloat} onChange={e => setOpeningFloat(e.target.value)} placeholder="0.00" className={input} />
          </div>
          <div>
            <label className={label}>Counted cash in till</label>
            <input type="number" step="0.01" min="0" value={counted} onChange={e => setCounted(e.target.value)} placeholder="0.00" className={input} />
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          <EntryList title="Cash in (top-ups / tips)" entries={cashIn} onChange={setCashIn} notePlaceholder="Reason, e.g. change top-up" />
          <EntryList title="Cash paid out (expenses)" entries={cashOut} onChange={setCashOut} notePlaceholder="Reason, e.g. courier COD" />
          <EntryList title="Withdrawals to owner (pulls / deposits)" entries={withdrawals} onChange={setWithdrawals} notePlaceholder="Note, e.g. bank deposit" />
        </div>

        {/* Expected-ending breakdown */}
        <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 px-4 py-3 text-sm space-y-1">
          <BreakdownRow label="Opening float" value={openingNum} />
          <BreakdownRow label="+ Cash sales" value={cashSales} />
          {cashInTotal > 0 && <BreakdownRow label="+ Cash in (manual)" value={cashInTotal} />}
          <BreakdownRow label="− Cash paid out" value={-cashOutTotal} />
          <BreakdownRow label="− Withdrawals to owner" value={-withdrawalTotal} />
          <div className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-700 font-bold text-slate-800 dark:text-slate-100">
            <span>Expected ending cash</span><span>{money(expected)}</span>
          </div>
        </div>

        {hasCount && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${
            direction === 'balanced' ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'
            : 'bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300'}`}>
            {direction === 'balanced'
              ? <><CheckCircle2 className="w-4 h-4" /> Balanced — till matches expected cash.</>
              : <><AlertTriangle className="w-4 h-4" /> {direction === 'over' ? 'Over' : 'Short'} by {money(Math.abs(variance))} (counted {money(countedNum)} vs expected {money(expected)}).</>}
          </div>
        )}

        <div>
          <label className={label}>Note {hasCount && direction !== 'balanced' ? '(required — explain the variance)' : '(optional)'}</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="e.g. $5 float miscount; card tip paid out in cash"
            className={`${input} w-full resize-y ${needsNote ? 'ring-2 ring-amber-400 border-amber-400' : ''}`} />
          {needsNote && <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">A note is required to save an over/short count.</p>}
        </div>

        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">
            {saved?.reconciledAt
              ? `Reconciled by ${saved.reconciledByEmail || saved.reconciledBy} · ${new Date(saved.reconciledAt).toLocaleString()}`
              : saved
                ? 'Open — cash movements logged, not yet reconciled.'
                : 'Not yet reconciled for this day.'}
          </p>
          <button onClick={save} disabled={!canSave} title={needsNote ? 'Add a note explaining the variance first' : undefined} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">
            <Save className="w-4 h-4" /> {saved?.reconciledAt ? 'Update' : 'Save'} reconciliation
          </button>
        </div>
      </div>

      <CashHistory cashReconciliations={cashReconciliations} onPick={setDate} />
    </div>
  );
};

// Cash history — lives on the Cash Reconciliation tab (gated by
// cash.reconcile, which an employee legitimately holds). Full audit trail per
// day: opening float, cash in / out / withdrawals, closing count, variance
// and the variance note — no revenue/cost/margin figure, so no extra
// profit gate is needed here. Defaults to the last 30 days with a control to
// widen the window (90 / 365 / all).
const RANGES: { days: number; label: string }[] = [
  { days: 30, label: '30 days' }, { days: 90, label: '90 days' }, { days: 365, label: '1 year' }, { days: 0, label: 'All' },
];
const CashHistory: React.FC<{ cashReconciliations: CashReconciliation[]; onPick: (date: string) => void }> = ({ cashReconciliations, onPick }) => {
  const [days, setDays] = useState(30);
  const cutoff = useMemo(() => {
    if (!days) return '';
    const d = new Date(); d.setDate(d.getDate() - (days - 1));
    return toISODate(d);
  }, [days]);
  const rows = useMemo(
    () => [...cashReconciliations].filter(r => !cutoff || r.date >= cutoff).sort((a, b) => b.date.localeCompare(a.date)),
    [cashReconciliations, cutoff],
  );
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Cash history</h3>
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
          {RANGES.map(r => (
            <button key={r.days} onClick={() => setDays(r.days)}
              className={`px-2.5 py-1 font-medium ${days === r.days ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>{r.label}</button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 py-4 text-center">No cash records in this range.</p>
      ) : (
        <div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
          <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr>
            <th className="text-left py-2">Date</th><th className="text-right py-2">Opening</th><th className="text-right py-2">Cash in</th><th className="text-right py-2">Cash out</th><th className="text-right py-2">Withdrawn</th><th className="text-right py-2">Counted</th><th className="text-right py-2">Variance</th><th className="text-left py-2 pl-4">Note</th><th className="text-left py-2">Status</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map(r => {
              const reconciled = !!r.reconciledAt;
              return (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40" onClick={() => onPick(r.date)}>
                  <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{r.date}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{r.openedAt || r.openingFloat != null ? money(r.openingFloat || 0) : <span className="text-amber-500" title="Drawer not opened">—</span>}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(sumDrawerEntries(r.cashIn))}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(sumDrawerEntries(r.cashOut))}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(sumDrawerEntries(r.withdrawals))}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{reconciled && r.countedCash != null ? money(r.countedCash) : <span className="text-slate-400">—</span>}</td>
                  {reconciled && r.countedCash != null
                    ? <td className={`py-2 text-right font-semibold ${Math.abs(r.variance) < 0.005 ? 'text-emerald-600' : 'text-amber-600 dark:text-amber-400'}`}>{r.variance > 0 ? '+' : ''}{money(r.variance)}</td>
                    : <td className="py-2 text-right text-slate-400">—</td>}
                  <td className="py-2 pl-4 text-slate-500 dark:text-slate-400 truncate max-w-[220px]">{r.note || '—'}</td>
                  <td className="py-2">
                    {reconciled
                      ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Reconciled</span>
                      : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">Open</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      )}
    </div>
  );
};

/* ---------------- Sales tax remittance ---------------- */
const TaxReportTab: React.FC<{ salesTransactions: SalesTransaction[] }> = ({ salesTransactions }) => {
  const [start, setStart] = useState(monthStartISO());
  const [end, setEnd] = useState(todayISO());
  const [grouping, setGrouping] = useState<TaxGrouping>('month');
  const report = useMemo(() => taxRemittance(salesTransactions, start, end, grouping), [salesTransactions, start, end, grouping]);

  const exportCsv = () => {
    const csv = toCSV(taxReportCsvRows(report));
    triggerDownload(`tax-remittance_${report.start}_to_${report.end}.csv`, csv, 'text/csv;charset=utf-8;');
  };

  return (
    <div className="space-y-6">
      <div className={`${card} p-5 space-y-4`}>
        <div className="flex flex-wrap items-end gap-4">
          <div><label className={label}>From</label><input type="date" value={start} onChange={e => setStart(e.target.value)} className={input} /></div>
          <div><label className={label}>To</label><input type="date" value={end} onChange={e => setEnd(e.target.value)} className={input} /></div>
          <div>
            <label className={label}>Group by</label>
            <div className="flex gap-1">
              {(['month', 'quarter'] as TaxGrouping[]).map(g => (
                <button key={g} onClick={() => setGrouping(g)} className={`px-3 py-2 rounded-lg text-sm font-medium capitalize ${grouping === g ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>{g}</button>
              ))}
            </div>
          </div>
          <button onClick={exportCsv} disabled={report.rows.length === 0} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Tax collected on recognized sales only — voided, returned and not-yet-settled layaway sales are excluded. Repairs don't collect sales tax separately, so all remittable tax comes from sales.
        </p>
      </div>

      <div className={`${card} p-5`}>
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Tax collected · {report.start} → {report.end}</h3>
          <div className="text-right">
            <p className="text-xs text-slate-400">Total tax collected</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{money(report.totalTaxCollected)}</p>
          </div>
        </div>
        {report.rows.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">No sales with tax in this range.</p>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr>
              <th className="text-left py-2">Period</th><th className="text-right py-2">Taxable sales</th><th className="text-right py-2">Tax collected</th><th className="text-right py-2">Sales</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {report.rows.map(r => (
                <tr key={r.key}>
                  <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{r.label}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(r.taxableSales)}</td>
                  <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{money(r.taxCollected)}</td>
                  <td className="py-2 text-right text-slate-400">{r.salesCount}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-slate-200 dark:border-slate-700 font-bold">
              <td className="py-2 text-slate-800 dark:text-slate-100">Total</td>
              <td className="py-2 text-right text-slate-800 dark:text-slate-100">{money(report.totalTaxableSales)}</td>
              <td className="py-2 text-right text-slate-800 dark:text-slate-100">{money(report.totalTaxCollected)}</td>
              <td className="py-2 text-right text-slate-500 dark:text-slate-400">{report.totalSalesCount}</td>
            </tr></tfoot>
          </table></div>
        )}
      </div>
    </div>
  );
};

/* ---------------- Date-range picker (shared) ---------------- */
const RangeControls: React.FC<{ start: string; end: string; setStart: (v: string) => void; setEnd: (v: string) => void; children?: React.ReactNode }> = ({ start, end, setStart, setEnd, children }) => (
  <div className="flex flex-wrap items-end gap-4">
    <div><label className={label}>From</label><input type="date" value={start} onChange={e => setStart(e.target.value)} className={input} /></div>
    <div><label className={label}>To</label><input type="date" value={end} onChange={e => setEnd(e.target.value)} className={input} /></div>
    {children}
  </div>
);

// `negative` = a cost (shown in parentheses, red). `income` = money coming IN
// on a line that sits among costs (shown plain, green) — used for the store's
// drop-off service fees, which the device buyer owes the STORE and which
// therefore raise net profit rather than reduce it.
const PLRow: React.FC<{ label: string; value: number; negative?: boolean; income?: boolean; bold?: boolean; total?: boolean }> = ({ label, value, negative, income, bold, total }) => (
  <div className={`flex items-center justify-between py-1.5 ${total ? 'border-t-2 border-slate-200 dark:border-slate-700 mt-1 pt-2' : ''}`}>
    <span className={`${bold || total ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}>{label}</span>
    <span className={`tabular-nums ${bold || total ? 'font-bold' : ''} ${negative ? 'text-rose-600 dark:text-rose-400' : income ? 'text-emerald-600 dark:text-emerald-400' : total && value < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-800 dark:text-slate-100'}`}>
      {negative ? `(${money(value)})` : money(value)}
    </span>
  </div>
);

/* ---------------- Profit & Loss ---------------- */
// showExpenseCategories === the viewer holds expenses.viewAll. When false (a
// manager) the per-category expense rows collapse into one "Expenses" line —
// the ARITHMETIC is unchanged: pl.expenses is still the full workspace expense
// total and pl.netProfit still subtracts it. The split governs who may browse
// the ledger, not what the accounting includes.
const ProfitLossTab: React.FC<{ plInput: ProfitLossInput; showExpenseCategories: boolean }> = ({ plInput, showExpenseCategories }) => {
  const [start, setStart] = useState(monthStartISO());
  const [end, setEnd] = useState(todayISO());
  const pl = useMemo(() => profitAndLoss(plInput, start, end), [plInput, start, end]);
  const exportCsv = () => triggerDownload(`profit-loss_${pl.start}_to_${pl.end}.csv`, toCSV(profitLossCsvRows(pl, showExpenseCategories)), 'text/csv;charset=utf-8;');

  return (
    <div className="space-y-6">
      <div className={`${card} p-5`}>
        <RangeControls start={start} end={end} setStart={setStart} setEnd={setEnd}>
          <button onClick={exportCsv} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </RangeControls>
      </div>
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">Profit &amp; Loss · {pl.start} → {pl.end}</h3>
        <div className="text-sm">
          <PLRow label="Revenue" value={pl.revenue} />
          <PLRow label="Cost of goods sold" value={pl.costOfGoods} negative />
          <PLRow label="Gross profit" value={pl.grossProfit} bold />
          <PLRow label="Payroll" value={pl.payroll} negative />
          {showExpenseCategories
            ? pl.expensesByCategory.map(c => (
                <PLRow key={c.category} label={`Expense: ${c.label}${c.excludedFromPL ? ' (informational)' : ''}`} value={c.total} negative={!c.excludedFromPL} />
              ))
            : <PLRow label="Expenses" value={pl.expenses} negative />}
          <PLRow label="Device buyer service fees (income)" value={pl.deviceBuyerFeeIncome} income />
          <PLRow label="Net profit" value={pl.netProfit} total />
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Recognized sales only (voided, returned and not-yet-settled layaway sales excluded). The store finances the device buyer: only the service fee it charges is income. The principal the buyer repays is a receivable being settled — never revenue, never profit — and financed devices are the buyer's, so they are not store inventory or cost of goods.
        </p>
      </div>
    </div>
  );
};

/* ---------------- Device buyer settlement history ---------------- */
const SettlementsTab: React.FC<{ settlements: Settlement[]; deviceBuyers: DeviceBuyer[] }> = ({ settlements, deviceBuyers }) => {
  const [start, setStart] = useState(monthStartISO());
  const [end, setEnd] = useState(todayISO());
  const h = useMemo(() => settlementHistory(settlements, deviceBuyers, start, end), [settlements, deviceBuyers, start, end]);
  const exportCsv = () => {
    const rows = h.lines.map(l => ({
      Date: l.date, DeviceBuyer: l.buyerName,
      'Service fee (income)': l.totalFees.toFixed(2),
      'Principal repaid': l.totalPrincipal.toFixed(2),
      'Settlement total': l.totalAmount.toFixed(2),
      Model: l.legacy ? 'Prior model (as recorded)' : 'Buyer owes store',
    }));
    rows.push({
      Date: 'Total', DeviceBuyer: '',
      'Service fee (income)': h.totalFees.toFixed(2),
      'Principal repaid': h.totalPrincipal.toFixed(2),
      'Settlement total': h.totalAmount.toFixed(2),
      Model: '',
    });
    triggerDownload(`device buyer-settlements_${h.start}_to_${h.end}.csv`, toCSV(rows), 'text/csv;charset=utf-8;');
  };

  return (
    <div className="space-y-6">
      <div className={`${card} p-5`}>
        <RangeControls start={start} end={end} setStart={setStart} setEnd={setEnd}>
          <button onClick={exportCsv} disabled={h.count === 0} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </RangeControls>
      </div>

      <div className={`${card} p-5`}>
        <div className="flex items-baseline justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Device buyer settlements · {h.start} → {h.end}</h3>
          <div className="text-right"><p className="text-xs text-slate-400">Service fees (income)</p><p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{money(h.totalFees)}</p></div>
        </div>
        {h.perBuyer.length === 0 ? <p className="text-sm text-slate-400 py-6 text-center">No settlements in this range.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr>
              <th className="text-left py-2">Device buyer</th><th className="text-right py-2">Settlements</th><th className="text-right py-2">Service fee</th><th className="text-right py-2">Principal</th><th className="text-right py-2">Total</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {h.perBuyer.map(r => (
                <tr key={r.buyerId}>
                  <td className="py-2 font-medium text-slate-700 dark:text-slate-200">{r.buyerName}</td>
                  <td className="py-2 text-right text-slate-400">{r.settlementCount}{r.legacyCount > 0 ? ` (${r.legacyCount} prior model)` : ''}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(r.totalFees)}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(r.totalPrincipal)}</td>
                  <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{money(r.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-slate-200 dark:border-slate-700 font-bold">
              <td className="py-2 text-slate-800 dark:text-slate-100">Total</td><td></td>
              <td className="py-2 text-right text-slate-800 dark:text-slate-100">{money(h.totalFees)}</td>
              <td className="py-2 text-right text-slate-800 dark:text-slate-100">{money(h.totalPrincipal)}</td>
              <td className="py-2 text-right text-slate-800 dark:text-slate-100">{money(h.totalAmount)}</td>
            </tr></tfoot>
          </table></div>
        )}
      </div>

      {h.lines.length > 0 && (
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">Individual settlements</h3>
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr>
              <th className="text-left py-2">Date</th><th className="text-left py-2">Device buyer</th><th className="text-right py-2">Service fee</th><th className="text-right py-2">Principal</th><th className="text-right py-2">Total</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {h.lines.map(l => (
                <tr key={l.id}>
                  <td className="py-2 text-slate-500 dark:text-slate-400">{l.date}</td>
                  <td className="py-2 text-slate-700 dark:text-slate-200">
                    {l.buyerName}
                    {l.legacy && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400" title="Recorded under the prior model (store reimbursed the device buyer) — shown exactly as originally recorded.">prior model</span>}
                  </td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(l.totalFees)}</td>
                  <td className="py-2 text-right text-slate-500 dark:text-slate-400">{money(l.totalPrincipal)}</td>
                  <td className="py-2 text-right font-semibold text-slate-800 dark:text-slate-100">{money(l.totalAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
};

/* ---------------- Year-end accountant export ---------------- */
const YearEndTab: React.FC<{ plInput: ProfitLossInput; showExpenseCategories: boolean }> = ({ plInput, showExpenseCategories }) => {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const summary = useMemo(() => yearEndSummary(plInput, year), [plInput, year]);
  const years = Array.from({ length: 6 }, (_, i) => thisYear - i);
  const exportCsv = () => triggerDownload(`year-end-summary_${year}.csv`, toCSV(yearEndCsvRows(summary, showExpenseCategories)), 'text/csv;charset=utf-8;');

  const rows: { label: string; value: number; strong?: boolean }[] = [
    { label: 'Revenue', value: summary.revenue },
    { label: 'Cost of goods sold', value: summary.costOfGoods },
    { label: 'Gross profit', value: summary.grossProfit, strong: true },
    { label: 'Payroll paid', value: summary.payrollPaid },
    ...(showExpenseCategories
      ? summary.expensesByCategory.map(c => ({ label: `Expense: ${c.label}${c.excludedFromPL ? ' (informational)' : ''}`, value: c.total }))
      : [{ label: 'Expenses', value: summary.expenses }]),
    { label: 'Device buyer service fees (income)', value: summary.deviceBuyerFeeIncome },
    { label: 'Net profit', value: summary.netProfit, strong: true },
    { label: 'Sales tax collected', value: summary.salesTaxCollected },
  ];

  return (
    <div className="space-y-6">
      <div className={`${card} p-5`}>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className={label}>Year</label>
            <select value={year} onChange={e => setYear(parseInt(e.target.value, 10))} className={input}>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button onClick={exportCsv} className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white">
            <Download className="w-4 h-4" /> Export CSV
          </button>
        </div>
        <p className="mt-3 text-xs text-slate-400">One consolidated annual summary to hand to your accountant — revenue, profit, payroll, cash expenses, device buyer service fee income and sales tax collected for {year}.</p>
      </div>
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3">{year} year-end summary</h3>
        <div className="text-sm">
          {rows.map(r => (
            <div key={r.label} className="flex items-center justify-between py-1.5">
              <span className={r.strong ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}>{r.label}</span>
              <span className={`tabular-nums ${r.strong ? 'font-bold' : ''} text-slate-800 dark:text-slate-100`}>{money(r.value)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ---------------- Expenses ---------------- */
const PAYMENT_METHOD_LABEL: Record<ExpensePaymentMethod, string> = {
  cash: 'Cash', card: 'Card', etransfer: 'E-transfer', debit: 'Debit', other: 'Other',
};
const FREQUENCY_LABEL: Record<RecurringFrequency, string> = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

/** How a template's amount reads in a list: a real figure for a fixed one,
 * "amount varies" for a variable one (with its estimate marked as a hint, so
 * it can never be mistaken for the figure that will post). */
const recurringAmountLabel = (r: RecurringExpense): string =>
  isVariableRecurring(r)
    ? (r.estimatedAmount ? `amount varies (~${money(r.estimatedAmount)})` : 'amount varies')
    : money(r.amount);

const emptyExpenseDraft = (categories: ExpenseCategory[]): Omit<Expense, 'id' | 'enteredBy' | 'enteredByEmail' | 'createdAt'> => ({
  date: todayISO(), amount: 0, category: categories.find(c => !c.archived)?.key || 'other', paymentMethod: 'cash', payee: '', note: '',
});

const ExpenseModal: React.FC<{
  categories: ExpenseCategory[];
  initial?: Expense;
  onClose: () => void;
  onSave: (e: Expense, isNew: boolean) => void;
}> = ({ categories, initial, onClose, onSave }) => {
  const [draft, setDraft] = useState(initial || { id: newId(), ...emptyExpenseDraft(categories), enteredBy: '', enteredByEmail: '', createdAt: 0 } as Expense);
  useEscapeKey(onClose);
  const activeCategories = categories.filter(c => !c.archived || c.key === draft.category);
  const save = () => { if (draft.amount > 0 && draft.category) { onSave(draft, !initial); onClose(); } };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-3">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">{initial ? 'Edit expense' : 'Add expense'}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={label}>Date</label><input type="date" value={draft.date} onChange={e => setDraft(d => ({ ...d, date: e.target.value }))} className={`${input} w-full`} /></div>
          <div><label className={label}>Amount ($)</label><input type="number" min={0} step={0.01} value={draft.amount || ''} onChange={e => setDraft(d => ({ ...d, amount: parseFloat(e.target.value) || 0 }))} className={`${input} w-full`} /></div>
          <div>
            <label className={label}>Category</label>
            <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} className={`${input} w-full`}>
              {activeCategories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Payment method</label>
            <select value={draft.paymentMethod} onChange={e => setDraft(d => ({ ...d, paymentMethod: e.target.value as ExpensePaymentMethod }))} className={`${input} w-full`}>
              {Object.entries(PAYMENT_METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div className="col-span-2"><label className={label}>Payee / vendor (optional)</label><input value={draft.payee || ''} onChange={e => setDraft(d => ({ ...d, payee: e.target.value }))} className={`${input} w-full`} /></div>
          <div className="col-span-2"><label className={label}>Note (optional)</label><input value={draft.note || ''} onChange={e => setDraft(d => ({ ...d, note: e.target.value }))} className={`${input} w-full`} /></div>
        </div>
        {draft.paymentMethod === 'cash' && !initial && (
          <p className="text-xs text-amber-600 dark:text-amber-400">This will also log a cash-out entry against {draft.date}'s drawer.</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
          <button onClick={save} disabled={!(draft.amount > 0)} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">Save</button>
        </div>
      </div>
    </div>
  );
};

const RecurringModal: React.FC<{
  categories: ExpenseCategory[];
  onClose: () => void;
  onSave: (r: RecurringExpense, isNew: boolean) => void;
}> = ({ categories, onClose, onSave }) => {
  const [draft, setDraft] = useState<Omit<RecurringExpense, 'id' | 'createdBy' | 'createdByEmail' | 'createdAt'>>({
    category: categories.find(c => !c.archived)?.key || 'other', amount: 0, amountMode: 'fixed', paymentMethod: 'etransfer',
    payee: '', note: '', frequency: 'monthly', startDate: todayISO(), active: true,
  });
  useEscapeKey(onClose);
  const variable = draft.amountMode === 'variable';
  // A fixed template needs its amount up front; a variable one deliberately
  // has none — its estimate is optional and is only ever a prefill hint.
  const valid = variable || draft.amount > 0;
  const save = () => {
    if (!valid) return;
    // Never carry a stale fixed amount onto a variable template: `amount` is
    // forced to 0 so nothing downstream can mistake it for a real figure.
    const next = variable
      ? { ...draft, amount: 0, estimatedAmount: draft.estimatedAmount && draft.estimatedAmount > 0 ? draft.estimatedAmount : undefined }
      : { ...draft, estimatedAmount: undefined };
    onSave({ id: newId(), createdBy: '', createdByEmail: '', createdAt: 0, ...next }, true);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-3">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">New recurring expense</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Amount type</label>
            <select value={draft.amountMode || 'fixed'} onChange={e => setDraft(d => ({ ...d, amountMode: e.target.value as RecurringAmountMode }))} className={`${input} w-full`}>
              <option value="fixed">Fixed — same every period</option>
              <option value="variable">Variable — enter each period</option>
            </select>
          </div>
          {variable ? (
            <div><label className={label}>Typical amount ($, optional)</label><input type="number" min={0} step={0.01} value={draft.estimatedAmount || ''} onChange={e => setDraft(d => ({ ...d, estimatedAmount: parseFloat(e.target.value) || 0 }))} className={`${input} w-full`} /></div>
          ) : (
            <div><label className={label}>Amount ($)</label><input type="number" min={0} step={0.01} value={draft.amount || ''} onChange={e => setDraft(d => ({ ...d, amount: parseFloat(e.target.value) || 0 }))} className={`${input} w-full`} /></div>
          )}
          <div>
            <label className={label}>Frequency</label>
            <select value={draft.frequency} onChange={e => setDraft(d => ({ ...d, frequency: e.target.value as RecurringFrequency }))} className={`${input} w-full`}>
              {Object.entries(FREQUENCY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Category</label>
            <select value={draft.category} onChange={e => setDraft(d => ({ ...d, category: e.target.value }))} className={`${input} w-full`}>
              {categories.filter(c => !c.archived).map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Payment method</label>
            <select value={draft.paymentMethod} onChange={e => setDraft(d => ({ ...d, paymentMethod: e.target.value as ExpensePaymentMethod }))} className={`${input} w-full`}>
              {Object.entries(PAYMENT_METHOD_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
          <div><label className={label}>Start date</label><input type="date" value={draft.startDate} onChange={e => setDraft(d => ({ ...d, startDate: e.target.value }))} className={`${input} w-full`} /></div>
          <div><label className={label}>Payee / vendor (optional)</label><input value={draft.payee || ''} onChange={e => setDraft(d => ({ ...d, payee: e.target.value }))} className={`${input} w-full`} /></div>
        </div>
        <p className="text-xs text-slate-400">
          {variable
            ? `Each ${draft.frequency === 'monthly' ? 'month' : draft.frequency === 'yearly' ? 'year' : 'week'} from ${draft.startDate} this appears in the Expenses tab as "amount needed" — nothing is posted until you enter the real figure. The typical amount is only a prefill hint.`
            : `One expense will be generated per ${draft.frequency === 'monthly' ? 'month' : draft.frequency === 'yearly' ? 'year' : 'week'} starting ${draft.startDate} — you'll approve or skip each period from the Expenses tab.`}
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
          <button onClick={save} disabled={!valid} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">Create</button>
        </div>
      </div>
    </div>
  );
};

/**
 * The "enter the actual amount" step for a VARIABLE recurring bill (utilities,
 * phone, card fees). This modal is the only way such a period becomes a real
 * Expense — nothing auto-posts, so an unentered bill can never land in the P&L
 * at a guessed figure. The last few posted amounts are shown so an unusual
 * bill is obvious at a glance.
 */
const VariableAmountModal: React.FC<{
  recurring: RecurringExpense;
  period: DuePeriod;
  categoryLabel: string;
  recentAmounts: number[];
  onClose: () => void;
  onConfirm: (amount: number) => void;
}> = ({ recurring, period, categoryLabel, recentAmounts, onClose, onConfirm }) => {
  // Prefilled from the template's estimate purely as a convenience — the value
  // still has to be confirmed by a person before anything posts.
  const [amount, setAmount] = useState<number>(recurring.estimatedAmount || 0);
  useEscapeKey(onClose);
  const valid = amount > 0;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-3">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Enter amount</h3>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {categoryLabel}{recurring.payee ? ` · ${recurring.payee}` : ''} — period {period.key} ({period.date})
        </p>
        <div>
          <label className={label}>Actual amount ($)</label>
          <input autoFocus type="number" min={0} step={0.01} value={amount || ''} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className={`${input} w-full`} />
        </div>
        {recentAmounts.length > 0 && (
          <p className="text-xs text-slate-400">Last {recentAmounts.length}: {recentAmounts.map(a => money(a)).join(', ')}</p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">Cancel</button>
          <button onClick={() => { if (valid) { onConfirm(amount); onClose(); } }} disabled={!valid} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">Save expense</button>
        </div>
      </div>
    </div>
  );
};

const ExpensesTab: React.FC<{
  expenses: Expense[];
  categories: ExpenseCategory[];
  recurringExpenses: RecurringExpense[];
  /** expenses.viewAll — the owner. False for a manager, whose view is scoped
   * to "my submitted expenses": no workspace total, no category breakdown,
   * no recurring-template configuration. */
  canViewAll: boolean;
  currentUserId: string;
  onSaveExpense: (e: Expense, isNew: boolean) => void;
  onDeleteExpense: (e: Expense) => void;
  onSaveRecurringExpense: (r: RecurringExpense, isNew: boolean) => void;
  onDeleteRecurringExpense: (id: string) => void;
  onGenerateRecurringExpense: (r: RecurringExpense, period: DuePeriod, enteredAmount?: number) => void;
  onSkipRecurringPeriod: (r: RecurringExpense, periodKey: string) => void;
}> = ({ expenses, categories, recurringExpenses, canViewAll, currentUserId, onSaveExpense, onDeleteExpense, onSaveRecurringExpense, onDeleteRecurringExpense, onGenerateRecurringExpense, onSkipRecurringPeriod }) => {
  const [start, setStart] = useState(monthStartISO());
  const [end, setEnd] = useState(todayISO());
  const [editing, setEditing] = useState<Expense | null | 'new'>(null);
  const [addingRecurring, setAddingRecurring] = useState(false);
  const [enteringVariable, setEnteringVariable] = useState<{ r: RecurringExpense; p: DuePeriod } | null>(null);

  const viewer = { id: currentUserId, canViewAll };
  // The browse scope: everything for an owner, own entries only for a manager
  // (keyed on the server-stamped enteredBy). NOTE this filter is confined to
  // this list — the P&L input upstream keeps the full array.
  const visible = useMemo(() => visibleExpensesFor(expenses, viewer), [expenses, currentUserId, canViewAll]);
  const inRange = useMemo(() => visible.filter(e => e.date >= start && e.date <= end).sort((a, b) => b.date.localeCompare(a.date)), [visible, start, end]);
  const total = inRange.reduce((s, e) => s + e.amount, 0);
  const categoryLabel = (key: string) => categories.find(c => c.key === key)?.label || key;

  const exportCsv = () => {
    const rows = inRange.map(e => ({ Date: e.date, Category: categoryLabel(e.category), Amount: e.amount.toFixed(2), 'Payment method': PAYMENT_METHOD_LABEL[e.paymentMethod], Payee: e.payee || '', Note: e.note || '' }));
    triggerDownload(`expenses_${start}_to_${end}.csv`, toCSV(rows), 'text/csv;charset=utf-8;');
  };

  const now = Date.now();
  // Recurring templates are owner-only configuration, so a manager never sees
  // the due list or the template list at all.
  const dueByRecurring = useMemo(
    () => canViewAll
      ? recurringExpenses.filter(r => r.active).map(r => ({ r, due: duePeriodsFor(r, now) })).filter(x => x.due.length > 0)
      : [],
    [recurringExpenses, now, canViewAll],
  );

  return (
    <div className="space-y-6">
      <div className={`${card} p-5`}>
        <RangeControls start={start} end={end} setStart={setStart} setEnd={setEnd}>
          <button onClick={() => setEditing('new')} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white"><Plus className="w-4 h-4" /> Add expense</button>
          <button onClick={exportCsv} disabled={inRange.length === 0} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white"><Download className="w-4 h-4" /> Export CSV</button>
        </RangeControls>
      </div>

      {dueByRecurring.length > 0 && (
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 mb-3 flex items-center gap-2"><Repeat className="w-4 h-4 text-indigo-500" /> Recurring expenses due</h3>
          <div className="space-y-2">
            {dueByRecurring.map(({ r, due }) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 border-b border-slate-100 dark:border-slate-800 last:border-0">
                <span className="text-sm text-slate-700 dark:text-slate-200">
                  {categoryLabel(r.category)}{r.payee ? ` · ${r.payee}` : ''} — {recurringAmountLabel(r)}/{FREQUENCY_LABEL[r.frequency].toLowerCase()}
                </span>
                <div className="flex items-center gap-2 flex-wrap">
                  {due.map(p => (
                    <span key={p.key} className={`inline-flex items-center gap-1 text-xs rounded-full pl-2 pr-1 py-0.5 ${isVariableRecurring(r) ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200' : 'bg-slate-100 dark:bg-slate-800'}`}>
                      {p.key}
                      {isVariableRecurring(r) ? (
                        // Variable: reads as "amount needed", never a one-click
                        // generate. Nothing posts until a figure is typed.
                        <button onClick={() => setEnteringVariable({ r, p })} className="ml-1 px-1.5 py-0.5 rounded-full font-medium text-amber-800 dark:text-amber-100 hover:underline">Amount needed</button>
                      ) : (
                        <button onClick={() => onGenerateRecurringExpense(r, p)} title="Generate this period" className="p-1 text-emerald-600 hover:text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                      )}
                      {/* Skipping is one shared path for both modes. */}
                      <button onClick={() => onSkipRecurringPeriod(r, p.key)} title="Skip this period" className="p-1 text-slate-400 hover:text-rose-500"><SkipForward className="w-3.5 h-3.5" /></button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{canViewAll ? 'Expenses' : 'My submitted expenses'} · {start} → {end}</h3>
          {/* The workspace expense total is part of expenses.viewAll — a
              manager sees their own rows but no aggregate spend figure. */}
          {canViewAll && <span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">{money(total)}</span>}
        </div>
        {inRange.length === 0 ? (
          <p className="text-sm text-slate-400 py-6 text-center">{canViewAll ? 'No expenses in this range.' : 'You have not submitted any expenses in this range.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Category</th>
                <th className="py-2 pr-3 font-medium">Payee</th><th className="py-2 pr-3 font-medium">Method</th>
                <th className="py-2 px-2 font-medium text-right">Amount</th><th className="py-2 pl-2 font-medium text-right">Actions</th>
              </tr></thead>
              <tbody>
                {inRange.map(e => (
                  <tr key={e.id} className="border-b border-slate-100 dark:border-slate-800/60">
                    <td className="py-2 pr-3 text-slate-600 dark:text-slate-300 tabular-nums">{e.date}</td>
                    <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{categoryLabel(e.category)}{e.recurringId && <Repeat className="w-3 h-3 inline ml-1 text-indigo-400" aria-label="recurring" />}</td>
                    <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">{e.payee || '—'}</td>
                    <td className="py-2 pr-3 text-slate-500 dark:text-slate-400">{PAYMENT_METHOD_LABEL[e.paymentMethod]}</td>
                    <td className="py-2 px-2 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">{money(e.amount)}</td>
                    <td className="py-2 pl-2 text-right">
                      {/* Redundant with the list filter above (a manager only
                          ever sees their own rows) but stated explicitly so the
                          UI can never offer an action the rules would reject. */}
                      {canMutateExpense(e, viewer) && (<>
                        <button onClick={() => setEditing(e)} className="p-1 text-slate-400 hover:text-indigo-600"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => onDeleteExpense(e)} className="p-1 text-slate-400 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      </>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canViewAll && <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2"><Repeat className="w-4 h-4 text-indigo-500" /> Recurring templates</h3>
          <button onClick={() => setAddingRecurring(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-indigo-600"><Plus className="w-3.5 h-3.5" /> New</button>
        </div>
        {recurringExpenses.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">No recurring expenses set up — rent, subscriptions, etc. can auto-generate here each period.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {recurringExpenses.map(r => (
              <div key={r.id} className="flex items-center justify-between py-2 gap-2">
                <span className={`text-sm ${r.active ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 line-through'}`}>
                  {categoryLabel(r.category)}{r.payee ? ` · ${r.payee}` : ''} — {recurringAmountLabel(r)}/{FREQUENCY_LABEL[r.frequency].toLowerCase()}
                </span>
                <div className="flex items-center gap-2">
                  <button onClick={() => onSaveRecurringExpense({ ...r, active: !r.active }, false)} className="text-xs text-slate-500 hover:text-indigo-600">{r.active ? 'Pause' : 'Resume'}</button>
                  <button onClick={() => onDeleteRecurringExpense(r.id)} className="p-1 text-slate-400 hover:text-rose-500"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>}

      {editing && (
        <ExpenseModal
          categories={categories}
          initial={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSave={onSaveExpense}
        />
      )}
      {addingRecurring && (
        <RecurringModal categories={categories} onClose={() => setAddingRecurring(false)} onSave={onSaveRecurringExpense} />
      )}
      {enteringVariable && (
        <VariableAmountModal
          recurring={enteringVariable.r} period={enteringVariable.p}
          categoryLabel={categoryLabel(enteringVariable.r.category)}
          recentAmounts={lastAmountsForRecurring(expenses, enteringVariable.r.id)}
          onClose={() => setEnteringVariable(null)}
          onConfirm={amount => onGenerateRecurringExpense(enteringVariable.r, enteringVariable.p, amount)}
        />
      )}
    </div>
  );
};
