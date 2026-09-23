import { describe, it, expect } from 'vitest';
import { BuildLabourEntry, BuildPart, BuildStatus, InventoryItem, PcBuild } from '../types';
import {
  BUILD_FLOW, buildLabourEntry, buildToInventoryItem, buildTotals, deviceCostForBuild,
  generatedItemName, isBackwards, isBuildFinished, isSellable, labourCost, nextStatus,
  partsCost, partsEditable, pcPartPickerSearchUrl, retailAgeDays, retailAsOfLabel,
  retailComparison, specsLine, splitBuilds, buildSearchText,
  partComparisonPrice, partStoreName,
} from './pcBuild';
import { profitAndLoss } from './reports';
import { buildSearchable, queryWords, matchesWords } from './itemSearch';

const part = (p: Partial<BuildPart> = {}): BuildPart => ({
  id: 'p1', category: 'CPU', name: 'Ryzen 7 7800X3D', cost: 400,
  condition: 'new', source: 'retail', ...p,
});

const labour = (p: Partial<BuildLabourEntry> = {}): BuildLabourEntry => ({
  id: 'l1', userId: 'u1', userEmail: 'sam@shop.test', hours: 2,
  date: '2026-03-01', rate: 15, loggedAt: 1, ...p,
});

const build = (p: Partial<PcBuild> = {}): PcBuild => ({
  id: 'b1', name: 'Starter Gaming PC', kind: 'shelf', status: 'planning',
  parts: [], labour: [], createdBy: 'u1', createdByEmail: 'sam@shop.test',
  createdAt: 1, updatedAt: 1, ...p,
});

const FULL_PARTS = [
  part({ id: 'p1', category: 'CPU', name: 'Ryzen 7 7800X3D', cost: 400, retailPrice: 480, retailCheckedAt: '2026-03-01' }),
  part({ id: 'p2', category: 'GPU', name: 'RTX 4070 Windforce OC 12GB', cost: 500, retailPrice: 700, retailCheckedAt: '2026-03-01' }),
  part({ id: 'p3', category: 'RAM', name: '32GB DDR5 6000', cost: 90, retailPrice: 120, retailCheckedAt: '2026-03-01' }),
  part({ id: 'p4', category: 'Storage', name: '1TB NVMe', cost: 60, retailPrice: 120, retailCheckedAt: '2026-03-01' }),
];

describe('the build pipeline', () => {
  it('moves forward one step at a time and stops at ready', () => {
    expect(BUILD_FLOW).toEqual(['planning', 'parts_ordered', 'assembling', 'testing', 'ready']);
    expect(nextStatus('planning')).toBe('parts_ordered');
    expect(nextStatus('testing')).toBe('ready');
    expect(nextStatus('ready')).toBeNull();
  });

  it('flags a step BACKWARDS, which needs a confirm', () => {
    expect(isBackwards('ready', 'assembling')).toBe(true);
    expect(isBackwards('assembling', 'testing')).toBe(false);
    // Finishing, selling or cancelling from anywhere is never "backwards".
    expect(isBackwards('planning', 'cancelled')).toBe(false);
    expect(isBackwards('testing', 'sold')).toBe(false);
  });

  it('splits In progress from Completed', () => {
    const builds = [
      build({ id: 'a', status: 'assembling' }),
      build({ id: 'b', status: 'sold' }),
      build({ id: 'c', status: 'picked_up' }),
      build({ id: 'd', status: 'cancelled' }),
      build({ id: 'e', status: 'ready' }),
    ];
    const s = splitBuilds(builds);
    expect(s.active.map(b => b.id)).toEqual(['a', 'e']);
    expect(s.completed.map(b => b.id)).toEqual(['b', 'c', 'd']);
    expect(isBuildFinished({ status: 'ready' as BuildStatus })).toBe(false);
  });

  it('A CUSTOMER ORDER IS NEVER SELLABLE STOCK', () => {
    expect(isSellable({ kind: 'shelf', status: 'ready' })).toBe(true);
    expect(isSellable({ kind: 'customer', status: 'ready' })).toBe(false);
    expect(isSellable({ kind: 'customer', status: 'planning' })).toBe(false);
    // ...and a finished shelf build is no longer on offer either.
    expect(isSellable({ kind: 'shelf', status: 'sold' })).toBe(false);
  });
});

