import { describe, it, expect } from 'vitest';
import { InventoryItem, PcBuild, Repair, SalesLine, SalesTransaction } from '../types';
import {
  DEFAULT_DEVICE_WARRANTY_DAYS, claimCount, daysLeft, defaultWarrantyDays, isCovered,
  profitAfterWarranty, repeatClaimNote, stampPickupWarranty, stampWarranty,
  warrantyClaimsFor, warrantyClaimsForSale, warrantyCostOf, warrantyCostRows, warrantyCostTotal, warrantyLabel, warrantyLookup,
  warrantyState, warrantyUntil,
} from './warranty';

const line = (p: Partial<SalesLine> = {}): SalesLine => ({
  kind: 'device', name: 'iPhone 13', quantity: 1, unitPrice: 400, ...p,
});

const tx = (p: Partial<SalesTransaction> = {}): SalesTransaction => ({
  id: 't1', date: '2026-03-10', customerName: 'Marcus Webb', customerPhone: '416-555-0100',
  subtotal: 400, tax: 52, platformFee: 0, purchaseCost: 200, repairCost: 0,
  totalCost: 200, totalPaid: 452, netProfit: 200, lines: [line()], ...p,
});

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'FTT-000001', date: '2026-01-01', item: 'iPhone 13',
  imei: '351234567890123', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready', ...p,
});

const repair = (p: Partial<Repair> = {}): Repair => ({
  id: 'r1', repairNumber: 'RPR-0001', type: 'retail', createdAt: 1, date: '2026-05-01',
  issue: 'screen', repairPrice: 0, status: 'completed', ...p,
});

const build = (p: Partial<PcBuild> = {}): PcBuild => ({
  id: 'b1', name: 'Starter Gaming PC', kind: 'shelf', status: 'sold',
  parts: [], labour: [], createdBy: 'u', createdByEmail: 'e',
  createdAt: 1, updatedAt: 1, ...p,
});

describe('the expiry date is LOCAL and inclusive', () => {
  it('counts the day of sale as day one', () => {
    // 90 days from the 1st runs to the 90th day counting that one.
    expect(warrantyUntil('2026-03-01', 90)).toBe('2026-05-29');
    expect(warrantyUntil('2026-03-01', 1)).toBe('2026-03-01');
  });

  it('crosses a month end correctly', () => {
    expect(warrantyUntil('2026-01-31', 1)).toBe('2026-01-31');
    expect(warrantyUntil('2026-01-31', 2)).toBe('2026-02-01');
    expect(warrantyUntil('2026-08-15', 90)).toBe('2026-11-12');
  });

  it('crosses a leap day and a year end', () => {
    expect(warrantyUntil('2028-02-28', 2)).toBe('2028-02-29');   // 2028 is a leap year
    expect(warrantyUntil('2026-12-20', 30)).toBe('2027-01-18');
  });

  it('crosses a DST boundary without slipping a day', () => {
    // North American DST: spring forward 2026-03-08, fall back 2026-11-01.
    // A day-count that went through UTC would land a day out either side.
    expect(warrantyUntil('2026-03-06', 5)).toBe('2026-03-10');
    expect(warrantyUntil('2026-10-30', 5)).toBe('2026-11-03');
    expect(warrantyUntil('2026-03-08', 90)).toBe('2026-06-05');
  });

  it('gives no date for no warranty', () => {
    expect(warrantyUntil('2026-03-01', 0)).toBeNull();
    expect(warrantyUntil('', 90)).toBeNull();
  });
});

describe('covered, expired, or never recorded — three different things', () => {
  it('distinguishes them', () => {
    expect(warrantyState({ warrantyDays: 90, warrantyUntil: '2026-06-01' }, '2026-05-01')).toBe('covered');
    expect(warrantyState({ warrantyDays: 90, warrantyUntil: '2026-06-01' }, '2026-06-02')).toBe('expired');
    // A historical sale is NOT "expired" — it never had one.
    expect(warrantyState({}, '2026-06-02')).toBe('none');
  });

  it('is covered through the LAST day, not up to it', () => {
    expect(isCovered({ warrantyUntil: '2026-06-01' }, '2026-06-01')).toBe(true);
    expect(isCovered({ warrantyUntil: '2026-06-01' }, '2026-06-02')).toBe(false);
    expect(daysLeft({ warrantyUntil: '2026-06-01' }, '2026-06-01')).toBe(1);
    expect(daysLeft({ warrantyUntil: '2026-06-01' }, '2026-05-30')).toBe(3);
    expect(daysLeft({ warrantyUntil: '2026-06-01' }, '2026-06-05')).toBe(0);
  });

  it('says so in words', () => {
    expect(warrantyLabel({ warrantyDays: 90, warrantyUntil: '2026-06-01' }, '2026-05-01'))
      .toBe('90-day warranty — covered until 2026-06-01');
    expect(warrantyLabel({ warrantyDays: 90, warrantyUntil: '2026-06-01' }, '2026-07-01'))
      .toBe('90-day warranty — expired 2026-06-01');
    expect(warrantyLabel({}, '2026-07-01')).toBe('No warranty recorded');
  });
});

