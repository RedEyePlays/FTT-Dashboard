import React, { useState } from 'react';
import { Users, UserPlus, ShieldCheck, Ban, CheckCircle2, Trash2, Mail, Eye } from 'lucide-react';
import { AppUser, WorkspaceInvite, Role } from '../types';
import { ROLE_LABEL } from '../services/rbac';

interface Props {
  me: AppUser;
  users: AppUser[];
  invites: WorkspaceInvite[];
  canManageAll?: boolean; // owner = manage all roles; false (manager) = technicians only
  onSetRole: (uid: string, role: Role) => void;
  onSetDisabled: (uid: string, disabled: boolean) => void;
  onSetAllowProfit: (uid: string, allow: boolean) => void;
  onInvite: (email: string, role: Role) => void;
  onDeleteInvite: (email: string) => void;
}

const ROLES: Role[] = ['owner', 'manager', 'employee', 'technician'];

export const UsersView: React.FC<Props> = ({ me, users, invites, canManageAll = true, onSetRole, onSetDisabled, onSetAllowProfit, onInvite, onDeleteInvite }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>(canManageAll ? 'employee' : 'technician');

  // Managers may only invite/manage technicians; owners manage every role.
  const inviteRoles: Role[] = canManageAll ? ['manager', 'employee', 'technician'] : ['technician'];
  const visibleUsers = canManageAll ? users : users.filter(u => u.role === 'technician');
  const visibleInvites = canManageAll ? invites : invites.filter(i => i.role === 'technician');

  const fmtDate = (ts?: number) => ts ? new Date(ts).toLocaleString() : '—';
  const sel = 'p-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-sm';

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Users className="w-6 h-6 text-indigo-500" /> {canManageAll ? 'Users & Roles' : 'Technicians'}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{canManageAll ? 'Manage who can access this shop and what they can do.' : 'Invite and manage technician accounts for this shop.'}</p>
      </div>

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
                {canManageAll && u.role === 'employee' && (
                  <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 cursor-pointer" title="Allow this employee to see profit-sensitive figures">
                    <input type="checkbox" checked={!!u.allowProfit} onChange={e => onSetAllowProfit(u.id, e.target.checked)} className="rounded" /> <Eye className="w-3.5 h-3.5" /> Profit
                  </label>
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
    </div>
  );
};
