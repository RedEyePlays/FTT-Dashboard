import { describe, it, expect } from 'vitest';
import {
  kioskUrl, repairPriceLabel, activeRepairPrices, groupRepairPrices, searchRepairPrices,
  tradeInModels, tradeInConditions, lookupTradeIn, TRADE_IN_CAVEAT,
} from './showroom';
import { RepairPrice, TradeInRange } from './settings';

const rp = (over: Partial<RepairPrice>): RepairPrice =>
  ({ id: 'r1', deviceModel: 'iPhone 13', repairType: 'Screen', price: 189, active: true, ...over });

const tr = (over: Partial<TradeInRange>): TradeInRange =>
  ({ id: 't1', deviceModel: 'iPhone 13', condition: 'Good', lowPrice: 180, highPrice: 220, active: true, ...over });

describe('kioskUrl', () => {
  it('builds the showroom link on the public origin', () => {
    expect(kioskUrl('https://status.flipthat.tech', 'abc')).toBe('https://status.flipthat.tech/showroom/abc');
  });
  it('tolerates a trailing slash on the origin', () => {
    expect(kioskUrl('https://status.flipthat.tech/', 'abc')).toBe('https://status.flipthat.tech/showroom/abc');
  });
});

describe('repairPriceLabel', () => {
  it('shows a flat price plainly', () => {
    expect(repairPriceLabel({ price: 189, fromPrice: false })).toBe('$189.00');
  });
  it('marks a starting price as "from"', () => {
    expect(repairPriceLabel({ price: 189, fromPrice: true })).toBe('from $189.00');
  });
});

describe('activeRepairPrices', () => {
  it('returns [] for nothing stored', () => {
    expect(activeRepairPrices()).toEqual([]);
  });
  it('drops inactive rows', () => {
    const rows = [rp({ id: 'a' }), rp({ id: 'b', active: false })];
    expect(activeRepairPrices(rows).map(r => r.id)).toEqual(['a']);
  });
  it('drops rows with no model or no repair type — a blank line is not a price', () => {
    const rows = [rp({ id: 'a' }), rp({ id: 'b', deviceModel: '  ' }), rp({ id: 'c', repairType: '' })];
    expect(activeRepairPrices(rows).map(r => r.id)).toEqual(['a']);
  });
});

describe('groupRepairPrices', () => {
  it('groups by device, keeping the owner\'s ordering', () => {
    const rows = [
      rp({ id: 'a', deviceModel: 'iPhone 13', repairType: 'Screen' }),
      rp({ id: 'b', deviceModel: 'Pixel 7', repairType: 'Battery' }),
      rp({ id: 'c', deviceModel: 'iPhone 13', repairType: 'Battery' }),
    ];
    const groups = groupRepairPrices(rows);
    expect(groups.map(g => g.deviceModel)).toEqual(['iPhone 13', 'Pixel 7']);
    expect(groups[0].rows.map(r => r.id)).toEqual(['a', 'c']);
  });

  it('treats a differently-cased model as the same device', () => {
    const groups = groupRepairPrices([rp({ id: 'a' }), rp({ id: 'b', deviceModel: 'IPHONE 13' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });
});

describe('searchRepairPrices', () => {
  const rows = [
    rp({ id: 'a', deviceModel: 'iPhone 13', repairType: 'Screen' }),
    rp({ id: 'b', deviceModel: 'iPhone 13 Pro', repairType: 'Battery' }),
    rp({ id: 'c', deviceModel: 'Pixel 7', repairType: 'Screen' }),
  ];
  it('returns every active row for an empty query', () => {
    expect(searchRepairPrices(rows, '  ').map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('matches across model AND repair type (every word must land)', () => {
    expect(searchRepairPrices(rows, 'iphone battery').map(r => r.id)).toEqual(['b']);
  });
  it('matches on the repair type alone', () => {
    expect(searchRepairPrices(rows, 'screen').map(r => r.id)).toEqual(['a', 'c']);
  });
  it('never returns an inactive row, however well it matches', () => {
    expect(searchRepairPrices([rp({ id: 'x', active: false })], 'iphone')).toEqual([]);
  });
});

describe('tradeInModels / tradeInConditions', () => {
  const rows = [
    tr({ id: '1', deviceModel: 'iPhone 13', condition: 'Good' }),
    tr({ id: '2', deviceModel: 'iPhone 13', condition: 'Fair' }),
    tr({ id: '3', deviceModel: 'Pixel 7', condition: 'Good' }),
    tr({ id: '4', deviceModel: 'Pixel 8', condition: 'Good', active: false }),
  ];
  it('lists each active model once, in order', () => {
    expect(tradeInModels(rows)).toEqual(['iPhone 13', 'Pixel 7']);
  });
  it('returns [] when nothing is stored', () => {
    expect(tradeInModels()).toEqual([]);
  });
  it('lists the conditions priced for one model', () => {
    expect(tradeInConditions(rows, 'iPhone 13')).toEqual(['Good', 'Fair']);
    expect(tradeInConditions(rows, 'Pixel 7')).toEqual(['Good']);
    expect(tradeInConditions(rows, 'Nokia 3310')).toEqual([]);
  });
});

describe('lookupTradeIn', () => {
  const rows = [tr({}), tr({ id: 't2', condition: 'Fair', lowPrice: 120, highPrice: 150 })];

  it('finds the range for a model and condition', () => {
    expect(lookupTradeIn(rows, 'iPhone 13', 'Good')).toEqual({ lowPrice: 180, highPrice: 220 });
  });

  it('is case-insensitive on both sides', () => {
    expect(lookupTradeIn(rows, 'iphone 13', 'good')).toEqual({ lowPrice: 180, highPrice: 220 });
  });

  it('returns null for a pairing the shop has not priced — never a guessed number', () => {
    expect(lookupTradeIn(rows, 'iPhone 13', 'New')).toBeNull();
    expect(lookupTradeIn(rows, 'Pixel 7', 'Good')).toBeNull();
    expect(lookupTradeIn(undefined, 'iPhone 13', 'Good')).toBeNull();
  });

  it('puts a reversed range back the right way round', () => {
    const flipped = [tr({ lowPrice: 220, highPrice: 180 })];
    expect(lookupTradeIn(flipped, 'iPhone 13', 'Good')).toEqual({ lowPrice: 180, highPrice: 220 });
  });

  it('ignores an inactive row', () => {
    expect(lookupTradeIn([tr({ active: false })], 'iPhone 13', 'Good')).toBeNull();
  });

  it('rejects a non-numeric or negative range rather than rendering NaN', () => {
    expect(lookupTradeIn([tr({ lowPrice: NaN })], 'iPhone 13', 'Good')).toBeNull();
    expect(lookupTradeIn([tr({ lowPrice: -5 })], 'iPhone 13', 'Good')).toBeNull();
  });
});

describe('TRADE_IN_CAVEAT', () => {
  it('says the offer depends on an inspection, in words a customer reads', () => {
    expect(TRADE_IN_CAVEAT).toMatch(/estimate/i);
    expect(TRADE_IN_CAVEAT).toMatch(/inspection/i);
  });
});
