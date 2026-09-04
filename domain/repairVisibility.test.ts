import { describe, it, expect } from 'vitest';
import { InventoryItem, Repair, RepairBatch } from '../types';
import {
  isSoldDevice, inRepairTicketFor, showsAsInRepair, soldWithOpenTicket,
  markTicketDeviceSold, isRepairFinished, isInternalRefurb, showsCustomerPayment,
} from './repairVisibility';
import { restoredDeviceStatus, flagDeviceForRepair } from './repairs';
import { applyDirectSale } from './inventory';
import { repairCostWriteback } from './repairCostWriteback';

// Three bugs, one display layer:
//
//  1. A device flagged in-repair that SOLD kept its orange "in repair" SKU and
//     kept being counted as on the bench. It has left the shop.
//  2. Completed/picked-up/cancelled tickets never left the active list.
//  3. A ticket on the shop's OWN stock showed deposit / balance owing — money
//     the shop would be owing itself — and could print a customer receipt with
//     a balance due on it.

const device = (over: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'dev1', sku: 'PHN-000001', item: 'iPhone 13', kind: 'device',
  deviceStatus: 'pending_repair', date: '2026-01-01',
} as InventoryItem & typeof over);

const ticket = (over: Partial<Repair> = {}): Repair => ({
  id: 'r1', repairNumber: 'RPR-000042', type: 'retail', createdAt: 1,
  date: '2026-01-01', issue: 'screen', repairPrice: 0, status: 'in_repair',
  inventoryId: 'dev1', ...over,
} as Repair);

describe('1. a sold device never displays as in repair', () => {
  const open = [ticket()];

  it('an unsold flagged device still shows as in repair', () => {
    expect(showsAsInRepair(device(), open)).toBe(true);
    expect(inRepairTicketFor(device(), open)?.repairNumber).toBe('RPR-000042');
  });

  it('the reported bug: it sells, the ticket is still open, it stops showing as in repair', () => {
    const sold = { ...device(), deviceStatus: 'sold' as const, soldDate: '2026-02-01' };
    expect(showsAsInRepair(sold, open)).toBe(false);
    expect(inRepairTicketFor(sold, open)).toBeUndefined();
  });

  it('sold via a DIRECT inventory sale (Actual sale price on the row) — same', () => {
    // applyDirectSale is what the Inventory form and the inline cell edit run.
    const sold = applyDirectSale({ ...device(), salePrice: 500 });
    expect(sold.deviceStatus).toBe('sold');
    expect(showsAsInRepair(sold, open)).toBe(false);
  });

  it('sold via QUICK SALE — the checkout writes deviceStatus sold + soldDate', () => {
    const sold = { ...device(), deviceStatus: 'sold' as const, soldDate: '2026-02-01', salePrice: 500 };
    expect(showsAsInRepair(sold, open)).toBe(false);
  });

  it('a half-written row — soldDate present, status stale — still reads as sold', () => {
    expect(isSoldDevice({ deviceStatus: 'pending_repair', soldDate: '2026-02-01' })).toBe(true);
    expect(showsAsInRepair({ ...device(), soldDate: '2026-02-01' }, open)).toBe(false);
  });

  it('a LAYAWAY hold is not a sale — a reserved device is still on the bench', () => {
    // Nothing has left the shop yet, so the repair is still real work in hand.
    expect(showsAsInRepair({ ...device(), deviceStatus: 'reserved' }, open)).toBe(true);
  });

  it('a FINISHED ticket never showed as in repair anyway, sold or not', () => {
    const done = [ticket({ status: 'completed' })];
    expect(showsAsInRepair(device(), done)).toBe(false);
  });

  it('the sale does not close the ticket — it stamps it, so the work is not lost', () => {
    const stamp = markTicketDeviceSold(ticket(), 1234);
    expect(stamp).toEqual({ deviceSoldAt: 1234 });
    // Only the stamp: the status is untouched, so nobody's unfinished work is
    // silently marked done.
    expect(Object.keys(stamp!)).toEqual(['deviceSoldAt']);
  });

  it('stamping is idempotent, and never touches a finished ticket', () => {
    expect(markTicketDeviceSold(ticket({ deviceSoldAt: 999 }), 1234)).toBeNull();
    expect(markTicketDeviceSold(ticket({ status: 'completed' }), 1234)).toBeNull();
    expect(markTicketDeviceSold(ticket({ status: 'cancelled' }), 1234)).toBeNull();
  });

  it('surfaces exactly the orphaned tickets — open, linked, and the device is gone', () => {
    const inv = [
      { id: 'dev1', deviceStatus: 'sold' as const, soldDate: '2026-02-01' },
      { id: 'dev2', deviceStatus: 'pending_repair' as const, soldDate: undefined },
    ];
    const repairs = [
      ticket({ id: 'r1', inventoryId: 'dev1' }),                        // sold + open → yes
      ticket({ id: 'r2', inventoryId: 'dev1', status: 'completed' }),   // finished → no
      ticket({ id: 'r3', inventoryId: 'dev2' }),                        // still here → no
      ticket({ id: 'r4', inventoryId: undefined }),                     // walk-in → no
    ];
    expect(soldWithOpenTicket(repairs, inv).map(r => r.id)).toEqual(['r1']);
  });

  it('a sold device is never dragged back to a pre-repair status when its ticket closes', () => {
    // restoredDeviceStatus runs when a ticket reaches a terminal status. On a
    // device that has since SOLD it must not resurrect 'ready'.
    const sold = { ...device(), deviceStatus: 'sold' as const, soldDate: '2026-02-01', previousStatus: 'ready' as const };
    expect(restoredDeviceStatus(sold, ticket({ status: 'completed' }), [])).toBeNull();
    expect(restoredDeviceStatus(sold, ticket({ status: 'cancelled' }), [])).toBeNull();
    // And a new ticket can't re-flag a sold device either.
    expect(flagDeviceForRepair(sold)).toBeNull();
  });
});

