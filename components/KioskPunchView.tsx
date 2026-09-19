import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Delete, ArrowLeft, Check, Coffee, LogIn, LogOut, WifiOff } from 'lucide-react';
import { KioskStaff, TimeEntry, BreakReason } from '../types';
import {
  punchRoster, punchStateFor, PunchState, confirmLabel, fmtDuration, breakElapsedMs,
  canStepOut, isStaleOpenShift,
  initialPinAttempts, PinAttemptState, pinCooldownActive, registerFailedPin, pinErrorMessage,
} from '../domain/kiosk';
import { BREAK_REASONS, breakReasonLabel, PaidBreakReasons } from '../domain/timeclock';
import { verifyPin, KIOSK_PIN_LENGTH } from '../domain/pin';
import { useConnectionStatus } from '../hooks/useConnectionStatus';

/**
 * The locked kiosk screen: the ONLY thing a 'kiosk' account ever renders.
 *
 * App.tsx returns this by an early return, so no other view is mounted — the
 * dashboard, nav, global search and settings are not hidden, they do not
 * exist in the tree. The only way out is signing out, which requires the full
 * email and password.
 *
 * Everything on it is sized for a cheap iPad on a wall: large tiles, a big
 * keypad, and a layout that works in portrait and landscape.
 */

interface Props {
  staff: KioskStaff[];
  entries: TimeEntry[];
  paidBreakReasons?: PaidBreakReasons;
  shopName?: string;
  /** All four reuse the same domain/timeclock helpers and Firestore writes as the in-app Time Clock. */
  onClockIn: (person: KioskStaff) => Promise<void> | void;
  onClockOut: (person: KioskStaff, open: TimeEntry) => Promise<void> | void;
  onStartBreak: (person: KioskStaff, open: TimeEntry, reason: BreakReason) => Promise<void> | void;
  onEndBreak: (person: KioskStaff, open: TimeEntry) => Promise<void> | void;
  onSignOut: () => void;
}

type Step = 'names' | 'pin' | 'confirm' | 'break_reason' | 'done';

