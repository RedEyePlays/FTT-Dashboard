
export type ItemKind = 'device' | 'accessory';

export type DeviceType = 'Phone' | 'Tablet' | 'Laptop' | 'Console' | 'Watch' | 'Other';

// External marketplaces an item might ALSO be listed on while in-store —
// see domain/listing.ts (labels, warning/reminder logic) and
// InventoryItem.listedPlatforms.
export type ListingPlatform = 'bestbuy' | 'kijiji' | 'facebook' | 'ebay' | 'other';

// 'pending_repair' doubles as auto-inventory's "In Repair" (a device with an
// open ticket under an auto_inventory batch — domain/autoInventory.ts) and
// 'ready' as its "Available for sale" once that ticket completes, rather than
// adding parallel status values for the same two states.
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
  listed?: boolean; // posted for sale (marketplace/storefront) — independent of deviceStatus
  // Which external platform(s) this item is ALSO currently listed on (multiple
  // allowed) — see domain/listing.ts. Distinct from `listed` (a generic
  // "posted somewhere" flag) and from a sale's `platformName` (which platform
  // a completed sale went through): this is "still live elsewhere right now,"
  // the double-sell risk a Quick Sale warns about. Cleared automatically the
  // moment the item sells in-store (see hooks/useCheckout.ts's handleCheckout)
  // since it's no longer available anywhere at that point.
  listedPlatforms?: ListingPlatform[];

  // --- Auto-inventory (domain/autoInventory.ts) ---
  // Normalized identity used for IMEI/serial matching — always kept in sync
  // with `imei` on every write (never computed only at query/match time), so
  // matching is a plain equality check against this field. IMEI (15 digits,
  // Luhn-valid) normalizes to digits-only; anything else is treated as a
  // serial and normalizes to trimmed/uppercased text.
  imeiNormalized?: string;
  autoCreated?: boolean;    // this record was auto-created by a repair ticket, not entered by hand
  sourceTicketId?: string;  // the repair ticket that created (or most recently attached to) this record
  batchId?: string;         // the wholesale batch whose auto_inventory ticket created this record
  // Set when an auto-created record's originating ticket was voided/deleted
  // and no other ticket references it — flagged instead of hard-deleted so
  // nothing about inventory ever silently disappears from a ticket action.
  flaggedForReview?: boolean;

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
  paymentMethod?: 'cash' | 'card' | 'mixed' | 'etransfer';
  taxCollected?: number;
  cashAmount?: number;
  cashTaxStatus?: 'none' | 'separate' | 'included';
  // Same "was tax charged" decision as cashTaxStatus, for a standalone
  // e-transfer sale (see hooks/useCheckout.ts's taxApplies).
  etransferTaxStatus?: 'none' | 'separate';
  paymentNotes?: string;

  // Drop-off / runner sourcing
  runnerId?: string;
  runnerName?: string;
  dropOffId?: string;

  notes: string;
}

// 'personal' = the owner/staff paid the seller out of pocket — not store
// cash (never touches the drawer) and not the runner needing reimbursement
// (never adds to what's owed them). Same vocabulary/shape as
// RepairPurchasePaidBy's 'store' | 'personal'.
export type PaidBy = 'runner' | 'store' | 'personal';

// How a settlement was actually paid out to the runner. Only 'cash' touches the
// cash drawer's expected total — an e-transfer or other non-cash payment never
// should (see domain/dropoffs.ts's settlementDrawerEffect).
export type SettlementPaymentMethod = 'cash' | 'etransfer' | 'other';

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
  paidBy: PaidBy;            // 'runner' paid, 'store' cash paid, or 'personal' (staff's own money) paid
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
  // How amountPaid was actually paid out. Optional for backward compatibility
  // with settlements recorded before this field existed — absent is treated as
  // 'cash' (matching how every settlement was implicitly handled previously).
  paymentMethod?: SettlementPaymentMethod;
  notes: string;
}

