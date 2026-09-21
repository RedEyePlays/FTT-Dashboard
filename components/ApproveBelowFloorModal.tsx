import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, X } from 'lucide-react';
import { AppUser } from '../types';
import { PIN_MAX_LENGTH } from '../domain/pin';
import { BELOW_FLOOR_MESSAGE } from '../domain/priceFloor';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface Props {
  /** What is being approved. The PRICE is shown — it is what the customer pays. */
  line: { name: string; price: number };
  /** Managers and owners who could approve. Everyone else is not offered. */
  approvers: AppUser[];
  /**
   * Verify the chosen approver's PIN. Resolves true on a match. The component
   * owns no crypto itself — same presentational split as LockScreen.
   */
  onVerify: (approverUid: string, pin: string) => Promise<boolean>;
  onApproved: (approver: AppUser) => void;
  onCancel: () => void;
}

const money = (n: number) => `$${n.toFixed(2)}`;

/**
 * A manager or owner signs off a sale below the device's minimum price.
 *
 * THE APPROVER ENTERS THEIR OWN PIN, never the seller's — that is the whole
 * point of an approval, and a seller who could type it would simply be
 * approving their own discount.
 *
 * NOTHING HERE NAMES THE FLOOR OR THE COST. The seller is standing at this
 * screen too, and either figure would let them work the other out. The sale
 * price is shown because the customer is being charged it.
 */
export const ApproveBelowFloorModal: React.FC<Props> = ({ line, approvers, onVerify, onApproved, onCancel }) => {
  const [approver, setApprover] = useState<AppUser | null>(approvers.length === 1 ? approvers[0] : null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscapeKey(onCancel);

  const nameOf = (u: AppUser) => (u.email || '').split('@')[0];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !approver || !pin) return;
    setBusy(true);
    setError(null);
    const ok = await onVerify(approver.id, pin);
    setBusy(false);
    setPin('');
    if (ok) onApproved(approver);
    // One message whatever went wrong — it must not say whether that person
    // has a PIN set, which would be free reconnaissance about a colleague.
    else setError("That PIN didn't match.");
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onCancel}>
      <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-indigo-500" /> Approve this price
          </h2>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-4 h-4" /></button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-3">
          <p className="text-sm text-slate-700 dark:text-slate-200">
            {line.name} — <span className="font-semibold">{money(line.price)}</span>
          </p>
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {BELOW_FLOOR_MESSAGE}
          </p>

          {approvers.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Nobody who can approve this is set up with a PIN. Ask the owner.
            </p>
          ) : (
            <>
              {approvers.length > 1 && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Approved by</label>
                  <select
                    value={approver?.id || ''}
                    onChange={e => { setApprover(approvers.find(u => u.id === e.target.value) || null); setError(null); }}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm capitalize">
                    <option value="">Choose…</option>
                    {approvers.map(u => <option key={u.id} value={u.id}>{nameOf(u)}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">
                  {approver ? `${nameOf(approver)}'s PIN` : 'PIN'}
                </label>
                <input
                  type="password" inputMode="numeric" autoFocus autoComplete="off"
                  maxLength={PIN_MAX_LENGTH} value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••"
                  className="w-full text-center tracking-[0.4em] text-lg px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg" />
              </div>

              {error && <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{error}</p>}

              <button type="submit" disabled={busy || !approver || !pin}
                className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-sm font-semibold">
                {busy ? 'Checking…' : 'Approve'}
              </button>
            </>
          )}
          <button type="button" onClick={onCancel} className="w-full text-xs text-slate-500 dark:text-slate-400 py-1">Cancel</button>
        </form>
      </div>
    </div>
  );
};
