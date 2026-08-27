import { useEffect, useRef, useState } from 'react';
import { onSnapshotsInSync } from 'firebase/firestore';
import { db } from '../services/firebase';

export type ConnectionState = 'offline' | 'reconnected' | 'online';

// Browser `online`/`offline` events are the primary signal — they're what
// actually flips instantly when wifi drops at the counter, which is the
// scenario this exists for. They're not a perfect proxy for "can reach
// Firestore" (a captive portal or a dead upstream link can leave the browser
// reporting online while nothing actually loads), but combined with
// Firestore's own onSnapshotsInSync — which only fires once the local cache
// has actually caught back up with the server — the transient "reconnected"
// state below only appears once there's real evidence a sync happened, not
// just that the OS thinks the network is back.
export const useConnectionStatus = (): ConnectionState => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [justReconnected, setJustReconnected] = useState(false);
  const wasOffline = useRef(!navigator.onLine);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => { setIsOnline(false); wasOffline.current = true; };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    if (!isOnline) return;
    const unsub = onSnapshotsInSync(db, () => {
      if (wasOffline.current) {
        wasOffline.current = false;
        setJustReconnected(true);
        setTimeout(() => setJustReconnected(false), 4000);
      }
    });
    return unsub;
  }, [isOnline]);

  if (!isOnline) return 'offline';
  if (justReconnected) return 'reconnected';
  return 'online';
};
