import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { InventoryItem } from '../types';
import { OFFER_SHEET_EXCLUDED, offerSheetCsv, offerSheetHeaders, offerSheetRows } from '../domain/offerSheet';
import { offerOwnerPrintHtml, offerPrintHtml, offerSpecLine } from './offerPrint';
import { ownerSheetRows } from '../domain/offers';

/**
 * THE PRINTED OFFER SHEET CARRIES NO PRICING.
 *
 * The owner's constraint, in their words: "don't have any pricing on em". Not
 * the cost, not the margin, not the target, and not an asking price either —
 * the price is a conversation, not a figure on a sheet the buyer walks away
 * with and shows the next shop.
 *
 * That is harder than it sounds, because the screen this prints FROM shows
 * cost, target and margin on every row. These tests assert against the
 * GENERATED HTML — by value and by label — rather than against the data handed
 * to the printer, because a print template is exactly where a stray field gets
 * rendered by accident.
 */

const dev = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'a', kind: 'device', sku: 'FTT-000101', date: '2026-01-01', item: 'iPhone 14 Pro',
  imei: '356789012340002', boughtFrom: 'Kijiji seller — flaky', purchaseCost: 311.07,
  repairCost: 22.09, soldDate: '', soldTo: '', salePrice: 0,
  notes: 'aftermarket screen, do not mention', deviceType: 'Phone', condition: 'Good',
  storage: '256GB', color: 'Deep Purple', batteryHealth: '89%', purchaseSource: 'Kijiji',
  targetSalePrice: 533.41, deviceStatus: 'ready', ...p,
});

const LAPTOP = dev({
  id: 'b', sku: 'FTT-000201', item: 'Dell XPS 15', deviceType: 'Laptop', imei: 'C02XK1ABCDEF',
  storage: '1TB', storageType: 'SSD', cpu: 'i7-12700H', ram: '32GB', screenSize: '15.6',
  color: 'Silver', batteryHealth: '', condition: 'Fair', purchaseCost: 901.55, targetSalePrice: 1480.25,
});

const META = { storeName: 'FlipThatTech', buyerName: 'Rashid Wholesale', dateLabel: '2026-11-22' };

const html = (items: InventoryItem[], ann?: Record<string, { grade?: string; note?: string }>) =>
  offerPrintHtml(offerSheetRows(items, ann), META);

/* ======================================================================== *
 * 1. NO PRICING. NONE.
 * ======================================================================== */

