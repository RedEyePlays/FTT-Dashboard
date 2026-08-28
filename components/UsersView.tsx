import React, { useState, useEffect } from 'react';
import { Users, UserPlus, ShieldCheck, Ban, CheckCircle2, Trash2, Mail, Eye, DollarSign, KeyRound, X, Lock, MessageSquarePlus, AlertTriangle, RotateCcw, UserCog } from 'lucide-react';
import { AppUser, WorkspaceInvite, Role, StaffNote } from '../types';
import { ROLE_LABEL } from '../services/rbac';
import { canAssignPin, isValidPinFormat, PIN_MAX_LENGTH } from '../domain/pin';
import { sortStaffNotes, canAddStaffNote } from '../domain/staffNotes';
import { validatePassword, canResetPasswordFor, MIN_PASSWORD_LENGTH } from '../domain/password';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { selectOnFocus } from '../hooks/selectOnFocus';

interface Props {
  me: AppUser;
  users: AppUser[];
  invites: WorkspaceInvite[];
  canManageAll?: boolean; // owner = manage all roles; false (manager) = technicians only
  onSetRole: (uid: string, role: Role) => void;
  onSetDisabled: (uid: string, disabled: boolean) => void;
  onSetAllowProfit: (uid: string, allow: boolean) => void;
  onSetHourlyRate?: (uid: string, rate: number) => void; // owner only
  onInvite: (email: string, role: Role) => void;
  onDeleteInvite: (email: string) => void;
  // Create a fully-usable account directly — email, password and an optional
  // PIN, set right now (createStaffUser Cloud Function), instead of a
  // "pending invite" the new hire has to self-claim by signing in with a
  // password only they know. Owner may create manager/employee/technician;
  // a manager (canManageAll false) may create technician only — same role
  // ceiling as onInvite's inviteRoles. Resolves to null on success, or an
  // error message to show in the dialog.
  onCreateUser?: (input: { email: string; password: string; role: Role; pin?: string }) => Promise<string | null>;
  // Auto-lock PIN — a manager/owner may set a PIN for anyone strictly below
  // their role (never a peer or above; see domain/pin.ts canAssignPin).
  onSetPin?: (uid: string, pin: string) => Promise<boolean>;
  // Auto-lock timer — owner + manager (security.manage).
  canManageSecurity?: boolean;
  autoLockMinutes?: number;
  onSetAutoLockMinutes?: (minutes: number) => void;
  // Owner-only staff password reset (setStaffPassword Cloud Function). Absent
  // for a manager viewing the Technicians screen — the callable would refuse a
  // non-owner caller anyway, this just doesn't render the button.
  // Resolves to null on success, or an error message to show in the dialog.
  onResetPassword?: (uid: string, newPassword: string) => Promise<string | null>;
  // Owner-only internal staff shoutout/notes log (services/rbac.ts's staffNotes.manage).
  staffNotes?: StaffNote[];
  canManageStaffNotes?: boolean;
  onAddStaffNote?: (text: string) => void;
  onDeleteStaffNote?: (id: string) => void;
}

const AUTO_LOCK_OPTIONS = [1, 2, 4, 5, 10, 15, 30];

const ROLES: Role[] = ['owner', 'manager', 'employee', 'technician'];

// Owner-only hourly-rate editor. Commits on blur / Enter so typing doesn't fire
// a write per keystroke. Seeded from the stored value and re-seeds when it changes.
const RateInput: React.FC<{ rate?: number; onCommit: (rate: number) => void }> = ({ rate, onCommit }) => {
  const [val, setVal] = useState(rate != null ? String(rate) : '');
  useEffect(() => { setVal(rate != null ? String(rate) : ''); }, [rate]);
  const commit = () => {
    const n = parseFloat(val);
    const next = Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
    if (next !== (rate ?? 0)) onCommit(next);
    setVal(next ? String(next) : '');
  };
  return (
    <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300" title="Hourly pay rate (owner only)">
      <DollarSign className="w-3.5 h-3.5 text-slate-400" />
      <input
        type="number" min={0} step="0.25" inputMode="decimal"
        value={val}
        onChange={e => setVal(e.target.value)}
        onFocus={selectOnFocus}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder="0.00"
        className="w-20 p-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm"
      />
      <span className="text-slate-400">/hr</span>
    </label>
  );
};

