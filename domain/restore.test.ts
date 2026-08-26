import { describe, it, expect } from 'vitest';
import { normalizeRestore, isRestorableBackup, backupExportedAtMs, backupSummary, mergeById, mergeSkuCounters } from './restore';

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

describe('backupExportedAtMs', () => {
  it('reads the full-export envelope timestamp', () => {
    const ms = backupExportedAtMs({ exportedAt: '2026-07-05T12:00:00.000Z', data: {} });
    expect(ms).toBe(Date.parse('2026-07-05T12:00:00.000Z'));
  });

  it('is undefined for the simple backup shape (no timestamp field)', () => {
    expect(backupExportedAtMs({ inventory: [] })).toBeUndefined();
  });

  it('is undefined for a malformed/garbage exportedAt rather than NaN', () => {
    expect(backupExportedAtMs({ exportedAt: 'not a date' })).toBeUndefined();
    expect(backupExportedAtMs({ exportedAt: 12345 })).toBeUndefined();
    expect(backupExportedAtMs(null)).toBeUndefined();
    expect(backupExportedAtMs(undefined)).toBeUndefined();
  });
});

describe('backupSummary', () => {
  it('counts every populated collection and omits empty ones', () => {
    const d = normalizeRestore({
      inventory: [{ id: 'a' }, { id: 'b' }],
      customers: [{ id: 'c' }],
      salesTransactions: [],
    });
    const s = backupSummary(d);
    expect(s.inventory).toBe(2);
    expect(s.customers).toBe(1);
    expect(s).not.toHaveProperty('salesTransactions');
    expect(s).not.toHaveProperty('repairs');
  });

  it('is an empty object for a backup with nothing in it', () => {
    expect(backupSummary(normalizeRestore({}))).toEqual({});
  });
});

describe('mergeById', () => {
  it('keeps every current record not present in incoming', () => {
    const current = [{ id: 'a', v: 1 }, { id: 'b', v: 1 }];
    const incoming = [{ id: 'a', v: 2 }];
    const merged = mergeById(current, incoming);
    expect(merged.find(x => x.id === 'a')).toEqual({ id: 'a', v: 2 });
    expect(merged.find(x => x.id === 'b')).toEqual({ id: 'b', v: 1 });
  });

  it('adds records from incoming that current does not have', () => {
    const merged = mergeById([{ id: 'a' }], [{ id: 'a' }, { id: 'z' }]);
    expect(merged.map(x => x.id).sort()).toEqual(['a', 'z']);
  });

  it('never drops a current record — this is the whole point of merge over replace', () => {
    const current = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}` }));
    const merged = mergeById(current, []); // an empty/older backup
    expect(merged).toHaveLength(5);
  });

  it('is a no-op on two empty arrays', () => {
    expect(mergeById([], [])).toEqual([]);
  });
});

describe('mergeSkuCounters', () => {
  it('takes the larger counter per prefix, never rolling one back', () => {
    expect(mergeSkuCounters({ PHN: 10, TAB: 2 }, { PHN: 5, TAB: 7, LAP: 1 }))
      .toEqual({ PHN: 10, TAB: 7, LAP: 1 });
  });

  it('tolerates missing sides', () => {
    expect(mergeSkuCounters(undefined, { PHN: 3 })).toEqual({ PHN: 3 });
    expect(mergeSkuCounters({ PHN: 3 }, undefined)).toEqual({ PHN: 3 });
    expect(mergeSkuCounters(undefined, undefined)).toEqual({});
  });
});
