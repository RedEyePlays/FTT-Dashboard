import { describe, it, expect } from 'vitest';
import { InventoryItem } from '../types';
import {
  BATCH_FLAG_NOTE, MAX_BATCH_PASTE, batchFlagOf, batchFlagged, batchIds,
  batchPasteTooLargeMessage, describeBatch, identifierMatches, parseIdentifierList,
  resolveBatch, skuSpellings,
} from './batchSelection';

/**
 * BUILDING A BATCH WITHOUT TICKING THIRTY BOXES.
 *
 * The wholesale case: the buyer names thirty devices as a pasted column or a
 * pile of scans, and the screen's own selection was wiped by every search,
 * tab, filter and sort change — so the fast way to find them was the way that
 * destroyed the batch.
 */

const dev = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'FTT-000101', date: '2026-01-01', item: 'iPhone 14',
  imei: '490154203237518', boughtFrom: 'OfferUp', purchaseCost: 300, repairCost: 20,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceType: 'Phone',
  condition: 'Good', deviceStatus: 'ready', ...p,
});

const INV: InventoryItem[] = [
  dev({ id: 'a', sku: 'FTT-000101', imei: '490154203237518' }),
  dev({ id: 'b', sku: 'FTT-000102', imei: '356789012340002' }),
  dev({ id: 'c', sku: 'FTT-000103', imei: '', item: 'No IMEI' }),
  dev({ id: 'd', sku: 'FTT-000104', imei: '', item: 'Sold one', soldDate: '2026-03-03', deviceStatus: 'sold' }),
  dev({ id: 'e', sku: 'FTT-000105', imei: '', item: 'Reserved one', deviceStatus: 'reserved' }),
  dev({ id: 'f', sku: 'FTT-000106', imei: '', item: 'Moving', inTransferId: 'tr1' }),
  dev({ id: 'g', kind: 'accessory', sku: 'FTT-000107', imei: '', item: 'Case', manufacturerBarcode: '012345678905' }),
];

/* ======================================================================== *
 * PARSING WHATEVER GOT PASTED
 * ======================================================================== */

describe('a pasted list parses whatever shape it arrives in', () => {
  it('newlines, commas, spaces and semicolons', () => {
    expect(parseIdentifierList('FTT-1\nFTT-2')).toEqual(['FTT-1', 'FTT-2']);
    expect(parseIdentifierList('FTT-1, FTT-2, FTT-3')).toEqual(['FTT-1', 'FTT-2', 'FTT-3']);
    expect(parseIdentifierList('FTT-1 FTT-2')).toEqual(['FTT-1', 'FTT-2']);
    expect(parseIdentifierList('FTT-1; FTT-2 | FTT-3 / FTT-4')).toEqual(['FTT-1', 'FTT-2', 'FTT-3', 'FTT-4']);
  });

  it('blank lines, stray quotes and a spreadsheet copy', () => {
    // What a column copied out of Google Sheets actually looks like.
    expect(parseIdentifierList('"FTT-1"\n\n"FTT-2"\n')).toEqual(['FTT-1', 'FTT-2']);
    expect(parseIdentifierList("  FTT-1  \n\t FTT-2,\n")).toEqual(['FTT-1', 'FTT-2']);
    expect(parseIdentifierList('FTT-1 FTT-2')).toEqual(['FTT-1', 'FTT-2']);
  });

  it('keeps a GROUPED IMEI whole instead of shredding it', () => {
    // "35 123456 789012 3" is how it is printed on the box.
    expect(parseIdentifierList('35 678901 234000 2')).toEqual(['356789012340002']);
    expect(parseIdentifierList('490154 203237 518\nFTT-9')).toEqual(['490154203237518', 'FTT-9']);
  });

  it('…but two whole IMEIs on one line stay two', () => {
    expect(parseIdentifierList('490154203237518 356789012340002'))
      .toEqual(['490154203237518', '356789012340002']);
  });

  it('puts a prefix back on when a space split it off', () => {
    expect(parseIdentifierList('FTT 000101')).toEqual(['FTT-000101']);
    expect(parseIdentifierList('FTT 000101\nFTT 000102')).toEqual(['FTT-000101', 'FTT-000102']);
  });

  it('collapses the same identifier spelled two ways', () => {
    expect(parseIdentifierList('FTT-000101\nftt000101\nFTT 000101')).toEqual(['FTT-000101']);
  });

  it('nothing in, nothing out', () => {
    expect(parseIdentifierList('')).toEqual([]);
    expect(parseIdentifierList('   \n\n , ; \n')).toEqual([]);
  });
});

/* ======================================================================== *
 * MATCHING — THE APP'S EXISTING COMPARISON, PLUS THE PREFIX
 * ======================================================================== */

