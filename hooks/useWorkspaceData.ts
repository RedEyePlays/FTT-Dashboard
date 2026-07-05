import { useState, useEffect, useRef, useMemo } from 'react';
import { User, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  InventoryItem, Note, Task, Runner, DropOff, Settlement, Customer, SalesTransaction,
  ActivityEntry, AppUser, WorkspaceInvite, AuditEntry,
} from '../types';
import { decryptData } from '../services/security';
import { auth, db } from '../services/firebase';
import { onAuthChange } from '../services/auth';
import {
  subscribeCollection, subscribeMeta, migrateLegacyIfNeeded,
  getUserDoc, setUserDoc, updateUserDoc, subscribeWorkspaceUsers, getInvite, deleteInvite,
  subscribeInvites,
} from '../services/firestoreDb';

/**
 * The workspace data layer.
 *
 * Owns everything that used to live inline in App.tsx: the Firebase auth
 * listener, first-login role/workspace resolution, the one-time legacy-blob
 * migration, and all real-time Firestore subscriptions for the shared shop
 * data. App.tsx consumes this hook and stays focused on view state, write
 * handlers and rendering.
 *
 * Behavior is intentionally identical to the previous inline implementation —
 * this is a mechanical extraction, not a rewrite.
 */
export function useWorkspaceData() {
  // --- AUTH STATE ---
  const [user, setUser] = useState<User | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Data State — populated live from Firestore collections
  const [devices, setDevices] = useState<InventoryItem[]>([]);
  const [accessories, setAccessories] = useState<InventoryItem[]>([]);
  const data = useMemo(() => [...devices, ...accessories], [devices, accessories]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [dropOffs, setDropOffs] = useState<DropOff[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesTransactions, setSalesTransactions] = useState<SalesTransaction[]>([]);
  const [skuCounters, setSkuCounters] = useState<Record<string, number>>({});
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [lastBackup, setLastBackup] = useState<number | undefined>(undefined);

  // Users / roles
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);
  const [workspaceUsers, setWorkspaceUsers] = useState<AppUser[]>([]);
  const [invites, setInvites] = useState<WorkspaceInvite[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const workspaceId = appUser?.workspaceId;

  // Firestore connection state
  const [dbLoading, setDbLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [reconnectKey, setReconnectKey] = useState(0);

  // Refs for latest snapshots (used to diff array-based updates + SKU gen)
  const runnersRef = useRef<Runner[]>([]);
  const dropOffsRef = useRef<DropOff[]>([]);
  const settlementsRef = useRef<Settlement[]>([]);
  const customersRef = useRef<Customer[]>([]);
  const salesTransactionsRef = useRef<SalesTransaction[]>([]);
  const skuRef = useRef<Record<string, number>>({});
  const dataRef = useRef<InventoryItem[]>([]);
  useEffect(() => { runnersRef.current = runners; }, [runners]);
  useEffect(() => { dropOffsRef.current = dropOffs; }, [dropOffs]);
  useEffect(() => { settlementsRef.current = settlements; }, [settlements]);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { salesTransactionsRef.current = salesTransactions; }, [salesTransactions]);
  useEffect(() => { skuRef.current = skuCounters; }, [skuCounters]);
  useEffect(() => { dataRef.current = data; }, [data]);

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthChange((u) => {
      setUser(u);
      if (!u) {
        setDevices([]); setAccessories([]); setNotes([]); setTasks([]);
        setRunners([]); setDropOffs([]); setSettlements([]); setCustomers([]);
        setSalesTransactions([]); setActivityLog([]); setSkuCounters({});
        setAppUser(null); setWorkspaceUsers([]); setInvites([]); setAuditLogs([]);
        setDbLoading(false); setRoleLoading(false);
      }
      setIsLoadingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  // Resolve the signed-in user's role + workspace (create/claim on first login)
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setRoleLoading(true);
    (async () => {
      try {
        let record = await getUserDoc(user.uid);
        if (!record) {
          // First login: claim a pending invite by email, else become owner of a new workspace.
          const invite = user.email ? await getInvite(user.email) : null;
          record = invite
            ? { id: user.uid, email: user.email || '', role: invite.role, workspaceId: invite.workspaceId, lastLogin: Date.now(), createdAt: Date.now() }
            : { id: user.uid, email: user.email || '', role: 'owner', workspaceId: user.uid, lastLogin: Date.now(), createdAt: Date.now() };
          await setUserDoc(record);
          if (invite) await deleteInvite(invite.email).catch(() => {});
        } else {
          updateUserDoc(user.uid, { lastLogin: Date.now() }).catch(() => {});
        }
        if (cancelled) return;
        if (record.disabled) {
          setAuthError('Your account has been disabled. Contact the shop owner.');
          await signOut(auth);
          return;
        }
        setAppUser(record);
      } catch (e: any) {
        if (!cancelled) setDbError(e?.message || 'Failed to load your account');
      } finally {
        if (!cancelled) setRoleLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Firestore real-time subscriptions, keyed on the workspace (shared shop data)
  useEffect(() => {
    if (!user || !appUser || !workspaceId) return;
    const wsId = workspaceId;
    setDbLoading(true); setDbError(null);
    const onErr = (e: Error) => { console.error('Firestore error:', e); setDbError(e.message || 'Failed to load data'); setDbLoading(false); };

    // One-time migration of the legacy encrypted blob (owner's own workspace only).
    if (wsId === user.uid) {
      (async () => {
        try {
          const legacySnap = await getDoc(doc(db, 'user_data', wsId));
          const enc = legacySnap.exists() ? (legacySnap.data() as any).data : null;
          if (enc && user.email) {
            const decrypted = decryptData(enc, user.email);
            await migrateLegacyIfNeeded(wsId, decrypted);
          }
        } catch { /* non-fatal */ }
      })();
    }

    const subs = [
      subscribeCollection<InventoryItem>(wsId, 'inventory', rows => { setDevices(rows); setDbLoading(false); }, onErr),
      subscribeCollection<InventoryItem>(wsId, 'accessories', setAccessories, onErr),
      subscribeCollection<Runner>(wsId, 'runners', setRunners, onErr),
      subscribeCollection<DropOff>(wsId, 'dropOffs', setDropOffs, onErr),
      subscribeCollection<Settlement>(wsId, 'settlements', setSettlements, onErr),
      subscribeCollection<Customer>(wsId, 'customers', setCustomers, onErr),
      subscribeCollection<SalesTransaction>(wsId, 'salesTransactions', setSalesTransactions, onErr),
      subscribeCollection<ActivityEntry>(wsId, 'activityLog', rows => setActivityLog(rows.sort((a, b) => b.ts - a.ts).slice(0, 60)), onErr),
      subscribeCollection<AuditEntry>(wsId, 'auditLogs', rows => setAuditLogs(rows.sort((a, b) => b.ts - a.ts).slice(0, 1000)), onErr),
      subscribeMeta(wsId, m => { setNotes(m.notes || []); setTasks(m.tasks || []); setSkuCounters(m.skuCounters || {}); setLastBackup(m.lastBackup); }, onErr),
    ];
    // Owner-only: workspace members + pending invites
    if (appUser.role === 'owner') {
      subs.push(subscribeWorkspaceUsers(wsId, setWorkspaceUsers, onErr));
      subs.push(subscribeInvites(wsId, setInvites, onErr));
    } else {
      setWorkspaceUsers([appUser]);
    }
    return () => subs.forEach(u => u());
  }, [user, appUser, workspaceId, reconnectKey]);

  // Retry a failed connection (used by the DB-error screen's Retry button).
  const reconnect = () => { setDbError(null); setDbLoading(true); setReconnectKey(k => k + 1); };

  return {
    // auth
    user, isLoadingAuth, authError, setAuthError,
    // role / workspace
    appUser, roleLoading, workspaceId, workspaceUsers, invites, auditLogs,
    // collections
    devices, accessories, data, notes, setNotes, tasks, setTasks,
    runners, dropOffs, settlements, customers, salesTransactions,
    skuCounters, setSkuCounters, activityLog, lastBackup,
    // connection status
    dbLoading, dbError, setDbError, reconnect,
    // latest-snapshot refs
    runnersRef, dropOffsRef, settlementsRef, customersRef, salesTransactionsRef, skuRef, dataRef,
  };
}
