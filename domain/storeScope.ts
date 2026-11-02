import {
  AppUser, CashReconciliation, COMPANY_LOCATION_ID, Expense, InventoryItem, Location,
  PayPeriodPaid, Repair, SalesTransaction, Settlement, StaffBonus, TimeEntry,
} from '../types';
import { activeLocations, defaultLocation, LocationMember, permittedLocations } from './locations';
import { PaidBreakReasons, workedHours } from './timeclock';
import { toISODate } from './dates';

/**
 * SEEING ONE STORE'S NUMBERS. MULTI-STORE STAGE 5.
 *
 * Same company, ONE set of books, filterable by store. Not two sets of books:
 * there is one corporation, one HST filing and one bank account, and the owner
 * wants to know which shop is carrying which.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW THIS STAGE AVOIDS CHANGING ANY NUMBER
 *
 * Every figure in this app is computed by a pure function that takes ARRAYS:
 * `profitAndLoss(input, …)` (domain/reports.ts), `computeAnalytics(range,
 * input, …)` (domain/analytics.ts), `dashboardPeriods(input, …)`. None of them
 * knows what a location is, and after this stage none of them does.
 *
 * So this module does exactly one thing: it FILTERS THE INPUT ARRAYS and hands
 * them to those same functions, untouched. Nothing here adds up money.
 *
 * That is not a stylistic preference — it is what makes the headline promise
 * mechanically true rather than merely tested: WITH NO FILTER APPLIED, THE
 * ARRAYS ARE PASSED THROUGH BY REFERENCE AND EVERY FIGURE IS THE SAME OBJECT
 * GRAPH IT WAS BEFORE. There is no "combined" code path that could drift from
 * the old one, because there is no new code path at all. `scopeAll` returns
 * its input. A test pins that identity.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THE TWO STORES DO NOT ADD UP TO THE COMBINED FIGURE
 *
 * This is the thing most likely to be read as a bug, so it is stated in the
 * type system, on screen, on print and in every export rather than left for
 * the owner to discover:
 *
 *   combined  =  Brampton  +  Mississauga  +  COMPANY
 *
 * A store's P&L deliberately EXCLUDES company-tagged costs — the app's own
 * running costs, parts bought from overseas suppliers, the owner's pay — and
 * excludes staff bonuses (see `scopeBonuses`). Those are real costs of the
 * business and they are in the combined figure. A store's net profit is
 * therefore PROFIT BEFORE COMPANY OVERHEAD, and it is labelled as such
 * wherever it appears (`SCOPE_CAVEAT`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHERE AN UNTAGGED RECORD GOES
 *
 * Every record predating the second store has no `locationId`. The rule here
 * is the same one stages 2–4 already use (`drawerLocationId`,
 * `shiftsAtStore`): AN UNTAGGED RECORD READS AS THE DEFAULT STORE. It is
 * therefore in exactly one store's figures and in the combined figure, and it
 * can never vanish from either — which is the failure mode that actually
 * matters. A record silently missing from the P&L is far worse than one
 * attributed to the wrong shop, because nobody goes looking for it.
 *
 * Pure: no Firestore, no DOM, no clock of its own.
 */

/* ---------------- What a scope is ---------------- */

/**
 * A chosen reporting scope: a location id, or `ALL_STORES_SCOPE` for the
 * combined books.
 *
 * Deliberately a plain string rather than a tagged union. It is persisted to
 * localStorage and compared against stored `locationId` values all day; a
 * union would need encoding at both ends for no gain. The empty string is the
 * natural identity: a workspace with no store list has no scope to pick, so it
 * reports combined, which is exactly what it did before this stage existed.
 */
export type StoreScope = string;

/** The combined books — every store, plus company-tagged costs. */
export const ALL_STORES_SCOPE: StoreScope = '';

export const isAllStores = (scope: StoreScope): boolean => !scope;

/* ---------------- Naming the scope, unmistakably ---------------- */

export const ALL_STORES_LABEL = 'All stores (combined)';

/**
 * What the scope is called, in the words that go on the screen, the printed
 * page and the CSV header.
 *
 * "All stores (combined)" rather than "All" or a blank: a report whose scope
 * is not written on it is a report that gets forwarded to an accountant as if
 * it were the whole company, and the whole point of this stage is that the
 * reader can never be unsure which it is. Deactivated and dangling ids read
 * through `locationName` so a closed store's history still names itself.
 */
