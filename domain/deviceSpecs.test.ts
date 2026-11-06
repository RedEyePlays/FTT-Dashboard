import { describe, it, expect } from 'vitest';
import { DeviceType, InventoryItem } from '../types';
import {
  InvTab, inventoryTabOf, inTab, tabKind, tabAddsType, tabNeedsTypePicker,
  effectiveDeviceType, isSoldDevice, OTHER_DEVICE_TYPES,
  hasPhoneFields, hasLaptopFields, hasBrandModel, hasCondition, requiresItemName,
  laptopSpecLine, strandedFields, LAPTOP_SPEC_FIELDS,
  laptopPrintSpecs, printsLaptopLayout, storageRamSlot,
  normalizeScreenSize, screenSizeWarning, LAPTOP_SCREEN_MIN_IN, LAPTOP_SCREEN_MAX_IN,
} from './deviceSpecs';
import { INV_SECTIONS } from './inventoryNav';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { floorFor } from './priceFloor';
import { getDeviceDisplayName } from './inventory';
import { modelKeyOf } from './modelKey';

/**
 * LAPTOPS GET THEIR OWN FIELDS, AND INVENTORY GETS TABS.
 *
 * THE REAL PROBLEM was never the missing dropdown — it has always been there.
 * It is that the dropdown DEFAULTS to 'Phone' and the shop stopped choosing,
 * so every laptop in the workspace is filed as a phone. The tabs are the fix:
 * adding from the Laptops tab makes a laptop with nothing to forget.
 *
 * What this pins:
 *
 *  1. every row lands in exactly ONE tab, and nothing can disappear;
 *  2. a laptop's fields are a laptop's fields — no carrier, no battery health,
 *     no Condition, no brand/model;
 *  3. an existing phone-typed row is untouched and still reads as before;
 *  4. a laptop with no brand or model still reads sensibly, and is still
 *     countable by the AI stock count.
 */

const ALL_TYPES: DeviceType[] = ['Phone', 'Tablet', 'Laptop', 'Console', 'Watch', 'Desktop PC', 'Other'];

const item = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'i1', kind: 'device', date: '2026-11-01', item: 'iPhone 14', imei: '', boughtFrom: '',
  purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0, notes: '',
  ...p,
});

/* ---------------- 1. The tabs ---------------- */