describe('totals', () => {
  it('adds parts, labour and the build total, with profit and margin', () => {
    const b = build({
      parts: FULL_PARTS, labour: [labour({ hours: 3, rate: 15 })], targetPrice: 1400,
    });
    const t = buildTotals(b);
    expect(t.partsCost).toBe(1050);
    expect(t.labourHours).toBe(3);
    expect(t.labourCost).toBe(45);
    expect(t.totalCost).toBe(1095);
    expect(t.price).toBe(1400);
    expect(t.profit).toBe(305);
    expect(t.marginPercent).toBeCloseTo(21.79, 1);
  });

  it('reports no profit or margin until a price is set', () => {
    const t = buildTotals(build({ parts: FULL_PARTS }));
    expect(t.price).toBeNull();
    expect(t.profit).toBeNull();
    expect(t.marginPercent).toBeNull();
  });

  it('a customer order is priced on its QUOTE, a shelf build on its target', () => {
    expect(buildTotals(build({ kind: 'customer', quotePrice: 1200, targetPrice: 999 })).price).toBe(1200);
    expect(buildTotals(build({ kind: 'shelf', targetPrice: 999, quotePrice: 1200 })).price).toBe(999);
  });
});

describe('labour is snapshotted, never repriced', () => {
  it('bakes the rate in force at the moment it is logged', () => {
    const entry = buildLabourEntry({
      id: 'l9', userId: 'u1', userEmail: 'sam@shop.test',
      hours: 2.5, date: '2026-03-01', rate: 15, at: 123,
    });
    expect(entry.rate).toBe(15);
    expect(entry.hours).toBe(2.5);
    expect(entry.loggedAt).toBe(123);
  });

  it('raising the setting later does NOT reprice old entries', () => {
    const old = [labour({ id: 'a', hours: 2, rate: 15 })];
    const mixed = [...old, labour({ id: 'b', hours: 2, rate: 25 })];
    expect(labourCost(old)).toBe(30);
    // The new entry is at the new rate; the old one keeps the old one.
    expect(labourCost(mixed)).toBe(80);
  });

  it('never goes negative on a nonsense entry', () => {
    const entry = buildLabourEntry({
      id: 'l', userId: 'u', userEmail: 'e', hours: -5, date: 'd', rate: -3, at: 1,
    });
    expect(entry.hours).toBe(0);
    expect(entry.rate).toBe(0);
  });
});

describe('NO DOUBLE COUNTING — labour is payroll\'s, not the P&L\'s', () => {
  it("a finished build's device cost is PARTS ONLY", () => {
    const b = build({ parts: FULL_PARTS, labour: [labour({ hours: 10, rate: 15 })] });
    expect(partsCost(b.parts)).toBe(1050);
    expect(buildTotals(b).labourCost).toBe(150);
    // The device carries parts only — option (a).
    expect(deviceCostForBuild(b)).toBe(1050);
  });

  it('a sold build does not count the same labour twice', () => {
    const b = build({ parts: FULL_PARTS, labour: [labour({ hours: 10, rate: 15 })], targetPrice: 1400 });
    const device = buildToInventoryItem({ build: b, sku: 'FTT-000010', itemId: 'inv1', today: '2026-03-05' });
    const sold: InventoryItem = { ...device, soldDate: '2026-03-10', salePrice: 1400 };

    // Payroll already paid the builder $150 for those hours.
    const pl = profitAndLoss({
      transactions: [], inventory: [sold],
      payPeriods: [{
        id: 'u1__2026-03-01', userId: 'u1', periodStart: '2026-03-01', periodEnd: '2026-03-14',
        markedBy: 'o', markedAt: 1, hours: 10, gross: 150, rate: 15,
      }],
      cashReconciliations: [], settlements: [], expenses: [], expenseCategories: [],
    }, '2026-03-01', '2026-03-31');

    expect(pl.revenue).toBe(1400);
    // Cost of goods is the PARTS. The $150 of labour appears once, as payroll.
    expect(pl.costOfGoods).toBe(1050);
    expect(pl.payroll).toBe(150);
    // 1400 − 1050 − 150 = 200. If labour were also in cost of goods this would
    // be 50, and the shop would think it made a third of what it did.
    expect(pl.netProfit).toBe(200);
  });
});