describe('an identifier finds the item it names', () => {
  it('a SKU however the spreadsheet spelled it', () => {
    for (const t of ['FTT-000101', 'ftt-000101', 'FTT 000101', 'ftt000101']) {
      expect(identifierMatches(INV, t).map(i => i.id), t).toEqual(['a']);
    }
  });

  it('WITHOUT the prefix — which is what the printed label shows', () => {
    // services/labelLayout.ts's shortLabelSku drops the prefix on the tag, so
    // a list typed from shelf tags carries the short form.
    expect(identifierMatches(INV, '000101').map(i => i.id)).toEqual(['a']);
    expect(skuSpellings('000101')).toEqual(['000101', 'FTT-000101']);
    expect(skuSpellings('FTT-000101')).toEqual(['FTT-000101']); // never rewritten
  });

  it('an IMEI, grouped or not', () => {
    expect(identifierMatches(INV, '356789012340002').map(i => i.id)).toEqual(['b']);
    expect(identifierMatches(INV, '35 678901 234000 2').map(i => i.id)).toEqual(['b']);
  });

  it("an accessory's manufacturer barcode", () => {
    expect(identifierMatches(INV, '012345678905').map(i => i.id)).toEqual(['g']);
  });

  it('nothing at all, when nothing matches', () => {
    expect(identifierMatches(INV, 'FTT-999999')).toEqual([]);
    expect(identifierMatches(INV, '')).toEqual([]);
  });
});

/* ======================================================================== *
 * THE RESOLUTION — EVERY IDENTIFIER ACCOUNTED FOR
 * ======================================================================== */

describe('resolving a paste reports everything before anything is acted on', () => {
  const paste = 'FTT-000101\n000102\nFTT-999999\n35 678901 234000 2';

  it('matches, and the duplicate IMEI of an already-matched item is one identifier', () => {
    const r = resolveBatch(INV, paste);
    expect(r.matched.map(m => m.item.id)).toEqual(['a', 'b', 'b']);
    expect(r.unmatched).toEqual(['FTT-999999']);
  });

  it('EVERY identifier lands in exactly one bucket', () => {
    // So the count on screen cannot disagree with what gets selected.
    const r = resolveBatch(INV, paste);
    expect(r.matched.length + r.unmatched.length + r.ambiguous.length).toBe(r.identifiers.length);
  });

  it('reports what did not match, by identifier', () => {
    const r = resolveBatch(INV, 'FTT-000101\nNOPE-1\nNOPE-2');
    expect(r.unmatched).toEqual(['NOPE-1', 'NOPE-2']);
    expect(describeBatch(r)).toBe('1 found · 2 not found');
  });

  it('an identifier naming two items is ambiguous, not a coin toss', () => {
    const dupes = [dev({ id: 'x', sku: 'FTT-DUP' }), dev({ id: 'y', sku: 'FTT-DUP' })];
    const r = resolveBatch(dupes, 'FTT-DUP');
    expect(r.matched).toEqual([]);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].items.map(i => i.id)).toEqual(['x', 'y']);
    expect(batchIds(r)).toEqual([]);   // nothing selected for it
    expect(describeBatch(r)).toBe('0 found · 1 ambiguous');
  });

  it('ids are what the selection gets', () => {
    expect(batchIds(resolveBatch(INV, 'FTT-000101, FTT-000103'))).toEqual(['a', 'c']);
  });
});

/* ======================================================================== *
 * WHAT HAPPENS TO A SOLD, RESERVED OR IN-TRANSIT MATCH
 * ======================================================================== */

describe('a match that is worth mentioning is mentioned, not dropped', () => {
  it('is still selected — the owner decides, as everywhere else on this screen', () => {
    const r = resolveBatch(INV, 'FTT-000104\nFTT-000105\nFTT-000106\nFTT-000107');
    expect(batchIds(r)).toEqual(['d', 'e', 'f', 'g']);
  });

  it('…and each one is named with its reason', () => {
    const r = resolveBatch(INV, 'FTT-000103\nFTT-000104\nFTT-000105\nFTT-000106\nFTT-000107');
    expect(batchFlagged(r).map(m => m.flag)).toEqual(['sold', 'reserved', 'in-transit', 'accessory']);
    // The unremarkable one is NOT in the list.
    expect(batchFlagged(r).map(m => m.item.id)).not.toContain('c');
    for (const m of batchFlagged(r)) expect(BATCH_FLAG_NOTE[m.flag!]).toBeTruthy();
  });

  it('flags each state exactly once, sold first', () => {
    expect(batchFlagOf(dev({ soldDate: '2026-01-01' }))).toBe('sold');
    expect(batchFlagOf(dev({ deviceStatus: 'sold' }))).toBe('sold');
    // Sold wins over in-transit: a sold device is not the shop's to move.
    expect(batchFlagOf(dev({ soldDate: '2026-01-01', inTransferId: 't' }))).toBe('sold');
    expect(batchFlagOf(dev({ inTransferId: 't' }))).toBe('in-transit');
    expect(batchFlagOf(dev({ deviceStatus: 'reserved' }))).toBe('reserved');
    expect(batchFlagOf(dev({ deviceStatus: 'pending_repair' }))).toBe('pending-repair');
    expect(batchFlagOf(dev({ deviceStatus: 'pending_purchase' }))).toBe('pending-purchase');
    expect(batchFlagOf(dev({ kind: 'accessory' }))).toBe('accessory');
    expect(batchFlagOf(dev())).toBe(null);
  });
});

/* ======================================================================== *
 * THE CEILING
 * ======================================================================== */

describe('one paste has a ceiling, and says so', () => {
  it('names the limit and what to do instead', () => {
    const msg = batchPasteTooLargeMessage(900);
    expect(msg).toContain('900');
    expect(msg).toContain(String(MAX_BATCH_PASTE));
    expect(msg).toMatch(/parts/);
  });
});
