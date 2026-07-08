import { describe, it, expect } from 'vitest';
import {
  balanceOwing, batchTotals, batchDevicesComplete, addDays, computeWarrantyUntil,
  matchesRepair, matchesBatch, isInProgress, isRepairOpen,
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
