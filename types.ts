
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
  // Seller link — the customer this item was bought FROM. Buyers and sellers
  // are the same people (one customer record per person), so this points at a
  // plain Customer; the buying side of a person's history is derived from it
  // (domain/customers.ts's sellerPurchasesFor). Optional and additive:
  // `boughtFrom` stays the display text for one-off sellers and for every
  // legacy row written before this field existed — those keep rendering
  // exactly as before, and nothing auto-matches old text to a customer.
  // Named for the seller side explicitly because `soldTo` on this same record
  // is the buyer side; a bare `customerId` would be ambiguous here.
  boughtFromCustomerId?: string;
  // Snapshot of the seller's phone at purchase time (only written when a
  // customer was linked or entered). Second-hand dealer record-keeping wants
  // seller identity attached to the purchase itself, not just to a customer
  // record that may later be edited or merged away.
  boughtFromPhone?: string;
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
  purchaseSource?: string; // channel: Marketplace, Device Buyer, Trade-in, etc.
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

  // Drop-off / device buyer sourcing
  buyerId?: string;
  buyerName?: string;
  dropOffId?: string;

  notes: string;
}

// Who FUNDED the purchase — the store advancing money it is owed back, the
// buyer using his own money, or the owner paying out of pocket.
// 'personal' = the owner paid out of pocket: not store cash (never touches the
// drawer, at acceptance or at settlement) though the buyer still owes the
// principal back. Same vocabulary/shape as RepairPurchasePaidBy's
// 'store' | 'personal'.
//
// LEGACY NAME: the 'runner' member is a STORED Firestore field value on
// DropOff.paidBy, written to real documents since day one. The concept is now
// called "device buyer" everywhere in the UI and in code identifiers, but
// renaming this string literal would silently orphan every historical
// drop-off (they'd stop matching `paidBy === 'runner'` and their funding would
// be misread as store-advanced money the buyer owes back). So the literal
// stays 'runner' and only the human-readable label changes — see
// domain/dropoffs.ts's BUYER_FUNDED and PAID_BY_LABEL in
// components/DropOffView.tsx, components/SettlementReviewModal.tsx and
// services/settlementInvoice.ts, all of which render it as "Buyer-funded".
export type PaidBy = 'runner' | 'store' | 'personal';

// THE BUSINESS MODEL (confirmed by the owner, and the reason for the drop-off
// financing rework): the device buyer sources devices FOR HIMSELF. The store
// never acquires them. The store's role is financing plus a service fee, so at
// settlement money only ever flows INTO the store:
//   • store-funded  — the store paid the seller; the buyer owes that principal
//     back PLUS the service fee.
//   • buyer-funded  — the buyer used his own money; he owes the fee only.
//   • personal-funded — the owner paid out of pocket; the buyer still owes
//     principal + fee, but only the FEE is store cash (see
//     domain/dropoffs.ts's settlementDrawerEffect).
// Only the FEE is profit — the principal is a receivable being repaid, never
// revenue. See domain/dropoffs.ts for the money math.

// How the device buyer actually settled up. Only 'cash' touches the cash
// drawer's expected total — an e-transfer or other non-cash payment never
// should (see domain/dropoffs.ts's settlementDrawerEffect).
export type SettlementPaymentMethod = 'cash' | 'etransfer' | 'other';

export type DropOffStatus = 'pending' | 'accepted' | 'rejected' | 'paidout' | 'settled';

export interface DeviceBuyer {
  id: string;
  name: string;
  phone: string;
  notes: string;
}

