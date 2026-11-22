import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { InventoryItem, Offer, OfferLine } from '../types';
import {
  LIVE_STATES, OFFER_LINE_STATE_LABEL, OFFER_PROGRESS_LABEL, addLines, commitmentWarning,
  committedCounts, markSentToSale, newOffer, offerAnnotations, offerCounts, offerItemsIn,
  offerLineState, offerLineViews, offerProgress, offerTotals, patchLine, removeLine, sheetIsStale,
  OFFER_ACCESSORY_NOTE, splitOfferable,
} from './offers';

/**
 * AN OFFER IS A SAVED RECORD THAT HOLDS NO MONEY.
 *
 * The batch built in PR #238 was a transient selection: no record of what was
 * quoted to whom, nothing saying a device was already out on a quote, and the
 * grade and note for the buyer living in a spreadsheet on somebody's desktop.
 *
 * The constraint that shapes every test below: an offer stores no price, no
 * revenue and no sold flag. Whether a quoted device sold is READ BACK from
 * inventory, because the only thing allowed to record a sale is a real
 * `salesTransaction` written by the ordinary checkout.
 */

const dev = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'FTT-000101', date: '2026-01-01', item: 'iPhone 14',
  imei: '', boughtFrom: '', purchaseCost: 300, repairCost: 20, soldDate: '', soldTo: '',
  salePrice: 0, notes: '', deviceType: 'Phone', condition: 'Good', deviceStatus: 'ready',
  targetSalePrice: 500, ...p,
});

const line = (itemId: string, p: Partial<OfferLine> = {}): OfferLine =>
  ({ itemId, outcome: 'pending', ...p });

const offer = (p: Partial<Offer> = {}): Offer => ({
  id: 'o1', buyerName: 'Rashid', date: '2026-11-20', status: 'open', lines: [],
  createdAt: 1000, ...p,
});

const SOLD = { soldDate: '2026-11-21', deviceStatus: 'sold' as const, salePrice: 420 };

/* ======================================================================== *
 * 1. NOTHING IN THE OFFER PATH RECORDS MONEY
 * ======================================================================== */