describe('the retail comparison', () => {
  it('shows a saving only when EVERY part has a retail price', () => {
    const complete = build({ parts: FULL_PARTS, targetPrice: 1200 });
    expect(retailComparison(complete)).toEqual({ retailTotal: 1420, price: 1200, saving: 220 });

    const partial = build({
      parts: [...FULL_PARTS, part({ id: 'p5', category: 'PSU', name: '750W', cost: 80 })],
      targetPrice: 1200,
    });
    // Four of five priced: the total would understate the machine and nobody
    // reading it could tell.
    expect(retailComparison(partial)).toBeNull();
  });

  it('omits the comparison when it would be unflattering', () => {
    const cheap = build({
      parts: [part({ retailPrice: 300, retailCheckedAt: '2026-03-01' })],
      targetPrice: 400,
    });
    expect(retailComparison(cheap)).toBeNull();
  });

  it('takes a price override — the device\'s price once it exists', () => {
    const b = build({ parts: FULL_PARTS, targetPrice: 1200 });
    expect(retailComparison(b, 1000)?.saving).toBe(420);
  });

  it('ALWAYS shows a retail price with the date it was checked', () => {
    expect(retailAsOfLabel(part({ retailPrice: 549.99, retailCheckedAt: '2026-03-04' })))
      .toBe('$549.99 (as of 2026-03-04)');
    // A price with no date does not get to look current.
    expect(retailAsOfLabel(part({ retailPrice: 549.99, retailCheckedAt: undefined })))
      .toBe('$549.99 (date not recorded)');
    expect(retailAsOfLabel(part({ retailPrice: undefined }))).toBeNull();
  });

  it('reports how stale a retail price is', () => {
    expect(retailAgeDays(part({ retailCheckedAt: '2026-03-01' }), '2026-03-31')).toBe(30);
    expect(retailAgeDays(part({ retailCheckedAt: '2026-03-31' }), '2026-03-31')).toBe(0);
    expect(retailAgeDays(part({ retailCheckedAt: undefined }), '2026-03-31')).toBeNull();
  });
});

