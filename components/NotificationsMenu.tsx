import React, { useMemo, useState } from 'react';
import { Bell, PackageX, Clock, PackageCheck, AlertTriangle, Hourglass } from 'lucide-react';
import { ActivityEntry, ViewState } from '../types';
import { Alert, AlertKind } from '../domain/alerts';
import { HeaderMenu } from './HeaderMenu';

const PAGE = 10; // activity items shown per "Show more" step

const rel = (ts: number): string => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
};

const ALERT_ICON: Record<AlertKind, React.ReactNode> = {
  low_stock: <PackageX className="w-4 h-4" />,
  repair_overdue: <Clock className="w-4 h-4" />,
  repair_awaiting_pickup: <PackageCheck className="w-4 h-4" />,
  aging_inventory: <Hourglass className="w-4 h-4" />,
};

interface Props {
  activity: ActivityEntry[];
  alerts: Alert[];
  seenTs: number;                       // per-user, persisted read watermark
  onMarkSeen: (ts: number) => void;
  onNavigate: (v: ViewState) => void;
  iconClass: string;
}

// Notifications menu. Two clearly separated parts:
//   1. "Needs attention" — standing, actionable alerts (low stock, overdue /
//      unclaimed repairs) derived from live data.
//   2. "Recent activity" — the chronological feed, paginated beyond the first 10.
// Read state is per-user and persisted (AppUser.notifSeenTs) so it follows a
// staff member across devices and isn't shared on a kiosk.
export const NotificationsMenu: React.FC<Props> = ({ activity, alerts, seenTs, onMarkSeen, onNavigate, iconClass }) => {
  const sorted = useMemo(() => [...activity].sort((a, b) => b.ts - a.ts), [activity]);
  const [visible, setVisible] = useState(PAGE);

  const unreadActivity = sorted.filter(a => a.ts > seenTs).length;
  // The bell reflects both unseen activity and any standing alerts to address.
  const badge = unreadActivity + alerts.length;

  const markSeen = () => {
    const latest = sorted[0]?.ts ?? Date.now();
    if (latest > seenTs) onMarkSeen(latest);
  };

  const shown = sorted.slice(0, visible);

  return (
    <HeaderMenu
      label={badge ? `Notifications, ${badge} new` : 'Notifications'}
      align="right"
      panelClassName="w-80"
      triggerClassName={`relative ${iconClass}`}
      trigger={
        <>
          <Bell className="w-5 h-5" />
          {badge > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] font-bold leading-none">
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </>
      }
    >
      {(close) => (
        <div onMouseEnter={markSeen} onFocus={markSeen}>
          {/* --- Needs attention (alerts) --- */}
          {alerts.length > 0 && (
            <div className="border-b border-slate-100 dark:border-slate-800 pb-1.5 mb-1">
              <div className="px-2 py-1.5 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Needs attention</span>
                <span className="text-[11px] text-slate-400">({alerts.length})</span>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {alerts.map(al => (
                  <button
                    key={al.id}
                    role="menuitem"
                    onClick={() => { onNavigate(al.view); close(); }}
                    className="w-full text-left flex items-start gap-2 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 focus:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800"
                  >
                    <span className={`mt-0.5 shrink-0 ${al.severity === 'warning' ? 'text-rose-500' : 'text-amber-500'}`}>
                      {ALERT_ICON[al.kind]}
                    </span>
                    <span className="block text-sm text-slate-700 dark:text-slate-200 min-w-0">{al.text}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* --- Recent activity --- */}
          <div className="px-2 py-1.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Recent activity</span>
            {sorted.length > 0 && <span className="text-[11px] text-slate-400">{sorted.length} total</span>}
          </div>
          <div className="max-h-80 overflow-y-auto">
            {sorted.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400 dark:text-slate-500">
                {alerts.length ? 'No recent activity.' : 'You’re all caught up.'}
              </p>
            ) : (
              <>
                {shown.map(a => (
                  <div key={a.id} role="menuitem" tabIndex={-1}
                    className="flex items-start gap-2 px-3 py-2 rounded-lg focus:outline-none focus-visible:bg-slate-100 dark:focus-visible:bg-slate-800">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${a.ts > seenTs ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                    <span className="min-w-0">
                      <span className="block text-sm text-slate-700 dark:text-slate-200">{a.text}</span>
                      <span className="block text-[11px] text-slate-400">{rel(a.ts)}</span>
                    </span>
                  </div>
                ))}
                {visible < sorted.length && (
                  <button
                    onClick={() => setVisible(v => v + PAGE)}
                    className="w-full py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                  >
                    Show more ({sorted.length - visible} older)
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </HeaderMenu>
  );
};