describe('2. finished tickets leave the active list', () => {
  it('completed, picked up and cancelled are all finished', () => {
    expect(isRepairFinished(ticket({ status: 'completed' }))).toBe(true);
    expect(isRepairFinished(ticket({ status: 'picked_up' }))).toBe(true);
    expect(isRepairFinished(ticket({ status: 'cancelled' }))).toBe(true);
  });

  it('everything still on the bench is not', () => {
    (['received', 'diagnosing', 'waiting_approval', 'waiting_parts', 'in_repair', 'testing', 'ready_pickup'] as const)
      .forEach(status => expect(isRepairFinished(ticket({ status }))).toBe(false));
  });

  it('picked_up counts as finished — collected work is done work', () => {
    // The old Active filter only excluded completed/cancelled, so every
    // collected ticket sat in the active list forever.
    expect(isRepairFinished(ticket({ status: 'picked_up' }))).toBe(true);
  });

  it('the Active and Completed buckets partition the list — nothing falls between', () => {
    const all = (['received', 'diagnosing', 'waiting_approval', 'waiting_parts', 'in_repair', 'testing',
      'ready_pickup', 'completed', 'picked_up', 'cancelled'] as const).map(status => ticket({ status }));
    const finished = all.filter(isRepairFinished);
    const active = all.filter(r => !isRepairFinished(r));
    expect(finished.length + active.length).toBe(all.length);
    expect(finished).toHaveLength(3);
  });
});

describe('3. an internal refurb hides customer-payment fields', () => {
  const batch = (over: Partial<RepairBatch> = {}): RepairBatch => ({
    id: 'b1', batchNumber: 'WB-0001', createdAt: 1, dateReceived: '2026-01-01',
    companyName: 'Acme Phones', status: 'active', amountPaid: 0, ...over,
  });
  const batchDevice = ticket({ type: 'wholesale', batchId: 'b1' });

  it('a device under a PRIVATE batch is an internal refurb', () => {
    expect(isInternalRefurb(batchDevice, batch({ private: true }))).toBe(true);
    expect(showsCustomerPayment(batchDevice, batch({ private: true }))).toBe(false);
  });

  it('the legacy autoInventory flag counts as private too (no migration was run)', () => {
    expect(showsCustomerPayment(batchDevice, batch({ autoInventory: true }))).toBe(false);
  });

  it('a real wholesale customer still gets the payment fields', () => {
    expect(showsCustomerPayment(batchDevice, batch())).toBe(true);
  });

  it('a standalone internal ticket is a refurb; a retail ticket is not', () => {
    expect(showsCustomerPayment(ticket({ type: 'internal' }), undefined)).toBe(false);
    expect(showsCustomerPayment(ticket({ type: 'retail' }), undefined)).toBe(true);
  });

  it('HIDES, does not delete — a historical ticket renders whatever it recorded', () => {
    // The batch is later un-flagged (or the ticket re-typed): the stored
    // deposit/price are untouched and simply become visible again.
    const t = ticket({ type: 'wholesale', batchId: 'b1', repairPrice: 120, deposit: 40 });
    expect(showsCustomerPayment(t, batch({ private: true }))).toBe(false);
    expect(showsCustomerPayment(t, batch({ private: false }))).toBe(true);
    expect(t.repairPrice).toBe(120);
    expect(t.deposit).toBe(40);
  });

  it("hiding the price does NOT affect the cost written back to the device", () => {
    // The whole point: parts/labour cost is the real number on a refurb, and
    // it must still reach the linked inventory item's repairCost. The
    // write-back reads repairPartsCost, never repairPrice — so a refurb with
    // no customer price still contributes its full cost.
    const refurb = ticket({
      type: 'wholesale', batchId: 'b1', status: 'completed', inventoryId: 'dev1',
      repairPrice: 0, // hidden on an internal refurb, and irrelevant here
      parts: [{ id: 'p1', name: 'Screen', unitCost: 60, quantity: 1 },
              { id: 'p2', name: 'Battery', unitCost: 25, quantity: 2 }],
    });
    expect(showsCustomerPayment(refurb, batch({ private: true }))).toBe(false);
    const wb = repairCostWriteback(refurb);
    expect(wb.changed).toBe(true);
    expect(wb.delta).toBe(110);   // 60 + 25×2 — the real cost
    expect(wb.applied).toBe(110);
  });
});
