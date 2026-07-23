import { describe, it, expect } from 'vitest';
import { skuPrefix, formatSku, nextSku, allocateSkuInTxn, CounterTxn } from './sku';
import { InventoryItem } from '../types';

const item = (sku: string): InventoryItem =>
  ({ id: sku, sku, item: 'x', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, date: '', notes: '' });

describe('skuPrefix', () => {
  it('returns the neutral FTT prefix for every kind and device type', () => {
    expect(skuPrefix('device', 'Phone')).toBe('FTT');
    expect(skuPrefix('device', 'Laptop')).toBe('FTT');
    expect(skuPrefix('device', 'Tablet')).toBe('FTT');
    expect(skuPrefix('accessory')).toBe('FTT');
    expect(skuPrefix('device')).toBe('FTT');
  });
});

describe('formatSku', () => {
  it('zero-pads to six digits', () => {
    expect(formatSku('FTT', 1)).toBe('FTT-000001');
    expect(formatSku('FTT', 123456)).toBe('FTT-123456');
  });
});

describe('nextSku', () => {
  it('increments the shared counter sequentially', () => {
    const { sku, counters } = nextSku('FTT', { FTT: 4 }, []);
    expect(sku).toBe('FTT-000005');
    expect(counters.FTT).toBe(5);
  });

  it('starts at 1 for an unseen prefix', () => {
    const { sku } = nextSku('FTT', {}, []);
    expect(sku).toBe('FTT-000001');
  });

  it('numbers new items sequentially across devices and accessories', () => {
    // Both a device and an accessory drawn from the same FTT counter.
    let counters: Record<string, number> = {};
    const a = nextSku('FTT', counters, []); counters = a.counters;
    const b = nextSku('FTT', counters, []); counters = b.counters;
    expect(a.sku).toBe('FTT-000001');
    expect(b.sku).toBe('FTT-000002');
  });

  it('never reuses a number already present on an existing item', () => {
    // Counter says 0 (next would be 1) but FTT-000001 already exists → skip to 2.
    const { sku, counters } = nextSku('FTT', { FTT: 0 }, [item('FTT-000001')]);
    expect(sku).toBe('FTT-000002');
    expect(counters.FTT).toBe(2);
  });

  it('skips legacy-prefixed SKUs without collision (they are left unchanged)', () => {
    // Existing legacy SKUs use other prefixes and never clash with FTT numbers.
    const { sku } = nextSku('FTT', {}, [item('PHN-000001'), item('ACC-000009')]);
    expect(sku).toBe('FTT-000001');
  });

  it('does not mutate the input counters object', () => {
    const counters = { FTT: 1 };
    nextSku('FTT', counters, []);
    expect(counters.FTT).toBe(1);
  });
});

// A tiny in-memory model of a Firestore counters doc under an optimistic-
// concurrency transaction: a transaction reads a snapshot, stages a write, and
// only commits if nothing else wrote in the meantime — otherwise it retries with
// a fresh read (exactly Firestore's runTransaction contract). This lets us prove
// the allocation is atomic without a live Firestore.
function makeFirestoreSim(initial: Record<string, number> = {}) {
  let counters = { ...initial };
  let version = 0;
  const tick = () => new Promise<void>(r => setTimeout(r, 0));

  async function runTransaction<T>(body: (txn: CounterTxn) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const readVersion = version;
      const snapshot = { ...counters };
      let staged: Record<string, number> | null = null;
      const txn: CounterTxn = {
        // The async gap forces concurrent transactions to interleave: both read
        // before either commits — the classic lost-update race.
        read: async () => { await tick(); return { ...snapshot }; },
        write: c => { staged = { ...c }; },
      };
      const result = await body(txn);
      if (version === readVersion) {          // no conflicting write — commit
        if (staged) { counters = staged; version++; }
        return result;
      }
      // Someone committed since we read → retry the whole body with fresh data.
    }
    throw new Error('transaction exceeded retry budget');
  }

  return { runTransaction, get counters() { return counters; } };
}

describe('allocateSkuInTxn — atomic allocation under concurrency', () => {
  it('two concurrent allocations for the same prefix never return the same number', async () => {
    const sim = makeFirestoreSim({});
    const [a, b] = await Promise.all([
      sim.runTransaction(txn => allocateSkuInTxn(txn, 'FTT', [])),
      sim.runTransaction(txn => allocateSkuInTxn(txn, 'FTT', [])),
    ]);
    expect(a.sku).not.toBe(b.sku);
    expect(new Set([a.sku, b.sku])).toEqual(new Set(['FTT-000001', 'FTT-000002']));
    expect(sim.counters.FTT).toBe(2); // both increments persisted — no lost update
  });

  it('many concurrent allocations all get distinct, gapless numbers', async () => {
    const sim = makeFirestoreSim({ FTT: 10 });
    const results = await Promise.all(
      Array.from({ length: 8 }, () => sim.runTransaction(txn => allocateSkuInTxn(txn, 'FTT', []))),
    );
    const skus = results.map(r => r.sku);
    expect(new Set(skus).size).toBe(8);                     // all unique
    expect(new Set(skus)).toEqual(new Set(
      Array.from({ length: 8 }, (_, i) => formatSku('FTT', 11 + i)), // 11..18
    ));
    expect(sim.counters.FTT).toBe(18);
  });

  it('keeps separate prefixes independent', async () => {
    const sim = makeFirestoreSim({ FTT: 5, RPR: 40 });
    const [sku, rpr] = await Promise.all([
      sim.runTransaction(txn => allocateSkuInTxn(txn, 'FTT', [])),
      sim.runTransaction(txn => allocateSkuInTxn(txn, 'RPR', [])),
    ]);
    expect(sku.sku).toBe('FTT-000006');
    expect(rpr.sku).toBe('RPR-000041');
    expect(sim.counters.FTT).toBe(6);
    expect(sim.counters.RPR).toBe(41);
  });
});
