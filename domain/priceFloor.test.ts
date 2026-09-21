import { describe, it, expect } from 'vitest';
import { InventoryItem } from '../types';
import {
  recordedCost, floorFor, isBelowFloor, checkLineFloor, targetBelowFloor,
  buildFloorApprovalAudit, BELOW_FLOOR_MESSAGE, NO_COST_NOTE, TARGET_BELOW_FLOOR_NOTE,
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

describe('blocking a sale below the floor', () => {
  const floor = floorFor(device(), { minMarginPercent: 10 }); // 264

  it('blocks under the floor', () => {
    expect(isBelowFloor(263, floor)).toBe(true);
    expect(checkLineFloor(263, floor).ok).toBe(false);
    expect(checkLineFloor(263, floor).needsApproval).toBe(true);
  });

  it('lets a sale AT the floor through', () => {
    expect(isBelowFloor(264, floor)).toBe(false);
    expect(checkLineFloor(264, floor).ok).toBe(true);
  });

  it('lets anything through when there is no floor', () => {
    const none = floorFor(device({ purchaseCost: 0, repairCost: 0 }), { minMarginPercent: 10 });
    expect(checkLineFloor(1, none).ok).toBe(true);
  });

  it('an APPROVAL unblocks it — the approval IS the answer', () => {
    expect(checkLineFloor(100, floor, true)).toEqual({ ok: true, needsApproval: false, message: '' });
  });
});

describe('the block message tells staff nothing they should not know', () => {
  const floor = floorFor(device(), { minMarginPercent: 10 }); // cost 240, floor 264
  const msg = checkLineFloor(100, floor).message;

  it('is the plain sentence', () => {
    expect(msg).toBe(BELOW_FLOOR_MESSAGE);
    expect(msg).toBe('Below the minimum price for this device. A manager or owner needs to approve it.');
  });

  it('CARRIES NO FIGURE — not the floor, not the cost, not the gap', () => {
    // Each of those is the cost back-computable in one subtraction.
    for (const leak of ['240', '264', '164', '$']) expect(msg).not.toContain(leak);
    expect(msg).not.toMatch(/\d/);
  });

  it('never uses the words cost or margin', () => {
    expect(msg).not.toMatch(/cost|margin|profit/i);
  });

  it('reads the same for everyone, so it reveals nothing about the reader', () => {
    expect(checkLineFloor(100, floorFor(device({ minSalePrice: 999 }), {})).message).toBe(msg);
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

describe('the approval is audited', () => {
  it('records seller, approver, device and price — plus the floor and cost', () => {
    // The floor and cost DO belong here: the audit log is owner-visible only,
    // and without them the record cannot answer "how far below was it?".
    const a = buildFloorApprovalAudit({
      sellerUid: 'u1', sellerEmail: 'sara@shop.test',
      approverUid: 'u2', approverEmail: 'owner@shop.test',
      inventoryId: 'd1', deviceLabel: 'iPhone 12', salePrice: 200,
      floorPrice: 264, costAtApproval: 240, at: 5,
    });
    expect(a).toMatchObject({
      seller: 'sara@shop.test', approver: 'owner@shop.test',
      device: 'iPhone 12', salePrice: 200, floorPrice: 264, costAtApproval: 240,
      shortfall: 64,
    });
  });

  it('copes with an approval on a device that had no floor', () => {
    const a = buildFloorApprovalAudit({
      sellerUid: 'u1', sellerEmail: 'a@x', approverUid: 'u2', approverEmail: 'b@x',
      deviceLabel: 'X', salePrice: 10, floorPrice: null, costAtApproval: null, at: 5,
    });
    expect(a.shortfall).toBeNull();
  });
});
