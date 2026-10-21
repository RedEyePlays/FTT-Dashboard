import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * A RETURN WITH NO RESTOCKING FEE COULD NOT BE SAVED.
 *
 * The owner saw "The return could NOT be saved… check your connection". It was
 * neither the connection nor permissions:
 *
 *   FirebaseError: Function WriteBatch.set() called with invalid data.
 *   Unsupported field value: undefined (found in field restockingFee …)
 *
 * `restockingFee` is optional on returnSale's payload. Leave the fee blank, it
 * arrives as `undefined`, and Firestore refuses the WHOLE batch — so the
 * devices did not restock either. Any value including 0 worked; only blank
 * failed. The very next line in the same function already did it right
 * (`clean(a)` on the activity write); the transaction write just didn't.
 *
 * THESE TESTS RECORD WHAT REACHES `batch.set`, because that is where the
 * constraint lives. Asserting on the arguments is the only way to catch a
 * value Firestore would reject, short of a live project.
 */

/** Everything written in the batch, in order, as { path, data, merge }. */
interface Write { path: string; data: Record<string, unknown>; merge: boolean }
let writes: Write[] = [];
let committed = 0;

vi.mock('./firebase', () => ({ db: {}, loadStorage: () => ({}) }));

vi.mock('firebase/firestore', () => {
  const doc = (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') });
  return {
    doc,
    collection: (_db: unknown, ...s: string[]) => ({ path: s.join('/') }),
    writeBatch: () => ({
      set: (ref: { path: string }, data: Record<string, unknown>, opts?: { merge?: boolean }) => {
        writes.push({ path: ref.path, data, merge: opts?.merge === true });
      },
      commit: async () => { committed++; },
    }),
    // Stand-ins for the sentinel helpers; the real ones need a live SDK.
    increment: (n: number) => ({ __increment: n }),
    arrayUnion: (...v: unknown[]) => ({ __arrayUnion: v }),
    deleteField: () => ({ __deleteField: true }),
    onSnapshot: () => () => {},
    setDoc: async () => {},
    deleteDoc: async () => {},
    getDoc: async () => ({ exists: () => false, data: () => undefined }),
    getDocs: async () => ({ empty: true, docs: [] }),
    query: (...a: unknown[]) => a,
    where: (...a: unknown[]) => a,
    orderBy: (...a: unknown[]) => a,
    limit: (...a: unknown[]) => a,
    startAfter: (...a: unknown[]) => a,
    runTransaction: async () => undefined,
  };
});

const { returnSale, voidSale } = await import('./firestoreDb');

const WS = 'ws1';
const TX = 'tx-1';

beforeEach(() => { writes = []; committed = 0; });

const txWrite = (): Write => {
  const w = writes.find(x => x.path === `user_data/${WS}/salesTransactions/${TX}`);
  expect(w, 'the transaction was never written').toBeTruthy();
  return w!;
};

/** Every value Firestore would reject, anywhere in the batch. */
const undefinedFields = (): string[] => {
  const bad: string[] = [];
  const walk = (v: unknown, trail: string) => {
    if (v === undefined) { bad.push(trail); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${trail}[${i}]`)); return; }
    if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) walk(val, trail ? `${trail}.${k}` : k);
    }
  };
  for (const w of writes) walk(w.data, w.path.split('/').slice(-2).join('/'));
  return bad;
};

const activity = [{
  id: 'a1', ts: 1, userId: 'u1', userEmail: 'sam@shop.test', text: 'Return processed',
}] as never[];

const returnPayload = (returned: Record<string, unknown>) => ({
  transactionId: TX,
  resellDevices: [{ id: 'd1' }],
  defectiveDevices: [{ id: 'd2' }],
  accessoryUpdates: [{ id: 'acc1', delta: 2 }],
  returned: returned as never,
  activity,
});

describe('returnSale', () => {
  it('SAVES WITH restockingFee UNDEFINED — the reported bug', async () => {
    await returnSale(WS, returnPayload({
      returnedAt: 1, returnedBy: 'u1', refundAmount: 120,
      restockingFee: undefined, refundPaidFrom: undefined, refundSplits: undefined,
      returnedByEmail: undefined,
    }));

    // Nothing Firestore would reject, anywhere in the batch.
    expect(undefinedFields()).toEqual([]);
    expect(committed).toBe(1);
    // The field is absent rather than present-and-undefined.
    expect('restockingFee' in txWrite().data).toBe(false);
  });

  it('KEEPS A ZERO FEE — 0 is a figure, not a blank', async () => {
    // The distinction clean() has to get right: undefined is dropped, 0 is not.
    await returnSale(WS, returnPayload({
      returnedAt: 1, returnedBy: 'u1', refundAmount: 120, restockingFee: 0,
    }));
    expect(txWrite().data.restockingFee).toBe(0);
    expect(undefinedFields()).toEqual([]);
  });

  it('saves with refundPaidFrom and refundSplits undefined', async () => {
    // Optional on the same payload and would have failed identically.
    await returnSale(WS, returnPayload({
      returnedAt: 1, returnedBy: 'u1', refundAmount: 0,
      refundPaidFrom: undefined, refundSplits: undefined,
    }));
    expect(undefinedFields()).toEqual([]);
    expect('refundPaidFrom' in txWrite().data).toBe(false);
    expect('refundSplits' in txWrite().data).toBe(false);
  });

  it('records the return and the refund', async () => {
    await returnSale(WS, returnPayload({
      returnedAt: 1_700_000_000_000, returnedBy: 'u1', returnedByEmail: 'sam@shop.test',
      refundAmount: 95.5, restockingFee: 10, refundPaidFrom: 'store_cash',
    }));
    const d = txWrite();
    expect(d.data.status).toBe('returned');
    expect(d.data.refundAmount).toBe(95.5);
    expect(d.data.restockingFee).toBe(10);
    expect(d.data.refundPaidFrom).toBe('store_cash');
    expect(d.data.returnedByEmail).toBe('sam@shop.test');
    // A merge, so the rest of the sale is untouched.
    expect(d.merge).toBe(true);
  });

  it('restocks devices by disposition, unchanged', async () => {
    await returnSale(WS, returnPayload({
      returnedAt: 1, returnedBy: 'u1', refundAmount: 50,
    }));
    const resell = writes.find(w => w.path === `user_data/${WS}/inventory/d1`)!;
    const defective = writes.find(w => w.path === `user_data/${WS}/inventory/d2`)!;
    expect(resell.data.deviceStatus).toBe('ready');
    expect(defective.data.deviceStatus).toBe('returned');
    // Both clear the sale fields either way.
    for (const w of [resell, defective]) {
      expect(w.data.soldDate).toBe('');
      expect(w.data.salePrice).toBe(0);
      expect(w.data.transactionId).toBe('');
      expect(w.merge).toBe(true);
    }
    // And the accessory restock is still an atomic increment.
    const acc = writes.find(w => w.path === `user_data/${WS}/accessories/acc1`)!;
    expect(acc.data.quantity).toEqual({ __increment: 2 });
  });
});

describe('voidSale — the same bug, found by auditing the sibling', () => {
  const voidPayload = (voided: Record<string, unknown>) => ({
    transactionId: TX,
    devices: [{ id: 'd1' }],
    accessoryUpdates: [{ id: 'acc1', delta: 1 }],
    voided: voided as never,
    activity,
  });

  it('SAVES WITH NO REFUND SOURCE — which happens on a split refund or a $0 void', async () => {
    // Not hypothetical: singleRefundSource (domain/pos.ts) returns undefined
    // whenever a refund is split across two sources or is $0, and App.tsx
    // passes its result straight into this payload. A $0 refund needing no
    // source is what the payload type itself documents.
    await voidSale(WS, voidPayload({
      voidedAt: 1, voidedBy: 'u1', voidedByEmail: undefined,
      refundPaidFrom: undefined, refundSplits: undefined,
    }));
    expect(undefinedFields()).toEqual([]);
    expect(committed).toBe(1);
    expect(txWrite().data.status).toBe('voided');
    expect('refundPaidFrom' in txWrite().data).toBe(false);
  });

  it('keeps a refund source and splits when there are some', async () => {
    await voidSale(WS, voidPayload({
      voidedAt: 1, voidedBy: 'u1', refundPaidFrom: 'store_cash',
      refundSplits: [{ paidFrom: 'store_cash', amount: 40 }],
    }));
    expect(txWrite().data.refundPaidFrom).toBe('store_cash');
    expect(txWrite().data.refundSplits).toEqual([{ paidFrom: 'store_cash', amount: 40 }]);
    expect(undefinedFields()).toEqual([]);
  });

  it('restocks its devices to ready, unchanged', async () => {
    await voidSale(WS, voidPayload({ voidedAt: 1, voidedBy: 'u1' }));
    const d = writes.find(w => w.path === `user_data/${WS}/inventory/d1`)!;
    expect(d.data.deviceStatus).toBe('ready');
    expect(d.merge).toBe(true);
  });
});

/* ---------------- The message the owner actually reads ---------------- */

describe('the failure alert does not assert a cause it cannot know', () => {
  // Asserted against App.tsx's source: writeFailed is a closure inside the
  // component and cannot be imported, but the one sentence that misled the
  // owner is worth pinning anyway — it cost real time chasing connectivity
  // for a rejected field value.
  const src = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');
  const body = (() => {
    const start = src.indexOf('const writeFailed =');
    expect(start).toBeGreaterThan(-1);
    // COMMENTS STRIPPED. The code's own comment quotes the old sentence to
    // explain why it went, and a plain scan reads that as evidence it is still
    // there — the same prose-vs-code trap as scanning for a field name in a
    // file that documents not writing it.
    return src.slice(start, src.indexOf('\n  };', start))
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
  })();

  it('no longer TELLS the user it is their connection', () => {
    expect(body).not.toMatch(/Check your connection and try again/);
  });

  it('offers the connection as one possibility, not the reason', () => {
    expect(body).toMatch(/it may be your connection, or it may be a problem in the app/);
  });

  it('keeps what was always true: what failed, what it means, tell the owner', () => {
    expect(body).toMatch(/could NOT be saved/);
    expect(body).toMatch(/\$\{consequence\}/);
    expect(body).toMatch(/tell the owner/);
  });

  it('does not try to classify error codes into causes', () => {
    // Deliberately out of scope: a wrong guess is what caused this, and
    // getting it right is a bigger change than a message.
    expect(body).not.toMatch(/e\.code|FirebaseError|permission-denied|unavailable/);
  });

  it('the returns caller still states its own consequence', () => {
    // "The sale is still recorded as completed, and no refund was logged" was
    // accurate and genuinely useful — the pattern stays.
    expect(src).toMatch(/writeFailed\('The return', e, 'The sale is still recorded as completed, and no refund was logged\.'\)/);
  });
});