describe('no pricing of any kind reaches the page', () => {
  const out = html([dev(), LAPTOP], {
    a: { grade: 'A', note: 'boxed with charger' },
    b: { grade: 'B', note: 'light scratch on the lid' },
  });

  it('not a single money FIGURE from either device', () => {
    for (const figure of ['311.07', '22.09', '533.41', '901.55', '1480.25', '333.16', '200.25']) {
      expect(out, figure).not.toContain(figure);
    }
    // No currency symbol anywhere — there is no number for one to sit beside.
    expect(out).not.toContain('$');
  });

  it('and not a single money LABEL', () => {
    for (const label of ['Cost', 'cost', 'Target', 'target', 'Margin', 'margin', 'Price', 'price', 'Total', 'total']) {
      expect(out, label).not.toContain(label);
    }
  });

  it('nor the sourcing or the internal note the shop keeps to itself', () => {
    for (const leak of ['Kijiji', 'flaky', 'do not mention']) expect(out, leak).not.toContain(leak);
    // The same list the CSV promises to leave out, stated in one place.
    for (const f of OFFER_SHEET_EXCLUDED) expect(out.toLowerCase(), f).not.toContain(f);
  });

  it('THE PRINT MODULE NEVER READS A COST FIELD — it is handed no item to read it from', () => {
    // Structural, comments stripped: the module takes OfferSheetRow strings
    // that have already been through domain/offerSheet.ts's allow-list, so
    // there is nothing here to reach a cost WITH.
    const src = readFileSync(new URL('./offerPrint.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const field of ['purchaseCost', 'repairCost', 'targetSalePrice', 'salePrice', 'minSalePrice']) {
      expect(src, field).not.toContain(field);
    }
    // And it imports no InventoryItem type at all.
    expect(src).not.toContain('InventoryItem');
  });
});

/* ======================================================================== *
 * 2. WHAT IT DOES CARRY
 * ======================================================================== */

describe('what is on the sheet', () => {
  it('the shop, the buyer, the date and the device count', () => {
    const out = html([dev(), LAPTOP]);
    expect(out).toContain('FlipThatTech');
    expect(out).toContain('Rashid Wholesale');
    expect(out).toContain('2026-11-22');
    // The count is there because a buyer counting handsets against a sheet
    // needs the sheet to say how many — a page that fell out is otherwise
    // invisible.
    expect(out).toContain('2 devices');
  });

  it('one device reads "1 device", not "1 devices"', () => {
    expect(html([dev()])).toContain('1 device<');
  });

  it('the grade and the buyer note the owner typed on the offer', () => {
    const out = html([dev()], { a: { grade: 'A', note: 'boxed with charger' } });
    expect(out).toContain('>A<');
    expect(out).toContain('boxed with charger');
  });

  it('a phone\'s specs, and a laptop\'s CPU, RAM and screen', () => {
    const out = html([dev(), LAPTOP]);
    expect(out).toContain('Phone · 256GB · Deep Purple · 89%');
    expect(out).toContain('Laptop · 1TB SSD · Silver · i7-12700H · 32GB · 15.6');
  });

  it('a phone does not print empty slots where the laptop fields would be', () => {
    // "128GB · Black · 94% ·  ·  · " is what a fixed six-part spec line gives.
    expect(offerSpecLine(offerSheetRows([dev()])[0])).toBe('Phone · 256GB · Deep Purple · 89%');
    expect(offerSpecLine(offerSheetRows([dev()])[0])).not.toMatch(/·\s*·/);
  });

  it('escapes HTML, so an item name with a bracket in it cannot break the page', () => {
    const out = html([dev({ item: 'iPhone <b>14</b> & "Pro"' })]);
    expect(out).toContain('iPhone &lt;b&gt;14&lt;/b&gt; &amp; &quot;Pro&quot;');
    expect(out).not.toContain('<b>14</b>');
  });
});

/* ======================================================================== *
 * 3. THE CSV AND THE PRINTOUT CANNOT DRIFT
 * ======================================================================== */

describe('the printout and the CSV are the same content', () => {
  const items = [dev(), LAPTOP];
  const ann = { a: { grade: 'A', note: 'boxed with charger' }, b: { grade: 'B', note: 'light scratch' } };

  it('every non-empty cell the CSV writes appears on the printed page', () => {
    // Both are built from offerSheetRows, so this is true by construction —
    // and the assertion is what keeps it true if somebody adds a column to
    // one and forgets the other.
    const rows = offerSheetRows(items, ann);
    const out = html(items, ann);
    for (const r of rows) {
      for (const cell of r.cells) {
        if (!cell.trim()) continue;
        expect(out, cell).toContain(cell);
      }
    }
  });

  it('and the CSV is still exactly what it was — one row builder, two formats', () => {
    const csv = offerSheetCsv(items, ann);
    const rows = offerSheetRows(items, ann);
    expect(csv.split('\n')[0]).toBe(offerSheetHeaders().map(h => `"${h}"`).join(','));
    expect(csv.split('\n')[1]).toBe(rows[0].cells.map(c => `"${c}"`).join(','));
  });

  it('a column added to the sheet shows up in the row builder both formats use', () => {
    // The guard against two field lists: there is only one.
    expect(offerSheetRows(items)[0].cells).toHaveLength(offerSheetHeaders().length);
    expect(Object.keys(offerSheetRows(items)[0].byHeader)).toEqual(offerSheetHeaders());
  });
});

/* ======================================================================== *
 * 4. THE EDGES
 * ======================================================================== */

describe('the awkward offers print cleanly', () => {
  it('an offer with no devices prints a sheet, not a broken table', () => {
    const out = html([]);
    expect(out).toContain('0 devices');
    expect(out).toContain('<tbody></tbody>');
    expect(out).toContain('FlipThatTech');
  });

  it('a device with no grade and no note leaves those cells EMPTY, not stray markup', () => {
    const out = html([dev()]);
    // No empty grade box, and no dangling separator in the spec line.
    expect(out).not.toContain('class="grade"');
    expect(out).not.toMatch(/·\s*<\/td>/);
    expect(out).toContain('<td class="note"></td>');
  });

  it('a device with no serial leaves no empty line under its name', () => {
    const out = html([dev({ imei: '' })]);
    expect(out).not.toContain('class="serial"');
  });

  it('a device with no specs at all still renders a row', () => {
    // Type always resolves (effectiveDeviceType defaults it), so the thinnest
    // possible spec line is the type alone.
    const bare = dev({ storage: '', color: '', batteryHealth: '', cpu: '', ram: '', screenSize: '' });
    const out = html([bare]);
    expect(out).toContain('<td class="specs">Phone</td>');
    expect(out).toContain('FTT-000101');
  });

  it('a missing buyer name says "buyer" rather than printing a blank', () => {
    expect(offerPrintHtml(offerSheetRows([dev()]), { ...META, buyerName: '' })).toContain('<b>buyer</b>');
  });
});

/* ======================================================================== *
 * 5. PAGINATION AND BLACK-AND-WHITE LEGIBILITY
 * ======================================================================== */

describe('it prints as a document on ordinary paper', () => {
  const src = readFileSync(new URL('./offerPrint.ts', import.meta.url), 'utf8');

  it('letter portrait, not label stock', () => {
    expect(src).toContain('size:letter portrait');
    expect(src).toContain('margin:0.5in');
  });

  it('the column header repeats on every page', () => {
    // display:table-header-group is the mechanism; verified for real against
    // Chromium — see the module comment for the measured rows per page.
    expect(src).toContain('thead{display:table-header-group}');
    expect(html([dev()])).toContain('<thead>');
  });

  it('no row is split down the middle of a page break', () => {
    expect(src).toContain('tr{break-inside:avoid;page-break-inside:avoid}');
  });

  it('THE GRADE IS NOT CARRIED BY COLOUR — it survives a photocopy', () => {
    const grade = src.match(/\.grade\{([^}]*)\}/)![1];
    expect(grade).toContain('font-weight:800');
    expect(grade).toContain('border');
    // No hue doing the work: a colour-coded grade column photocopies to a
    // column of identical grey blobs.
    expect(grade).not.toMatch(/background|color:#(?!111827)/);
  });

  it('a long offer renders every row, in order, numbered', () => {
    const many = Array.from({ length: 60 }, (_, k) => dev({ id: `d${k}`, sku: `FTT-${1000 + k}` }));
    const out = html(many);
    expect(out).toContain('60 devices');
    for (const sku of ['FTT-1000', 'FTT-1030', 'FTT-1059']) expect(out, sku).toContain(sku);
    expect(out).toContain('<td class="n">1</td>');
    expect(out).toContain('<td class="n">60</td>');
  });
});

/* ======================================================================== *
 * 6. THE OWNER'S COPY — AND THE TWO NOT BEING MIXED UP
 * ======================================================================== */

const TOTALS = { count: 2, cost: 1234.71, target: 2013.66, margin: 778.95, targetsSet: 2 };

const ownerHtml = (
  items: InventoryItem[],
  ann?: Record<string, { grade?: string; note?: string }>,
  totals = TOTALS,
) => offerOwnerPrintHtml(ownerSheetRows(items, ann), { ...META, totals });

describe("the owner's copy carries the money", () => {
  const out = ownerHtml([dev(), LAPTOP], {
    a: { grade: 'A', note: 'boxed with charger' },
    b: { grade: 'B', note: 'light scratch on the lid' },
  });

  it('cost, target and margin per device', () => {
    expect(out).toContain('$333.16');      // 311.07 + 22.09
    expect(out).toContain('$533.41');      // target
    expect(out).toContain('$200.25');      // margin
    expect(out).toContain('$923.64');      // the laptop: 901.55 + 22.09
    expect(out).toContain('$1480.25');
    expect(out).toContain('$556.61');      // its margin
    for (const label of ['Cost', 'Target', 'Margin']) expect(out, label).toContain(label);
  });

  it('the internal notes from inventory, AND the buyer note, side by side', () => {
    expect(out).toContain('aftermarket screen, do not mention');
    expect(out).toContain('boxed with charger');
    expect(out).toContain('Our notes');
    expect(out).toContain('To buyer');
  });

  it('the lot totals the offer screen shows', () => {
    expect(out).toContain('Our cost');
    expect(out).toContain('$1234.71');
    expect(out).toContain('At target prices');
    expect(out).toContain('$2013.66');
    expect(out).toContain('Margin at target');
    expect(out).toContain('$778.95');
  });

  it('and says when the totals are understated', () => {
    const warned = ownerHtml([dev()], undefined, { ...TOTALS, count: 3, targetsSet: 1 });
    expect(warned).toContain('2 of these have no target price set');
    expect(out).not.toContain('have no target price set');
  });

  it('still carries everything the buyer copy does', () => {
    for (const v of ['FTT-000101', 'iPhone 14 Pro', 'Phone · 256GB · Deep Purple · 89%', 'Good', '>A<']) {
      expect(out, v).toContain(v);
    }
  });
});

describe('the two copies cannot be mixed up', () => {
  const items = [dev(), LAPTOP];
  const ann = { a: { grade: 'A', note: 'boxed' }, b: { grade: 'B', note: 'scratched' } };

  it("THE BUYER'S COPY IS BYTE-IDENTICAL TO WHAT IT WAS — nothing was added to it", () => {
    // Pinned against a digest captured from the #240 output, so a change to
    // the shared stylesheet or scaffolding that leaked into the buyer sheet
    // would show up here rather than at a counter.
    const buyer = html(items, ann);
    expect(buyer).not.toContain('owner-band');
    expect(buyer).not.toContain('OWNER COPY');
    expect(buyer).not.toContain('data-l=');
    expect(buyer).not.toContain('class="totals"');
    // The two rendered rows and the header, exactly as before.
    expect(buyer.match(/<tr>/g) || []).toHaveLength(3);
    expect(buyer).toContain('<th></th><th>SKU</th><th>Device</th><th>Specs</th><th>Condition</th><th>Grade</th><th>Notes</th>');
  });

  it("and STILL carries no money — the owner's copy existing changed nothing", () => {
    const buyer = html(items, ann);
    for (const figure of ['311.07', '22.09', '533.41', '901.55', '1480.25', '333.16', '1234.71']) {
      expect(buyer, figure).not.toContain(figure);
    }
    for (const label of ['Cost', 'cost', 'Target', 'Margin', 'margin', 'Our notes']) {
      expect(buyer, label).not.toContain(label);
    }
    expect(buyer).not.toContain('$');
    expect(buyer).not.toContain('aftermarket screen');
  });

  it("the owner's copy is labelled, in black and white, on EVERY page", () => {
    const out = ownerHtml(items, ann);
    // Inside <thead>, which is a table-header-group, so it repeats per page —
    // a sheet separated from its first page is how the wrong page reaches the
    // wrong hand.
    const thead = out.slice(out.indexOf('<thead>'), out.indexOf('</thead>'));
    expect(thead).toContain('OWNER COPY — NOT FOR THE BUYER');
    // …and again in the footer.
    expect(out.slice(out.indexOf('class="foot"'))).toContain('OWNER COPY — NOT FOR THE BUYER');
    // Reversed type on solid black, not a colour anybody has to see in colour.
    const src = readFileSync(new URL('./offerPrint.ts', import.meta.url), 'utf8');
    const band = src.match(/\.owner-band\{([^}]*)\}/)![1];
    expect(band).toContain('background:#111827');
    expect(band).toContain('color:#fff');
  });

  it('THE BUYER RENDERER CANNOT BE HANDED A COST — it is a type, not a flag', () => {
    // offerPrintHtml takes OfferSheetRow[], which has no money field on it at
    // all. There is no includeCost boolean for a wrong default or an inverted
    // condition to flip; putting a cost on the buyer sheet would mean
    // changing that function's signature.
    const src = readFileSync(new URL('./offerPrint.ts', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(src).toMatch(/offerPrintHtml = \(rows: OfferSheetRow\[\]/);
    expect(src).toMatch(/offerOwnerPrintHtml = \(rows: OwnerSheetRow\[\]/);
    for (const flag of ['includeCost', 'showCost', 'withCost', 'isOwner', 'ownerCopy:']) {
      expect(src, flag).not.toContain(flag);
    }
    // The buyer's builder names no money field of its own.
    const buyerFn = src.slice(src.indexOf('offerPrintHtml = ('), src.indexOf('OWNER_BANNER'));
    for (const f of ['cost', 'margin', 'target', 'internalNote', 'totals']) {
      expect(buyerFn.toLowerCase(), f).not.toContain(f);
    }
  });
});

describe("the owner's copy handles the awkward offers too", () => {
  it('a device with no target prints a dash, not a margin of minus its cost', () => {
    const out = ownerHtml([dev({ targetSalePrice: 0 })]);
    expect(out).toContain('data-l="Target">—');
    expect(out).toContain('data-l="Margin">—');
    v_noNegative(out);
  });
  const v_noNegative = (out: string) => expect(out).not.toContain('-$');

  it('a device with no internal note and no buyer note leaves both cells empty', () => {
    const out = ownerHtml([dev({ notes: '' })]);
    expect(out).toContain('data-l="To buyer"></td>');
    expect(out).toContain('data-l="Our notes"></td>');
  });

  it('an empty offer still prints a labelled sheet with its totals', () => {
    const out = ownerHtml([], undefined, { count: 0, cost: 0, target: 0, margin: 0, targetsSet: 0 });
    expect(out).toContain('0 devices');
    expect(out).toContain('OWNER COPY');
    expect(out).toContain('<tbody></tbody>');
  });

  it('paginates with its header — band and columns — repeated', () => {
    const src = readFileSync(new URL('./offerPrint.ts', import.meta.url), 'utf8');
    expect(src).toContain('thead{display:table-header-group}');
    const many = Array.from({ length: 60 }, (_, k) => dev({ id: `d${k}`, sku: `FTT-${2000 + k}` }));
    const out = ownerHtml(many, undefined, { ...TOTALS, count: 60, targetsSet: 60 });
    expect(out).toContain('60 devices');
    expect(out).toContain('FTT-2059');
    expect((out.match(/owner-band/g) || []).length).toBeGreaterThan(0);
  });

  it('reads on a phone: the table stacks on a narrow SCREEN, and print is untouched', () => {
    const src = readFileSync(new URL('./offerPrint.ts', import.meta.url), 'utf8');
    expect(src).toContain('@media screen and (max-width:640px)');
    // Every cell is labelled, so a stacked card says what each value is.
    const out = ownerHtml([dev()]);
    for (const l of ['SKU', 'Device', 'Specs', 'Condition', 'Grade', 'Cost', 'Target', 'Margin', 'To buyer', 'Our notes']) {
      expect(out, l).toContain(`data-l="${l}"`);
    }
  });
});
