import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { InventoryItem } from '../types';
import { modelKeyOf, normalizeModelName, withModelKey } from './modelKey';
import { SEED_MODEL_ALIASES } from './modelAliases';

/**
 * THE KEY THAT MAKES "HOW MANY 15 PRO MAX IN STOCK" COUNTABLE.
 *
 * Firestore has no substring match and `item` is free text, so a count needs
 * something to equality-match on. This is that field, and the two things worth
 * pinning are: it folds every way the shop actually types a model into one
 * key, and the CLIENT copy here agrees exactly with the SERVER copy that does
 * the counting. If those two ever disagree, a count goes quietly short — which
 * is the failure mode this whole feature exists to avoid.
 */

const device = (over: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', date: '2026-10-01', item: 'Apple iPhone 15 Pro Max',
  imei: '351234567890123', boughtFrom: '', purchaseCost: 700, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, brand: 'Apple', model: 'iPhone 15 Pro Max',
  deviceStatus: 'ready',
  ...over,
} as InventoryItem);

describe('folding a model name', () => {
  it('is the same key however it was typed', () => {
    const key = normalizeModelName('iPhone 15 Pro Max');
    for (const written of [
      'iPhone 15 Pro Max', 'iphone 15 pro max', 'IPHONE-15-PRO-MAX',
      'iphone15 promax', '  iPhone  15  Pro  Max  ',
    ]) {
      expect({ written, key: normalizeModelName(written) }).toEqual({ written, key });
    }
  });

  it('drops storage, colour and condition — those are not the model', () => {
    // "how many 15 Pro Max" means all of them. Capacity and colour are their
    // own fields and stay searchable through the existing word path.
    const base = modelKeyOf(device({ model: 'iPhone 15 Pro Max' }));
    for (const model of [
      'iPhone 15 Pro Max 256GB', 'iPhone 15 Pro Max 1TB Natural Titanium',
      'iPhone 15 Pro Max — Blue, Good', 'iPhone 15 Pro Max unlocked 5G',
    ]) {
      expect({ model, key: modelKeyOf(device({ model })) }).toEqual({ model, key: base });
    }
  });

  it('keys from `item` with the brand stripped when there is no model field', () => {
    // The ONE code path that constructs `item` writes "[brand] [model]", which
    // is exactly why a prefix range over `item` was rejected: the model is not
    // the prefix.
    expect(modelKeyOf(device({ model: '', item: 'Apple iPhone 15 Pro Max' })))
      .toBe(modelKeyOf(device({ model: 'iPhone 15 Pro Max' })));
    expect(modelKeyOf(device({ model: '', brand: '', item: 'iPhone 15 Pro Max 256GB Blue' })))
      .toBe(modelKeyOf(device({ model: 'iPhone 15 Pro Max' })));
  });

  it('tells two different models apart', () => {
    expect(modelKeyOf(device({ model: 'iPhone 15 Pro Max' })))
      .not.toBe(modelKeyOf(device({ model: 'iPhone 15 Pro' })));
    expect(modelKeyOf(device({ model: 'Galaxy S24 Ultra' })))
      .not.toBe(modelKeyOf(device({ model: 'Galaxy S24' })));
  });

  it('has no key for an accessory or an unnamed row', () => {
    expect(modelKeyOf(device({ kind: 'accessory', item: 'USB-C cable', model: '' }))).toBe('');
    expect(modelKeyOf(device({ item: '', model: '', brand: '' }))).toBe('');
  });
});

describe('stamping the key on a save', () => {
  it('adds it for a device', () => {
    expect(withModelKey(device()).modelKey).toBe(normalizeModelName('iphone15promax'));
  });

  it('OMITS it rather than storing an empty string', () => {
    // The server counts keyed rows with `modelKey >= ''`. An empty string
    // would make an unkeyable accessory look keyed and skew the coverage note
    // the other way.
    const acc = withModelKey(device({ kind: 'accessory', item: 'cable', model: '' }));
    expect('modelKey' in acc).toBe(false);
  });

  it('re-derives on every save, so fixing a typo fixes the count', () => {
    const wrong = withModelKey(device({ model: 'iPhone 15 Pro Maxx' }));
    const fixed = withModelKey({ ...wrong, model: 'iPhone 15 Pro Max' });
    expect(fixed.modelKey).toBe(normalizeModelName('iphone15promax'));
    expect(fixed.modelKey).not.toBe(wrong.modelKey);
  });

  it('drops a stale key when a row stops being keyable', () => {
    const was = withModelKey(device());
    const now = withModelKey({ ...was, kind: 'accessory' as const });
    expect('modelKey' in now).toBe(false);
  });
});

/**
 * THE TWO COPIES MUST AGREE.
 *
 * domain/modelKey.ts stamps the field; functions/src/ai/modelKey.ts counts
 * with it. They are separate TypeScript projects, so the code is mirrored
 * rather than shared (the pattern documented in functions/src/showroomPolicy
 * .ts) — and a mirror that drifts produces a count that is quietly short.
 */
