import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock, LogIn, LogOut, Coffee, Play, Check, DollarSign, CalendarDays, Undo2, X,
} from 'lucide-react';
import { AppUser, TimeEntry, PayPeriodPaid, BreakReason } from '../types';
import {
  BREAK_REASONS, breakReasonLabel, openEntryFor, isOnBreak, workedHours,
  hoursInRange, dayRange, weekRange, recentPayPeriods, periodPayFor, paidKey,
  toISODate, periodEndInclusive, PayPeriod,
} from '../domain/timeclock';

interface Props {
  me: AppUser;
  users: AppUser[];              // full roster (owner/manager) or just [me]
  entries: TimeEntry[];
  payPeriods: PayPeriodPaid[];
  canManagePayroll: boolean;     // owner + manager — see the pay-period summary
  canMarkPaid: boolean;          // owner only — sign a period off as paid
  onClockIn: () => void;
  onClockOut: () => void;
  onStartBreak: (reason: BreakReason, note?: string) => void;
  onEndBreak: () => void;
  onMarkPaid: (userId: string, period: PayPeriod) => void;
  onUnmarkPaid: (userId: string, period: PayPeriod) => void;
}

const fmtHours = (h: number): string => `${h.toFixed(2)} h`;
const fmtMoney = (n: number): string => `$${n.toFixed(2)}`;
const nameOf = (u: AppUser): string => u.email.split('@')[0];

// Live-updating elapsed clock, so the current shift/break time ticks up.
const useNow = (ms = 1000): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
};

const fmtElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
};

