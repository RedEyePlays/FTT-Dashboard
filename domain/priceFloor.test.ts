import { describe, it, expect } from 'vitest';
import { InventoryItem } from '../types';
import {
  recordedCost, floorFor, isBelowFloor, floorGap, targetBelowFloor,
  buildBelowFloorSaleAudit, BELOW_FLOOR_WARNING, NO_COST_NOTE, TARGET_BELOW_FLOOR_NOTE,
  belowFloorGapLabel, belowFloorStamp, belowFloorSales, belowFloorCountForDate,
  belowFloorCountLabel, trimBelowFloorRows,
} from './priceFloor';

// Staff can't see cost, so nothing stopped them selling a device below what
// the shop paid for it. The floor blocks that — without telling them what the
// floor, the cost, or the gap is.

const device = (over: Partial<InventoryItem> = {}): InventoryItem =>
  ({ id: 'd1', date: '', item: 'iPhone 12', imei: '', boughtFrom: '',
     purchaseCost: 200, repairCost: 40, soldDate: '', soldTo: '', salePrice: 0,
     notes: '', ...over } as InventoryItem);

describe('the cost a floor is derived from', () => {
  it('is purchase plus repair', () => {
    expect(recordedCost(device())).toBe(240);
  });

  it('is NULL when nothing has been recorded — not zero', () => {
    // Every row is created with both defaulted to 0. Treating that as "this
    // device was free" would give it a floor of $0 and make the check
    // meaningless on exactly the devices this feature exists for.
    expect(recordedCost(device({ purchaseCost: 0, repairCost: 0 }))).toBeNull();
  });

  it('counts a device with only a repair cost recorded', () => {
    expect(recordedCost(device({ purchaseCost: 0, repairCost: 40 }))).toBe(40);
  });
});

describe('floor maths', () => {
  it('percent', () => {
    expect(floorFor(device(), { minMarginPercent: 10 }).price).toBe(264);
  });

  it('dollars', () => {
    expect(floorFor(device(), { minMarginDollars: 25 }).price).toBe(265);
  });

  it('BOTH set takes the HIGHER, because each guards a different worry', () => {
    // A percentage protects a proportion on an expensive phone; a flat amount
    // protects the handling on a cheap one. Taking the lower would defeat
    // whichever one mattered.
    expect(floorFor(device(), { minMarginPercent: 10, minMarginDollars: 25 }).price).toBe(265);
    expect(floorFor(device({ purchaseCost: 1000, repairCost: 0 }), { minMarginPercent: 10, minMarginDollars: 25 }).price).toBe(1100);
  });

  it('a per-device override beats both outright', () => {
    // It exists for the phone that needs its own answer, so a computed floor
    // must not quietly raise it.
    expect(floorFor(device({ minSalePrice: 250 }), { minMarginPercent: 50 }))
      .toMatchObject({ price: 250, fromOverride: true });
  });

  it('NO RECORDED COST MEANS NO FLOOR, and says why', () => {
    const f = floorFor(device({ purchaseCost: 0, repairCost: 0 }), { minMarginPercent: 10 });
    expect(f.price).toBeNull();
    expect(f.reason).toBe('no_cost');
  });

  it('no configured margin means no floor either — current behaviour, unchanged', () => {
    const f = floorFor(device(), {});
    expect(f.price).toBeNull();
    expect(f.reason).toBe('not_configured');
  });

  it('a zero or negative setting is not a floor', () => {
    expect(floorFor(device(), { minMarginPercent: 0, minMarginDollars: 0 }).price).toBeNull();
  });

  it('an override still applies on a device with no recorded cost', () => {
    expect(floorFor(device({ purchaseCost: 0, repairCost: 0, minSalePrice: 99 }).valueOf() as InventoryItem, {}).price).toBe(99);
  });
});

