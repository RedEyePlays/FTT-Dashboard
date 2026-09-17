import { describe, it, expect } from 'vitest';
import { DropOff } from '../types';
import { groupSettleableByWeek, defaultSettlementWeek, settleableDropOffs, BUYER_FUNDED } from './dropoffs';
import { weekEndingSaturday } from './dates';

// The problem: `settleableDropOffs` returned EVERY unsettled drop-off for a
// buyer with no notion of when it arrived. Miss one Saturday and the next
// week simply piled on top of it — one lump sum, no way to see that two
// weeks were tangled together, and no way to settle last week now and this
// week on Saturday.

const drop = (over: Partial<DropOff> = {}): DropOff => ({
  id: 'd1', buyerId: 'b1', item: 'iPhone 13', imei: '', sellerName: '', sellerContact: '',
  purchasePrice: 400, paidBy: 'store', dropOffFee: 20, dateDropped: '2026-03-10',
  status: 'accepted', notes: '', ...over,
});

describe('weekEndingSaturday — a settlement week runs Sunday → Saturday', () => {
  it('a Saturday is its own week end, never pushed into the next one', () => {
    // 2026-03-14 is a Saturday.
    expect(weekEndingSaturday('2026-03-14')).toBe('2026-03-14');
  });

  it('a mid-week day maps forward to that week\'s Saturday', () => {
    expect(weekEndingSaturday('2026-03-10')).toBe('2026-03-14'); // Tue
    expect(weekEndingSaturday('2026-03-13')).toBe('2026-03-14'); // Fri
  });

  it('the Sunday that OPENS a week maps to the Saturday six days later', () => {
    expect(weekEndingSaturday('2026-03-08')).toBe('2026-03-14');
  });

  it('adjacent days either side of a Saturday land in different weeks', () => {
    expect(weekEndingSaturday('2026-03-14')).toBe('2026-03-14'); // Sat
    expect(weekEndingSaturday('2026-03-15')).toBe('2026-03-21'); // Sun → next week
  });

  it('crosses a month and a year boundary without drifting', () => {
    expect(weekEndingSaturday('2026-12-31')).toBe('2027-01-02');
  });

  it('is a LOCAL date calculation — no UTC round-trip to shift the day', () => {
    // The whole reason domain/dates.ts exists. A toISOString() round-trip on
    // a negative-UTC-offset terminal turns an evening date into the next
    // day's, which at a week boundary files the drop-off under the wrong
    // week — a whole extra settlement.
    expect(weekEndingSaturday('2026-03-14')).toBe('2026-03-14');
    expect(weekEndingSaturday('2026-03-21')).toBe('2026-03-21');
  });

  it('passes a junk/empty date straight through rather than inventing a week', () => {
    expect(weekEndingSaturday('')).toBe('');
  });
});