// Set/update a PIN for one user — never displays or reuses the old PIN (it
// isn't stored anywhere retrievable), just collects and confirms a new one.
const PinModal: React.FC<{ email: string; onClose: () => void; onSave: (pin: string) => Promise<boolean> }> = ({ email, onClose, onSave }) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH);
  const valid = isValidPinFormat(pin);
  const matches = pin.length > 0 && pin === confirmPin;
  const canSave = valid && matches && !busy;

  useEscapeKey(onClose);

  const save = async () => {
    if (!canSave) return;
    setBusy(true); setError(null);
    const ok = await onSave(pin);
    setBusy(false);
    if (ok) onClose(); else setError('Could not save the PIN. Please try again.');
  };

  const pinInput = 'w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm tracking-[0.4em] text-center';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><KeyRound className="w-4 h-4" /> Set PIN — {email}</h2>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-xs text-slate-400">A 4–6 digit code used only to unlock the app after inactivity — not a login. Stored hashed; never shown again once saved.</p>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">New PIN</label>
            <input autoFocus type="password" inputMode="numeric" autoComplete="off" value={pin}
              onChange={e => setPin(digitsOnly(e.target.value))} className={pinInput} placeholder="••••" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Confirm PIN</label>
            <input type="password" inputMode="numeric" autoComplete="off" value={confirmPin}
              onChange={e => setConfirmPin(digitsOnly(e.target.value))} className={pinInput} placeholder="••••" />
          </div>
          {pin && !valid && <p className="text-xs text-amber-600 dark:text-amber-400">PIN must be 4–6 digits.</p>}
          {valid && confirmPin && !matches && <p className="text-xs text-rose-500">PINs don't match.</p>}
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={save} disabled={!canSave} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">{busy ? 'Saving…' : 'Save PIN'}</button>
        </div>
      </div>
    </div>
  );
};


