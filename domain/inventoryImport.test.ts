import { describe, it, expect } from 'vitest';
import { InventoryItem } from '../types';
import {
  CONFLICT_MESSAGE, IMPORT_PROTECTED_FIELDS, ImportRow, applyImportRow, describeImportPlan,
  importRowChanges, matchImportRow, newImportedItem, planImport,
} from './inventoryImport';

/**
 * IMPORTING AN EDITED EXPORT USED TO DUPLICATE EVERYTHING.
 *
 * `importCSV` built every row as a brand new record and never looked for an
 * existing item, so the obvious move in the wholesale workflow — export, mark
 * up in Excel, import back — doubled the inventory, two records per SKU and
 * per IMEI, with nothing said to anybody.
 */

const dev = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'FTT-000101', date: '2026-01-01', item: 'iPhone 14',
  imei: '490154203237518', boughtFrom: 'OfferUp', purchaseCost: 300, repairCost: 20,
  soldDate: '', soldTo: '', salePrice: 0, notes: 'internal note', deviceType: 'Phone',
  condition: 'Good', storage: '128GB', targetSalePrice: 500, deviceStatus: 'ready', ...p,
});

const INV: InventoryItem[] = [
  dev({ id: 'a', sku: 'FTT-000101', imei: '490154203237518', item: 'iPhone 14' }),
  dev({ id: 'b', sku: 'FTT-000102', imei: '356789012340002', item: 'Pixel 9' }),
  dev({ id: 'c', sku: 'FTT-000103', imei: '', item: 'No IMEI device' }),
];

const row = (r: ImportRow): ImportRow => r;

/* ======================================================================== *
 * MATCHING
 * ======================================================================== */

describe('an imported row finds the item it is', () => {
  it('matches on SKU and UPDATES — it does not add a second copy', () => {
    const o = matchImportRow(row({ sku: 'FTT-000101', condition: 'Fair' }), INV);
    expect(o.kind).toBe('update');
    expect(o.kind === 'update' && o.existing.id).toBe('a');
  });

  it('matches a SKU however the spreadsheet spelled it', () => {
    // Reusing domain/identifierSearch.ts's forgiving comparison, not a third copy.
    for (const sku of ['FTT-000101', 'ftt-000101', 'FTT 000101', 'ftt000101']) {
      const o = matchImportRow(row({ sku }), INV);
      expect(o.kind, sku).toBe('update');
    }
  });

  it('matches on IMEI/serial when the row has no SKU', () => {
    const o = matchImportRow(row({ imei: '35 678901 234000 2' }), INV);
    expect(o.kind).toBe('update');
    expect(o.kind === 'update' && o.existing.id).toBe('b');
  });

  it('a row with NEITHER identifier is a new item, as before', () => {
    expect(matchImportRow(row({ item: 'Brand new thing' }), INV).kind).toBe('create');
    expect(matchImportRow(row({ sku: '', imei: '' }), INV).kind).toBe('create');
  });

  it('a SKU that names nothing is a new item', () => {
    expect(matchImportRow(row({ sku: 'FTT-999999', item: 'New' }), INV).kind).toBe('create');
  });

  // THE ONE IT MUST NOT GUESS AT.
  it('a SKU that matches but an IMEI that does not is REPORTED, not merged', () => {
    const o = matchImportRow(row({ sku: 'FTT-000101', imei: '111111111111111' }), INV);
    expect(o.kind).toBe('conflict');
    expect(o.kind === 'conflict' && o.reason).toBe('sku-imei-mismatch');
    expect(CONFLICT_MESSAGE['sku-imei-mismatch']).toMatch(/IMEI/);
  });

  it('…but a row with no IMEI, or an item with none recorded, is not a conflict', () => {
    // Silence is not disagreement.
    expect(matchImportRow(row({ sku: 'FTT-000101' }), INV).kind).toBe('update');
    expect(matchImportRow(row({ sku: 'FTT-000103', imei: '999999999999999' }), INV).kind).toBe('update');
  });

  it('more than one match is a conflict rather than a coin toss', () => {
    const dupes = [dev({ id: 'x', sku: 'FTT-DUP' }), dev({ id: 'y', sku: 'FTT-DUP' })];
    const o = matchImportRow(row({ sku: 'FTT-DUP' }), dupes);
    expect(o.kind).toBe('conflict');
    expect(o.kind === 'conflict' && o.reason).toBe('ambiguous-match');
  });
});

/* ======================================================================== *
 * WHAT AN UPDATE IS ALLOWED TO WRITE
 * ======================================================================== */

