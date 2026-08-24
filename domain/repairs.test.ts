import { describe, it, expect } from 'vitest';
import {
  balanceOwing, batchTotals, batchDevicesComplete, addDays, computeWarrantyUntil,
  matchesRepair, matchesBatch, isInProgress, isRepairOpen,
  applyTechEdit, repairAgeDays, TECH_STATUSES,
  repairNeedsCustomer, isInternalRepair, canSaveRepair, linkedRepairFor,
  partsTotal, repairPartsCost, repairLabor, repairCheckoutSummary, completeRepair,
  repairSalePrefill, completeRepairSale, technicianPerformance, partName,
} from './repairs';
import { Repair, RepairBatch } from '../types';

const repair = (p: Partial<Repair>): Repair => ({
  id: 'r', repairNumber: 'RPR-000001', type: 'retail', createdAt: 0, date: '2026-07-01',
  issue: 'x', repairPrice: 0, status: 'received', ...p,
});
const batch = (p: Partial<RepairBatch>): RepairBatch => ({
  id: 'b', batchNumber: 'WB-000001', createdAt: 0, dateReceived: '2026-07-01',
  companyName: 'Acme', status: 'active', amountPaid: 0, ...p,
});

describe('balanceOwing', () => {
  it('subtracts deposit and never goes negative', () => {
    expect(balanceOwing(repair({ repairPrice: 100, deposit: 30 }))).toBe(70);
    expect(balanceOwing(repair({ repairPrice: 100, deposit: 150 }))).toBe(0);
    expect(balanceOwing(repair({ repairPrice: 100 }))).toBe(100);
  });
});

describe('batchTotals', () => {
  const reps = [
    repair({ id: '1', batchId: 'b', repairPrice: 50 }),
    repair({ id: '2', batchId: 'b', repairPrice: 80 }),
    repair({ id: '3', batchId: 'b', repairPrice: 999, status: 'cancelled' }), // excluded
    repair({ id: '4', batchId: 'other', repairPrice: 40 }),                    // other batch
  ];
  it('sums non-cancelled devices in the batch and computes remaining', () => {
    const t = batchTotals(batch({ amountPaid: 30 }), reps);
    expect(t.count).toBe(2);
    expect(t.totalCost).toBe(130);
    expect(t.amountPaid).toBe(30);
    expect(t.remaining).toBe(100);
  });
});

describe('batchDevicesComplete', () => {
  it('true only when every non-cancelled device is completed', () => {
    const b = batch({});
    expect(batchDevicesComplete(b, [repair({ batchId: 'b', status: 'completed' })])).toBe(true);
    expect(batchDevicesComplete(b, [repair({ batchId: 'b', status: 'completed' }), repair({ id: '2', batchId: 'b', status: 'in_repair' })])).toBe(false);
    expect(batchDevicesComplete(b, [])).toBe(false); // no devices
    // cancelled devices are ignored
    expect(batchDevicesComplete(b, [repair({ batchId: 'b', status: 'completed' }), repair({ id: '2', batchId: 'b', status: 'cancelled' })])).toBe(true);
  });
});

describe('warranty', () => {
  it('addDays advances a date', () => {
    expect(addDays('2026-07-01', 30)).toBe('2026-07-31');
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });
  it('computeWarrantyUntil needs both a date and positive days', () => {
    expect(computeWarrantyUntil('2026-07-01', 90)).toBe('2026-09-29');
    expect(computeWarrantyUntil('2026-07-01', 0)).toBe('');
    expect(computeWarrantyUntil('', 90)).toBe('');
    expect(computeWarrantyUntil('2026-07-01')).toBe('');
  });
});

describe('status helpers', () => {
  it('open excludes terminal states', () => {
    expect(isRepairOpen(repair({ status: 'in_repair' }))).toBe(true);
    expect(isRepairOpen(repair({ status: 'completed' }))).toBe(false);
    expect(isRepairOpen(repair({ status: 'cancelled' }))).toBe(false);
  });
  it('in-progress grouping', () => {
    expect(isInProgress(repair({ status: 'diagnosing' }))).toBe(true);
    expect(isInProgress(repair({ status: 'waiting_parts' }))).toBe(false);
  });
});