export interface DropOff {
  id: string;
  // The device buyer who sourced this device. STORED AS `runnerId` on documents
  // written before the Runner→Device Buyer rename; those legacy documents are
  // normalized at the read boundary (domain/dropoffs.ts's withResolvedBuyerId,
  // applied in hooks/useWorkspaceData.ts) so nothing downstream ever sees
  // `runnerId` and no Firestore migration was needed. New writes only ever set
  // `buyerId`. Same pattern as RepairBatch.private falling back to the legacy
  // `autoInventory` field.
  buyerId: string;
  item: string;              // device / item name
  imei: string;              // IMEI / serial, optional
  sellerName: string;        // marketplace seller name, optional
  sellerContact: string;     // marketplace seller contact, optional
  purchasePrice: number;     // what was paid to the seller
  paidBy: PaidBy;            // who funded the purchase: legacy stored value 'runner' = the buyer's own money, 'store' = store cash (buyer owes it back), 'personal' = the owner's own money (buyer still owes it back)
  dropOffFee: number;        // the store's service fee for financing/handling this device — owed BY the buyer TO the store
  dateDropped: string;       // YYYY-MM-DD
  status: DropOffStatus;
  notes: string;
  // LEGACY ONLY: set on drop-offs that were added to store stock back when the
  // code wrongly assumed the store acquired the device. Financed drop-offs
  // never enter inventory now (see App.tsx / components/DropOffView.tsx); this
  // field is still read so those historical records keep showing their badge.
  inventoryId?: string;
  settlementId?: string;     // set once included in a weekly settlement
  // Staff attribution for the accept step (the moment real cash can leave the
  // till). Stamped from the authenticated user in App.tsx's
  // handleAddDropOffToInventory, never client-supplied. Optional — drop-offs
  // accepted before this field existed simply don't carry it.
  acceptedBy?: string;
  acceptedByEmail?: string;
  acceptedAt?: number;
}

// A per-device fee correction made on the pre-settlement review screen —
// kept on the settlement record (not just applied silently) so the record
// itself shows exactly what was changed. `originalFee` is the drop-off's
// dropOffFee at review time; `adjustedFee` is what was actually paid for
// that device in this settlement.
export interface SettlementLineAdjustment {
  dropOffId: string;
  originalFee: number;
  adjustedFee: number;
}