describe('an update writes only what the file actually carries', () => {
  const existing = dev({ purchaseCost: 300, notes: 'internal', condition: 'Good', targetSalePrice: 500 });

  it('A COLUMN NOT IN THE FILE IS NOT A CHANGE', () => {
    // The buyer-safe export carries no cost columns. Writing every known
    // field from such a file would blank the purchase cost of everything in
    // it — data loss of a different shape from the one being fixed.
    const next = applyImportRow(existing, row({ sku: 'FTT-000101', condition: 'Fair' }));
    expect(next.condition).toBe('Fair');
    expect(next.purchaseCost).toBe(300);     // untouched
    expect(next.notes).toBe('internal');     // untouched
    expect(next.targetSalePrice).toBe(500);  // untouched
  });

  it('a column that IS present and empty is a deliberate clearing', () => {
    const next = applyImportRow(existing, row({ sku: 'FTT-000101', notes: '' }));
    expect(next.notes).toBe('');
  });

  it('numbers come back as numbers, not strings', () => {
    const next = applyImportRow(existing, row({ sku: 'FTT-000101', purchaseCost: '275.50', repairCost: '' }));
    expect(next.purchaseCost).toBe(275.5);
    expect(next.repairCost).toBe(0);
  });

  it('NEVER writes identity, or a sale', () => {
    // applyDirectSale in App.tsx stamps a device SOLD the moment salePrice is
    // set, so an import able to write it could sell stock from a spreadsheet.
    const next = applyImportRow(existing, row({
      sku: 'FTT-999999', id: 'hacked', kind: 'accessory', imeiNormalized: 'X',
      soldDate: '2026-05-05', soldTo: 'Someone', salePrice: '999',
    }));
    expect(next.id).toBe(existing.id);
    expect(next.kind).toBe('device');
    expect(next.sku).toBe(existing.sku);
    expect(next.soldDate).toBe('');
    expect(next.soldTo).toBe('');
    expect(next.salePrice).toBe(0);
    expect(next.imeiNormalized).toBe(existing.imeiNormalized);
  });

  it('the protected list is the one the code enforces', () => {
    for (const f of IMPORT_PROTECTED_FIELDS) {
      const next = applyImportRow(existing, row({ [f]: 'TAMPERED' })) as unknown as Record<string, unknown>;
      expect(String(next[f] ?? ''), f).not.toBe('TAMPERED');
    }
  });

  it('reports which fields a row would actually change', () => {
    expect(importRowChanges(existing, row({ sku: 'FTT-000101', condition: 'Fair' }))).toEqual(['condition']);
    expect(importRowChanges(existing, row({ sku: 'FTT-000101', condition: 'Good' }))).toEqual([]);
    expect(importRowChanges(existing, row({ sku: 'FTT-000101', salePrice: '999' }))).toEqual([]);
  });
});

/* ======================================================================== *
 * THE PLAN AND ITS COUNTS
 * ======================================================================== */

describe('the preview counts match what will be written', () => {
  const rows = [
    row({ sku: 'FTT-000101', condition: 'Fair' }),                       // update
    row({ sku: 'FTT-000102', condition: 'Good' }),                       // update
    row({ sku: 'FTT-000900', item: 'New phone' }),                       // create
    row({ sku: 'FTT-000101', imei: '111111111111111' }),                 // conflict
  ];

  it('counts updates, creates and conflicts', () => {
    const p = planImport(rows, INV);
    expect(p).toMatchObject({ updates: 2, creates: 1, conflicts: 1 });
    expect(p.outcomes).toHaveLength(4);
  });

  it('the counts are the outcomes, so the dialog cannot say one thing and do another', () => {
    const p = planImport(rows, INV);
    expect(p.updates).toBe(p.outcomes.filter(o => o.kind === 'update').length);
    expect(p.creates).toBe(p.outcomes.filter(o => o.kind === 'create').length);
    expect(p.conflicts).toBe(p.outcomes.filter(o => o.kind === 'conflict').length);
  });

  it('describes itself in one line, naming the skip', () => {
    expect(describeImportPlan(planImport(rows, INV))).toBe('2 to update · 1 new · 1 conflict (skipped)');
    expect(describeImportPlan(planImport([rows[0]], INV))).toBe('1 to update · 0 new');
  });

  it('a whole file of already-known rows creates NOTHING — the duplication bug', () => {
    // Export, change nothing, import back: every row matches.
    const roundTrip = INV.map(i => row({ sku: i.sku!, imei: i.imei, item: i.item }));
    const p = planImport(roundTrip, INV);
    expect(p.creates).toBe(0);
    expect(p.conflicts).toBe(0);
    expect(p.updates).toBe(INV.length);
  });
});

describe('a genuinely new row still becomes a new item', () => {
  it('builds the same shape the importer always built', () => {
    const made = newImportedItem(
      row({ item: 'Galaxy S24', deviceType: 'Phone', purchaseCost: '400', targetSalePrice: '650' }),
      'device', 'new-id', 'FTT-000999', '2026-11-22',
    );
    expect(made).toMatchObject({
      id: 'new-id', kind: 'device', sku: 'FTT-000999', item: 'Galaxy S24',
      purchaseCost: 400, targetSalePrice: 650, deviceStatus: 'ready', condition: 'Good',
    });
  });

  it('an accessory row builds accessory fields', () => {
    const made = newImportedItem(
      row({ item: 'Case', quantity: '5', costPerUnit: '3', sellingPrice: '15' }),
      'accessory', 'new-id', 'ACC-1', '2026-11-22',
    );
    expect(made).toMatchObject({ kind: 'accessory', quantity: 5, costPerUnit: 3, sellingPrice: 15, lowStockThreshold: 3 });
  });
});
