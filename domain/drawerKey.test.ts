import { describe, it, expect } from 'vitest';
import { CashReconciliation } from '../types';
import {
  drawerKey, parseDrawerKey, isLegacyDrawerId, drawerLocationId,
  drawersAt, drawerOn, drawerIdFor, DRAWER_KEY_SEP,
} from './drawerKey';

/**
 * ONE CASH DRAWER PER STORE — the key, and what reads it.
 *
 * THE BUG: `cashReconciliations` was keyed by the date alone, so with two
 * stores open both tills wrote the same document on the same day and one
 * store's float, movements and count silently replaced the other's.
 *
 * The two promises pinned here are the ones that cost real money if they
 * break: a day's drawer never crosses stores, and NO HISTORICAL RECORD IS
 * RE-KEYED — bare-date ids keep working, keep being written to, and keep
 * reading as the default store's.
 */

const rec = (id: string, p: Partial<CashReconciliation> = {}): CashReconciliation => ({
  id,
  date: id.slice(0, 10),
  expectedCash: 0, variance: 0, recordedBy: 'u1', recordedAt: 1,
  ...p,
});

const BRAMPTON = 'brampton';
const MISS = 'mississauga';

describe('the key', () => {
  it('is the date then the store', () => {
    expect(drawerKey('2026-10-27', BRAMPTON)).toBe('2026-10-27__brampton');
    expect(drawerKey('2026-10-27', MISS)).toBe('2026-10-27__mississauga');
  });

  it('sorts by DATE first, so a day\'s drawers stay adjacent', () => {
    // Load-bearing: ids sort lexicographically, and every query, export and
    // backup over this collection treats an id range as a date range. A
    // store-first key would have scattered each day across the collection.
    const ids = [
      drawerKey('2026-10-28', BRAMPTON), drawerKey('2026-10-27', MISS),
      drawerKey('2026-10-27', BRAMPTON),
    ].sort();
    expect(ids).toEqual(['2026-10-27__brampton', '2026-10-27__mississauga', '2026-10-28__brampton']);
  });

  it('is the BARE DATE when there is no store list — stage 2 is invisible until stage 1 ran', () => {
    expect(drawerKey('2026-10-27', '')).toBe('2026-10-27');
    expect(drawerKey('2026-10-27', undefined)).toBe('2026-10-27');
  });

  it('round-trips', () => {
    expect(parseDrawerKey(drawerKey('2026-10-27', MISS))).toEqual({ date: '2026-10-27', locationId: MISS });
    expect(parseDrawerKey('2026-10-27')).toEqual({ date: '2026-10-27' });
  });

  it('keeps a location id containing the separator whole', () => {
    // The date is a fixed ten characters, so the split is by position, never
    // by searching for the separator.
    const weird = `north${DRAWER_KEY_SEP}end`;
    expect(parseDrawerKey(drawerKey('2026-10-27', weird))).toEqual({ date: '2026-10-27', locationId: weird });
  });

  it('does not invent a date out of an id that has none', () => {
    expect(parseDrawerKey('not-a-date__brampton')).toEqual({ date: 'not-a-date__brampton' });
    expect(parseDrawerKey('')).toEqual({ date: '' });
  });

  it('tells a legacy id from a composite one', () => {
    expect(isLegacyDrawerId('2026-10-27')).toBe(true);
    expect(isLegacyDrawerId('2026-10-27__brampton')).toBe(false);
    expect(isLegacyDrawerId('garbage')).toBe(false);
  });
});

