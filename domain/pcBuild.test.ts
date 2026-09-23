import { describe, it, expect } from 'vitest';
import { BuildLabourEntry, BuildPart, BuildStatus, InventoryItem, PcBuild } from '../types';
import {
  BUILD_FLOW, buildLabourEntry, buildToInventoryItem, buildTotals, deviceCostForBuild,
  generatedItemName, isBackwards, isBuildFinished, isSellable, labourCost, nextStatus,
  partsCost, partsEditable, pcPartPickerSearchUrl, retailAgeDays, retailAsOfLabel,
  retailComparison, specsLine, splitBuilds, buildSearchText,
  partComparisonPrice, partStoreName,
  duplicateBuild, duplicateName, priceChangeWarning, depositOnBuild,
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

/* ---------------- Duplicating a build ---------------- */

describe('duplicateName', () => {
  it('suffixes the original', () => {
    expect(duplicateName('REAPER Gaming PC')).toBe('REAPER Gaming PC copy');
  });

  it('counts instead of stacking the word — a batch of the same spec is normal', () => {
    expect(duplicateName('REAPER Gaming PC copy')).toBe('REAPER Gaming PC copy 2');
    expect(duplicateName('REAPER Gaming PC copy 2')).toBe('REAPER Gaming PC copy 3');
    expect(duplicateName('REAPER Gaming PC copy 9')).toBe('REAPER Gaming PC copy 10');
  });

  it('never returns an empty name', () => {
    expect(duplicateName('')).toBe('Build copy');
    expect(duplicateName('   ')).toBe('Build copy');
  });
});

describe('duplicateBuild', () => {
  const original = (): PcBuild => ({
    id: 'b1',
    name: 'REAPER Gaming PC',
    kind: 'shelf',
    status: 'ready',
    targetPrice: 1800,
    comparisonStore: 'Canada Computers',
    notes: 'waiting on the GPU',
    customerId: 'c1',
    customerName: 'Dana Wu',
    customerPhone: '416-555-0100',
    quotePrice: 1750,
    inventoryId: 'inv-1',
    sku: 'FTT-0000777',
    saleId: 'sale-1',
    finishedAt: 1,
    shareToken: 'kadamuze',
    shareCreatedAt: 1,
    shareCreatedBy: 'u1',
    duplicatedFrom: 'b0',
    labour: [{ id: 'l1', userId: 'u1', userEmail: 'sam@shop.test', hours: 4, rate: 17, date: '2026-09-01', loggedAt: 1 }],
    parts: [{
      id: 'p1', category: 'GPU', name: 'RTX 4070 Windforce', cost: 503,
      condition: 'used', source: 'facebook',
      sourceUrl: 'https://facebook.com/marketplace/item/123',
      serial: 'GPU-SERIAL-2211', mfrWarrantyUntil: '2029-01-01',
      retailPrice: 900, retailSource: 'Newegg', retailCheckedAt: '2026-09-01',
      altStorePrice: 940, altStoreName: 'Canada Computers',
      pcpartpickerUrl: 'https://ca.pcpartpicker.com/product/abc',
    }],
    createdBy: 'u-old', createdByEmail: 'old@shop.test', createdAt: 1, updatedAt: 2,
  });

  const dup = (over: Partial<PcBuild> = {}) => duplicateBuild({
    source: { ...original(), ...over },
    id: 'b2', partId: i => `np${i}`,
    createdBy: 'u-new', createdByEmail: 'new@shop.test', now: 5000,
  });

  it('carries the recipe: name, kind, price, store, notes and every part', () => {
    const d = dup();
    expect(d.name).toBe('REAPER Gaming PC copy');
    expect(d.kind).toBe('shelf');
    expect(d.targetPrice).toBe(1800);
    expect(d.comparisonStore).toBe('Canada Computers');
    expect(d.notes).toBe('waiting on the GPU');
    expect(d.parts).toHaveLength(1);
    expect(d.parts[0]).toMatchObject({
      category: 'GPU', name: 'RTX 4070 Windforce', condition: 'used', source: 'facebook',
      retailPrice: 900, retailSource: 'Newegg', altStorePrice: 940,
      altStoreName: 'Canada Computers', pcpartpickerUrl: 'https://ca.pcpartpicker.com/product/abc',
    });
  });

  it('starts at planning with no labour — nobody has touched this machine', () => {
    const d = dup();
    expect(d.status).toBe('planning');
    expect(d.labour).toEqual([]);
  });

  it('NEVER copies a serial or a maker warranty — those identify the other machine', () => {
    // A copied serial would put one physical part in two builds, attach a
    // manufacturer's warranty to hardware that does not exist, and break the
    // warranty lookup. This is the copy that would cause real damage.
    const d = dup();
    expect(d.parts[0].serial).toBeUndefined();
    expect(d.parts[0].mfrWarrantyUntil).toBeUndefined();
    expect(d.parts[0].sourceUrl).toBeUndefined();
  });

  it('carries no commercial history at all', () => {
    const d = dup() as unknown as Record<string, unknown>;
    for (const field of [
      'customerId', 'customerName', 'customerPhone', 'inventoryId', 'sku',
      'saleId', 'finishedAt', 'shareToken', 'shareCreatedAt', 'shareCreatedBy',
    ]) {
      expect({ field, value: d[field] }).toEqual({ field, value: undefined });
    }
  });

  it('copies part COSTS but flags them as estimates from a copy', () => {
    const d = dup();
    expect(d.parts[0].cost).toBe(503);
    expect(d.parts[0].costFromCopy).toBe(true);
  });

  it('does not flag a part that had no cost to copy', () => {
    const d = dup({ parts: [{ id: 'p1', category: 'CPU', name: 'Ryzen 5', cost: 0, condition: 'new', source: 'retail' }] });
    expect(d.parts[0].costFromCopy).toBeUndefined();
  });

  it('gives every part a NEW id, and the build a new id and owner', () => {
    const d = dup();
    expect(d.id).toBe('b2');
    expect(d.parts[0].id).toBe('np0');
    expect(d.createdBy).toBe('u-new');
    expect(d.createdByEmail).toBe('new@shop.test');
    expect(d.createdAt).toBe(5000);
  });

  it('records where the recipe came from, for the audit trail', () => {
    // Not the source's own duplicatedFrom — this copy came from b1.
    expect(dup().duplicatedFrom).toBe('b1');
  });

  it('carries the quote rather than the target on a customer order', () => {
    const d = dup({ kind: 'customer' });
    expect(d.kind).toBe('customer');
    expect(d.quotePrice).toBe(1750);
    // …but not the customer it was for.
    expect(d.customerId).toBeUndefined();
  });

  it('leaves the original completely untouched', () => {
    const before = original();
    const source = original();
    duplicateBuild({ source, id: 'b2', partId: i => `np${i}`, createdBy: 'u', createdByEmail: 'e', now: 1 });
    expect(source).toEqual(before);
  });
});

/* ---------------- Changing the price after a deposit ---------------- */

describe('priceChangeWarning', () => {
  const shelf = { kind: 'shelf' as const, targetPrice: 1800 };
  const order = { kind: 'customer' as const, quotePrice: 1500 };

  it('says nothing about a shelf build — that price is the shop talking to itself', () => {
    expect(priceChangeWarning(shelf, 1900, 500)).toBeNull();
  });

  it('says nothing when no deposit has been taken', () => {
    expect(priceChangeWarning(order, 1600, 0)).toBeNull();
  });

  it('warns when a quote changes after a deposit, with both balances', () => {
    const w = priceChangeWarning(order, 1600, 375)!;
    expect(w).toMatchObject({ from: 1500, to: 1600, deposit: 375, balanceBefore: 1125, balanceAfter: 1225 });
    expect(w.message).toContain('$375.00 deposit');
    expect(w.message).toContain('$1125.00');
    expect(w.message).toContain('$1225.00');
  });

  it('says plainly that the deposit itself is not touched', () => {
    expect(priceChangeWarning(order, 1600, 375)!.message).toMatch(/deposit itself is not touched/i);
  });

  it('says nothing when the quote has not actually changed', () => {
    expect(priceChangeWarning(order, 1500, 375)).toBeNull();
  });

  it('handles a first quote set after a deposit', () => {
    const w = priceChangeWarning({ kind: 'customer' }, 1200, 200)!;
    expect(w.from).toBeNull();
    expect(w.balanceAfter).toBe(1000);
  });

  it('never reports a negative balance', () => {
    // A quote dropped below what has been paid means a refund conversation,
    // not a negative number on a screen.
    expect(priceChangeWarning(order, 100, 375)!.balanceAfter).toBe(0);
  });
});

describe('depositOnBuild', () => {
  const sale = (inventoryId: string, over: Record<string, unknown> = {}) => ({
    totalPaid: 1500, deposit: 375, balanceOwing: 1125, balancePayments: [],
    lines: [{ inventoryId }], ...over,
  }) as never;

  it('is zero for a build with no device yet — nothing can have been paid', () => {
    expect(depositOnBuild({}, [sale('inv-1')])).toBe(0);
  });

  it('reads what a layaway has collected on this build’s device', () => {
    expect(depositOnBuild({ inventoryId: 'inv-1' }, [sale('inv-1')])).toBe(375);
  });

  it('counts balance payments taken since, not just the original deposit', () => {
    const s = sale('inv-1', { balancePayments: [{ amount: 200 }, { amount: 125 }] });
    expect(depositOnBuild({ inventoryId: 'inv-1' }, [s])).toBe(700);
  });

  it('ignores sales for other devices', () => {
    expect(depositOnBuild({ inventoryId: 'inv-1' }, [sale('inv-2')])).toBe(0);
  });

  it('counts a fully-paid sale at its total, not at its frozen deposit', () => {
    const paid = sale('inv-1', { balanceOwing: 0, totalPaid: 1500 });
    expect(depositOnBuild({ inventoryId: 'inv-1' }, [paid])).toBe(1500);
  });
});
