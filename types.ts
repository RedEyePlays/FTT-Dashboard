
export interface InventoryItem {
  id: string;
  date: string; // Purchase Date (YYYY-MM-DD)
  item: string; // Product Name/Model
  imei: string;
  boughtFrom: string;
  purchaseCost: number;
  repairCost: number;
  
  // Sales Data
  soldDate: string; // YYYY-MM-DD, empty if not sold
  soldTo: string;
  salePrice: number;
  shippingCost: number; // Cost to ship the item to the buyer
  platformFees: number; // Fees from platforms like eBay, etc.

  notes: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  color: 'yellow' | 'blue' | 'green' | 'rose' | 'violet' | 'slate';
  date: string;
}

export interface Task {
  id: string;
  text: string;
  completed: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: Date;
}

export interface AppData {
  inventory: InventoryItem[];
  notes: Note[];
  tasks: Task[];
}

export type ViewState = 'dashboard' | 'entry' | 'edit' | 'grid' | 'notes' | 'ai';
