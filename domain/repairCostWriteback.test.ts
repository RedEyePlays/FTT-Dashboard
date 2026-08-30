import { describe, it, expect } from 'vitest';
import {
  repairCostWriteback, targetRepairCostContribution, applyRepairCostDelta, repairCostMovedToInventory,
} from './repairCostWriteback';
import { computeAnalytics, presetRange } from './analytics';
import { profitAndLoss } from './reports';
import { Repair, InventoryItem, RepairStatus } from '../types';

// The bug: a repair ticket that auto-creates an inventory record wrote
// `repairCost: 0` and nothing ever updated it. Parts were logged, the repair
// completed, and the device still claimed the refurb was free — so selling it
// overstated profit by the entire cost of the work.

const repair = (p: Partial<Repair> = {}): Repair => ({
  id: 'r1', repairNumber: 'RPR-000001', type: 'internal', createdAt: 0, date: '2026-03-10',
  issue: 'screen', repairPrice: 0, status: 'in_repair' as RepairStatus,
  inventoryId: 'inv-1',
  parts: [{ id: 'p1', name: 'Screen', unitCost: 60, quantity: 1 }],
  ...p,
});

const item = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'inv-1', kind: 'device', sku: 'FTT-1', date: '2026-03-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 200, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'pending_repair',
  ...p,
});

describe('targetRepairCostContribution — what a ticket SHOULD contribute', () => {
  it('is the parts COST once completed, not the price charged', () => {
    // repairPrice is deliberately 0 here (an internal refurb bills nothing) —
    // what reduces the device's eventual profit is what the parts cost.
    expect(targetRepairCostContribution(repair({ status: 'completed', repairPrice: 0 }))).toBe(60);
    // And a customer-facing price never inflates it.
    expect(targetRepairCostContribution(repair({ status: 'completed', repairPrice: 250 }))).toBe(60);
  });

  it('counts every part, by quantity', () => {
    expect(targetRepairCostContribution(repair({
      status: 'completed',
      parts: [{ id: 'p2', name: 'Screen', unitCost: 60, quantity: 1 }, { id: 'p3', name: 'Battery', unitCost: 15, quantity: 2 }],
    }))).toBe(90);
  });

  it('falls back to the legacy flat partsCost when there is no parts list', () => {
    expect(targetRepairCostContribution(repair({ status: 'completed', parts: undefined, partsCost: 45 }))).toBe(45);
  });

  it('is 0 while the ticket is still open — the parts list can still change', () => {
    for (const status of ['in_repair', 'waiting_parts', 'testing', 'ready_pickup'] as RepairStatus[]) {
      expect(targetRepairCostContribution(repair({ status }))).toBe(0);
    }
  });

  it('is 0 for a cancelled ticket — work that did not happen costs the device nothing', () => {
    expect(targetRepairCostContribution(repair({ status: 'cancelled' }))).toBe(0);
  });

  it('is 0 when no inventory item is linked — there is nothing to attribute it to', () => {
    expect(targetRepairCostContribution(repair({ status: 'completed', inventoryId: undefined }))).toBe(0);
  });

  it('treats picked_up as terminal, exactly like completed', () => {
    expect(targetRepairCostContribution(repair({ status: 'picked_up' }))).toBe(60);
  });
});

describe('repairCostWriteback — additive, reversible, idempotent', () => {
  it('COMPLETING a repair writes the full cost', () => {
    const wb = repairCostWriteback(repair({ status: 'completed' }));
    expect(wb.delta).toBe(60);
    expect(wb.applied).toBe(60);
    expect(wb.changed).toBe(true);
    expect(applyRepairCostDelta(item(), wb.delta)).toBe(60);
  });

  it('A SECOND repair ADDS to the running total rather than replacing it', () => {
    // The device already carries 60 from the first ticket.
    const deviceAfterFirst = item({ repairCost: 60 });
    const second = repair({
      id: 'r2', status: 'completed', parts: [{ id: 'p4', name: 'Battery', unitCost: 25, quantity: 1 }],
    });
    const wb = repairCostWriteback(second); // its own receipt starts empty
    expect(wb.delta).toBe(25);
    expect(applyRepairCostDelta(deviceAfterFirst, wb.delta)).toBe(85); // not 25
  });

  it('RE-SAVING a completed ticket changes nothing — the write is idempotent', () => {
    const already = repair({ status: 'completed', inventoryRepairCostApplied: 60 });
    const wb = repairCostWriteback(already);
    expect(wb.delta).toBe(0);
    expect(wb.changed).toBe(false);
    expect(applyRepairCostDelta(item({ repairCost: 60 }), wb.delta)).toBe(60);
  });

  it('EDITING PARTS after completion syncs the difference, not the whole amount', () => {
    const edited = repair({
      status: 'completed', inventoryRepairCostApplied: 60,
      parts: [{ id: 'p5', name: 'Screen', unitCost: 75, quantity: 1 }],
    });
    const wb = repairCostWriteback(edited);
    expect(wb.delta).toBe(15);        // 75 − 60, not 75
    expect(wb.applied).toBe(75);
    expect(applyRepairCostDelta(item({ repairCost: 60 }), wb.delta)).toBe(75);
  });

  it('a downward parts edit reverses part of the contribution', () => {
    const wb = repairCostWriteback(repair({
      status: 'completed', inventoryRepairCostApplied: 60,
      parts: [{ id: 'p6', name: 'Screen', unitCost: 40, quantity: 1 }],
    }));
    expect(wb.delta).toBe(-20);
    expect(applyRepairCostDelta(item({ repairCost: 60 }), wb.delta)).toBe(40);
  });

  it('CANCELLING a completed repair reverses exactly its own contribution', () => {
    const wb = repairCostWriteback(repair({ status: 'cancelled', inventoryRepairCostApplied: 60 }));
    expect(wb.delta).toBe(-60);
    expect(wb.applied).toBe(0);
    expect(applyRepairCostDelta(item({ repairCost: 60 }), wb.delta)).toBe(0);
  });

  it('cancelling ONE of two repairs leaves the other ticket\'s contribution intact', () => {
    // Device carries 85: 60 from ticket A, 25 from ticket B. Cancel A.
    const device = item({ repairCost: 85 });
    const wb = repairCostWriteback(repair({ status: 'cancelled', inventoryRepairCostApplied: 60 }));
    expect(applyRepairCostDelta(device, wb.delta)).toBe(25); // B's 25 survives
  });

  it('REOPENING a completed repair also reverses it — the work is no longer done', () => {
    const wb = repairCostWriteback(repair({ status: 'in_repair', inventoryRepairCostApplied: 60 }));
    expect(wb.delta).toBe(-60);
    expect(wb.applied).toBe(0);
  });

  it('never drives a device\'s repairCost negative', () => {
    // A legacy item whose repairCost was hand-entered isn't the sum of any
    // receipts, so a reversal must clamp rather than go below zero.
    expect(applyRepairCostDelta(item({ repairCost: 10 }), -60)).toBe(0);
  });

  it('a pre-existing ticket with no receipt contributes nothing until completed', () => {
    // The undefined-receipt state every historical ticket is in — safe to
    // deploy with no migration.
    const untouched = repair({ status: 'in_repair', inventoryRepairCostApplied: undefined });
    expect(repairCostWriteback(untouched).changed).toBe(false);
  });
});