// A note can reference one record. This is a lightweight pointer, not an
// owning relationship — the record knows nothing about it, and deleting the
// note (or the record) leaves the other side intact.
export type NoteLinkType = 'customer' | 'inventory' | 'repair';

// Who may read a note. Notes routinely hold purchase prices, supplier
// settlements and personal numbers — the same class of data the app already
// hides from employees/technicians elsewhere (inventory cost column, AI
// gating, reports) — so each note carries its own audience.
//
// An absent value reads as 'managers', NOT 'everyone': notes written before
// this existed were authored with no expectation of being employee-visible,
// so the safe default is the restrictive one. See DEFAULT_NOTE_VISIBILITY.
export type NoteVisibility = 'everyone' | 'managers' | 'owner';

export interface Note {
  id: string;
  title: string;
  content: string;
  color: 'yellow' | 'blue' | 'green' | 'rose' | 'violet' | 'slate';
  date: string;
  // Pinned pages always sort to the top of the list (see domain/notes.ts).
  pinned?: boolean;
  // Attribution. These pages are shared, so every save records who touched it.
  updatedAt?: number;
  updatedBy?: string;       // AppUser id
  updatedByEmail?: string;
  // Optional link to a customer / inventory item / repair. `linkLabel` is a
  // denormalized display name so the notes list renders without a lookup; the
  // record views resolve by linkType + linkId.
  linkType?: NoteLinkType;
  linkId?: string;
  linkLabel?: string;
  // Absent = 'managers' (see NoteVisibility / DEFAULT_NOTE_VISIBILITY).
  visibility?: NoteVisibility;
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

