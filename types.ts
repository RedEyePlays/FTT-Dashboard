
export type ItemKind = 'device' | 'accessory';

export type DeviceType = 'Phone' | 'Tablet' | 'Laptop' | 'Console' | 'Watch' | 'Other';

export type DeviceStatus =
  | 'pending_purchase'
  | 'pending_repair'
  | 'ready'
  | 'sold'
  | 'returned';

export interface InventoryItem {
  id: string;
  kind?: ItemKind; // 'device' (serialized) or 'accessory' (stock). Legacy rows = device.
  sku?: string; // internal SKU e.g. PHN-000001
  manufacturerBarcode?: string; // optional UPC/EAN from the manufacturer

  date: string; // Purchase Date / Date In (YYYY-MM-DD)
  item: string; // Product Name/Model
  imei: string; // IMEI or Serial Number (devices)
  boughtFrom: string;
  purchaseCost: number;
  repairCost: number;

  // --- Device attributes ---
  deviceType?: DeviceType;
  brand?: string;
  model?: string;
  storage?: string;
  color?: string;
  carrier?: string;
  batteryHealth?: string;
  condition?: string;
  purchaseSource?: string; // channel: Marketplace, Runner, Trade-in, etc.
  targetSalePrice?: number;
  deviceStatus?: DeviceStatus;

  // --- Accessory attributes (stock) ---
  quantity?: number;
  costPerUnit?: number;
  sellingPrice?: number;
  lowStockThreshold?: number;

  // Sales Data
  soldDate: string; // YYYY-MM-DD, empty if not sold
  soldTo: string;
  salePrice: number;
  shippingCost?: number; // Cost to ship the item to the buyer
  platformFees?: number; // Computed dollar amount of platform fees
  platformName?: string;
  platformFeePercent?: number;

  // Item classification (POS cart)
  category?: string; // e.g. 'device', 'accessory', 'other'
  transactionId?: string; // groups line items sold in one cart transaction

  // Customer Details (POS)
  customerName?: string;
  customerPhone?: string;
  customerNotes?: string;

  // Payment (POS)
  paymentMethod?: 'cash' | 'card' | 'mixed';
  taxCollected?: number;
  cashAmount?: number;
  cashTaxStatus?: 'none' | 'separate' | 'included';
  paymentNotes?: string;

  // Drop-off / runner sourcing
  runnerId?: string;
  runnerName?: string;
  dropOffId?: string;

  notes: string;
}

export type PaidBy = 'runner' | 'store';

export type DropOffStatus = 'pending' | 'accepted' | 'rejected' | 'paidout' | 'settled';

export interface Runner {
  id: string;
  name: string;
  phone: string;
  notes: string;
}

export interface DropOff {
  id: string;
  runnerId: string;
  item: string;              // device / item name
  imei: string;              // IMEI / serial, optional
  sellerName: string;        // marketplace seller name, optional
  sellerContact: string;     // marketplace seller contact, optional
  purchasePrice: number;     // what was paid to the seller
  paidBy: PaidBy;            // 'runner' paid the seller, or 'store' paid
  dropOffFee: number;        // commission owed to the runner for this device
  dateDropped: string;       // YYYY-MM-DD
  status: DropOffStatus;
  notes: string;
  inventoryId?: string;      // set once accepted & added to inventory
  settlementId?: string;     // set once included in a weekly settlement
}

export interface Settlement {
  id: string;
  runnerId: string;
  date: string;              // YYYY-MM-DD settled
  dropOffIds: string[];
  totalPurchaseFronted: number; // cash the runner fronted to sellers
  totalFees: number;            // drop-off fees paid to runner
  amountPaid: number;           // net amount paid to runner (or negative = owed to store)
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

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
}

export interface AppData {
  inventory: InventoryItem[];
  notes: Note[];
  tasks: Task[];
  runners?: Runner[];
  dropOffs?: DropOff[];
  settlements?: Settlement[];
  customers?: Customer[];
  skuCounters?: Record<string, number>; // monotonic per-prefix SKU counters
}

export type ViewState = 'dashboard' | 'entry' | 'edit' | 'grid' | 'notes' | 'ai' | 'pos' | 'dropoff';