describe('an offer records no money, structurally', () => {
  // CODE ONLY. The comments in that module discuss revenue and sold flags at
  // length — explaining why it writes neither is the point of them — so a scan
  // that included them could only ever be a scan of the prose.
  const src = readFileSync(new URL('./offers.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('the module never assigns a sold flag, a sale date or a price', () => {
    // Not a style check — this is the one invariant that makes the feature
    // safe. Revenue written anywhere but salesTransactions never reaches the
    // P&L, the drawer or the dashboard.
    for (const forbidden of [
      /soldDate\s*:/, /salePrice\s*:/, /deviceStatus\s*:/, /soldTo\s*:/,
      /\brevenue\b/, /agreedPrice/, /lotPrice/,
    ]) {
      expect(src, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it('no edit this module performs puts a money field on an offer or a line', () => {
    const base = offer({ lines: [line('a')] });
    const edits: Offer[] = [
      addLines(base, ['b'], 2000),
      removeLine(base, 'a', 2000),
      patchLine(base, 'a', { grade: 'A', note: 'mint', outcome: 'declined' }, 2000),
      markSentToSale(base, ['a'], 2000),
      newOffer('o2', 'Buyer', '2026-11-22', 2000),
    ];
    const MONEY = ['salePrice', 'soldDate', 'soldTo', 'deviceStatus', 'price', 'total', 'revenue', 'amount'];
    for (const e of edits) {
      for (const k of Object.keys(e)) expect(MONEY, `offer.${k}`).not.toContain(k);
      for (const l of e.lines) for (const k of Object.keys(l)) expect(MONEY, `line.${k}`).not.toContain(k);
    }
  });

  it('"sold" is not even a value a line can be SET to', () => {
    // The outcome type has two values, and sold is not one of them: a sale is
    // read back from inventory, never asserted here.
    const o = patchLine(offer({ lines: [line('a')] }), 'a', { outcome: 'declined' }, 2000);
    expect(o.lines[0].outcome).toBe('declined');
    expect(['pending', 'declined']).toContain(o.lines[0].outcome);
  });
});

/* ======================================================================== *
 * 2. ONE LINE'S STATE, DERIVED
 * ======================================================================== */

describe('whether the buyer took it is derived, not stored', () => {
  it('quoted and unanswered', () => {
    expect(offerLineState(line('a'), dev())).toBe('pending');
  });

  it('pushed to the till from this offer, not rung through yet', () => {
    expect(offerLineState(line('a', { sentToSaleAt: 5 }), dev())).toBe('at-till');
  });

  it('SOLD: pushed from this offer, and the device is now sold', () => {
    expect(offerLineState(line('a', { sentToSaleAt: 5 }), dev(SOLD))).toBe('sold');
  });

  it('SOLD ELSEWHERE: sold over the counter while the quote was out', () => {
    // The whole reason the feature exists. It must not read as the buyer's
    // purchase.
    expect(offerLineState(line('a'), dev(SOLD))).toBe('sold-elsewhere');
    expect(OFFER_LINE_STATE_LABEL['sold-elsewhere']).toMatch(/not to this buyer/);
  });

  it('declined stays declined whatever later happens to the device', () => {
    // The buyer's answer is a fact about the OFFER.
    expect(offerLineState(line('a', { outcome: 'declined' }), dev())).toBe('declined');
    expect(offerLineState(line('a', { outcome: 'declined' }), dev(SOLD))).toBe('declined');
  });

  it('a deleted device is "gone", not a crash and not a silent drop', () => {
    expect(offerLineState(line('a'), undefined)).toBe('gone');
    const views = offerLineViews(offer({ lines: [line('a')] }), []);
    expect(views).toHaveLength(1);
    expect(views[0].state).toBe('gone');
  });

  it('every state has something to say on screen', () => {
    for (const label of Object.values(OFFER_LINE_STATE_LABEL)) expect(label).toBeTruthy();
  });
});

/* ======================================================================== *
 * 3. THE OFFER'S PROGRESS
 * ======================================================================== */

describe("the offer's own status", () => {
  const INV = [dev({ id: 'a' }), dev({ id: 'b' }), dev({ id: 'c' })];

  it('open with nothing resolved', () => {
    expect(offerProgress(offer({ lines: [line('a'), line('b')] }), INV)).toBe('open');
  });

  it('A PART-SALE LEAVES IT OPEN AND PART-SOLD — it does not auto-close', () => {
    // Six of ten taken and four still being thought about is the normal case,
    // not a finished one.
    const inv = [dev({ id: 'a', ...SOLD }), dev({ id: 'b' })];
    const o = offer({ lines: [line('a', { sentToSaleAt: 5 }), line('b')] });
    expect(offerProgress(o, inv)).toBe('part-sold');
    expect(o.status).toBe('open');
  });

  it('sold once nothing is pending', () => {
    const inv = [dev({ id: 'a', ...SOLD }), dev({ id: 'b' })];
    const o = offer({ lines: [line('a', { sentToSaleAt: 5 }), line('b', { outcome: 'declined' })] });
    expect(offerProgress(o, inv)).toBe('sold');
  });

  it('declined when the buyer passed on all of it', () => {
    const o = offer({ lines: [line('a', { outcome: 'declined' }), line('b', { outcome: 'declined' })] });
    expect(offerProgress(o, INV)).toBe('declined');
  });

  it('closed is the owner\'s decision and overrides everything', () => {
    const o = offer({ status: 'closed', lines: [line('a'), line('b')] });
    expect(offerProgress(o, INV)).toBe('closed');
  });

  it('an offer with no devices behaves sanely', () => {
    expect(offerProgress(offer(), INV)).toBe('empty');
    expect(offerCounts(offer(), INV)).toMatchObject({ total: 0, pending: 0, sold: 0 });
    expect(offerTotals(offerItemsIn(offer(), INV, LIVE_STATES))).toMatchObject({ count: 0, cost: 0, target: 0, margin: 0 });
  });

  it('an offer whose devices have ALL since sold elsewhere behaves sanely', () => {
    const inv = [dev({ id: 'a', ...SOLD }), dev({ id: 'b', ...SOLD })];
    const o = offer({ lines: [line('a'), line('b')] });
    // Nothing pending and nothing sold to THIS buyer: still the owner's to close.
    expect(offerProgress(o, inv)).toBe('open');
    expect(offerCounts(o, inv)).toMatchObject({ soldElsewhere: 2, sold: 0, pending: 0 });
  });

  it('counts add up to the line count, always', () => {
    const inv = [dev({ id: 'a', ...SOLD }), dev({ id: 'b', ...SOLD }), dev({ id: 'c' })];
    const o = offer({ lines: [line('a', { sentToSaleAt: 1 }), line('b'), line('c'), line('gone-1')] });
    const c = offerCounts(o, inv);
    expect(c.pending + c.sold + c.declined + c.soldElsewhere + c.gone).toBe(c.total);
    expect(c.total).toBe(4);
  });

  it('every progress value has a label', () => {
    for (const label of Object.values(OFFER_PROGRESS_LABEL)) expect(label).toBeTruthy();
  });
});

/* ======================================================================== *
 * 4. THE DOUBLE-SELL PROBLEM
 * ======================================================================== */

describe('what is out on a quote is a COUNT, not a flag', () => {
  const INV = [dev({ id: 'a' }), dev({ id: 'b' })];

  it('one open offer commits its pending devices', () => {
    const c = committedCounts([offer({ lines: [line('a')] })], INV);
    expect(c.get('a')).toMatchObject({ count: 1, buyers: ['Rashid'] });
    expect(c.has('b')).toBe(false);
  });

  it('TWO BUYERS CAN BE QUOTED THE SAME PHONE — that is how you find out who wants it', () => {
    const c = committedCounts([
      offer({ id: 'o1', buyerName: 'Rashid', lines: [line('a')] }),
      offer({ id: 'o2', buyerName: 'Mo', lines: [line('a'), line('b')] }),
    ], INV);
    expect(c.get('a')).toMatchObject({ count: 2, buyers: ['Rashid', 'Mo'], offerIds: ['o1', 'o2'] });
    expect(c.get('b')!.count).toBe(1);
    expect(commitmentWarning(c.get('a')!)).toBe('out on 2 open offers (Rashid, Mo)');
    expect(commitmentWarning(c.get('b')!)).toBe('out on an open offer to Mo');
  });

  it('a CLOSED offer commits nothing', () => {
    expect(committedCounts([offer({ status: 'closed', lines: [line('a')] })], INV).size).toBe(0);
  });

  it('a declined line commits nothing — the device is free again at once', () => {
    expect(committedCounts([offer({ lines: [line('a', { outcome: 'declined' })] })], INV).size).toBe(0);
  });

  it('an already-sold line commits nothing', () => {
    const inv = [dev({ id: 'a', ...SOLD })];
    expect(committedCounts([offer({ lines: [line('a', { sentToSaleAt: 1 })] })], inv).size).toBe(0);
  });

  it('a line at the till is STILL committed — it is mid-checkout', () => {
    expect(committedCounts([offer({ lines: [line('a', { sentToSaleAt: 1 })] })], INV).get('a')!.count).toBe(1);
  });

  it('an unnamed buyer still produces a usable warning', () => {
    const c = committedCounts([offer({ buyerName: '', lines: [line('a')] })], INV);
    expect(commitmentWarning(c.get('a')!)).toMatch(/unnamed buyer/);
  });
});

/* ======================================================================== *
 * 5. THE OWNER'S FIGURES
 * ======================================================================== */

describe("the owner's cost, target and margin", () => {
  it('cost is purchase plus repair; target goes through targetTotalOf', () => {
    const t = offerTotals([
      dev({ purchaseCost: 300, repairCost: 20, targetSalePrice: 500 }),
      dev({ purchaseCost: 100, repairCost: 0, targetSalePrice: 249.99 }),
    ]);
    expect(t).toMatchObject({ count: 2, cost: 420, target: 749.99, margin: 329.99, targetsSet: 2 });
  });

  it('says how many devices actually have a target, so the margin can be read honestly', () => {
    const t = offerTotals([dev({ targetSalePrice: 500 }), dev({ targetSalePrice: 0 })]);
    expect(t.targetsSet).toBe(1);
    expect(t.count).toBe(2);
  });

  it('rounds to cents', () => {
    const t = offerTotals([dev({ purchaseCost: 0.1, repairCost: 0.2, targetSalePrice: 0.3 })]);
    expect(t.cost).toBe(0.3);
    expect(t.margin).toBe(0);
  });

  it('totals only the lines asked for', () => {
    const inv = [dev({ id: 'a', purchaseCost: 100, targetSalePrice: 200, repairCost: 0 }),
      dev({ id: 'b', purchaseCost: 999, targetSalePrice: 9999, repairCost: 0, ...SOLD })];
    const o = offer({ lines: [line('a'), line('b', { outcome: 'declined' })] });
    // The declined one is not part of the lot any more.
    expect(offerTotals(offerItemsIn(o, inv, LIVE_STATES))).toMatchObject({ count: 1, cost: 100, target: 200 });
  });
});

/* ======================================================================== *
 * 6. EDITS
 * ======================================================================== */

describe('editing an offer', () => {
  it('adds devices, skipping any already on it', () => {
    const o = addLines(offer({ lines: [line('a')] }), ['a', 'b', 'b', 'c'], 2000);
    expect(o.lines.map(l => l.itemId)).toEqual(['a', 'b', 'c']);
    expect(o.lines.every(l => l.outcome === 'pending')).toBe(true);
    expect(o.updatedAt).toBe(2000);
  });

  it('adding nothing new changes nothing, timestamp included', () => {
    const before = offer({ lines: [line('a')], updatedAt: 1 });
    expect(addLines(before, ['a'], 2000)).toBe(before);
  });

  it('removes a device', () => {
    expect(removeLine(offer({ lines: [line('a'), line('b')] }), 'a', 2000).lines.map(l => l.itemId)).toEqual(['b']);
  });

  it('grade and note are PER LINE, so one phone can be quoted two ways', () => {
    const o1 = patchLine(offer({ id: 'o1', lines: [line('a')] }), 'a', { grade: 'A', note: 'mint, boxed' }, 2000);
    const o2 = patchLine(offer({ id: 'o2', lines: [line('a')] }), 'a', { grade: 'B', note: 'light scratch' }, 2000);
    expect(o1.lines[0]).toMatchObject({ grade: 'A', note: 'mint, boxed' });
    expect(o2.lines[0]).toMatchObject({ grade: 'B', note: 'light scratch' });
  });

  it('marking lines sent to the till writes a timestamp and nothing else', () => {
    const o = markSentToSale(offer({ lines: [line('a'), line('b')] }), ['a'], 2000);
    expect(o.lines[0]).toEqual({ itemId: 'a', outcome: 'pending', sentToSaleAt: 2000 });
    expect(o.lines[1]).toEqual({ itemId: 'b', outcome: 'pending' });
  });

  it('a declined device can be re-offered — it never left stock', () => {
    const inv = [dev({ id: 'a' })];
    const first = patchLine(offer({ id: 'o1', lines: [line('a')] }), 'a', { outcome: 'declined' }, 2000);
    expect(committedCounts([first], inv).size).toBe(0);
    // Straight into a new offer, with no un-reserving step of any kind.
    const second = addLines(newOffer('o2', 'Mo', '2026-11-22', 3000), ['a'], 3000);
    expect(offerLineState(second.lines[0], inv[0])).toBe('pending');
    expect(committedCounts([first, second], inv).get('a')!.count).toBe(1);
  });

  it('the sheet goes stale when the offer changes after it was sent', () => {
    expect(sheetIsStale(offer({ sentAt: 100, updatedAt: 200 }))).toBe(true);
    expect(sheetIsStale(offer({ sentAt: 200, updatedAt: 100 }))).toBe(false);
    expect(sheetIsStale(offer({ updatedAt: 200 }))).toBe(false);   // never sent
  });

  it('hands the sheet its annotations keyed by item id', () => {
    const o = offer({ lines: [line('a', { grade: 'A', note: 'mint' }), line('b')] });
    expect(offerAnnotations(o)).toEqual({ a: { grade: 'A', note: 'mint' }, b: { grade: undefined, note: undefined } });
  });

  it('a new offer starts open, empty and dated', () => {
    const o = newOffer('o9', '  Rashid  ', '2026-11-22', 5000, 'uid-1');
    expect(o).toMatchObject({ id: 'o9', buyerName: 'Rashid', date: '2026-11-22', status: 'open', lines: [], createdBy: 'uid-1' });
  });
});

/* ======================================================================== *
 * 7. DEVICES ONLY
 * ======================================================================== */

describe('an offer is devices only', () => {
  it('splits the accessories out rather than dropping them', () => {
    const items = [dev({ id: 'a' }), dev({ id: 'c', kind: 'accessory', item: 'USB-C cable' }), dev({ id: 'b' })];
    const s = splitOfferable(items);
    expect(s.offerable.map(i => i.id)).toEqual(['a', 'b']);
    expect(s.notOfferable.map(i => i.id)).toEqual(['c']);
    expect(OFFER_ACCESSORY_NOTE).toMatch(/devices only/);
  });

  it('a row with no `kind` at all is a device, as everywhere else in the app', () => {
    const legacy = { ...dev({ id: 'x' }) } as Partial<InventoryItem>;
    delete legacy.kind;
    expect(splitOfferable([legacy as InventoryItem]).offerable).toHaveLength(1);
  });
});
