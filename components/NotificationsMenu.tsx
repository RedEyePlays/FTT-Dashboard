import React, { useMemo, useState } from 'react';
import { Bell } from 'lucide-react';
import { ActivityEntry } from '../types';
import { HeaderMenu } from './HeaderMenu';

const SEEN_KEY = 'ftt_notif_seen';
const loadSeen = (): number => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };

const rel = (ts: number): string => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
};

// Read-only notifications, sourced from the existing recent-activity feed. A dot
// marks entries newer than the last time the menu was opened (persisted locally).
export const NotificationsMenu: React.FC<{ activity: ActivityEntry[]; iconClass: string }> = ({ activity, iconClass }) => {
  const [seen, setSeen] = useState<number>(loadSeen);
  const recent = useMemo(() => [...activity].sort((a, b) => b.ts - a.ts).slice(0, 10), [activity]);
  const unread = recent.filter(a => a.ts > seen).length;

  const markSeen = () => {
    const latest = recent[0]?.ts ?? Date.now();
    setSeen(latest);
    try { localStorage.setItem(SEEN_KEY, String(latest)); } catch { /* ignore */ }
  };

  return (
    <HeaderMenu
      label={unread ? `Notifications, ${unread} new` : 'Notifications'}
      align="right"
      panelClassName="w-80"
      triggerClassName={`relative ${iconClass}`}
      trigger={
        <>
          <Bell className="w-5 h-5" />
          {unread > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-none">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </>
      }
    >
      {() => (
        <div onMouseEnter={markSeen} onFocus={markSeen}>
          <div className="px-2 py-1.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Notifications</span>
            {recent.length > 0 && <span className="text-[11px] text-slate-400">Recent activity</span>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {recent.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400 dark:text-slate-500">No recent activity.</p>
            ) : (
              recent.map(a => (
                <div key={a.id} role="menuitem" tabIndex={-1}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg focus:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800">
                  <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${a.ts > seen ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                  <span className="min-w-0">
                    <span className="block text-sm text-slate-700 dark:text-slate-200">{a.text}</span>
                    <span className="block text-[11px] text-slate-400">{rel(a.ts)}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </HeaderMenu>
  );
};
