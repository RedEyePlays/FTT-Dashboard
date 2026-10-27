import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocationTaggedCollection } from '../domain/locations';

/**
 * THE BACKFILL: THE LARGEST SINGLE DATA CHANGE THIS APP HAS MADE.
 *
 * Every device, sale, repair, drop-off, settlement, shift and drawer record in
 * the workspace gets a location. 241 devices and all of the history predate
 * the second store, so all of it belongs to Brampton.
 *
 * Four properties have to hold, and all four are asserted against a fake
 * Firestore that records what was written:
 *
 *   it never guesses   — only a row with NO locationId is touched
 *   it is idempotent   — a second run writes nothing
 *   it is resumable    — interrupt and resume covers every row exactly once
 *   it reports         — scanned / written / skipped, per collection
 *
 * The fourth matters because the owner has to be able to see it FINISHED,
 * rather than trust a spinner.
 */

/** One fake collection: ordered documents, as Firestore would page them. */
type Doc = { id: string; data: Record<string, unknown> };
let store: Record<string, Doc[]> = {};
/** Every field-merge the backfill committed, in order. */
let writes: { path: string; data: Record<string, unknown>; merge: boolean }[] = [];
let commits = 0;

vi.mock('./firebase', () => ({ db: {}, loadStorage: () => ({}) }));

vi.mock('firebase/firestore', () => {
  const colRef = (_db: unknown, ...s: string[]) => ({ kind: 'col', path: s.join('/') });
  const docRef = (_db: unknown, ...s: string[]) => ({ kind: 'doc', path: s.join('/') });
  return {
    collection: colRef,
    doc: docRef,
    // query(col, orderBy, limit, startAfter?) — the shape firestoreDb builds.
    query: (col: { path: string }, ...clauses: unknown[]) => ({ col, clauses }),
    orderBy: (field: string) => ({ __orderBy: field }),
    limit: (n: number) => ({ __limit: n }),
    startAfter: (cursor: string) => ({ __startAfter: cursor }),
    getDocs: async (q: { col: { path: string }; clauses: Record<string, unknown>[] }) => {
      // The collection name is the last path segment: user_data/<ws>/<name>.
      const name = q.col.path.split('/').pop() as string;
      const all = store[name] || [];
      const take = Number(q.clauses.find(c => '__limit' in c)?.__limit ?? all.length);
      const after = q.clauses.find(c => '__startAfter' in c)?.__startAfter as string | undefined;
      // Ordered by document id, which is what orderBy('__name__') means.
      const ordered = [...all].sort((a, b) => a.id.localeCompare(b.id));
      const start = after ? ordered.findIndex(d => d.id === after) + 1 : 0;
      const page = ordered.slice(start, start + take);
      return {
        empty: page.length === 0,
        docs: page.map(d => ({ id: d.id, data: () => d.data })),
      };
    },
    writeBatch: () => ({
      set: (ref: { path: string }, data: Record<string, unknown>, o?: { merge?: boolean }) => {
        writes.push({ path: ref.path, data, merge: o?.merge === true });
        // Apply it, so a second run sees the result of the first.
        const parts = ref.path.split('/');
        const id = parts.pop() as string;
        const name = parts.pop() as string;
        const row = (store[name] || []).find(d => d.id === id);
        if (row) Object.assign(row.data, data);
      },
      commit: async () => { commits++; },
    }),
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...v: unknown[]) => ({ __arrayUnion: v }),
    deleteField: () => ({ __deleteField: true }),
    onSnapshot: () => () => {},
    setDoc: async () => {},
    deleteDoc: async () => {},
    getDoc: async () => ({ exists: () => false, data: () => undefined }),
    runTransaction: async () => undefined,
    where: (...a: unknown[]) => a,
  };
});

const { backfillLocationIds } = await import('./firestoreDb');

const WS = 'ws1';
const BRAMPTON = 'loc-brampton';

/** `n` devices with no location, ids zero-padded so ordering is stable. */
const devices = (n: number, over: (i: number) => Record<string, unknown> = () => ({})): Doc[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `d${String(i).padStart(4, '0')}`,
    data: { sku: `PHN-${i}`, item: 'iPhone 13', ...over(i) },
  }));

beforeEach(() => { store = {}; writes = []; commits = 0; });