describe('every row lands in exactly one tab', () => {
  it('a phone in stock is in Phones; a laptop in Laptops', () => {
    expect(inventoryTabOf(item({ deviceType: 'Phone' }))).toBe('phones');
    expect(inventoryTabOf(item({ deviceType: 'Laptop' }))).toBe('laptops');
  });

  it('OTHER is tablets, watches, consoles and desktop PCs', () => {
    for (const t of OTHER_DEVICE_TYPES) {
      expect({ t, tab: inventoryTabOf(item({ deviceType: t })) }).toEqual({ t, tab: 'other' });
    }
    expect(OTHER_DEVICE_TYPES).toEqual(['Tablet', 'Watch', 'Console', 'Desktop PC', 'Other']);
  });

  it('accessories are their own tab, sold or not', () => {
    expect(inventoryTabOf(item({ kind: 'accessory' }))).toBe('accessories');
    expect(inventoryTabOf(item({ kind: 'accessory', soldDate: '2026-11-01' }))).toBe('accessories');
  });

  it('A SOLD LAPTOP IS IN SOLD AND NOT IN LAPTOPS', () => {
    // The one thing about this layout somebody could lose a device over.
    const sold = item({ deviceType: 'Laptop', soldDate: '2026-11-01' });
    expect(inventoryTabOf(sold)).toBe('sold');
    expect(inTab(sold, 'laptops')).toBe(false);
    expect(inTab(sold, 'sold')).toBe(true);
    // Either way of being sold counts.
    expect(inventoryTabOf(item({ deviceType: 'Laptop', deviceStatus: 'sold' }))).toBe('sold');
  });

  it('AN UNTYPED DEVICE IS IN PHONES — it cannot vanish', () => {
    // Quick Purchase writes no device type at all (domain/quickPurchase.ts)
    // while collecting storage, colour and battery health — a phone intake.
    // Dropping those rows into Other would hide the shop's quick-purchased
    // iPhones somewhere nobody looks.
    expect(inventoryTabOf(item({}))).toBe('phones');
    expect(effectiveDeviceType(item({}))).toBe('Phone');
  });

  it('EVERY type, typed or not, sold or not, lands in exactly one tab', () => {
    // The structural guarantee: a device cannot fall between the tabs.
    const homes: InvTab[] = ['phones', 'laptops', 'accessories', 'other', 'intransit', 'sold'];
    for (const t of [...ALL_TYPES, undefined]) {
      for (const sold of [false, true]) {
        // …and in transit or not, which stage 4 added.
        for (const moving of [false, true]) {
          const row = item({
            deviceType: t,
            soldDate: sold ? '2026-11-01' : '',
            ...(moving ? { inTransferId: 't1' } : {}),
          });
          const hits = homes.filter(tab => inTab(row, tab));
          expect({ t, sold, moving, hits }).toEqual({ t, sold, moving, hits: [inventoryTabOf(row)] });
        }
      }
    }
  });

  it('low stock is a VIEW of accessories, not a home of its own', () => {
    // An accessory that is low appears in both; a device never appears there.
    const acc = item({ kind: 'accessory' });
    expect(inTab(acc, 'accessories')).toBe(true);
    expect(inTab(acc, 'lowstock')).toBe(true);
    expect(inTab(item({ deviceType: 'Phone' }), 'lowstock')).toBe(false);
  });

  it('the tab list is the five the shop asked for, plus Low Stock and In Transit', () => {
    // In Transit arrived with multi-store stage 4: a device being moved
    // between stores is on neither shelf, so it needed a home that is not
    // "sellable stock here" (domain/transfers.ts).
    expect(INV_SECTIONS.map(s => s.id)).toEqual(['phones', 'laptops', 'accessories', 'other', 'intransit', 'sold', 'lowstock']);
  });

  it('is sold the same way the list has always decided it', () => {
    expect(isSoldDevice(item({ soldDate: '2026-11-01' }))).toBe(true);
    expect(isSoldDevice(item({ deviceStatus: 'sold' }))).toBe(true);
    expect(isSoldDevice(item({ deviceStatus: 'reserved' }))).toBe(false);
    expect(isSoldDevice(item({ kind: 'accessory', soldDate: '2026-11-01' }))).toBe(false);
  });
});

describe('ADDING FROM A TAB SETS THE TYPE — the actual fix', () => {
  it('Phones adds a phone, Laptops adds a laptop, with no dropdown to forget', () => {
    expect(tabAddsType('phones')).toBe('Phone');
    expect(tabAddsType('laptops')).toBe('Laptop');
    expect(tabNeedsTypePicker('phones')).toBe(false);
    expect(tabNeedsTypePicker('laptops')).toBe(false);
  });

  it('OTHER STILL ASKS — it covers four kinds', () => {
    expect(tabAddsType('other')).toBeUndefined();
    expect(tabNeedsTypePicker('other')).toBe(true);
  });

  it('nothing is added from Sold', () => {
    expect(tabAddsType('sold')).toBeUndefined();
  });

  it('each tab knows which kind of record it holds', () => {
    expect(tabKind('phones')).toBe('device');
    expect(tabKind('laptops')).toBe('device');
    expect(tabKind('other')).toBe('device');
    expect(tabKind('sold')).toBe('device');
    expect(tabKind('accessories')).toBe('accessory');
    expect(tabKind('lowstock')).toBe('accessory');
  });
});

/* ---------------- 2. A laptop's fields are a laptop's ---------------- */