export const scopeLabel = (scope: StoreScope, locations: Location[]): string => {
  if (isAllStores(scope)) return ALL_STORES_LABEL;
  if (scope === COMPANY_LOCATION_ID) return 'Company (no store)';
  const found = (locations || []).find(l => l.id === scope);
  if (!found) return 'Unknown store';
  return found.active ? `${found.name} only` : `${found.name} (closed) only`;
};

/**
 * The caveat that must travel with any single-store money figure.
 *
 * Not optional decoration. Without it a store's net profit reads as that
 * shop's bottom line, when what it actually is is its contribution before the
 * costs that belong to neither shop.
 */
export const SCOPE_CAVEAT =
  'One store only: profit BEFORE company overhead. Company-tagged costs and staff '
  + 'bonuses belong to neither store and are in the combined figures only, so the two '
  + 'stores do not add up to All stores.';

export const ALL_STORES_CAVEAT =
  'All stores combined, including company-tagged costs and staff bonuses.';

export const scopeCaveat = (scope: StoreScope): string =>
  isAllStores(scope) ? ALL_STORES_CAVEAT : SCOPE_CAVEAT;

/**
 * One line naming the scope for a printed page or an export, e.g.
 * `Scope: Brampton only — One store only: profit BEFORE company overhead. …`
 */
export const scopeHeading = (scope: StoreScope, locations: Location[]): string =>
  `Scope: ${scopeLabel(scope, locations)} — ${scopeCaveat(scope)}`;

/* ---------------- Who may pick what ---------------- */

/**
 * THE SCOPES THIS VIEWER MAY CHOOSE BETWEEN.
 *
 * NO NEW PERMISSIONS. Whether somebody may see money at all is already
 * decided, unchanged, by `reports.profit.summary` / `reports.profit.detailed`
 * / `expenses.viewAll` (services/rbac.ts). This only decides which SLICES the
 * picker offers to somebody who is already allowed to look.
 *
 * The per-store choices are the stores `users.locationIds` allows, through
 * stage 1's `permittedLocations` — so the owner gets every store and a manager
 * rostered to one shop is offered that shop.
 *
 * THE COMBINED SCOPE IS OFFERED TO EVERYONE WHO CAN SEE THE REPORTS AT ALL,
 * and that is deliberate: the combined books are EXACTLY WHAT THEY SEE TODAY,
 * before this stage. Withholding it from a manager rostered to one store would
 * not be scoping a report, it would be silently taking away a figure they have
 * always had — a permission change dressed up as a filter. This stage adds a
 * lens, it never removes a view.
 *
 * Returns [] when the workspace has no store list: there is nothing to pick
 * between, and the picker renders nothing at all.
 */
export const visibleScopesFor = (
  user: LocationMember | undefined,
  locations: Location[],
): StoreScope[] => {
  if (!activeLocations(locations).length) return [];
  return [ALL_STORES_SCOPE, ...permittedLocations(user, locations).map(l => l.id)];
};

/** Is this a scope the viewer may actually choose? Second lock on the picker. */
export const canUseScope = (
  user: LocationMember | undefined,
  locations: Location[],
  scope: StoreScope,
): boolean => {
  const allowed = visibleScopesFor(user, locations);
  if (!allowed.length) return isAllStores(scope);
  return allowed.includes(scope);
};

/**
 * A remembered scope, honoured only while it is still pickable. A store the
 * viewer has been taken off, or one that has since closed, falls back to the
 * combined books rather than to a different store's numbers — falling back to
 * "everything" is visibly wrong at a glance, whereas falling back to the other
 * shop's figures is wrong in a way nobody would notice.
 */
export const resolveScope = (
  user: LocationMember | undefined,
  locations: Location[],
  preferred?: StoreScope,
): StoreScope => (canUseScope(user, locations, preferred || ALL_STORES_SCOPE)
  ? (preferred || ALL_STORES_SCOPE)
  : ALL_STORES_SCOPE);

/* ---------------- Where one record belongs ---------------- */

/** The resolved store of any location-tagged record. Untagged → default. */
export const recordStore = <T extends { locationId?: string }>(
  rec: T,
  defaultLocationId: string,
): string => rec.locationId || defaultLocationId;

/** The default store's id, or '' in a workspace with no store list. */
export const defaultStoreId = (locations: Location[]): string =>
  defaultLocation(locations)?.id || '';

