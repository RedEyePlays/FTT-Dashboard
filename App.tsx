
import React, { useState, useEffect, useRef } from 'react';
import { LayoutDashboard, PlusCircle, Table, Activity, Sparkles, Moon, Sun, Lock, StickyNote, Settings, Calculator, Bot, MessageCircle } from 'lucide-react';
import { Dashboard } from './components/Dashboard';
import { DataEntryForm } from './components/DataEntryForm';
import { DataGrid } from './components/DataGrid';
import { BulkEntryModal } from './components/BulkEntryModal';
import { AuthScreen } from './components/AuthScreen';
import { NotesBoard } from './components/NotesBoard';
import { SettingsModal } from './components/SettingsModal';
import { CalculatorTool } from './components/CalculatorTool';
import { AIChatView } from './components/AIChatView';
import { InventoryItem, ViewState, Note, Task, AppData, ChatMessage } from './types';
import { INITIAL_DATA, DEFAULT_PIN } from './constants';
import { encryptData, decryptData, isEncrypted } from './services/security';

// CONSTANTS FOR STORAGE
const STORAGE_KEY = 'biztrack_production_v1';
const LEGACY_KEYS = ['bizTrackData_2025_demo_v1', 'bizTrackData'];

const App: React.FC = () => {
  // --- AUTH STATE ---
  const [isLocked, setIsLocked] = useState(true);
  const [authMode, setAuthMode] = useState<'setup' | 'unlock' | 'migrate'>('setup');
  const [pin, setPin] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // --- APP STATE ---
  const [view, setView] = useState<ViewState>('dashboard');
  
  // Data State
  const [data, setData] = useState<InventoryItem[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  
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
  
  // Theme State
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('bizTrackTheme') === 'dark';
    }
    return false;
  });

  // INITIAL LOAD CHECK
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    
    if (!stored) {
      // Check legacy keys for migration
      let legacyFound = false;
      for (const k of LEGACY_KEYS) {
        if (localStorage.getItem(k)) {
          legacyFound = true;
          break;
        }
      }
      
      if (legacyFound) {
        setAuthMode('migrate');
      } else {
        setAuthMode('setup'); // New User
      }
    } else {
      // Check if data is already encrypted
      if (isEncrypted(stored)) {
        setAuthMode('unlock');
      } else {
        setAuthMode('migrate'); // Existing plain data, needs lock
      }
    }
  }, []);

  // --- AUTH HANDLERS ---
  const handleAuthenticate = (enteredPinRaw: string) => {
    setAuthError(null);
    const enteredPin = enteredPinRaw.trim();
    
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      
      if (authMode === 'setup') {
        // Enforce Default PIN for Setup
        if (enteredPin !== DEFAULT_PIN) {
           throw new Error(`Incorrect PIN. Try ${DEFAULT_PIN}.`);
        }
        setPin(enteredPin);
        setData(INITIAL_DATA); 
        setNotes([]);
        setTasks([
          {id: '1', text: 'Set up my business profile', completed: false},
          {id: '2', text: 'List first item on eBay', completed: false}
        ]);
        setIsLocked(false);
      } 
      else if (authMode === 'migrate') {
        // Enforce Default PIN for Migration
        if (enteredPin !== DEFAULT_PIN) {
           throw new Error(`Incorrect PIN. Try ${DEFAULT_PIN}.`);
        }

        let migrationData: InventoryItem[] = [];
        
        // Try main key first (plain text)
        if (stored && !isEncrypted(stored)) {
           migrationData = JSON.parse(stored);
        } else {
           // Try legacy keys
           for (const k of LEGACY_KEYS) {
             const val = localStorage.getItem(k);
             if (val) {
               migrationData = JSON.parse(val);
               break;
             }
           }
        }
        
        if (migrationData.length === 0) migrationData = INITIAL_DATA; // Fallback

        setPin(enteredPin);
        setData(migrationData);
        setNotes([]);
        setTasks([]);
        setIsLocked(false);
      } 
      else if (authMode === 'unlock') {
        // Unlock: Decrypt existing data
        if (!stored) throw new Error("No data found");
        
        try {
          const decrypted = decryptData(stored, enteredPin);
          
          setPin(enteredPin);
          
          // Handle Data Migration (Array vs Object)
          if (Array.isArray(decrypted)) {
            // Old format (Just inventory array)
            setData(decrypted);
            setNotes([]);
            setTasks([]);
          } else {
            // New format (Object with inventory, notes, tasks)
            setData(decrypted.inventory || []);
            setNotes(decrypted.notes || []);
            setTasks(decrypted.tasks || []);
          }
          
          setIsLocked(false);
        } catch (decryptErr) {
           throw new Error("Wrong PIN. Please try again.");
        }
      }

    } catch (e: any) {
      console.error(e);
      setAuthError(e.message || "Authentication failed");
    }
  };

  const handleResetApp = () => {
    localStorage.removeItem(STORAGE_KEY);
    LEGACY_KEYS.forEach(k => localStorage.removeItem(k));
    window.location.reload();
  };

  const handleLock = () => {
    setPin(null);
    setData([]); 
    setNotes([]);
    setTasks([]);
    setIsLocked(true);
    setAuthMode('unlock');
  };

  const handleChangePin = (newPin: string) => {
    // This will trigger the persistence useEffect because `pin` changes
    setPin(newPin);
  };

  // PERSISTENCE (ENCRYPTED)
  // Save all data types into one encrypted blob whenever data or pin changes
  useEffect(() => {
    if (!isLocked && pin) {
       // Create the unified data object
       const appData = {
         inventory: data,
         notes: notes,
         tasks: tasks
       };
       const encrypted = encryptData(appData, pin);
       localStorage.setItem(STORAGE_KEY, encrypted);
    }
  }, [data, notes, tasks, isLocked, pin]);

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
    setData(prev => prev.map(item => {
      if (item.id === id) {
        return { ...item, [field]: value };
      }
      return item;
    }));
  };

  // Update entire row (for Quick Sell or Bulk Edit)
  const handleUpdateRow = (updatedItem: InventoryItem) => {
    setData(prev => prev.map(item => item.id === updatedItem.id ? updatedItem : item));
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

  // --- RENDER LOCK SCREEN IF LOCKED ---
  if (isLocked) {
    return (
      <AuthScreen 
        mode={authMode} 
        onAuthenticate={handleAuthenticate} 
        onReset={handleResetApp}
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
              label="Inventory Sheet" 
              onClick={() => setView('grid')} 
            />
            <NavButton 
              active={view === 'notes'} 
              icon={<StickyNote className="w-4 h-4" />} 
              label="Notes" 
              onClick={() => setView('notes')} 
            />
            <NavButton 
              active={view === 'ai'} 
              icon={<Bot className="w-4 h-4" />} 
              label="AI Assistant" 
              onClick={() => setView('ai')} 
            />
            
            <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 mx-2"></div>
            
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
            <DataGrid 
              data={data} 
              onDelete={handleDeleteItem} 
              onUpdate={handleUpdateItem}
              onUpdateRow={handleUpdateRow}
              onAddEmpty={handleCreateEmptyItem}
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
           onChangePin={handleChangePin}
         />
      )}
    </div>
  );
};

export default App;
