import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { User, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  InventoryItem, Note, Task, DeviceBuyer, DropOff, Settlement, Customer, SalesTransaction,
  ActivityEntry, AppUser, WorkspaceInvite, AuditEntry, Repair, RepairBatch, TimeEntry, PayPeriodPaid, PayPeriodApproval, CashReconciliation, StaffNote,
  Expense, RecurringExpense,
} from '../types';
import { decryptData } from '../services/security';
import { AppSettings, mergeSettings } from '../domain/settings';
import { auth, db } from '../services/firebase';
import { onAuthChange } from '../services/auth';
import { withResolvedBuyerId } from '../domain/dropoffs';
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
// Bounded fetch sizes for the unbounded logs (server-side orderBy ts desc + limit).
const ACTIVITY_LIMIT = 100;   // recent activity feed (Notifications menu)
const AUDIT_PAGE = 500;       // audit log initial page; "load older" widens it

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
  const [deviceBuyers, setDeviceBuyers] = useState<DeviceBuyer[]>([]);
  const [dropOffs, setDropOffs] = useState<DropOff[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [salesTransactions, setSalesTransactions] = useState<SalesTransaction[]>([]);
  const [repairs, setRepairs] = useState<Repair[]>([]);
  const [repairBatches, setRepairBatches] = useState<RepairBatch[]>([]);
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [payPeriods, setPayPeriods] = useState<PayPeriodPaid[]>([]);
  const [payPeriodApprovals, setPayPeriodApprovals] = useState<PayPeriodApproval[]>([]);
  const [cashReconciliations, setCashReconciliations] = useState<CashReconciliation[]>([]);
  const [staffNotes, setStaffNotes] = useState<StaffNote[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [skuCounters, setSkuCounters] = useState<Record<string, number>>({});
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [lastBackup, setLastBackup] = useState<number | undefined>(undefined);
  const [settings, setSettings] = useState<AppSettings>(() => mergeSettings());

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
  // Deferred collections: time entries, pay periods, drop-offs and settlements
  // are read only by the Time Clock, Reports and Drop-off views (and the write
  // handlers those views invoke) — never by the Dashboard or everyday pages. So
  // they don't subscribe on login; App flips this on the first visit to one of
  // those views, and it stays on afterwards (no tear-down, no re-fetch churn).
  const [extendedEnabled, setExtendedEnabled] = useState(false);
  // Cash reconciliations are separate because the register cash drawer lives on
  // the POS/Quick Sale screen (not just Reports) — the drawer summary and the
  // open/log/reconcile write path all need this live. App enables it for anyone
  // who can handle cash (cash.log) the moment they're on POS, and on Reports.
  // Kept out of the heavier extended bucket so POS doesn't pull payroll data.
  const [cashEnabled, setCashEnabled] = useState(false);
  // Audit log is unbounded over the shop's lifetime, so it's fetched newest-first
  // in bounded pages (server-side limit) with a load-older control, rather than
  // downloaded in full on every session.
  const [auditLimit, setAuditLimit] = useState(AUDIT_PAGE);

  // Refs for latest snapshots (used to diff array-based updates + SKU gen)
  const deviceBuyersRef = useRef<DeviceBuyer[]>([]);
  const dropOffsRef = useRef<DropOff[]>([]);
  const settlementsRef = useRef<Settlement[]>([]);
  const customersRef = useRef<Customer[]>([]);
  const salesTransactionsRef = useRef<SalesTransaction[]>([]);
  const repairsRef = useRef<Repair[]>([]);
  const repairBatchesRef = useRef<RepairBatch[]>([]);
  const skuRef = useRef<Record<string, number>>({});
  const dataRef = useRef<InventoryItem[]>([]);
  useEffect(() => { deviceBuyersRef.current = deviceBuyers; }, [deviceBuyers]);
  useEffect(() => { dropOffsRef.current = dropOffs; }, [dropOffs]);
  useEffect(() => { settlementsRef.current = settlements; }, [settlements]);
  useEffect(() => { customersRef.current = customers; }, [customers]);
  useEffect(() => { salesTransactionsRef.current = salesTransactions; }, [salesTransactions]);
  useEffect(() => { repairsRef.current = repairs; }, [repairs]);
  useEffect(() => { repairBatchesRef.current = repairBatches; }, [repairBatches]);
  useEffect(() => { skuRef.current = skuCounters; }, [skuCounters]);
  useEffect(() => { dataRef.current = data; }, [data]);

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthChange((u) => {
      setUser(u);
      if (!u) {
        setDevices([]); setAccessories([]); setNotes([]); setTasks([]);
        setDeviceBuyers([]); setDropOffs([]); setSettlements([]); setCustomers([]);
        setSalesTransactions([]); setRepairs([]); setRepairBatches([]); setTimeEntries([]); setPayPeriods([]); setActivityLog([]); setSkuCounters({});
        setAppUser(null); setWorkspaceUsers([]); setInvites([]); setAuditLogs([]); setStaffNotes([]); setExtendedEnabled(false); setCashEnabled(false);
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
            ? { id: user.uid, email: user.email || '', role: invite.role, workspaceId: invite.workspaceId, disabled: false, lastLogin: Date.now(), createdAt: Date.now() }
            : { id: user.uid, email: user.email || '', role: 'owner', workspaceId: user.uid, disabled: false, lastLogin: Date.now(), createdAt: Date.now() };
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
      subscribeCollection<DeviceBuyer>(wsId, 'runners', setDeviceBuyers, onErr),
      subscribeCollection<Customer>(wsId, 'customers', setCustomers, onErr),
      subscribeCollection<SalesTransaction>(wsId, 'salesTransactions', setSalesTransactions, onErr),
      subscribeCollection<Repair>(wsId, 'repairs', setRepairs, onErr),
      subscribeCollection<RepairBatch>(wsId, 'repairBatches', setRepairBatches, onErr),
      subscribeCollection<ActivityEntry>(wsId, 'activityLog', rows => setActivityLog(rows.sort((a, b) => b.ts - a.ts)), onErr, { orderByField: 'ts', limitTo: ACTIVITY_LIMIT }),
      subscribeMeta(wsId, m => { setNotes(m.notes || []); setTasks(m.tasks || []); setSkuCounters(m.skuCounters || {}); setLastBackup(m.lastBackup); setSettings(mergeSettings(m.settings)); }, onErr),
    ];
    // Owners and managers read the full member roster (managers need it for the
    // payroll summary and technician management); everyone else sees only self.
    if (appUser.role === 'owner' || appUser.role === 'manager') {
      subs.push(subscribeWorkspaceUsers(wsId, setWorkspaceUsers, onErr));
      subs.push(subscribeInvites(wsId, setInvites, onErr));
    } else {
      setWorkspaceUsers([appUser]);
    }
    return () => subs.forEach(u => u());
  }, [user, appUser, workspaceId, reconnectKey]);

  // Deferred subscriptions — only started once App enables them (first visit to
  // Time Clock / Reports / Drop-offs). Kept in their own effect so enabling them
  // doesn't tear down and re-fetch the core collections. Once on they stay on for
  // the session, so navigating back and forth never re-subscribes.
  useEffect(() => {
    if (!user || !appUser || !workspaceId || !extendedEnabled) return;
    const onErr = (e: Error) => { console.error('Firestore error (extended):', e); setDbError(e.message || 'Failed to load data'); };
    const subs = [
      // Legacy-field normalization boundary. Documents written before the
      // Runner→Device Buyer rename carry `runnerId` instead of `buyerId`, and
      // deliberately were NOT migrated (see types.ts's DropOff.buyerId). This
      // is the ONE place that resolves it: every DropOff/Settlement gets
      // `buyerId` backfilled here, so no component, domain function or write
      // handler downstream ever has to know the legacy name existed.
      subscribeCollection<DropOff>(workspaceId, 'dropOffs', rows => setDropOffs(rows.map(withResolvedBuyerId<DropOff>)), onErr),
      subscribeCollection<Settlement>(workspaceId, 'settlements', rows => setSettlements(rows.map(withResolvedBuyerId<Settlement>)), onErr),
      subscribeCollection<TimeEntry>(workspaceId, 'timeEntries', setTimeEntries, onErr),
      subscribeCollection<PayPeriodPaid>(workspaceId, 'payPeriods', setPayPeriods, onErr),
      subscribeCollection<PayPeriodApproval>(workspaceId, 'payPeriodApprovals', setPayPeriodApprovals, onErr),
    ];
    return () => subs.forEach(u => u());
  }, [user, appUser, workspaceId, reconnectKey, extendedEnabled]);

  // Cash reconciliations subscription — enabled independently (POS cash drawer +
  // Reports) so the drawer's read-modify-write path always sees the live record.
  useEffect(() => {
    if (!user || !appUser || !workspaceId || !cashEnabled) return;
    const onErr = (e: Error) => { console.error('Firestore error (cash):', e); setDbError(e.message || 'Failed to load data'); };
    return subscribeCollection<CashReconciliation>(workspaceId, 'cashReconciliations', setCashReconciliations, onErr);
  }, [user, appUser, workspaceId, reconnectKey, cashEnabled]);

  // Audit log subscription is separate so "load older" can widen the page limit
  // without tearing down and re-subscribing every other collection.
  useEffect(() => {
    if (!user || !appUser || !workspaceId) return;
    const onErr = (e: Error) => { console.error('Firestore error (audit):', e); };
    return subscribeCollection<AuditEntry>(workspaceId, 'auditLogs',
      rows => setAuditLogs(rows.sort((a, b) => b.ts - a.ts)), onErr,
      { orderByField: 'ts', limitTo: auditLimit });
  }, [user, appUser, workspaceId, reconnectKey, auditLimit]);

  // Staff notes (owner-only shoutout/notes log) — its own effect, gated to
  // owners only, so it never subscribes for roles that can't see it.
  useEffect(() => {
    if (!user || !appUser || !workspaceId || appUser.role !== 'owner') { setStaffNotes([]); return; }
    const onErr = (e: Error) => { console.error('Firestore error (staff notes):', e); };
    return subscribeCollection<StaffNote>(workspaceId, 'staffNotes', setStaffNotes, onErr);
  }, [user, appUser, workspaceId, reconnectKey]);

  // Expense ledger. Role-gated like staffNotes so no role ever attempts a
  // subscription firestore.rules would reject anyway:
  //   • expenses          — owner + manager only (expenses.add /
  //     expenses.viewAll in services/rbac.ts; employees and technicians lost
  //     expense access entirely). The manager subscribes to the FULL
  //     collection deliberately: domain/reports.ts's profitAndLoss must
  //     subtract every workspace expense, and a truncated array would
  //     OVERSTATE their net profit. The "only my own entries" scoping is a
  //     BROWSE filter applied in ReportsView's ExpensesTab
  //     (domain/expenses.ts's visibleExpensesFor) — never here, and never on
  //     the P&L input.
  //   • recurringExpenses — owner only; recurring templates are owner-only
  //     configuration, matching the firestore.rules block.
  useEffect(() => {
    if (!user || !appUser || !workspaceId || (appUser.role !== 'owner' && appUser.role !== 'manager')) {
      setExpenses([]); setRecurringExpenses([]); return;
    }
    const onErr = (e: Error) => { console.error('Firestore error (expenses):', e); };
    const subs = [subscribeCollection<Expense>(workspaceId, 'expenses', setExpenses, onErr)];
    if (appUser.role === 'owner') {
      subs.push(subscribeCollection<RecurringExpense>(workspaceId, 'recurringExpenses', setRecurringExpenses, onErr));
    } else {
      setRecurringExpenses([]);
    }
    return () => subs.forEach(u => u());
  }, [user, appUser, workspaceId, reconnectKey]);

  // Retry a failed connection (used by the DB-error screen's Retry button).
  const reconnect = () => { setDbError(null); setDbLoading(true); setReconnectKey(k => k + 1); };

  // Stable so App's per-view effect doesn't re-run every render.
  const enableExtendedData = useCallback(() => setExtendedEnabled(true), []);
  const enableCashData = useCallback(() => setCashEnabled(true), []);

  return {
    // auth
    user, isLoadingAuth, authError, setAuthError,
    // role / workspace
    appUser, roleLoading, workspaceId, workspaceUsers, invites, auditLogs,
    // audit paging: widen the fetch on demand; hasMore is true while the page is full
    loadMoreAuditLogs: () => setAuditLimit(n => n + AUDIT_PAGE),
    auditHasMore: auditLogs.length >= auditLimit,
    // collections
    devices, accessories, data, notes, setNotes, tasks, setTasks,
    deviceBuyers, dropOffs, settlements, customers, salesTransactions,
    repairs, repairBatches, timeEntries, payPeriods, payPeriodApprovals, cashReconciliations, staffNotes,
    expenses, recurringExpenses,
    skuCounters, setSkuCounters, activityLog, lastBackup, settings,
    // connection status
    dbLoading, dbError, setDbError, reconnect,
    // Start the deferred subscriptions (time clock / reports / drop-offs data).
    // Idempotent — safe to call on every render of those views.
    enableExtendedData, enableCashData,
    // latest-snapshot refs
    deviceBuyersRef, dropOffsRef, settlementsRef, customersRef, salesTransactionsRef,
    repairsRef, repairBatchesRef, skuRef, dataRef,
  };
}
