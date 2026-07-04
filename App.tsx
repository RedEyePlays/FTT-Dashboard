
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LayoutDashboard, PlusCircle, Table, Activity, Sparkles, Moon, Sun, Lock, StickyNote, Settings, Calculator, Bot, MessageCircle, ShoppingCart, Search, Truck, ScrollText, Users as UsersIcon } from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { DataEntryForm } from './components/DataEntryForm';
import { DataGrid } from './components/DataGrid';
import { BulkEntryModal } from './components/BulkEntryModal';
import { AuthScreen } from './components/AuthScreen';
import { NotesBoard } from './components/NotesBoard';
import { SettingsModal } from './components/SettingsModal';
import { CalculatorTool } from './components/CalculatorTool';
import { AIChatView } from './components/AIChatView';
import { QuickSaleView } from './components/QuickSaleView';
import type { CartCheckout } from './components/CartSaleView';
import { FinderModal } from './components/FinderModal';
import { DropOffView } from './components/DropOffView';
import { InventoryView } from './components/InventoryView';
import { UsersView } from './components/UsersView';
import { AuditLogView } from './components/AuditLogView';
import { InventoryItem, ViewState, Note, Task, AppData, ChatMessage, Runner, DropOff, Settlement, ItemKind, DeviceType, ActivityEntry, Customer, SalesTransaction, AppUser, WorkspaceInvite, AuditEntry, Role, Permission } from './types';
import { skuPrefix, nextSku } from './services/sku';
import { can } from './services/rbac';
import { downloadJson, toCSV, triggerDownload } from './services/backup';
import { INITIAL_DATA } from './constants';
import { decryptData } from './services/security';
import { auth, db } from './services/firebase';
import { onAuthChange } from './services/auth';
import { User, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  subscribeCollection, subscribeMeta, saveMeta, saveItem, deleteItem, syncArray,
  logActivityDoc, commitSale, seedSampleData, migrateLegacyIfNeeded, CollName,
  getUserDoc, setUserDoc, updateUserDoc, subscribeWorkspaceUsers, getInvite, setInvite, deleteInvite,
  subscribeInvites, logAudit, exportWorkspaceData, recordBackup,
} from './services/firestoreDb';

const collFor = (i: InventoryItem): CollName => (i.kind ?? 'device') === 'accessory' ? 'accessories' : 'inventory';
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const mkActivity = (text: string): ActivityEntry => ({ id: newId(), ts: Date.now(), text });

