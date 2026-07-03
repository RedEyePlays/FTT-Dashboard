
import React, { useState, useEffect, useRef } from 'react';
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
import { FinderModal } from './components/FinderModal';
import { DropOffView } from './components/DropOffView';
import { InventoryView } from './components/InventoryView';
import { InventoryItem, ViewState, Note, Task, AppData, ChatMessage, Runner, DropOff, Settlement, ItemKind, DeviceType, ActivityEntry } from './types';
import { skuPrefix, nextSku } from './services/sku';
import { INITIAL_DATA } from './constants';
import { encryptData, decryptData } from './services/security';
import { auth, db } from './services/firebase';
import { onAuthChange } from './services/auth';
import { User, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

const App: React.FC = () => {
  // --- AUTH STATE ---
  const [user, setUser] = useState<User | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // --- APP STATE ---
  const [view, setView] = useState<ViewState>('dashboard');

  // Data State
  const [data, setData] = useState<InventoryItem[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [dropOffs, setDropOffs] = useState<DropOff[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [skuCounters, setSkuCounters] = useState<Record<string, number>>({});
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);

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
    const unsubscribe = onAuthChange(async (user) => {
      setUser(user);
      if (user) {
        await loadData(user.uid, user.email!); // Pass email as the pin
      } else {
        // Reset app state on logout
        setData([]);
        setNotes([]);
        setTasks([]);
      }
      setIsLoadingAuth(false);
    });
    return () => unsubscribe();
  }, []);

  // --- AUTH HANDLERS ---
  const handleAuthenticate = async (email: string, password: string, isRegister: boolean) => {
    setAuthError(null);
    try {
      if (isRegister) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;
        // Create a new document in Firestore for the new user
        const appData: AppData = { inventory: INITIAL_DATA, notes: [], tasks: [] };
        const encryptedData = encryptData(appData, email); // Use email as the pin
        await setDoc(doc(db, "user_data", newUser.uid), { data: encryptedData });
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (e: any) {
      console.error(e);
      setAuthError(e.message || "Authentication failed");
    }
  };

  const handleLock = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      console.error("Error signing out: ", e);
    }
  };
  
  // DATA HANDLING
  const loadData = async (uid: string, pin: string) => {
    const docRef = doc(db, "user_data", uid);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const encryptedData = docSnap.data().data;
      try {
        const decrypted = decryptData(encryptedData, pin);
        setData(decrypted.inventory || []);
        setNotes(decrypted.notes || []);
        setTasks(decrypted.tasks || []);
        setRunners(decrypted.runners || []);
        setDropOffs(decrypted.dropOffs || []);
        setSettlements(decrypted.settlements || []);
        setSkuCounters(decrypted.skuCounters || {});
        setActivityLog(decrypted.activityLog || []);
      } catch (error) {
        console.error("Error decrypting data: ", error);
        setAuthError("Failed to decrypt data. Please check your credentials.");
        await signOut(auth); // Log out if decryption fails
      }
    } else {
      // This case should ideally not happen for a logged-in user
      // unless the document was deleted manually.
      console.log("No data document found for user, creating a new one.");
      const appData: AppData = { inventory: INITIAL_DATA, notes: [], tasks: [] };
      const encryptedData = encryptData(appData, pin);
      await setDoc(doc(db, "user_data", uid), { data: encryptedData });
      setData(INITIAL_DATA);
      setNotes([]);
      setTasks([]);
    }
  };

  // PERSISTENCE (ENCRYPTED TO FIRESTORE)
  useEffect(() => {
    if (user) {
      const appData: AppData = {
        inventory: data,
        notes: notes,
        tasks: tasks,
        runners: runners,
        dropOffs: dropOffs,
        settlements: settlements,
        skuCounters: skuCounters,
        activityLog: activityLog,
      };
      const encrypted = encryptData(appData, user.email!); // Use email as the pin
      setDoc(doc(db, "user_data", user.uid), { data: encrypted });
    }
  }, [data, notes, tasks, runners, dropOffs, settlements, skuCounters, activityLog, user]);

  // Append a capped activity-log entry
  const logActivity = (text: string) =>
    setActivityLog(prev => [{ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: Date.now(), text }, ...prev].slice(0, 60));


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

  const handleSaveItem = (item: InventoryItem) => {
    if (editingItem) {
      setData(prev => prev.map(i => i.id === item.id ? item : i));
    } else {
      setData(prev => [...prev, item]);
    }
    setView('grid');
    setEditingItem(undefined);
  };

  const handleDeleteItem = (id: string) => {
    setData((prev) => prev.filter(r => r.id !== id));
  };

  // Update single field
  const handleUpdateItem = (id: string, field: keyof InventoryItem, value: any) => {
    const target = data.find(i => i.id === id);
    if (target) {
      const label = target.sku || target.item || id;
      if (field === 'deviceStatus') {
        const nice = String(value).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        logActivity(`${label} marked ${nice}`);
      } else if (field === 'quantity') {
        logActivity(`${label} quantity updated`);
      }
    }
    setData(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  // Update entire row (for Quick Sell or Bulk Edit)
  const handleUpdateRow = (updatedItem: InventoryItem) => {
    setData(prev => prev.map(item => item.id === updatedItem.id ? updatedItem : item));
  };

  // Cart checkout: replace existing rows by id, append new (accessory) rows
  const handleCheckout = (items: InventoryItem[]) => {
    setData(prev => {
      const map = new Map(prev.map(i => [i.id, i]));
      items.forEach(it => map.set(it.id, it));
      return Array.from(map.values());
    });
  };

  // Generate the next unique internal SKU for a kind/device type (never reused)
  const handleGenerateSku = (kind: ItemKind, deviceType?: DeviceType): string => {
    const prefix = skuPrefix(kind, deviceType);
    const { sku, counters } = nextSku(prefix, skuCounters, data);
    setSkuCounters(counters);
    return sku;
  };

  // Add or update a single inventory item (device or accessory) from InventoryView
  const handleSaveInventoryItem = (item: InventoryItem) => {
    setData(prev => {
      const exists = prev.some(i => i.id === item.id);
      if (!exists) logActivity(`${item.sku || item.item || 'Item'} added`);
      return exists ? prev.map(i => i.id === item.id ? item : i) : [...prev, item];
    });
  };

  // Sell a cart: mark devices sold, decrement accessory quantities, shared txn id
  const handleSellCart = (payload: { soldRows: InventoryItem[]; accessoryQtys: Record<string, number> }) => {
    payload.soldRows.forEach(d => logActivity(`${d.sku || d.item} sold to ${d.customerName || d.soldTo || 'customer'}`));
    setData(prev => {
      const byId = new Map(prev.map(i => [i.id, i]));
      payload.soldRows.forEach(d => byId.set(d.id, d));
      Object.entries(payload.accessoryQtys).forEach(([id, soldQty]) => {
        const acc = byId.get(id);
        if (acc) byId.set(id, { ...acc, quantity: Math.max(0, (acc.quantity ?? 0) - soldQty) });
      });
      return Array.from(byId.values());
    });
  };

  const handleCreateEmptyItem = () => {
    const newItem: InventoryItem = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      date: new Date().toISOString().split('T')[0],
      item: '',
      imei: '',
      boughtFrom: '',
      purchaseCost: 0,
      repairCost: 0,
      soldDate: '',
      soldTo: '',
      salePrice: 0,
      notes: ''
    };
    setData(prev => [...prev, newItem]);
  };

  const handleBulkImport = (items: InventoryItem[]) => {
    setData(prev => [...prev, ...items]);
    setView('grid');
  };
  
  const handleRestoreData = (restoredData: AppData) => {
    setData(restoredData.inventory);
    setNotes(restoredData.notes);
    setTasks(restoredData.tasks);
    setRunners(restoredData.runners || []);
    setDropOffs(restoredData.dropOffs || []);
    setSettlements(restoredData.settlements || []);
    setSkuCounters(restoredData.skuCounters || {});
    setActivityLog(restoredData.activityLog || []);
  };

  // Add an accepted drop-off into inventory, carrying runner + cost across
  const handleAddDropOffToInventory = (d: DropOff) => {
    const runner = runners.find(r => r.id === d.runnerId);
    const newItem: InventoryItem = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      date: d.dateDropped || new Date().toISOString().split('T')[0],
      item: d.item,
      imei: d.imei,
      boughtFrom: d.sellerName || 'Marketplace (drop-off)',
      purchaseCost: d.purchasePrice,
      repairCost: 0,
      soldDate: '',
      soldTo: '',
      salePrice: 0,
      runnerId: d.runnerId,
      runnerName: runner?.name,
      dropOffId: d.id,
      notes: d.notes ? `Drop-off: ${d.notes}` : 'Added from drop-off',
    };
    setData(prev => [...prev, newItem]);
    setDropOffs(prev => prev.map(x => x.id === d.id ? { ...x, inventoryId: newItem.id } : x));
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
      return <div>Loading...</div>; // Or a nice spinner component
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
            />
          )}
          {view === 'pos' && (
            <QuickSaleView
              inventory={data}
              onSell={handleUpdateRow}
              onSellCart={handleSellCart}
            />
          )}
          {view === 'dropoff' && (
            <DropOffView
              runners={runners}
              dropOffs={dropOffs}
              settlements={settlements}
              onRunnersChange={setRunners}
              onDropOffsChange={setDropOffs}
              onSettlementsChange={setSettlements}
              onAddToInventory={handleAddDropOffToInventory}
            />
          )}
          {view === 'notes' && (
            <NotesBoard 
              notes={notes}
              tasks={tasks}
              onUpdateNotes={setNotes}
              onUpdateTasks={setTasks}
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