const CONFIRMATION_MS = 3000;

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const KioskPunchView: React.FC<Props> = ({
  staff, entries, paidBreakReasons = [], shopName, onClockIn, onClockOut, onStartBreak, onEndBreak, onSignOut,
}) => {
  const [step, setStep] = useState<Step>('names');
  const [person, setPerson] = useState<KioskStaff | null>(null);
  const [pin, setPin] = useState('');
  const [attempts, setAttempts] = useState<PinAttemptState>(initialPinAttempts);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [doneMessage, setDoneMessage] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const connection = useConnectionStatus();

  // A wall clock that is actually right — staff read the punch time off this.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const roster = useMemo(() => punchRoster(staff), [staff]);
  const state: PunchState | null = useMemo(
    () => (person ? punchStateFor(person.uid, entries, now, paidBreakReasons) : null),
    [person, entries, now, paidBreakReasons],
  );

  // NEVER leave a person's screen up: any completed punch, and any idle
  // moment on the PIN pad, returns to the name list.
  const reset = () => {
    setStep('names'); setPerson(null); setPin(''); setError(''); setDoneMessage('');
  };

  useEffect(() => {
    if (step !== 'done') return;
    const t = setTimeout(reset, CONFIRMATION_MS);
    return () => clearTimeout(t);
  }, [step]);

  // Walking away mid-PIN must not leave the next person staring at someone
  // else's name with a half-typed code.
  useEffect(() => {
    if (step !== 'pin' && step !== 'confirm' && step !== 'break_reason') return;
    const t = setTimeout(reset, 45_000);
    return () => clearTimeout(t);
  }, [step, pin]);

  const pickPerson = (p: KioskStaff) => {
    setPerson(p); setPin(''); setError(''); setStep('pin');
  };

  const submitPin = async (value: string) => {
    if (!person || busy) return;
    if (pinCooldownActive(attempts, Date.now())) {
      setError(pinErrorMessage(attempts, Date.now()));
      return;
    }
    setBusy(true);
    try {
      // Verified LOCALLY against this person's stored hash, so the door still
      // works when the shop wifi drops — the roster comes from the offline
      // cache and the check is pure crypto, no round trip.
      const ok = await verifyPin(value, {
        hash: person.pinHash, salt: person.pinSalt, iterations: person.pinIterations,
      });
      if (!ok) {
        const next = registerFailedPin(attempts, Date.now());
        setAttempts(next);
        setError(pinErrorMessage(next, Date.now()));
        setPin('');
        return;
      }
      setAttempts(initialPinAttempts);
      setError('');
      setPin('');
      setStep('confirm');
    } finally {
      setBusy(false);
    }
  };

  const press = (d: string) => {
    if (busy || pinCooldownActive(attempts, Date.now())) return;
    const next = (pin + d).slice(0, KIOSK_PIN_LENGTH);
    setPin(next);
    setError('');
    if (next.length === KIOSK_PIN_LENGTH) void submitPin(next);
  };

  const finish = async (run: () => Promise<void> | void, message: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await run();
      setDoneMessage(message);
      setStep('done');
    } catch {
      setError('That didn\'t save. Try again, or tell a manager.');
      setStep('names');
    } finally {
      setBusy(false);
    }
  };

  const commitPrimary = () => {
    if (!person || !state) return;
    if (state.action === 'clock_in') {
      return finish(() => onClockIn(person), `Clocked in — ${person.displayName}`);
    }
    if (state.action === 'end_break') {
      if (!state.open) return;
      const open = state.open;
      return finish(() => onEndBreak(person, open), `Welcome back — ${person.displayName}`);
    }
    if (!state.open) return;
    const open = state.open;
    return finish(() => onClockOut(person, open),
      `Clocked out — ${person.displayName} · ${fmtDuration(state.workedMsSoFar)} today`);
  };

  const commitBreak = (reason: BreakReason) => {
    if (!person || !state?.open) return;
    const open = state.open;
    return finish(() => onStartBreak(person, open, reason),
      `Stepped out — ${person.displayName} · ${breakReasonLabel(reason)}`);
  };

  const tile = 'rounded-2xl font-semibold transition active:scale-[0.98]';

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col select-none">
      <header className="flex items-center justify-between px-5 sm:px-8 py-4 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <Clock className="w-6 h-6 text-indigo-400 shrink-0" />
          <div className="min-w-0">
            <p className="text-base sm:text-lg font-bold truncate">{shopName || 'Time Clock'}</p>
            <p className="text-xs text-white/50">Tap your name to clock in or out</p>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          {connection === 'offline' && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
              <WifiOff className="w-4 h-4" /> Offline — punches save and sync later
            </span>
          )}
          <span className="text-2xl sm:text-3xl font-bold tabular-nums">{fmtTime(now)}</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-8 w-full">
        {/* --- Name tiles --- */}
        {step === 'names' && (
          <div className="w-full max-w-5xl">
            {error && <p className="text-center text-rose-300 mb-4">{error}</p>}
            {roster.length === 0 ? (
              <p className="text-center text-white/50 text-lg">
                No staff set up for the kiosk yet. An owner adds a 6-digit punch PIN for each person in Users.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                {roster.map(p => {
                  const st = punchStateFor(p.uid, entries, now, paidBreakReasons);
                  return (
                    <button key={p.uid} onClick={() => pickPerson(p)}
                      className={`${tile} bg-white/10 hover:bg-white/20 border border-white/10 px-4 py-6 sm:py-8 text-lg sm:text-xl flex flex-col items-center gap-2`}>
                      <span className="truncate max-w-full">{p.displayName}</span>
                      {/* At-a-glance state, so nobody has to punch to find out. */}
                      {st.action === 'clock_in' && <span className="text-xs font-medium text-white/40">Not clocked in</span>}
                      {st.action === 'clock_out' && <span className="text-xs font-medium text-emerald-300">On shift · {fmtDuration(st.workedMsSoFar)}</span>}
                      {st.action === 'end_break' && <span className="text-xs font-medium text-amber-300">On break · {fmtDuration(breakElapsedMs(st, now))}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* --- Keypad --- */}
        {step === 'pin' && person && (
          <div className="w-full max-w-xs">
            <p className="text-center text-xl font-semibold mb-1">{person.displayName}</p>
            <p className="text-center text-sm text-white/50 mb-5">Enter your {KIOSK_PIN_LENGTH}-digit punch PIN</p>
            <div className="flex justify-center gap-2 mb-5" aria-label="PIN entry">
              {Array.from({ length: KIOSK_PIN_LENGTH }).map((_, i) => (
                <span key={i} className={`w-4 h-4 rounded-full ${i < pin.length ? 'bg-indigo-400' : 'bg-white/20'}`} />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => (
                <button key={d} onClick={() => press(d)} className={`${tile} bg-white/10 hover:bg-white/20 py-5 text-2xl`}>{d}</button>
              ))}
              <button onClick={reset} className={`${tile} bg-white/5 hover:bg-white/10 py-5 text-sm text-white/60`} aria-label="Cancel">
                <ArrowLeft className="w-5 h-5 mx-auto" />
              </button>
              <button onClick={() => press('0')} className={`${tile} bg-white/10 hover:bg-white/20 py-5 text-2xl`}>0</button>
              <button onClick={() => { setPin(pin.slice(0, -1)); setError(''); }} className={`${tile} bg-white/5 hover:bg-white/10 py-5`} aria-label="Delete">
                <Delete className="w-5 h-5 mx-auto" />
              </button>
            </div>
            {error && <p className="text-center text-rose-300 mt-4 text-sm">{error}</p>}
          </div>
        )}

        {/* --- Confirm --- */}
        {step === 'confirm' && person && state && (
          <div className="w-full max-w-md text-center">
            {/* A shift left open overnight is a CORRECTION, not a punch. */}
            {isStaleOpenShift(state, now) ? (
              <>
                <p className="text-xl font-semibold mb-2">{person.displayName}</p>
                <p className="text-amber-300 mb-6">
                  Your shift from {new Date(state.open!.clockIn).toLocaleDateString()} is still open. A manager needs to fix that on the Time Clock screen — it can't be corrected here.
                </p>
                <button onClick={reset} className={`${tile} bg-white/10 hover:bg-white/20 px-6 py-4 w-full text-lg`}>Done</button>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold mb-2">{confirmLabel(state, person.displayName, fmtTime(now), now)}</p>
                {state.action === 'end_break' && state.onBreakReason && (
                  <p className="text-white/60 mb-6">
                    {breakReasonLabel(state.onBreakReason)} · {fmtDuration(breakElapsedMs(state, now))} away
                  </p>
                )}
                {state.action !== 'end_break' && <div className="mb-6" />}
                <div className="flex flex-col gap-3">
                  <button onClick={commitPrimary} disabled={busy}
                    className={`${tile} bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 px-6 py-5 text-xl flex items-center justify-center gap-2`}>
                    {state.action === 'clock_in' ? <><LogIn className="w-5 h-5" /> Clock in</>
                      : state.action === 'end_break' ? <><Check className="w-5 h-5" /> Back from {state.onBreakReason ? breakReasonLabel(state.onBreakReason).toLowerCase() : 'break'}</>
                      : <><LogOut className="w-5 h-5" /> Clock out</>}
                  </button>
                  {/* Stepping out is a BREAK on the open shift, never a
                      clock-out — a day out and back stays one entry. */}
                  {canStepOut(state) && (
                    <button onClick={() => setStep('break_reason')} disabled={busy}
                      className={`${tile} bg-white/10 hover:bg-white/20 px-6 py-4 text-lg flex items-center justify-center gap-2`}>
                      <Coffee className="w-5 h-5" /> Step out
                    </button>
                  )}
                  <button onClick={reset} className="text-white/50 text-sm py-2">Cancel</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* --- Break reason --- */}
        {step === 'break_reason' && person && (
          <div className="w-full max-w-md text-center">
            <p className="text-xl font-semibold mb-1">{person.displayName}</p>
            <p className="text-sm text-white/50 mb-6">What are you stepping out for?</p>
            <div className="grid grid-cols-2 gap-3">
              {BREAK_REASONS.map(r => (
                <button key={r.id} onClick={() => commitBreak(r.id)} disabled={busy}
                  className={`${tile} bg-white/10 hover:bg-white/20 disabled:opacity-50 px-4 py-6 text-lg`}>
                  {r.label}
                  {paidBreakReasons.includes(r.id) && <span className="block text-xs font-medium text-emerald-300 mt-1">paid</span>}
                </button>
              ))}
            </div>
            <button onClick={() => setStep('confirm')} className="text-white/50 text-sm py-3 mt-2">Back</button>
          </div>
        )}

        {/* --- Confirmation, then straight back to the names --- */}
        {step === 'done' && (
          <div className="text-center">
            <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mx-auto mb-5">
              <Check className="w-10 h-10 text-emerald-300" />
            </div>
            <p className="text-2xl font-bold">{doneMessage}</p>
            <p className="text-white/50 mt-2">{fmtTime(now)}</p>
          </div>
        )}
      </main>

      <footer className="px-5 sm:px-8 py-3 border-t border-white/10 flex items-center justify-between text-xs text-white/40">
        <span>Kiosk mode — this device can only record clock-ins and clock-outs.</span>
        {/* The only way out, and it needs the full email + password. */}
        <button onClick={onSignOut} className="underline hover:text-white/70">Sign out</button>
      </footer>
    </div>
  );
};