  // Google review requests (domain/reviews.ts) — never send to an opted-out
  // customer, and never re-request within the configured repeat window, so
  // both need to be tracked directly on the customer record.
  reviewOptOut?: boolean;
  lastReviewRequestedAt?: number;              // epoch ms
  lastReviewRequestChannel?: 'sms' | 'whatsapp' | 'email' | 'manual';
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

export type ExpensePaymentMethod = 'cash' | 'card' | 'etransfer' | 'debit' | 'other';
export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

// General expense ledger (domain/expenses.ts) — the single source of truth
// for every business expense regardless of how it was paid. A cash-paid
// expense ALSO gets a matching CashDrawerEntry appended to that day's
// CashReconciliation.cashOut (see App.tsx's handleSaveExpense) so the drawer
// stays accurate — cashDrawerLinked just records that the drawer effect was
// already applied, it isn't a second source of truth.
export interface Expense {
  id: string;
  date: string;                  // YYYY-MM-DD
  amount: number;
  category: string;              // key into AppSettings.expenses.categories
  paymentMethod: ExpensePaymentMethod;
  payee?: string;                 // vendor/payee, free text
  note?: string;
  attachmentUrl?: string;         // receipt photo/document (Cloud Storage URL)
  enteredBy: string;
  enteredByEmail: string;
  createdAt: number;
  cashDrawerLinked?: boolean;     // true once its drawer cash-out effect was applied
  recurringId?: string;           // set when auto-generated from a RecurringExpense
  recurringPeriod?: string;       // the period key it was generated for, e.g. '2026-03'
}

// A template for an expense that recurs on a schedule (rent, subscriptions).
// generatedPeriods/skippedPeriods make "one Expense per period, skippable"
// idempotent — domain/expenses.ts's duePeriodsFor never re-offers a period
// that's already in either list.
export interface RecurringExpense {
  id: string;
  category: string;
  amount: number;
  paymentMethod: ExpensePaymentMethod;
  payee?: string;
  note?: string;
  frequency: RecurringFrequency;
  startDate: string;              // YYYY-MM-DD — first occurrence
  active: boolean;
  createdBy: string;
  createdByEmail: string;
  createdAt: number;
  generatedPeriods?: string[];    // period keys already turned into an Expense
  skippedPeriods?: string[];      // period keys explicitly skipped for this template
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
  | 'sales.complete' | 'sales.void'   // sales.void = reverse a completed sale (owner + manager)
  | 'sales.return'                    // sales.return = process a return after the same-day void window (owner + manager)
  | 'cash.log'                        // cash.log = record a cash-out expense / owner withdrawal at the register (owner + manager + employee)
  | 'cash.reconcile'                  // cash.reconcile = view/manage the daily cash reconciliation report + variance (owner + manager)
  | 'dropoffs.manage'
  | 'repairs.manage'  // full repair management: create/delete, price, batches, customer
  | 'repairs.tech'    // technician-scoped: view + update repair work fields & status
  | 'repairs.performance' // view per-technician repair performance (owner + manager)
  | 'reports.view'
  | 'reports.profit.summary'    // period totals (Dashboard revenue/profit cards) — manager default
  | 'reports.profit.detailed'   // full historical breakdowns + per-record cost/profit — owner default
  | 'users.manage'    // full user/role management (owner)
  | 'users.tech'      // manage technician accounts only (owner + manager)
  | 'users.pin'        // assign/update PINs for roles below the assigner (owner + manager; see domain/pin.ts canAssignPin)
  | 'security.manage'  // configure the auto-lock inactivity timer (owner + manager)
  | 'timeclock.use'   // clock in/out & take breaks (every active staff member)
  | 'payroll.manage'  // view the biweekly pay-period summary (owner + manager)
  | 'closeout.view'   // end-of-day close-out summary (owner + manager)
  | 'audit.view' | 'backup.export' | 'settings.manage'
  | 'staffNotes.manage' // owner-only internal staff shoutout/notes log
  | 'expenses.manage';  // enter/edit/delete the expense ledger + viewing its totals (owner + manager)

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
  // Auto-lock PIN — assigned by a manager/owner (see domain/pin.ts), used only to
  // unlock the inactivity lock screen. Hashed (PBKDF2-SHA256) + salted; the
  // plaintext PIN is never stored or transmitted.
  pinHash?: string;
  pinSalt?: string;
  pinIterations?: number;
  pinUpdatedAt?: number;      // epoch ms
  pinUpdatedBy?: string;      // uid of the manager/owner who set it
  pinUpdatedByEmail?: string;
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

// Internal-only, owner-visible running log of quick notes about staff (e.g. a
// shoutout for handling a tough situation well). Free text + timestamp only —
// deliberately no rating, category, or approval workflow.
export interface StaffNote {
  id: string;
  ts: number;             // epoch ms
  text: string;
  authorId: string;
  authorEmail: string;
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
  // Snapshot of the device's InventoryItem.listedPlatforms at the moment it sold
  // (before the sale clears the live field to []) — lets voidSale/returnSale
  // restore it if the sale is reversed, instead of silently losing the fact
  // that the device might still be listed live elsewhere.
  listedPlatforms?: ListingPlatform[];
}

export interface SalesTransaction {
  id: string;
  date: string;            // YYYY-MM-DD (LOCAL calendar date — see domain/dates.ts)
  // When the sale was actually rung up (epoch ms). `date` alone can't say
  // whether a sale landed before or after the drawer was counted, which is what
  // the reconciliation screen needs to explain a post-close cash difference
  // (see domain/reports.ts's cashSalesAfterClose). Absent on rows written
  // before this field existed.
  createdAt?: number;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  paymentMethod?: 'cash' | 'card' | 'mixed' | 'etransfer';
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
  // Set when this sale is a repair checkout routed through Quick Sale — links the
  // transaction back to its Repair. Lets analytics attribute the money to Repairs
  // (not devices/accessories) and avoid double-counting the same repair.
  repairId?: string;
  // Voiding (same-day mistake) and returning (later refund) both keep the record
  // for audit history rather than deleting it. Absent status = a normal completed
  // sale (legacy rows have no field).
  status?: 'completed' | 'voided' | 'returned';
  voidedAt?: number;       // epoch ms
  voidedBy?: string;       // uid of the owner/manager who voided it
  voidedByEmail?: string;
  // Return details (status === 'returned'). refundAmount = amount actually
  // collected (deposit for a layaway, totalPaid otherwise) − restockingFee —
  // see domain/pos.ts's collectedOnSale.
  returnedAt?: number;         // epoch ms
  returnedBy?: string;         // uid of the owner/manager who processed the return
  returnedByEmail?: string;
  restockingFee?: number;      // fee withheld from the refund (0 / absent = full refund)
  refundAmount?: number;       // actual amount refunded to the customer
  // Layaway completion (domain/layaway.ts): every payment collected AFTER the
  // original checkout, against `balanceOwing`. Each one is independently
  // receiptable. `deposit` (above) always reflects the running total collected
  // so far — this array is the itemized history behind that number, not a
  // second source of truth for it.
  balancePayments?: BalancePayment[];
  // Stamped the moment `balanceOwing` reaches 0 through a balance payment —
  // i.e. only for a sale that started as a layaway. A sale paid in full at
  // checkout never has this set (it never had a balance to begin with).
  layawayCompletedAt?: number;
}

/** One payment collected against a layaway's balanceOwing, after the original checkout. */
export interface BalancePayment {
  id: string;
  amount: number;               // this payment's amount, whatever the method
  paymentMethod: 'cash' | 'card' | 'mixed' | 'etransfer';
  cashAmount?: number;          // only meaningful when paymentMethod === 'mixed'
  cardAmount?: number;
  etransferAmount?: number;
  date: string;                 // YYYY-MM-DD, backdatable the same way a sale's date is
  at: number;                   // epoch ms, when this payment was actually recorded
  by?: string;                  // uid of the staff member who took it
  byEmail?: string;
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

export type ViewState = 'dashboard' | 'analytics' | 'reports' | 'entry' | 'edit' | 'grid' | 'notes' | 'ai' | 'pos' | 'quickpurchase' | 'dropoff' | 'repairs' | 'customers' | 'users' | 'audit' | 'settings' | 'timeclock' | 'closeout' | 'layaways';

// A single cash movement in a day's drawer, logged as part of reconciliation:
// a manual cash-in (top-up / tip / off-sale payment), a paid cash expense, or an
// owner withdrawal / till pull. `amount` is always a positive dollar figure; the
// list it lives in (cashIn vs cashOut vs withdrawals) decides its sign in the
// expected-cash math. Its date and recorder come from the parent record.
export interface CashDrawerEntry {
  id: string;
  amount: number;          // dollars moved (always positive)
  note?: string;           // reason / note
}

// A saved daily cash-drawer record (one per calendar day; id === date). It can
// be in two states: OPEN (a starting float was set and/or movements logged, but
// not yet counted) or RECONCILED (counted + closed at end of day). `openedAt`
// marks a real start-of-day open; `reconciledAt` marks a real end-of-day count —
// so a bare cash movement is never mistaken for a completed reconciliation.
// Expected ending cash = openingFloat + cashSales + Σ cashIn − Σ cashOut − Σ withdrawals.
export interface CashReconciliation {
  id: string;              // the date, YYYY-MM-DD (one record per day)
  date: string;            // YYYY-MM-DD
  openingFloat?: number;   // starting cash in the drawer at open
  cashSales?: number;      // cash taken in from that day's sales
  cashIn?: CashDrawerEntry[];       // manual cash added (top-ups, tips, off-sale payments)
  cashOut?: CashDrawerEntry[];      // cash expenses paid out of the drawer
  withdrawals?: CashDrawerEntry[];  // owner pulls / bank deposits
  expectedCash: number;    // computed expected ENDING cash
  countedCash?: number;    // actual counted cash at close (absent until reconciled)
  variance: number;        // countedCash − expectedCash (+ over, − short); 0 until counted
  note?: string;           // explanation of a variance (required when over/short)
  // Start-of-day open (drawer float set explicitly, not silently defaulted).
  openedAt?: number;       // epoch ms
  openedBy?: string;       // uid
  openedByEmail?: string;
  // End-of-day reconciliation (counted + closed). Absent = still open.
  reconciledAt?: number;   // epoch ms
  reconciledBy?: string;   // uid
  reconciledByEmail?: string;
  recordedBy: string;      // uid of whoever last touched the record
  recordedByEmail?: string;
  recordedAt: number;      // epoch ms (last touch)
}

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

// A manual correction to a shift's clock-out (typically fixing a missed
// clock-out). Corrections are appended, never overwritten in place, so the
// original value stays visible alongside who changed it and when.
export interface TimeEntryCorrection {
  correctedBy: string;        // owner/manager uid who made the correction
  correctedByEmail?: string;
  correctedAt: number;        // epoch ms
  fromClockOut?: number;      // the value before this correction (undefined = was still open)
  toClockOut: number;         // the corrected value
  note?: string;
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
  corrections?: TimeEntryCorrection[]; // history of manual clock-out corrections, oldest first
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

// A distinct, EARLIER step than PayPeriodPaid: the manager/owner reviewed one
// employee's numbers for a period and signed off that they're correct —
// before any money changes hands. Same idempotent-key shape and snapshot
// discipline as PayPeriodPaid, in its own collection so "approved" and
// "paid" are two independently-trackable states (a period can be approved
// without being paid yet, but never paid without having been approved —
// enforced in App.tsx's handleMarkPaid).
export interface PayPeriodApproval {
  id: string;              // `${userId}__${periodStart}` — idempotent per user + period
  userId: string;
  periodStart: string;     // YYYY-MM-DD (inclusive)
  periodEnd: string;       // YYYY-MM-DD (inclusive)
  approvedBy: string;      // owner/manager uid (payroll.manage tier)
  approvedByEmail?: string;
  approvedAt: number;      // epoch ms
  hours: number;           // hours snapshot at approval time
  gross: number;           // gross pay snapshot at approval time
  rate: number;            // hourly rate snapshot at approval time
}

// --- Repairs ---
// 'internal' = a device the shop owns and is refurbishing before resale (no
// customer involved); links back to the InventoryItem via `inventoryId`.
export type RepairType = 'retail' | 'wholesale' | 'internal';

// A single part used on a repair (screen, battery, charging port, …). Structured
// breakdown of the repair's parts cost for accurate per-repair margin tracking.
export interface RepairPart {
  id: string;
  name: string;       // e.g. "OLED screen", "Battery"
  unitCost: number;   // cost per unit (what the shop paid)
  quantity: number;   // units used (default 1)
}

// Status set. `completed` is retained for backward compatibility with existing
// records; `picked_up` is the technician-workflow terminal (device returned).
export type RepairStatus =
  | 'received' | 'diagnosing' | 'waiting_approval' | 'waiting_parts'
  | 'in_repair' | 'testing' | 'ready_pickup' | 'completed' | 'picked_up' | 'cancelled';

export interface RepairCosmetic {
  checks: string[]; // selected from a predefined cosmetic checklist
  notes?: string;
}

// Mirrors DropOff's `PaidBy` for the same "who actually handed over the cash"
// question, applied to a wholesale device ticket's purchaseCost instead of a
// drop-off's purchasePrice. 'store' hits the cash drawer at ticket creation
// (see domain/autoInventory.ts's autoInventoryPurchaseDrawerEffect); 'personal'
// never touches it.
export type RepairPurchasePaidBy = 'store' | 'personal';

export interface Repair {
  id: string;
  repairNumber: string;         // e.g. RPR-000123
  type: RepairType;
  batchId?: string;             // set for wholesale devices → repairBatches/{id}
  // Per-ticket opt-in into auto-inventory (domain/autoInventory.ts) — only
  // offered/meaningful when the ticket's batch is private (RepairBatch.private,
  // see isPrivateBatch). Off by default: even under a private batch, a device
  // is only auto-added to inventory when this is explicitly turned on for that
  // specific ticket, not for every device under the batch.
  wantsAutoInventory?: boolean;
  // → inventory/{id}. Set for internal repairs (the device being refurbished),
  // AND for a wholesale device ticket created under a private batch with
  // wantsAutoInventory on (see domain/autoInventory.ts) — either a freshly
  // auto-created record, or an existing one this ticket got attached to by
  // IMEI/serial match.
  inventoryId?: string;
  // Auto-inventory bookkeeping (only set when inventoryId was resolved via
  // domain/autoInventory.ts, not for a manually-linked internal repair):
  // whether THIS ticket is the one that auto-created inventoryId (vs attached
  // to an existing record), and the matched record's status just before this
  // ticket touched it — kept so a manual revert is always possible.
  inventoryAutoCreated?: boolean;
  inventoryPreviousStatus?: DeviceStatus;
  // What this device cost to acquire — only meaningful (and shown) for a
  // wholesale device ticket under an auto_inventory batch: flows into the
  // auto-created inventory record's purchaseCost instead of it defaulting to
  // 0, so profit-at-sale reflects the real cost. Blank/omitted defaults to 0
  // (some personal devices genuinely have no traceable cost). Only applied
  // when THIS ticket is the one that auto-creates the inventory record
  // (inventoryAutoCreated === true) — never overwrites an existing record's
  // cost basis on a later ticket that merely attaches to it.
  purchaseCost?: number;
  // Whether that purchase cost came out of store cash (logs a cash-out entry
  // against the day's drawer at ticket creation, same drawer-effect pattern as
  // domain/dropoffs.ts's dropOffAcceptDrawerEffect) or was paid personally /
  // outside store cash (purchaseCost still applies to the inventory record,
  // the drawer is just never touched). Mirrors DropOff's paidBy pattern.
  purchasePaidBy?: RepairPurchasePaidBy;
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
  partsUsed?: string;        // parts used (free text — legacy / quick note)
  parts?: RepairPart[];      // structured parts breakdown (name/unitCost/quantity)
  partsCost?: number;        // parts cost total (denormalized from `parts` when present; legacy fallback otherwise)
  testingResults?: string;   // testing results / notes
  testChecks?: string[];     // testing checklist selections

