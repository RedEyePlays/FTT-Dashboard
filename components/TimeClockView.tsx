import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock, LogIn, LogOut, Coffee, Play, Check, DollarSign, CalendarDays, Undo2, X, AlertTriangle, Wrench, History,
} from 'lucide-react';
import { AppUser, TimeEntry, PayPeriodPaid, BreakReason } from '../types';
import {
  BREAK_REASONS, breakReasonLabel, openEntryFor, isOnBreak, workedHours, isClockedIn,
  hoursInRange, dayRange, weekRange, recentPayPeriods, periodPayFor, paidKey,
  toISODate, periodEndInclusive, entriesOnDate, PayPeriod,
  isMissedClockOut, missedClockOuts, isValidClockOutCorrection,
} from '../domain/timeclock';
import { useEscapeKey } from '../hooks/useEscapeKey';

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
  // Owner/manager only (same gate as canManagePayroll): fix a shift someone
  // forgot to clock out of, by setting its actual clock-out time.
  onCorrectClockOut: (entryId: string, newClockOut: number) => void;
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
  onClockIn, onClockOut, onStartBreak, onEndBreak, onMarkPaid, onUnmarkPaid, onCorrectClockOut,
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

      {/* --- Daily hours (owner/manager) ---------------------------------- */}
      {canManagePayroll && <DailyHours users={users} entries={entries} now={now} onCorrectClockOut={onCorrectClockOut} />}

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

  useEscapeKey(onClose);

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

// --- Daily hours (owner/manager) --------------------------------------------
// Per-employee hours for a chosen day (or date range), from the existing
// timeEntries — clock-in, clock-out and worked total per shift, plus a per-person
// total. Bucketed by clock-in day (same rule as the payroll math). Owner/manager
// only (rendered behind canManagePayroll).
const fmtTime = (ms: number): string => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// <input type="datetime-local"> uses local wall-clock time with no timezone —
// pad manually rather than slicing an ISO string (which is UTC).
const toLocalInput = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string): number => new Date(v).getTime();

// Inline editor for correcting one shift's clock-out (missed or otherwise
// wrong). Owner/manager only — rendered behind the same gate as Daily Hours.
const ClockOutFixer: React.FC<{ entry: TimeEntry; now: number; onCancel: () => void; onSave: (newClockOut: number) => void }> = ({ entry, now, onCancel, onSave }) => {
  const [value, setValue] = useState(() => toLocalInput(entry.clockOut ?? now));
  const parsed = fromLocalInput(value);
  const valid = isFinite(parsed) && isValidClockOutCorrection(entry, parsed, now);

  useEscapeKey(onCancel);

  return (
    <div className="flex flex-wrap items-center gap-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2">
      <span className="text-xs text-slate-500 dark:text-slate-400">Set actual clock-out for {new Date(entry.clockIn).toLocaleDateString()}:</span>
      <input type="datetime-local" value={value} max={toLocalInput(now)} onChange={e => setValue(e.target.value)}
        className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100 dark:[color-scheme:dark]" />
      <button onClick={() => valid && onSave(parsed)} disabled={!valid} className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-md text-xs font-medium">Save</button>
      <button onClick={onCancel} className="px-3 py-1 text-xs text-slate-500 hover:text-slate-700">Cancel</button>
      {!valid && <span className="text-xs text-rose-500">Must be after clock-in ({fmtTime(entry.clockIn)}) and not in the future.</span>}
    </div>
  );
};

