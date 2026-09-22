import { describe, it, expect } from 'vitest';
import { DropOff, DropOffStatus, Settlement } from '../types';
import {
  activeDropOffs, historyDropOffs, isActiveDropOff, isHistoryDropOff,
  groupSettledBySettlement, rejectedHistory, matchesHistoryQuery, historyDateOf, buyerNameFrom,
} from './dropOffHistory';

const d = (id: string, status: DropOffStatus, o: Partial<DropOff> = {}): DropOff => ({
  id, buyerId: 'b1', item: 'iPhone 13', imei: '', sellerName: '', sellerContact: '',
  purchasePrice: 200, paidBy: 'store', dropOffFee: 20, dateDropped: '2026-03-02',
  status, notes: '', ...o,
});

const settlement = (id: string, o: Partial<Settlement> = {}): Settlement => ({
  id, buyerId: 'b1', date: '2026-03-07', periodEnd: '2026-03-07', dropOffIds: [],
  model: 'financing', totalFees: 40, amountOwed: 440, paymentMethod: 'cash', ...o,
} as Settlement);

describe('the active / history split', () => {
  it('keeps pending, accepted and paid-out in the working list', () => {
    (['pending', 'accepted', 'paidout'] as DropOffStatus[]).forEach(s =>
      expect(isActiveDropOff({ status: s })).toBe(true));
  });

  it('moves settled and rejected out of it', () => {
    (['settled', 'rejected'] as DropOffStatus[]).forEach(s => {
      expect(isActiveDropOff({ status: s })).toBe(false);
      expect(isHistoryDropOff({ status: s })).toBe(true);
    });
  });

  it('a settled drop-off leaves Entries and a rejected one does too, while an accepted one stays', () => {
    const all = [
      d('acc', 'accepted'), d('pend', 'pending'), d('paid', 'paidout'),
      d('set', 'settled', { settlementId: 's1' }), d('rej', 'rejected'),
    ];
    expect(activeDropOffs(all).map(x => x.id)).toEqual(['acc', 'pend', 'paid']);
    expect(historyDropOffs(all).map(x => x.id)).toEqual(['set', 'rej']);
  });

  it('nothing is dropped: every drop-off is in exactly one of the two lists', () => {
    const all = [d('a', 'accepted'), d('s', 'settled'), d('r', 'rejected'), d('p', 'pending'), d('o', 'paidout')];
    expect(activeDropOffs(all).length + historyDropOffs(all).length).toBe(all.length);
  });
});

describe('groupSettledBySettlement', () => {
  const s1 = settlement('s1', { date: '2026-03-07', periodEnd: '2026-03-07' });
  const s2 = settlement('s2', { date: '2026-03-14', periodEnd: '2026-03-14', paymentMethod: 'etransfer' });
  const drops = [
    d('x1', 'settled', { settlementId: 's1', item: 'iPhone 13', imei: '35 123456 789012 3' }),
    d('x2', 'settled', { settlementId: 's1', item: 'Pixel 7' }),
    d('y1', 'settled', { settlementId: 's2', item: 'Galaxy S22' }),
    d('r1', 'rejected', { item: 'Cracked iPad', dateDropped: '2026-03-05' }),
    d('a1', 'accepted'),
  ];

  it('groups a settled drop-off under its settlement, newest settlement first', () => {
    const groups = groupSettledBySettlement(drops, [s1, s2]);
    expect(groups.map(g => g.settlementId)).toEqual(['s2', 's1']);
    expect(groups[1].dropOffs.map(x => x.id).sort()).toEqual(['x1', 'x2']);
    expect(groups[0].settlement?.paymentMethod).toBe('etransfer');
  });

  it('carries the settlement record through, so the date, week ending and total come from it', () => {
    const g = groupSettledBySettlement(drops, [s1, s2])[1];
    expect(g.date).toBe('2026-03-07');
    expect(g.settlement?.periodEnd).toBe('2026-03-07');
    expect(g.settlement?.amountOwed).toBe(440);
  });

  it('never includes an accepted or rejected drop-off', () => {
    const ids = groupSettledBySettlement(drops, [s1, s2]).flatMap(g => g.dropOffs.map(x => x.id));
    expect(ids).not.toContain('a1');
    expect(ids).not.toContain('r1');
  });

  it('keeps settled drop-offs that carry no settlementId, in their own group', () => {
    const orphan = d('o1', 'settled', { settlementId: undefined, dateDropped: '2026-01-09' });
    const groups = groupSettledBySettlement([orphan], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].settlement).toBeUndefined();
    expect(groups[0].date).toBe('2026-01-09');
  });

  it('finds a device by a scanned IMEI even though the stored one has spaces', () => {
    const groups = groupSettledBySettlement(drops, [s1, s2], { query: '351234567890123' });
    expect(groups.flatMap(g => g.dropOffs.map(x => x.id))).toEqual(['x1']);
  });

  it('searches by device name and by device buyer name', () => {
    const nameOf = buyerNameFrom([{ id: 'b1', name: 'Marcus', phone: '', notes: '' }]);
    expect(groupSettledBySettlement(drops, [s1, s2], { query: 'pixel' }).flatMap(g => g.dropOffs.map(x => x.id))).toEqual(['x2']);
    expect(groupSettledBySettlement(drops, [s1, s2], { query: 'marcus' }, nameOf).flatMap(g => g.dropOffs.map(x => x.id)).sort())
      .toEqual(['x1', 'x2', 'y1']);
  });

  it('filters by a date range against the settlement date', () => {
    expect(groupSettledBySettlement(drops, [s1, s2], { start: '2026-03-10' }).map(g => g.settlementId)).toEqual(['s2']);
    expect(groupSettledBySettlement(drops, [s1, s2], { end: '2026-03-10' }).map(g => g.settlementId)).toEqual(['s1']);
  });
});

describe('rejectedHistory', () => {
  const drops = [
    d('r1', 'rejected', { item: 'Cracked iPad', dateDropped: '2026-03-05', imei: '35-123456-789012-3' }),
    d('r2', 'rejected', { item: 'Dead Pixel 6', dateDropped: '2026-02-01' }),
    d('s1', 'settled', { settlementId: 's1' }),
  ];

  it('returns only rejected drop-offs, newest first', () => {
    expect(rejectedHistory(drops).map(x => x.id)).toEqual(['r1', 'r2']);
  });

  it('is searchable by IMEI across punctuation and by name, and filterable by date', () => {
    expect(rejectedHistory(drops, { query: '351234567890123' }).map(x => x.id)).toEqual(['r1']);
    expect(rejectedHistory(drops, { query: 'pixel' }).map(x => x.id)).toEqual(['r2']);
    expect(rejectedHistory(drops, { start: '2026-03-01' }).map(x => x.id)).toEqual(['r1']);
  });
});

describe('matchesHistoryQuery / historyDateOf', () => {
  it('an empty query matches everything', () => {
    expect(matchesHistoryQuery(d('a', 'settled'), 'Marcus', '')).toBe(true);
  });

  it('files a settled drop-off under its settlement date, not the drop-off date', () => {
    const drop = d('a', 'settled', { settlementId: 's1', dateDropped: '2026-03-02' });
    expect(historyDateOf(drop, settlement('s1'))).toBe('2026-03-07');
    expect(historyDateOf(drop, undefined)).toBe('2026-03-02');
  });

  it('files a rejected drop-off under the day it came in', () => {
    expect(historyDateOf(d('r', 'rejected', { dateDropped: '2026-03-05' }))).toBe('2026-03-05');
  });
});