export const TimeClockView: React.FC<Props> = ({
  me, users, entries, payPeriods, canManagePayroll, canMarkPaid,
  onClockIn, onClockOut, onStartBreak, onEndBreak, onMarkPaid, onUnmarkPaid,
}) => {
  const now = useNow();
  const [showBreakPicker, setShowBreakPicker] = useState(false);

  const myOpen = openEntryFor(entries, me.id);
  const onBreak = myOpen ? isOnBreak(myOpen) : false;
  const openBreak = myOpen?.breaks?.find(b => b.end == null);

  const day = dayRange(now);
  const week = weekRange(now);
  const todayHours = hoursInRange(entries, me.id, day.start, day.end, now);
  const weekHours = hoursInRange(entries, me.id, week.start, week.end, now);

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Clock className="w-6 h-6 text-indigo-500" /> Time Clock
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Clock in and out of your shifts. Breaks don’t count toward paid hours.
        </p>
      </div>

      {/* --- Clock card --------------------------------------------------- */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-6">
        <div className="flex flex-col items-center text-center gap-4">
          <StatusBadge clockedIn={!!myOpen} onBreak={onBreak} reason={openBreak?.reason} />

          {myOpen ? (
            <>
              <div className="text-5xl font-mono font-bold tracking-tight text-slate-800 dark:text-slate-100 tabular-nums">
                {fmtElapsed((myOpen.clockOut ?? now) - myOpen.clockIn)}
              </div>
              <p className="text-xs text-slate-400">
                Clocked in at {new Date(myOpen.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {' · '}worked {fmtHours(workedHours(myOpen, now))} this shift
              </p>

              {onBreak ? (
                <BigButton onClick={onEndBreak} tone="amber" icon={<Play className="w-6 h-6" />}>
                  End Break{openBreak ? ` (${breakReasonLabel(openBreak.reason)})` : ''}
                </BigButton>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-md">
                  <BigButton onClick={() => setShowBreakPicker(true)} tone="amber" icon={<Coffee className="w-6 h-6" />}>
                    Start Break
                  </BigButton>
                  <BigButton onClick={onClockOut} tone="rose" icon={<LogOut className="w-6 h-6" />}>
                    Clock Out
                  </BigButton>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-5xl font-mono font-bold tracking-tight text-slate-300 dark:text-slate-600 tabular-nums">
                {fmtElapsed(0)}
              </div>
              <p className="text-xs text-slate-400">You’re not clocked in.</p>
              <BigButton onClick={onClockIn} tone="emerald" icon={<LogIn className="w-6 h-6" />}>
                Clock In
              </BigButton>
            </>
          )}
        </div>
      </div>

      {/* --- My hours ----------------------------------------------------- */}
      <div className="grid grid-cols-2 gap-4">
        <StatCard label="Today" value={fmtHours(todayHours)} />
        <StatCard label="This week" value={fmtHours(weekHours)} />
      </div>

      {/* --- Payroll summary (owner/manager) ------------------------------ */}
      {canManagePayroll && (
        <PayrollSummary
          users={users}
          entries={entries}
          payPeriods={payPeriods}
          now={now}
          canMarkPaid={canMarkPaid}
          onMarkPaid={onMarkPaid}
          onUnmarkPaid={onUnmarkPaid}
        />
      )}

      {showBreakPicker && (
        <BreakPickerModal
          onClose={() => setShowBreakPicker(false)}
          onPick={(reason, note) => { onStartBreak(reason, note); setShowBreakPicker(false); }}
        />
      )}
    </div>
  );
};

// --- Pieces ------------------------------------------------------------------

const StatusBadge: React.FC<{ clockedIn: boolean; onBreak: boolean; reason?: BreakReason }> = ({ clockedIn, onBreak, reason }) => {
  const cls = onBreak
    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    : clockedIn
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400';
  const label = onBreak ? `On break${reason ? ` · ${breakReasonLabel(reason)}` : ''}` : clockedIn ? 'On the clock' : 'Clocked out';
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${cls}`}>
      <span className={`w-2 h-2 rounded-full ${onBreak ? 'bg-amber-500' : clockedIn ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
      {label}
    </span>
  );
};

const toneCls: Record<string, string> = {
  emerald: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/20',
  rose: 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/20',
  amber: 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20',
  slate: 'bg-slate-700 hover:bg-slate-800 text-white shadow-slate-500/20',
};

const BigButton: React.FC<{ onClick: () => void; tone: keyof typeof toneCls | string; icon?: React.ReactNode; children: React.ReactNode }> = ({ onClick, tone, icon, children }) => (
  <button
    onClick={onClick}
    className={`flex items-center justify-center gap-2.5 w-full min-h-[64px] px-6 rounded-2xl text-lg font-bold shadow-lg transition-colors tap-target ${toneCls[tone] || toneCls.slate}`}
  >
    {icon}{children}
  </button>
);

const StatCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
    <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</p>
    <p className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1 tabular-nums">{value}</p>
  </div>
);

const BreakPickerModal: React.FC<{ onClose: () => void; onPick: (r: BreakReason, note?: string) => void }> = ({ onClose, onPick }) => {
  const [otherNote, setOtherNote] = useState('');
  const [showOther, setShowOther] = useState(false);

  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 safe-b">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Coffee className="w-5 h-5 text-amber-500" /> Break reason
          </h3>
          <button onClick={onClose} aria-label="Cancel" className="tap-target flex items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!showOther ? (
          <div className="grid grid-cols-2 gap-3">
            {BREAK_REASONS.map(r => (
              <button
                key={r.id}
                onClick={() => (r.id === 'other' ? setShowOther(true) : onPick(r.id))}
                className="min-h-[80px] rounded-2xl border-2 border-slate-200 dark:border-slate-700 hover:border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-slate-700 dark:text-slate-200 text-lg font-bold tap-target transition-colors"
              >
                {r.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-slate-500 dark:text-slate-400">Optional note (leave blank if you like)</label>
            <input
              autoFocus
              value={otherNote}
              onChange={e => setOtherNote(e.target.value)}
              placeholder="e.g. Doctor’s appointment"
              className="w-full px-3 py-3 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-base"
            />
            <div className="grid grid-cols-2 gap-3">
              <BigButton tone="slate" onClick={() => setShowOther(false)}>Back</BigButton>
              <BigButton tone="amber" onClick={() => onPick('other', otherNote.trim() || undefined)}>Start Break</BigButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// --- Payroll summary ---------------------------------------------------------

const PayrollSummary: React.FC<{
  users: AppUser[];
  entries: TimeEntry[];
  payPeriods: PayPeriodPaid[];
  now: number;
  canMarkPaid: boolean;
  onMarkPaid: (userId: string, period: PayPeriod) => void;
  onUnmarkPaid: (userId: string, period: PayPeriod) => void;
}> = ({ users, entries, payPeriods, now, canMarkPaid, onMarkPaid, onUnmarkPaid }) => {
  const periods = useMemo(() => recentPayPeriods(now, 6), [now]);
  const [periodIdx, setPeriodIdx] = useState(0);
  const period = periods[periodIdx];

  const paidByKey = useMemo(() => {
    const m = new Map<string, PayPeriodPaid>();
    payPeriods.forEach(p => m.set(p.id, p));
    return m;
  }, [payPeriods]);

  // Active members, owners last, sorted by name. Everyone who can work a shift.
  const staff = useMemo(
    () => users.filter(u => !u.disabled).sort((a, b) => nameOf(a).localeCompare(nameOf(b))),
    [users],
  );

  const rows = staff.map(u => {
    const pay = periodPayFor(entries, u.id, u.hourlyRate, period, now);
    const paid = paidByKey.get(paidKey(u.id, toISODate(period.start)));
    return { user: u, pay, paid };
  });
  const totalHours = rows.reduce((s, r) => s + r.pay.hours, 0);
  const totalGross = rows.reduce((s, r) => s + r.pay.gross, 0);

  const periodLabel = (p: PayPeriod) =>
    `${new Date(p.start).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(periodEndInclusive(p)).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-emerald-500" /> Pay period summary
        </h3>
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-slate-400" />
          <select
            value={periodIdx}
            onChange={e => setPeriodIdx(Number(e.target.value))}
            className="p-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm"
          >
            {periods.map((p, i) => (
              <option key={p.index} value={i}>{periodLabel(p)}{i === 0 ? ' (current)' : ''}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="px-4 pt-3 text-xs text-slate-400">
        Gross pay is hours × rate for review only — this records no payment and moves no money. Pay employees outside this app, then mark the period paid.
      </p>

      <div className="overflow-x-auto p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <th className="py-2 pr-3 font-medium">Employee</th>
              <th className="py-2 px-2 font-medium text-right">Hours</th>
              <th className="py-2 px-2 font-medium text-right">Rate</th>
              <th className="py-2 px-2 font-medium text-right">Gross</th>
              <th className="py-2 pl-2 font-medium text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ user, pay, paid }) => (
              <tr key={user.id} className="border-b border-slate-100 dark:border-slate-800/60">
                <td className="py-2.5 pr-3 text-slate-700 dark:text-slate-200">
                  {nameOf(user)}
                  {!user.hourlyRate && <span className="ml-1 text-[11px] text-amber-500">no rate set</span>}
                </td>
                <td className="py-2.5 px-2 text-right tabular-nums">{pay.hours.toFixed(2)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums text-slate-500">{fmtMoney(pay.rate)}</td>
                <td className="py-2.5 px-2 text-right tabular-nums font-semibold text-slate-800 dark:text-slate-100">{fmtMoney(pay.gross)}</td>
                <td className="py-2.5 pl-2 text-right">
                  {paid ? (
                    <span className="inline-flex items-center gap-2 justify-end">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400" title={`Marked paid ${new Date(paid.markedAt).toLocaleDateString()}`}>
                        <Check className="w-3.5 h-3.5" /> Paid
                      </span>
                      {canMarkPaid && (
                        <button onClick={() => onUnmarkPaid(user.id, period)} title="Undo paid" className="text-slate-400 hover:text-rose-500">
                          <Undo2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </span>
                  ) : canMarkPaid ? (
                    <button
                      onClick={() => onMarkPaid(user.id, period)}
                      className="px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300"
                    >
                      Mark paid
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-slate-400">No staff to show.</td></tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="font-semibold text-slate-700 dark:text-slate-200">
                <td className="py-2.5 pr-3">Total</td>
                <td className="py-2.5 px-2 text-right tabular-nums">{totalHours.toFixed(2)}</td>
                <td className="py-2.5 px-2" />
                <td className="py-2.5 px-2 text-right tabular-nums">{fmtMoney(totalGross)}</td>
                <td className="py-2.5 pl-2" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};