describe('stamping at checkout', () => {
  it('gives devices the default and accessories theirs', () => {
    expect(defaultWarrantyDays('device')).toBe(DEFAULT_DEVICE_WARRANTY_DAYS);
    expect(defaultWarrantyDays('accessory')).toBe(0);
    expect(defaultWarrantyDays('device', { deviceWarrantyDays: 30 })).toBe(30);
    expect(defaultWarrantyDays('accessory', { accessoryWarrantyDays: 14 })).toBe(14);
    // A service line carries the REPAIR's warranty; a second one here would be
    // two dates for one job.
    expect(defaultWarrantyDays('service' as never)).toBe(0);
  });

  it('stamps device lines and leaves accessories alone by default', () => {
    const stamped = stampWarranty(
      [line(), line({ kind: 'accessory', name: 'Case' })],
      { soldDateISO: '2026-03-01' },
    );
    expect(stamped[0]).toMatchObject({ warrantyDays: 90, warrantyUntil: '2026-05-29' });
    // ABSENT, not zero — absent is what a historical sale looks like.
    expect('warrantyDays' in stamped[1]).toBe(false);
    expect('warrantyUntil' in stamped[1]).toBe(false);
  });

  it('takes a PER-LINE override, and "no warranty" is distinguishable from "not asked"', () => {
    const stamped = stampWarranty(
      [line(), line({ name: 'Pixel' }), line({ name: 'Watch' })],
      { soldDateISO: '2026-03-01', overrideDays: { 0: 180, 1: null } },
    );
    expect(stamped[0].warrantyUntil).toBe('2026-08-27');
    expect(stamped[0].warrantyDays).toBe(180);
    // An explicit "No warranty" leaves nothing behind.
    expect('warrantyUntil' in stamped[1]).toBe(false);
    // ...and the untouched line still gets the default.
    expect(stamped[2].warrantyDays).toBe(90);
  });

  it('leaves historical lines untouched — nothing is retro-fitted', () => {
    const old = line({ name: 'Old sale' });
    expect(warrantyState(old)).toBe('none');
    expect(warrantyLabel(old)).toBe('No warranty recorded');
  });
});

describe("a customer build's warranty starts at PICKUP, not at the deposit", () => {
  it('marks the line at deposit without dating it', () => {
    const stamped = stampWarranty([line({ name: 'Custom PC' })], {
      soldDateISO: '2026-03-01', startsAtPickup: { 0: true },
    });
    expect(stamped[0].warrantyDays).toBe(90);
    expect(stamped[0].warrantyStartsAtPickup).toBe(true);
    // NOT dated yet — the clock has not started.
    expect(stamped[0].warrantyUntil).toBeUndefined();
    expect(warrantyState(stamped[0], '2026-03-02')).toBe('none');
  });

  it('dates it from the day they collect it', () => {
    const atDeposit = stampWarranty([line({ name: 'Custom PC' })], {
      soldDateISO: '2026-03-01', startsAtPickup: { 0: true },
    });
    const atPickup = stampPickupWarranty(atDeposit, '2026-04-15');
    expect(atPickup[0].warrantyUntil).toBe('2026-07-13');   // 90 days from pickup
    expect(atPickup[0].warrantyDays).toBe(90);
    // The flag is consumed, so a second completion cannot restart the clock.
    expect(atPickup[0].warrantyStartsAtPickup).toBeUndefined();
    expect(stampPickupWarranty(atPickup, '2026-06-01')[0].warrantyUntil).toBe('2026-07-13');
  });

  it('is six weeks longer than it would have been from the deposit', () => {
    const fromDeposit = warrantyUntil('2026-03-01', 90);
    const fromPickup = stampPickupWarranty(
      stampWarranty([line()], { soldDateISO: '2026-03-01', startsAtPickup: { 0: true } }),
      '2026-04-15',
    )[0].warrantyUntil;
    expect(fromPickup! > fromDeposit!).toBe(true);
  });

  it('leaves an ordinary line alone', () => {
    const normal = stampWarranty([line()], { soldDateISO: '2026-03-01' });
    expect(stampPickupWarranty(normal, '2026-04-15')[0].warrantyUntil).toBe('2026-05-29');
  });
});

