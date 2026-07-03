
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { LayoutDashboard, PlusCircle, Table, Activity, Sparkles, Moon, Sun, Lock, StickyNote, Settings, Calculator, Bot, MessageCircle, ShoppingCart, Search, Truck } from 'lucide-react';
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
import { InventoryItem, ViewState, Note, Task, AppData, ChatMessage, Runner, DropOff, Settlement, ItemKind, DeviceType, ActivityEntry, Customer, SalesTransaction } from './types';
import { skuPrefix, nextSku } from './services/sku';
import { INITIAL_DATA } from './constants';
import { decryptData } from './services/security';
import { auth, db } from './services/firebase';
import { onAuthChange } from './services/auth';
import { User, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import {
  subscribeCollection, subscribeMeta, saveMeta, saveItem, deleteItem, syncArray,
  logActivityDoc, commitSale, seedSampleData, migrateLegacyIfNeeded, CollName,
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
        setDbLoading(false);
      }
      setIsLoadingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  // Firestore real-time subscriptions (per collection) once signed in
  useEffect(() => {
    if (!user) return;
    const uid = user.uid;
    setDbLoading(true); setDbError(null);
    const onErr = (e: Error) => { console.error('Firestore error:', e); setDbError(e.message || 'Failed to load data'); setDbLoading(false); };

    let migrated = false;
    // One-time migration from the legacy encrypted blob, then rely on live subs.
    (async () => {
      try {
        const legacySnap = await getDoc(doc(db, 'user_data', uid));
        const enc = legacySnap.exists() ? (legacySnap.data() as any).data : null;
        if (enc && user.email) {
          try {
            const decrypted = decryptData(enc, user.email);
            migrated = await migrateLegacyIfNeeded(uid, decrypted);
          } catch { /* legacy pin mismatch — skip migration */ }
        }
      } catch (e) { /* non-fatal */ }
      finally { if (!migrated) setDbLoading(false); else setDbLoading(false); }
    })();

    const subs = [
      subscribeCollection<InventoryItem>(uid, 'inventory', rows => { setDevices(rows); setDbLoading(false); }, onErr),
      subscribeCollection<InventoryItem>(uid, 'accessories', setAccessories, onErr),
      subscribeCollection<Runner>(uid, 'runners', setRunners, onErr),
      subscribeCollection<DropOff>(uid, 'dropOffs', setDropOffs, onErr),
      subscribeCollection<Settlement>(uid, 'settlements', setSettlements, onErr),
      subscribeCollection<Customer>(uid, 'customers', setCustomers, onErr),
      subscribeCollection<SalesTransaction>(uid, 'salesTransactions', setSalesTransactions, onErr),
      subscribeCollection<ActivityEntry>(uid, 'activityLog', rows => setActivityLog(rows.sort((a, b) => b.ts - a.ts).slice(0, 60)), onErr),
      subscribeMeta(uid, m => { setNotes(m.notes || []); setTasks(m.tasks || []); setSkuCounters(m.skuCounters || {}); }, onErr),
    ];
    return () => subs.forEach(u => u());
  }, [user, reconnectKey]);

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

  const uid = user?.uid;

  // Write an activity entry to Firestore (Recent Activity is generated from DB changes)
  const logActivity = (text: string) => { if (uid) logActivityDoc(uid, mkActivity(text)).catch(() => {}); };

  // Seed sample data into Firestore (demo option only)
  const handleSeedSampleData = async () => {
    if (!uid) return;
    await seedSampleData(uid, INITIAL_DATA);
    logActivity('Sample data loaded');
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
    if (uid) { if (!dataRef.current.some(i => i.id === item.id)) logActivity(`${item.sku || item.item || 'Item'} added`); saveItem(uid, collFor(item), item); }
    setView('grid');
    setEditingItem(undefined);
  };

  const handleDeleteItem = (id: string) => {
    if (!uid) return;
    const target = dataRef.current.find(i => i.id === id);
    deleteItem(uid, target ? collFor(target) : 'inventory', id);
  };

  // Update single field (inline edit)
  const handleUpdateItem = (id: string, field: keyof InventoryItem, value: any) => {
    if (!uid) return;
    const target = dataRef.current.find(i => i.id === id);
    if (!target) return;
    const label = target.sku || target.item || id;
    if (field === 'deviceStatus') logActivity(`${label} marked ${String(value).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`);
    else if (field === 'quantity') logActivity(`${label} quantity updated`);
    saveItem(uid, collFor(target), { ...target, [field]: value });
  };

  // Update an entire row
  const handleUpdateRow = (updatedItem: InventoryItem) => { if (uid) saveItem(uid, collFor(updatedItem), updatedItem); };

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
    if (!dataRef.current.some(i => i.id === item.id)) logActivity(`${item.sku || item.item || 'Item'} added`);
    saveItem(uid, collFor(item), item);
  };

  // Sell a cart: mark devices sold in Firestore, decrement accessory quantities,
  // create a sales transaction + customer, log activity — one atomic commit.
  const handleSellCart = (payload: CartCheckout) => {
    if (!uid) return;
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
  };

  const handleBulkImport = (items: InventoryItem[]) => {
    if (uid) items.forEach(it => saveItem(uid, collFor(it), it));
    setView('grid');
  };

  const handleRestoreData = async (restoredData: AppData) => {
    if (!uid) return;
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
  };

  // Persisted notes/tasks (meta) + array-synced runner data
  const saveNotes = (n: Note[]) => { setNotes(n); if (uid) saveMeta(uid, { notes: n }); };
  const saveTasks = (t: Task[]) => { setTasks(t); if (uid) saveMeta(uid, { tasks: t }); };
  const saveRunners = (r: Runner[]) => { if (uid) syncArray(uid, 'runners', r, runnersRef.current); };
  const saveDropOffs = (d: DropOff[]) => { if (uid) syncArray(uid, 'dropOffs', d, dropOffsRef.current); };
  const saveSettlements = (s: Settlement[]) => { if (uid) syncArray(uid, 'settlements', s, settlementsRef.current); };

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
  if (dbLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-slate-950 text-slate-500">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">Loading your inventory…</p>
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
            <NavButton
              active={view === 'dropoff'}
              icon={<Truck className="w-4 h-4" />}
              label="Drop-Offs"
              onClick={() => setView('dropoff')}
            />
            <NavButton
              active={view === 'ai'}
              icon={<Bot className="w-4 h-4" />}
              label="AI Assistant"
              onClick={() => setView('ai')}
            />
            
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-2"></div>

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
          {view === 'dashboard' && <Dashboard data={data} darkMode={darkMode} />}
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
