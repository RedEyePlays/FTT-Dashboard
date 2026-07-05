
import React, { useState, useEffect } from 'react';
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
import { InventoryItem, ViewState, Note, Task, AppData, ChatMessage, Runner, DropOff, Settlement, ItemKind, DeviceType, ActivityEntry, Customer, WorkspaceInvite, Role, Permission } from './types';
import { skuPrefix, nextSku } from './services/sku';
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
import { LoadingScreen, DbErrorScreen } from './components/StatusScreens';

const App: React.FC = () => {
  // --- DATA LAYER (auth, role/workspace, Firestore subscriptions) ---
  const {
    user, isLoadingAuth, authError, setAuthError,
    appUser, roleLoading, workspaceId, workspaceUsers, invites, auditLogs,
    data, notes, setNotes, tasks, setTasks,
    runners, dropOffs, settlements,
    skuCounters, setSkuCounters, activityLog, lastBackup,
    dbLoading, dbError, reconnect,
    runnersRef, dropOffsRef, settlementsRef, customersRef, salesTransactionsRef, skuRef, dataRef,
  } = useWorkspaceData();

  // --- UI STATE ---
  const [view, setView] = useState<ViewState>('dashboard');

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

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 pb-20 flex flex-col transition-colors duration-200 relative">
      {/* Header */}
      <AppHeader
        view={view}
        onNavigate={setView}
        allow={allow}
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

      {/* Mobile Navigation */}
      <MobileNav
        view={view}
        onNavigate={setView}
        onStartAdd={handleStartAdd}
        onOpenAiSidebar={() => setIsAiSidebarOpen(true)}
        showCalculator={showCalculator}
        onToggleCalculator={() => setShowCalculator(!showCalculator)}
      />

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
