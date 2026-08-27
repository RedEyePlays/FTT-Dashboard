import React, { useState } from 'react';
import { Lock, AlertTriangle, Eye, EyeOff, LogOut, WifiOff } from 'lucide-react';
import { AppUser } from '../types';
import { PIN_MAX_LENGTH } from '../domain/pin';
import { useConnectionStatus } from '../hooks/useConnectionStatus';

interface Props {
  me: AppUser;
  // Each resolves to whether the attempt was correct — the component owns no
  // Firebase/crypto calls itself (App.tsx does the actual verification and
  // flips the app out of the locked state on success), matching the same
  // presentational split as AuthScreen.
  onUnlockWithPin: (pin: string) => Promise<boolean>;
  onUnlockWithPassword: (password: string) => Promise<boolean>;
  onSignOut: () => void;
}

const MAX_ATTEMPTS_BEFORE_COOLDOWN = 5;
const COOLDOWN_MS = 30_000;

// A full-screen, unavoidable lock overlay shown after inactivity — NOT a sign
// out. The rest of the app is not rendered at all while this is up (see
// App.tsx), so there's nothing to bypass via DevTools/back/refresh: a reload
// re-derives the locked state from sessionStorage before anything else paints,
// and the browser back button only changes in-app view state, which this
// screen fully replaces regardless of what it is.
export const LockScreen: React.FC<Props> = ({ me, onUnlockWithPin, onUnlockWithPassword, onSignOut }) => {
  const hasPin = !!me.pinHash;
  // PIN unlock is pure local verification (domain/pin.ts) — works fully
  // offline. Password unlock reauthenticates against Firebase Auth, which
  // needs a network round trip; offline, that would otherwise just come back
  // as a confusing "Incorrect password" a few seconds later. Only relevant
  // for staff with no PIN set — everyone else's unlock path is unaffected.
  const isOffline = useConnectionStatus() === 'offline';
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);

  const cooldownActive = !!cooldownUntil && Date.now() < cooldownUntil;

  const submitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || cooldownActive || !pin) return;
    setBusy(true);
    setError(null);
    const ok = await onUnlockWithPin(pin);
    setBusy(false);
    if (!ok) {
      setPin('');
      const next = attempts + 1;
      setAttempts(next);
      if (next >= MAX_ATTEMPTS_BEFORE_COOLDOWN) {
        setCooldownUntil(Date.now() + COOLDOWN_MS);
        setError(`Too many incorrect attempts. Try again in ${Math.round(COOLDOWN_MS / 1000)} seconds.`);
      } else {
        setError('Incorrect PIN.');
      }
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !password || isOffline) return;
    setBusy(true);
    setError(null);
    const ok = await onUnlockWithPassword(password);
    setBusy(false);
    if (!ok) {
      setPassword('');
      setError('Incorrect password.');
    }
  };

  return (
    <div className="fixed inset-0 z-[200] min-h-screen bg-slate-100 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-xl p-8 border border-slate-200 dark:border-slate-800">
        <div className="flex justify-center mb-5">
          <div className="p-4 rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400">
            <Lock className="w-10 h-10" />
          </div>
        </div>
        <h1 className="text-xl font-bold text-center text-slate-900 dark:text-white mb-1">App Locked</h1>
        <p className="text-center text-sm text-slate-500 dark:text-slate-400 mb-6">
          {me.email} · locked after inactivity
        </p>

        {hasPin ? (
          <form onSubmit={submitPin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Enter your PIN</label>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                autoFocus
                maxLength={PIN_MAX_LENGTH}
                value={pin}
                disabled={cooldownActive}
                onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none text-center text-2xl tracking-[0.5em] dark:text-white disabled:opacity-50"
                placeholder="••••"
              />
            </div>
            {error && (
              <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 p-3 rounded-lg text-sm flex items-start gap-2 justify-center text-center">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{error}</span>
              </div>
            )}
            <button type="submit" disabled={busy || cooldownActive || !pin}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed">
              Unlock
            </button>
          </form>
        ) : (
          <form onSubmit={submitPassword} className="space-y-4">
            <p className="text-xs text-center text-slate-400 -mt-2 mb-2">No PIN set on your account — sign in with your password to unlock.</p>
            {isOffline && (
              <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 p-3 rounded-lg text-sm flex items-start gap-2 justify-center text-center">
                <WifiOff className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>You're offline — password unlock needs a connection. Ask an owner/manager to set you a PIN for offline unlock, or wait to reconnect.</span>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoFocus
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white pr-12"
                  placeholder="••••••••"
                />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1">
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            {error && (
              <div className="bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 p-3 rounded-lg text-sm flex items-start gap-2 justify-center text-center">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" /> <span>{error}</span>
              </div>
            )}
            <button type="submit" disabled={busy || !password || isOffline}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed">
              Unlock
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <button onClick={onSignOut} className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
            <LogOut className="w-3.5 h-3.5" /> Not you? Sign out
          </button>
        </div>
      </div>
    </div>
  );
};
