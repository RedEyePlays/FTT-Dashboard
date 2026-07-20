
import React, { useState, useEffect, useMemo } from 'react';
import { Dashboard } from './components/Dashboard';
import { OwnerAnalytics } from './components/OwnerAnalytics';
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
import { GlobalSearch } from './components/GlobalSearch';
import { SearchData, SearchResult, SearchPage } from './domain/search';
import { DropOffView } from './components/DropOffView';
import { InventoryView } from './components/InventoryView';
import { UsersView } from './components/UsersView';
import { AuditLogView } from './components/AuditLogView';
import { InventoryItem, ViewState, Note, Task, AppData, ChatMessage, Runner, DropOff, Settlement, ItemKind, DeviceType, ActivityEntry, Customer, WorkspaceInvite, Role, Permission, Repair, RepairBatch } from './types';
import { skuPrefix, nextSku } from './services/sku';
import { REPAIR_PREFIX, BATCH_PREFIX, computeWarrantyUntil, applyTechEdit, TECH_EDITABLE_FIELDS } from './domain/repairs';
import { RepairsView } from './components/RepairsView';
import { TechRepairsView } from './components/TechRepairsView';
import { CustomersView } from './components/CustomersView';
import { MergePlan } from './domain/customers';
import { can } from './services/rbac';
import { downloadJson, toCSV, triggerDownload } from './services/backup';
import { INITIAL_DATA } from './constants';
import { auth } from './services/firebase';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import {
  saveMeta, saveItem, deleteItem, syncArray,
  logActivityDoc, commitSale, seedSampleData,
  updateUserDoc, setInvite, deleteInvite,
  logAudit, exportWorkspaceData, recordBackup,
} from './services/firestoreDb';
import { useWorkspaceData } from './hooks/useWorkspaceData';
import { newId, mkActivity } from './domain/ids';
import { collectionFor, decrementStock } from './domain/inventory';
import { AppHeader } from './components/AppHeader';
import { MobileNav } from './components/MobileNav';
import { MobileDrawer } from './components/MobileDrawer';

// Page titles for the mobile header bar.
const PAGE_TITLES: Record<ViewState, string> = {
  dashboard: 'Dashboard', analytics: 'Analytics', entry: 'Add Item', edit: 'Edit Item',
  grid: 'Inventory', notes: 'Notes', ai: 'AI Assistant', pos: 'Checkout', dropoff: 'Drop-Offs',
  repairs: 'Repairs', customers: 'Customers', users: 'Users', audit: 'Audit Log',
};
import { LoadingScreen, DbErrorScreen } from './components/StatusScreens';