describe('the client and server key modules agree', () => {
  /**
   * Compared against the COMPILED server module — functions/lib, the artifact
   * the Cloud Function actually loads — rather than against its source. A
   * source comparison would need a TypeScript evaluator and would prove
   * something about the text rather than about the code that runs.
   *
   * Skipped (loudly, as a passing no-op with a reason) when functions has not
   * been built, so the suite still runs on a fresh clone; `cd functions &&
   * npm test` builds it, and CI runs that.
   */
  const serverPath = join(__dirname, '..', 'functions', 'lib', 'ai', 'modelKey.js');
  const built = existsSync(serverPath);
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const server = built ? (require(serverPath) as {
    modelKeyOf: (r: Record<string, unknown>) => string;
    normalizeModelName: (s: unknown) => string;
  }) : null;

  it('both copies are present to compare', () => {
    // Stated rather than silently skipped: if this ever reads false in CI, the
    // two checks below are not running.
    expect({ built, note: built ? 'compared below' : 'functions not built — run `cd functions && npm test`' })
      .toEqual({ built, note: built ? 'compared below' : 'functions not built — run `cd functions && npm test`' });
  });

  it.runIf(built)('fold the same inputs to the same keys', () => {
    const rows: Partial<InventoryItem>[] = [
      { model: 'iPhone 15 Pro Max' },
      { model: 'iPhone 15 Pro Max 256GB Blue Titanium' },
      { model: '', item: 'Apple iPhone 15 Pro Max', brand: 'Apple' },
      { model: '', item: 'Samsung Galaxy S24 Ultra 512GB', brand: 'Samsung' },
      { model: 'Galaxy Z Fold 5' },
      { kind: 'accessory', item: 'USB-C cable', model: '' },
      { model: '', item: '', brand: '' },
      { model: 'iphone15 promax' },
      { model: 'iPhone 15 Pro' },
    ];
    for (const row of rows) {
      const mine = modelKeyOf(row as InventoryItem);
      const theirs = server!.modelKeyOf(row as Record<string, unknown>);
      expect({ row, theirs }).toEqual({ row, theirs: mine });
    }
  });

  it.runIf(built)('and fold every seeded alias identically', () => {
    // The seeds are the model names a question will actually be counted
    // against, so these are the keys that matter most.
    for (const { model } of SEED_MODEL_ALIASES) {
      expect({ model, key: server!.normalizeModelName(model) })
        .toEqual({ model, key: normalizeModelName(model) });
    }
  });
});

/**
 * Every inventory write has to stamp the key, or a count silently omits the
 * row. Asserted against the source because the paths are spread across a
 * transaction, two batches and the ordinary save.
 */
describe('no inventory write skips the key', () => {
  const src = readFileSync(join(__dirname, '..', 'services', 'firestoreDb.ts'), 'utf8')
    // Comments explain which paths deliberately do NOT re-key, so a plain
    // scan would read that prose as a violation.
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('routes full-document inventory writes through inventoryDoc', () => {
    expect(src).toMatch(/const inventoryDoc = /);
    // Every full-document write names it.
    for (const site of [
      /tx\.set\(docRef\(uid, 'inventory', payload\.candidate\.id\), inventoryDoc\(/,
      /payload\.soldRows\.forEach\(d => batch\.set\(docRef\(uid, 'inventory', d\.id\), inventoryDoc\(d\)\)\)/,
      /\(payload\.devices \|\| \[\]\)\.forEach\(d => batch\.set\(docRef\(uid, 'inventory', d\.id\), inventoryDoc\(d\)\)\)/,
    ]) expect(src).toMatch(site);
    // And saveItem branches on the collection rather than stamping everything.
    expect(src).toMatch(/name === 'inventory' \? inventoryDoc\(item\) : clean\(item\)/);
  });

  it('leaves no full-document inventory write on plain clean()', () => {
    // A `clean(` on an inventory doc would be a row saved without a key. The
    // sale-field merges are {merge:true} partials and are not full documents.
    const offenders = [...src.matchAll(/docRef\(uid, 'inventory'[^)]*\),\s*clean\(/g)];
    expect(offenders.map(m => m[0])).toEqual([]);
  });

  it('the backfill reports what it could not key instead of hiding it', () => {
    expect(src).toMatch(/export async function reindexModelKeys/);
    expect(src).toMatch(/unkeyable\+\+/);
    // Resumable: it hands back a cursor rather than running to a timeout.
    expect(src).toMatch(/nextAfter/);
    expect(src).toMatch(/startAfter\(cursor\)/);
    // Idempotent: an already-correct row is not rewritten.
    expect(src).toMatch(/if \(row\.modelKey === key\) continue;/);
  });
});