describe('groupSettleableByWeek — the missed week is visible and settleable on its own', () => {
  // The reported scenario: a Saturday was missed, so a buyer has last week's
  // devices AND this week's sitting in one pending list.
  const missedWeek = [
    drop({ id: 'a1', dateDropped: '2026-03-09', dropOffFee: 20, purchasePrice: 400 }),
    drop({ id: 'a2', dateDropped: '2026-03-12', dropOffFee: 30, purchasePrice: 500 }),
  ];
  const thisWeek = [
    drop({ id: 'b1', dateDropped: '2026-03-16', dropOffFee: 25, purchasePrice: 300 }),
  ];
  const all = [...thisWeek, ...missedWeek]; // deliberately out of order

  it('splits the one pending lump into its two real weeks', () => {
    const weeks = groupSettleableByWeek(all);
    expect(weeks.map(w => w.weekEnding)).toEqual(['2026-03-14', '2026-03-21']);
    expect(weeks[0].dropOffs.map(d => d.id)).toEqual(['a1', 'a2']);
    expect(weeks[1].dropOffs.map(d => d.id)).toEqual(['b1']);
  });

  it('returns weeks OLDEST first, so the missed one is at the top', () => {
    expect(groupSettleableByWeek(all)[0].weekEnding).toBe('2026-03-14');
  });

  it('orders devices within a week oldest first', () => {
    const weeks = groupSettleableByWeek([
      drop({ id: 'later', dateDropped: '2026-03-12' }),
      drop({ id: 'earlier', dateDropped: '2026-03-09' }),
    ]);
    expect(weeks[0].dropOffs.map(d => d.id)).toEqual(['earlier', 'later']);
  });

  it('each week carries its OWN subtotal, not a share of the lump', () => {
    const weeks = groupSettleableByWeek(all);
    // Missed week: principal 400 + 500, fees 20 + 30.
    expect(weeks[0].totals.principalOwed).toBe(900);
    expect(weeks[0].totals.feesOwed).toBe(50);
    expect(weeks[0].totals.totalOwed).toBe(950);
    // This week, entirely separately.
    expect(weeks[1].totals.principalOwed).toBe(300);
    expect(weeks[1].totals.feesOwed).toBe(25);
    expect(weeks[1].totals.totalOwed).toBe(325);
  });

  it('the weeks together account for every pending device — nothing is dropped', () => {
    const weeks = groupSettleableByWeek(all);
    expect(weeks.reduce((n, w) => n + w.dropOffs.length, 0)).toBe(all.length);
    expect(weeks.reduce((n, w) => n + w.totals.totalOwed, 0)).toBe(950 + 325);
  });

  it('a buyer-funded device contributes only its fee, per week', () => {
    const weeks = groupSettleableByWeek([
      drop({ id: 'own', dateDropped: '2026-03-10', paidBy: BUYER_FUNDED, purchasePrice: 400, dropOffFee: 20 }),
    ]);
    expect(weeks[0].totals.principalOwed).toBe(0);
    expect(weeks[0].totals.totalOwed).toBe(20);
  });

  it('an undated drop-off stays visible instead of vanishing from the list', () => {
    const weeks = groupSettleableByWeek([drop({ id: 'nodate', dateDropped: '' }), ...thisWeek]);
    expect(weeks[0].weekEnding).toBe('');
    expect(weeks[0].dropOffs.map(d => d.id)).toEqual(['nodate']);
  });

  it('nothing pending is an empty list, not a phantom week', () => {
    expect(groupSettleableByWeek([])).toEqual([]);
  });

  it('only settleable drop-offs get this far — settled and rejected never reappear', () => {
    const pending = settleableDropOffs('b1', [
      ...all,
      drop({ id: 'done', status: 'settled', dateDropped: '2026-03-09' }),
      drop({ id: 'no', status: 'rejected', dateDropped: '2026-03-09' }),
    ]);
    const ids = groupSettleableByWeek(pending).flatMap(w => w.dropOffs.map(d => d.id));
    expect(ids).not.toContain('done');
    expect(ids).not.toContain('no');
    expect(ids.sort()).toEqual(['a1', 'a2', 'b1']);
  });

  it('settling one week leaves the other fully intact and still settleable', () => {
    // What happens after "Settle this week" on the missed week: those
    // drop-offs flip to 'settled' and drop out; this week is untouched.
    const after = all.map(d => (d.dateDropped < '2026-03-15' ? { ...d, status: 'settled' as const } : d));
    const weeks = groupSettleableByWeek(settleableDropOffs('b1', after));
    expect(weeks).toHaveLength(1);
    expect(weeks[0].weekEnding).toBe('2026-03-21');
    expect(weeks[0].totals.totalOwed).toBe(325);
  });

  it('two buyers never bleed into each other', () => {
    const mixed = [...all, drop({ id: 'other', buyerId: 'b2', dateDropped: '2026-03-10' })];
    const ids = groupSettleableByWeek(settleableDropOffs('b1', mixed)).flatMap(w => w.dropOffs.map(d => d.id));
    expect(ids).not.toContain('other');
  });
});

describe('defaultSettlementWeek — the picker starts on the week you are normally settling', () => {
  it('is the MOST RECENT week that has pending devices', () => {
    const weeks = groupSettleableByWeek([
      drop({ id: 'a', dateDropped: '2026-03-09' }),
      drop({ id: 'b', dateDropped: '2026-03-16' }),
    ]);
    expect(defaultSettlementWeek(weeks)).toBe('2026-03-21');
  });

  it('is empty when nothing is pending', () => {
    expect(defaultSettlementWeek([])).toBe('');
  });

  it('never names a week for undated drop-offs alone — there is no Saturday to name', () => {
    expect(defaultSettlementWeek(groupSettleableByWeek([drop({ dateDropped: '' })]))).toBe('');
  });

  it('ignores the undated bucket when real weeks exist', () => {
    const weeks = groupSettleableByWeek([drop({ id: 'x', dateDropped: '' }), drop({ id: 'y', dateDropped: '2026-03-16' })]);
    expect(defaultSettlementWeek(weeks)).toBe('2026-03-21');
  });
});