describe('a below-floor sale WARNS but completes', () => {
  const floor = floorFor(device(), { minMarginPercent: 10 }); // cost 240, floor 264

  it('flags a price under the floor', () => {
    expect(isBelowFloor(263, floor)).toBe(true);
  });

  it('does not flag a sale AT the floor', () => {
    expect(isBelowFloor(264, floor)).toBe(false);
  });

  it('does not flag anything when there is no floor', () => {
    const none = floorFor(device({ purchaseCost: 0, repairCost: 0 }), { minMarginPercent: 10 });
    expect(isBelowFloor(1, none)).toBe(false);
  });

  it('reports the gap for somebody who may see cost', () => {
    expect(floorGap(200, floor)).toBe(64);
    expect(floorGap(300, floor)).toBeNull();
  });

  it('stamps the line with the floor and cost AS THEY WERE', () => {
    // Both depend on settings and on the device's recorded cost, and both can
    // change later — a figure recomputed next week would restate history.
    expect(belowFloorStamp(200, floor)).toEqual({ belowFloor: true, floorAtSale: 264, costAtSale: 240 });
  });

  it('stamps nothing at or above the floor', () => {
    expect(belowFloorStamp(264, floor)).toBeNull();
  });
});

describe('the warning tells staff nothing they should not know', () => {
  it('is the plain sentence, with no approval demanded', () => {
    expect(BELOW_FLOOR_WARNING).toBe('Below the minimum price for this device.');
    expect(BELOW_FLOOR_WARNING).not.toMatch(/approv|manager|owner|pin/i);
  });

  it('CARRIES NO FIGURE — not the floor, not the cost, not the gap', () => {
    expect(BELOW_FLOOR_WARNING).not.toMatch(/\d/);
    expect(BELOW_FLOOR_WARNING).not.toMatch(/cost|margin|profit/i);
  });

  it('the gap is a SEPARATE owner-facing label, never folded into it', () => {
    // The gap plus the price IS the floor, and the floor plus the margin
    // setting IS the cost.
    expect(belowFloorGapLabel(64)).toBe('$64.00 under minimum');
    expect(belowFloorGapLabel(null)).toBeNull();
    expect(belowFloorGapLabel(0)).toBeNull();
  });
});

describe('owner-facing notes', () => {
  it('a device with no cost says so, because that is the gap to close', () => {
    expect(NO_COST_NOTE).toBe('No cost recorded — no minimum price check.');
  });

  it('a target under the floor is a pricing mistake, caught when saving', () => {
    // Not something to discover at the till with a customer waiting.
    expect(targetBelowFloor(device({ targetSalePrice: 250 }), { minMarginPercent: 10 })).toBe(true);
    expect(targetBelowFloor(device({ targetSalePrice: 300 }), { minMarginPercent: 10 })).toBe(false);
    expect(TARGET_BELOW_FLOOR_NOTE).toBe('Target is under the minimum price.');
  });

  it('no target set is not a mistake', () => {
    expect(targetBelowFloor(device({ targetSalePrice: 0 }), { minMarginPercent: 10 })).toBe(false);
  });

  it('no floor means a target cannot be under it', () => {
    expect(targetBelowFloor(device({ targetSalePrice: 1 }), {})).toBe(false);
  });
});

describe('the sale is audited', () => {
  it('records seller, device and price — plus the floor and cost', () => {
    // The floor and cost DO belong here: the audit log is owner-visible only,
    // and without them the record cannot answer "how far below was it?".
    // There is no approver — the sale completed on its own.
    const a = buildBelowFloorSaleAudit({
      sellerUid: 'u1', sellerEmail: 'sara@shop.test',
      inventoryId: 'd1', deviceLabel: 'iPhone 12', salePrice: 200,
      transactionId: 't1', floorPrice: 264, costAtSale: 240, at: 5,
    });
    expect(a).toMatchObject({
      seller: 'sara@shop.test', device: 'iPhone 12', salePrice: 200,
      floorPrice: 264, costAtSale: 240, shortfall: 64, transactionId: 't1',
    });
    expect(a).not.toHaveProperty('approver');
  });

  it('copes with a sale on a device that had no floor stamped', () => {
    const a = buildBelowFloorSaleAudit({
      sellerUid: 'u1', sellerEmail: 'a@x', deviceLabel: 'X', salePrice: 10,
      transactionId: 't2', floorPrice: null, costAtSale: null, at: 5,
    });
    expect(a.shortfall).toBeNull();
  });
});