describe('global search', () => {
  const r = repair({ repairNumber: 'RPR-000042', customerName: 'John Doe', customerPhone: '555-1234', imei: '356789012340001', model: 'iPhone 14 Pro', brand: 'Apple', issue: 'cracked screen' });
  it('matches repair by number, customer, phone, imei, model, brand, issue', () => {
    expect(matchesRepair(r, 'RPR-000042')).toBe(true);
    expect(matchesRepair(r, 'john')).toBe(true);
    expect(matchesRepair(r, '555')).toBe(true);
    expect(matchesRepair(r, '356789')).toBe(true);
    expect(matchesRepair(r, 'iphone 14')).toBe(true);
    expect(matchesRepair(r, 'apple')).toBe(true);
    expect(matchesRepair(r, 'cracked')).toBe(true);
    expect(matchesRepair(r, r.id)).toBe(true); // QR / repair ID
    expect(matchesRepair(r, 'nokia')).toBe(false);
    expect(matchesRepair(r, '')).toBe(false);
  });
  it('matches batch by number, company, contact, phone, email', () => {
    const b = batch({ batchNumber: 'WB-000007', companyName: 'FixIt Shop', contactPerson: 'Mia', phone: '555-9999', email: 'mia@fixit.com' });
    expect(matchesBatch(b, 'WB-000007')).toBe(true);
    expect(matchesBatch(b, 'fixit')).toBe(true);
    expect(matchesBatch(b, 'mia')).toBe(true);
    expect(matchesBatch(b, '555-9999')).toBe(true);
    expect(matchesBatch(b, 'mia@fixit')).toBe(true);
    expect(matchesBatch(b, 'nope')).toBe(false);
  });
});

describe('repair type semantics (internal / customer requirement)', () => {
  it('only retail involves a customer', () => {
    expect(repairNeedsCustomer('retail')).toBe(true);
    expect(repairNeedsCustomer('wholesale')).toBe(false);
    expect(repairNeedsCustomer('internal')).toBe(false);
  });

  it('isInternalRepair flags internal tickets', () => {
    expect(isInternalRepair(repair({ type: 'internal' }))).toBe(true);
    expect(isInternalRepair(repair({ type: 'retail' }))).toBe(false);
  });

  it('canSaveRepair requires a customer name only for retail', () => {
    // Retail: needs a non-blank customer name.
    expect(canSaveRepair(repair({ type: 'retail', customerName: '' }))).toBe(false);
    expect(canSaveRepair(repair({ type: 'retail', customerName: '   ' }))).toBe(false);
    expect(canSaveRepair(repair({ type: 'retail', customerName: 'Jane' }))).toBe(true);
    // Internal & wholesale: saveable with no customer at all.
    expect(canSaveRepair(repair({ type: 'internal' }))).toBe(true);
    expect(canSaveRepair(repair({ type: 'internal', customerName: '' }))).toBe(true);
    expect(canSaveRepair(repair({ type: 'wholesale' }))).toBe(true);
  });

  it('canSaveRepair requires every part line to be named', () => {
    const part = (name: string) => ({ id: 'p1', name, unitCost: 10, quantity: 1 });
    expect(canSaveRepair(repair({ type: 'internal', parts: [part('OLED screen')] }))).toBe(true);
    expect(canSaveRepair(repair({ type: 'internal', parts: [part('')] }))).toBe(false);
    expect(canSaveRepair(repair({ type: 'internal', parts: [part('  ')] }))).toBe(false);
    expect(canSaveRepair(repair({ type: 'internal', parts: [part('Battery'), part('')] }))).toBe(false);
    // No parts at all is fine — parts are optional, only named-when-present.
    expect(canSaveRepair(repair({ type: 'internal', parts: [] }))).toBe(true);
    expect(canSaveRepair(repair({ type: 'internal' }))).toBe(true);
  });
});

describe('partName', () => {
  it('returns the trimmed name when set', () => {
    expect(partName({ name: 'OLED screen' })).toBe('OLED screen');
    expect(partName({ name: '  Battery  ' })).toBe('Battery');
  });

  it('falls back to "Unspecified" for blank/legacy part rows, without mutating them', () => {
    expect(partName({ name: '' })).toBe('Unspecified');
    expect(partName({ name: '   ' })).toBe('Unspecified');
  });
});

describe('linkedRepairFor', () => {
  it('finds the repair linked to an inventory item, most recent first', () => {
    const repairs = [
      repair({ id: 'a', type: 'internal', inventoryId: 'dev1', createdAt: 100 }),
      repair({ id: 'b', type: 'internal', inventoryId: 'dev1', createdAt: 300 }),
      repair({ id: 'c', type: 'retail', inventoryId: 'dev2', createdAt: 200 }),
      repair({ id: 'd', type: 'retail', createdAt: 400 }), // no link
    ];
    expect(linkedRepairFor('dev1', repairs)?.id).toBe('b'); // newest for dev1
    expect(linkedRepairFor('dev2', repairs)?.id).toBe('c');
    expect(linkedRepairFor('nope', repairs)).toBeUndefined();
  });

  it('returns undefined when nothing is linked', () => {
    expect(linkedRepairFor('x', [])).toBeUndefined();
  });
});

