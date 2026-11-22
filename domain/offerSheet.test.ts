import { describe, it, expect } from 'vitest';
import { InventoryItem } from '../types';
import {
  OFFER_SHEET_COLUMNS, OFFER_SHEET_EXCLUDED, OFFER_SHEET_EXCLUDED_NOTE, OFFER_SHEET_SOURCE_FIELDS,
  offerSheetCsv, offerSheetFileName, offerSheetFileNameFor, offerSheetHeaders,
} from './offerSheet';

/**
 * A SHEET YOU CAN ACTUALLY SEND A BUYER.
 *
 * The existing exports write the shop's own columns, so purchase cost, repair
 * cost, where it was bought, the purchase source and the tech's internal notes
 * all go in the file. Emailing that to a wholesale buyer hands over the shop's
 * margin and its sourcing, and there is no taking it back.
 */

const dev = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'd1', kind: 'device', sku: 'FTT-000101', date: '2026-01-01', item: 'iPhone 14 Pro',
  imei: '490154203237518', boughtFrom: 'Kijiji seller — flaky, cash only', purchaseCost: 977.33,
  repairCost: 611.19, soldDate: '', soldTo: '', salePrice: 0,
  notes: 'aftermarket screen, do not mention', deviceType: 'Phone', condition: 'Good',
  storage: '256GB', color: 'Deep Purple', batteryHealth: '89%', targetSalePrice: 1234.56,
  purchaseSource: 'Kijiji', deviceStatus: 'ready', ...p,
});

const LAPTOP = dev({
  id: 'l1', sku: 'FTT-000201', item: 'Dell XPS 15', deviceType: 'Laptop', imei: 'C02XK1ABCDEF',
  storage: '1TB', storageType: 'SSD', cpu: 'i7-12700H', ram: '32GB', screenSize: '15.6',
  color: 'Silver', batteryHealth: '', condition: 'Fair',
});

const headerLine = (csv: string) => csv.split('\n')[0];
const rowsOf = (csv: string) => csv.split('\n').slice(1);

/* ======================================================================== *
 * WHAT IT MUST NOT CARRY
 * ======================================================================== */

describe('the costs and the sourcing are not in the file', () => {
  const csv = offerSheetCsv([dev()]);

  it('no purchase cost, repair cost, bought-from, purchase source or internal notes', () => {
    expect(csv).not.toContain('977.33');
    expect(csv).not.toContain('611.19');
    expect(csv).not.toContain('Kijiji');
    expect(csv).not.toContain('flaky');
    expect(csv).not.toContain('do not mention');
    for (const k of ['purchaseCost', 'repairCost', 'boughtFrom', 'purchaseSource']) {
      expect(headerLine(csv).toLowerCase()).not.toContain(k.toLowerCase());
    }
    // There IS a Notes header — the buyer's own, and empty. The internal note
    // is simply not what fills it.
    expect(rowsOf(csv)[0].endsWith(',""')).toBe(true);
  });

  it('no price at all — a wholesale offer is one agreed figure, not 30 shelf prices', () => {
    expect(csv).not.toContain('1234.56');
    expect(headerLine(csv)).not.toMatch(/price/i);
  });

  it('is built from an ALLOW-LIST, so a field added to the app later is not in it', () => {
    // The direction matters: removing columns means every new internal field
    // leaks until somebody remembers to exclude it.
    const future = dev({ ...({ secretMarginNote: 'tripled it' } as object) });
    expect(offerSheetCsv([future])).not.toContain('tripled it');
    // And the allow-list is the only thing the columns read.
    expect(OFFER_SHEET_SOURCE_FIELDS).not.toContain('purchaseCost' as never);
    expect(OFFER_SHEET_SOURCE_FIELDS).not.toContain('notes' as never);
  });

  it('the exclusions are stated in words, for the screen to show', () => {
    for (const f of OFFER_SHEET_EXCLUDED) expect(OFFER_SHEET_EXCLUDED_NOTE).toContain(f);
  });
});

/* ======================================================================== *
 * WHAT IT DOES CARRY
 * ======================================================================== */

