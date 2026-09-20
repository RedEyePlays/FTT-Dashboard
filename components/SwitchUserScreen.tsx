import React, { useState } from 'react';
import { Users, ArrowLeft, WifiOff, AlertTriangle, ShoppingCart } from 'lucide-react';
import { AppUser } from '../types';
import { PIN_MAX_LENGTH } from '../domain/pin';
import { switchCandidates } from '../domain/registerMode';
import { useConnectionStatus } from '../hooks/useConnectionStatus';

interface Props {
  me: AppUser;
  users: AppUser[];
  /**
   * Resolves to an error message, or null on success. The component owns no
   * Firebase or crypto calls itself — App does the switch and re-derives
   * everything — matching the same presentational split as LockScreen.
   */
  onSwitch: (targetUid: string, pin: string) => Promise<string | null>;
  onCancel: () => void;
  /**
   * Set when the person who was signed in left work in progress. A switch is
   * refused until it is resolved, because a cart that survived a handover
   * would be rung up under the wrong name.
   */
  blockingWork?: string | null;
}

/**
 * THE HANDOVER SCREEN on a shared register: tap a name, type four digits,
 * done. Roughly two seconds, which is the point — signing out and typing an
 * email and password at every handover is too slow to survive a Saturday, so
 * staff don't do it, and every sale for the rest of the day lands on whoever
 * signed in that morning.
 */
export const SwitchUserScreen: React.FC<Props> = ({ me, users, onSwitch, onCancel, blockingWork }) => {
  const isOffline = useConnectionStatus() === 'offline';
  const [target, setTarget] = useState<AppUser | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const candidates = switchCandidates(users, me.id);
  const nameOf = (u: AppUser) => (u.email || '').split('@')[0];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !target || !pin) return;
    setBusy(true);
    setError(null);
    const message = await onSwitch(target.id, pin);
    setBusy(false);
    setPin('');
    // On success App unmounts this screen; there is nothing to reset here.
    if (message) setError(message);
  };

  /* --- Work in progress blocks the handover outright ------------------- */
  if (blockingWork) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-900 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <ShoppingCart className="w-10 h-10 mx-auto mb-4 text-amber-400" />
          <h2 className="text-xl font-bold mb-2">Finish or clear the sale first</h2>
          {/* A cart must never cross a handover: whoever finishes it would be
              recorded as the person who rang it. */}
          <p className="text-white/70 mb-6">{blockingWork}</p>
          <button onClick={onCancel} className="w-full px-6 py-4 rounded-xl bg-white/10 hover:bg-white/20 text-lg font-medium">
            Back to the sale
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-slate-900 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        {!target ? (
          <>
            <div className="text-center mb-6">
              <Users className="w-10 h-10 mx-auto mb-3 text-indigo-400" />
              <h2 className="text-xl font-bold">Who's taking over?</h2>
              <p className="text-white/50 text-sm mt-1">Signed in now: {nameOf(me)}</p>
            </div>
            {candidates.length === 0 ? (
              <p className="text-center text-white/60">Nobody else is set up on this workspace.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 max-h-[50vh] overflow-y-auto">
                {candidates.map(u => (
                  <button key={u.id} onClick={() => { setTarget(u); setError(null); }}
                    className="px-4 py-5 rounded-xl bg-white/10 hover:bg-white/20 text-lg font-semibold capitalize">
                    {nameOf(u)}
                  </button>
                ))}
              </div>
            )}
            <button onClick={onCancel} className="w-full mt-6 text-white/50 text-sm py-2">Cancel</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <button type="button" onClick={() => { setTarget(null); setPin(''); setError(null); }}
              className="flex items-center gap-1.5 text-white/50 text-sm mb-4">
              <ArrowLeft className="w-4 h-4" /> Someone else
            </button>
            <h2 className="text-xl font-bold mb-1 capitalize">{nameOf(target)}</h2>
            <p className="text-white/50 text-sm mb-5">Enter your PIN to take over the register.</p>

            {/* OFFLINE IS THE FAILURE CASE THAT MATTERS. The PIN is checked by
                a Cloud Function, so there is nothing to try. Said plainly and
                up front rather than as a confusing rejection a few seconds
                later, and the current session is left exactly as it was. */}
            {isOffline && (
              <p className="flex items-center gap-2 text-amber-300 text-sm mb-4">
                <WifiOff className="w-4 h-4 shrink-0" />
                Can't switch users while offline — sign in with a password.
              </p>
            )}

            <input
              type="password" inputMode="numeric" autoFocus autoComplete="off"
              maxLength={PIN_MAX_LENGTH} value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
              placeholder="••••"
              className="w-full text-center tracking-[0.5em] text-2xl px-4 py-4 rounded-xl bg-white/10 border border-white/20 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />

            {error && (
              <p className="flex items-start gap-2 text-rose-300 text-sm mt-3">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" /> {error}
              </p>
            )}

            <button type="submit" disabled={busy || !pin || isOffline}
              className="w-full mt-4 px-6 py-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-lg font-semibold">
              {busy ? 'Switching…' : 'Take over'}
            </button>
            <button type="button" onClick={onCancel} className="w-full mt-2 text-white/50 text-sm py-2">Cancel</button>
          </form>
        )}
      </div>
    </div>
  );
};