/** Run one collection to completion, looping on the cursor. */
const runAll = async (collection: LocationTaggedCollection, locationId = BRAMPTON) => {
  const totals = { scanned: 0, written: 0, skipped: 0, calls: 0 };
  let after: string | undefined;
  for (let i = 0; i < 100; i++) {
    const step = await backfillLocationIds(WS, locationId, { collection, after });
    totals.scanned += step.scanned;
    totals.written += step.written;
    totals.skipped += step.skipped;
    totals.calls++;
    if (step.done || !step.nextAfter) break;
    after = step.nextAfter;
  }
  return totals;
};

describe('assigning existing records to Brampton', () => {
  it('assigns every row that has no location', async () => {
    store.inventory = devices(241);                 // the shop's actual count
    const t = await runAll('inventory');

    expect(t.scanned).toBe(241);
    expect(t.written).toBe(241);
    expect(t.skipped).toBe(0);
    expect(store.inventory.every(d => d.data.locationId === BRAMPTON)).toBe(true);
  });

  it('writes a FIELD MERGE and nothing else, so a migration cannot disturb a record', async () => {
    store.inventory = devices(1);
    await runAll('inventory');

    expect(writes).toHaveLength(1);
    expect(writes[0].data).toEqual({ locationId: BRAMPTON });
    expect(writes[0].merge).toBe(true);
    expect(writes[0].path).toBe(`user_data/${WS}/inventory/d0000`);
    // The rest of the row is untouched.
    expect(store.inventory[0].data.sku).toBe('PHN-0');
  });

  it('reports per collection what it scanned, wrote and skipped', async () => {
    store.repairs = devices(5);
    const step = await backfillLocationIds(WS, BRAMPTON, { collection: 'repairs' });
    expect(step.collection).toBe('repairs');
    expect(step).toMatchObject({ scanned: 5, written: 5, skipped: 0, done: true });
  });

  it('an empty collection finishes cleanly rather than erroring', async () => {
    store.settlements = [];
    expect(await runAll('settlements')).toMatchObject({ scanned: 0, written: 0, skipped: 0 });
  });

  it('refuses to run with no location to assign', async () => {
    store.inventory = devices(1);
    await expect(backfillLocationIds(WS, '', { collection: 'inventory' })).rejects.toThrow(/location is required/i);
    expect(writes).toEqual([]);
  });
});

describe('IT NEVER GUESSES', () => {
  it('leaves a row that already has a location completely alone', async () => {
    // Stage 4's transfers will set this deliberately. A migration that
    // overwrote their work would move stock between stores in the books.
    store.inventory = [
      ...devices(2),
      { id: 'd9000', data: { sku: 'MOVED', locationId: 'loc-mississauga' } },
    ];
    const t = await runAll('inventory');

    expect(t.written).toBe(2);
    expect(t.skipped).toBe(1);
    expect(store.inventory.find(d => d.id === 'd9000')!.data.locationId).toBe('loc-mississauga');
    // Nothing was written to that document at all.
    expect(writes.some(w => w.path.endsWith('d9000'))).toBe(false);
  });

  it('treats an empty-string location as absent, not as already-set', async () => {
    // A blank is not an assignment, and leaving it would make the row
    // permanently invisible to a per-store filter.
    store.inventory = [{ id: 'd1', data: { locationId: '' } }];
    const t = await runAll('inventory');
    expect(t.written).toBe(1);
    expect(store.inventory[0].data.locationId).toBe(BRAMPTON);
  });
});

describe('IT IS IDEMPOTENT', () => {
  it('a second run writes nothing', async () => {
    store.inventory = devices(120);

    const first = await runAll('inventory');
    expect(first.written).toBe(120);

    writes = []; commits = 0;
    const second = await runAll('inventory');

    expect(second.scanned).toBe(120);
    expect(second.written).toBe(0);
    expect(second.skipped).toBe(120);
    // Not a single write, and not a single commit.
    expect(writes).toEqual([]);
    expect(commits).toBe(0);
  });

  it('and a third run still writes nothing', async () => {
    store.inventory = devices(10);
    await runAll('inventory');
    await runAll('inventory');
    writes = [];
    expect((await runAll('inventory')).written).toBe(0);
    expect(writes).toEqual([]);
  });
});

