import { describe, it, expect } from 'vitest';
import {
  AppUser, CashReconciliation, COMPANY_LOCATION_ID, Expense, InventoryItem, Location,
  PayPeriodPaid, Repair, SalesTransaction, Settlement, StaffBonus, TimeEntry,
} from '../types';
import { profitAndLoss, ProfitLossInput } from './reports';
import { DEFAULT_EXPENSE_CATEGORIES } from './expenses';
import { computeAnalytics, presetRange } from './analytics';
import {
  ALL_STORES_CAVEAT, ALL_STORES_LABEL, ALL_STORES_SCOPE, EXPENSE_STORE_REQUIRED, SCOPE_CAVEAT,
  canUseScope, companyExpenses, expenseNeedsStore, expenseScopeOptions, inTransitNote,
  inTransitValue, isAllStores, recordStore, resolveScope, saleStore, scopeAnalyticsInput,
  scopeBonuses, scopeCaveat, scopeExpenses, scopeHeading, scopeLabel, scopePayPeriods,
  scopeProfitLossInput, indexInventory, untaggedExpenses, visibleScopesFor,
} from './storeScope';

/**
 * MULTI-STORE, STAGE 5: SEEING ONE STORE'S NUMBERS.
 *
 * One set of books, filterable by store. The properties worth pinning hardest,
 * in the order they would hurt if they broke:
 *
 *  1. WITH NO FILTER, NOTHING CHANGED. Not "matches to the cent" — the arrays
 *     are passed through by reference, so there is no second code path.
 *  2. NOTHING DISAPPEARS. Every record reaches the combined figures, including
 *     untagged ones, and reaches exactly one store.
 *  3. NOTHING IS COUNTED TWICE. Above all a device whose sale is attributed to
 *     the other store.
 *  4. A store excludes company costs, and the report SAYS SO.
 */

const BRAMPTON = 'loc-bram';
const MISSY = 'loc-missy';
const NOW = 1_790_000_000_000;

const locs: Location[] = [
  { id: BRAMPTON, name: 'Brampton', active: true, isDefault: true, createdAt: NOW },
  { id: MISSY, name: 'Mississauga', active: true, createdAt: NOW },
];

const tx = (p: Partial<SalesTransaction>): SalesTransaction => ({
  id: 't', date: '2026-07-20', customerName: '', subtotal: 0, tax: 0, platformFee: 0,
  purchaseCost: 0, repairCost: 0, totalCost: 0, totalPaid: 0, netProfit: 0, lines: [], ...p,
});
const dev = (p: Partial<InventoryItem>): InventoryItem => ({
  id: 'd', kind: 'device', date: '2026-01-01', item: 'Phone', imei: '', boughtFrom: '',
  purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, notes: '', ...p,
} as InventoryItem);
const expense = (p: Partial<Expense>): Expense => ({
  id: 'e', date: '2026-07-10', amount: 0, category: 'other', paymentMethod: 'cash',
  enteredBy: 'o', enteredByEmail: 'o@shop.test', createdAt: 0, ...p,
});
const paid = (p: Partial<PayPeriodPaid>): PayPeriodPaid => ({
  id: 'x', userId: 'u1', periodStart: '2026-07-01', periodEnd: '2026-07-14',
  markedBy: 'o', markedAt: 0, hours: 0, gross: 0, rate: 0, ...p,
});
// A completed shift of `hours` hours on `date`, stamped at `locationId`.
const shift = (date: string, hours: number, locationId?: string, userId = 'u1'): TimeEntry => {
  const clockIn = new Date(`${date}T14:00:00Z`).getTime();
  return {
    id: `${date}-${locationId || 'none'}-${hours}`, userId, clockIn,
    clockOut: clockIn + hours * 3600_000, breaks: [],
    ...(locationId ? { locationId } : {}),
  };
};
const settle = (p: Partial<Settlement>): Settlement => ({
  id: 's', buyerId: 'r1', date: '2026-07-05', dropOffIds: [], model: 'financing',
  principalStoreFunded: 0, principalPersonalFunded: 0, principalOwed: 0,
  totalFees: 0, amountOwed: 0, storeCashIn: 0, notes: '', ...p,
});
const bonus = (p: Partial<StaffBonus>): StaffBonus => ({
  id: 'b', userId: 'u1', amount: 0, date: '2026-07-10', reason: 'good month',
  paidBy: 'o', paidAt: 0, ...p,
} as StaffBonus);