/**
 * WHICH STORE A SALE'S PROFIT BELONGS TO.
 *
 * The owner's rule, settled in stage 1: "sale profit belongs to the store the
 * DEVICE was at, and an online sale follows the device". So the DEVICE decides
 * — not the terminal the sale happened to be rung on. A Mississauga laptop
 * listed on eBay and rung up by whoever was at the Brampton counter is
 * Mississauga's sale, because Mississauga is carrying its cost.
 *
 * The device's stored location is a sound answer to "where was it when it
 * sold": stage 4 refuses to transfer a SOLD item (`transferBlock` → 'sold'),
 * so nothing moves it afterwards.
 *
 * FALLBACKS, in order:
 *   1. the single store all of this sale's device lines were at;
 *   2. the transaction's own stamp (where it was rung) — which covers a
 *      MIXED-STORE cart, an accessories-only sale, and a pure labour/repair
 *      sale, none of which have one device to follow;
 *   3. the default store, for a sale predating the split.
 *
 * NOTE, AND IT IS NOT AN INCONSISTENCY: the CASH DRAWER keeps using the
 * transaction's own stamp (`expectedCashForDateAt`, stage 2) and is untouched
 * here. "Whose till holds this cash" and "whose shop earned this profit" are
 * two different questions and the answers are allowed to differ — the money is
 * physically in the drawer it was rung into. Unifying them would mean either
 * counting cash into a till it is not in, or crediting profit to a shop that
 * did not carry the device.
 */
export const saleStore = (
  txn: SalesTransaction,
  inventoryById: Map<string, InventoryItem>,
  defaultLocationId: string,
): string => {
  const stores = new Set<string>();
  for (const l of txn.lines || []) {
    if (!l.inventoryId) continue;
    const item = inventoryById.get(l.inventoryId);
    if (!item) continue;
    stores.add(recordStore(item, defaultLocationId));
  }
  if (stores.size === 1) return [...stores][0];
  return recordStore(txn, defaultLocationId);
};

/** Index inventory by id once, for `saleStore`. */
export const indexInventory = (inventory: InventoryItem[]): Map<string, InventoryItem> => {
  const m = new Map<string, InventoryItem>();
  for (const i of inventory || []) m.set(i.id, i);
  return m;
};

/* ---------------- Filtering the arrays ---------------- */

/**
 * Everything the filters need that the record itself cannot say.
 * `now` and `paidReasons` are only used by the wage split.
 */
export interface ScopeContext {
  locations: Location[];
  /** Stamped shifts — the only evidence of which store a wage was earned at. */
  timeEntries?: TimeEntry[];
  /** settings.operations.paidBreakReasons, so the wage split weights match payroll. */
  paidReasons?: PaidBreakReasons;
  now?: number;
}

const byStore = <T extends { locationId?: string }>(
  rows: T[],
  scope: StoreScope,
  defaultLocationId: string,
): T[] => (rows || []).filter(r => recordStore(r, defaultLocationId) === scope);

/**
 * THE STORE'S OWN EXPENSES — and not a penny of company overhead.
 *
 * `COMPANY_LOCATION_ID` is a sentinel, never a place (see types.ts). It can
 * never equal a scope, because `checkLocation` reserves the id and the name,
 * so a store scope drops company costs by construction rather than by an
 * `!== 'company'` check somebody could delete. The assertion is tested anyway.
 */
export const scopeExpenses = (
  expenses: Expense[],
  scope: StoreScope,
  defaultLocationId: string,
): Expense[] => (isAllStores(scope) ? expenses : byStore(expenses, scope, defaultLocationId));

/**
 * STAFF BONUSES BELONG TO THE COMPANY.
 *
 * A `StaffBonus` carries NO location, deliberately (stage 1: pay is per
 * PERSON, across both shops). Three options were on the table:
 *
 *   • guess a store from the person's shifts — rejected. A bonus is most often
 *     paid for exactly the thing that spans both shops: covering a shift
 *     across town, a good month, staying late to finish a build. Loading it
 *     onto whichever shop they happened to punch into most is a made-up number
 *     presented as a fact.
 *   • split it across stores by hours — rejected for the same reason, with the
 *     added cost of being unexplainable to the person who received it.
 *   • treat it as a COMPANY cost — chosen. It is honest, it is the same answer
 *     stage 1 already gave for pay periods and bonuses by leaving them
 *     untagged, and it keeps the bonus in the combined P&L where it belongs
 *     and out of a per-store figure that would otherwise be quietly wrong.
 *
 * So a store's P&L has no bonus line, and `SCOPE_CAVEAT` says so. Should the
 * owner later want bonuses attributed, the right fix is a `locationId` on the
 * bonus chosen by the person paying it — not an inference here.
 */