const DailyHours: React.FC<{ users: AppUser[]; entries: TimeEntry[]; now: number; onCorrectClockOut: (entryId: string, newClockOut: number) => void }> = ({ users, entries, now, onCorrectClockOut }) => {
  const today = toISODate(now);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [fixing, setFixing] = useState<string | null>(null); // entry id being corrected
  // Normalize an inverted range so From ≤ To either way it's typed.
  const [lo, hi] = from <= to ? [from, to] : [to, from];

  const nameById = useMemo(() => new Map(users.map(u => [u.id, nameOf(u)])), [users]);

  // Missed clock-outs are surfaced regardless of the selected date range —
  // they need attention whether or not today's range happens to include them.
  const missed = useMemo(() => missedClockOuts(entries, now), [entries, now]);
  const jumpToMissed = (e: TimeEntry) => { const d = toISODate(e.clockIn); setFrom(d); setTo(d); setFixing(e.id); };

  // Shifts whose clock-in day falls in [lo, hi], grouped by employee, each with
  // its own day total; sorted by employee name.
  const groups = useMemo(() => {
    const inRange = entries.filter(e => e.clockIn != null && toISODate(e.clockIn) >= lo && toISODate(e.clockIn) <= hi);
    const byUser = new Map<string, TimeEntry[]>();
    for (const e of inRange) { const list = byUser.get(e.userId) || []; list.push(e); byUser.set(e.userId, list); }
    return [...byUser.entries()]
      .map(([userId, list]) => ({
        userId,
        name: nameById.get(userId) || userId,
        shifts: [...list].sort((a, b) => a.clockIn - b.clockIn),
        totalHours: list.reduce((s, e) => s + workedHours(e, now), 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, lo, hi, nameById, now]);

  const grandTotal = groups.reduce((s, g) => s + g.totalHours, 0);
  const singleDay = lo === hi;

  const dInput = 'px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:[color-scheme:dark]';

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
        <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2"><CalendarDays className="w-4 h-4 text-indigo-500" /> Daily hours</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => { setFrom(today); setTo(today); }} className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border ${singleDay && lo === today ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}>Today</button>
          <label className="text-xs text-slate-400 flex items-center gap-1">From <input type="date" max={today} value={from} onChange={e => setFrom(e.target.value)} className={dInput} /></label>
          <label className="text-xs text-slate-400 flex items-center gap-1">To <input type="date" max={today} value={to} onChange={e => setTo(e.target.value)} className={dInput} /></label>
        </div>
      </div>

      {missed.length > 0 && (
        <div className="px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800 flex flex-wrap items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span className="text-sm text-amber-800 dark:text-amber-300 font-medium">
            {missed.length} missed clock-out{missed.length !== 1 ? 's' : ''} —
          </span>
          {missed.map(e => (
            <button key={e.id} onClick={() => jumpToMissed(e)}
              className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/60">
              {nameById.get(e.userId) || e.userId} · {toISODate(e.clockIn)}
            </button>
          ))}
        </div>
      )}

      {groups.length === 0 ? (
        <p className="text-sm text-slate-400 py-8 text-center">No shifts {singleDay ? 'on this day' : 'in this range'}.</p>
      ) : (
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {groups.map(g => (
            <div key={g.userId} className="px-4 py-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 capitalize">{g.name}</span>
                <span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">{fmtHours(g.totalHours)}</span>
              </div>
              <div className="overflow-x-auto"><table className="w-full text-sm whitespace-nowrap">
                <thead className="text-[10px] uppercase tracking-wider text-slate-400"><tr>
                  {!singleDay && <th className="text-left py-1 pr-4">Date</th>}
                  <th className="text-left py-1 pr-4">Clock in</th><th className="text-left py-1 pr-4">Clock out</th><th className="text-right py-1">Hours</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-50 dark:divide-slate-800/60">
                  {g.shifts.map(e => {
                    const stale = isMissedClockOut(e, now);
                    const hasCorrections = (e.corrections?.length ?? 0) > 0;
                    return (
                      <React.Fragment key={e.id}>
                        <tr>
                          {!singleDay && <td className="py-1 pr-4 text-slate-500 dark:text-slate-400">{toISODate(e.clockIn)}</td>}
                          <td className="py-1 pr-4 text-slate-600 dark:text-slate-300 tabular-nums">{fmtTime(e.clockIn)}</td>
                          <td className="py-1 pr-4 text-slate-600 dark:text-slate-300 tabular-nums">
                            {isClockedIn(e) ? (
                              <span className={`inline-flex items-center gap-1 ${stale ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                {stale && <AlertTriangle className="w-3.5 h-3.5" />}
                                {stale ? 'Missed clock-out' : 'On the clock'}
                              </span>
                            ) : fmtTime(e.clockOut!)}
                            {hasCorrections && (
                              <span title={e.corrections!.map(c => `${c.fromClockOut ? fmtTime(c.fromClockOut) : 'open'} → ${fmtTime(c.toClockOut)} by ${c.correctedByEmail || c.correctedBy} on ${new Date(c.correctedAt).toLocaleString()}${c.note ? ` — ${c.note}` : ''}`).join('\n')}
                                className="inline-flex items-center gap-0.5 ml-1.5 text-[10px] text-slate-400 cursor-help"><History className="w-3 h-3" /> corrected</span>
                            )}
                          </td>
                          <td className="py-1 text-right text-slate-700 dark:text-slate-200 tabular-nums">
                            <span className="inline-flex items-center gap-2 justify-end">
                              {fmtHours(workedHours(e, now))}
                              {(stale || isClockedIn(e)) && (
                                <button onClick={() => setFixing(fixing === e.id ? null : e.id)} title="Fix clock-out" className="p-0.5 text-slate-400 hover:text-indigo-600"><Wrench className="w-3.5 h-3.5" /></button>
                              )}
                            </span>
                          </td>
                        </tr>
                        {fixing === e.id && (
                          <tr>
                            <td colSpan={singleDay ? 3 : 4} className="py-2">
                              <ClockOutFixer entry={e} now={now}
                                onCancel={() => setFixing(null)}
                                onSave={t => { onCorrectClockOut(e.id, t); setFixing(null); }} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table></div>
            </div>
          ))}
          <div className="px-4 py-2.5 flex items-center justify-between bg-slate-50 dark:bg-slate-800/40">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{singleDay ? 'Day total' : 'Range total'}</span>
            <span className="text-sm font-bold text-slate-900 dark:text-white tabular-nums">{fmtHours(grandTotal)}</span>
          </div>
        </div>
      )}
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