const ctx = { locations: locs, now: NOW };

/* ======================================================================== *
 * 1. WITH NO FILTER APPLIED, NOTHING CHANGED
 * ======================================================================== */

describe('the combined books are the SAME computation they always were', () => {
  const input: ProfitLossInput = {
    transactions: [tx({ id: 'a', subtotal: 100, locationId: BRAMPTON })],
    inventory: [dev({ id: 'd1', soldDate: '2026-07-15', salePrice: 50, locationId: MISSY })],
    payPeriods: [paid({ gross: 300 })],
    cashReconciliations: [],
    settlements: [settle({ totalFees: 20, amountOwed: 20, storeCashIn: 20 })],
    expenses: [expense({ amount: 40, category: 'rent', locationId: COMPANY_LOCATION_ID })],
    expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
    bonuses: [bonus({ amount: 25 })],
  };

  // THE load-bearing test of the whole stage. Not a deep-equality check on the
  // figures — the object identity, which is what makes a drift impossible
  // rather than merely unlikely.
  it('returns the very object it was given, array for array', () => {
    const out = scopeProfitLossInput(input, ALL_STORES_SCOPE, ctx);
    expect(out).toBe(input);
    expect(out.transactions).toBe(input.transactions);
    expect(out.inventory).toBe(input.inventory);
    expect(out.payPeriods).toBe(input.payPeriods);
    expect(out.expenses).toBe(input.expenses);
    expect(out.settlements).toBe(input.settlements);
    expect(out.bonuses).toBe(input.bonuses);
  });

  it('and so every unfiltered figure is identical to the unscoped P&L', () => {
    const before = profitAndLoss(input, '2026-07-01', '2026-07-31');
    const after = profitAndLoss(scopeProfitLossInput(input, ALL_STORES_SCOPE, ctx), '2026-07-01', '2026-07-31');
    expect(after).toEqual(before);
  });

  it('the analytics input is passed through untouched too', () => {
    const aInput = {
      salesTransactions: input.transactions, repairs: [] as Repair[], inventory: input.inventory,
      customers: [], auditLogs: [], activity: [], settlements: input.settlements,
    };
    const out = scopeAnalyticsInput(aInput, ALL_STORES_SCOPE, ctx);
    expect(out).toBe(aInput);
  });

  it('a workspace with no store list reports combined, exactly as before', () => {
    // No locations configured at all — stage 5 is invisible until stage 1 ran.
    expect(visibleScopesFor({ role: 'owner' }, [])).toEqual([]);
    expect(resolveScope({ role: 'owner' }, [], MISSY)).toBe(ALL_STORES_SCOPE);
    expect(scopeProfitLossInput(input, ALL_STORES_SCOPE, { locations: [] })).toBe(input);
  });
});

/* ======================================================================== *
 * 2. NOTHING DISAPPEARS, AND THE PARTS ARE LABELLED AS NOT ADDING UP
 * ======================================================================== */