const App: React.FC = () => {
  // --- AUTH STATE ---
  const [user, setUser] = useState<User | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // --- APP STATE ---
  const [view, setView] = useState<ViewState>('dashboard');

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
  const skuRef = useRef<Record<string, number>>({});
  const dataRef = useRef<InventoryItem[]>([]);
  useEffect(() => { runnersRef.current = runners; }, [runners]);
  useEffect(() => { dropOffsRef.current = dropOffs; }, [dropOffs]);
  useEffect(() => { settlementsRef.current = settlements; }, [settlements]);
  useEffect(() => { skuRef.current = skuCounters; }, [skuCounters]);
  useEffect(() => { dataRef.current = data; }, [data]);

  // AI Chat State (Shared between Sidebar and Tab)
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([{
      id: 'welcome',
      role: 'model',
      text: "Hello! I'm your inventory assistant. Ask me about your profits, sales trends, or help writing listings!",
      timestamp: new Date()
  }]);
  const [isAiSidebarOpen, setIsAiSidebarOpen] = useState(false);

  const [editingItem, setEditingItem] = useState<InventoryItem | undefined>(undefined);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showCalculator, setShowCalculator] = useState(false);
  const [showFinder, setShowFinder] = useState(false);

  // Theme State
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('bizTrackTheme') === 'dark';
    }
    return false;
  });

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

  // --- AUTH HANDLERS ---
  const handleAuthenticate = async (email: string, password: string, isRegister: boolean) => {
    setAuthError(null);
    try {
      if (isRegister) {
        await createUserWithEmailAndPassword(auth, email, password);
        // New accounts start empty; sample data can be seeded on demand.
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (e: any) {
      console.error(e);
      setAuthError(e.message || "Authentication failed");
    }
  };

  const handleLock = async () => {
    try { await signOut(auth); } catch (e) { console.error("Error signing out: ", e); }
  };

  // All shop writes target the workspace (owner's uid), so staff share one dataset.
  const uid = workspaceId;

  // Role-based permission check (mirrors the Firestore rules)
  const allow = (p: Permission) => can(appUser?.role, p, { allowProfit: appUser?.allowProfit });

  // Write an activity entry to Firestore (Recent Activity is generated from DB changes)
  const logActivity = (text: string) => { if (uid) logActivityDoc(uid, mkActivity(text)).catch(() => {}); };

  // Append an audit entry (who / what / before / after)
  const audit = (action: string, entityType: string, entityId?: string, before?: any, after?: any) => {
    if (!uid || !appUser) return;
    logAudit(uid, { id: newId(), ts: Date.now(), userId: appUser.id, userEmail: appUser.email, action, entityType, entityId, before, after }).catch(() => {});
  };

  // Seed sample data into Firestore (demo option only)
  const handleSeedSampleData = async () => {
    if (!uid || !allow('inventory.add')) return;
    await seedSampleData(uid, INITIAL_DATA);
    logActivity('Sample data loaded');
    audit('backup.seed', 'inventory');
  };


  // THEME HANDLING
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('bizTrackTheme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('bizTrackTheme', 'light');
    }
  }, [darkMode]);

  // --- Inventory writes go straight to Firestore; live subs update the UI ---
  const handleSaveItem = (item: InventoryItem) => {
    const isNew = !dataRef.current.some(i => i.id === item.id);
    if (uid && (isNew ? allow('inventory.add') : allow('inventory.edit'))) {
      if (isNew) { logActivity(`${item.sku || item.item || 'Item'} added`); audit('inventory.add', collFor(item), item.id, undefined, item); }
      else audit('inventory.edit', collFor(item), item.id);
      saveItem(uid, collFor(item), item);
    }
    setView('grid');
    setEditingItem(undefined);
  };

  const handleDeleteItem = (id: string) => {
    if (!uid || !allow('inventory.delete')) return;
    const target = dataRef.current.find(i => i.id === id);
    audit('inventory.delete', target ? collFor(target) : 'inventory', id, target);
    deleteItem(uid, target ? collFor(target) : 'inventory', id);
  };

  // Update single field (inline edit)
  const handleUpdateItem = (id: string, field: keyof InventoryItem, value: any) => {
    if (!uid || !allow('inventory.edit')) return;
    const target = dataRef.current.find(i => i.id === id);
    if (!target) return;
    const label = target.sku || target.item || id;
    if (field === 'deviceStatus') logActivity(`${label} marked ${String(value).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`);
    else if (field === 'quantity') { logActivity(`${label} quantity updated`); audit('accessory.quantity', collFor(target), id, { quantity: target.quantity }, { quantity: value }); }
    audit('inventory.edit', collFor(target), id, { [field]: (target as any)[field] }, { [field]: value });
    saveItem(uid, collFor(target), { ...target, [field]: value });
  };

  // Update an entire row
  const handleUpdateRow = (updatedItem: InventoryItem) => { if (uid && allow('inventory.edit')) saveItem(uid, collFor(updatedItem), updatedItem); };

  // Generate the next unique internal SKU for a kind/device type (never reused)
  const handleGenerateSku = (kind: ItemKind, deviceType?: DeviceType): string => {
    const prefix = skuPrefix(kind, deviceType);
    const { sku, counters } = nextSku(prefix, skuRef.current, dataRef.current);
    skuRef.current = counters;
    setSkuCounters(counters);
    if (uid) saveMeta(uid, { skuCounters: counters });
    return sku;
  };

  // Add or update a single inventory item (device or accessory) from InventoryView
  const handleSaveInventoryItem = (item: InventoryItem) => {
    if (!uid) return;
    const isNew = !dataRef.current.some(i => i.id === item.id);
    if (isNew ? !allow('inventory.add') : !allow('inventory.edit')) return;
    if (isNew) { logActivity(`${item.sku || item.item || 'Item'} added`); audit('inventory.add', collFor(item), item.id, undefined, item); }
    else audit('inventory.edit', collFor(item), item.id);
    saveItem(uid, collFor(item), item);
  };

  // Sell a cart: mark devices sold in Firestore, decrement accessory quantities,
  // create a sales transaction + customer, log activity — one atomic commit.
  const handleSellCart = (payload: CartCheckout) => {
    if (!uid || !allow('sales.complete')) return;
    audit('sale.complete', 'sale', payload.transaction.id, undefined, { totalPaid: payload.transaction.totalPaid, lines: payload.transaction.lines.length });
    const accessoryUpdates = Object.entries(payload.accessoryQtys).map(([id, soldQty]) => {
      const acc = dataRef.current.find(i => i.id === id);
      return { id, quantity: Math.max(0, (acc?.quantity ?? 0) - soldQty) };
    });
    const activity: ActivityEntry[] = [
      ...payload.soldRows.map(d => mkActivity(`${d.sku || d.item} sold to ${d.customerName || d.soldTo || 'customer'}`)),
      ...Object.keys(payload.accessoryQtys).map(id => {
        const a = dataRef.current.find(i => i.id === id); return mkActivity(`${a?.sku || 'Accessory'} quantity updated`);
      }),
    ];
    commitSale(uid, { soldRows: payload.soldRows, accessoryUpdates, transaction: payload.transaction, customer: payload.customer, activity }).catch(e => console.error('Sale commit failed', e));

    // Custom items opted into inventory: fill a real SKU and persist to the right collection
    (payload.newInventoryItems || []).forEach(item => {
      const kind: ItemKind = (item.kind ?? 'device');
      const withSku = item.sku ? item : { ...item, sku: handleGenerateSku(kind, item.deviceType) };
      saveItem(uid, collFor(withSku), withSku);
      logActivity(`${withSku.sku || withSku.item} added from custom sale`);
    });
  };

  const handleBulkImport = (items: InventoryItem[]) => {
    if (uid) items.forEach(it => saveItem(uid, collFor(it), it));
    setView('grid');
  };

  const handleRestoreData = async (restoredData: AppData) => {
    if (!uid || !allow('settings.manage')) return;
    const inv = restoredData.inventory || [];
    await syncArray(uid, 'inventory', inv.filter(i => (i.kind ?? 'device') === 'device'), dataRef.current.filter(i => (i.kind ?? 'device') === 'device'));
    await syncArray(uid, 'accessories', inv.filter(i => i.kind === 'accessory'), dataRef.current.filter(i => i.kind === 'accessory'));
    await syncArray(uid, 'runners', restoredData.runners || [], runnersRef.current);
    await syncArray(uid, 'dropOffs', restoredData.dropOffs || [], dropOffsRef.current);
    await syncArray(uid, 'settlements', restoredData.settlements || [], settlementsRef.current);
    await saveMeta(uid, { notes: restoredData.notes || [], tasks: restoredData.tasks || [], skuCounters: restoredData.skuCounters || {} });
  };

  // Add an accepted drop-off into inventory, carrying runner + cost across
  const handleAddDropOffToInventory = (d: DropOff) => {
    if (!uid) return;
    const runner = runnersRef.current.find(r => r.id === d.runnerId);
    const newItem: InventoryItem = {
      id: newId(), kind: 'device', date: d.dateDropped || new Date().toISOString().split('T')[0],
      item: d.item, imei: d.imei, boughtFrom: d.sellerName || 'Marketplace (drop-off)',
      purchaseCost: d.purchasePrice, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0,
      deviceStatus: 'ready', runnerId: d.runnerId, runnerName: runner?.name, dropOffId: d.id,
      notes: d.notes ? `Drop-off: ${d.notes}` : 'Added from drop-off',
    };
    saveItem(uid, 'inventory', newItem);
    saveItem(uid, 'dropOffs', { ...d, inventoryId: newItem.id });
    logActivity(`${newItem.item} added from drop-off`);
    audit('dropoff.accept', 'dropOff', d.id, undefined, { inventoryId: newItem.id });
  };

  // Persisted notes/tasks (meta) + array-synced runner data
  const saveNotes = (n: Note[]) => { setNotes(n); if (uid) saveMeta(uid, { notes: n }); };
  const saveTasks = (t: Task[]) => { setTasks(t); if (uid) saveMeta(uid, { tasks: t }); };
  const saveRunners = (r: Runner[]) => { if (uid && allow('dropoffs.manage')) { syncArray(uid, 'runners', r, runnersRef.current); audit('runner.edit', 'runner'); } };
  const saveDropOffs = (d: DropOff[]) => { if (uid && allow('dropoffs.manage')) { syncArray(uid, 'dropOffs', d, dropOffsRef.current); audit('dropoff.edit', 'dropOff'); } };
  const saveSettlements = (s: Settlement[]) => { if (uid && allow('dropoffs.manage')) { syncArray(uid, 'settlements', s, settlementsRef.current); audit('dropoff.settle', 'settlement'); } };

  // --- Users / roles management (Owner only) ---
  const handleSetRole = (targetUid: string, role: Role) => {
    if (!allow('users.manage') || targetUid === appUser?.id) return;
    const before = workspaceUsers.find(u => u.id === targetUid)?.role;
    updateUserDoc(targetUid, { role }).catch(() => {});
    audit('user.role_change', 'user', targetUid, { role: before }, { role });
  };
  const handleSetDisabled = (targetUid: string, disabled: boolean) => {
    if (!allow('users.manage') || targetUid === appUser?.id) return;
    updateUserDoc(targetUid, { disabled }).catch(() => {});
    audit(disabled ? 'user.disable' : 'user.enable', 'user', targetUid);
  };
  const handleSetAllowProfit = (targetUid: string, allowProfit: boolean) => {
    if (!allow('users.manage')) return;
    updateUserDoc(targetUid, { allowProfit }).catch(() => {});
    audit('user.allow_profit', 'user', targetUid, undefined, { allowProfit });
  };
  const handleInvite = (email: string, role: Role) => {
    if (!allow('users.manage') || !workspaceId) return;
    const inv: WorkspaceInvite = { id: email.toLowerCase(), email: email.toLowerCase(), workspaceId, role, invitedBy: appUser?.email, createdAt: Date.now() };
    setInvite(inv).catch(() => {});
    audit('user.invite', 'user', email, undefined, { role });
  };
  const handleDeleteInvite = (email: string) => { if (allow('users.manage')) deleteInvite(email).catch(() => {}); };

  // --- Backups (Owner only) ---
  const handleExportJson = async () => {
    if (!uid || !allow('backup.export')) return;
    const dump = await exportWorkspaceData(uid);
    downloadJson(`ftt-backup-${new Date().toISOString().split('T')[0]}.json`, { exportedAt: new Date().toISOString(), workspaceId: uid, data: dump });
    await recordBackup(uid, Date.now());
    audit('backup.export', 'backup', undefined, undefined, { format: 'json' });
  };
  const handleExportCsv = async () => {
    if (!uid || !allow('backup.export')) return;
    const dump = await exportWorkspaceData(uid);
    Object.entries(dump).forEach(([name, rows]) => { if (rows.length) triggerDownload(`ftt-${name}-${new Date().toISOString().split('T')[0]}.csv`, toCSV(rows), 'text/csv;charset=utf-8;'); });
    await recordBackup(uid, Date.now());
    audit('backup.export', 'backup', undefined, undefined, { format: 'csv' });
  };

  const handleStartAdd = () => {
    setEditingItem(undefined);
    setView('entry');
  };

  const NavButton: React.FC<{ 
    active: boolean; 
    icon: React.ReactNode; 
    label: string; 
    onClick: () => void 
  }> = ({ active, icon, label, onClick }) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
        active 
          ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:ring-indigo-700' 
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
      }`}
    >
      {icon}
      {label}
    </button>
  );

  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-slate-950 text-slate-500">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  // --- RENDER LOCK SCREEN IF LOCKED ---
  if (!user) {
    return (
      <AuthScreen
        onAuthenticate={handleAuthenticate}
        error={authError}
      />
    );
  }

  // --- FIRESTORE CONNECTION STATES ---
  if (dbError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-50 dark:bg-slate-950 text-center px-6">
        <div className="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center text-rose-500 text-2xl">!</div>
        <div>
          <p className="text-lg font-bold text-slate-800 dark:text-slate-100">Couldn't reach the database</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-md">{dbError}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setDbError(null); setDbLoading(true); setReconnectKey(k => k + 1); }} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">Retry</button>
          <button onClick={handleLock} className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg text-sm font-medium">Sign out</button>
        </div>
      </div>
    );
  }
  if (roleLoading || dbLoading || !appUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-slate-950 text-slate-500">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">{roleLoading || !appUser ? 'Signing you in…' : 'Loading your inventory…'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 pb-20 flex flex-col transition-colors duration-200 relative">
      {/* Header */}
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 sticky top-0 z-20 shadow-sm shrink-0">
        <div className="w-full px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-indigo-600 p-2 rounded-lg shadow-lg shadow-indigo-500/30">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-700 to-violet-700 dark:from-indigo-400 dark:to-violet-400">
              FlipThatTech Dashboard
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
               <Lock className="w-3 h-3" /> Secure
            </span>
          </div>
          <nav className="hidden md:flex items-center gap-2">
            <NavButton 
              active={view === 'dashboard'} 
              icon={<LayoutDashboard className="w-4 h-4" />} 
              label="Dashboard" 
              onClick={() => setView('dashboard')} 
            />
            <NavButton 
              active={view === 'grid'} 
              icon={<Table className="w-4 h-4" />} 
              label="Inventory"
              onClick={() => setView('grid')} 
            />
            <NavButton 
              active={view === 'notes'} 
              icon={<StickyNote className="w-4 h-4" />} 
              label="Notes" 
              onClick={() => setView('notes')} 
            />
            <NavButton
              active={view === 'pos'}
              icon={<ShoppingCart className="w-4 h-4" />}
              label="Quick Sale"
              onClick={() => setView('pos')}
            />
            {allow('dropoffs.manage') && (
              <NavButton
                active={view === 'dropoff'}
                icon={<Truck className="w-4 h-4" />}
                label="Drop-Offs"
                onClick={() => setView('dropoff')}
              />
            )}
            {allow('audit.view') && (
              <NavButton
                active={view === 'audit'}
                icon={<ScrollText className="w-4 h-4" />}
                label="Audit"
                onClick={() => setView('audit')}
              />
            )}
            {allow('users.manage') && (
              <NavButton
                active={view === 'users'}
                icon={<UsersIcon className="w-4 h-4" />}
                label="Users"
                onClick={() => setView('users')}
              />
            )}
            <NavButton
              active={view === 'ai'}
              icon={<Bot className="w-4 h-4" />}
              label="AI Assistant"
              onClick={() => setView('ai')}
            />

            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-2"></div>

            <span className="hidden lg:inline text-xs text-slate-400 mr-1" title={appUser.email}>{appUser.email.split('@')[0]} · {appUser.role}</span>

            <button
              onClick={() => setShowFinder(true)}
              className="p-2 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
              title="Find item (Finder)"
            >
              <Search className="w-4 h-4" />
            </button>

            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Toggle Theme"
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            
            <button
              onClick={() => setIsAiSidebarOpen(!isAiSidebarOpen)}
              className={`p-2 rounded-lg transition-colors ${isAiSidebarOpen ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' : 'text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'}`}
              title="Quick AI Chat"
            >
              <MessageCircle className="w-4 h-4" />
            </button>

            <button
              onClick={() => setShowCalculator(!showCalculator)}
              className={`p-2 rounded-lg transition-colors ${showCalculator ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' : 'text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'}`}
              title="Profit Calculator"
            >
              <Calculator className="w-4 h-4" />
            </button>

            <button
              onClick={() => setShowSettingsModal(true)}
              className="p-2 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
              title="Settings & Backup"
            >
              <Settings className="w-4 h-4" />
            </button>
            
            <button
              onClick={handleLock}
              className="p-2 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
              title="Lock App"
            >
              <Lock className="w-4 h-4" />
            </button>

            <button
              onClick={() => setShowBulkModal(true)}
              className="flex items-center gap-2 px-3 py-2 text-indigo-600 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-900/20 rounded-lg text-sm font-medium transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              AI Bulk Add
            </button>
            <button
              onClick={handleStartAdd}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors shadow-sm ml-2"
            >
              <PlusCircle className="w-4 h-4" />
              Add Item
            </button>
          </nav>
        </div>
      </header>

      {/* Mobile Navigation */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-2 flex justify-around z-50">
         <button 
           onClick={() => setView('dashboard')}
           className={`flex flex-col items-center p-2 rounded-lg ${view === 'dashboard' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}
         >
           <LayoutDashboard className="w-6 h-6" />
           <span className="text-[10px] mt-1">Dash</span>
         </button>
         <button 
           onClick={() => setView('grid')}
           className={`flex flex-col items-center p-2 rounded-lg ${view === 'grid' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}
         >
           <Table className="w-6 h-6" />
           <span className="text-[10px] mt-1">Sheet</span>
         </button>
         <button
           onClick={() => setView('pos')}
           className={`flex flex-col items-center p-2 rounded-lg ${view === 'pos' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}
         >
           <ShoppingCart className="w-6 h-6" />
           <span className="text-[10px] mt-1">Sell</span>
         </button>
         <button
           onClick={handleStartAdd}
           className={`flex flex-col items-center p-2 rounded-lg ${view === 'entry' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}
         >
           <PlusCircle className="w-6 h-6" />
           <span className="text-[10px] mt-1">Add</span>
         </button>
         <button 
           onClick={() => setIsAiSidebarOpen(true)}
           className={`flex flex-col items-center p-2 rounded-lg ${view === 'ai' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}
         >
           <Bot className="w-6 h-6" />
           <span className="text-[10px] mt-1">AI</span>
         </button>
         <button 
           onClick={() => setShowCalculator(!showCalculator)}
           className={`flex flex-col items-center p-2 rounded-lg ${showCalculator ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'}`}
         >
           <Calculator className="w-6 h-6" />
           <span className="text-[10px] mt-1">Calc</span>
         </button>
      </div>

      {/* Main Content */}
      <main className={`mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full flex flex-col ${view === 'grid' || view === 'ai' ? 'max-w-[98%]' : 'max-w-7xl'}`}>
        <div className="animate-fadeIn flex-1 flex flex-col">
          {view === 'dashboard' && (
            allow('reports.view')
              ? <Dashboard data={data} darkMode={darkMode} canViewProfit={allow('reports.profit')} />
              : <div className="text-center text-slate-400 py-20">You don't have access to reports.</div>
          )}
          {(view === 'entry' || view === 'edit') && (
            <DataEntryForm 
              initialData={editingItem} 
              onSave={handleSaveItem} 
              onCancel={() => setView('grid')} 
            />
          )}
          {view === 'grid' && (
            <InventoryView
              inventory={data}
              runners={runners}
              activity={activityLog}
              onSave={handleSaveInventoryItem}
              onUpdate={handleUpdateItem}
              onDelete={handleDeleteItem}
              onGenerateSku={handleGenerateSku}
              onSeed={handleSeedSampleData}
            />
          )}
          {view === 'pos' && (
            <QuickSaleView
              inventory={data}
              onSellCart={handleSellCart}
            />
          )}
          {view === 'dropoff' && (
            <DropOffView
              runners={runners}
              dropOffs={dropOffs}
              settlements={settlements}
              onRunnersChange={saveRunners}
              onDropOffsChange={saveDropOffs}
              onSettlementsChange={saveSettlements}
              onAddToInventory={handleAddDropOffToInventory}
            />
          )}
          {view === 'notes' && (
            <NotesBoard
              notes={notes}
              tasks={tasks}
              onUpdateNotes={saveNotes}
              onUpdateTasks={saveTasks}
            />
          )}
          {view === 'ai' && (
            <AIChatView
               inventory={data}
               messages={aiMessages}
               onUpdateMessages={setAiMessages}
            />
          )}
          {view === 'users' && allow('users.manage') && (
            <UsersView
              me={appUser}
              users={workspaceUsers}
              invites={invites}
              onSetRole={handleSetRole}
              onSetDisabled={handleSetDisabled}
              onSetAllowProfit={handleSetAllowProfit}
              onInvite={handleInvite}
              onDeleteInvite={handleDeleteInvite}
            />
          )}
          {view === 'audit' && allow('audit.view') && (
            <AuditLogView logs={auditLogs} users={workspaceUsers} />
          )}
        </div>
      </main>

      {/* AI Sidebar Overlay */}
      {isAiSidebarOpen && (
        <>
          <div 
             className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-[45]"
             onClick={() => setIsAiSidebarOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 w-full sm:w-96 bg-white dark:bg-slate-900 shadow-2xl z-[50] animate-slideInRight flex flex-col border-l border-slate-200 dark:border-slate-800">
             <AIChatView 
                inventory={data} 
                messages={aiMessages}
                onUpdateMessages={setAiMessages}
                variant="sidebar"
                onClose={() => setIsAiSidebarOpen(false)}
             />
          </div>
        </>
      )}

      {/* Calculator Overlay */}
      {showCalculator && <CalculatorTool onClose={() => setShowCalculator(false)} />}

      {/* Modals */}
      {showBulkModal && (
        <BulkEntryModal 
          onClose={() => setShowBulkModal(false)} 
          onImport={handleBulkImport} 
        />
      )}
      
      {showSettingsModal && (
         <SettingsModal
           onClose={() => setShowSettingsModal(false)}
           currentData={{ inventory: data, notes, tasks }}
           onRestore={handleRestoreData}
           canManageSettings={allow('settings.manage')}
           backup={allow('backup.export') ? { lastBackup, onExportJson: handleExportJson, onExportCsv: handleExportCsv } : undefined}
         />
      )}

      {showFinder && (
        <FinderModal
          inventory={data}
          onClose={() => setShowFinder(false)}
          onEdit={item => { setEditingItem(item); setView('edit'); }}
        />
      )}
    </div>
  );
};

export default App;