describe('applyTechEdit', () => {
  const stored = repair({
    id: 'r1', repairPrice: 200, deposit: 50, customerName: 'Jane', model: 'iPhone 14',
    status: 'received',
  });

  it('overlays only whitelisted technician fields', () => {
    const next = applyTechEdit(stored, {
      status: 'in_repair', techNotes: 'opened device', diagnostics: 'bad battery',
      workPerformed: 'replaced battery', partsUsed: 'OEM battery', testingResults: 'passed',
      testChecks: ['Power', 'Charging'],
    });
    expect(next.status).toBe('in_repair');
    expect(next.techNotes).toBe('opened device');
    expect(next.diagnostics).toBe('bad battery');
    expect(next.workPerformed).toBe('replaced battery');
    expect(next.partsUsed).toBe('OEM battery');
    expect(next.testingResults).toBe('passed');
    expect(next.testChecks).toEqual(['Power', 'Charging']);
  });

  it('ignores attempts to change price, customer, or device', () => {
    const next = applyTechEdit(stored, {
      repairPrice: 5, deposit: 0, customerName: 'Hacker', model: 'cheap', status: 'testing',
    } as any);
    expect(next.repairPrice).toBe(200);
    expect(next.deposit).toBe(50);
    expect(next.customerName).toBe('Jane');
    expect(next.model).toBe('iPhone 14');
    expect(next.status).toBe('testing'); // allowed field still applied
  });

  it('rejects a status outside the technician-allowed set', () => {
    const next = applyTechEdit(stored, { status: 'completed' as any });
    expect(next.status).toBe('received'); // unchanged
    expect(TECH_STATUSES).not.toContain('completed');
  });
});

describe('repairAgeDays', () => {
  it('counts whole days since createdAt', () => {
    const now = new Date('2026-07-10T00:00:00').getTime();
    expect(repairAgeDays(repair({ createdAt: new Date('2026-07-01T00:00:00').getTime() }), now)).toBe(9);
    expect(repairAgeDays(repair({ createdAt: now }), now)).toBe(0);
  });
});

describe('terminal statuses', () => {
  it('picked_up and completed are closed; testing is open', () => {
    expect(isRepairOpen(repair({ status: 'picked_up' }))).toBe(false);
    expect(isRepairOpen(repair({ status: 'completed' }))).toBe(false);
    expect(isRepairOpen(repair({ status: 'testing' }))).toBe(true);
    expect(isInProgress(repair({ status: 'testing' }))).toBe(true);
  });
});

describe('parts breakdown + repair cost', () => {
  const part = (name: string, unitCost: number, quantity = 1) => ({ id: name, name, unitCost, quantity });

  it('partsTotal sums unitCost × quantity, clamping negatives', () => {
    expect(partsTotal([part('Screen', 80), part('Battery', 20, 2)])).toBe(120);
    expect(partsTotal([part('x', -5, 3), part('y', 10, -1)])).toBe(0);
    expect(partsTotal()).toBe(0);
  });

  it('repairPartsCost prefers the structured parts, falls back to legacy partsCost', () => {
    expect(repairPartsCost(repair({ parts: [part('Screen', 80)], partsCost: 999 }))).toBe(80); // array wins
    expect(repairPartsCost(repair({ partsCost: 45 }))).toBe(45);                                // legacy fallback
    expect(repairPartsCost(repair({}))).toBe(0);
  });

  it('repairLabor is price minus parts cost, never negative', () => {
    expect(repairLabor(repair({ repairPrice: 200, parts: [part('Screen', 80)] }))).toBe(120);
    expect(repairLabor(repair({ repairPrice: 50, partsCost: 90 }))).toBe(0);
  });

  it('repairCheckoutSummary reports parts / labor / price / deposit / balance', () => {
    const s = repairCheckoutSummary(repair({ repairPrice: 200, deposit: 50, parts: [part('Screen', 80), part('Adhesive', 5, 2)] }));
    expect(s).toEqual({ partsCost: 90, labor: 110, repairPrice: 200, deposit: 50, balanceDue: 150 });
  });
});