describe('each store, the company, and what they add up to', () => {
  const input: ProfitLossInput = {
    transactions: [
      tx({ id: 'bram', date: '2026-07-10', subtotal: 1000, purchaseCost: 400, locationId: BRAMPTON }),
      tx({ id: 'missy', date: '2026-07-11', subtotal: 600, purchaseCost: 200, locationId: MISSY }),
      // Predates the second store: no location at all.
      tx({ id: 'legacy', date: '2026-07-12', subtotal: 100, purchaseCost: 10 }),
    ],
    inventory: [],
    payPeriods: [],
    cashReconciliations: [],
    settlements: [],
    expenses: [
      expense({ id: 'rent-b', date: '2026-07-02', amount: 2000, category: 'rent', locationId: BRAMPTON }),
      expense({ id: 'rent-m', date: '2026-07-02', amount: 1500, category: 'rent', locationId: MISSY }),
      expense({ id: 'saas', date: '2026-07-03', amount: 90, category: 'other', locationId: COMPANY_LOCATION_ID }),
      expense({ id: 'untagged', date: '2026-07-04', amount: 11, category: 'other' }),
    ],
    expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
    bonuses: [bonus({ amount: 250, date: '2026-07-20' })],
  };
  const pl = (scope: string) =>
    profitAndLoss(scopeProfitLossInput(input, scope, ctx), '2026-07-01', '2026-07-31');

  it('a store sees its own revenue and nobody else\'s', () => {
    expect(pl(BRAMPTON).revenue).toBe(1100);   // its own 1000 + the untagged 100
    expect(pl(MISSY).revenue).toBe(600);
    expect(pl(ALL_STORES_SCOPE).revenue).toBe(1700);
  });

  it('revenue splits exactly: the stores add up to combined', () => {
    expect(pl(BRAMPTON).revenue + pl(MISSY).revenue).toBe(pl(ALL_STORES_SCOPE).revenue);
  });

  it('a company-tagged cost is in the combined P&L and in NEITHER store', () => {
    expect(pl(BRAMPTON).expenses).toBe(2011);  // its rent + the untagged 11
    expect(pl(MISSY).expenses).toBe(1500);
    expect(pl(ALL_STORES_SCOPE).expenses).toBe(3601);   // + the $90 of company software
    // The $90 is the gap, and it is real: it belongs to neither shop.
    expect(pl(ALL_STORES_SCOPE).expenses - (pl(BRAMPTON).expenses + pl(MISSY).expenses)).toBe(90);
  });

  it('the stores therefore do NOT add up to combined net profit — and the report says so', () => {
    const parts = pl(BRAMPTON).netProfit + pl(MISSY).netProfit;
    expect(parts).not.toBe(pl(ALL_STORES_SCOPE).netProfit);
    // Exactly the company overhead plus the bonus, nothing unexplained.
    expect(parts - pl(ALL_STORES_SCOPE).netProfit).toBe(90 + 250);
    expect(scopeCaveat(BRAMPTON)).toBe(SCOPE_CAVEAT);
    expect(SCOPE_CAVEAT).toMatch(/do not add up/i);
    expect(SCOPE_CAVEAT).toMatch(/BEFORE company overhead/);
  });

  it('an UNTAGGED record is never lost: it is in combined and in exactly one store', () => {
    const inBram = scopeProfitLossInput(input, BRAMPTON, ctx);
    const inMissy = scopeProfitLossInput(input, MISSY, ctx);
    const has = (i: typeof inBram, id: string) => i.transactions.some(t => t.id === id);
    expect(has(inBram, 'legacy')).toBe(true);     // the default store carries it
    expect(has(inMissy, 'legacy')).toBe(false);
    expect(input.transactions.some(t => t.id === 'legacy')).toBe(true);
    const eIds = (i: typeof inBram) => i.expenses.map(e => e.id);
    expect(eIds(inBram)).toContain('untagged');
    expect(eIds(inMissy)).not.toContain('untagged');
  });

  it('every expense reaches the combined figure, tagged or not', () => {
    const combined = scopeProfitLossInput(input, ALL_STORES_SCOPE, ctx);
    expect(combined.expenses.map(e => e.id).sort())
      .toEqual(['rent-b', 'rent-m', 'saas', 'untagged']);
  });
});

/* ======================================================================== *
 * 3. NOTHING IS COUNTED TWICE
 * ======================================================================== */