const App: React.FC = () => {
  // --- DATA LAYER (auth, role/workspace, Firestore subscriptions) ---
  const {
    user, isLoadingAuth, authError, setAuthError,
    appUser, roleLoading, workspaceId, workspaceUsers, invites, auditLogs,
    data, notes, setNotes, tasks, setTasks,
    runners, dropOffs, settlements, salesTransactions, customers, repairs, repairBatches,
    skuCounters, setSkuCounters, activityLog, lastBackup,
    dbLoading, dbError, reconnect,
    runnersRef, dropOffsRef, settlementsRef, customersRef, salesTransactionsRef,
    repairsRef, repairBatchesRef, skuRef, dataRef,
  } = useWorkspaceData();

  // --- UI STATE ---
  const [view, setView] = useState<ViewState>('dashboard');
  // A customer to pre-seed the POS / Repairs view with (from a CRM quick action).
  const [prefillCustomer, setPrefillCustomer] = useState<Customer | undefined>(undefined);
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

  // --- Global Search: permission-scoped data (empty categories = no results) ---
  const canAnalytics = (appUser?.role === 'owner' || appUser?.role === 'manager') && allow('reports.profit');
  const searchPages: SearchPage[] = useMemo(() => {
    const p: SearchPage[] = [{ id: 'dashboard', label: 'Dashboard', keywords: 'home overview', view: 'dashboard' }];
    if (canAnalytics) p.push({ id: 'analytics', label: 'Analytics', keywords: 'reports owner profit', view: 'analytics' });
    p.push({ id: 'grid', label: 'Inventory', keywords: 'stock devices accessories', view: 'grid' });
    p.push({ id: 'pos', label: 'Checkout', keywords: 'sell quick sale pos sales', view: 'pos' });
    if (allow('repairs.tech')) p.push({ id: 'repairs', label: 'Repairs', keywords: 'tickets', view: 'repairs' });
    if (allow('reports.view')) p.push({ id: 'customers', label: 'Customers', keywords: 'crm clients', view: 'customers' });
    if (allow('dropoffs.manage')) p.push({ id: 'dropoff', label: 'Drop-Offs', view: 'dropoff' });
    if (allow('audit.view')) p.push({ id: 'audit', label: 'Audit Log', view: 'audit' });
    if (allow('users.tech')) p.push({ id: 'users', label: 'Users', keywords: 'staff roles permissions', view: 'users' });
    p.push({ id: 'notes', label: 'Notes', view: 'notes' });
    p.push({ id: 'ai', label: 'AI Assistant', view: 'ai' });
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

  const handleSearchSelect = (r: SearchResult) => {
    setShowFinder(false);
    switch (r.type) {
      case 'page': if (r.action === 'settings') setShowSettingsModal(true); else if (r.view) setView(r.view); break;
      case 'inventory': { const it = data.find(i => i.id === r.itemId); if (it) { setEditingItem(it); setView('edit'); } break; }
      case 'repair': setFocusRepairId(r.itemId); setView('repairs'); break;
      case 'customer': setFocusCustomerId(r.itemId); setView('customers'); break;
      case 'sale': if (r.customerId) { setFocusCustomerId(r.customerId); setView('customers'); } break;
      case 'user': setView('users'); break;
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

  // --- Inventory writes go straight to Firestore; live subs update the UI ---
  const handleSaveItem = (item: InventoryItem) => {
    const isNew = !dataRef.current.some(i => i.id === item.id);
    if (uid && (isNew ? allow('inventory.add') : allow('inventory.edit'))) {
      if (isNew) { logActivity(`${item.sku || item.item || 'Item'} added`); audit('inventory.add', collectionFor(item), item.id, undefined, item); }
      else audit('inventory.edit', collectionFor(item), item.id);
      saveItem(uid, collectionFor(item), item);
    }
    setView('grid');
    setEditingItem(undefined);
  };

  const handleDeleteItem = (id: string) => {
    if (!uid || !allow('inventory.delete')) return;
    const target = dataRef.current.find(i => i.id === id);
    audit('inventory.delete', target ? collectionFor(target) : 'inventory', id, target);
    deleteItem(uid, target ? collectionFor(target) : 'inventory', id);
  };

  // Update single field (inline edit)
  const handleUpdateItem = (id: string, field: keyof InventoryItem, value: any) => {
    if (!uid || !allow('inventory.edit')) return;
    const target = dataRef.current.find(i => i.id === id);
    if (!target) return;
    const label = target.sku || target.item || id;
    if (field === 'deviceStatus') logActivity(`${label} marked ${String(value).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`);
    else if (field === 'quantity') { logActivity(`${label} quantity updated`); audit('accessory.quantity', collectionFor(target), id, { quantity: target.quantity }, { quantity: value }); }
    audit('inventory.edit', collectionFor(target), id, { [field]: (target as any)[field] }, { [field]: value });
    saveItem(uid, collectionFor(target), { ...target, [field]: value });
  };

  // Update an entire row
  const handleUpdateRow = (updatedItem: InventoryItem) => { if (uid && allow('inventory.edit')) saveItem(uid, collectionFor(updatedItem), updatedItem); };

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
    if (isNew) { logActivity(`${item.sku || item.item || 'Item'} added`); audit('inventory.add', collectionFor(item), item.id, undefined, item); }
    else audit('inventory.edit', collectionFor(item), item.id);
    saveItem(uid, collectionFor(item), item);
  };

  // Sell a cart: mark devices sold in Firestore, decrement accessory quantities,
  // create a sales transaction + customer, log activity — one atomic commit.
  const handleSellCart = (payload: CartCheckout) => {
    if (!uid || !allow('sales.complete')) return;
    audit('sale.complete', 'sale', payload.transaction.id, undefined, { totalPaid: payload.transaction.totalPaid, lines: payload.transaction.lines.length });
    const accessoryUpdates = Object.entries(payload.accessoryQtys).map(([id, soldQty]) => {
      const acc = dataRef.current.find(i => i.id === id);
      return { id, quantity: decrementStock(acc?.quantity, soldQty) };
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
      saveItem(uid, collectionFor(withSku), withSku);
      logActivity(`${withSku.sku || withSku.item} added from custom sale`);
    });
  };

  const handleBulkImport = (items: InventoryItem[]) => {
    if (uid) items.forEach(it => saveItem(uid, collectionFor(it), it));
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
    await syncArray(uid, 'customers', restoredData.customers || [], customersRef.current);
    await syncArray(uid, 'salesTransactions', restoredData.salesTransactions || [], salesTransactionsRef.current);
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
    const before = targetRoleOf(targetUid);
    updateUserDoc(targetUid, { role }).catch(() => {});
    audit('user.role_change', 'user', targetUid, { role: before }, { role });
  };
  const handleSetDisabled = (targetUid: string, disabled: boolean) => {
    if (targetUid === appUser?.id || !canActOnUser(targetRoleOf(targetUid))) return;
    updateUserDoc(targetUid, { disabled }).catch(() => {});
    audit(disabled ? 'user.disable' : 'user.enable', 'user', targetUid);
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
  const genNumber = (prefix: string, used: string[]): string => {
    const existing = used.map(sku => ({ sku })) as any;
    const { sku, counters } = nextSku(prefix, skuRef.current, existing);
    skuRef.current = counters; setSkuCounters(counters);
    if (uid) saveMeta(uid, { skuCounters: counters });
    return sku;
  };
  const handleGenRepairNumber = () => genNumber(REPAIR_PREFIX, repairsRef.current.map(r => r.repairNumber));
  const handleGenBatchNumber = () => genNumber(BATCH_PREFIX, repairBatchesRef.current.map(b => b.batchNumber));

  const handleSaveRepair = (repair: Repair, prev?: Repair) => {
    if (!uid || !allow('repairs.manage')) return;
    const isNew = !repairsRef.current.some(r => r.id === repair.id);
    let next: Repair = { ...repair };
    // Retail customer: create once, then reuse by customerId (builds history).
    if (next.type === 'retail' && next.customerName && !next.customerId) {
      const cust: Customer = { id: newId(), name: next.customerName, phone: next.customerPhone || '', email: next.customerEmail, kind: 'retail' };
      saveItem(uid, 'customers', cust);
      next.customerId = cust.id;
    }
    // Stamp completion + warranty when moving into completed.
    if (next.status === 'completed' && !next.completedAt) {
      const completedDate = new Date().toISOString().split('T')[0];
      next = { ...next, completedAt: Date.now(), warrantyUntil: computeWarrantyUntil(completedDate, next.warrantyDays) || undefined };
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
  };

  // Technician-scoped update: only the whitelisted work fields + status are
  // persisted (applyTechEdit), and each change is audited. Used by TechRepairsView.
  const handleTechUpdateRepair = (stored: Repair, draft: Partial<Repair>) => {
    if (!uid || !allow('repairs.tech')) return;
    let next = applyTechEdit(stored, draft);
    // Stamp completion + warranty when the device is picked up (terminal).
    if ((next.status === 'picked_up' || next.status === 'completed') && !next.completedAt) {
      const completedDate = new Date().toISOString().split('T')[0];
      next = { ...next, completedAt: Date.now(), warrantyUntil: computeWarrantyUntil(completedDate, next.warrantyDays) || undefined };
    }
    saveItem(uid, 'repairs', next);
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
    audit('batch.delete', 'repairBatch', id);
    repairsRef.current.filter(r => r.batchId === id).forEach(r => deleteItem(uid, 'repairs', r.id));
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
    plan.removeIds.forEach(id => deleteItem(uid, 'customers', id));
    audit('customer.merge', 'customer', pid, { removed: plan.removeIds }, { linked: plan.reassignSales.length + plan.reassignRepairs.length + plan.reassignBatches.length });
  };

  // Quick actions from a customer profile: seed the target view with the customer.
  const startSaleFor = (c: Customer) => { setPrefillCustomer(c); setView('pos'); };
  const createRepairFor = (c: Customer) => { setPrefillCustomer(c); setView('repairs'); };

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
    return <LoadingScreen message={roleLoading || !appUser ? 'Signing you in…' : 'Loading your inventory…'} />;
  }

  // --- Technician: simplified, repair-only experience (same workspace) ---
  if (appUser.role === 'technician') {
    return (
      <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 pb-10 flex flex-col transition-colors duration-200">
        <AppHeader
          isTech
          view="repairs"
          onNavigate={setView}
          allow={allow}
          userEmail={appUser.email}
          userRole={appUser.role}
          darkMode={darkMode}
          onToggleTheme={() => setDarkMode(!darkMode)}
          isAiSidebarOpen={false}
          onToggleAiSidebar={() => {}}
          showCalculator={false}
          onToggleCalculator={() => {}}
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
        onNavigate={setView}
        allow={allow}
        pageTitle={PAGE_TITLES[view]}
        onOpenDrawer={() => setDrawerOpen(true)}
        userEmail={appUser.email}
        userRole={appUser.role}
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode(!darkMode)}
        isAiSidebarOpen={isAiSidebarOpen}
        onToggleAiSidebar={() => setIsAiSidebarOpen(!isAiSidebarOpen)}
        showCalculator={showCalculator}
        onToggleCalculator={() => setShowCalculator(!showCalculator)}
        onOpenFinder={() => setShowFinder(true)}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenBulk={() => setShowBulkModal(true)}
        onStartAdd={handleStartAdd}
        onLock={handleLock}
      />

      {/* Mobile slide-out nav (all destinations + actions) */}
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        view={view}
        onNavigate={setView}
        allow={allow}
        userRole={appUser.role}
        userEmail={appUser.email}
        darkMode={darkMode}
        onToggleTheme={() => setDarkMode(!darkMode)}
        onOpenFinder={() => setShowFinder(true)}
        onOpenSettings={() => setShowSettingsModal(true)}
        onOpenBulk={() => setShowBulkModal(true)}
        onLock={handleLock}
      />

      {/* Mobile bottom navigation (top 5 destinations) */}
      <MobileNav view={view} onNavigate={setView} allow={allow} onOpenMore={() => setDrawerOpen(true)} />

      {/* Main Content */}
      <main className={`mx-auto px-3 sm:px-6 lg:px-8 py-6 sm:py-8 flex-1 w-full flex flex-col ${view === 'grid' || view === 'ai' ? 'max-w-[98%]' : 'max-w-7xl'}`}>
        <div className="animate-fadeIn flex-1 flex flex-col">
          {view === 'dashboard' && (
            allow('reports.view')
              ? <Dashboard data={data} salesTransactions={salesTransactions} activity={activityLog} repairs={repairs} repairBatches={repairBatches} canViewProfit={allow('reports.profit')} onViewAnalytics={() => setView('analytics')} onViewRepairs={allow('repairs.manage') ? () => setView('repairs') : undefined} />
              : <div className="text-center text-slate-400 py-20">You don't have access to reports.</div>
          )}
          {view === 'analytics' && (
            (appUser.role === 'owner' || appUser.role === 'manager') && allow('reports.profit')
              ? <OwnerAnalytics salesTransactions={salesTransactions} repairs={repairs} inventory={data} customers={customers} auditLogs={auditLogs} activity={activityLog} darkMode={darkMode} />
              : <div className="text-center text-slate-400 py-20">Owner analytics are restricted to owners (and managers granted financial access).</div>
          )}
          {view === 'customers' && allow('reports.view') && (
            <CustomersView
              customers={customers}
              salesTransactions={salesTransactions}
              repairs={repairs}
              batches={repairBatches}
              inventory={data}
              auditLogs={auditLogs}
              canViewProfit={allow('reports.profit')}
              canEdit={allow('sales.complete') || allow('repairs.manage')}
              initialCustomerId={focusCustomerId}
              onConsumeInitial={() => setFocusCustomerId(undefined)}
              onSaveCustomer={handleSaveCustomer}
              onMergeCustomers={handleMergeCustomers}
              onStartSale={allow('sales.complete') ? startSaleFor : undefined}
              onCreateRepair={allow('repairs.manage') ? createRepairFor : undefined}
            />
          )}
          {view === 'repairs' && allow('repairs.manage') && (
            <RepairsView
              repairs={repairs}
              batches={repairBatches}
              customers={customers}
              auditLogs={auditLogs}
              canDelete={appUser.role === 'owner'}
              initialCustomer={prefillCustomer}
              initialRepairId={focusRepairId}
              onConsumeInitial={() => { setPrefillCustomer(undefined); setFocusRepairId(undefined); }}
              onGenerateRepairNumber={handleGenRepairNumber}
              onGenerateBatchNumber={handleGenBatchNumber}
              onSaveRepair={handleSaveRepair}
              onDeleteRepair={handleDeleteRepair}
              onSaveBatch={handleSaveBatch}
              onDeleteBatch={handleDeleteBatch}
              onRecordPayment={handleRecordBatchPayment}
              onPrintAudit={handleRepairPrintAudit}
            />
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
              auditLogs={auditLogs}
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
              customers={customers}
              initialCustomer={prefillCustomer}
              onConsumeInitial={() => setPrefillCustomer(undefined)}
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
          {view === 'users' && allow('users.tech') && (
            <UsersView
              me={appUser}
              users={workspaceUsers}
              invites={invites}
              canManageAll={allow('users.manage')}
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

      <GlobalSearch
        open={showFinder}
        onClose={() => setShowFinder(false)}
        data={searchData}
        canViewCost={allow('reports.profit')}
        onSelect={handleSearchSelect}
      />
    </div>
  );
};

export default App;