describe('the generated name', () => {
  it('reads CPU / GPU / RAM / Storage, in that order', () => {
    expect(specsLine(FULL_PARTS)).toBe('Ryzen 7 7800X3D / RTX 4070 Windforce OC 12GB / 32GB DDR5 6000 / 1TB NVMe');
    expect(generatedItemName(FULL_PARTS)).toMatch(/^Custom PC · Ryzen 7 7800X3D \//);
  });

  it('skips a category that has no part rather than padding it', () => {
    expect(specsLine([FULL_PARTS[0], FULL_PARTS[3]])).toBe('Ryzen 7 7800X3D / 1TB NVMe');
  });

  it('degrades to a plain name with no parts at all', () => {
    expect(generatedItemName([])).toBe('Custom PC');
  });

  it('ignores the case, fans and PSU — the line has to stay readable', () => {
    const withExtras = [...FULL_PARTS, part({ id: 'x', category: 'Case', name: 'NZXT H5' })];
    expect(specsLine(withExtras)).not.toContain('NZXT');
  });
});

describe('finishing a shelf build', () => {
  const b = build({ parts: FULL_PARTS, labour: [labour({ hours: 4 })], targetPrice: 1400, notes: 'RGB off' });
  const device = buildToInventoryItem({ build: b, sku: 'FTT-000010', itemId: 'inv1', today: '2026-03-05' });

  it('becomes an ORDINARY device — nothing bespoke on it', () => {
    expect(device.kind).toBe('device');
    expect(device.deviceType).toBe('Desktop PC');
    expect(device.sku).toBe('FTT-000010');
    expect(device.deviceStatus).toBe('ready');
    expect(device.targetSalePrice).toBe(1400);
    expect(device.item).toMatch(/^Custom PC · /);
  });

  it('links both ways', () => {
    expect(device.pcBuildId).toBe('b1');
  });

  it('takes an edited name when the user changed the generated one', () => {
    const named = buildToInventoryItem({
      build: b, sku: 'FTT-1', itemId: 'i', today: '2026-03-05', itemName: 'The Beast',
    });
    expect(named.item).toBe('The Beast');
  });
});

describe('editing parts after the fact', () => {
  it('is allowed while the machine is still the shop\'s', () => {
    expect(partsEditable({ status: 'ready' })).toBe(true);
    expect(partsEditable({ status: 'ready' }, { soldDate: '', deviceStatus: 'ready' })).toBe(true);
  });

  it('is LOCKED once it has sold — the sale already booked that cost', () => {
    expect(partsEditable({ status: 'sold' })).toBe(false);
    expect(partsEditable({ status: 'picked_up' })).toBe(false);
    expect(partsEditable({ status: 'ready' }, { soldDate: '2026-03-10', deviceStatus: 'sold' })).toBe(false);
  });
});

describe('PCPartPicker', () => {
  it('searches the CANADIAN site, url-encoded', () => {
    expect(pcPartPickerSearchUrl('RTX 4070 Windforce OC 12GB'))
      .toBe('https://ca.pcpartpicker.com/search/?q=RTX%204070%20Windforce%20OC%2012GB');
    expect(pcPartPickerSearchUrl('  Ryzen 7  ')).toContain('ca.pcpartpicker.com');
  });
});

describe('search uses the shared matcher', () => {
  it('finds a build by name, customer, part name or part serial', () => {
    const b = build({
      name: 'Starter Gaming PC', customerName: 'Marcus Webb',
      parts: [part({ name: 'RTX 4070 Windforce OC 12GB', serial: 'GPU-99X' })],
    });
    const text = buildSearchText(b).toLowerCase();
    const s = buildSearchable({ id: b.id, item: text } as never, text);
    for (const q of ['starter gaming', 'marcus', 'rtx 4070', 'gpu-99x', '4070 rtx']) {
      expect({ q, hit: matchesWords(s, queryWords(q)) }).toEqual({ q, hit: true });
    }
    expect(matchesWords(s, queryWords('macbook'))).toBe(false);
  });
});

/**
 * OUR COST vs RETAIL vs "BUILD IT YOURSELF AT <STORE>".
 *
 * The two numbers the owner wants without doing arithmetic, plus the argument
 * the shop actually makes to a customer — which is not "these parts retail for
 * X" but "you would pay X at Canada Computers to build this yourself".
 */
describe('build totals: ours, retail, and the comparison store', () => {
  const PARTS = [
    part({ id: 'p1', cost: 400, retailPrice: 480 }),
    part({ id: 'p2', cost: 500, retailPrice: 700 }),
    part({ id: 'p3', cost: 80, retailPrice: 120 }),
  ];

  it('OUR COST is parts plus labour, and says which is which', () => {
    const t = buildTotals(build({ parts: PARTS, labour: [labour({ hours: 3, rate: 15 })] }));
    expect(t.partsCost).toBe(980);
    expect(t.labourCost).toBe(45);
    expect(t.totalCost).toBe(1025);
  });

  it('RETAIL counts how many parts are priced, out of how many there are', () => {
    const t = buildTotals(build({ parts: PARTS }));
    expect(t.retailTotal).toBe(1300);
    expect(t.retailPriced).toBe(3);
    expect(t.partCount).toBe(3);
    expect(t.retailComplete).toBe(true);
  });

  it('a PARTIAL retail total is still summed, but never called complete', () => {
    // The screen labels it partial; the figure itself is real as far as it goes.
    const t = buildTotals(build({ parts: [...PARTS, part({ id: 'p4', cost: 90 })] }));
    expect(t.retailPriced).toBe(3);
    expect(t.partCount).toBe(4);
    expect(t.retailComplete).toBe(false);
    expect(t.retailTotal).toBe(1300);
  });

  it('THE SAVING IS NULL until every part is priced', () => {
    // A saving from three parts out of four is a different number wearing the
    // same label, and nobody reading it can tell.
    const whole = buildTotals(build({ parts: PARTS, labour: [labour({ hours: 3, rate: 15 })] }));
    expect(whole.retailSaving).toBe(275);   // 1300 − 1025

    const partial = buildTotals(build({ parts: [...PARTS, part({ id: 'p4', cost: 90 })] }));
    expect(partial.retailSaving).toBeNull();
  });

  it('an empty build claims nothing', () => {
    const t = buildTotals(build({ parts: [] }));
    expect(t.retailComplete).toBe(false);
    expect(t.retailSaving).toBeNull();
    expect(t.partCount).toBe(0);
  });
});

describe('"build it yourself at <store>"', () => {
  const store = 'Canada Computers';

  it('sums the store prices when every part has one', () => {
    const t = buildTotals(build({
      comparisonStore: store,
      parts: [
        part({ id: 'p1', cost: 400, retailPrice: 480, altStorePrice: 510 }),
        part({ id: 'p2', cost: 500, retailPrice: 700, altStorePrice: 740 }),
      ],
    }));
    expect(t.altStoreName).toBe(store);
    expect(t.altStoreTotal).toBe(1250);
    expect(t.altFallbackCount).toBe(0);
    expect(t.altComplete).toBe(true);
  });

  it('FALLS BACK to the new price for parts with no store price, and says how many', () => {
    // Skipping them would understate the comparison — the exact thing this
    // figure exists to be honest about.
    const t = buildTotals(build({
      comparisonStore: store,
      parts: [
        part({ id: 'p1', cost: 400, retailPrice: 480, altStorePrice: 510 }),
        part({ id: 'p2', cost: 500, retailPrice: 700 }),
        part({ id: 'p3', cost: 80, retailPrice: 120 }),
      ],
    }));
    expect(t.altStoreTotal).toBe(1330);     // 510 + 700 + 120
    expect(t.altFallbackCount).toBe(2);
    expect(t.altComplete).toBe(true);
  });

  it('gives no total at all when a part has neither price', () => {
    const t = buildTotals(build({
      comparisonStore: store,
      parts: [part({ id: 'p1', cost: 400, altStorePrice: 510 }), part({ id: 'p2', cost: 500 })],
    }));
    expect(t.altComplete).toBe(false);
    expect(t.altStoreTotal).toBeNull();
  });

  it('is absent entirely when no store is set', () => {
    const t = buildTotals(build({ parts: [part({ cost: 400, retailPrice: 480, altStorePrice: 510 })] }));
    expect(t.altStoreName).toBeNull();
    expect(t.altStoreTotal).toBeNull();
    expect(t.altFallbackCount).toBe(0);
  });

  it('NEVER touches cost, profit or margin', () => {
    // Comparison prices are an argument, not an accounting figure.
    const plain = build({ parts: [part({ cost: 400, retailPrice: 480 })], targetPrice: 900 });
    const compared = build({
      parts: [part({ cost: 400, retailPrice: 480, altStorePrice: 9999 })],
      comparisonStore: store, targetPrice: 900,
    });
    const a = buildTotals(plain);
    const b = buildTotals(compared);
    expect(b.partsCost).toBe(a.partsCost);
    expect(b.totalCost).toBe(a.totalCost);
    expect(b.profit).toBe(a.profit);
    expect(b.marginPercent).toBe(a.marginPercent);
  });

  it('a part is priced at its own store price, else its new price', () => {
    expect(partComparisonPrice(part({ retailPrice: 480, altStorePrice: 510 }))).toBe(510);
    expect(partComparisonPrice(part({ retailPrice: 480 }))).toBe(480);
    expect(partComparisonPrice(part({}))).toBeUndefined();
    // Zero is not a price anyone charges; treat it as absent rather than free.
    expect(partComparisonPrice(part({ retailPrice: 480, altStorePrice: 0 }))).toBe(480);
  });

  it("a part's store defaults to the build's, so it is typed once", () => {
    const b = build({ comparisonStore: store });
    expect(partStoreName(part({}), b)).toBe(store);
    expect(partStoreName(part({ altStoreName: 'Memory Express' }), b)).toBe('Memory Express');
    expect(partStoreName(part({}), build({}))).toBe('');
  });
});