describe('which store a sale\'s profit belongs to', () => {
  const byId = (items: InventoryItem[]) => indexInventory(items);

  it('follows the DEVICE, not the terminal it was rung on', () => {
    // The owner's rule: an online sale follows the device. A Mississauga
    // laptop rung up at the Brampton counter is Mississauga's sale.
    const items = [dev({ id: 'd1', locationId: MISSY })];
    const t = tx({ locationId: BRAMPTON, lines: [{ inventoryId: 'd1', kind: 'device', name: 'x', quantity: 1, unitPrice: 1 } as any] });
    expect(saleStore(t, byId(items), BRAMPTON)).toBe(MISSY);
  });

  it('a MIXED-store cart falls back to where it was rung', () => {
    const items = [dev({ id: 'd1', locationId: MISSY }), dev({ id: 'd2', locationId: BRAMPTON })];
    const t = tx({
      locationId: BRAMPTON,
      lines: [
        { inventoryId: 'd1', kind: 'device', name: 'x', quantity: 1, unitPrice: 1 } as any,
        { inventoryId: 'd2', kind: 'device', name: 'y', quantity: 1, unitPrice: 1 } as any,
      ],
    });
    expect(saleStore(t, byId(items), BRAMPTON)).toBe(BRAMPTON);
  });

  it('a labour-only or accessories-only sale uses the sale\'s own store', () => {
    const t = tx({ locationId: MISSY, lines: [{ kind: 'labour', name: 'Screen fit', quantity: 1, unitPrice: 80 } as any] });
    expect(saleStore(t, byId([]), BRAMPTON)).toBe(MISSY);
  });

  it('a sale predating the split belongs to the default store', () => {
    expect(saleStore(tx({}), byId([]), BRAMPTON)).toBe(BRAMPTON);
  });

  // The trap this stage would most plausibly fall into. `profitAndLoss` counts
  // a sold device as a STANDALONE sale when no transaction line points at it,
  // building that id set from the transactions it was HANDED. Filter the
  // transactions per store and the device reappears in the other store.
  it('a device at one store sold on the other store\'s receipt is counted ONCE', () => {
    const input: ProfitLossInput = {
      // The cart is mixed, so the sale is attributed to where it was rung
      // (Brampton) while the device itself sits at Mississauga.
      transactions: [tx({
        id: 'mixed', date: '2026-07-10', subtotal: 900, purchaseCost: 300, locationId: BRAMPTON,
        lines: [
          { inventoryId: 'dm', kind: 'device', name: 'm', quantity: 1, unitPrice: 500 } as any,
          { inventoryId: 'db', kind: 'device', name: 'b', quantity: 1, unitPrice: 400 } as any,
        ],
      })],
      inventory: [
        dev({ id: 'dm', locationId: MISSY, soldDate: '2026-07-10', salePrice: 500, purchaseCost: 100 }),
        dev({ id: 'db', locationId: BRAMPTON, soldDate: '2026-07-10', salePrice: 400, purchaseCost: 200 }),
      ],
      payPeriods: [], cashReconciliations: [], settlements: [], expenses: [],
      expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
    };
    const pl = (s: string) => profitAndLoss(scopeProfitLossInput(input, s, ctx), '2026-07-01', '2026-07-31');
    expect(pl(ALL_STORES_SCOPE).revenue).toBe(900);
    expect(pl(BRAMPTON).revenue).toBe(900);
    // Mississauga must NOT see its device turn up again as a standalone sale.
    expect(pl(MISSY).revenue).toBe(0);
    expect(pl(BRAMPTON).revenue + pl(MISSY).revenue).toBe(pl(ALL_STORES_SCOPE).revenue);
  });

  it('a standalone sold device (no transaction at all) stays with its own store', () => {
    const input: ProfitLossInput = {
      transactions: [],
      inventory: [dev({ id: 'solo', locationId: MISSY, soldDate: '2026-07-10', salePrice: 250, purchaseCost: 100 })],
      payPeriods: [], cashReconciliations: [], settlements: [], expenses: [],
      expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
    };
    const pl = (s: string) => profitAndLoss(scopeProfitLossInput(input, s, ctx), '2026-07-01', '2026-07-31');
    expect(pl(MISSY).revenue).toBe(250);
    expect(pl(BRAMPTON).revenue).toBe(0);
    expect(pl(ALL_STORES_SCOPE).revenue).toBe(250);
  });
});

/* ======================================================================== *
 * 4. WAGES, FROM THE STAMPED SHIFTS
 * ======================================================================== */

