
import React, { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { DataEntryForm } from './components/DataEntryForm';
import { AuthScreen } from './components/AuthScreen';
import { SettingsModal, cacheLabelSizes, cacheStoreProfile } from './components/SettingsModal';
import type { CartCheckout } from './components/CartSaleView';
import { GlobalSearch } from './components/GlobalSearch';

// Code-splitting: every page-level view loads on demand as its own chunk (each
// route only downloads the JS it renders) instead of bloating the initial
// bundle. They all render inside the single <Suspense> boundary below. Named
// exports are unwrapped to default for React.lazy.
const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));
const QuickSaleView = lazy(() => import('./components/QuickSaleView').then(m => ({ default: m.QuickSaleView })));
const QuickPurchaseView = lazy(() => import('./components/QuickPurchaseView').then(m => ({ default: m.QuickPurchaseView })));
const InventoryView = lazy(() => import('./components/InventoryView').then(m => ({ default: m.InventoryView })));
const RepairsView = lazy(() => import('./components/RepairsView').then(m => ({ default: m.RepairsView })));
const TechRepairsView = lazy(() => import('./components/TechRepairsView').then(m => ({ default: m.TechRepairsView })));
const CustomersView = lazy(() => import('./components/CustomersView').then(m => ({ default: m.CustomersView })));
const OwnerAnalytics = lazy(() => import('./components/OwnerAnalytics').then(m => ({ default: m.OwnerAnalytics })));
const ReportsView = lazy(() => import('./components/ReportsView').then(m => ({ default: m.ReportsView })));
const LogCashMovementModal = lazy(() => import('./components/LogCashMovementModal').then(m => ({ default: m.LogCashMovementModal })));
const BulkEntryModal = lazy(() => import('./components/BulkEntryModal').then(m => ({ default: m.BulkEntryModal })));
const NotesBoard = lazy(() => import('./components/NotesBoard').then(m => ({ default: m.NotesBoard })));
const SettingsView = lazy(() => import('./components/SettingsView').then(m => ({ default: m.SettingsView })));
const BackupPanel = lazy(() => import('./components/BackupPanel').then(m => ({ default: m.BackupPanel })));
const CalculatorTool = lazy(() => import('./components/CalculatorTool').then(m => ({ default: m.CalculatorTool })));
const AIChatView = lazy(() => import('./components/AIChatView').then(m => ({ default: m.AIChatView })));
import { SearchData, SearchResult, SearchPage } from './domain/search';
const DropOffView = lazy(() => import('./components/DropOffView').then(m => ({ default: m.DropOffView })));
const UsersView = lazy(() => import('./components/UsersView').then(m => ({ default: m.UsersView })));
const AuditLogView = lazy(() => import('./components/AuditLogView').then(m => ({ default: m.AuditLogView })));
const TimeClockView = lazy(() => import('./components/TimeClockView').then(m => ({ default: m.TimeClockView })));
const CloseOutView = lazy(() => import('./components/CloseOutView').then(m => ({ default: m.CloseOutView })));
import { InventoryItem, ViewState, Note, Task, AppData, ChatMessage, Runner, DropOff, Settlement, ItemKind, DeviceType, ActivityEntry, Customer, WorkspaceInvite, Role, Permission, Repair, RepairBatch, TimeEntry, PayPeriodPaid, BreakReason, SalesTransaction, CashReconciliation, StaffNote } from './types';
import { skuPrefix, nextSku } from './services/sku';
import { REPAIR_PREFIX, BATCH_PREFIX, applyTechEdit, TECH_EDITABLE_FIELDS, repairSalePrefill, completeRepair, completeRepairSale, dateToEpochMs } from './domain/repairs';
import { MergePlan } from './domain/customers';
import { can } from './services/rbac';
import { downloadJson, toCSV, triggerDownload } from './services/backup';
import { INITIAL_DATA } from './constants';
import { auth } from './services/firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { LockScreen } from './components/LockScreen';
import { useInactivityTimer } from './hooks/useInactivityTimer';
import { hashPin, verifyPin, canAssignPin, isValidPinFormat } from './domain/pin';
import {
  saveMeta, saveItem, deleteItem, syncArray, allocateSku,
  logActivityDoc, commitSale, voidSale, returnSale, saveCashReconciliation, seedSampleData,
  updateUserDoc, setInvite, deleteInvite,
  logAudit, exportWorkspaceData, recordBackup, saveSettings,
  saveTimeEntry, savePayPeriodPaid, deletePayPeriodPaid,
  saveStaffNote, deleteStaffNote, commitAutoInventory, settleRunner,
} from './services/firestoreDb';
import { decideAutoInventory, autoInventoryPurchaseDrawerEffect, AutoInventoryNotice } from './domain/autoInventory';
import { buildQuickPurchaseItem, quickPurchaseDrawerEffect } from './domain/quickPurchase';
import type { QuickPurchaseSaveInput } from './components/QuickPurchaseView';
import { listingPlatformsLabel } from './domain/listing';
import { AppSettings } from './domain/settings';
import { listWorkspaceBackups, getBackupDownloadUrl } from './services/backupStorage';
import { techUpdateRepair } from './services/repairFunctions';
import { useWorkspaceData } from './hooks/useWorkspaceData';
import { newId, mkActivity } from './domain/ids';
import { collectionFor, stockChange, applyDirectSale } from './domain/inventory';
import { canVoidSale, canReturnSale, returnRefund, saleAccessoryRestock, saleDeviceListedPlatforms, collectedOnSale, cashCollectedOnSale, saleRefundDrawerEffect } from './domain/pos';
import { expectedCashForDate, expectedEndingCash, sumDrawerEntries, cashDrawerSummary, openDrawerPatch, ReconciliationInput } from './domain/reports';
import type { CashMovementKind } from './components/LogCashMovementModal';
const OpenDrawerModal = lazy(() => import('./components/OpenDrawerModal').then(m => ({ default: m.OpenDrawerModal })));
const CloseDrawerModal = lazy(() => import('./components/CloseDrawerModal').then(m => ({ default: m.CloseDrawerModal })));
import { openEntryFor, isOnBreak, periodPayFor, paidKey, toISODate, PayPeriod, correctClockOut, isValidClockOutCorrection } from './domain/timeclock';
import { buildAlerts } from './domain/alerts';
import { changedSettingsSections } from './domain/audit';
import { dropOffPurchaseCost, settlementDrawerEffect, dropOffAcceptDrawerEffect } from './domain/dropoffs';
import { InvSection, DEFAULT_INV_SECTION, invPath, parseInvPath } from './domain/inventoryNav';
import { viewPath, parseViewPath, isRoutableView } from './domain/appNav';
import { AppHeader } from './components/AppHeader';
import { MobileNav } from './components/MobileNav';
import { MobileDrawer } from './components/MobileDrawer';
import { Calculator } from 'lucide-react';
import { useIsMobile } from './hooks/useMediaQuery';

// Page titles for the mobile header bar.
const PAGE_TITLES: Record<ViewState, string> = {
  dashboard: 'Dashboard', analytics: 'Analytics', reports: 'Reports', entry: 'Add Item', edit: 'Edit Item',
  grid: 'Inventory', notes: 'Notes', ai: 'AI Assistant', pos: 'Checkout', quickpurchase: 'Quick Purchase', dropoff: 'Drop-Offs',
  repairs: 'Repairs', customers: 'Customers', users: 'Users', audit: 'Audit Log',
  settings: 'Settings', timeclock: 'Time Clock', closeout: 'Close Out',
};
import { LoadingScreen, LoadingSkeleton, DbErrorScreen } from './components/StatusScreens';