describe('the lookup, by whatever the customer can tell you', () => {
  const inv = device({ id: 'd1', imei: '351234567890123', sku: 'FTT-000001' });
  const sale = tx({
    id: 'sale-1', date: '2026-03-10',
    lines: [line({ inventoryId: 'd1', name: 'iPhone 13', warrantyDays: 90, warrantyUntil: '2026-06-07' })],
  });
  const data = { sales: [sale], inventory: [inv], repairs: [] };

  it('finds the sale by IMEI, SKU, phone or customer name', () => {
    for (const q of ['351234567890123', 'FTT-000001', '416-555-0100', 'marcus webb', 'iphone 13']) {
      expect({ q, hits: warrantyLookup(q, data, '2026-04-01').length }).toEqual({ q, hits: 1 });
    }
    expect(warrantyLookup('nokia', data, '2026-04-01')).toHaveLength(0);
    expect(warrantyLookup('', data, '2026-04-01')).toHaveLength(0);
  });

  it('reports the sale date, what it was, whether it is covered, and days left', () => {
    const [hit] = warrantyLookup('351234567890123', data, '2026-04-01');
    expect(hit.soldOn).toBe('2026-03-10');
    expect(hit.what).toBe('iPhone 13');
    expect(hit.state).toBe('covered');
    expect(hit.daysLeft).toBe(68);
    expect(hit.claims).toEqual([]);
  });

  it('reports an expired warranty as expired, not as absent', () => {
    expect(warrantyLookup('351234567890123', data, '2026-08-01')[0].state).toBe('expired');
  });

  it('ignores a voided or returned sale — the device came back', () => {
    const voided = { sales: [{ ...sale, status: 'voided' as const }], inventory: [inv], repairs: [] };
    expect(warrantyLookup('351234567890123', voided, '2026-04-01')).toHaveLength(0);
  });

  it('surfaces the warranty repairs already done on it', () => {
    const claim = repair({ id: 'r9', warrantySaleId: 'sale-1', warrantyLineIndex: 0 });
    const hit = warrantyLookup('351234567890123', { ...data, repairs: [claim] }, '2026-04-01')[0];
    expect(hit.claims.map(c => c.id)).toEqual(['r9']);
  });

  it('FINDS A BUILD BY ANY PART SERIAL — the dead-GPU case', () => {
    const pcBuild = build({
      id: 'b9', inventoryId: 'd9',
      parts: [
        { id: 'p1', category: 'GPU', name: 'RTX 4070', cost: 500, condition: 'new', source: 'retail', serial: 'GPU-99X-7734' },
        { id: 'p2', category: 'CPU', name: 'Ryzen 7', cost: 400, condition: 'new', source: 'retail' },
      ],
    });
    const pcDevice = device({ id: 'd9', item: 'Custom PC · Ryzen 7 / RTX 4070', imei: '', sku: 'FTT-000099', pcBuildId: 'b9' });
    const pcSale = tx({
      id: 'sale-pc', date: '2026-03-01', customerName: 'Ali',
      lines: [line({ inventoryId: 'd9', name: 'Custom PC', warrantyDays: 90, warrantyUntil: '2026-05-29' })],
    });
    const pcData = { sales: [pcSale], inventory: [pcDevice], repairs: [], builds: [pcBuild] };

    // The serial off the card, with separators however they were written.
    const [hit] = warrantyLookup('GPU-99X-7734', pcData, '2026-04-01');
    expect(hit).toBeTruthy();
    expect(hit.matchedBuild?.id).toBe('b9');
    expect(hit.matchedPartName).toBe('RTX 4070');
    expect(hit.state).toBe('covered');
    // ...and the same serial without the dashes.
    expect(warrantyLookup('gpu99x7734', pcData, '2026-04-01')).toHaveLength(1);
    // A serial that belongs to nothing finds nothing.
    expect(warrantyLookup('GPU-00000', pcData, '2026-04-01')).toHaveLength(0);
  });
});