export const scopeBonuses = (bonuses: StaffBonus[], scope: StoreScope): StaffBonus[] =>
  (isAllStores(scope) ? (bonuses || []) : []);

/**
 * THIS STORE'S WAGE COST, FROM THE STAMPED SHIFTS.
 *
 * A `PayPeriodPaid` has no location — pay is per person, ONE number and ONE
 * stub, and stage 3 was explicit that splitting a pay period would mean two
 * stubs for one person. That is not changed here. What is new is only its
 * ATTRIBUTION for reporting.
 *
 * Each paid record's `gross` is split across stores in proportion to the hours
 * that person's STAMPED shifts (stage 3) put at each store inside the period.
 * The paid total is never recomputed from rates — it is the authoritative
 * snapshot taken at sign-off, and this only decides how to apportion it. So:
 *
 *   • the combined payroll figure is untouched (the records pass through
 *     unfiltered — this function is not called at all for a combined scope);
 *   • the per-store figures add up to the paid total, to the cent, because
 *     they are shares of it rather than a second pricing of the same hours.
 *
 * WHEN A PAID PERIOD HAS NO STAMPED HOURS AT ALL — every record signed off
 * before stage 3 existed, and any period where the shifts were deleted — the
 * whole record goes to the DEFAULT STORE. Same rule as every other untagged
 * record: it lands in exactly one store and can never disappear.
 *
 * Returns records whose `gross` is this store's share, with `hours` and
 * `rateSegments` adjusted or dropped so nothing downstream can read a
 * person-level figure off a store-level record.
 */
export const scopePayPeriods = (
  payPeriods: PayPeriodPaid[],
  scope: StoreScope,
  ctx: ScopeContext,
): PayPeriodPaid[] => {
  if (isAllStores(scope)) return payPeriods || [];
  const defaultId = defaultStoreId(ctx.locations);
  const entries = ctx.timeEntries || [];
  const now = ctx.now ?? Date.now();
  const paidReasons = ctx.paidReasons || [];
  const out: PayPeriodPaid[] = [];
  for (const p of payPeriods || []) {
    const mine = entries.filter(e => e.userId === p.userId
      && e.clockIn != null
      && toISODate(e.clockIn) >= p.periodStart
      && toISODate(e.clockIn) <= p.periodEnd);
    let total = 0;
    let atStore = 0;
    for (const e of mine) {
      const h = workedHours(e, now, paidReasons);
      if (h <= 0) continue;
      total += h;
      if (recordStore(e, defaultId) === scope) atStore += h;
    }
    // No stamped evidence either way: the default store carries it whole.
    const share = total > 0 ? atStore / total : (scope === defaultId ? 1 : 0);
    if (share <= 0) continue;
    const gross = Math.round((p.gross || 0) * share * 100) / 100;
    const hours = Math.round((p.hours || 0) * share * 100) / 100;
    // `rateSegments` is a breakdown of the PERSON's period, not of a store's
    // share of it. Carrying it over would let a reader add up segments that no
    // longer sum to the gross beside them, so it is dropped outright.
    const { rateSegments: _dropped, ...rest } = p;
    out.push({ ...rest, gross, hours });
  }
  return out;
};

/**
 * Inventory for a store scope.
 *
 * Two jobs at once, and the second is the subtle one:
 *
 *  1. keep the items AT this store (unsold stock value, low stock, and any
 *     standalone sold device);
 *  2. drop every item that ANY transaction references — including
 *     transactions outside this scope.
 *
 * Why (2). `profitAndLoss` and `computeAnalytics` both count a sold device as
 * a STANDALONE sale when no transaction line points at it, so a device and its
 * sale are never counted twice. They build that id set from the transactions
 * they were GIVEN. Hand one store a filtered transaction list and a device
 * whose sale was attributed to the OTHER store, and the device reappears as a
 * standalone sale here while its transaction is counted there — the same sale
 * in both stores' revenue. Removing txn-linked items from the scoped inventory
 * closes that off: a sale is counted exactly once, in the store `saleStore`
 * puts it in.
 *
 * This cannot lose a figure, because `saleStore` is total — every transaction
 * lands in exactly one store — and it cannot distort stock value, because the
 * value tiles count UNSOLD items only (`held` in domain/analytics.ts) and
 * anything with a transaction line is sold.
 *
 * DEVICES IN TRANSIT STAY WITH THE SENDING STORE. Stage 4 deliberately leaves
 * `locationId` pointing at the sender until the destination confirms receipt
 * (`applySend` sets `inTransferId` and nothing else), so this needs no code at
 * all: the asset sits on the books of the shop that still has it until
 * somebody else accepts it, it can never be on both stores' books, and it
 * cannot drop out of the combined total. Note the deliberate difference from
 * the In Transit TAB, which hides it from both stores' sellable stock — "what
 * can I sell today" and "whose asset is this" are different questions.
 */
