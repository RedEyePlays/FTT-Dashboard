
export type ItemKind = 'device' | 'accessory';

export type DeviceType = 'Phone' | 'Tablet' | 'Laptop' | 'Console' | 'Watch' | 'Other';

export type DeviceStatus =
  | 'pending_purchase'
  | 'pending_repair'
  | 'ready'
  | 'reserved'   // spoken for on a layaway / deposit sale — held, not yet paid off
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
  notes?: string;                // internal notes
  kind?: 'retail' | 'wholesale'; // wholesale = a repair business/shop
  company?: string;              // wholesale company name
  contactPerson?: string;        // wholesale contact
  preferredContact?: 'phone' | 'email' | 'text';
  tags?: string[];               // VIP, Wholesale, Business, Student, …
  createdAt?: number;            // epoch ms, best-effort first-seen fallback

  // Future-ready (reserved; not yet surfaced in the UI). The CRM stats derive
  // everything else from linked records, but these are per-customer balances /
  // programmes that will need to be stored on the customer document.
  storeCredit?: number;          // store credit balance
  loyaltyPoints?: number;        // loyalty points balance
  giftCardIds?: string[];        // → gift cards issued to this customer
}

// Reserved for future customer interaction history (SMS / email / marketing /
// appointments). Stored under user_data/{ws}/customerInteractions when built.
export interface CustomerInteraction {
  id: string;
  customerId: string;
  ts: number;
  channel: 'sms' | 'email' | 'call' | 'note' | 'appointment' | 'campaign';
  direction?: 'in' | 'out';
  subject?: string;
  body?: string;
}

export interface ActivityEntry {
  id: string;
  ts: number;   // epoch ms
  text: string; // e.g. "PHN-000021 sold to John"
}

// --- Users / roles / audit ---
export type Role = 'owner' | 'manager' | 'employee' | 'technician';

export type Permission =
  | 'inventory.add' | 'inventory.edit' | 'inventory.delete'
  | 'sales.complete' | 'dropoffs.manage'
  | 'repairs.manage'  // full repair management: create/delete, price, batches, customer
  | 'repairs.tech'    // technician-scoped: view + update repair work fields & status
  | 'reports.view'
  | 'reports.profit.summary'    // period totals (Dashboard revenue/profit cards) — manager default
  | 'reports.profit.detailed'   // full historical breakdowns + per-record cost/profit — owner default
  | 'users.manage'    // full user/role management (owner)
  | 'users.tech'      // manage technician accounts only (owner + manager)
  | 'timeclock.use'   // clock in/out & take breaks (every active staff member)
  | 'payroll.manage'  // view the biweekly pay-period summary (owner + manager)
  | 'audit.view' | 'backup.export' | 'settings.manage';

export interface AppUser {
  id: string;            // Firebase Auth uid
  email: string;
  role: Role;
  workspaceId: string;   // the owning account's uid; all shop data lives under user_data/{workspaceId}
  disabled?: boolean;
  allowProfit?: boolean; // employee override to view profit-sensitive figures
  hourlyRate?: number;   // flat pay rate for the time clock; editable by owner only
  notifSeenTs?: number;  // newest activity ts this user has seen (per-user read state)
  lastLogin?: number;    // epoch ms (best-effort, updated client-side)
  createdAt?: number;
}

export interface WorkspaceInvite {
  id: string;            // lowercased email
  email: string;
  workspaceId: string;
  role: Role;
  invitedBy?: string;
  createdAt?: number;
}

export interface AuditEntry {
  id: string;
  ts: number;            // epoch ms
  userId: string;
  userEmail: string;
  action: string;        // e.g. 'inventory.add', 'sale.complete', 'user.role_change'
  entityType: string;    // 'inventory' | 'accessory' | 'sale' | 'customer' | 'runner' | 'settlement' | 'user' | 'backup'
  entityId?: string;
  before?: any;
  after?: any;
}

export interface SalesLine {
  inventoryId?: string;
  kind: ItemKind;
  name: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  deviceType?: DeviceType; // for device lines — used by analytics categorization
                           // when the line can't be resolved to an inventory item
                           // (e.g. a custom device sale)
}

export interface SalesTransaction {
  id: string;
  date: string;            // YYYY-MM-DD
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  paymentMethod?: 'cash' | 'card' | 'mixed';
  cashAmount?: number;
  cardAmount?: number;
  etransferAmount?: number;
  platformName?: string;
  subtotal: number;
  tax: number;
  platformFee: number;
  purchaseCost: number;
  repairCost: number;
  totalCost: number;
  totalPaid: number;            // grand total due (subtotal + tax). NOT reduced by a deposit.
  netProfit: number;
  // Layaway / deposit: when a customer pays part now and owes the rest later,
  // `deposit` is what was actually collected and `balanceOwing` is what remains.
  // Both are absent on a normal fully-paid sale (mirrors repairs' deposit pattern).
  deposit?: number;
  balanceOwing?: number;
  lines: SalesLine[];
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
  salesTransactions?: SalesTransaction[];
  repairs?: Repair[];
  repairBatches?: RepairBatch[];
  skuCounters?: Record<string, number>; // monotonic per-prefix SKU counters
  activityLog?: ActivityEntry[];
}

