import { describe, it, expect } from 'vitest';
import { Repair, RepairBatch, RepairStatus } from '../types';
import {
  splitBatchDevices, defaultBatchView, splitBatches, isActiveBatch,
  isPermanentBatch, searchHitsOtherView, otherViewHitLabel,
} from './batchView';
import { isRepairOpen } from './repairs';

const device = (id: string, status: RepairStatus, p: Partial<Repair> = {}): Repair => ({
  id, repairNumber: `RPR-${id}`, batchId: 'b1', type: 'wholesale', createdAt: Number(id.replace(/\D/g, '')) || 1,
  date: '2026-08-01', issue: 'screen', repairPrice: 0, status, ...p,
});

const batch = (p: Partial<RepairBatch> = {}): RepairBatch => ({
  id: 'b1', batchNumber: 'WB-0001', createdAt: 1, dateReceived: '2026-08-01',
  companyName: 'Acme', status: 'active', amountPaid: 0, ...p,
});

describe('a batch\'s devices split by whether the work is over', () => {
  const devices = [
    device('1', 'in_repair', { model: 'iPhone 13' }),
    device('2', 'completed', { model: 'Pixel 7' }),
    device('3', 'picked_up', { model: 'Galaxy S22' }),
    device('4', 'cancelled', { model: 'OnePlus 12' }),
    device('5', 'ready_pickup', { model: 'iPad Air' }),
    device('6', 'in_repair', { batchId: 'other', model: 'Not ours' }),
  ];

  it('moves a completed device to Completed and leaves an in-progress one alone', () => {
    const s = splitBatchDevices(devices, 'b1');
    expect(s.inProgress.map(d => d.id)).toEqual(['1', '5']);
    expect(s.completed.map(d => d.id)).toEqual(['2', '3', '4']);
  });

  it('uses the SAME terminal definition as the Tickets tab, not a second one', () => {
    const s = splitBatchDevices(devices, 'b1');
    expect(s.inProgress.every(isRepairOpen)).toBe(true);
    expect(s.completed.every(d => !isRepairOpen(d))).toBe(true);
  });

  it('counts both halves for the tab labels, and ignores other batches', () => {
    const s = splitBatchDevices(devices, 'b1');
    expect(s.totalInProgress).toBe(2);
    expect(s.totalCompleted).toBe(3);
    expect([...s.inProgress, ...s.completed].some(d => d.id === '6')).toBe(false);
  });

  it('keeps the batch\'s own oldest-first order, so device numbering never jumps', () => {
    const shuffled = [device('5', 'in_repair'), device('1', 'in_repair'), device('3', 'in_repair')];
    expect(splitBatchDevices(shuffled, 'b1').inProgress.map(d => d.id)).toEqual(['1', '3', '5']);
  });

  it('SEARCH REACHES COMPLETED DEVICES — they are moved, not hidden', () => {
    const s = splitBatchDevices(devices, 'b1', 'Pixel');
    expect(s.completed.map(d => d.id)).toEqual(['2']);
    expect(s.inProgress).toEqual([]);
    // ...and the tab counts stay the batch's real totals, not the search's.
    expect(s.totalCompleted).toBe(3);
  });

  it('says how many matches are on the side that is not open', () => {
    const s = splitBatchDevices(devices, 'b1', 'Pixel');
    expect(searchHitsOtherView(s, 'inprogress', 'Pixel')).toBe(1);
    expect(otherViewHitLabel(1, 'inprogress')).toBe('1 more match in Completed.');
    expect(otherViewHitLabel(2, 'completed')).toBe('2 more matches in In progress.');
    expect(otherViewHitLabel(0, 'inprogress')).toBeNull();
    // With no search there is nothing to point at.
    expect(searchHitsOtherView(s, 'inprogress', '')).toBe(0);
  });

  it('opens on In progress — including for a private batch that is active forever', () => {
    expect(defaultBatchView(batch())).toBe('inprogress');
    expect(defaultBatchView(batch({ private: true, status: 'active' }))).toBe('inprogress');
    // ...and for a batch saved under the legacy autoInventory flag.
    expect(defaultBatchView(batch({ autoInventory: true }))).toBe('inprogress');
  });
});

describe('the batches list splits Active from Completed', () => {
  const active = batch({ id: 'a', status: 'active' });
  const done = batch({ id: 'd', status: 'completed' });
  const cancelled = batch({ id: 'c', status: 'cancelled' as RepairBatch['status'] });
  const personal = batch({ id: 'p', status: 'active', private: true, companyName: 'FTT Personal' });

  it('finished batches leave the Active list', () => {
    const s = splitBatches([active, done, cancelled, personal]);
    expect(s.active.map(b => b.id)).toEqual(['a', 'p']);
    expect(s.completed.map(b => b.id)).toEqual(['d', 'c']);
  });

  it('a PRIVATE batch that is still active stays in Active', () => {
    expect(isActiveBatch(personal)).toBe(true);
    expect(isPermanentBatch(personal)).toBe(true);
    expect(splitBatches([personal]).active).toHaveLength(1);
  });

  it('a private batch that was completed is treated like any other completed one', () => {
    const closed = batch({ id: 'pc', status: 'completed', private: true });
    expect(isPermanentBatch(closed)).toBe(false);
    expect(splitBatches([closed]).completed.map(b => b.id)).toEqual(['pc']);
  });
});