describe('which store a stored record belongs to', () => {
  it('reads it off the id when the id carries one', () => {
    expect(drawerLocationId(rec('2026-10-27__mississauga'), BRAMPTON)).toBe(MISS);
  });

  it('THE ID WINS over a disagreeing field — the key is what decides the document', () => {
    expect(drawerLocationId(rec('2026-10-27__mississauga', { locationId: BRAMPTON }), BRAMPTON)).toBe(MISS);
  });

  it('falls back to the record\'s own field for a bare-date id (stage 1\'s backfill)', () => {
    expect(drawerLocationId(rec('2026-10-27', { locationId: MISS }), BRAMPTON)).toBe(MISS);
  });

  it('A BARE-DATE RECORD WITH NO FIELD IS THE DEFAULT STORE\'S — every day the shop had one shop', () => {
    expect(drawerLocationId(rec('2026-10-27'), BRAMPTON)).toBe(BRAMPTON);
  });

  it('resolves to nothing when there is no store list at all', () => {
    expect(drawerLocationId(rec('2026-10-27'))).toBe('');
  });
});

describe('scoping a list to one store', () => {
  const recs = [
    rec('2026-10-25'),                              // legacy → Brampton
    rec('2026-10-26', { locationId: MISS }),        // legacy, backfilled to Mississauga
    rec('2026-10-27__brampton'),
    rec('2026-10-27__mississauga'),
  ];

  it('keeps only that store\'s days, legacy records included', () => {
    expect(drawersAt(recs, BRAMPTON, BRAMPTON).map(r => r.id))
      .toEqual(['2026-10-25', '2026-10-27__brampton']);
    expect(drawersAt(recs, MISS, BRAMPTON).map(r => r.id))
      .toEqual(['2026-10-26', '2026-10-27__mississauga']);
  });

  it('two stores on the SAME DAY do not see each other', () => {
    // The whole point. Before this, there was one document for the two of them.
    expect(drawerOn(recs, '2026-10-27', BRAMPTON, BRAMPTON)!.id).toBe('2026-10-27__brampton');
    expect(drawerOn(recs, '2026-10-27', MISS, BRAMPTON)!.id).toBe('2026-10-27__mississauga');
  });

  it('passes the whole list through when no store is asked for', () => {
    expect(drawersAt(recs, '', '')).toHaveLength(4);
  });

  it('survives an empty list', () => {
    expect(drawersAt([], BRAMPTON, BRAMPTON)).toEqual([]);
    expect(drawerOn([], '2026-10-27', BRAMPTON, BRAMPTON)).toBeUndefined();
  });
});

describe('where the next write goes', () => {
  it('to the composite id for a day with nothing stored', () => {
    expect(drawerIdFor([], '2026-10-27', BRAMPTON, BRAMPTON)).toBe('2026-10-27__brampton');
  });

  it('TO THE LEGACY DOCUMENT when today already has one — the cutover day does not split in half', () => {
    // The day stage 2 ships: the morning's float and movements are in
    // `2026-10-27`. Writing the afternoon to `2026-10-27__brampton` would
    // leave two half-days, both wrong, and a till that read as short by
    // whatever had already been logged.
    const recs = [rec('2026-10-27', { openingFloat: 200, openedAt: 1 })];
    expect(drawerIdFor(recs, '2026-10-27', BRAMPTON, BRAMPTON)).toBe('2026-10-27');
  });

  it('but NOT for the other store, which has no history on that document', () => {
    const recs = [rec('2026-10-27', { openingFloat: 200 })];
    expect(drawerIdFor(recs, '2026-10-27', MISS, BRAMPTON)).toBe('2026-10-27__mississauga');
  });

  it('prefers the composite document once one exists, so a day never drifts back', () => {
    const recs = [rec('2026-10-27'), rec('2026-10-27__brampton')];
    expect(drawerIdFor(recs, '2026-10-27', BRAMPTON, BRAMPTON)).toBe('2026-10-27__brampton');
  });

  it('a legacy record backfilled to the OTHER store is not claimed by the default one', () => {
    const recs = [rec('2026-10-27', { locationId: MISS })];
    expect(drawerIdFor(recs, '2026-10-27', BRAMPTON, BRAMPTON)).toBe('2026-10-27__brampton');
    expect(drawerIdFor(recs, '2026-10-27', MISS, BRAMPTON)).toBe('2026-10-27');
  });

  it('is the bare date with no store list — exactly today\'s behaviour', () => {
    expect(drawerIdFor([], '2026-10-27', '', '')).toBe('2026-10-27');
  });
});
