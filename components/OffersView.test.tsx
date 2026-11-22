// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { OffersView } from './OffersView';
import { useCheckout } from '../hooks/useCheckout';
import { InventoryItem, Offer, SalesTransaction } from '../types';

/**
 * AN OFFER YOU CAN REOPEN, EXPORT, AND SELL PART OF.
 *
 * The two things this file is really here to hold:
 *
 *  1. THE TWO VIEWS OF THE SAME OFFER ARE DIFFERENT. The owner's screen shows
 *     cost, target and margin; the exported sheet shows none of it, asserted
 *     by column name on the actual file.
 *  2. MARKING DEVICES SOLD ROUTES THROUGH THE EXISTING SALE PATH. The last
 *     describe below carries the ids this view hands over into the real
 *     checkout hook and asserts a genuine salesTransaction comes out, with
 *     revenue, profit and the devices in soldRows. An offer that recorded
 *     money of its own would be worse than no offer feature at all.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const dev = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: 'a', kind: 'device', sku: 'FTT-000101', date: '2026-01-01', item: 'iPhone 14',
  imei: '490154203237518', boughtFrom: 'Kijiji seller — flaky', purchaseCost: 300,
  repairCost: 20, soldDate: '', soldTo: '', salePrice: 0,
  notes: 'aftermarket screen, do not mention', deviceType: 'Phone', condition: 'Good',
  storage: '256GB', color: 'Black', batteryHealth: '91%', purchaseSource: 'Kijiji',
  targetSalePrice: 500, deviceStatus: 'ready', ...p,
});

// DELIBERATELY ODD FIGURES. A round 300 or 420 is a substring of the IMEIs
// these devices carry ("490154203237518" contains "420"), so a leak check for
// it passes or fails for the wrong reason. Every money value here is a decimal
// that cannot occur inside an identifier.
const INV: InventoryItem[] = [
  dev({ id: 'a', sku: 'FTT-000101', item: 'iPhone 14', purchaseCost: 311.07, repairCost: 22.09, targetSalePrice: 533.41 }),
  dev({ id: 'b', sku: 'FTT-000102', item: 'Pixel 8', imei: '356789012340002', purchaseCost: 101.03, repairCost: 0, targetSalePrice: 266.29 }),
  dev({ id: 'c', sku: 'FTT-000103', item: 'Galaxy S23', imei: '', purchaseCost: 200.11, repairCost: 0, targetSalePrice: 0 }),
];

/** The owner-screen figures for the two-device offer used below. */
const LIVE_COST = '$434.19';     // 311.07 + 22.09 + 101.03
const LIVE_TARGET = '$799.70';   // 533.41 + 266.29
const LIVE_MARGIN = '$365.51';
const MONEY_LEAKS = ['434.19', '799.70', '365.51', '533.41', '266.29', '311.07', '22.09', '101.03'];

const offer = (p: Partial<Offer> = {}): Offer => ({
  id: 'o1', buyerName: 'Rashid', date: '2026-11-20', status: 'open', lines: [], createdAt: 1000, ...p,
});

/* ---------------- Download capture, as the export tests do ---------------- */

interface Download { name: string; text: string }
let downloads: Download[] = [];
let origCreate: typeof URL.createObjectURL;
let origClick: () => void;

