import React, { useState, useEffect } from 'react';
import { Users, UserPlus, ShieldCheck, Ban, CheckCircle2, Trash2, Mail, Eye, DollarSign, KeyRound, X, Lock, MessageSquarePlus } from 'lucide-react';
import { AppUser, WorkspaceInvite, Role, StaffNote } from '../types';
import { ROLE_LABEL } from '../services/rbac';
import { canAssignPin, isValidPinFormat, PIN_MAX_LENGTH } from '../domain/pin';
import { sortStaffNotes, canAddStaffNote } from '../domain/staffNotes';
import { useEscapeKey } from '../hooks/useEscapeKey';

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
  // Auto-lock PIN — a manager/owner may set a PIN for anyone strictly below
  // their role (never a peer or above; see domain/pin.ts canAssignPin).
  onSetPin?: (uid: string, pin: string) => Promise<boolean>;
  // Auto-lock timer — owner + manager (security.manage).
  canManageSecurity?: boolean;
  autoLockMinutes?: number;
  onSetAutoLockMinutes?: (minutes: number) => void;
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

export const UsersView: React.FC<Props> = ({
  me, users, invites, canManageAll = true, onSetRole, onSetDisabled, onSetAllowProfit, onSetHourlyRate, onInvite, onDeleteInvite,
  onSetPin, canManageSecurity, autoLockMinutes, onSetAutoLockMinutes,
  staffNotes = [], canManageStaffNotes = false, onAddStaffNote, onDeleteStaffNote,
}) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(canManageAll ? 'employee' : 'technician');
  const [pinTarget, setPinTarget] = useState<AppUser | null>(null);
  const [noteText, setNoteText] = useState('');

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

      {/* Invite */}
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

      {pinTarget && onSetPin && (
        <PinModal email={pinTarget.email} onClose={() => setPinTarget(null)} onSave={pin => onSetPin(pinTarget.id, pin)} />
      )}
    </div>
  );
};