export type ViewState = 'dashboard' | 'analytics' | 'entry' | 'edit' | 'grid' | 'notes' | 'ai' | 'pos' | 'dropoff' | 'repairs' | 'customers' | 'users' | 'audit' | 'settings' | 'timeclock';

// --- Time clock / payroll ---
// Simple shift + break tracking used by the Time Clock tab. All timestamps are
// epoch ms. Pure hours/pay math lives in domain/timeclock.ts; Firestore I/O in
// services/firestoreDb.ts.
export type BreakReason = 'lunch' | 'personal' | 'bank' | 'other';

export interface TimeBreak {
  id: string;
  start: number;          // epoch ms
  end?: number;           // epoch ms; undefined while the break is ongoing
  reason: BreakReason;
  note?: string;          // optional free text — only offered for the 'other' reason
}

export interface TimeEntry {
  id: string;
  userId: string;         // the staff member's uid (owner of this shift)
  userEmail?: string;     // denormalized for the payroll summary display
  clockIn: number;        // epoch ms
  clockOut?: number;      // epoch ms; undefined while the user is still clocked in
  breaks: TimeBreak[];
  note?: string;
  createdAt?: number;
}

// A record-keeping acknowledgment that an owner reviewed/paid an employee for a
// pay period. This moves no money — it just marks the period as signed off so it
// isn't re-reviewed or double-counted. Snapshots the numbers at sign-off time.
export interface PayPeriodPaid {
  id: string;             // `${userId}__${periodStart}` — idempotent per user + period
  userId: string;
  periodStart: string;    // YYYY-MM-DD (inclusive)
  periodEnd: string;      // YYYY-MM-DD (inclusive)
  markedBy: string;       // owner uid who signed off
  markedByEmail?: string;
  markedAt: number;       // epoch ms
  hours: number;          // hours snapshot at sign-off
  gross: number;          // gross pay snapshot at sign-off
  rate: number;           // hourly rate snapshot at sign-off
}

// --- Repairs ---
// 'internal' = a device the shop owns and is refurbishing before resale (no
// customer involved); links back to the InventoryItem via `inventoryId`.
export type RepairType = 'retail' | 'wholesale' | 'internal';

// Status set. `completed` is retained for backward compatibility with existing
// records; `picked_up` is the technician-workflow terminal (device returned).
export type RepairStatus =
  | 'received' | 'diagnosing' | 'waiting_approval' | 'waiting_parts'
  | 'in_repair' | 'testing' | 'ready_pickup' | 'completed' | 'picked_up' | 'cancelled';

export interface RepairCosmetic {
  checks: string[]; // selected from a predefined cosmetic checklist
  notes?: string;
}

export interface Repair {
  id: string;
  repairNumber: string;         // e.g. RPR-000123
  type: RepairType;
  batchId?: string;             // set for wholesale devices → repairBatches/{id}
  inventoryId?: string;         // set for internal repairs → inventory/{id} (the device being refurbished)
  createdAt: number;            // epoch ms
  date: string;                 // YYYY-MM-DD (date created)

  // Customer (retail) — link + snapshot
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;

  // Device
  deviceType?: DeviceType;
  brand?: string;
  model?: string;
  storage?: string;
  color?: string;
  imei?: string;
  carrier?: string;
  passcode?: string;

  // Repair detail
  issue: string;
  cosmetic?: RepairCosmetic;
  internalNotes?: string;
  customerNotes?: string;

  // Technician-facing work log (editable by technicians).
  techNotes?: string;        // technician notes
  diagnostics?: string;      // diagnostic findings
  workPerformed?: string;    // work performed
  partsUsed?: string;        // parts used (free text)
  partsCost?: number;        // parts cost (for repair profit / analytics; default 0)
  testingResults?: string;   // testing results / notes
  testChecks?: string[];     // testing checklist selections

  estimatedCompletion?: string; // YYYY-MM-DD
  repairPrice: number;
  deposit?: number;             // retail only
  warrantyDays?: number;
  warrantyUntil?: string;       // YYYY-MM-DD, stamped when completed
  status: RepairStatus;
  photos?: string[];            // reserved for future uploads
  completedAt?: number;
}

export type RepairBatchStatus = 'active' | 'completed' | 'cancelled';

export interface RepairBatch {
  id: string;
  batchNumber: string;          // e.g. WB-000045
  createdAt: number;
  dateReceived: string;         // YYYY-MM-DD
  businessId?: string;          // → customers/{id} (kind: 'wholesale')
  companyName: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  notes?: string;
  status: RepairBatchStatus;
  amountPaid: number;           // the only stored money fact; totals are computed
  invoicedAt?: number;
  completedAt?: number;
}