beforeEach(() => {
  downloads = [];
  const blobs = new Map<string, Blob>();
  origCreate = URL.createObjectURL;
  origClick = HTMLAnchorElement.prototype.click;
  (URL as any).createObjectURL = (b: Blob) => { const u = `blob:${blobs.size}`; blobs.set(u, b); return u; };
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    const b = blobs.get(this.href);
    if (b) downloads.push({ name: this.download, text: (b as any).__text ?? '' });
  };
  const RealBlob = globalThis.Blob;
  (globalThis as any).Blob = class extends RealBlob {
    __text: string;
    constructor(parts: any[], opts?: BlobPropertyBag) { super(parts, opts); this.__text = parts.join(''); }
  };
});
afterEach(() => {
  (URL as any).createObjectURL = origCreate;
  HTMLAnchorElement.prototype.click = origClick;
});

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    host,
    rerender: (next: React.ReactElement) => act(() => { root.render(next); }),
    button: (label: string) => Array.from(host.querySelectorAll('button')).find(b => (b.textContent || '').includes(label)),
    text: () => host.textContent || '',
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}
const click = (el: Element | undefined) => {
  if (!el) throw new Error('no such element');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const typeInto = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setNative = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => { setNative.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};

const view = (p: Partial<React.ComponentProps<typeof OffersView>> = {}) => (
  <OffersView offers={[]} inventory={INV} canViewCost onSave={() => {}} onSellLines={() => {}} {...p} />
);

/**
 * The view is controlled: every edit goes out through onSave. This mounts it
 * with a live store so an edit comes straight back in, which is also what
 * "reopens intact" means.
 */
function live(initial: Offer[], props: Partial<React.ComponentProps<typeof OffersView>> = {}) {
  // A mutable store object, NOT a `let` returned through a getter: the tests
  // destructure the result, which would snapshot a getter's value once and
  // then never see an edit.
  const store = { rows: initial };
  const onSave = vi.fn((o: Offer) => {
    store.rows = store.rows.some(x => x.id === o.id)
      ? store.rows.map(x => x.id === o.id ? o : x)
      : [...store.rows, o];
    v.rerender(view({ offers: store.rows, onSave, ...props }));
  });
  const v = mount(view({ offers: store.rows, onSave, ...props }));
  return { v, onSave, store };
}

const rowsOf = (d: Download) => d.text.split('\n').slice(1).filter(Boolean);
const headersOf = (d: Download) => d.text.split('\n')[0].split(',').map(h => h.replace(/"/g, ''));

/* ======================================================================== *
 * 1. SAVING AND REOPENING
 * ======================================================================== */

describe('an offer saves and reopens intact', () => {
  it('a buyer, devices, grades and notes all come back', () => {
    const { v, store } = live([]);
    click(v.button('New offer'));
    typeInto(v.host.querySelector('input[aria-label="Buyer\'s name"]') as HTMLInputElement, 'Rashid');
    click(v.button('Create'));

    // Add two devices by pasted identifier — the same matcher Inventory uses.
    click(v.button('Add devices'));
    typeInto(v.host.querySelector('textarea') as HTMLTextAreaElement, 'FTT-000101\n000102\nFTT-999999');
    click(v.button('Find these'));
    expect(v.text()).toContain('2 found · 1 not found');   // the miss is reported first
    expect(v.text()).toContain('FTT-999999');
    click(v.button('Add 2 to the offer'));

    typeInto(v.host.querySelector('input[aria-label="Grade for FTT-000101"]') as HTMLInputElement, 'A');
    typeInto(v.host.querySelector('input[aria-label="Note for FTT-000101"]') as HTMLInputElement, 'boxed with charger');
    typeInto(v.host.querySelector('input[aria-label="Grade for FTT-000102"]') as HTMLInputElement, 'B');

    const saved = store.rows[0];
    expect(saved).toMatchObject({ buyerName: 'Rashid', status: 'open' });
    expect(saved.lines).toEqual([
      { itemId: 'a', outcome: 'pending', grade: 'A', note: 'boxed with charger' },
      { itemId: 'b', outcome: 'pending', grade: 'B' },
    ]);
    v.unmount();
  });

  it('reopens with everything on it', () => {
    const stored = offer({
      lines: [
        { itemId: 'a', outcome: 'pending', grade: 'A', note: 'boxed with charger' },
        { itemId: 'b', outcome: 'declined', grade: 'C', note: 'cracked back' },
      ],
      buyerContact: '555-0100', notes: 'met at the mall',
    });
    const { v } = live([stored]);
    click(v.button('Rashid'));
    expect((v.host.querySelector('input[aria-label="Grade for FTT-000101"]') as HTMLInputElement).value).toBe('A');
    expect((v.host.querySelector('input[aria-label="Note for FTT-000101"]') as HTMLInputElement).value).toBe('boxed with charger');
    expect((v.host.querySelector('input[aria-label="Grade for FTT-000102"]') as HTMLInputElement).value).toBe('C');
    expect(v.text()).toContain('Declined');
    v.unmount();
  });

  it('the list says what state each offer is in', () => {
    const inv = [dev({ id: 'a', soldDate: '2026-11-21', deviceStatus: 'sold' }), INV[1]];
    const { v } = live([offer({
      lines: [{ itemId: 'a', outcome: 'pending', sentToSaleAt: 5 }, { itemId: 'b', outcome: 'pending' }],
    })], { inventory: inv });
    expect(v.text()).toContain('Part sold');
    expect(v.text()).toContain('1 sold to them');
    v.unmount();
  });
});

/* ======================================================================== *
 * 2. TWO VIEWS OF THE SAME OFFER
 * ======================================================================== */

const QUOTED = offer({
  lines: [
    { itemId: 'a', outcome: 'pending', grade: 'A', note: 'boxed with charger' },
    { itemId: 'b', outcome: 'pending', grade: 'B', note: 'light scratch' },
  ],
});

describe("the owner's view shows the money; the sheet does not", () => {
  it('the screen shows cost, target and margin', () => {
    const { v } = live([QUOTED]);
    click(v.button('Rashid'));
    expect(v.text()).toContain('Our cost');
    expect(v.text()).toContain(LIVE_COST);
    expect(v.text()).toContain(LIVE_TARGET);
    expect(v.text()).toContain(LIVE_MARGIN);
    v.unmount();
  });

  it('and hides every one of them without cost access', () => {
    const { v } = live([QUOTED], { canViewCost: false });
    click(v.button('Rashid'));
    expect(v.text()).not.toContain('Our cost');
    for (const figure of [LIVE_COST, LIVE_TARGET, LIVE_MARGIN]) expect(v.text(), figure).not.toContain(figure);
    v.unmount();
  });

  it('THE EXPORTED SHEET CARRIES NO COST COLUMN, NO TARGET AND NO MARGIN', () => {
    const { v } = live([QUOTED]);
    click(v.button('Rashid'));
    click(v.button('Export sheet'));
    expect(downloads).toHaveLength(1);
    const h = headersOf(downloads[0]);
    for (const col of ['purchaseCost', 'repairCost', 'cost', 'Cost', 'target', 'Target', 'margin', 'Margin', 'price', 'Price']) {
      expect(h, col).not.toContain(col);
    }
    // And no figure from the owner's screen is anywhere in the file.
    for (const leak of [...MONEY_LEAKS, 'Kijiji', 'do not mention']) {
      expect(downloads[0].text, leak).not.toContain(leak);
    }
    v.unmount();
  });

  it('the sheet DOES carry the grade and the note that were typed in the offer', () => {
    const { v } = live([QUOTED]);
    click(v.button('Rashid'));
    click(v.button('Export sheet'));
    const h = headersOf(downloads[0]);
    const rows = rowsOf(downloads[0]).map(r => r.split('","').map(c => c.replace(/^"|"$/g, '')));
    expect(h).toContain('Grade');
    expect(h).toContain('Notes');
    expect(rows[0][h.indexOf('Grade')]).toBe('A');
    expect(rows[0][h.indexOf('Notes')]).toBe('boxed with charger');
    expect(rows[1][h.indexOf('Grade')]).toBe('B');
    expect(rows[1][h.indexOf('Notes')]).toBe('light scratch');
    v.unmount();
  });

  it('the file is named for the buyer and marked safe to send', () => {
    const { v } = live([QUOTED]);
    click(v.button('Rashid'));
    click(v.button('Export sheet'));
    expect(downloads[0].name).toMatch(/offer-sheet-SAFE-TO-SEND_Rashid_\d{4}-\d{2}-\d{2}\.csv/);
    v.unmount();
  });

  it('and exporting records that it went, so a later edit says the sheet is stale', () => {
    const { v, store } = live([QUOTED]);
    click(v.button('Rashid'));
    click(v.button('Export sheet'));
    expect(store.rows[0].sentAt).toBeTruthy();
    typeInto(v.host.querySelector('input[aria-label="Grade for FTT-000101"]') as HTMLInputElement, 'B');
    expect(v.text()).toMatch(/changed since the sheet was sent|out-of-date file/);
    v.unmount();
  });

  it('a declined device drops out of the sheet — it is not part of the lot any more', () => {
    const { v } = live([offer({
      lines: [{ itemId: 'a', outcome: 'pending' }, { itemId: 'b', outcome: 'declined' }],
    })]);
    click(v.button('Rashid'));
    click(v.button('Export sheet'));
    expect(downloads[0].text).toContain('FTT-000101');
    expect(downloads[0].text).not.toContain('FTT-000102');
    v.unmount();
  });
});

/* ======================================================================== *
 * 3. DECLINING, AND RE-OFFERING
 * ======================================================================== */

describe('the devices the buyer did not take', () => {
  it('are marked declined and nothing else happens to them', () => {
    const { v, store } = live([QUOTED]);
    click(v.button('Rashid'));
    click(v.host.querySelector('input[aria-label="Select FTT-000101"]')!);
    click(v.button('Buyer declined these'));
    expect(store.rows[0].lines[0]).toMatchObject({ itemId: 'a', outcome: 'declined' });
    // No sale, no status change, no stock movement of any kind was asked for.
    expect(store.rows[0].lines[0]).not.toHaveProperty('sentToSaleAt');
    expect(v.text()).toMatch(/need nothing doing/);
    v.unmount();
  });

  it('and can go straight onto another offer', () => {
    const declined = offer({ id: 'o1', lines: [{ itemId: 'a', outcome: 'declined' }] });
    const { v, store } = live([declined]);
    click(v.button('New offer'));
    typeInto(v.host.querySelector('input[aria-label="Buyer\'s name"]') as HTMLInputElement, 'Mo');
    click(v.button('Create'));
    click(v.button('Add devices'));
    typeInto(v.host.querySelector('textarea') as HTMLTextAreaElement, 'FTT-000101');
    click(v.button('Find these'));
    click(v.button('Add 1 to the offer'));
    const second = store.rows.find(o => o.buyerName === 'Mo')!;
    expect(second.lines.map(l => l.itemId)).toEqual(['a']);
    v.unmount();
  });
});

/* ======================================================================== *
 * 4. SELLING IN-STORE WHILE THE OFFER IS OUT
 * ======================================================================== */

describe('a device sold in-store while the quote was out', () => {
  it('leaves the offer coherent — it is not counted as the buyer\'s purchase', () => {
    const inv = [dev({ id: 'a', soldDate: '2026-11-21', deviceStatus: 'sold', salePrice: 480 }), INV[1]];
    const { v } = live([QUOTED], { inventory: inv });
    click(v.button('Rashid'));
    expect(v.text()).toContain('Sold in-store, not to this buyer');
    expect(v.text()).not.toContain('Sold to this buyer');
    v.unmount();
  });

  it('and such a device is no longer in the lot the sheet quotes', () => {
    const inv = [dev({ id: 'a', soldDate: '2026-11-21', deviceStatus: 'sold' }), INV[1]];
    const { v } = live([QUOTED], { inventory: inv });
    click(v.button('Rashid'));
    click(v.button('Export sheet'));
    // Still quoted: the Pixel. Gone: the phone that sold over the counter.
    expect(rowsOf(downloads[0])).toHaveLength(1);
    expect(downloads[0].text).toContain('FTT-000102');
    v.unmount();
  });

  it('an offer whose devices have all been deleted says so rather than breaking', () => {
    const { v } = live([QUOTED], { inventory: [] });
    click(v.button('Rashid'));
    expect(v.text()).toContain('No longer in inventory');
    click(v.button('Export sheet'));
    expect(rowsOf(downloads[0])).toHaveLength(0);   // a header and nothing else
    v.unmount();
  });

  it('an offer with no devices behaves sanely', () => {
    const { v } = live([offer()]);
    click(v.button('Rashid'));
    expect(v.text()).toContain('No devices on this offer yet');
    expect(v.button('Export sheet')).toHaveProperty('disabled', true);
    v.unmount();
  });
});

/* ======================================================================== *
 * 5. THE SALE PATH — THE PART THAT MUST NOT BE THIN
 * ======================================================================== */

describe('marking devices sold goes through the ordinary checkout', () => {
  it('the view hands over ids and records only that it did', () => {
    const onSellLines = vi.fn();
    const { v, store } = live([QUOTED], { onSellLines });
    click(v.button('Rashid'));
    click(v.host.querySelector('input[aria-label="Select FTT-000101"]')!);
    click(v.host.querySelector('input[aria-label="Select FTT-000102"]')!);
    click(v.button('Sell these in Quick Sale'));
    expect(onSellLines).toHaveBeenCalledWith('o1', ['a', 'b']);
    // The offer itself recorded no sale and no money — see domain/offers.ts.
    for (const l of store.rows[0].lines) {
      expect(l).not.toHaveProperty('salePrice');
      expect(l).not.toHaveProperty('soldDate');
      expect(l.outcome).toBe('pending');
    }
    v.unmount();
  });

  it('a device that has since sold is reported rather than arriving at the till as a surprise', () => {
    const inv = [dev({ id: 'a', soldDate: '2026-11-21', deviceStatus: 'sold' }), INV[1]];
    const onSellLines = vi.fn();
    const { v } = live([QUOTED], { inventory: inv, onSellLines });
    click(v.button('Rashid'));
    // Only the Pixel is tickable now; the sold one has no checkbox.
    expect(v.host.querySelector('input[aria-label="Select FTT-000101"]')).toBeNull();
    click(v.host.querySelector('input[aria-label="Select FTT-000102"]')!);
    click(v.button('Sell these in Quick Sale'));
    expect(onSellLines).toHaveBeenCalledWith('o1', ['b']);
    v.unmount();
  });

  /**
   * THE WHOLE ROUTE, END TO END. The ids the view hands over are fed to the
   * real checkout hook — the same seed Inventory's bulk action uses — and a
   * genuine SalesTransaction comes out the other side.
   */
  it('AND THOSE IDS PRODUCE A REAL salesTransaction', () => {
    const onSellLines = vi.fn();
    const { v } = live([QUOTED], { onSellLines });
    click(v.button('Rashid'));
    click(v.button('Tick all'));
    click(v.button('Sell these in Quick Sale'));
    const [offerId, ids] = onSellLines.mock.calls[0];
    v.unmount();

    // ---- the ordinary checkout, seeded exactly as App seeds it ----
    let cx!: ReturnType<typeof useCheckout>;
    const onComplete = vi.fn();
    const Harness = () => {
      cx = useCheckout({
        inventory: INV, onComplete, persist: null,
        initialInventoryIds: ids, initialOfferId: offerId,
        offers: [{ ...QUOTED, lines: QUOTED.lines.map(l => ({ ...l, sentToSaleAt: 1 })) }],
      });
      return null;
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<Harness />); });

    expect(cx.cart.map(l => l.inventoryId)).toEqual(['a', 'b']);
    // The offer that sent them here does not warn about itself.
    expect(cx.hasOfferedDevice).toBe(false);

    // The lot goes for one agreed figure: the owner reaches it with the
    // cart's own price fields. Nothing priced it for them.
    expect(cx.cart.map(l => l.unitPrice)).toEqual([533.41, 266.29]);
    act(() => { cx.updateLine(cx.cart[0].key, { unitPrice: 600 }); });
    act(() => { cx.setCustomerName('Rashid Wholesale'); });
    act(() => { cx.handleCheckout(); });

    expect(onComplete).toHaveBeenCalledTimes(1);
    const payload = onComplete.mock.calls[0][0];
    const tx: SalesTransaction = payload.transaction;
    expect(tx.id).toBeTruthy();
    expect(tx.customerName).toBe('Rashid Wholesale');
    expect(tx.totalPaid).toBe(866.29);                    // 600 + 266.29, the agreed figure
    expect(tx.purchaseCost).toBe(412.1);                  // 311.07 + 101.03
    expect(tx.repairCost).toBe(22.09);
    expect(tx.netProfit).toBeCloseTo(866.29 - 434.19, 2); // the real profit, from the real sale
    expect(tx.lines.map(l => l.inventoryId)).toEqual(['a', 'b']);
    // And the devices are marked sold BY THE CHECKOUT, not by the offer.
    expect(payload.soldRows.map((r: InventoryItem) => r.id)).toEqual(['a', 'b']);
    expect(payload.soldRows.every((r: InventoryItem) => r.deviceStatus === 'sold' && !!r.soldDate)).toBe(true);

    act(() => { root.unmount(); });
    host.remove();
  });
});

/* ======================================================================== *
 * 6. QUOTING TWO BUYERS THE SAME PHONE
 * ======================================================================== */

describe('a device already on somebody else\'s open offer', () => {
  const RASHID = offer({ id: 'o1', buyerName: 'Rashid', lines: [{ itemId: 'a', outcome: 'pending' }] });

  it('is reported while the second offer is being built — and added anyway', () => {
    const { v, store } = live([RASHID, offer({ id: 'o2', buyerName: 'Mo', lines: [] })]);
    click(v.button('Mo'));
    click(v.button('Add devices'));
    typeInto(v.host.querySelector('textarea') as HTMLTextAreaElement, 'FTT-000101');
    click(v.button('Find these'));
    expect(v.text()).toContain('Already on another open offer');
    expect(v.text()).toContain('out on an open offer to Rashid');
    // Not a block: quoting two buyers is a normal thing to do on purpose.
    click(v.button('Add 1 to the offer'));
    expect(store.rows.find(o => o.id === 'o2')!.lines.map(l => l.itemId)).toEqual(['a']);
    v.unmount();
  });

  it('carries the note on the line afterwards, on both offers', () => {
    const both = [RASHID, offer({ id: 'o2', buyerName: 'Mo', lines: [{ itemId: 'a', outcome: 'pending' }] })];
    const { v } = live(both);
    click(v.button('Mo'));
    expect(v.text()).toContain('also out on an open offer to Rashid');
    v.unmount();
  });

  it('AN OFFER NEVER REPORTS ITSELF', () => {
    const { v } = live([RASHID]);
    click(v.button('Rashid'));
    expect(v.text()).not.toContain('also out on');
    v.unmount();
  });

  it('and says nothing once the other offer is closed', () => {
    const both = [
      offer({ id: 'o1', buyerName: 'Rashid', status: 'closed', lines: [{ itemId: 'a', outcome: 'pending' }] }),
      offer({ id: 'o2', buyerName: 'Mo', lines: [{ itemId: 'a', outcome: 'pending' }] }),
    ];
    const { v } = live(both);
    click(v.button('Mo'));
    expect(v.text()).not.toContain('also out on');
    v.unmount();
  });
});

/* ======================================================================== *
 * 7. DEVICES ONLY
 * ======================================================================== */

describe('pasting an accessory into an offer', () => {
  const WITH_CABLE = [
    ...INV,
    { ...dev({ id: 'acc', sku: 'FTT-000900', item: 'USB-C cable', imei: '' }), kind: 'accessory' as const,
      quantity: 5, costPerUnit: 2, sellingPrice: 9.99 },
  ];

  it('is refused at the moment it is pasted, and NAMED', () => {
    // Not silently at sell time, after it has been quoted to somebody.
    const { v, store } = live([offer({ lines: [] })], { inventory: WITH_CABLE });
    click(v.button('Rashid'));
    click(v.button('Add devices'));
    typeInto(v.host.querySelector('textarea') as HTMLTextAreaElement, 'FTT-000101\nFTT-000900');
    click(v.button('Find these'));
    expect(v.text()).toContain('an offer is devices only');
    expect(v.text()).toContain('FTT-000900');
    click(v.button('Add 1 to the offer'));   // the device only
    expect(store.rows[0].lines.map(l => l.itemId)).toEqual(['a']);
    v.unmount();
  });

  it('an all-accessory paste adds nothing', () => {
    const { v, store } = live([offer({ lines: [] })], { inventory: WITH_CABLE });
    click(v.button('Rashid'));
    click(v.button('Add devices'));
    typeInto(v.host.querySelector('textarea') as HTMLTextAreaElement, 'FTT-000900');
    click(v.button('Find these'));
    expect(v.button('Add 0 to the offer')).toHaveProperty('disabled', true);
    expect(store.rows[0].lines).toEqual([]);
    v.unmount();
  });
});