describe('each store\'s wage cost comes from the stamped shifts', () => {
  const periods = [paid({ id: 'p1', userId: 'u1', gross: 1000, hours: 40, rate: 25 })];

  it('splits one paid period across the stores the person actually worked', () => {
    const entries = [
      shift('2026-07-02', 30, BRAMPTON),
      shift('2026-07-03', 10, MISSY),
    ];
    const b = scopePayPeriods(periods, BRAMPTON, { ...ctx, timeEntries: entries });
    const m = scopePayPeriods(periods, MISSY, { ...ctx, timeEntries: entries });
    expect(b[0].gross).toBe(750);
    expect(m[0].gross).toBe(250);
    expect(b[0].hours).toBe(30);
    expect(m[0].hours).toBe(10);
  });

  it('the shares add up to the paid total, to the cent — it is never re-priced', () => {
    const entries = [shift('2026-07-02', 1, BRAMPTON), shift('2026-07-03', 2, MISSY)];
    const odd = [paid({ gross: 1000.01, hours: 3 })];
    const b = scopePayPeriods(odd, BRAMPTON, { ...ctx, timeEntries: entries });
    const m = scopePayPeriods(odd, MISSY, { ...ctx, timeEntries: entries });
    // Each share is rounded in its own right, so they may differ from the
    // paid figure by a cent. That is stated, bounded, and must stay bounded.
    expect(Math.abs((b[0].gross + m[0].gross) - 1000.01)).toBeLessThanOrEqual(0.01);
  });

  it('a period with NO stamped shifts goes whole to the default store', () => {
    // Every period signed off before stage 3 existed looks like this.
    const b = scopePayPeriods(periods, BRAMPTON, { ...ctx, timeEntries: [] });
    const m = scopePayPeriods(periods, MISSY, { ...ctx, timeEntries: [] });
    expect(b.map(p => p.gross)).toEqual([1000]);
    expect(m).toEqual([]);
  });

  it('an UNSTAMPED shift reads as the default store, like every other record', () => {
    const entries = [shift('2026-07-02', 20), shift('2026-07-03', 20, MISSY)];
    const b = scopePayPeriods(periods, BRAMPTON, { ...ctx, timeEntries: entries });
    expect(b[0].gross).toBe(500);
  });

  it('shifts outside the period, and other people\'s shifts, are not counted', () => {
    const entries = [
      shift('2026-07-02', 10, BRAMPTON),
      shift('2026-07-20', 90, MISSY),           // after periodEnd
      shift('2026-07-03', 90, MISSY, 'someone-else'),
    ];
    expect(scopePayPeriods(periods, BRAMPTON, { ...ctx, timeEntries: entries })[0].gross).toBe(1000);
    expect(scopePayPeriods(periods, MISSY, { ...ctx, timeEntries: entries })).toEqual([]);
  });

  it('drops rateSegments, which describe the PERSON\'s period and not a store\'s share', () => {
    const withSegs = [paid({ gross: 1000, hours: 40, rateSegments: [{ rate: 25, hours: 40, gross: 1000 }] })];
    const entries = [shift('2026-07-02', 40, BRAMPTON)];
    const b = scopePayPeriods(withSegs, BRAMPTON, { ...ctx, timeEntries: entries });
    expect(b[0].rateSegments).toBeUndefined();
    // Unscoped, the person's own record keeps everything it had.
    expect(scopePayPeriods(withSegs, ALL_STORES_SCOPE, ctx)[0].rateSegments).toBeDefined();
  });

  it('the combined payroll figure is untouched by any of this', () => {
    expect(scopePayPeriods(periods, ALL_STORES_SCOPE, ctx)).toBe(periods);
  });
});

/* ======================================================================== *
 * 5. BONUSES BELONG TO THE COMPANY
 * ======================================================================== */

describe('staff bonuses', () => {
  const bonuses = [bonus({ amount: 250 })];

  it('are in the combined P&L and in neither store', () => {
    expect(scopeBonuses(bonuses, ALL_STORES_SCOPE)).toBe(bonuses);
    expect(scopeBonuses(bonuses, BRAMPTON)).toEqual([]);
    expect(scopeBonuses(bonuses, MISSY)).toEqual([]);
  });

  it('so a store\'s P&L has no bonus line at all', () => {
    const input: ProfitLossInput = {
      transactions: [], inventory: [], payPeriods: [], cashReconciliations: [], settlements: [],
      expenses: [], expenseCategories: DEFAULT_EXPENSE_CATEGORIES, bonuses,
    };
    expect(profitAndLoss(scopeProfitLossInput(input, BRAMPTON, ctx), '2026-07-01', '2026-07-31').bonuses).toBe(0);
    expect(profitAndLoss(input, '2026-07-01', '2026-07-31').bonuses).toBe(250);
  });
});

/* ======================================================================== *
 * 6. STOCK IN TRANSIT STAYS WITH THE SENDER
 * ======================================================================== */