export const scopeInventory = (
  inventory: InventoryItem[],
  scope: StoreScope,
  defaultLocationId: string,
  txnInvIds: Set<string>,
): InventoryItem[] => (isAllStores(scope)
  ? inventory || []
  : byStore(inventory || [], scope, defaultLocationId).filter(i => !txnInvIds.has(i.id)));

/** Every inventory id any transaction line points at, across ALL stores. */
export const allTxnInventoryIds = (transactions: SalesTransaction[]): Set<string> => {
  const ids = new Set<string>();
  for (const t of transactions || []) {
    for (const l of t.lines || []) if (l.inventoryId) ids.add(l.inventoryId);
  }
  return ids;
};

export const scopeTransactions = (
  transactions: SalesTransaction[],
  scope: StoreScope,
  inventoryById: Map<string, InventoryItem>,
  defaultLocationId: string,
): SalesTransaction[] => (isAllStores(scope)
  ? transactions || []
  : (transactions || []).filter(t => saleStore(t, inventoryById, defaultLocationId) === scope));

export const scopeRepairs = (repairs: Repair[], scope: StoreScope, defaultLocationId: string): Repair[] =>
  (isAllStores(scope) ? repairs || [] : byStore(repairs || [], scope, defaultLocationId));

export const scopeSettlements = (s: Settlement[], scope: StoreScope, defaultLocationId: string): Settlement[] =>
  (isAllStores(scope) ? s || [] : byStore(s || [], scope, defaultLocationId));

export const scopeDrawers = (
  recs: CashReconciliation[],
  scope: StoreScope,
  defaultLocationId: string,
): CashReconciliation[] => (isAllStores(scope) ? recs || [] : byStore(recs || [], scope, defaultLocationId));

/* ---------------- Scoping a whole report input ---------------- */

/**
 * The shape of domain/reports.ts's ProfitLossInput, restated structurally so
 * this module does not import the report it filters. Keeping the dependency
 * one-way is what lets a test assert that `profitAndLoss` itself still knows
 * nothing about locations.
 */
export interface ScopedPLInput {
  transactions: SalesTransaction[];
  inventory: InventoryItem[];
  payPeriods: PayPeriodPaid[];
  cashReconciliations: CashReconciliation[];
  settlements: Settlement[];
  expenses: Expense[];
  bonuses?: StaffBonus[];
}

/**
 * ONE STORE'S P&L INPUT — or, for the combined books, THE INPUT ITSELF.
 *
 * The early return is load-bearing, not an optimisation: for a combined scope
 * the caller gets back the very object it passed in, so the combined P&L is
 * not "recomputed and verified equal", it is the same computation on the same
 * arrays it always was. That is the regression that matters most, and this is
 * how it is made impossible rather than merely unlikely.
 */
export const scopeProfitLossInput = <T extends ScopedPLInput>(
  input: T,
  scope: StoreScope,
  ctx: ScopeContext,
): T => {
  if (isAllStores(scope)) return input;
  const defaultId = defaultStoreId(ctx.locations);
  const byId = indexInventory(input.inventory);
  const txnIds = allTxnInventoryIds(input.transactions);
  return {
    ...input,
    transactions: scopeTransactions(input.transactions, scope, byId, defaultId),
    inventory: scopeInventory(input.inventory, scope, defaultId, txnIds),
    payPeriods: scopePayPeriods(input.payPeriods, scope, ctx),
    cashReconciliations: scopeDrawers(input.cashReconciliations, scope, defaultId),
    settlements: scopeSettlements(input.settlements, scope, defaultId),
    expenses: scopeExpenses(input.expenses, scope, defaultId),
    bonuses: scopeBonuses(input.bonuses || [], scope),
  };
};

/**
 * The shape of domain/analytics.ts's AnalyticsInput that carries a location.
 *
 * `customers`, `auditLogs` and `activity` are deliberately NOT scoped and are
 * passed straight through:
 *
 *   • customers  — a customer belongs to the BUSINESS, not a store (stage 1).
 *                  It is a lookup table here; "top customers" is derived from
 *                  the SCOPED transactions and so is already per store.
 *   • auditLogs,
 *     activity   — a workspace-wide trail of what PEOPLE did. Neither record
 *                  carries a location, so there is nothing to filter on, and
 *                  inventing one would be a guess. The consequence is stated
 *                  on screen: the recent-activity feed is not store-scoped.
 */