/* ---------------- The review list ---------------- */

const sale = (over: Record<string, unknown> = {}) => ({
  id: 't1', date: '2026-09-20', createdAt: 100, soldByEmail: 'sara@shop.test',
  lines: [
    { name: 'iPhone 12', unitPrice: 200, belowFloor: true, floorAtSale: 264, costAtSale: 240 },
    { name: 'Case', unitPrice: 20 },
  ],
  ...over,
});

describe('where the owner reviews below-minimum sales', () => {
  it('lists the discounted line, with who rang it', () => {
    const [row] = belowFloorSales([sale()]);
    expect(row).toMatchObject({
      device: 'iPhone 12', seller: 'sara@shop.test', salePrice: 200,
      floorAtSale: 264, costAtSale: 240, gap: 64, date: '2026-09-20',
    });
  });

  it('leaves lines that were at or above the minimum out of it', () => {
    expect(belowFloorSales([sale()]).map(r => r.device)).toEqual(['iPhone 12']);
  });

  it('reads the STAMP rather than recomputing', () => {
    // The floor depends on settings and on the device's cost, both of which
    // can change after the sale. Recomputing would restate history.
    const [row] = belowFloorSales([sale({ lines: [{ name: 'X', unitPrice: 5, belowFloor: true, floorAtSale: 99 }] })]);
    expect(row.floorAtSale).toBe(99);
    expect(row.gap).toBe(94);
  });

  it('excludes voided and returned sales — the device came back', () => {
    expect(belowFloorSales([sale({ status: 'voided' })])).toEqual([]);
    expect(belowFloorSales([sale({ status: 'returned' })])).toEqual([]);
  });

  it('filters to a date range', () => {
    const rows = belowFloorSales([sale(), sale({ id: 't2', date: '2026-08-01' })], { start: '2026-09-01', end: '2026-09-30' });
    expect(rows.map(r => r.transactionId)).toEqual(['t1']);
  });

  it('counts a single day, for the Day History and Close Out headers', () => {
    expect(belowFloorCountForDate([sale()], '2026-09-20')).toBe(1);
    expect(belowFloorCountForDate([sale()], '2026-09-19')).toBe(0);
    expect(belowFloorCountLabel(2)).toBe('2 sales below minimum');
    expect(belowFloorCountLabel(1)).toBe('1 sale below minimum');
    expect(belowFloorCountLabel(0)).toBeNull();
  });

  it('a sale with no seller recorded still lists — never guessed at', () => {
    const [row] = belowFloorSales([sale({ soldByEmail: undefined })]);
    expect(row.seller).toBeUndefined();
    expect(row.device).toBe('iPhone 12');
  });
});

describe('A MANAGER SEES WHO IS DISCOUNTING, NOT WHAT THE SHOP PAYS', () => {
  const rows = belowFloorSales([sale()]);

  it('the owner sees the floor, the cost and the gap', () => {
    const [r] = trimBelowFloorRows(rows, true);
    expect(r).toMatchObject({ floorAtSale: 264, costAtSale: 240, gap: 64 });
  });

  it('a manager sees the date, the seller, the device and the price', () => {
    const [r] = trimBelowFloorRows(rows, false);
    expect(r).toMatchObject({ date: '2026-09-20', seller: 'sara@shop.test', device: 'iPhone 12', salePrice: 200 });
  });

  it('but the cost fields are REMOVED, not merely hidden', () => {
    // Removed from the object, so an export cannot leak what the screen
    // withholds.
    const [r] = trimBelowFloorRows(rows, false);
    expect('floorAtSale' in r).toBe(false);
    expect('costAtSale' in r).toBe(false);
    expect('gap' in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain('264');
    expect(JSON.stringify(r)).not.toContain('240');
  });
});