describe('a device in transit between the stores', () => {
  // Stage 4 leaves `locationId` at the sender until the destination receives
  // it, so this needs no special case — which is the point.
  const inv = [
    dev({ id: 'moving', locationId: BRAMPTON, inTransferId: 'tr1', purchaseCost: 300, repairCost: 20, targetSalePrice: 500 }),
    dev({ id: 'settled', locationId: MISSY, purchaseCost: 100, targetSalePrice: 200 }),
  ];
  const a = (scope: string) => computeAnalytics(
    presetRange('month', NOW),
    scopeAnalyticsInput(
      { salesTransactions: [], repairs: [], inventory: inv, customers: [], auditLogs: [], activity: [] },
      scope, ctx,
    ),
    NOW,
  );

  it('is the SENDING store\'s stock, not the receiving store\'s', () => {
    expect(a(BRAMPTON).invCost).toBe(320);
    expect(a(MISSY).invCost).toBe(100);
  });

  it('is never on both stores\' books, and never falls out of the combined total', () => {
    expect(a(BRAMPTON).invCost + a(MISSY).invCost).toBe(a(ALL_STORES_SCOPE).invCost);
    expect(a(ALL_STORES_SCOPE).invCost).toBe(420);
  });

  it('is named on the figure rather than quietly folded into it', () => {
    const t = inTransitValue(inv, BRAMPTON, BRAMPTON);
    expect(t).toEqual({ count: 1, cost: 320 });
    expect(inTransitNote(t)).toMatch(/1 device in transit/);
    expect(inTransitNote(t)).toMatch(/still this store's stock/);
    // Nothing in transit → nothing to say.
    expect(inTransitNote(inTransitValue(inv, MISSY, BRAMPTON))).toBe('');
  });

  it('a device already SOLD is not reported as in transit', () => {
    const sold = [dev({ id: 'x', locationId: BRAMPTON, inTransferId: 'tr9', soldDate: '2026-07-01', purchaseCost: 50 })];
    expect(inTransitValue(sold, BRAMPTON, BRAMPTON).count).toBe(0);
  });
});

/* ======================================================================== *
 * 7. NAMING THE SCOPE, AND WHO MAY PICK IT
 * ======================================================================== */

describe('the scope is named unmistakably', () => {
  it('names the combined books as combined, never as a blank', () => {
    expect(scopeLabel(ALL_STORES_SCOPE, locs)).toBe(ALL_STORES_LABEL);
    expect(ALL_STORES_LABEL).toMatch(/combined/i);
    expect(scopeCaveat(ALL_STORES_SCOPE)).toBe(ALL_STORES_CAVEAT);
  });

  it('says "only" on a single store, so a forwarded report cannot be misread', () => {
    expect(scopeLabel(BRAMPTON, locs)).toBe('Brampton only');
  });

  it('still names a CLOSED store, because its history must stay readable', () => {
    const closed = [...locs, { id: 'old', name: 'Kiosk', active: false, createdAt: NOW }];
    expect(scopeLabel('old', closed)).toBe('Kiosk (closed) only');
  });

  it('does not render a dangling id as a blank', () => {
    expect(scopeLabel('gone', locs)).toBe('Unknown store');
  });

  it('gives print and CSV one line carrying both the scope and its caveat', () => {
    expect(scopeHeading(BRAMPTON, locs)).toBe(`Scope: Brampton only — ${SCOPE_CAVEAT}`);
    expect(scopeHeading(ALL_STORES_SCOPE, locs)).toContain(ALL_STORES_LABEL);
  });
});

describe('which scopes a viewer is offered — no new permissions', () => {
  const user = (p: Partial<AppUser>): AppUser => ({
    id: 'u', email: 'u@shop.test', role: 'manager', workspaceId: 'w', ...p,
  } as AppUser);

  it('the owner is offered combined and every store', () => {
    expect(visibleScopesFor(user({ role: 'owner' }), locs)).toEqual([ALL_STORES_SCOPE, BRAMPTON, MISSY]);
  });

  it('a manager rostered to one store is offered that store', () => {
    expect(visibleScopesFor(user({ locationIds: [MISSY] }), locs)).toEqual([ALL_STORES_SCOPE, MISSY]);
    expect(canUseScope(user({ locationIds: [MISSY] }), locs, BRAMPTON)).toBe(false);
  });

  // Load-bearing: the combined books are what they see TODAY. Withholding
  // them would be taking away a figure, not scoping a report.
  it('everybody who can see the reports keeps the combined books', () => {
    expect(visibleScopesFor(user({ locationIds: [MISSY] }), locs)).toContain(ALL_STORES_SCOPE);
    expect(canUseScope(user({ locationIds: [MISSY] }), locs, ALL_STORES_SCOPE)).toBe(true);
  });

  it('nobody set up: an empty roster means the default store, not a lockout', () => {
    expect(visibleScopesFor(user({}), locs)).toEqual([ALL_STORES_SCOPE, BRAMPTON]);
  });

  it('a remembered store nobody may see any more falls back to combined, never to the other shop', () => {
    expect(resolveScope(user({ locationIds: [MISSY] }), locs, BRAMPTON)).toBe(ALL_STORES_SCOPE);
    expect(resolveScope(user({ locationIds: [MISSY] }), locs, MISSY)).toBe(MISSY);
  });
});

/* ======================================================================== *
 * 8. TAGGING AN EXPENSE — NO SILENT DEFAULT
 * ======================================================================== */

describe('an expense must be told where it belongs', () => {
  it('offers every open store and Company, with Company last and not first', () => {
    const opts = expenseScopeOptions(locs);
    expect(opts.map(o => o.id)).toEqual([BRAMPTON, MISSY, COMPANY_LOCATION_ID]);
    expect(opts[opts.length - 1].label).toMatch(/neither store/i);
  });

  it('blocks a save until the tag is chosen — a default tag is how rent lands on the wrong store', () => {
    expect(expenseNeedsStore({}, locs)).toBe(true);
    expect(expenseNeedsStore({ locationId: MISSY }, locs)).toBe(false);
    expect(expenseNeedsStore({ locationId: COMPANY_LOCATION_ID }, locs)).toBe(false);
    expect(EXPENSE_STORE_REQUIRED).toMatch(/Company/);
  });

  it('asks for nothing in a workspace that has no stores', () => {
    expect(expenseNeedsStore({}, [])).toBe(false);
  });

  it('lists the untagged and the company-tagged, so the owner can find and retag them', () => {
    const rows = [
      expense({ id: 'a' }),
      expense({ id: 'b', locationId: BRAMPTON }),
      expense({ id: 'c', locationId: COMPANY_LOCATION_ID }),
    ];
    expect(untaggedExpenses(rows).map(e => e.id)).toEqual(['a']);
    expect(companyExpenses(rows).map(e => e.id)).toEqual(['c']);
  });

  it('COMPANY can never be a store scope, so a store can never pick up company costs', () => {
    // The sentinel is not a Location and `checkLocation` reserves the id, so
    // this holds by construction. Asserted anyway: it is the one exclusion the
    // whole per-store P&L rests on.
    const rows = [expense({ id: 'co', amount: 90, locationId: COMPANY_LOCATION_ID })];
    expect(scopeExpenses(rows, BRAMPTON, BRAMPTON)).toEqual([]);
    expect(scopeExpenses(rows, MISSY, BRAMPTON)).toEqual([]);
    expect(scopeExpenses(rows, ALL_STORES_SCOPE, BRAMPTON)).toBe(rows);
    expect(locs.some(l => l.id === COMPANY_LOCATION_ID)).toBe(false);
  });
});

/* ======================================================================== *
 * 9. THE SHARED FALLBACK RULE
 * ======================================================================== */

describe('an untagged record reads as the default store', () => {
  it('matches the rule stages 2–4 already use', () => {
    expect(recordStore({}, BRAMPTON)).toBe(BRAMPTON);
    expect(recordStore({ locationId: MISSY }, BRAMPTON)).toBe(MISSY);
  });

  it('isAllStores is the empty scope and nothing else', () => {
    expect(isAllStores(ALL_STORES_SCOPE)).toBe(true);
    expect(isAllStores(BRAMPTON)).toBe(false);
  });

  it('drawers, settlements and repairs all follow it', () => {
    const recs: CashReconciliation[] = [
      { id: 'a', date: '2026-07-01', expectedCash: 1, countedCash: 1, variance: 0, recordedBy: 'o', recordedAt: 0 },
      { id: 'b', date: '2026-07-01', expectedCash: 2, countedCash: 2, variance: 0, recordedBy: 'o', recordedAt: 0, locationId: MISSY },
    ];
    const input: ProfitLossInput = {
      transactions: [], inventory: [], payPeriods: [], cashReconciliations: recs,
      settlements: [settle({ id: 's1' }), settle({ id: 's2', locationId: MISSY })],
      expenses: [], expenseCategories: DEFAULT_EXPENSE_CATEGORIES,
    };
    expect(scopeProfitLossInput(input, BRAMPTON, ctx).cashReconciliations.map(r => r.id)).toEqual(['a']);
    expect(scopeProfitLossInput(input, MISSY, ctx).settlements.map(s => s.id)).toEqual(['s2']);
  });
});