describe("a laptop's fields", () => {
  it('HAS CPU, RAM, storage, storage type, screen size and GPU', () => {
    expect(hasLaptopFields('Laptop')).toBe(true);
    // `storage` is REUSED, not duplicated — a laptop's capacity is the same
    // field as a phone's.
    expect(LAPTOP_SPEC_FIELDS.map(f => f.key)).toEqual(['cpu', 'ram', 'storage', 'screenSize', 'gpu']);
  });

  it('HAS NO CARRIER AND NO BATTERY HEALTH', () => {
    expect(hasPhoneFields('Laptop')).toBe(false);
  });

  it('HAS NO CONDITION — the owner decided, and the phone form having one is not a reason', () => {
    expect(hasCondition('Laptop')).toBe(false);
  });

  it('HAS NO BRAND OR MODEL — the whole name goes in the item', () => {
    expect(hasBrandModel('Laptop')).toBe(false);
  });

  it('and therefore NEEDS its item name, which nothing else does', () => {
    expect(requiresItemName('Laptop')).toBe(true);
    for (const t of ALL_TYPES.filter(x => x !== 'Laptop')) {
      expect({ t, req: requiresItemName(t) }).toEqual({ t, req: false });
    }
  });

  it('A PHONE IS UNCHANGED — every field it had, it still has', () => {
    expect(hasPhoneFields('Phone')).toBe(true);
    expect(hasCondition('Phone')).toBe(true);
    expect(hasBrandModel('Phone')).toBe(true);
    expect(hasLaptopFields('Phone')).toBe(false);
  });

  it('no type gets both sets of fields', () => {
    // A laptop is not a phone with extra fields, and a phone is not a laptop
    // with missing ones.
    for (const t of ALL_TYPES) {
      expect({ t, both: hasPhoneFields(t) && hasLaptopFields(t) }).toEqual({ t, both: false });
    }
  });

  it('reads the specs as one line, and says nothing when there are none', () => {
    expect(laptopSpecLine({
      cpu: 'i7-1165G7', ram: '16GB', storage: '512GB', storageType: 'SSD', screenSize: '15.6"', gpu: 'RTX 3060',
    })).toBe('i7-1165G7 · 16GB · 512GB SSD · 15.6" · RTX 3060');
    // A blank line of separators reads as missing data; an absent line reads
    // as "not a laptop".
    expect(laptopSpecLine({})).toBe('');
    expect(laptopSpecLine({ cpu: 'i5', storage: '256GB' })).toBe('i5 · 256GB');
  });
});

describe('a retyped row keeps what was typed into it', () => {
  it('names the fields its new type no longer shows, rather than hiding them', () => {
    const wasAPhone = item({ deviceType: 'Laptop', carrier: 'Unlocked', batteryHealth: '92%', condition: 'Good' });
    expect(strandedFields(wasAPhone)).toEqual(['Carrier', 'Battery Health', 'Condition']);
  });

  it('and the other way round', () => {
    const wasALaptop = item({ deviceType: 'Phone', cpu: 'i7', gpu: 'RTX 3060' });
    expect(strandedFields(wasALaptop)).toEqual(['CPU', 'GPU']);
  });

  it('says nothing about a row whose fields all belong', () => {
    expect(strandedFields(item({ deviceType: 'Phone', carrier: 'Unlocked', condition: 'Good' }))).toEqual([]);
    expect(strandedFields(item({ deviceType: 'Laptop', cpu: 'i7', ram: '16GB' }))).toEqual([]);
    expect(strandedFields(item({}))).toEqual([]);
  });
});

/* ---------------- 4. A laptop with no brand or model ---------------- */

describe('A LAPTOP WITH EMPTY BRAND AND MODEL STILL READS SENSIBLY', () => {
  const laptop = item({
    deviceType: 'Laptop', item: 'Dell XPS 15', brand: '', model: '',
    cpu: 'i7-11800H', ram: '16GB', storage: '512GB', storageType: 'SSD', gpu: 'RTX 3050',
  });

  it('everywhere a device name is shown — the till, receipts, pickers, history', () => {
    // One helper builds the name for all of them, and it is item-first.
    expect(getDeviceDisplayName(laptop)).toBe('Dell XPS 15');
  });

  it('AND IS STILL COUNTABLE by the AI stock count, which has no model field to read', () => {
    // domain/modelKey.ts falls back to `item` when `model` is empty, so "how
    // many XPS 15 in stock" still counts.
    expect(modelKeyOf(laptop)).toBe('dellxps15');
    expect(modelKeyOf(laptop)).not.toBe('');
  });

  it('a laptop with nothing at all still reads as something, not an em dash', () => {
    expect(getDeviceDisplayName(item({ deviceType: 'Laptop', item: '', brand: '', model: '', sku: 'INV-42' })))
      .toBe('Laptop');
  });
});