describe('repairCostMovedToInventory — the double-counting guard', () => {
  it('is true only once a cost has actually been applied', () => {
    expect(repairCostMovedToInventory({ inventoryRepairCostApplied: 60 })).toBe(true);
    expect(repairCostMovedToInventory({ inventoryRepairCostApplied: 0 })).toBe(false);
    expect(repairCostMovedToInventory({ inventoryRepairCostApplied: undefined })).toBe(false);
  });

  it('reads as NOT applied again after a reversal', () => {
    const cancelled = repair({ status: 'cancelled', inventoryRepairCostApplied: 60 });
    const wb = repairCostWriteback(cancelled);
    expect(repairCostMovedToInventory({ inventoryRepairCostApplied: wb.applied })).toBe(false);
  });
});

// --- End to end: the cost lands in exactly ONE place -------------------------

const DATE = '2026-03-10';
const range = () => presetRange('custom', new Date(`${DATE}T12:00:00`).getTime(), { start: DATE, end: DATE });
const base = { salesTransactions: [], repairs: [], inventory: [], customers: [], auditLogs: [], activity: [] };

describe('the repair cost is counted exactly once across the reports', () => {
  // The device, refurbished (60 of parts written back) and then sold for 400.
  const soldDevice = item({ purchaseCost: 200, repairCost: 60, soldDate: DATE, salePrice: 400, deviceStatus: 'sold' });
  const doneTicket = repair({ status: 'completed', date: DATE, createdAt: new Date(`${DATE}T09:00:00`).getTime(), inventoryRepairCostApplied: 60 });

  it('selling the device yields profit REDUCED by the repair cost', () => {
    const a = computeAnalytics(range(), { ...base, inventory: [soldDevice], repairs: [doneTicket] }, Date.now());
    // 400 − 200 purchase − 60 repair = 140. Before the fix repairCost was 0
    // and this reported 200 — the whole refurb booked as profit.
    expect(a.grossProfit).toBe(140);
    expect(a.revenue).toBe(400);
  });

  it('the parts are NOT also charged as a repair-side cost', () => {
    const a = computeAnalytics(range(), { ...base, inventory: [soldDevice], repairs: [doneTicket] }, Date.now());
    // The ticket's cost now lives on the device; counting it here too would
    // charge the shop for the same 60 twice.
    expect(a.repairPartsCost).toBe(0);
    const repairsCat = a.categories.find(c => c.name === 'Repairs');
    expect(repairsCat?.profit ?? 0).toBe(0);
  });

  it('a ticket whose cost was NOT written back is still tallied on the repair side', () => {
    // The ordinary customer repair path is untouched by this change.
    const customerTicket = repair({
      id: 'r9', type: 'retail', status: 'completed', date: DATE,
      createdAt: new Date(`${DATE}T09:00:00`).getTime(),
      repairPrice: 150, inventoryId: undefined, inventoryRepairCostApplied: undefined,
    });
    const a = computeAnalytics(range(), { ...base, repairs: [customerTicket] }, Date.now());
    expect(a.repairPartsCost).toBe(60);
    expect(a.repairRevenue).toBe(150);
  });

  it('the P&L charges the repair cost once, through cost of goods', () => {
    const p = profitAndLoss({
      transactions: [], inventory: [soldDevice], payPeriods: [], cashReconciliations: [],
      settlements: [], expenses: [], expenseCategories: [],
    }, DATE, DATE);
    expect(p.revenue).toBe(400);
    expect(p.costOfGoods).toBe(260);   // 200 purchase + 60 repair
    expect(p.grossProfit).toBe(140);
  });

  it('analytics and the P&L agree on the refurbished device\'s profit', () => {
    const a = computeAnalytics(range(), { ...base, inventory: [soldDevice], repairs: [doneTicket] }, Date.now());
    const p = profitAndLoss({
      transactions: [], inventory: [soldDevice], payPeriods: [], cashReconciliations: [],
      settlements: [], expenses: [], expenseCategories: [],
    }, DATE, DATE);
    expect(a.grossProfit).toBe(p.grossProfit);
  });
});