// Suspense fallback for lazily-loaded views — reuses LoadingScreen's spinner
// style, but sized to sit inside the content area rather than full-screen.
const ViewLoader: React.FC = () => (
  <div className="flex-1 flex items-center justify-center py-20">
    <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

const App: React.FC = () => {
  // --- DATA LAYER (auth, role/workspace, Firestore subscriptions) ---
  const {
    user, isLoadingAuth, authError, setAuthError,
    appUser, roleLoading, workspaceId, workspaceUsers, invites, auditLogs, loadMoreAuditLogs, auditHasMore,
    data, notes, setNotes, tasks, setTasks,
    runners, dropOffs, settlements, salesTransactions, customers, repairs, repairBatches,
    timeEntries, payPeriods, cashReconciliations, staffNotes,
    skuCounters, setSkuCounters, activityLog, lastBackup, settings,
    dbLoading, dbError, reconnect, enableExtendedData, enableCashData,
    runnersRef, dropOffsRef, settlementsRef, customersRef, salesTransactionsRef,
    repairsRef, repairBatchesRef, skuRef, dataRef,
  } = useWorkspaceData();

  // --- UI STATE ---
  const [view, setView] = useState<ViewState>('dashboard');
  // Load the deferred collections (time entries, pay periods, cash
  // reconciliations, drop-offs, settlements) the first time the user opens a view
  // that needs them. Idempotent; once enabled it stays for the session.
  useEffect(() => {
    if (view === 'timeclock' || view === 'reports' || view === 'dropoff') enableExtendedData();
  }, [view, enableExtendedData]);
  // Active Inventory sub-section, mirrored to the URL (/inventory/<section>).
  const [invSection, setInvSection] = useState<InvSection>(DEFAULT_INV_SECTION);
  // A customer to pre-seed the POS / Repairs view with (from a CRM quick action).
  const [prefillCustomer, setPrefillCustomer] = useState<Customer | undefined>(undefined);
  // A new, prefilled repair to open in the Repairs view (e.g. an internal repair
  // started from an inventory device row).
  const [prefillRepair, setPrefillRepair] = useState<Repair | undefined>(undefined);
  // A retail repair being checked out through Quick Sale (Repairs → Check Out).
  // Seeds the POS cart with the repair's service line + customer; on sale commit
  // the repair is stamped complete and linked to the transaction.
  const [prefillRepairSale, setPrefillRepairSale] = useState<Repair | undefined>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Deep-link targets from Global Search (open a specific record on the target view).
  const [focusRepairId, setFocusRepairId] = useState<string | undefined>(undefined);
  const [focusCustomerId, setFocusCustomerId] = useState<string | undefined>(undefined);

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
  const isMobile = useIsMobile();
  // Cash drawer UI: which movement kind to log (null = closed), and the
  // open-drawer modal. Both live on the POS screen where cash is handled.
  const [cashLogKind, setCashLogKind] = useState<CashMovementKind | null>(null);
  const [showOpenDrawer, setShowOpenDrawer] = useState(false);
  const [showCloseDrawer, setShowCloseDrawer] = useState(false);
  const [showFinder, setShowFinder] = useState(false);

  // Theme State
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('bizTrackTheme') === 'dark';
    }
    return false;
  });

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
    setAppLocked(false); // signing out fully — nothing to stay "locked" over
    try { await signOut(auth); } catch (e) { console.error("Error signing out: ", e); }
  };

  // --- AUTO-LOCK (inactivity) ------------------------------------------------
  // A lock OVERLAY, not a sign-out: the authenticated session stays intact, the
  // rest of the app just isn't rendered while `appLocked` is true (see the
  // early return near the bottom). Persisted to sessionStorage so a refresh (or
  // the browser back button, which only changes in-app view state) can't drop
  // back into the app without re-entering the PIN/password — the locked flag is
  // read back out BEFORE the first paint via the lazy useState initializer.
  const APP_LOCK_KEY = 'bizTrackAppLocked';
  const [appLocked, setAppLocked] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try { return sessionStorage.getItem(APP_LOCK_KEY) === '1'; } catch { return false; }
  });
  useEffect(() => {
    try {
      if (appLocked) sessionStorage.setItem(APP_LOCK_KEY, '1');
      else sessionStorage.removeItem(APP_LOCK_KEY);
    } catch { /* storage unavailable (e.g. private mode) — lock still works in-memory */ }
  }, [appLocked]);
  // A signed-out session should never resurrect a stale lock on the next login.
  useEffect(() => { if (!user) setAppLocked(false); }, [user]);

  useInactivityTimer(
    settings.operations.autoLockMinutes,
    !!appUser && !appLocked,
    () => setAppLocked(true),
  );

  // PIN unlock: verify client-side against the user's own stored hash+salt
  // (already synced locally — this is the account's own doc, always self-
  // readable). No network round trip, no plaintext PIN ever leaves the device.
  const handleUnlockWithPin = async (pin: string): Promise<boolean> => {
    if (!appUser?.pinHash || !appUser.pinSalt) return false;
    const ok = await verifyPin(pin, { hash: appUser.pinHash, salt: appUser.pinSalt, iterations: appUser.pinIterations || 0 });
    if (ok) setAppLocked(false);
    return ok;
  };

  // Fallback unlock when no PIN is set: re-verify the real Firebase Auth
  // credential (reauthenticate, not sign in) so the session/token are
  // untouched — this only proves "still you", it doesn't start a new session.
  const handleUnlockWithPassword = async (password: string): Promise<boolean> => {
    if (!auth.currentUser || !appUser) return false;
    try {
      await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(appUser.email, password));
      setAppLocked(false);
      return true;
    } catch {
      return false;
    }
  };

  // Owner/manager sets or updates a PIN for a user strictly below their role
  // rank (never a peer or above — see domain/pin.ts canAssignPin). Hashed
  // client-side before it ever touches the network; the plaintext PIN is
  // discarded the moment this returns.
  const handleSetPin = async (targetUid: string, pin: string): Promise<boolean> => {
    if (!appUser || !allow('users.pin') || !isValidPinFormat(pin)) return false;
    const target = workspaceUsers.find(u => u.id === targetUid);
    if (!target || !canAssignPin(appUser.role, target.role)) return false;
    const { hash, salt, iterations } = await hashPin(pin);
    await updateUserDoc(targetUid, {
      pinHash: hash, pinSalt: salt, pinIterations: iterations,
      pinUpdatedAt: Date.now(), pinUpdatedBy: appUser.id, pinUpdatedByEmail: appUser.email,
    }).catch(() => { throw new Error('save-failed'); });
    audit('user.set_pin', 'user', targetUid, undefined, { email: target.email });
    return true;
  };

  // Gated by security.manage (owner + manager) rather than routed through
  // handleSaveSettings, which is owner-only (settings.manage) — a manager may
  // change this one operational field without unlocking the rest of Settings.
  const handleSetAutoLockMinutes = (minutes: number) => {
    if (!uid || !allow('security.manage')) return;
    const before = settings.operations.autoLockMinutes;
    const after = Math.max(0, Math.round(minutes));
    const next: AppSettings = { ...settings, operations: { ...settings.operations, autoLockMinutes: after } };
    saveSettings(uid, next).catch(() => {});
    audit('settings.update', 'settings', 'app', { autoLockMinutes: before }, { autoLockMinutes: after });
  };

  // All shop writes target the workspace (owner's uid), so staff share one dataset.
  const uid = workspaceId;

  // Role-based permission check (mirrors the Firestore rules)
  const allow = (p: Permission) => can(appUser?.role, p, { allowProfit: appUser?.allowProfit });

  // The register cash drawer lives on POS (not just Reports), so load cash
  // reconciliations for anyone who can handle cash the moment they're on POS —
  // and on Reports. Without this the drawer summary is blank and Open Drawer /
  // cash-log writes have no live record to read-modify-write against.
  // Drop-Off is included too: settling a runner in cash writes a cashOut entry
  // to today's drawer record (handleSettleRunner, via commitDrawerRecord) —
  // without cashReconciliations already loaded, commitDrawerRecord's merge
  // would build off an empty local record and overwrite the real one (opening
  // float and all) with a stripped-down doc containing only that one entry.
  const canLogCash = allow('cash.log');
  const canManageDropoffs = allow('dropoffs.manage');
  useEffect(() => {
    if (view === 'reports' || (view === 'pos' && canLogCash) || (view === 'dropoff' && canManageDropoffs)) enableCashData();
  }, [view, canLogCash, canManageDropoffs, enableCashData]);

  // Write an activity entry to Firestore (Recent Activity is generated from DB changes)
  const logActivity = (text: string) => { if (uid) logActivityDoc(uid, mkActivity(text)).catch(() => {}); };

  // Append an audit entry (who / what / before / after)
  const audit = (action: string, entityType: string, entityId?: string, before?: any, after?: any) => {
    if (!uid || !appUser) return;
    logAudit(uid, { id: newId(), ts: Date.now(), userId: appUser.id, userEmail: appUser.email, action, entityType, entityId, before, after }).catch(() => {});
  };

  // --- Global Search: permission-scoped data (empty categories = no results) ---
  const canAnalytics = (appUser?.role === 'owner' || appUser?.role === 'manager') && allow('reports.profit.detailed');
  const searchPages: SearchPage[] = useMemo(() => {
    const p: SearchPage[] = [{ id: 'dashboard', label: 'Dashboard', keywords: 'home overview', view: 'dashboard' }];
    if (canAnalytics) p.push({ id: 'analytics', label: 'Analytics', keywords: 'reports owner profit', view: 'analytics' });
    p.push({ id: 'grid', label: 'Inventory', keywords: 'stock devices accessories', view: 'grid' });
    p.push({ id: 'pos', label: 'Checkout', keywords: 'sell quick sale pos sales', view: 'pos' });
    if (allow('inventory.add')) p.push({ id: 'quickpurchase', label: 'Quick Purchase', keywords: 'buy purchase device counter cash', view: 'quickpurchase' });
    if (allow('repairs.tech')) p.push({ id: 'repairs', label: 'Repairs', keywords: 'tickets', view: 'repairs' });
    if (allow('timeclock.use')) p.push({ id: 'timeclock', label: 'Time Clock', keywords: 'clock in out hours shift break payroll pay', view: 'timeclock' });
    if (allow('closeout.view')) p.push({ id: 'closeout', label: 'Close Out', keywords: 'end of day summary lock up reconcile', view: 'closeout' });
    if (allow('reports.view')) p.push({ id: 'customers', label: 'Customers', keywords: 'crm clients', view: 'customers' });
    if (allow('dropoffs.manage')) p.push({ id: 'dropoff', label: 'Drop-Offs', view: 'dropoff' });
    if (allow('audit.view')) p.push({ id: 'audit', label: 'Audit Log', view: 'audit' });
    if (allow('users.tech')) p.push({ id: 'users', label: 'Users', keywords: 'staff roles permissions', view: 'users' });
    p.push({ id: 'notes', label: 'Notes', view: 'notes' });
    if (allow('reports.profit.summary')) p.push({ id: 'ai', label: 'AI Assistant', view: 'ai' });
    p.push({ id: 'labels', label: 'Labels', keywords: 'print qr barcode', view: 'grid' });
    p.push({ id: 'settings', label: 'Settings', keywords: 'backup preferences', action: 'settings' });
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUser?.role, appUser?.allowProfit]);

  const searchData: SearchData = useMemo(() => ({
    inventory: data,
    repairs: allow('repairs.tech') ? repairs : [],
    batches: [],
    customers: allow('reports.view') ? customers : [],
    sales: allow('reports.view') ? salesTransactions : [],
    users: allow('users.tech') ? workspaceUsers : [],
    pages: searchPages,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [data, repairs, customers, salesTransactions, workspaceUsers, searchPages, appUser?.role, appUser?.allowProfit]);

  // Standing, actionable alerts for the notifications menu (low stock, overdue /
  // unclaimed repairs). Derived from live data already in memory.
  const alerts = useMemo(() => buildAlerts({ inventory: data, repairs, now: Date.now(), agingDays: settings.operations.agingInventoryDays }), [data, repairs, settings.operations.agingInventoryDays]);

  // Per-user notification read state persists on the user doc, so it follows the
  // staff member across devices instead of living in this browser's localStorage.
  const handleMarkNotificationsSeen = (ts: number) => {
    if (appUser) updateUserDoc(appUser.id, { notifSeenTs: ts }).catch(() => {});
  };

  const handleSearchSelect = (r: SearchResult) => {
    setShowFinder(false);
    switch (r.type) {
      case 'page': if (r.action === 'settings') setShowSettingsModal(true); else if (r.view) navigate(r.view); break;
      case 'inventory': { const it = data.find(i => i.id === r.itemId); if (it) { setEditingItem(it); setView('edit'); } break; }
      case 'repair': setFocusRepairId(r.itemId); navigate('repairs'); break;
      case 'customer': setFocusCustomerId(r.itemId); navigate('customers'); break;
      case 'sale': if (r.customerId) { setFocusCustomerId(r.customerId); navigate('customers'); } break;
      case 'user': navigate('users'); break;
    }
  };

  // Seed sample data into Firestore (demo option only)
  const handleSeedSampleData = async () => {
    if (!uid || !allow('inventory.add')) return;
    await seedSampleData(uid, INITIAL_DATA);
    logActivity('Sample data loaded');
    audit('backup.seed', 'inventory');
  };


  // Global Search: Cmd/Ctrl+K toggles the command palette.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); setShowFinder(s => !s); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

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

  // Apply the workspace theme preference. 'system' follows the OS setting live;
  // 'light'/'dark' pin it. The header toggle still works within a session.
  useEffect(() => {
    const t = settings.appearance.theme;
    if (t === 'system') {
      if (typeof window === 'undefined' || !window.matchMedia) return;
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      setDarkMode(mq.matches);
      const handler = (e: MediaQueryListEvent) => setDarkMode(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    setDarkMode(t === 'dark');
  }, [settings.appearance.theme]);

  // Mirror the workspace's custom label sizes into the local cache so the label
  // modals (which don't receive settings as props) can read the merged list.
  useEffect(() => { cacheLabelSizes(settings.labels.customSizes); }, [settings.labels.customSizes]);

  // Mirror the store profile (business identity) into the local cache so the
  // checkout hook can print a proper invoice header without settings as props.
  useEffect(() => { cacheStoreProfile(settings.general); }, [settings.general]);

  // Mirror the owner's "QR encodes" choice into the same local label-prefs blob
  // the label modal reads (it doesn't receive settings as props), so a device's
  // QR encodes the configured field (SKU / ID / IMEI / URL).
  useEffect(() => {
    try {
      const prev = JSON.parse(localStorage.getItem('ftt_label_tpl_v1') || '{}');
      localStorage.setItem('ftt_label_tpl_v1', JSON.stringify({ ...prev, qrContent: settings.labels.qrContent }));
    } catch { /* ignore */ }
  }, [settings.labels.qrContent]);

  // Whether the Quick Sale cart currently has unsold items — kept as a ref
  // (not state) since it's only read inside navigate()/beforeunload, not rendered.
  const cartDirtyRef = useRef(false);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (view === 'pos' && cartDirtyRef.current) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [view]);

  // Apply the configured default landing page once, on first load.
  const landingAppliedRef = useRef(false);
  useEffect(() => {
    if (landingAppliedRef.current || !appUser || dbLoading) return;
    landingAppliedRef.current = true;
    const lv = settings.dashboard.landingView;
    if (lv && lv !== 'dashboard' && lv !== 'entry' && lv !== 'edit') setView(lv);
  }, [appUser, dbLoading, settings.dashboard.landingView]);

  // --- Inventory routing (/inventory/<section>) -------------------------------
  // Open Inventory at a section, syncing the URL so refresh + shared links work.
  const goInventory = (s: InvSection) => {
    setInvSection(s);
    setView('grid');
    const path = invPath(s);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
  };
  // Navigation wrapper for every nav surface: clicking Inventory opens Devices;
  // every other page pushes its own path so a refresh / shared link restores it.
  // Leaving Quick Sale with items still in the cart (never rung up) warns first,
  // same pattern as ItemFormModal's unsaved-changes guard.
  const navigate = (v: ViewState) => {
    if (view === 'pos' && v !== 'pos' && cartDirtyRef.current
      && !window.confirm('You have items in the Quick Sale cart that haven\'t been sold yet. Leave anyway?')) return;
    if (v === 'grid') { goInventory(DEFAULT_INV_SECTION); return; }
    const path = viewPath(v);
    if (isRoutableView(v) && window.location.pathname !== path) window.history.pushState(null, '', path);
    setView(v);
  };
  // On first load, restore the page (and inventory section) from the URL.
  useEffect(() => {
    const s = parseInvPath(window.location.pathname);
    if (s) {
      landingAppliedRef.current = true; // an explicit inventory URL wins over the configured landing page
      setInvSection(s);
      setView('grid');
      const path = invPath(s);
      if (window.location.pathname !== path) window.history.replaceState(null, '', path);
    } else {
      const v = parseViewPath(window.location.pathname);
      // A real, non-dashboard page in the URL wins over the configured landing page.
      if (v && v !== 'dashboard' && isRoutableView(v)) { landingAppliedRef.current = true; setView(v); }
    }
    // Back/forward across the whole app (inventory sections included).
    const onPop = () => {
      const sec = parseInvPath(window.location.pathname);
      if (sec) { setInvSection(sec); setView('grid'); return; }
      const v = parseViewPath(window.location.pathname);
      setView(v && isRoutableView(v) ? v : 'dashboard');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the localStorage-mirrored POS tax rate in sync with the live Firestore
  // settings on every load (not just when Settings happens to get saved) — a
  // browser/terminal that's never had Settings manually saved on it used to
  // fall back to the hardcoded 13% default indefinitely instead of the shop's
  // actual configured rate. Runs whenever `settings` changes, so it also picks
  // up a rate change saved from a different device.
  useEffect(() => {
    try { localStorage.setItem('posSettings', JSON.stringify({ taxRate: settings.tax.percent })); }
    catch { /* ignore */ }
  }, [settings.tax.percent]);

  // Persist owner settings to Firestore, and mirror the few values that other
  // components read from localStorage (POS tax rate, default label template).
  const handleSaveSettings = async (next: AppSettings) => {
    if (!uid || !allow('settings.manage')) return;
    // Record which sections actually changed (e.g. ['tax','labels']) rather than a
    // generic "Settings updated" with no detail.
    const changed = changedSettingsSections(settings, next);
    await saveSettings(uid, next);
    audit('settings.update', 'settings', 'app', undefined, { changed });
    logActivity(changed.length ? `Settings updated: ${changed.join(', ')}` : 'Settings updated');
    try {
      localStorage.setItem('posSettings', JSON.stringify({ taxRate: next.tax.percent }));
      const prevTpl = JSON.parse(localStorage.getItem('ftt_label_tpl_v1') || '{}');
      localStorage.setItem('ftt_label_tpl_v1', JSON.stringify({ ...prevTpl, template: next.labels.defaultSize }));
      cacheLabelSizes(next.labels.customSizes);
    } catch { /* ignore */ }
  };

  // --- Inventory writes go straight to Firestore; live subs update the UI ---
  const handleSaveItem = (raw: InventoryItem) => {
    // Entering an Actual sale price on the form records a direct sale (stamps
    // soldDate + marks sold) so it counts in reporting like a Quick Sale.
    const item = applyDirectSale(raw);
    const isNew = !dataRef.current.some(i => i.id === item.id);
    if (uid && (isNew ? allow('inventory.add') : allow('inventory.edit'))) {
      if (isNew) { logActivity(`${item.sku || item.item || 'Item'} added`); audit('inventory.add', collectionFor(item), item.id, undefined, item); }
      else audit('inventory.edit', collectionFor(item), item.id);
      saveItem(uid, collectionFor(item), item);
    }
    goInventory(DEFAULT_INV_SECTION);
    setEditingItem(undefined);
  };

  const handleDeleteItem = (id: string) => {
    if (!uid || !allow('inventory.delete')) return;
    const target = dataRef.current.find(i => i.id === id);
    audit('inventory.delete', target ? collectionFor(target) : 'inventory', id, target);
    deleteItem(uid, target ? collectionFor(target) : 'inventory', id);
  };

  // Update single field (inline edit). Returns the write's promise so bulk
  // callers (e.g. Inventory's multi-select actions) can detect per-item
  // failures instead of assuming every write in a batch succeeded.
  const handleUpdateItem = (id: string, field: keyof InventoryItem, value: any): Promise<void> => {
    if (!uid || !allow('inventory.edit')) return Promise.resolve();
    const target = dataRef.current.find(i => i.id === id);
    if (!target) return Promise.reject(new Error(`Item ${id} not found`));
    const label = target.sku || target.item || id;
    if (field === 'deviceStatus') logActivity(`${label} marked ${String(value).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`);
    else if (field === 'quantity') { logActivity(`${label} quantity updated`); audit('accessory.quantity', collectionFor(target), id, { quantity: target.quantity }, { quantity: value }); }
    audit('inventory.edit', collectionFor(target), id, { [field]: (target as any)[field] }, { [field]: value });
    // Entering an Actual sale price inline records a direct sale: stamp soldDate +
    // mark sold (like Quick Sale) so it leaves active stock and feeds reporting.
    const next = applyDirectSale({ ...target, [field]: value });
    if (field === 'salePrice' && next.soldDate && !target.soldDate) logActivity(`${label} sold for $${(next.salePrice || 0).toFixed(2)}`);
    return saveItem(uid, collectionFor(target), next);
  };

  // Update an entire row
  const handleUpdateRow = (updatedItem: InventoryItem) => { if (uid && allow('inventory.edit')) saveItem(uid, collectionFor(updatedItem), updatedItem); };

  // Generate the next unique internal SKU for a kind/device type (never reused).
  // Allocation is atomic: the counter is read-incremented-written inside a
  // Firestore transaction, so two staff generating a SKU at once can't collide.
  const handleGenerateSku = async (kind: ItemKind, deviceType?: DeviceType): Promise<string> => {
    const prefix = skuPrefix(kind, deviceType);
    if (!uid) return nextSku(prefix, skuRef.current, dataRef.current).sku; // no workspace yet (unauthenticated preview)
    const { sku, counters } = await allocateSku(uid, prefix, dataRef.current);
    skuRef.current = counters;
    setSkuCounters(counters);
    return sku;
  };

  // Add or update a single inventory item (device or accessory) from InventoryView
  const handleSaveInventoryItem = (raw: InventoryItem) => {
    if (!uid) return;
    // Entering an Actual sale price records a direct sale (private sale, trade
    // show, …): stamp soldDate + mark sold so it leaves active stock and feeds
    // the dashboard/P&L the same way Quick Sale does.
    const item = applyDirectSale(raw);
    const isNew = !dataRef.current.some(i => i.id === item.id);
    if (isNew ? !allow('inventory.add') : !allow('inventory.edit')) return;
    if (isNew) { logActivity(`${item.sku || item.item || 'Item'} added`); audit('inventory.add', collectionFor(item), item.id, undefined, item); }
    else audit('inventory.edit', collectionFor(item), item.id);
    if (item.soldDate && !raw.soldDate) logActivity(`${item.sku || item.item || 'Device'} sold for $${(item.salePrice || 0).toFixed(2)}`);
    saveItem(uid, collectionFor(item), item);
  };

  // Quick Purchase (QuickPurchaseView): the buying-side counterpart to Quick
  // Sale — creates a real inventory record (status 'ready', same as a normal
  // Add Item save) and, when store-paid, logs the drawer cash-out in the same
  // action (same pattern as the FTT Personal repair purchase-cost feature —
  // see domain/autoInventory.ts's autoInventoryPurchaseDrawerEffect).
  const handleQuickPurchase = async (input: QuickPurchaseSaveInput) => {
    if (!uid || !allow('inventory.add')) return;
    const sku = await handleGenerateSku('device');
    const item = buildQuickPurchaseItem(input, { id: newId(), sku }, new Date().toISOString().split('T')[0]);
    logActivity(`${item.sku} added — quick purchase ($${item.purchaseCost.toFixed(2)})`);
    audit('inventory.add', 'inventory', item.id, undefined, item);
    saveItem(uid, 'inventory', item);

    const purchaseEffect = quickPurchaseDrawerEffect(input.purchaseCost, input.paidBy);
    if (purchaseEffect) {
      const date = new Date().toISOString().split('T')[0];
      const existing = cashReconciliations.find(rec => rec.date === date);
      const listKey: 'cashIn' | 'cashOut' = purchaseEffect.kind;
      const entry = { id: newId(), amount: purchaseEffect.amount, note: `Quick Purchase — ${item.item}` };
      commitDrawerRecord(date, { [listKey]: [...(existing?.[listKey] || []), entry] });
      logActivity(`Cash paid out $${purchaseEffect.amount.toFixed(2)} — quick purchase (${item.item})`);
    }
  };

  // Sell a cart: mark devices sold in Firestore, decrement accessory quantities,
  // create a sales transaction + customer, log activity — one atomic commit.
  const handleSellCart = (payload: CartCheckout) => {
    if (!uid || !allow('sales.complete')) return;
    const balanceOwing = payload.transaction.balanceOwing || 0;
    const isLayaway = balanceOwing > 0;
    audit('sale.complete', 'sale', payload.transaction.id, undefined, { totalPaid: payload.transaction.totalPaid, lines: payload.transaction.lines.length, deposit: payload.transaction.deposit, balanceOwing: balanceOwing || undefined });
    // Pass a signed delta (not an absolute quantity): commitSale applies it with
    // Firestore's atomic increment(), so two concurrent sales of the same
    // accessory both subtract correctly instead of one silently overwriting the
    // other off a shared stale snapshot.
    const accessoryUpdates = Object.entries(payload.accessoryQtys).map(([id, soldQty]) => ({ id, delta: stockChange(soldQty) }));
    // Delist reminder (durable copy of the confirmation-screen notice — see
    // useCheckout's delistReminders): a device flagged listed elsewhere that
    // just sold in-store for real (not a layaway hold). listedPlatforms is
    // already cleared on payload.soldRows by the time it gets here, so the
    // "was it listed" check reads the pre-sale snapshot still in dataRef.
    const delistNotices: ActivityEntry[] = isLayaway ? [] : payload.soldRows
      .map(d => dataRef.current.find(i => i.id === d.id))
      .filter((i): i is InventoryItem => !!i && (i.listedPlatforms?.length || 0) > 0)
      .map(i => mkActivity(`Remember to delist ${i.sku || i.item} from: ${listingPlatformsLabel(i.listedPlatforms)}`));
    const activity: ActivityEntry[] = [
      ...payload.soldRows.map(d => mkActivity(`${d.sku || d.item} ${isLayaway ? 'reserved (layaway) for' : 'sold to'} ${d.customerName || d.soldTo || 'customer'}`)),
      ...delistNotices,
      ...Object.keys(payload.accessoryQtys).map(id => {
        const a = dataRef.current.find(i => i.id === id); return mkActivity(`${a?.sku || 'Accessory'} quantity updated`);
      }),
    ];
    commitSale(uid, { soldRows: payload.soldRows, accessoryUpdates, transaction: payload.transaction, customer: payload.customer, activity }).catch(e => console.error('Sale commit failed', e));

    // Repair checkout: this sale recognized a repair's revenue/profit, so stamp
    // the repair complete and link it to the transaction. Analytics reads that
    // link to count the repair's money once (via the sale), never twice.
    const repairId = payload.transaction.repairId;
    if (repairId && !isLayaway) {
      const rep = repairsRef.current.find(r => r.id === repairId);
      if (rep) {
        const terminal = rep.type === 'retail' ? 'picked_up' : 'completed';
        // Backdated the same way the sale itself was — a repair checked out
        // through a backdated Quick Sale reflects that same completion date,
        // not the moment it was actually entered.
        const done = { ...completeRepairSale(rep, payload.transaction.id, dateToEpochMs(payload.transaction.date), terminal), completedBy: appUser.id };
        saveItem(uid, 'repairs', done);
        logActivity(`${done.repairNumber} checked out (${payload.transaction.customerName || 'customer'})`);
        audit('repair.status_change', 'repair', done.id, { status: rep.status }, { status: terminal });
        audit('repair.completed', 'repair', done.id, undefined, { salesTransactionId: payload.transaction.id });
      }
    }

    // Custom items opted into inventory: fill a real SKU and persist to the right collection
    (payload.newInventoryItems || []).forEach(async item => {
      const kind: ItemKind = (item.kind ?? 'device');
      const withSku = item.sku ? item : { ...item, sku: await handleGenerateSku(kind, item.deviceType) };
      saveItem(uid, collectionFor(withSku), withSku);
      logActivity(`${withSku.sku || withSku.item} added from custom sale`);
    });
  };

  // Reverse a completed sale (owner/manager, same-day window). Returns sold
  // devices to stock, restocks accessories atomically, and flags the transaction
  // voided (kept for audit). Does NOT touch custom lines (no inventoryId).
  const handleVoidSale = (tx: SalesTransaction) => {
    if (!uid || !appUser || !allow('sales.void')) return;
    if (!canVoidSale(tx, new Date().toISOString().split('T')[0], settings.operations.voidWindowDays)) return;

    // Device lines are the actual sold inventory rows (still carrying this txn id).
    // Restore each device's listedPlatforms snapshot (SalesLine.listedPlatforms,
    // taken at sale time) rather than leaving it cleared — a voided/returned sale
    // shouldn't silently drop the fact that a device might still be listed live
    // elsewhere.
    const listedPlatformsByInvId = saleDeviceListedPlatforms(tx);
    const devices = dataRef.current
      .filter(i => (i.kind ?? 'device') === 'device' && i.transactionId === tx.id)
      .map(i => ({ id: i.id, listedPlatforms: listedPlatformsByInvId.get(i.id) }));
    // Restock accessories by the quantity sold on each accessory line.
    const accessoryUpdates = saleAccessoryRestock(tx);

    const activity: ActivityEntry[] = [mkActivity(`Sale ${tx.id.slice(0, 8)} voided (${tx.customerName || 'customer'})`)];
    voidSale(uid, {
      transactionId: tx.id, devices, accessoryUpdates,
      voided: { voidedAt: Date.now(), voidedBy: appUser.id, voidedByEmail: appUser.email },
      activity,
    }).catch(e => console.error('Void failed', e));
    audit('sale.void', 'sale', tx.id, { totalPaid: tx.totalPaid }, { devices: devices.length, accessories: accessoryUpdates.length });

    // Cash actually leaves the till right now (the day the void is processed),
    // never retroactively against the original sale's date (already reconciled
    // in virtually every real case) — see domain/pos.ts's saleRefundDrawerEffect.
    // A layaway only ever collected its deposit (cashCollectedOnSale), so a
    // voided layaway never refunds more cash than actually came in; a card/
    // e-transfer sale never touches the drawer at all.
    const voidCashEffect = saleRefundDrawerEffect(cashCollectedOnSale(tx));
    if (voidCashEffect) {
      const date = new Date().toISOString().split('T')[0];
      const existing = cashReconciliations.find(r => r.date === date);
      const entry = { id: newId(), amount: voidCashEffect.amount, note: `Sale ${tx.id.slice(0, 8)} voided — refund` };
      commitDrawerRecord(date, { cashOut: [...(existing?.cashOut || []), entry] });
    }
  };

  // Process a return (the after-the-void-window counterpart to Void): refund the
  // customer (optionally minus a restocking fee), restock accessories atomically,
  // set each returned device to its chosen disposition (resellable or defective),
  // and flag the transaction 'returned' (kept for audit). Custom lines (no
  // inventoryId) are not touched, same as Void.
  const handleReturnSale = (tx: SalesTransaction, opts: { restockingFee?: number; disposition: 'resell' | 'defective' }) => {
    if (!uid || !appUser || !allow('sales.return')) return;
    if (!canReturnSale(tx, new Date().toISOString().split('T')[0], settings.operations.voidWindowDays)) return;

    // Restore each device's listedPlatforms snapshot (see handleVoidSale) rather
    // than leaving it cleared.
    const listedPlatformsByInvId = saleDeviceListedPlatforms(tx);
    const devices = dataRef.current
      .filter(i => (i.kind ?? 'device') === 'device' && i.transactionId === tx.id)
      .map(i => ({ id: i.id, listedPlatforms: listedPlatformsByInvId.get(i.id) }));
    const resellDevices = opts.disposition === 'resell' ? devices : [];
    const defectiveDevices = opts.disposition === 'defective' ? devices : [];
    const accessoryUpdates = saleAccessoryRestock(tx);
    const restockingFee = opts.restockingFee && opts.restockingFee > 0 ? opts.restockingFee : undefined;
    // Refund base is what was actually COLLECTED, not the grand total due — a
    // layaway only ever took its deposit, so refunding tx.totalPaid would hand
    // back money that was never paid in (see domain/pos.ts's collectedOnSale).
    const refundAmount = returnRefund(collectedOnSale(tx), restockingFee);

    const activity: ActivityEntry[] = [mkActivity(`Sale ${tx.id.slice(0, 8)} returned — refunded ${refundAmount.toFixed(2)} (${tx.customerName || 'customer'})`)];
    returnSale(uid, {
      transactionId: tx.id, resellDevices, defectiveDevices, accessoryUpdates,
      returned: { returnedAt: Date.now(), returnedBy: appUser.id, returnedByEmail: appUser.email, restockingFee, refundAmount },
      activity,
    }).catch(e => console.error('Return failed', e));
    audit('sale.return', 'sale', tx.id, { totalPaid: tx.totalPaid },
      { refundAmount, restockingFee: restockingFee || 0, disposition: opts.disposition, devices: devices.length, accessories: accessoryUpdates.length });

    // Same today's-date cash-out rule as Void (see handleVoidSale) — the
    // restocking fee comes out of the cash portion first (returnRefund's usual
    // fee-clamping), so a card/e-transfer sale still never touches the drawer.
    const returnCashEffect = saleRefundDrawerEffect(returnRefund(cashCollectedOnSale(tx), restockingFee));
    if (returnCashEffect) {
      const date = new Date().toISOString().split('T')[0];
      const existing = cashReconciliations.find(r => r.date === date);
      const entry = { id: newId(), amount: returnCashEffect.amount, note: `Sale ${tx.id.slice(0, 8)} returned — refund` };
      commitDrawerRecord(date, { cashOut: [...(existing?.cashOut || []), entry] });
    }
  };

  // Save (or update) a day's cash-drawer reconciliation. One doc per date (id ===
  // date), recording who counted it and any variance note. Owner/manager only.
  // Merge a change into a day's drawer record and recompute the expected-cash
  // baseline (and variance, once counted) from the shared domain math — the
  // single write path for opening the drawer, logging a movement and
  // reconciling, so the three can never diverge. Returns the saved record.
  const commitDrawerRecord = (date: string, patch: Partial<CashReconciliation>): CashReconciliation | null => {
    if (!uid || !appUser) return null;
    const existing = cashReconciliations.find(r => r.date === date);
    const merged: CashReconciliation = {
      id: date, date, openingFloat: 0, expectedCash: 0, variance: 0,
      recordedBy: appUser.id, recordedByEmail: appUser.email, recordedAt: Date.now(),
      ...existing, ...patch,
    };
    const cashSales = expectedCashForDate(salesTransactions, date);
    merged.cashSales = cashSales;
    merged.expectedCash = expectedEndingCash({
      openingFloat: merged.openingFloat, cashSales,
      cashIn: sumDrawerEntries(merged.cashIn), cashOut: sumDrawerEntries(merged.cashOut), withdrawals: sumDrawerEntries(merged.withdrawals),
    });
    merged.variance = merged.countedCash != null ? Math.round((merged.countedCash - merged.expectedCash) * 100) / 100 : 0;
    merged.recordedBy = appUser.id; merged.recordedByEmail = appUser.email; merged.recordedAt = Date.now();
    saveCashReconciliation(uid, merged).catch(e => console.error('Cash drawer save failed', e));
    return merged;
  };

  // Reconcile (count + close) a day — owner/manager only. Recomputes expected /
  // variance from the shared math and stamps the reconciled-by/at close markers.
  const handleSaveReconciliation = (r: ReconciliationInput) => {
    if (!uid || !appUser || !allow('cash.reconcile')) return;
    const saved = commitDrawerRecord(r.date, {
      openingFloat: r.openingFloat, cashIn: r.cashIn, cashOut: r.cashOut, withdrawals: r.withdrawals,
      countedCash: r.countedCash, note: r.note,
      reconciledAt: Date.now(), reconciledBy: appUser.id, reconciledByEmail: appUser.email,
    });
    if (saved) audit('cash.reconcile', 'cashReconciliation', r.date, undefined, { expected: saved.expectedCash, counted: saved.countedCash, variance: saved.variance });
  };

  // Quick close-out right at the register (the actual "closing up" moment) —
  // count the till and reconcile in one step, instead of only being possible
  // from the full Reports > Cash tab. commitDrawerRecord merges over today's
  // existing record, so the opening float and any logged cash in/out/withdrawal
  // entries carry through unchanged; this only adds the count + note and stamps
  // the reconciled-by/at markers. Owner/manager only (cash.reconcile).
  const handleCloseDrawer = (countedCash: number, note?: string) => {
    if (!uid || !appUser || !allow('cash.reconcile')) return;
    const date = new Date().toISOString().split('T')[0];
    const saved = commitDrawerRecord(date, {
      countedCash, note,
      reconciledAt: Date.now(), reconciledBy: appUser.id, reconciledByEmail: appUser.email,
    });
    if (saved) {
      const variance = saved.variance;
      logActivity(`Drawer closed — counted $${countedCash.toFixed(2)}${Math.abs(variance) >= 0.005 ? ` (${variance > 0 ? 'over' : 'short'} $${Math.abs(variance).toFixed(2)})` : ''}`);
      audit('cash.reconcile', 'cashReconciliation', date, undefined, { expected: saved.expectedCash, counted: saved.countedCash, variance: saved.variance });
    }
  };

  // Open the drawer for the day — record the actual starting float explicitly
  // (no silent default). Available to anyone who runs the register (cash.log).
  // Always leaves the day in an active/open state (see domain/reports.ts's
  // openDrawerPatch) — including clearing a prior close/reconcile for today, so
  // a day that was already closed once can actually be resumed instead of
  // staying stuck showing "Closed today" with no way back.
  const handleOpenDrawer = (openingFloat: number) => {
    if (!uid || !appUser || !allow('cash.log')) return;
    const date = new Date().toISOString().split('T')[0];
    const existing = cashReconciliations.find(r => r.date === date);
    commitDrawerRecord(date, openDrawerPatch(openingFloat, { id: appUser.id, email: appUser.email }, existing));
    logActivity(`Drawer opened with $${openingFloat.toFixed(2)}`);
    audit('cash.log', 'cashReconciliation', date, undefined, { kind: 'open', openingFloat });
  };

  // Log a single cash movement (cash-in / cash-out / withdrawal) against today's
  // drawer — available to anyone who handles the register (cash.log). Appends the
  // entry and recomputes the expected baseline; the count + close stay separate,
  // so a movement never masquerades as a completed reconciliation.
  const handleLogCashMovement = ({ kind, amount, note }: { kind: CashMovementKind; amount: number; note?: string }) => {
    if (!uid || !appUser || !allow('cash.log') || !(amount > 0)) return;
    const date = new Date().toISOString().split('T')[0];
    const existing = cashReconciliations.find(r => r.date === date);
    const listKey: 'cashIn' | 'cashOut' | 'withdrawals' = kind === 'cashIn' ? 'cashIn' : kind === 'cashOut' ? 'cashOut' : 'withdrawals';
    const list = [...(existing?.[listKey] || []), { id: newId(), amount, note }];
    commitDrawerRecord(date, { [listKey]: list });
    const label = kind === 'cashIn' ? 'in' : kind === 'cashOut' ? 'paid out' : 'withdrawal';
    logActivity(`Cash ${label} $${amount.toFixed(2)}${note ? ` — ${note}` : ''}`);
    audit('cash.log', 'cashReconciliation', date, undefined, { kind, amount });
  };

  // Today's live drawer (shared math) — drives the POS running total and the
  // quick-log modal's before/after figures.
  const todayDrawer = useMemo(() => {
    const date = new Date().toISOString().split('T')[0];
    return cashDrawerSummary(cashReconciliations.find(r => r.date === date), expectedCashForDate(salesTransactions, date));
  }, [cashReconciliations, salesTransactions]);
  const todayRecon = cashReconciliations.find(r => r.date === new Date().toISOString().split('T')[0]);

  const handleBulkImport = (items: InventoryItem[]) => {
    if (uid) items.forEach(it => saveItem(uid, collectionFor(it), it));
    goInventory(DEFAULT_INV_SECTION);
  };

  const handleRestoreData = async (restoredData: AppData) => {
    if (!uid || !allow('settings.manage')) return;
    const inv = restoredData.inventory || [];
    await syncArray(uid, 'inventory', inv.filter(i => (i.kind ?? 'device') === 'device'), dataRef.current.filter(i => (i.kind ?? 'device') === 'device'));
    await syncArray(uid, 'accessories', inv.filter(i => i.kind === 'accessory'), dataRef.current.filter(i => i.kind === 'accessory'));
    await syncArray(uid, 'runners', restoredData.runners || [], runnersRef.current);
    await syncArray(uid, 'dropOffs', restoredData.dropOffs || [], dropOffsRef.current);
    await syncArray(uid, 'settlements', restoredData.settlements || [], settlementsRef.current);
    await syncArray(uid, 'customers', restoredData.customers || [], customersRef.current);
    await syncArray(uid, 'salesTransactions', restoredData.salesTransactions || [], salesTransactionsRef.current);
    await syncArray(uid, 'repairs', restoredData.repairs || [], repairsRef.current);
    await syncArray(uid, 'repairBatches', restoredData.repairBatches || [], repairBatchesRef.current);
    await saveMeta(uid, { notes: restoredData.notes || [], tasks: restoredData.tasks || [], skuCounters: restoredData.skuCounters || {} });
  };

  // Add an accepted drop-off into inventory, carrying runner + cost across.
  // No cash-drawer effect here — a store-paid purchase already hit the drawer
  // at Accept (see saveDropOffs' dropOffAcceptDrawerEffect call); logging it
  // again here would double-count the same cash.
  const handleAddDropOffToInventory = (d: DropOff) => {
    if (!uid || !allow('dropoffs.manage')) return;
    const runner = runnersRef.current.find(r => r.id === d.runnerId);
    const newItem: InventoryItem = {
      id: newId(), kind: 'device', date: d.dateDropped || new Date().toISOString().split('T')[0],
      item: d.item, imei: d.imei, boughtFrom: d.sellerName || 'Marketplace (drop-off)',
      // Acquisition cost = price paid to the seller + the runner's fee (both are
      // real costs and both are what the settlement pays the runner).
      purchaseCost: dropOffPurchaseCost(d), repairCost: 0, soldDate: '', soldTo: '', salePrice: 0,
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
  // Save the drop-off list (any status change or field edit routes through
  // here, since DropOffView diffs against one shared array). A drop-off that
  // just transitioned pending → accepted may hand real cash to the seller
  // right now (paidBy 'store') — see dropOffAcceptDrawerEffect's contract at
  // the top of domain/dropoffs.ts: any cash-moving action must log its effect
  // through a function like it, via commitDrawerRecord, or the till silently
  // drifts from what's actually in the drawer. Comparing against the previous
  // array (not just "is accepted now") means this only ever fires once per
  // drop-off, on the actual transition — editing an already-accepted drop-off
  // later never re-logs the same cash.
  const saveDropOffs = (next: DropOff[]) => {
    if (!uid || !allow('dropoffs.manage')) return;
    const prev = dropOffsRef.current;
    const date = new Date().toISOString().split('T')[0];
    next.forEach(d => {
      const before = prev.find(p => p.id === d.id);
      if (before?.status === 'accepted' || d.status !== 'accepted') return; // not a fresh accept
      const effect = dropOffAcceptDrawerEffect(d);
      if (!effect) return;
      const existing = cashReconciliations.find(r => r.date === date);
      const listKey: 'cashIn' | 'cashOut' = effect.kind;
      const entry = { id: newId(), amount: effect.amount, note: `Drop-off accepted — ${d.item || d.id}` };
      commitDrawerRecord(date, { [listKey]: [...(existing?.[listKey] || []), entry] });
      logActivity(`Cash paid out $${effect.amount.toFixed(2)} — drop-off accepted (${d.item || d.id})`);
    });
    syncArray(uid, 'dropOffs', next, prev);
    audit('dropoff.edit', 'dropOff');
  };
  // Record one completed runner settlement. Only a 'cash' payment method ever
  // touches the cash drawer — e-transfer/other never do (domain/dropoffs.ts's
  // settlementDrawerEffect is the single source of that decision). Writes
  // through the same commitDrawerRecord path as every other drawer movement,
  // so the register's live total and the reconciliation screen can't drift.
  const handleSettleRunner = (settlement: Settlement) => {
    if (!uid || !allow('dropoffs.manage')) return;
    // Saving the settlement and flagging its drop-offs 'settled' happen in one
    // atomic commit — settleableDropOffs (domain/dropoffs.ts) only excludes
    // 'settled'/'accepted'-gone-'paidout' drop-offs, so if this ever landed as
    // two separate writes, a failure (or just a slow second write) between
    // them would leave the same drop-offs eligible for a second settlement —
    // the runner could get paid twice for the same batch of devices.
    settleRunner(uid, { settlement, dropOffIds: settlement.dropOffIds }).catch(e => console.error('Settle runner failed', e));
    audit('dropoff.settle', 'settlement', settlement.id, undefined, {
      runnerId: settlement.runnerId, amountPaid: settlement.amountPaid, paymentMethod: settlement.paymentMethod,
    });
    const effect = settlementDrawerEffect(settlement);
    if (effect) {
      const date = new Date().toISOString().split('T')[0];
      const existing = cashReconciliations.find(r => r.date === date);
      const listKey: 'cashIn' | 'cashOut' = effect.kind;
      const entry = { id: newId(), amount: effect.amount, note: `Runner settlement — ${settlement.id}` };
      commitDrawerRecord(date, { [listKey]: [...(existing?.[listKey] || []), entry] });
    }
  };

  // --- Users / roles management ---
  // Owners manage everyone (users.manage). Managers (users.tech) may manage only
  // technician accounts. A manager acting on a non-technician is a no-op here and
  // is also blocked by firestore.rules.
  const targetRoleOf = (targetUid: string): Role | undefined => workspaceUsers.find(u => u.id === targetUid)?.role;
  const canActOnUser = (role: Role | undefined): boolean =>
    allow('users.manage') || (allow('users.tech') && role === 'technician');

  const handleSetRole = (targetUid: string, role: Role) => {
    // Role changes are owner-only (managers can invite/disable techs, not re-role).
    if (!allow('users.manage') || targetUid === appUser?.id) return;
    const target = workspaceUsers.find(u => u.id === targetUid);
    updateUserDoc(targetUid, { role }).catch(() => {});
    audit('user.role_change', 'user', targetUid, { email: target?.email, role: target?.role }, { role });
  };
  const handleSetDisabled = (targetUid: string, disabled: boolean) => {
    if (targetUid === appUser?.id || !canActOnUser(targetRoleOf(targetUid))) return;
    const target = workspaceUsers.find(u => u.id === targetUid);
    updateUserDoc(targetUid, { disabled }).catch(() => {});
    audit(disabled ? 'user.disable' : 'user.enable', 'user', targetUid,
      { email: target?.email, disabled: !disabled }, { disabled });
  };
  const handleSetAllowProfit = (targetUid: string, allowProfit: boolean) => {
    if (!allow('users.manage')) return;
    updateUserDoc(targetUid, { allowProfit }).catch(() => {});
    audit('user.allow_profit', 'user', targetUid, undefined, { allowProfit });
  };
  const handleInvite = (email: string, role: Role) => {
    if (!workspaceId) return;
    // Managers may only invite technicians; owners may invite any role.
    if (!(allow('users.manage') || (allow('users.tech') && role === 'technician'))) return;
    const inv: WorkspaceInvite = { id: email.toLowerCase(), email: email.toLowerCase(), workspaceId, role, invitedBy: appUser?.email, createdAt: Date.now() };
    setInvite(inv).catch(() => {});
    audit('user.invite', 'user', email, undefined, { role });
  };
  const handleDeleteInvite = (email: string) => {
    const inv = invites.find(i => i.email === email.toLowerCase());
    if (!(allow('users.manage') || (allow('users.tech') && inv?.role === 'technician'))) return;
    deleteInvite(email).catch(() => {});
    // Record the revocation with the invited email/role — the invite doc is gone after this.
    audit('user.invite_revoke', 'user', email, { email, role: inv?.role }, undefined);
  };

  // Owner-only hourly-rate edit (rate lives on the user doc). Managers/employees
  // can't change pay — enforced here and in firestore.rules.
  const handleSetHourlyRate = (targetUid: string, hourlyRate: number) => {
    if (!allow('users.manage')) return;
    const rate = Math.max(0, Number.isFinite(hourlyRate) ? hourlyRate : 0);
    const before = workspaceUsers.find(u => u.id === targetUid)?.hourlyRate;
    updateUserDoc(targetUid, { hourlyRate: rate }).catch(() => {});
    audit('user.set_rate', 'user', targetUid, { hourlyRate: before }, { hourlyRate: rate });
  };

  // --- Staff notes (owner-only shoutout/notes log) ---
  // Deliberately not routed through audit() — the audit log is also readable
  // by managers (audit.view), and this note's text must stay owner-only.
  const handleAddStaffNote = (text: string) => {
    if (!uid || !appUser || !allow('staffNotes.manage')) return;
    const note: StaffNote = { id: newId(), ts: Date.now(), text, authorId: appUser.id, authorEmail: appUser.email };
    saveStaffNote(uid, note).catch(() => {});
  };
  const handleDeleteStaffNote = (id: string) => {
    if (!uid || !allow('staffNotes.manage')) return;
    deleteStaffNote(uid, id).catch(() => {});
  };

  // --- Time clock ---
  // Every active staff member may clock in/out & take breaks (timeclock.use).
  // Each action mutates the caller's own open shift only.
  const handleClockIn = () => {
    if (!uid || !appUser || !allow('timeclock.use')) return;
    if (openEntryFor(timeEntries, appUser.id)) return; // already clocked in
    const entry: TimeEntry = {
      id: newId(), userId: appUser.id, userEmail: appUser.email,
      clockIn: Date.now(), breaks: [], createdAt: Date.now(),
    };
    saveTimeEntry(uid, entry).catch(() => {});
    audit('timeclock.clock_in', 'timeEntry', entry.id);
  };
  const handleClockOut = () => {
    if (!uid || !appUser || !allow('timeclock.use')) return;
    const open = openEntryFor(timeEntries, appUser.id);
    if (!open) return;
    const now = Date.now();
    // Close any still-running break at clock-out so it can't run forever.
    const breaks = (open.breaks || []).map(b => (b.end == null ? { ...b, end: now } : b));
    saveTimeEntry(uid, { ...open, breaks, clockOut: now }).catch(() => {});
    audit('timeclock.clock_out', 'timeEntry', open.id);
  };
  const handleStartBreak = (reason: BreakReason, note?: string) => {
    if (!uid || !appUser || !allow('timeclock.use')) return;
    const open = openEntryFor(timeEntries, appUser.id);
    if (!open || isOnBreak(open)) return;
    const brk = { id: newId(), start: Date.now(), reason, note };
    saveTimeEntry(uid, { ...open, breaks: [...(open.breaks || []), brk] }).catch(() => {});
    audit('timeclock.break_start', 'timeEntry', open.id, undefined, { reason });
  };
  const handleEndBreak = () => {
    if (!uid || !appUser || !allow('timeclock.use')) return;
    const open = openEntryFor(timeEntries, appUser.id);
    if (!open) return;
    const now = Date.now();
    const breaks = (open.breaks || []).map(b => (b.end == null ? { ...b, end: now } : b));
    saveTimeEntry(uid, { ...open, breaks }).catch(() => {});
    audit('timeclock.break_end', 'timeEntry', open.id);
  };
  // Owner/manager correction of a missed clock-out (gated the same as the rest
  // of Daily Hours / Payroll, via payroll.manage). Appends to the entry's
  // correction history rather than overwriting, and records a matching audit
  // entry (before/after) so the change is visible in the Audit Log too.
  const handleCorrectClockOut = (entryId: string, newClockOut: number) => {
    if (!uid || !appUser || !allow('payroll.manage')) return;
    const target = timeEntries.find(e => e.id === entryId);
    if (!target || !isValidClockOutCorrection(target, newClockOut, Date.now())) return;
    const next = correctClockOut(target, newClockOut, appUser.id, Date.now(), { correctedByEmail: appUser.email });
    saveTimeEntry(uid, next).catch(() => {});
    audit('timeclock.correct_clock_out', 'timeEntry', entryId, { clockOut: target.clockOut }, { clockOut: newClockOut });
  };
  // Owner-only pay-period sign-off. Records that a period was reviewed/paid — it
  // moves no money. Snapshots the numbers so the acknowledgment stays accurate.
  const handleMarkPaid = (targetUid: string, period: PayPeriod) => {
    if (!uid || !appUser || appUser.role !== 'owner') return;
    const target = workspaceUsers.find(u => u.id === targetUid);
    const pay = periodPayFor(timeEntries, targetUid, target?.hourlyRate, period, Date.now());
    const startISO = toISODate(period.start);
    const rec: PayPeriodPaid = {
      id: paidKey(targetUid, startISO),
      userId: targetUid,
      periodStart: startISO,
      periodEnd: toISODate(period.end - 1), // inclusive last calendar day
      markedBy: appUser.id, markedByEmail: appUser.email, markedAt: Date.now(),
      hours: pay.hours, gross: pay.gross, rate: pay.rate,
    };
    savePayPeriodPaid(uid, rec).catch(() => {});
    audit('timeclock.mark_paid', 'payPeriod', rec.id, undefined, { hours: pay.hours, gross: pay.gross });
  };
  const handleUnmarkPaid = (targetUid: string, period: PayPeriod) => {
    if (!uid || !appUser || appUser.role !== 'owner') return;
    const id = paidKey(targetUid, toISODate(period.start));
    deletePayPeriodPaid(uid, id).catch(() => {});
    audit('timeclock.unmark_paid', 'payPeriod', id);
  };

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

  // --- Repairs (retail tickets + wholesale batches) ---
  // Same atomic allocation as SKUs, for repair/batch numbers (own prefixes).
  const genNumber = async (prefix: string, used: string[]): Promise<string> => {
    const existing = used.map(sku => ({ sku }));
    if (!uid) return nextSku(prefix, skuRef.current, existing as any).sku;
    const { sku, counters } = await allocateSku(uid, prefix, existing);
    skuRef.current = counters; setSkuCounters(counters);
    return sku;
  };
  const handleGenRepairNumber = () => genNumber(REPAIR_PREFIX, repairsRef.current.map(r => r.repairNumber));
  const handleGenBatchNumber = () => genNumber(BATCH_PREFIX, repairBatchesRef.current.map(b => b.batchNumber));

  // Auto-inventory cleanup for a ticket being voided/cancelled/deleted (spec
  // point 6): an auto-created record still referenced by another ticket is left
  // alone (this ticket just loses its link); one referenced by nobody else is
  // flagged for review, never hard-deleted. No-op for tickets that were never
  // resolved through domain/autoInventory.ts (inventoryAutoCreated undefined).
  const cleanupOrphanedAutoInventory = (repair: Repair): Partial<Repair> => {
    if (!uid || !repair.inventoryId || repair.inventoryAutoCreated === undefined) return {};
    const item = dataRef.current.find(i => i.id === repair.inventoryId);
    if (!item?.autoCreated) return {};
    const stillReferenced = repairsRef.current.some(r => r.id !== repair.id && r.inventoryId === repair.inventoryId);
    if (stillReferenced) return { inventoryId: undefined };
    saveItem(uid, 'inventory', { ...item, flaggedForReview: true });
    return {};
  };

  const handleSaveRepair = async (repair: Repair, prev?: Repair): Promise<AutoInventoryNotice | undefined> => {
    if (!uid || !allow('repairs.manage')) return undefined;
    const isNew = !repairsRef.current.some(r => r.id === repair.id);
    let next: Repair = { ...repair };
    // Retail customer: create once, then reuse by customerId (builds history).
    if (next.type === 'retail' && next.customerName && !next.customerId) {
      const cust: Customer = { id: newId(), name: next.customerName, phone: next.customerPhone || '', email: next.customerEmail, kind: 'retail' };
      saveItem(uid, 'customers', cust);
      next.customerId = cust.id;
    }

    // Auto-inventory (domain/autoInventory.ts): only evaluated once, the moment a
    // wholesale device ticket is first created under a batch — a ticket's
    // inventory link, once resolved, is fixed for its lifetime.
    let notice: AutoInventoryNotice | undefined;
    if (isNew && next.type === 'wholesale' && next.batchId && !next.inventoryId) {
      const batch = repairBatchesRef.current.find(b => b.id === next.batchId);
      const decision = decideAutoInventory(batch, next.wantsAutoInventory, next.imei, dataRef.current);
      if (decision.action === 'invalidImei') {
        return { kind: 'blocked', message: `IMEI "${decision.digits}" fails the checksum check — fix the entry or clear the IMEI/serial field before saving.` };
      }
      if (decision.action === 'noIdentifier') {
        notice = { kind: 'warning', message: 'No IMEI or serial — device not added to inventory.' };
      } else if (decision.action === 'create' || decision.action === 'attach') {
        // SKU is pre-allocated outside commitAutoInventory's transaction (SKU
        // allocation runs its own transaction and Firestore doesn't nest them);
        // it goes unused if the transaction resolves to 'attach' instead — an
        // accepted gap, same as any other SKU counter race.
        const sku = await handleGenerateSku('device', next.deviceType);
        const candidate: InventoryItem = {
          id: newId(), kind: 'device', sku, date: next.date || new Date().toISOString().split('T')[0],
          item: [next.brand, next.model].filter(Boolean).join(' ') || next.model || next.deviceType || 'Device',
          imei: next.imei || '', boughtFrom: '', purchaseCost: next.purchaseCost || 0, repairCost: 0,
          soldDate: '', soldTo: '', salePrice: 0, notes: '',
          deviceType: next.deviceType, brand: next.brand, model: next.model, storage: next.storage, color: next.color,
          deviceStatus: 'pending_repair', imeiNormalized: decision.normalized,
          autoCreated: true, sourceTicketId: next.id, batchId: next.batchId,
        };
        const result = await commitAutoInventory(uid, { normalized: decision.normalized, candidate });
        next.inventoryId = result.item.id;
        if (result.action === 'create') {
          next.inventoryAutoCreated = true;
          notice = { kind: 'created', sku: result.item.sku || '' };
          // Real cash left the drawer right now if this device's cost came out
          // of store cash — mirrors the drop-off accept fix's drawer-effect
          // pattern. Only fires for the ticket that actually creates the
          // record, never a later ticket that just attaches to it.
          const purchaseEffect = autoInventoryPurchaseDrawerEffect(next);
          if (purchaseEffect) {
            const date = new Date().toISOString().split('T')[0];
            const existing = cashReconciliations.find(rec => rec.date === date);
            const listKey: 'cashIn' | 'cashOut' = purchaseEffect.kind;
            const entry = { id: newId(), amount: purchaseEffect.amount, note: `Device purchase — ${next.repairNumber || candidate.item}` };
            commitDrawerRecord(date, { [listKey]: [...(existing?.[listKey] || []), entry] });
            logActivity(`Cash paid out $${purchaseEffect.amount.toFixed(2)} — device purchase (${candidate.item})`);
          }
        } else {
          next.inventoryAutoCreated = false;
          next.inventoryPreviousStatus = result.item.deviceStatus;
          saveItem(uid, 'inventory', { ...result.item, deviceStatus: 'pending_repair', sourceTicketId: next.id });
          notice = { kind: 'attached', sku: result.item.sku, previousStatus: result.item.deviceStatus };
        }
      }
    }

    // Stamp completion + warranty when moving into a terminal status — 'picked_up'
    // is just as terminal as 'completed' (matches handleTechUpdateRepair's same
    // rule below), so picking either directly from the status quick-pill (which
    // otherwise writes { ...r, status: s } with no completion bookkeeping at all)
    // still gets completedAt/completedBy/warrantyUntil stamped correctly instead
    // of silently landing in a terminal state with no completion data.
    if ((next.status === 'completed' || next.status === 'picked_up') && !next.completedAt) {
      next = { ...completeRepair(next, Date.now(), next.status), completedBy: appUser.id };
    }
    // Auto-inventory devices become sellable once their ticket completes — Case A
    // (this ticket created the record) and Case B (attached to an existing one)
    // both land here, since only auto-inventory-resolved links set this field.
    if ((next.status === 'completed' || next.status === 'picked_up') && next.inventoryAutoCreated !== undefined && next.inventoryId) {
      const invItem = dataRef.current.find(i => i.id === next.inventoryId);
      if (invItem && invItem.deviceStatus !== 'ready') saveItem(uid, 'inventory', { ...invItem, deviceStatus: 'ready' });
    }
    // Ticket cancelled: clean up its auto-inventory link per spec point 6.
    if (next.status === 'cancelled' && prev && prev.status !== 'cancelled' && next.inventoryAutoCreated !== undefined) {
      next = { ...next, ...cleanupOrphanedAutoInventory(next) };
    }

    saveItem(uid, 'repairs', next);
    if (isNew) {
      logActivity(`${next.repairNumber} repair created`);
      audit('repair.create', 'repair', next.id, undefined, { repairNumber: next.repairNumber, status: next.status });
    } else {
      audit('repair.edit', 'repair', next.id);
      if (prev && prev.status !== next.status) {
        logActivity(`${next.repairNumber} → ${next.status.replace(/_/g, ' ')}`);
        audit('repair.status_change', 'repair', next.id, { status: prev.status }, { status: next.status });
        if (next.status === 'completed') audit('repair.completed', 'repair', next.id);
      }
      if (prev && prev.repairPrice !== next.repairPrice) audit('repair.price_change', 'repair', next.id, { repairPrice: prev.repairPrice }, { repairPrice: next.repairPrice });
      if (prev && (prev.customerName !== next.customerName || prev.customerPhone !== next.customerPhone)) audit('repair.customer_update', 'repair', next.id);
    }
    return notice;
  };

  // Technician-scoped update: only the whitelisted work fields + status are
  // persisted, and each change is audited. Used by TechRepairsView. The actual
  // write goes through the techUpdateRepair Cloud Function, not a direct
  // Firestore write — firestore.rules no longer lets a technician set
  // completedAt/warrantyUntil directly (a technician could otherwise backdate
  // completion via dev tools to inflate their own turnaround stats, or set an
  // arbitrary warranty date), so that callable re-derives both server-side and
  // applies the same TECH_EDITABLE_FIELDS whitelist as applyTechEdit below.
  // `next` here is only a local, immediate view for the auto-inventory/audit
  // logic that follows — it never carries completedAt/warrantyUntil itself.
  const handleTechUpdateRepair = (stored: Repair, draft: Partial<Repair>) => {
    if (!uid || !allow('repairs.tech')) return;
    const next = applyTechEdit(stored, draft);
    techUpdateRepair(stored.id, draft).catch(e => console.error('Tech repair update failed', e));
    // Auto-inventory devices become sellable once their ticket completes (same
    // rule as handleSaveRepair — see spec point 5).
    if ((next.status === 'picked_up' || next.status === 'completed') && next.inventoryAutoCreated !== undefined && next.inventoryId) {
      const invItem = dataRef.current.find(i => i.id === next.inventoryId);
      if (invItem && invItem.deviceStatus !== 'ready') saveItem(uid, 'inventory', { ...invItem, deviceStatus: 'ready' });
    }
    if (stored.status !== next.status) {
      logActivity(`${next.repairNumber} → ${next.status.replace(/_/g, ' ')}`);
      audit('repair.status_change', 'repair', next.id, { status: stored.status }, { status: next.status });
    }
    // Audit each changed work field (before → after) for full traceability.
    for (const f of TECH_EDITABLE_FIELDS) {
      if (f === 'status') continue;
      const b = (stored as any)[f], a = (next as any)[f];
      const changed = f === 'testChecks' ? (b || []).join('|') !== (a || []).join('|') : b !== a;
      if (changed) audit(`repair.tech.${f}`, 'repair', next.id, { [f]: b }, { [f]: a });
    }
  };

  const handleDeleteRepair = (id: string) => {
    if (!uid || appUser?.role !== 'owner') return;
    const t = repairsRef.current.find(r => r.id === id);
    if (t) cleanupOrphanedAutoInventory(t);
    audit('repair.delete', 'repair', id, t);
    deleteItem(uid, 'repairs', id);
  };

  const handleSaveBatch = (batch: RepairBatch, prev?: RepairBatch) => {
    if (!uid || !allow('repairs.manage')) return;
    const isNew = !repairBatchesRef.current.some(b => b.id === batch.id);
    const next: RepairBatch = { ...batch };
    if (next.companyName && !next.businessId) {
      const cust: Customer = { id: newId(), name: next.companyName, phone: next.phone || '', email: next.email, kind: 'wholesale', company: next.companyName, contactPerson: next.contactPerson };
      saveItem(uid, 'customers', cust);
      next.businessId = cust.id;
    }
    saveItem(uid, 'repairBatches', next);
    if (isNew) { logActivity(`${next.batchNumber} batch created`); audit('batch.create', 'repairBatch', next.id, undefined, { batchNumber: next.batchNumber }); }
    else {
      audit('batch.edit', 'repairBatch', next.id);
      if (prev && prev.status !== next.status) { logActivity(`${next.batchNumber} → ${next.status}`); audit('batch.status_change', 'repairBatch', next.id, { status: prev.status }, { status: next.status }); }
    }
  };

  const handleDeleteBatch = (id: string) => {
    if (!uid || appUser?.role !== 'owner') return;
    // Capture the batch before it's gone from live data — the audit log is the
    // only place its details will still exist afterward.
    const t = repairBatchesRef.current.find(b => b.id === id);
    audit('batch.delete', 'repairBatch', id, t);
    repairsRef.current.filter(r => r.batchId === id).forEach(r => { cleanupOrphanedAutoInventory(r); deleteItem(uid, 'repairs', r.id); });
    deleteItem(uid, 'repairBatches', id);
  };

  const handleRecordBatchPayment = (batch: RepairBatch, amount: number) => {
    if (!uid || !allow('repairs.manage') || !(amount > 0)) return;
    const next: RepairBatch = { ...batch, amountPaid: (batch.amountPaid || 0) + amount };
    saveItem(uid, 'repairBatches', next);
    audit('batch.payment', 'repairBatch', batch.id, { amountPaid: batch.amountPaid }, { amountPaid: next.amountPaid });
    logActivity(`${batch.batchNumber} payment $${amount.toFixed(2)}`);
  };

  const handleRepairPrintAudit = (entityType: string, id: string, docName: string) => {
    audit('invoice.printed', entityType, id, undefined, { doc: docName });
  };

  // Customer profile edits (notes / tags / preferred contact / basic fields).
  const handleSaveCustomer = (customer: Customer, prev?: Customer) => {
    if (!uid) return;
    saveItem(uid, 'customers', customer);
    audit('customer.update', 'customer', customer.id, prev, customer);
  };

  // Merge duplicate customers: keep the primary, relink every linked record, and
  // delete the duplicate customer docs. (See domain/customers.planMerge.)
  const handleMergeCustomers = (plan: MergePlan) => {
    if (!uid || !(allow('sales.complete') || allow('repairs.manage'))) return;
    const pid = plan.customer.id;
    saveItem(uid, 'customers', plan.customer);
    plan.reassignSales.forEach(id => { const t = salesTransactions.find(x => x.id === id); if (t) saveItem(uid, 'salesTransactions', { ...t, customerId: pid, customerPhone: plan.customer.phone, customerEmail: plan.customer.email }); });
    plan.reassignRepairs.forEach(id => { const r = repairs.find(x => x.id === id); if (r) saveItem(uid, 'repairs', { ...r, customerId: pid, customerPhone: plan.customer.phone, customerEmail: plan.customer.email }); });
    plan.reassignBatches.forEach(id => { const b = repairBatches.find(x => x.id === id); if (b) saveItem(uid, 'repairBatches', { ...b, businessId: pid }); });
    // Capture the deleted duplicates' identifying fields before removal — once
    // deleted they're gone from live data, so the audit log is the only record.
    const removed = plan.removeIds.map(id => {
      const c = customers.find(x => x.id === id);
      return { id, name: c?.name, phone: c?.phone };
    });
    plan.removeIds.forEach(id => deleteItem(uid, 'customers', id));
    audit('customer.merge', 'customer', pid, { removed }, { keptId: pid, linked: plan.reassignSales.length + plan.reassignRepairs.length + plan.reassignBatches.length });
  };

  // Quick actions from a customer profile: seed the target view with the customer.
  const startSaleFor = (c: Customer) => { setPrefillCustomer(c); navigate('pos'); };
  const createRepairFor = (c: Customer) => { setPrefillCustomer(c); navigate('repairs'); };
  // Check out a retail repair through Quick Sale: hand the repair to the POS view,
  // which pre-seeds the cart with its service line + customer.
  const checkoutRepairViaSale = (r: Repair) => { setPrefillRepairSale(r); navigate('pos'); };

  // Start an internal repair ticket for a shop-owned device, prefilled from the
  // inventory row and linked via inventoryId. Cost/price is NOT synced back to
  // the item — the link is for visibility only; the owner sets the item's repair
  // cost manually later after reviewing the technician's notes.
  const handleCreateInternalRepair = (item: InventoryItem) => {
    if (!allow('repairs.manage')) return;
    const repair: Repair = {
      id: newId(), repairNumber: '', type: 'internal', inventoryId: item.id,
      createdAt: Date.now(), date: new Date().toISOString().split('T')[0],
      deviceType: item.deviceType, brand: item.brand || '', model: item.model || item.item || '',
      storage: item.storage, color: item.color, imei: item.imei || '',
      issue: '', repairPrice: 0, status: 'received',
    };
    setPrefillRepair(repair);
    navigate('repairs');
  };
  // Open an existing repair ticket in the Repairs view (e.g. the one linked to a device).
  const handleOpenRepair = (repairId: string) => { setFocusRepairId(repairId); navigate('repairs'); };

  const handleStartAdd = () => {
    setEditingItem(undefined);
    setView('entry');
  };

  if (isLoadingAuth) {
    return <LoadingScreen message="Loading…" />;
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
    return <DbErrorScreen message={dbError} onRetry={reconnect} onSignOut={handleLock} />;
  }
  if (roleLoading || dbLoading || !appUser) {
    return roleLoading || !appUser
      ? <LoadingScreen message="Signing you in…" />
      : <LoadingSkeleton message="Loading your inventory…" />;
  }

  // --- AUTO-LOCK: nothing else renders while locked (app-wide, every role) ---
  // Not an overlay hiding content behind it — an early return, so there is
  // nothing in the DOM to inspect/bypass. Browser back only changes `view`
  // state underneath, which this replaces outright regardless of its value.
  if (appLocked) {
    return <LockScreen me={appUser} onUnlockWithPin={handleUnlockWithPin} onUnlockWithPassword={handleUnlockWithPassword} onSignOut={handleLock} />;
  }

  // --- Technician: simplified, repair-only experience (same workspace) ---
  if (appUser.role === 'technician') {
    return (
      <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 pb-10 flex flex-col transition-colors duration-200">
        <AppHeader
          isTech
          view="repairs"
          onNavigate={navigate}
          allow={allow}
          userEmail={appUser.email}
          userRole={appUser.role}
          darkMode={darkMode}
          onToggleTheme={() => setDarkMode(!darkMode)}
          onToggleAiSidebar={() => {}}
          onOpenFinder={() => {}}
          onOpenSettings={() => {}}
          onOpenBulk={() => {}}
          onStartAdd={() => {}}
          onLock={handleLock}
        />
        <main className="mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 w-full max-w-6xl">
          <TechRepairsView
            repairs={repairs}
            batches={repairBatches}
            auditLogs={auditLogs}
            onTechUpdate={handleTechUpdateRepair}
            onPrintAudit={handleRepairPrintAudit}
          />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 pb-20 flex flex-col transition-colors duration-200 relative">
      {/* Header */}
      <AppHeader
        view={view}
        onNavigate={navigate}
        allow={allow}
        pageTitle={PAGE_TITLES[view]}
        onOpenDrawer={() => setDrawerOpen(true)}
        userEmail={appUser.email}
        userRole={appUser.role}
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode(!darkMode)}
        onToggleAiSidebar={() => setIsAiSidebarOpen(!isAiSidebarOpen)}
        onOpenFinder={() => setShowFinder(true)}
        onOpenSettings={() => navigate('settings')}
        onOpenBulk={() => setShowBulkModal(true)}
        onStartAdd={handleStartAdd}
        onLock={handleLock}
        activity={activityLog}
        alerts={alerts}
        notifSeenTs={appUser.notifSeenTs ?? 0}
        onMarkNotificationsSeen={handleMarkNotificationsSeen}
      />

      {/* Mobile slide-out nav (all destinations + actions) */}
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        view={view}
        onNavigate={navigate}
        allow={allow}
        userRole={appUser.role}
        userEmail={appUser.email}
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode(!darkMode)}
        onOpenFinder={() => setShowFinder(true)}
        onOpenSettings={() => navigate('settings')}
        onOpenBulk={() => setShowBulkModal(true)}
        onLock={handleLock}
      />

      {/* Mobile bottom navigation (top 5 destinations) */}
      <MobileNav view={view} onNavigate={navigate} allow={allow} onOpenMore={() => setDrawerOpen(true)} />

      {/* Floating calculator button — persistent on every page. Sits above the
          mobile bottom nav (bottom-0), and is hidden only on the mobile Quick
          Sale screen, whose own fixed action bar would otherwise clash with it. */}
      {!(isMobile && view === 'pos') && !showCalculator && (
        <button
          onClick={() => setShowCalculator(true)}
          aria-label="Open calculator" title="Calculator"
          className="fixed right-4 bottom-20 md:right-6 md:bottom-6 z-40 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/30 flex items-center justify-center transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <Calculator className="w-6 h-6" />
        </button>
      )}

      {/* Main Content */}
      <main className={`mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 flex-1 w-full flex flex-col ${view === 'grid' || view === 'ai' ? 'max-w-[98%]' : 'max-w-7xl'}`}>
        <div className="animate-fadeIn flex-1 flex flex-col">
          <Suspense fallback={<ViewLoader />}>
          {view === 'dashboard' && (
            allow('reports.view')
              ? <Dashboard data={data} salesTransactions={salesTransactions} activity={activityLog} repairs={repairs} repairBatches={repairBatches} canViewProfit={allow('reports.profit.summary')} onViewAnalytics={() => navigate('analytics')} onViewRepairs={allow('repairs.manage') ? () => navigate('repairs') : undefined} />
              : <div className="text-center text-slate-400 py-20">You don't have access to reports.</div>
          )}
          {view === 'analytics' && (
            (appUser.role === 'owner' || appUser.role === 'manager') && allow('reports.profit.detailed')
              ? <OwnerAnalytics salesTransactions={salesTransactions} repairs={repairs} inventory={data} customers={customers} auditLogs={auditLogs} activity={activityLog} darkMode={darkMode} />
              : <div className="text-center text-slate-400 py-20">Owner analytics are restricted to owners (and managers granted financial access).</div>
          )}
          {view === 'reports' && (
            allow('cash.reconcile')
              ? <ReportsView salesTransactions={salesTransactions} cashReconciliations={cashReconciliations} inventory={data} payPeriods={payPeriods} settlements={settlements} runners={runners} onSaveReconciliation={handleSaveReconciliation} defaultOpeningFloat={settings.operations.openingFloatDefault}
                  repairs={repairs} customers={customers} auditLogs={auditLogs} activity={activityLog} timeEntries={timeEntries} users={workspaceUsers} />
              : <div className="text-center text-slate-400 py-20">Reports are restricted to owners and managers.</div>
          )}
          {view === 'customers' && allow('reports.view') && (
            <CustomersView
              customers={customers}
              salesTransactions={salesTransactions}
              repairs={repairs}
              batches={repairBatches}
              inventory={data}
              auditLogs={auditLogs}
              canViewProfit={allow('reports.profit.detailed')}
              canEdit={allow('sales.complete') || allow('repairs.manage')}
              initialCustomerId={focusCustomerId}
              onConsumeInitial={() => setFocusCustomerId(undefined)}
              onSaveCustomer={handleSaveCustomer}
              onMergeCustomers={handleMergeCustomers}
              onStartSale={allow('sales.complete') ? startSaleFor : undefined}
              onCreateRepair={allow('repairs.manage') ? createRepairFor : undefined}
              onVoidSale={allow('sales.void') ? handleVoidSale : undefined}
              canVoidSale={(tx) => allow('sales.void') && canVoidSale(tx, new Date().toISOString().split('T')[0], settings.operations.voidWindowDays)}
              onReturnSale={allow('sales.return') ? handleReturnSale : undefined}
              canReturnSale={(tx) => allow('sales.return') && canReturnSale(tx, new Date().toISOString().split('T')[0], settings.operations.voidWindowDays)}
              defaultRestockingFeePercent={settings.operations.returnRestockingFeePercent}
            />
          )}
          {view === 'repairs' && allow('repairs.manage') && (
            <RepairsView
              repairs={repairs}
              batches={repairBatches}
              customers={customers}
              auditLogs={auditLogs}
              canDelete={appUser.role === 'owner'}
              userId={appUser.id}
              initialCustomer={prefillCustomer}
              initialRepairId={focusRepairId}
              initialNewRepair={prefillRepair}
              onConsumeInitial={() => { setPrefillCustomer(undefined); setFocusRepairId(undefined); setPrefillRepair(undefined); }}
              onGenerateRepairNumber={handleGenRepairNumber}
              onGenerateBatchNumber={handleGenBatchNumber}
              onSaveRepair={handleSaveRepair}
              onCheckoutViaSale={allow('sales.complete') ? checkoutRepairViaSale : undefined}
              onDeleteRepair={handleDeleteRepair}
              onSaveBatch={handleSaveBatch}
              onDeleteBatch={handleDeleteBatch}
              onRecordPayment={handleRecordBatchPayment}
              onPrintAudit={handleRepairPrintAudit}
              users={workspaceUsers}
              canViewPerformance={allow('repairs.performance')}
            />
          )}
          {(view === 'entry' || view === 'edit') && (
            <DataEntryForm 
              initialData={editingItem} 
              onSave={handleSaveItem}
              onCancel={() => navigate('grid')}
            />
          )}
          {view === 'grid' && (
            <InventoryView
              inventory={data}
              runners={runners}
              activity={activityLog}
              auditLogs={auditLogs}
              canViewCost={allow('reports.profit.detailed')}
              userId={appUser.id}
              section={invSection}
              onSelectSection={goInventory}
              onSave={handleSaveInventoryItem}
              onUpdate={handleUpdateItem}
              onDelete={handleDeleteItem}
              onGenerateSku={handleGenerateSku}
              onSeed={handleSeedSampleData}
              repairs={repairs}
              onCreateRepair={allow('repairs.manage') ? handleCreateInternalRepair : undefined}
              onOpenRepair={allow('repairs.tech') ? handleOpenRepair : undefined}
            />
          )}
          {view === 'pos' && (
            <QuickSaleView
              inventory={data}
              customers={customers}
              repairs={repairs}
              initialCustomer={prefillCustomer}
              onConsumeInitial={() => setPrefillCustomer(undefined)}
              initialRepair={prefillRepairSale ? repairSalePrefill(prefillRepairSale) : undefined}
              onConsumeInitialRepair={() => setPrefillRepairSale(undefined)}
              onSellCart={handleSellCart}
              canViewProfit={allow('reports.profit.detailed')}
              onGenerateSku={(deviceType) => handleGenerateSku('device', deviceType)}
              cashDrawer={allow('cash.log') ? todayDrawer : undefined}
              onOpenDrawer={allow('cash.log') ? () => setShowOpenDrawer(true) : undefined}
              onLogCash={allow('cash.log') ? (kind) => setCashLogKind(kind) : undefined}
              onCloseDrawer={allow('cash.reconcile') ? () => setShowCloseDrawer(true) : undefined}
              reconciledToday={!!todayRecon?.reconciledAt}
              onCartDirtyChange={(d) => { cartDirtyRef.current = d; }}
            />
          )}
          {view === 'quickpurchase' && (
            <QuickPurchaseView inventory={data} onSave={handleQuickPurchase} />
          )}
          {view === 'dropoff' && (
            <DropOffView
              runners={runners}
              dropOffs={dropOffs}
              settlements={settlements}
              onRunnersChange={saveRunners}
              onDropOffsChange={saveDropOffs}
              onSettle={handleSettleRunner}
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
            allow('reports.profit.summary')
              ? <AIChatView
                  inventory={data}
                  messages={aiMessages}
                  onUpdateMessages={setAiMessages}
                />
              : <div className="text-center text-slate-400 py-20">The AI Assistant is restricted to accounts with profit visibility.</div>
          )}
          {view === 'users' && allow('users.tech') && (
            <UsersView
              me={appUser}
              users={workspaceUsers}
              invites={invites}
              canManageAll={allow('users.manage')}
              onSetRole={handleSetRole}
              onSetDisabled={handleSetDisabled}
              onSetAllowProfit={handleSetAllowProfit}
              onSetHourlyRate={allow('users.manage') ? handleSetHourlyRate : undefined}
              onInvite={handleInvite}
              onDeleteInvite={handleDeleteInvite}
              onSetPin={allow('users.pin') ? handleSetPin : undefined}
              canManageSecurity={allow('security.manage')}
              autoLockMinutes={settings.operations.autoLockMinutes}
              onSetAutoLockMinutes={allow('security.manage') ? handleSetAutoLockMinutes : undefined}
              staffNotes={staffNotes}
              canManageStaffNotes={allow('staffNotes.manage')}
              onAddStaffNote={allow('staffNotes.manage') ? handleAddStaffNote : undefined}
              onDeleteStaffNote={allow('staffNotes.manage') ? handleDeleteStaffNote : undefined}
            />
          )}
          {view === 'timeclock' && allow('timeclock.use') && (
            <TimeClockView
              me={appUser}
              users={workspaceUsers}
              entries={timeEntries}
              payPeriods={payPeriods}
              canManagePayroll={allow('payroll.manage')}
              canMarkPaid={appUser.role === 'owner'}
              onClockIn={handleClockIn}
              onClockOut={handleClockOut}
              onStartBreak={handleStartBreak}
              onEndBreak={handleEndBreak}
              onMarkPaid={handleMarkPaid}
              onUnmarkPaid={handleUnmarkPaid}
              onCorrectClockOut={handleCorrectClockOut}
            />
          )}
          {view === 'closeout' && allow('closeout.view') && (
            <CloseOutView
              salesTransactions={salesTransactions}
              repairs={repairs}
              inventory={data}
              customers={customers}
              auditLogs={auditLogs}
              activity={activityLog}
              timeEntries={timeEntries}
              users={workspaceUsers}
              alerts={alerts}
              todayDrawer={todayDrawer}
              todayRecon={todayRecon}
              onNavigate={navigate}
            />
          )}
          {view === 'audit' && allow('audit.view') && (
            <AuditLogView logs={auditLogs} users={workspaceUsers} onLoadMore={loadMoreAuditLogs} hasMore={auditHasMore} />
          )}
          {view === 'settings' && (
            <SettingsView
              settings={settings}
              onSave={handleSaveSettings}
              canManage={allow('settings.manage')}
              role={appUser.role}
              loadBackupHistory={appUser.role === 'owner' && workspaceId ? () => listWorkspaceBackups(workspaceId) : undefined}
              onDownloadBackup={(path) => { getBackupDownloadUrl(path).then(url => window.open(url, '_blank', 'noopener')).catch(() => {}); }}
              backupSlot={
                <div className="space-y-3">
                  {allow('backup.export') && (
                    <BackupPanel lastBackup={lastBackup} onExportJson={handleExportJson} onExportCsv={handleExportCsv} />
                  )}
                  {allow('settings.manage') && (
                    <button
                      onClick={() => setShowSettingsModal(true)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg text-sm font-medium">
                      Restore or import a backup…
                    </button>
                  )}
                </div>
              }
            />
          )}
          </Suspense>
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
             <Suspense fallback={<ViewLoader />}>
               <AIChatView
                  inventory={data}
                  messages={aiMessages}
                  onUpdateMessages={setAiMessages}
                  variant="sidebar"
                  onClose={() => setIsAiSidebarOpen(false)}
               />
             </Suspense>
          </div>
        </>
      )}

      {/* Calculator Overlay */}
      {showCalculator && <Suspense fallback={null}><CalculatorTool onClose={() => setShowCalculator(false)} /></Suspense>}

      {cashLogKind && allow('cash.log') && (
        <Suspense fallback={null}>
          <LogCashMovementModal onClose={() => setCashLogKind(null)} onLog={handleLogCashMovement} initialKind={cashLogKind} expectedBefore={todayDrawer.expected} />
        </Suspense>
      )}

      {showOpenDrawer && allow('cash.log') && (
        <Suspense fallback={null}>
          <OpenDrawerModal onClose={() => setShowOpenDrawer(false)} onOpen={handleOpenDrawer}
            defaultFloat={settings.operations.openingFloatDefault}
            alreadyOpen={!!todayRecon?.openedAt} currentFloat={todayRecon?.openingFloat} />
        </Suspense>
      )}

      {showCloseDrawer && allow('cash.reconcile') && (
        <Suspense fallback={null}>
          <CloseDrawerModal onClose={() => setShowCloseDrawer(false)} onCloseDrawer={handleCloseDrawer} summary={todayDrawer}
            alreadyReconciled={todayRecon?.reconciledAt ? {
              countedCash: todayRecon.countedCash || 0, variance: todayRecon.variance,
              byEmail: todayRecon.reconciledByEmail, at: todayRecon.reconciledAt,
            } : undefined} />
        </Suspense>
      )}

      {/* Modals */}
      {showBulkModal && (
        <Suspense fallback={null}>
          <BulkEntryModal
            onClose={() => setShowBulkModal(false)}
            onImport={handleBulkImport}
          />
        </Suspense>
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

      <GlobalSearch
        open={showFinder}
        onClose={() => setShowFinder(false)}
        data={searchData}
        canViewCost={allow('reports.profit.detailed')}
        onSelect={handleSearchSelect}
      />
    </div>
  );
};

export default App;