describe('identity and condition, which is what a buyer needs', () => {
  it('a phone', () => {
    const csv = offerSheetCsv([dev()]);
    for (const v of ['FTT-000101', '490154203237518', 'iPhone 14 Pro', 'Phone', '256GB', 'Deep Purple', '89%', 'Good']) {
      expect(csv, v).toContain(v);
    }
  });

  it('a laptop, with its CPU, RAM and screen', () => {
    const csv = offerSheetCsv([LAPTOP]);
    for (const v of ['i7-12700H', '32GB', '15.6', 'Laptop', 'C02XK1ABCDEF']) expect(csv, v).toContain(v);
  });

  it('keeps whatever storage unit the owner typed', () => {
    // Stripping it renders "1TB" as "1" — the same rule the printed label follows.
    expect(offerSheetCsv([LAPTOP])).toContain('1TB SSD');
    expect(offerSheetCsv([dev({ storage: '256GB' })])).toContain('256GB');
  });

  it('blank Grade and Notes columns — the buyer\'s own, so it comes back in shape', () => {
    const h = offerSheetHeaders();
    expect(h).toContain('Grade');
    expect(h[h.length - 1]).toBe('Notes');
    const cells = rowsOf(offerSheetCsv([dev()]))[0].split(',');
    expect(cells[h.indexOf('Grade')]).toBe('""');
    expect(cells[h.indexOf('Notes')]).toBe('""');
  });

  it('one cell per header, on every row', () => {
    const csv = offerSheetCsv([dev(), LAPTOP]);
    const n = headerLine(csv).split(',').length;
    expect(n).toBe(OFFER_SHEET_COLUMNS.length);
    for (const r of rowsOf(csv)) expect(r.split(',')).toHaveLength(n);
  });

  it('quotes everything and escapes a quote, so a comma in a name cannot shift a column', () => {
    const csv = offerSheetCsv([dev({ item: 'iPhone 14, 256GB — "mint"' })]);
    expect(csv).toContain('"iPhone 14, 256GB — ""mint"""');
    expect(rowsOf(csv)).toHaveLength(1);
  });

  it('an empty list is still a readable sheet', () => {
    expect(offerSheetCsv([])).toBe(headerLine(offerSheetCsv([])));
  });
});

/* ======================================================================== *
 * THE FILE NAME
 * ======================================================================== */

describe('the file says what it is', () => {
  it('names itself as the one that is safe to send, and carries the date', () => {
    const n = offerSheetFileName('2026-11-22');
    expect(n).toMatch(/SAFE-TO-SEND/);
    expect(n).toContain('2026-11-22');
    expect(n.endsWith('.csv')).toBe(true);
    // Distinguishable at a glance from "phones_2026-11-22.csv" next to it.
    expect(n).not.toMatch(/^phones|^inventory/);
  });
});

/* ======================================================================== *
 * GRADE AND NOTES, FILLED FROM A SAVED OFFER
 * ======================================================================== */

describe('the buyer\'s columns carry what the owner typed for THIS buyer', () => {
  it('grade and note reach the file', () => {
    const csv = offerSheetCsv([dev({ id: 'x1' })], { x1: { grade: 'A', note: 'boxed with charger' } });
    const h = offerSheetHeaders();
    const cells = rowsOf(csv)[0].split(',');
    expect(cells[h.indexOf('Grade')]).toBe('"A"');
    expect(cells[h.indexOf('Notes')]).toBe('"boxed with charger"');
  });

  it('a comma in the buyer note cannot shift a column', () => {
    const csv = offerSheetCsv([dev({ id: 'x1' })], { x1: { note: 'mint, boxed' } });
    expect(rowsOf(csv)).toHaveLength(1);
    expect(csv).toContain('"mint, boxed"');
    expect(rowsOf(csv)[0].split('","')).toHaveLength(offerSheetHeaders().length);
  });

  it('a row with no annotation is blank exactly as before', () => {
    const csv = offerSheetCsv([dev({ id: 'x1' }), dev({ id: 'x2' })], { x1: { grade: 'A' } });
    const h = offerSheetHeaders();
    expect(rowsOf(csv)[1].split(',')[h.indexOf('Grade')]).toBe('""');
  });

  it('and the plain inventory export, which passes none, is byte-identical to before', () => {
    // The Inventory → "Offer sheet for a buyer" path calls this with one
    // argument; adding the second must not have changed that file at all.
    expect(offerSheetCsv([dev()])).toBe(offerSheetCsv([dev()], undefined));
    expect(offerSheetCsv([dev()], {})).toBe(offerSheetCsv([dev()]));
  });

  it('ANNOTATIONS DO NOT WIDEN THE ALLOW-LIST — the item\'s own fields are still unreachable', () => {
    // The annotation carries only what the owner typed for a buyer to read.
    // Everything else about the row still comes through
    // OFFER_SHEET_SOURCE_FIELDS, so the costs stay out.
    const csv = offerSheetCsv([dev({ id: 'x1' })], { x1: { grade: 'A', note: 'see photos' } });
    for (const leak of ['977.33', '611.19', 'Kijiji', 'do not mention', '1234.56']) {
      expect(csv, leak).not.toContain(leak);
    }
    expect(headerLine(csv)).toBe(headerLine(offerSheetCsv([dev()])));
  });

  it('names the file after the buyer, because several of these share a folder', () => {
    expect(offerSheetFileNameFor('Rashid Wholesale', '2026-11-22'))
      .toBe('offer-sheet-SAFE-TO-SEND_Rashid-Wholesale_2026-11-22.csv');
    // A buyer name of nothing but punctuation falls back rather than producing
    // a file called "offer-sheet-SAFE-TO-SEND__2026-11-22.csv".
    expect(offerSheetFileNameFor('  ???  ', '2026-11-22')).toBe(offerSheetFileName('2026-11-22'));
  });
});