describe('completeRepair', () => {
  const NOW = new Date('2026-07-20T12:00:00Z').getTime();
  it('stamps status, completedAt, warranty, and denormalizes parts cost', () => {
    const done = completeRepair(repair({ repairPrice: 200, warrantyDays: 30, parts: [{ id: 'p', name: 'Screen', unitCost: 80, quantity: 1 }] }), NOW);
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBe(NOW);
    expect(done.partsCost).toBe(80);                 // denormalized from the parts array
    expect(done.warrantyUntil).toBe('2026-08-19');   // 2026-07-20 + 30d
  });
  it('supports a picked_up terminal and no-warranty case', () => {
    const done = completeRepair(repair({ repairPrice: 100 }), NOW, 'picked_up');
    expect(done.status).toBe('picked_up');
    expect(done.warrantyUntil).toBe('');
  });
});

describe('repairSalePrefill', () => {
  it('builds a single service line at full price (cost = parts) + customer', () => {
    const p = repairSalePrefill(repair({
      brand: 'Apple', model: 'iPhone 14', issue: 'Screen', repairPrice: 180, deposit: 50,
      parts: [{ id: 'p', name: 'OLED', unitCost: 40, quantity: 1 }],
      customerName: 'Sam', customerPhone: '555', customerId: 'c1',
    }));
    expect(p.repairPrice).toBe(180);
    expect(p.partsCost).toBe(40);          // labor/margin = 140 recognized on sale
    expect(p.deposit).toBe(50);
    expect(p.terminal).toBe('picked_up');  // retail
    expect(p.lineName).toContain('iPhone 14');
    expect(p.lineName).toContain('Screen');
    expect(p.customer).toEqual({ id: 'c1', name: 'Sam', phone: '555', email: undefined });
  });
  it('uses a completed terminal and omits customer for non-retail', () => {
    const p = repairSalePrefill(repair({ type: 'internal', repairPrice: 60, customerName: undefined }));
    expect(p.terminal).toBe('completed');
    expect(p.customer).toBeUndefined();
  });
});

describe('completeRepairSale', () => {
  it('stamps the repair complete and links it to the sale', () => {
    const NOW = new Date('2026-07-20T12:00:00Z').getTime();
    const done = completeRepairSale(repair({ repairPrice: 120, warrantyDays: 90 }), 'tx-123', NOW, 'picked_up');
    expect(done.status).toBe('picked_up');
    expect(done.completedAt).toBe(NOW);
    expect(done.salesTransactionId).toBe('tx-123');
    expect(done.warrantyUntil).toBe('2026-10-18'); // 2026-07-20 + 90d
  });
});

describe('technicianPerformance()', () => {
  it('aggregates completed repairs and average turnaround per technician within range', () => {
    const day = 24 * 60 * 60 * 1000;
    const start = 1_000_000;
    const end = start + 30 * day;
    const rows = technicianPerformance([
      // Ann: two completed, turnarounds 2d and 4d -> avg 3d
      repair({ id: '1', completedBy: 'ann', createdAt: start, completedAt: start + 2 * day, status: 'completed' }),
      repair({ id: '2', completedBy: 'ann', createdAt: start, completedAt: start + 4 * day, status: 'completed' }),
      // Bob: one completed, turnaround 1d
      repair({ id: '3', completedBy: 'bob', createdAt: start, completedAt: start + 1 * day, status: 'completed' }),
      // cancelled — ignored
      repair({ id: '4', completedBy: 'ann', createdAt: start, completedAt: start + 1 * day, status: 'cancelled' }),
      // no completedAt — ignored
      repair({ id: '5', completedBy: 'bob', createdAt: start, status: 'received' }),
      // out of range — ignored
      repair({ id: '6', completedBy: 'ann', createdAt: start, completedAt: end + day, status: 'completed' }),
    ], start, end);
    expect(rows).toHaveLength(2);
    // Sorted by completed desc: Ann (2) first
    expect(rows[0]).toEqual({ userId: 'ann', completed: 2, avgTurnaroundMs: 3 * day });
    expect(rows[1]).toEqual({ userId: 'bob', completed: 1, avgTurnaroundMs: 1 * day });
  });

  it('buckets repairs with no completedBy under an empty user id', () => {
    const rows = technicianPerformance([
      repair({ id: '1', createdAt: 500, completedAt: 600, status: 'completed' }),
    ], 0, 1000);
    expect(rows).toEqual([{ userId: '', completed: 1, avgTurnaroundMs: 100 }]);
  });
});
