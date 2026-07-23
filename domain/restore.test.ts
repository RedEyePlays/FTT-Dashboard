import { describe, it, expect } from 'vitest';
import { normalizeRestore, isRestorableBackup } from './restore';

describe('normalizeRestore', () => {
  it('reads a simple top-level backup (inventory/notes/tasks)', () => {
    const d = normalizeRestore({
      inventory: [{ id: 'a' }],
      notes: [{ id: 'n' }],
      tasks: [{ id: 't' }],
    });
    expect(d.inventory).toHaveLength(1);
    expect(d.notes).toHaveLength(1);
    expect(d.tasks).toHaveLength(1);
  });

  it('preserves runners/dropOffs/settlements/customers/sales from a simple backup', () => {
    const d = normalizeRestore({
      inventory: [],
      runners: [{ id: 'r' }],
      dropOffs: [{ id: 'd' }],
      settlements: [{ id: 's' }],
      customers: [{ id: 'c' }],
      salesTransactions: [{ id: 'tx' }],
    });
    expect(d.runners).toHaveLength(1);
    expect(d.dropOffs).toHaveLength(1);
    expect(d.settlements).toHaveLength(1);
    expect(d.customers).toHaveLength(1);
    expect(d.salesTransactions).toHaveLength(1);
  });

  it('unwraps the full-export envelope and merges devices + accessories', () => {
    const d = normalizeRestore({
      exportedAt: '2026-07-05',
      workspaceId: 'ws1',
      data: {
        inventory: [{ id: 'dev1', kind: 'device' }],
        accessories: [{ id: 'acc1', kind: 'accessory' }],
        salesTransactions: [{ id: 'tx1' }],
        customers: [{ id: 'c1' }],
        meta: [{ notes: [{ id: 'n1' }], tasks: [{ id: 't1' }], skuCounters: { PHN: 3 } }],
      },
    });
    expect(d.inventory).toHaveLength(2);
    expect(d.inventory.map(i => i.id)).toEqual(['dev1', 'acc1']);
    expect(d.salesTransactions).toHaveLength(1);
    expect(d.customers).toHaveLength(1);
    expect(d.notes).toHaveLength(1);
    expect(d.tasks).toHaveLength(1);
    expect(d.skuCounters).toEqual({ PHN: 3 });
  });

  it('round-trips repairs and repairBatches from a full export', () => {
    const d = normalizeRestore({
      exportedAt: '2026-07-05',
      workspaceId: 'ws1',
      data: {
        inventory: [],
        repairs: [{ id: 'rp1', repairNumber: 'RPR-0001' }, { id: 'rp2', batchId: 'b1' }],
        repairBatches: [{ id: 'b1', batchNumber: 'BAT-0001' }],
      },
    });
    expect(d.repairs).toHaveLength(2);
    expect(d.repairs?.map(r => r.id)).toEqual(['rp1', 'rp2']);
    expect(d.repairBatches).toHaveLength(1);
    expect(d.repairBatches?.[0].id).toBe('b1');
  });

  it('reads repairs/repairBatches from a simple top-level backup too', () => {
    const d = normalizeRestore({
      inventory: [],
      repairs: [{ id: 'rp1' }],
      repairBatches: [{ id: 'b1' }],
    });
    expect(d.repairs).toHaveLength(1);
    expect(d.repairBatches).toHaveLength(1);
  });

  it('defaults repairs/repairBatches to empty arrays when absent', () => {
    const d = normalizeRestore({ inventory: [{ id: 'a' }] });
    expect(d.repairs).toEqual([]);
    expect(d.repairBatches).toEqual([]);
  });

  it('tolerates malformed input without throwing', () => {
    expect(normalizeRestore(null).inventory).toEqual([]);
    expect(normalizeRestore(undefined).notes).toEqual([]);
    expect(normalizeRestore({ inventory: 'nope' }).inventory).toEqual([]);
  });
});

describe('isRestorableBackup', () => {
  it('accepts anything with at least one populated collection', () => {
    expect(isRestorableBackup({ inventory: [{ id: 'a' }] })).toBe(true);
    expect(isRestorableBackup({ notes: [{ id: 'n' }] })).toBe(true);
    expect(isRestorableBackup({ data: { salesTransactions: [{ id: 'tx' }] } })).toBe(true);
    expect(isRestorableBackup({ data: { repairs: [{ id: 'rp' }] } })).toBe(true);
    expect(isRestorableBackup({ repairBatches: [{ id: 'b' }] })).toBe(true);
  });

  it('rejects empty or junk files', () => {
    expect(isRestorableBackup({})).toBe(false);
    expect(isRestorableBackup(null)).toBe(false);
    expect(isRestorableBackup({ foo: 'bar' })).toBe(false);
  });
});