export interface Settlement {
  id: string;
  // See DropOff.buyerId — same legacy `runnerId` fallback, same normalization
  // boundary, no migration.
  buyerId: string;
  date: string;              // YYYY-MM-DD settled
  dropOffIds: string[];       // devices actually included in this settlement — a device reviewed but excluded is simply left out (still 'accepted'/'paidout', eligible for a later settlement)
  // --- Corrected financing model (records written from the rework onward) ---
  // `model: 'financing'` is the presence check that separates a new record
  // from a pre-rework one — nothing stored was ever migrated, exactly like
  // RepairBatch.private falling back to legacy `autoInventory` and buyerId
  // falling back to legacy `runnerId`. Every consumer branches on it.
  model?: 'financing';
  // Principal the buyer owes back, split by whose cash actually funded the
  // purchase. Kept as two numbers because only the store-funded half is the
  // store's till being repaid.
  principalStoreFunded?: number;
  principalPersonalFunded?: number;
  principalOwed?: number;        // principalStoreFunded + principalPersonalFunded
  totalFees: number;             // the store's service fees, AFTER any per-line adjustments below
  amountOwed?: number;           // what the BUYER owes the store: principalOwed + totalFees + adjustmentAmount
  storeCashIn?: number;          // the part of amountOwed that is store cash: principalStoreFunded + totalFees + adjustmentAmount
  // --- Legacy (pre-rework) fields: never written by new code ---
  // Recorded under the inverted model where the store was believed to
  // reimburse the buyer. Left exactly as stored — reading them is how history
  // stays truthful; nothing recomputes or rewrites them.
  totalPurchaseFronted?: number; // cash the buyer was thought to have fronted for the store
  amountPaid?: number;           // net paid OUT to the buyer (negative = the buyer owed the store)
  // How the settlement was actually paid. Optional for backward compatibility
  // with settlements recorded before this field existed — absent is treated as
  // 'cash' (matching how every settlement was implicitly handled previously).
  paymentMethod?: SettlementPaymentMethod;
  notes: string;
  // Per-device fee corrections made on the review screen — only entries
  // where the fee actually changed from the drop-off's stored dropOffFee.
  // Undefined/empty when nothing was adjusted.
  lineAdjustments?: SettlementLineAdjustment[];
  // A settlement-level correction (e.g. a one-off credit/deduction agreed
  // with the device buyer) that doesn't belong to any single device line.
  // POSITIVE increases what the buyer owes, negative reduces it. Folded into
  // amountOwed/storeCashIn (legacy records: amountPaid); kept here separately
  // (with its note) so the settlement record shows it was applied, not just a
  // mismatched total.
  adjustmentAmount?: number;
  adjustmentNote?: string;
  // Staff attribution — who actually paid the device buyer out, and when.
  // Stamped server-side of the client boundary in App.tsx's
  // handleSettleDeviceBuyer from the AUTHENTICATED user (appUser), never from
  // anything the settlement draft carried in. Optional because settlements
  // recorded before employees held dropoffs.manage predate the fields; the
  // audit log ('dropoff.settle') covers those.
  settledBy?: string;
  settledByEmail?: string;
  settledAt?: number;
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
// How a recurring template's amount is decided when a period comes due.
//   'fixed'    — the template's `amount` is used verbatim (rent, a subscription).
//   'variable' — the template carries NO authoritative amount (utilities,
//                phone, card-processing fees). The period stays PENDING until
//                someone types the real figure; it must never post
//                automatically at a guessed/last-month number, which would
//                silently corrupt the P&L.
// Undefined is treated as 'fixed' so every template that existed before this
// field keeps its exact previous behavior.
export type RecurringAmountMode = 'fixed' | 'variable';

export interface RecurringExpense {
  id: string;
  category: string;
  /** The amount posted each period when amountMode is 'fixed'. Ignored (and
   * conventionally 0) for 'variable' templates — see estimatedAmount. */
  amount: number;
  amountMode?: RecurringAmountMode;   // undefined === 'fixed' (back-compat)
  /** Variable templates only: a typical/expected figure used purely to
   * PREFILL the "enter the amount" field. Never posted on its own. */
  estimatedAmount?: number;
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
  // The expense ledger is split into two permissions because entering spend
  // and BROWSING everyone's spend are different levels of trust — amounts are
  // cost/profit-sensitive data.
  | 'expenses.add'       // create an expense (owner + manager). A manager may also edit/delete their OWN entries.
  | 'expenses.viewAll';  // browse the full ledger, its totals + per-category breakdowns, and manage categories/recurring templates (owner only)

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
  // 'inventory' | 'accessory' | 'sale' | 'customer' | 'runner' | 'settlement' | 'user' | 'backup'
  // ('runner' is a legacy STORED entityType string for device buyers — kept so
  // historical audit entries keep resolving; see domain/audit.ts.)
  entityType: string;
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
  // What it cost to SHIP this sale to the buyer — postage, packaging, a
  // courier label. A flat dollar amount, not a percentage: shipping is
  // not proportional to price.
  //
  // Deliberately SEPARATE from platformFee. They are two different costs
  // on an online sale (the marketplace's commission, and getting the box
  // to the customer), and cramming shipping into the fee percentage
  // inflates it into a number that means nothing.
  //
  // A COST, never a price reduction: `subtotal`, `tax` and `totalPaid`
  // are all untouched by it — only `netProfit` is reduced. Lowering the
  // sale price to "absorb" shipping would misstate both revenue and
  // sales tax, which is exactly what this field exists to avoid.
  //
  // Absent on in-store sales (the overwhelming majority), so every
  // historical transaction reads as 0 with no migration.
  shippingCost?: number;
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
  // `runners`: the backup JSON's field name, deliberately UNCHANGED. It mirrors
  // the Firestore collection name (also still `runners` — see COLLECTIONS in
  // services/firestoreDb.ts) so every backup file ever exported still restores
  // losslessly. The concept is "device buyer"; only the storage key is legacy.
  runners?: DeviceBuyer[];
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
  // How much of this ticket's cost is CURRENTLY reflected in the linked
  // inventory item's `repairCost` (see domain/repairCostWriteback.ts).
  //
  // This is the per-ticket receipt that makes the write-back additive and
  // reversible. `inventoryItem.repairCost` is a single running total shared by
  // every ticket that has ever touched the device, so without recording what
  // THIS ticket put in there, a second repair could only overwrite the first,
  // and a cancellation could only guess how much to take back out.
  //
  // `undefined` means "this ticket has contributed nothing" — the state every
  // pre-existing ticket is in, which is what makes the change safe to deploy
  // without a migration. Never edited by hand; only ever set to the value the
  // write-back just applied.
  inventoryRepairCostApplied?: number;
  // When the linked device SOLD while this ticket was still open (epoch ms).
  //
  // A sold device with an open ticket is a real inconsistency — unfinished
  // work attached to something that has left the shop. The sale deliberately
  // does NOT close the ticket (that would silently discard the work), so it
  // stamps this instead and the Repairs list surfaces it, to be finished or
  // cancelled on purpose. Absent on every normal ticket.
  deviceSoldAt?: number;
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
