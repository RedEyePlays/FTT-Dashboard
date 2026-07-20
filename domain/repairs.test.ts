import { describe, it, expect } from 'vitest';
import {
  balanceOwing, batchTotals, batchDevicesComplete, addDays, computeWarrantyUntil,
  matchesRepair, matchesBatch, isInProgress, isRepairOpen,
  applyTechEdit, repairAgeDays, TECH_STATUSES,
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