  estimatedCompletion?: string; // YYYY-MM-DD
  repairPrice: number;
  deposit?: number;             // retail only
  warrantyDays?: number;
  warrantyUntil?: string;       // YYYY-MM-DD, stamped when completed
  // Set at intake when this ticket IS a warranty return/redo against earlier
  // work (not merely a device still under warranty) — an unhappy-path visit,
  // so domain/reviews.ts excludes it from review requests same as a void/
  // cancelled ticket.
  isWarrantyClaim?: boolean;
  status: RepairStatus;
  photos?: string[];            // reserved for future uploads
  completedAt?: number;
  completedBy?: string;         // uid of who marked it complete (technician performance)
  // Set when the repair was checked out through Quick Sale — links to the
  // SalesTransaction that recognized its revenue/profit. Analytics reads this to
  // count the repair's money once (via the sale) instead of twice.
  salesTransactionId?: string;
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
  // Flags this as a private/store/personal batch — devices repaired for the
  // shop or its owner, not a wholesale client (e.g. an "FTT Personal" batch)
  // — rather than this ever being keyed off a hardcoded batch name. Off by
  // default. Purely a label: it doesn't change invoices/settlements/anything
  // else about how the batch works. Only a private batch's device tickets get
  // offered the per-device Repair.wantsAutoInventory toggle — see
  // domain/autoInventory.ts's isPrivateBatch.
  private?: boolean;
  // @deprecated Superseded by `private` (see isPrivateBatch, which reads
  // `private ?? autoInventory`) — kept only so a batch saved before this
  // change (e.g. an old "FTT Personal" batch with autoInventory: true) still
  // reads as private without a data migration. Never set by new code; every
  // batch save writes `private` instead.
  autoInventory?: boolean;
}