describe('repeat claims', () => {
  const claims = [
    repair({ id: 'a', partsCost: 40 }),
    repair({ id: 'b', partsCost: 172 }),
  ];

  it('says nothing until the third', () => {
    expect(repeatClaimNote([], true)).toBeNull();
    expect(repeatClaimNote([claims[0]], true)).toBeNull();
    expect(claimCount(claims)).toBe(2);
  });

  it('states the plain fact on the third', () => {
    expect(repeatClaimNote(claims, false)).toBe('3rd claim on this device.');
  });

  it('shows the dollar figure only with cost access', () => {
    const withCost = repeatClaimNote(claims, true)!;
    expect(withCost).toContain('warranty cost so far $212.00');
    expect(repeatClaimNote(claims, false)).not.toContain('$');
  });
});

describe('warranty cost', () => {
  it('is parts plus labour on the repair, never estimated', () => {
    expect(warrantyCostOf([repair({ partsCost: 40 }), repair({ partsCost: 60 })])).toBe(100);
    // A repair with nothing recorded costs 0 rather than being guessed at.
    expect(warrantyCostOf([repair({})])).toBe(0);
  });

  it('shows profit after warranty work on the sale', () => {
    const after = profitAfterWarranty({ netProfit: 200 }, [repair({ partsCost: 75 })]);
    expect(after).toEqual({ booked: 200, warrantyCost: 75, after: 125 });
  });

  it('gathers a sale\'s claims across ALL of its lines, not one of them', () => {
    // The invoice shows one profit figure, so it must charge itself the work
    // against every line — a two-device sale that came back twice, once per
    // device, is two claims against that one sale.
    const line0 = repair({ id: 'r1', partsCost: 40, warrantySaleId: 'sale-1', warrantyLineIndex: 0 });
    const line1 = repair({ id: 'r2', partsCost: 60, warrantySaleId: 'sale-1', warrantyLineIndex: 1 });
    const other = repair({ id: 'r3', partsCost: 999, warrantySaleId: 'sale-2', warrantyLineIndex: 0 });
    const claims = warrantyClaimsForSale([line0, line1, other], 'sale-1');
    expect(claims.map(r => r.id)).toEqual(['r1', 'r2']);
    expect(profitAfterWarranty({ netProfit: 300 }, claims)).toEqual({ booked: 300, warrantyCost: 100, after: 200 });
    // Per-LINE stays per-line — the two views do not bleed into each other.
    expect(warrantyClaimsFor([line0, line1, other], 'sale-1', 1).map(r => r.id)).toEqual(['r2']);
  });

  it('is dated when the repair was COMPLETED, never backdated into the sale\'s month', () => {
    const sold = new Date('2026-03-10T12:00:00').getTime();
    const fixed = new Date('2026-06-20T12:00:00').getTime();
    const claim = repair({
      id: 'r1', date: '2026-06-01', partsCost: 90,
      isWarrantyClaim: true, warrantySaleId: 'sale-1', completedAt: fixed,
    });
    void sold;

    // March — the month of the sale — shows nothing.
    expect(warrantyCostRows([claim], '2026-03-01', '2026-03-31')).toHaveLength(0);
    // June — the month the work was done — shows it.
    const june = warrantyCostRows([claim], '2026-06-01', '2026-06-30');
    expect(june).toHaveLength(1);
    expect(june[0].completedOn).toBe('2026-06-20');
    expect(warrantyCostTotal(june)).toBe(90);
  });

  it('ignores a repair that is not a warranty claim at all', () => {
    const ordinary = repair({ partsCost: 200, completedAt: new Date('2026-06-20T12:00:00').getTime() });
    expect(warrantyCostRows([ordinary], '2026-06-01', '2026-06-30')).toHaveLength(0);
  });

  it('COUNTS ONCE — the reporting line does not subtract a second time', async () => {
    // The repairs path is authoritative for the money; warrantyCostRows is a
    // reporting view over the same repairs, so a warranty repair's parts cost
    // appears in exactly one subtraction.
    const { profitAndLoss } = await import('./reports');
    const claim = repair({
      id: 'r1', date: '2026-06-01', partsCost: 90, isWarrantyClaim: true,
      warrantySaleId: 'sale-1', completedAt: new Date('2026-06-20T12:00:00').getTime(),
    });
    const pl = profitAndLoss({
      transactions: [], inventory: [], payPeriods: [], cashReconciliations: [],
      settlements: [], expenses: [], expenseCategories: [],
    }, '2026-06-01', '2026-06-30');

    // The P&L's own figures are untouched by the reporting rows.
    expect(pl.netProfit).toBe(0);
    expect(warrantyCostTotal(warrantyCostRows([claim], '2026-06-01', '2026-06-30'))).toBe(90);
  });
});