// Owner-only: set a staff member's password directly.
//
// Firebase's own email-based reset is useless for these accounts — staff sign
// in with addresses that often don't receive mail and there's no verification
// step — so this is the ONLY reset path for them. That also means the new
// password has to be handed over in person: nothing is emailed, which the
// dialog says plainly.
//
// The write itself is a Cloud Function call (functions/src/staffPassword.ts);
// no Admin SDK, and no credential of any kind, exists on this side.
const ResetPasswordModal: React.FC<{
  email: string;
  roleLabel: string;
  onClose: () => void;
  onSave: (newPassword: string) => Promise<string | null>;
}> = ({ email, roleLabel, onClose, onSave }) => {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Double-click guard: onSave kicks off a network round trip, and the button's
  // own `disabled` can't block a same-tick second click (state updates are
  // async). useSubmitGuard flips its flag synchronously — see hooks/useSubmitGuard.ts.
  const { isSubmitting, run } = useSubmitGuard();

  useEscapeKey(onClose);

  const strengthError = password ? validatePassword(password) : null;
  const matches = password.length > 0 && password === confirm;
  const canSave = !strengthError && matches && !isSubmitting && !done;

  const save = () => {
    if (!canSave) return;
    run(() => {
      setError(null);
      onSave(password).then(msg => {
        if (msg) { setError(msg); return; }
        // Clear the fields the moment it lands — the password has no reason to
        // stay in component state (or in a React DevTools tree) afterward.
        setPassword(''); setConfirm(''); setDone(true);
      }).catch(() => setError('Could not reset the password. Please try again.'));
    });
  };

  const field = 'w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()} role="dialog" aria-label="Reset password">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><RotateCcw className="w-4 h-4" /> Reset password</h2>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">{email} <span className="text-slate-400">· {roleLabel}</span></p>
          <div className="flex gap-2 items-start text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span><strong>No email is sent.</strong> Give this password to them directly — in person, or over a channel you trust. They'll be signed out everywhere and will need it to sign back in.</span>
          </div>
          {done ? (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">Password updated. Hand it over now — it can't be shown again.</p>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" htmlFor="new-staff-password">New password</label>
                <input id="new-staff-password" autoFocus type="password" autoComplete="new-password" value={password}
                  onChange={e => { setPassword(e.target.value); setError(null); }} className={field} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" htmlFor="confirm-staff-password">Confirm password</label>
                <input id="confirm-staff-password" type="password" autoComplete="new-password" value={confirm}
                  onChange={e => setConfirm(e.target.value)} className={field} placeholder="Type it again" />
              </div>
              {strengthError && <p className="text-xs text-amber-600 dark:text-amber-400">{strengthError}</p>}
              {!strengthError && confirm && !matches && <p className="text-xs text-rose-500">Passwords don't match.</p>}
            </>
          )}
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">{done ? 'Done' : 'Cancel'}</button>
          {!done && (
            <button onClick={save} disabled={!canSave} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">
              {isSubmitting ? 'Saving\u2026' : 'Set password'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Create a fully-usable staff account in one step — email, password, and an
// optional PIN, set directly by the owner/manager creating it, rather than a
// "pending invite" that sits unclaimed until the new hire signs in on their
// own with a password only they know. This is the direct answer to "why
// can't I just set their password and PIN": now you can.
const CreateUserModal: React.FC<{
  roles: Role[];
  onClose: () => void;
  onSave: (input: { email: string; password: string; role: Role; pin?: string }) => Promise<string | null>;
}> = ({ roles, onClose, onSave }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(roles[0]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [setPinNow, setSetPinNow] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { isSubmitting, run } = useSubmitGuard();

  useEscapeKey(onClose);

  const digitsOnly = (v: string) => v.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const strengthError = password ? validatePassword(password) : null;
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const pinValid = !setPinNow || (isValidPinFormat(pin) && pin === confirmPin);
  const canSave = emailValid && !strengthError && passwordsMatch && pinValid && !isSubmitting;

  const save = () => {
    if (!canSave) return;
    run(() => {
      setError(null);
      onSave({ email: email.trim(), password, role, pin: setPinNow ? pin : undefined })
        .then(msg => { if (msg) setError(msg); else onClose(); })
        .catch(() => setError('Could not create the account. Please try again.'));
    });
  };

  const field = 'w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm';
  const pinInput = 'w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm tracking-[0.4em] text-center';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()} role="dialog" aria-label="Create user">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><UserCog className="w-4 h-4" /> Create a user</h2>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-2 items-start text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span><strong>No email is sent.</strong> Give this password (and PIN, if set) to them directly.</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" htmlFor="new-user-email">Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input id="new-user-email" autoFocus value={email} onChange={e => { setEmail(e.target.value); setError(null); }}
                placeholder="jordan@yourshop.local" className={`${field} pl-9`} />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Role</label>
            <select value={role} onChange={e => setRole(e.target.value as Role)} className={field} disabled={roles.length === 1}>
              {roles.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" htmlFor="new-user-password">Password</label>
            <input id="new-user-password" type="password" autoComplete="new-password" value={password}
              onChange={e => { setPassword(e.target.value); setError(null); }} className={field} placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1" htmlFor="new-user-confirm-password">Confirm password</label>
            <input id="new-user-confirm-password" type="password" autoComplete="new-password" value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)} className={field} placeholder="Type it again" />
          </div>
          {strengthError && <p className="text-xs text-amber-600 dark:text-amber-400">{strengthError}</p>}
          {!strengthError && confirmPassword && !passwordsMatch && <p className="text-xs text-rose-500">Passwords don't match.</p>}

          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 pt-1">
            <input type="checkbox" checked={setPinNow} onChange={e => setSetPinNow(e.target.checked)} className="rounded" />
            Set a PIN now too <span className="text-xs text-slate-400">(unlocks the app after inactivity — optional, can be added later)</span>
          </label>
          {setPinNow && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">PIN</label>
                <input type="password" inputMode="numeric" autoComplete="off" value={pin}
                  onChange={e => setPin(digitsOnly(e.target.value))} className={pinInput} placeholder="••••" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Confirm PIN</label>
                <input type="password" inputMode="numeric" autoComplete="off" value={confirmPin}
                  onChange={e => setConfirmPin(digitsOnly(e.target.value))} className={pinInput} placeholder="••••" />
              </div>
              {pin && !isValidPinFormat(pin) && <p className="col-span-2 text-xs text-amber-600 dark:text-amber-400">PIN must be 4–6 digits.</p>}
              {isValidPinFormat(pin) && confirmPin && pin !== confirmPin && <p className="col-span-2 text-xs text-rose-500">PINs don't match.</p>}
            </div>
          )}
          {error && <p className="text-xs text-rose-500">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">Cancel</button>
          <button onClick={save} disabled={!canSave} className="px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white">
            {isSubmitting ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const UsersView: React.FC<Props> = ({
  me, users, invites, canManageAll = true, onSetRole, onSetDisabled, onSetAllowProfit, onSetHourlyRate, onInvite, onDeleteInvite, onCreateUser,
  onSetPin, canManageSecurity, autoLockMinutes, onSetAutoLockMinutes, onResetPassword,
  staffNotes = [], canManageStaffNotes = false, onAddStaffNote, onDeleteStaffNote,
}) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(canManageAll ? 'employee' : 'technician');
  const [pinTarget, setPinTarget] = useState<AppUser | null>(null);
  const [pwTarget, setPwTarget] = useState<AppUser | null>(null);
  const [noteText, setNoteText] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  // The invite panel (self-claimed, no password set here) is now the
  // fallback path — "Create a user" above sets everything up front. Kept
  // available rather than removed: a shop that would rather the new hire
  // pick their own password can still do that.
  const [showInvitePanel, setShowInvitePanel] = useState(false);

  // Managers may only invite/manage technicians; owners manage every role.
  const inviteRoles: Role[] = canManageAll ? ['manager', 'employee', 'technician'] : ['technician'];
  const visibleUsers = canManageAll ? users : users.filter(u => u.role === 'technician');
  const visibleInvites = canManageAll ? invites : invites.filter(i => i.role === 'technician');

  const fmtDate = (ts?: number) => ts ? new Date(ts).toLocaleString() : '—';
  const sel = 'p-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm';

  // Independent of visibleUsers (which mirrors what role-management actions the
  // viewer may take): a manager may PIN employees too, even though they can't
  // otherwise re-role, disable, or set pay for them.
  const pinTargets = users.filter(u => canAssignPin(me.role, u.role));
  const showSecurity = (canManageSecurity && onSetAutoLockMinutes) || (onSetPin && pinTargets.length > 0);

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Users className="w-6 h-6 text-indigo-500" /> {canManageAll ? 'Users & Roles' : 'Technicians'}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{canManageAll ? 'Manage who can access this shop and what they can do.' : 'Invite and manage technician accounts for this shop.'}</p>
      </div>

      {/* Security: auto-lock timer + per-user PIN codes */}
      {showSecurity && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 space-y-4">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Lock className="w-4 h-4 text-indigo-500" /> Security</h3>

          {canManageSecurity && onSetAutoLockMinutes && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-slate-600 dark:text-slate-300">Auto-lock after</label>
              <select value={autoLockMinutes ?? 4} onChange={e => onSetAutoLockMinutes(parseInt(e.target.value, 10))} className={sel}>
                {AUTO_LOCK_OPTIONS.map(m => <option key={m} value={m}>{m} minute{m !== 1 ? 's' : ''}</option>)}
                <option value={0}>Never (not recommended)</option>
              </select>
              <span className="text-xs text-slate-400">of inactivity, app-wide. Unlocks with a PIN, or your password if none is set.</span>
            </div>
          )}

          {onSetPin && pinTargets.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase mb-2">PIN codes</p>
              <div className="space-y-1">
                {pinTargets.map(u => (
                  <div key={u.id} className="flex items-center justify-between text-sm bg-slate-50 dark:bg-slate-800/50 rounded-md px-3 py-1.5">
                    <span className="text-slate-700 dark:text-slate-200">{u.email} <span className="text-slate-400">· {ROLE_LABEL[u.role]}</span>{u.pinHash && <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">PIN set</span>}</span>
                    <button onClick={() => setPinTarget(u)} className="flex items-center gap-1 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"><KeyRound className="w-3.5 h-3.5" /> {u.pinHash ? 'Update PIN' : 'Set PIN'}</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Create a user — sets email, password and an optional PIN directly,
          no self-claimed "pending invite" step. */}
      {onCreateUser && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2"><UserCog className="w-4 h-4 text-indigo-500" /> {canManageAll ? 'Create a user' : 'Create a technician'}</h3>
              <p className="text-xs text-slate-400 mt-1">Set their email, password, and (optionally) their PIN right now — nothing to claim, nothing emailed.</p>
            </div>
            <button onClick={() => setShowCreate(true)} className="shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">Create User</button>
          </div>
          {canManageAll && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3 border-t border-slate-100 dark:border-slate-800 pt-2">
              <strong className="text-slate-600 dark:text-slate-300">Staff addresses don't have to be real mailboxes.</strong>{' '}
              A sign-in address is just an identifier here — nothing is ever verified or emailed, so <code className="text-[11px]">jordan@yourshop.local</code> works fine.
              You're the reset path for it too — use <strong>Reset password</strong> on their row below whenever it needs to change.
            </p>
          )}
          <button onClick={() => setShowInvitePanel(v => !v)} className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline mt-3">
            {showInvitePanel ? 'Hide' : (canManageAll ? 'Or send an invite instead (they set their own password) →' : 'Or send an invite instead →')}
          </button>
        </div>
      )}

      {/* Invite — the fallback path when someone would rather pick their own
          password than have it set for them. Self-claimed the first time
          that email signs in (see hooks/useWorkspaceData.ts). Always shown
          when onCreateUser isn't wired (keeps this view usable either way). */}
      {(!onCreateUser || showInvitePanel) && (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
        <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-3 flex items-center gap-2"><UserPlus className="w-4 h-4 text-indigo-500" /> {canManageAll ? 'Invite a user' : 'Invite a technician'}</h3>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Email</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="teammate@example.com"
                className="w-full pl-9 pr-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Role</label>
            <select value={role} onChange={e => setRole(e.target.value as Role)} className={sel} disabled={inviteRoles.length === 1}>
              {inviteRoles.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </div>
          <button onClick={() => { if (email.trim()) { onInvite(email.trim(), role); setEmail(''); } }} disabled={!email.trim()}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium">Send Invite</button>
        </div>
        <p className="text-xs text-slate-400 mt-2">The invite is claimed automatically when that email signs in. (Disabling a user's login and account deletion require the Firebase Admin SDK — see PR notes.)</p>
        {canManageAll && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 border-t border-slate-100 dark:border-slate-800 pt-2">
            <strong className="text-slate-600 dark:text-slate-300">Staff addresses don't have to be real mailboxes.</strong>{' '}
            A sign-in address is just an identifier here — nothing is ever verified or emailed, so <code className="text-[11px]">jordan@yourshop.local</code> works fine.
            The trade-off: Firebase's "forgot password" email can't reach them, so <em>you</em> are the reset path — use <strong>Reset password</strong> on their row below and hand the new password over in person.
          </p>
        )}

        {visibleInvites.length > 0 && (
          <div className="mt-4 space-y-1">
            <p className="text-xs font-semibold text-slate-500 uppercase">Pending invites</p>
            {visibleInvites.map(inv => (
              <div key={inv.id} className="flex items-center justify-between text-sm bg-slate-50 dark:bg-slate-800/50 rounded-md px-3 py-1.5">
                <span className="text-slate-700 dark:text-slate-200">{inv.email} · <span className="text-slate-400">{ROLE_LABEL[inv.role]}</span></span>
                <button onClick={() => onDeleteInvite(inv.email)} className="text-slate-400 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Users list */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{canManageAll ? 'Members' : 'Technicians'} ({visibleUsers.length})</h3>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {visibleUsers.map(u => {
            const isMe = u.id === me.id;
            return (
              <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${u.disabled ? 'bg-rose-100 text-rose-500 dark:bg-rose-900/30' : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400'}`}>
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-[160px]">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{u.email}{isMe && <span className="text-xs text-slate-400"> (you)</span>}</p>
                  <p className="text-xs text-slate-400">Last login: {fmtDate(u.lastLogin)}{u.disabled ? ' · Disabled' : ''}</p>
                </div>
                {canManageAll ? (
                  <select value={u.role} disabled={isMe} onChange={e => onSetRole(u.id, e.target.value as Role)} className={`${sel} disabled:opacity-50`}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                ) : (
                  <span className="text-xs font-medium px-2 py-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500">{ROLE_LABEL[u.role]}</span>
                )}
                {canManageAll && (u.role === 'employee' || u.role === 'manager') && (
                  <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 cursor-pointer" title="Allow this user to see profit, margins & the analytics dashboard">
                    <input type="checkbox" checked={!!u.allowProfit} onChange={e => onSetAllowProfit(u.id, e.target.checked)} className="rounded" /> <Eye className="w-3.5 h-3.5" /> Financials
                  </label>
                )}
                {canManageAll && onSetHourlyRate && (
                  <RateInput rate={u.hourlyRate} onCommit={r => onSetHourlyRate(u.id, r)} />
                )}
                {onResetPassword && canResetPasswordFor(me.role, u.role) && (
                  <button onClick={() => setPwTarget(u)}
                    title="Set a new password for this user (nothing is emailed)"
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700">
                    <RotateCcw className="w-3.5 h-3.5" /> Reset password
                  </button>
                )}
                <button onClick={() => onSetDisabled(u.id, !u.disabled)} disabled={isMe}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40 ${u.disabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'}`}>
                  {u.disabled ? <><CheckCircle2 className="w-3.5 h-3.5" /> Enable</> : <><Ban className="w-3.5 h-3.5" /> Disable</>}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Staff notes — owner-only internal shoutout/notes log */}
      {canManageStaffNotes && onAddStaffNote && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100 mb-1 flex items-center gap-2"><MessageSquarePlus className="w-4 h-4 text-indigo-500" /> Staff Notes</h3>
          <p className="text-xs text-slate-400 mb-3">Internal-only quick notes about staff — visible to owners only. Not a performance review.</p>
          <div className="flex flex-wrap gap-2 items-end mb-4">
            <div className="flex-1 min-w-[240px]">
              <textarea
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                placeholder="e.g. Jordan handled a tough return well today."
                rows={2}
                className="w-full p-2.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm"
              />
            </div>
            <button
              onClick={() => { if (canAddStaffNote(noteText)) { onAddStaffNote(noteText.trim()); setNoteText(''); } }}
              disabled={!canAddStaffNote(noteText)}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg text-sm font-medium"
            >
              Add Note
            </button>
          </div>
          <div className="space-y-2">
            {sortStaffNotes(staffNotes).length === 0 && <p className="text-sm text-slate-400">No notes yet.</p>}
            {sortStaffNotes(staffNotes).map(n => (
              <div key={n.id} className="flex items-start justify-between gap-3 text-sm bg-slate-50 dark:bg-slate-800/50 rounded-md px-3 py-2">
                <div>
                  <p className="text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{n.text}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{new Date(n.ts).toLocaleString()} · {n.authorEmail}</p>
                </div>
                {onDeleteStaffNote && (
                  <button onClick={() => onDeleteStaffNote(n.id)} className="text-slate-400 hover:text-rose-500 shrink-0"><Trash2 className="w-4 h-4" /></button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showCreate && onCreateUser && (
        <CreateUserModal roles={inviteRoles} onClose={() => setShowCreate(false)} onSave={onCreateUser} />
      )}

      {pinTarget && onSetPin && (
        <PinModal email={pinTarget.email} onClose={() => setPinTarget(null)} onSave={pin => onSetPin(pinTarget.id, pin)} />
      )}

      {pwTarget && onResetPassword && (
        <ResetPasswordModal
          email={pwTarget.email}
          roleLabel={ROLE_LABEL[pwTarget.role]}
          onClose={() => setPwTarget(null)}
          onSave={pw => onResetPassword(pwTarget.id, pw)}
        />
      )}
    </div>
  );
};
