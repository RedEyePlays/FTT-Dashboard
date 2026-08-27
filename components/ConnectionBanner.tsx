import React from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useConnectionStatus } from '../hooks/useConnectionStatus';

// Fixed overlay strip, mounted once at the app root (index.tsx) rather than
// inside App.tsx's own layout — App has several full-screen early-return
// states (auth, loading, db error, lock screen, technician view, main view)
// and a fixed-position element sidesteps needing to thread it into every one
// of them individually. Shown when the connection state is worth telling
// staff about — offline (persistent, since it's an ongoing condition they
// need to keep in mind) or just-reconnected (transient, so it doesn't linger
// once things are back to normal). Nothing renders while online and settled,
// which is the overwhelming majority of the time.
export const ConnectionBanner: React.FC = () => {
  const status = useConnectionStatus();

  if (status === 'offline') {
    return (
      <div className="fixed top-0 left-0 right-0 z-[300] bg-amber-500 text-amber-950 text-xs sm:text-sm font-medium px-3 py-1.5 flex items-center justify-center gap-2 text-center shadow-sm">
        <WifiOff className="w-4 h-4 shrink-0" />
        Offline — changes will sync when reconnected
      </div>
    );
  }
  if (status === 'reconnected') {
    return (
      <div className="fixed top-0 left-0 right-0 z-[300] bg-emerald-500 text-emerald-950 text-xs sm:text-sm font-medium px-3 py-1.5 flex items-center justify-center gap-2 text-center shadow-sm">
        <RefreshCw className="w-4 h-4 shrink-0" />
        Back online — synced
      </div>
    );
  }
  return null;
};