describe('EXISTING ROWS ARE UNTOUCHED', () => {
  it('a phone-typed laptop is wrong but harmless — it reads exactly as before', () => {
    // Nothing migrates anybody's data: "MacBook" is easy to guess from a name
    // and a Dell model number is not, and a wrong guess puts the wrong fields
    // on the record. So it sits in Phones until the owner retypes it.
    const mistyped = item({ deviceType: 'Phone', item: 'MacBook Pro 14', brand: 'Apple', model: 'MacBook Pro' });
    expect(inventoryTabOf(mistyped)).toBe('phones');
    expect(getDeviceDisplayName(mistyped)).toBe('MacBook Pro 14');
    expect(hasPhoneFields(effectiveDeviceType(mistyped))).toBe(true);
  });

  it('and retyping it moves it between tabs, with no migration needed', () => {
    const before = item({ deviceType: 'Phone', item: 'MacBook Pro 14' });
    const after = { ...before, deviceType: 'Laptop' as DeviceType };
    expect(inventoryTabOf(before)).toBe('phones');
    expect(inventoryTabOf(after)).toBe('laptops');
  });
});

/* ---------------- 5. A laptop is still an ordinary device ---------------- */

describe('A LAPTOP IS STILL AN ORDINARY INVENTORY DEVICE', () => {
  // This change is about the form and the list. A laptop sells at the till,
  // carries the warranty, hits the floor-price check, gets photos, transfers
  // between stores and flows through the P&L identically — it is NOT carved
  // out of the device model, and there is deliberately no separate collection
  // for one (PC builds are separate because they are assembled from parts; a
  // laptop is bought whole).

  it('prices against the floor exactly as a phone of the same cost does', () => {
    const settings = { minMarginPercent: 20, minMarginDollars: 50 };
    const phone = item({ deviceType: 'Phone', purchaseCost: 400, repairCost: 40 });
    const laptop = item({ deviceType: 'Laptop', purchaseCost: 400, repairCost: 40 });
    expect(floorFor(laptop, settings)).toEqual(floorFor(phone, settings));
    expect(floorFor(laptop, settings).price).toBe(528);
  });

  it('NOTHING OUTSIDE THE FORM AND THE TABS BRANCHES ON A LAPTOP', () => {
    // The structural half of the promise above. If a selling, warranty,
    // pricing, transfer or reporting path ever starts special-casing a laptop,
    // this fails — which is the moment to ask whether it should.
    //
    // Comments are stripped first: the prose in these very files explains the
    // laptop decision at length, and a plain scan would match the explanation
    // rather than a branch.
    const allowed = [
      'domain/deviceSpecs.ts',        // where the rules live
      'domain/deviceSpecs.test.ts',
      'domain/inventoryNav.ts',       // the tabs
      'components/ItemFormModal.tsx', // the form
      'components/InventoryView.tsx', // the list
      'components/InventoryView.laptops.test.tsx',
      'components/InventoryView.columns.test.tsx',
      'types.ts',                     // DeviceType itself
    ];
    const files = execSync(
      "grep -rl \"'Laptop'\" --include=*.ts --include=*.tsx . | grep -v node_modules || true",
      { cwd: join(__dirname, '..'), encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean).map(f => f.replace(/^\.\//, ''));

    const offenders = files.filter(f => {
      if (allowed.includes(f)) return false;
      const code = readFileSync(join(__dirname, '..', f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // A mention inside a plain list of every device type (a picker's
      // options, a category map) is not a branch on being a laptop.
      return /===\s*'Laptop'|!==\s*'Laptop'|'Laptop'\s*===/.test(code);
    });
    expect(offenders).toEqual([]);
  });

  it('and there is no laptop collection', () => {
    const db = readFileSync(join(__dirname, '..', 'services/firestoreDb.ts'), 'utf8');
    expect(db).not.toMatch(/'laptops'/);
  });
});

/* ======================================================================== *
 * A LAPTOP'S SPECS, SPLIT FOR PRINT
 *
 * `laptopSpecLine` above is for a screen that can scroll sideways. A printed
 * label's width is fixed in millimetres and anything too long is silently
 * ellipsised, so the two print surfaces (services/shelfTag.ts and the device
 * label in services/labelLayout.ts) take the specs as three slots and place
 * each where their own geometry allows. ONE definition, so they cannot
 * disagree about what a laptop says.
 * ======================================================================== */

describe('laptopPrintSpecs', () => {
  const full = {
    cpu: 'i7-12700H', ram: '32GB', storage: '1TB', storageType: 'SSD' as const,
    screenSize: '15.6"', gpu: 'RTX 3050 Ti',
  };

  it('splits into the machine\'s identity, the GPU, and the screen', () => {
    expect(laptopPrintSpecs(full)).toEqual({
      main: 'i7-12700H · 1TB/32GB',
      gpu: 'RTX 3050 Ti',
      screen: '15.6"',
    });
  });

  it('STORAGE FIRST, RAM SECOND — the owner\'s convention, not the usual one', () => {
    // Most spec sheets write RAM first. This one does not, deliberately, and
    // the test exists so nobody "corrects" it.
    expect(storageRamSlot('256GB', '16GB')).toBe('256GB/16GB');
    expect(laptopPrintSpecs({ cpu: 'i7', storage: '256GB', ram: '16GB' }).main).toBe('i7 · 256GB/16GB');
    // The first value is the DRIVE. Swap the inputs and the output swaps too.
    expect(storageRamSlot('16GB', '256GB')).toBe('16GB/256GB');
  });

  it('prints whatever unit was typed — it neither strips one nor invents one', () => {
    // Both fields are free text and the real records carry units.
    expect(storageRamSlot('256GB', '16GB')).toBe('256GB/16GB');
    // Bare numbers stay bare — this is where the owner's "256/16" comes from.
    expect(storageRamSlot('256', '16')).toBe('256/16');
    // Mixed is passed through as typed rather than normalised either way.
    expect(storageRamSlot('256GB', '16')).toBe('256GB/16');
  });

  it('must NOT strip units: "1TB" would become "1" and read as a tenth of the disk', () => {
    // "1TB" is a real stored value in this workspace. Unit-stripped it reads
    // "1/16" — 1GB of disk beside 16GB of memory. This is the concrete reason
    // the format keeps whatever was typed.
    expect(storageRamSlot('1TB', '16GB')).toBe('1TB/16GB');
    expect(storageRamSlot('1TB', '16GB')).not.toBe('1/16');
  });

  it('keeps the screen size and the GPU OUT of the main line — they are placed separately', () => {
    const { main } = laptopPrintSpecs(full);
    expect(main).not.toContain('15.6');
    expect(main).not.toContain('RTX');
    // Unlike laptopSpecLine, which deliberately puts all five on one line.
    expect(laptopSpecLine(full)).toContain('RTX 3050 Ti');
    expect(laptopSpecLine(full)).toContain('15.6"');
  });

  it('ONE OF THE PAIR ALONE IS LABELLED, because a bare number is ambiguous', () => {
    // The slash only works as a pair. Half of one reads as a rendering fault,
    // and "256" alone could be either a drive or memory — so the lone value
    // gets the word the entry form itself uses.
    expect(storageRamSlot('256GB', undefined)).toBe('Storage 256GB');
    expect(storageRamSlot(undefined, '16GB')).toBe('RAM 16GB');
    // Never a half-pair.
    for (const v of [storageRamSlot('256GB'), storageRamSlot(undefined, '16GB')]) {
      expect(v).not.toMatch(/\//);
    }
  });

  it('storage type is NOT printed any more, on either surface', () => {
    // The new format is two numbers and a slash with no words; there is no
    // slot for SSD/HDD that does not break that or appear inconsistently.
    // It is still on the record and still in the app's own laptopSpecLine.
    expect(laptopPrintSpecs({ storage: '512GB', storageType: 'HDD' }).main).toBe('Storage 512GB');
    expect(laptopPrintSpecs({ cpu: 'i7', storage: '512GB', ram: '16GB', storageType: 'SSD' }).main)
      .toBe('i7 · 512GB/16GB');
    // A storageType with nothing else says nothing at all.
    expect(laptopPrintSpecs({ storageType: 'SSD' }).main).toBe('');
    // …but the on-screen line still carries it.
    expect(laptopSpecLine({ storage: '512GB', storageType: 'SSD' })).toContain('SSD');
  });

  it('returns EMPTY strings, never a dash or a stray separator, for what is not recorded', () => {
    expect(laptopPrintSpecs({})).toEqual({ main: '', gpu: '', screen: '' });
    expect(laptopPrintSpecs({ cpu: 'i5-1135G7' }).main).toBe('i5-1135G7');
    expect(laptopPrintSpecs({ ram: '16GB' }).main).toBe('RAM 16GB');
    expect(laptopPrintSpecs({ cpu: 'i5', storage: '512GB' }).main).toBe('i5 · Storage 512GB');
    expect(storageRamSlot('', '')).toBe('');
    expect(storageRamSlot()).toBe('');
  });

  it("THE OWNER'S LAPTOPS TODAY — added before these fields existed — print cleanly", () => {
    // Every laptop currently in the workspace (see constants.ts) has storage
    // and nothing else. This is the common case, not an edge case, and it is
    // what the owner will be looking at first.
    const today = { storage: '256GB' };
    expect(laptopPrintSpecs(today)).toEqual({ main: 'Storage 256GB', gpu: '', screen: '' });
    const { main } = laptopPrintSpecs(today);
    expect(main).not.toMatch(/·|\/|-|—/);   // no separator of any kind
    expect(main.trim()).toBe(main);          // no leading/trailing gap
  });

  it('treats whitespace as unset, so a field somebody spaced out prints nothing', () => {
    expect(laptopPrintSpecs({ cpu: '  ', ram: '\t', gpu: ' ', screenSize: '  ' }))
      .toEqual({ main: '', gpu: '', screen: '' });
    expect(storageRamSlot('  ', '\t')).toBe('');
    // A spaced-out RAM must not turn the pair into a half-pair.
    expect(storageRamSlot('256GB', '  ')).toBe('Storage 256GB');
  });

  it('trims what it does print', () => {
    expect(laptopPrintSpecs({ cpu: ' i7 ', gpu: ' RTX ', screenSize: ' 14" ' }))
      .toEqual({ main: 'i7', gpu: 'RTX', screen: '14"' });
  });
});

describe('printsLaptopLayout — which rows take the laptop printout', () => {
  it('a laptop does', () => {
    expect(printsLaptopLayout({ kind: 'device', deviceType: 'Laptop' })).toBe(true);
  });

  it('a phone, an untyped legacy record and every other type do NOT', () => {
    expect(printsLaptopLayout({ kind: 'device', deviceType: 'Phone' })).toBe(false);
    expect(printsLaptopLayout({ kind: 'device' })).toBe(false);
    for (const t of OTHER_DEVICE_TYPES) {
      expect(printsLaptopLayout({ kind: 'device', deviceType: t })).toBe(false);
    }
  });

  it('an ACCESSORY never does, even carrying a stray deviceType', () => {
    // An accessory has no deviceType, so effectiveDeviceType would read it as
    // a phone — the explicit kind check is what stops a stray value changing
    // an accessory's layout.
    expect(printsLaptopLayout({ kind: 'accessory', deviceType: 'Laptop' })).toBe(false);
    expect(printsLaptopLayout({ kind: 'accessory' })).toBe(false);
  });

  it('a row with no kind is treated as a device, like everywhere else in the app', () => {
    expect(printsLaptopLayout({ deviceType: 'Laptop' })).toBe(true);
  });
});

/* ======================================================================== *
 * A SCREEN SIZE PRINTS AS ONE CLEAN FORM — AND AN IMPOSSIBLE ONE IS FLAGGED
 *
 * A real label went out reading 5.6" for a 15.6" laptop. Nothing in the code
 * can produce that from "15.6" (one writer, a plain text input, no appender,
 * no truncator — and the value round-trips, asserted below), so the stored
 * value really was wrong and nothing warned anybody. Hence both halves: one
 * printed form whatever gets typed, and a visible warning for a size no
 * laptop has.
 * ======================================================================== */

describe('normalizeScreenSize', () => {
  it('prints one clean form whatever the owner typed', () => {
    // The field is free text with a 15.6" placeholder, so all of these happen.
    for (const typed of ['15.6"', '15.6', '15.6 inch', '15.6in', '15.6 in', '15.6”', '  15.6 "  ', '15.6inches']) {
      expect(normalizeScreenSize(typed), `${typed} should normalise`).toBe('15.6"');
    }
  });

  it('never doubles a unit the owner already typed', () => {
    expect(normalizeScreenSize('15.6"')).not.toBe('15.6""');
    expect(normalizeScreenSize('15.6"')).toBe('15.6"');
  });

  it('a bare number gains the unit it was missing', () => {
    // This is the one that printed with NO unit at all before.
    expect(normalizeScreenSize('14')).toBe('14"');
    expect(normalizeScreenSize('17.3')).toBe('17.3"');
  });

  it('round-trips the digits — nothing is truncated', () => {
    // The 5.6"-for-15.6" report. If this ever fails, it IS a code bug.
    expect(normalizeScreenSize('15.6"')).toBe('15.6"');
    expect(normalizeScreenSize('15.6"')).not.toBe('5.6"');
    expect(laptopPrintSpecs({ screenSize: '15.6"' }).screen).toBe('15.6"');
    expect(laptopPrintSpecs({ screenSize: '15.6' }).screen).toBe('15.6"');
  });

  it('says nothing when there is nothing', () => {
    expect(normalizeScreenSize('')).toBe('');
    expect(normalizeScreenSize(undefined)).toBe('');
    expect(normalizeScreenSize('   ')).toBe('');
    expect(laptopPrintSpecs({})).toEqual({ main: '', gpu: '', screen: '' });
  });

  it('passes through anything it does not understand rather than mangling it', () => {
    // A value this cannot read is still the owner's.
    for (const odd of ['13-14', 'approx 15', 'QHD', '15.6 OLED']) {
      expect(normalizeScreenSize(odd)).toBe(odd);
    }
  });
});

describe('screenSizeWarning — the 5.6" that nobody caught', () => {
  it('flags a size no laptop has, and names the range', () => {
    const w = screenSizeWarning('5.6"');
    expect(w).toBeTruthy();
    expect(w).toContain('5.6"');
    expect(w).toContain(`${LAPTOP_SCREEN_MIN_IN}"`);
    expect(w).toContain(`${LAPTOP_SCREEN_MAX_IN}"`);
  });

  it('is quiet about every size a laptop really comes in', () => {
    for (const ok of ['10', '11.6', '13"', '13.3', '14 inch', '15.6"', '16', '17.3', '18']) {
      expect(screenSizeWarning(ok), `${ok} should not warn`).toBeNull();
    }
  });

  it('flags both ends, and the dropped-digit shapes in particular', () => {
    for (const bad of ['5.6"', '1.6', '56', '9', '19', '55"']) {
      expect(screenSizeWarning(bad), `${bad} should warn`).toBeTruthy();
    }
  });

  it('is a WARNING, not a block — nothing here refuses a value', () => {
    // The record still saves; `screenSizeWarning` only ever returns text.
    expect(typeof screenSizeWarning('5.6"')).toBe('string');
    expect(laptopPrintSpecs({ screenSize: '5.6"' }).screen).toBe('5.6"');
  });

  it('says nothing about an empty or unreadable value rather than nagging', () => {
    expect(screenSizeWarning('')).toBeNull();
    expect(screenSizeWarning(undefined)).toBeNull();
    expect(screenSizeWarning('QHD')).toBeNull();
    expect(screenSizeWarning('13-14')).toBeNull();
  });
});