describe('IT IS RESUMABLE', () => {
  it('interrupting and resuming from nextAfter covers every row EXACTLY ONCE', async () => {
    store.inventory = devices(700);     // more than one page, more than maxDocs

    // Walk it in deliberately small bites, as an interrupted run would.
    let after: string | undefined;
    let written = 0;
    let scanned = 0;
    let steps = 0;
    for (let i = 0; i < 200; i++) {
      const step = await backfillLocationIds(WS, BRAMPTON, { collection: 'inventory', after, maxDocs: 90 });
      scanned += step.scanned;
      written += step.written;
      steps++;
      if (step.done || !step.nextAfter) break;
      after = step.nextAfter;
    }

    expect(steps).toBeGreaterThan(1);              // it really was interrupted
    expect(scanned).toBe(700);
    expect(written).toBe(700);
    // EXACTLY ONCE: one write per document, no duplicates.
    expect(writes).toHaveLength(700);
    expect(new Set(writes.map(w => w.path)).size).toBe(700);
    expect(store.inventory.every(d => d.data.locationId === BRAMPTON)).toBe(true);
  });

  it('hands back a cursor while there is more, and none when done', async () => {
    store.inventory = devices(500);
    const first = await backfillLocationIds(WS, BRAMPTON, { collection: 'inventory', maxDocs: 100 });
    expect(first.done).toBe(false);
    expect(first.nextAfter).toBe('d0099');

    // Resume to the end.
    let after = first.nextAfter;
    let last = first;
    for (let i = 0; i < 20 && after; i++) {
      last = await backfillLocationIds(WS, BRAMPTON, { collection: 'inventory', after, maxDocs: 100 });
      after = last.nextAfter;
    }
    expect(last.done).toBe(true);
    expect(last.nextAfter).toBeUndefined();
  });

  it('A RESUMED RUN STILL NEVER OVERWRITES an already-located row', async () => {
    // The two properties together, which is where a migration usually goes
    // wrong: a row assigned by stage 4 mid-migration must survive the resume.
    store.inventory = devices(300);
    const first = await backfillLocationIds(WS, BRAMPTON, { collection: 'inventory', maxDocs: 100 });
    expect(first.nextAfter).toBeTruthy();

    // Something assigns a later row to the other store while we are paused.
    store.inventory.find(d => d.id === 'd0250')!.data.locationId = 'loc-mississauga';

    let after = first.nextAfter;
    let skipped = 0;
    for (let i = 0; i < 20 && after; i++) {
      const step = await backfillLocationIds(WS, BRAMPTON, { collection: 'inventory', after, maxDocs: 100 });
      skipped += step.skipped;
      after = step.nextAfter;
      if (step.done) break;
    }

    expect(skipped).toBe(1);
    expect(store.inventory.find(d => d.id === 'd0250')!.data.locationId).toBe('loc-mississauga');
  });
});

describe('every tagged collection can be backfilled', () => {
  it('each one pages and assigns the same way', async () => {
    // One cursor cannot span collections — document ids are only ordered
    // within one — which is why this takes a collection per call and the
    // caller loops.
    const names: LocationTaggedCollection[] = [
      'inventory', 'accessories', 'salesTransactions', 'repairs',
      'dropOffs', 'settlements', 'timeEntries', 'expenses', 'cashReconciliations',
    ];
    for (const n of names) store[n] = devices(3);

    for (const n of names) {
      const t = await runAll(n);
      expect({ n, written: t.written, skipped: t.skipped }).toEqual({ n, written: 3, skipped: 0 });
    }
    for (const n of names) {
      expect(store[n].every(d => d.data.locationId === BRAMPTON)).toBe(true);
    }
  });
});

describe('a record with no location is untouched by everything else', () => {
  it('nothing in the backfill reads or depends on the field being present', async () => {
    // Stage 1 is invisible and reversible: rows keep their exact previous
    // shape apart from one added field, and the only thing that looks at the
    // field is the skip check.
    store.inventory = devices(3);
    const before = store.inventory.map(d => ({ ...d.data }));
    await runAll('inventory');
    store.inventory.forEach((d, i) => {
      const { locationId, ...rest } = d.data;
      expect(rest).toEqual(before[i]);
      expect(locationId).toBe(BRAMPTON);
    });
  });
});