export interface ScopedAnalyticsInput {
  salesTransactions: SalesTransaction[];
  repairs: Repair[];
  inventory: InventoryItem[];
  settlements?: Settlement[];
}

export const scopeAnalyticsInput = <T extends ScopedAnalyticsInput>(
  input: T,
  scope: StoreScope,
  ctx: ScopeContext,
): T => {
  if (isAllStores(scope)) return input;
  const defaultId = defaultStoreId(ctx.locations);
  const byId = indexInventory(input.inventory);
  const txnIds = allTxnInventoryIds(input.salesTransactions);
  return {
    ...input,
    salesTransactions: scopeTransactions(input.salesTransactions, scope, byId, defaultId),
    repairs: scopeRepairs(input.repairs, scope, defaultId),
    inventory: scopeInventory(input.inventory, scope, defaultId, txnIds),
    ...(input.settlements ? { settlements: scopeSettlements(input.settlements, scope, defaultId) } : {}),
  };
};

/* ---------------- Expenses that belong to neither shop ---------------- */

/**
 * The expense tag picker's options, in the order they are offered.
 *
 * COMPANY IS LAST AND IS NOT A DEFAULT. `Expense.locationId` has no default
 * anywhere in the UI — a defaulted expense tag is how rent ends up on the
 * wrong store, and the owner is the only one who knows whether a $400 parts
 * order was for the Brampton bench or a bulk buy for both.
 */
export const expenseScopeOptions = (locations: Location[]): { id: string; label: string }[] => [
  ...activeLocations(locations).map(l => ({ id: l.id, label: l.name })),
  { id: COMPANY_LOCATION_ID, label: 'Company (neither store)' },
];

/** Is an expense draft taggable yet? Used to block save, not to guess. */
export const expenseNeedsStore = (
  draft: { locationId?: string },
  locations: Location[],
): boolean => activeLocations(locations).length > 0 && !draft.locationId;

export const EXPENSE_STORE_REQUIRED =
  'Pick which store this cost belongs to, or Company if it belongs to neither.';

/**
 * Expenses still carrying no store at all.
 *
 * These read as the default store in a per-store P&L (see the module note), so
 * no figure is missing — but the owner should be able to find them and say
 * which are really company costs. That is what the Expenses tab's "untagged"
 * filter lists, and what the backfill below writes.
 */
export const untaggedExpenses = (expenses: Expense[]): Expense[] =>
  (expenses || []).filter(e => !e.locationId);

export const companyExpenses = (expenses: Expense[]): Expense[] =>
  (expenses || []).filter(e => e.locationId === COMPANY_LOCATION_ID);

/* ---------------- Stock in transit, named rather than hidden ---------------- */

/**
 * The value of this scope's stock that is in transit to the other store.
 *
 * Reported as a NOTE on the inventory figure, never as a deduction from it:
 * the device is still the sending store's asset until somebody accepts it
 * (see `scopeInventory`). Naming it is the whole point — "your stock value
 * includes $2,400 of devices on their way to Mississauga" is information; a
 * silently smaller number is not.
 */
export const inTransitValue = (
  inventory: InventoryItem[],
  scope: StoreScope,
  defaultLocationId: string,
): { count: number; cost: number } => {
  let count = 0;
  let cost = 0;
  for (const i of inventory || []) {
    if (!i.inTransferId || i.soldDate) continue;
    if (!isAllStores(scope) && recordStore(i, defaultLocationId) !== scope) continue;
    count += 1;
    cost = Math.round((cost + (i.purchaseCost || 0) + (i.repairCost || 0)) * 100) / 100;
  }
  return { count, cost };
};

export const inTransitNote = (t: { count: number; cost: number }): string => (t.count
  ? `Includes ${t.count} device${t.count === 1 ? '' : 's'} in transit to another store `
    + `($${t.cost.toFixed(2)} at cost) — still this store's stock until the other store receives it.`
  : '');

/* ---------------- The viewer ---------------- */

/** The scope picker needs the signed-in user's own roster, nothing more. */
export const viewerFor = (users: AppUser[], uid: string): LocationMember | undefined =>
  (users || []).find(u => u.id === uid);
