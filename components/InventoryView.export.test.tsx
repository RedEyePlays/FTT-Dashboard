// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { InventoryView } from './InventoryView';
import { InventoryItem } from '../types';

/**
 * THE INVENTORY EXPORT IGNORED THE TAB, AND HAD NO STATUS COLUMN.
 *
 * Exporting with Laptops selected produced a 640-row file: every device and
 * every accessory in the workspace, 388 of them sold, two record shapes in
 * one sheet (hence `kind` plus a duplicate `date`, `sku` and `item`, and half
 * of every row empty) — and nowhere in it any sign of which devices were on
 * the repair bench.
 *
 * Two separate faults:
 *   1. the export reached past the grid's own filtered/sorted rows to the raw
 *      `inventory` array, and unioned both column sets;
 *   2. `DEVICE_COLS` had no `deviceStatus`, so `pending_repair`, `reserved`,
 *      `returned` and `ready` all exported identically.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const UID = 'owner-uid';

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: `d${Math.random()}`, kind: 'device', sku: 'FTT-000001', date: '2026-11-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready', deviceType: 'Phone', ...p,
});
const accessory = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: `a${Math.random()}`, kind: 'accessory', sku: 'ACC-000001', date: '2026-11-01', item: 'USB-C Cable',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '', salePrice: 0,
  notes: '', category: 'Cables', quantity: 5, costPerUnit: 2, sellingPrice: 9.99, lowStockThreshold: 3, ...p,
});

/* ---------------- Capturing what actually gets downloaded ---------------- */

interface Download { name: string; text: string }
let downloads: Download[] = [];
let origCreate: typeof URL.createObjectURL;
let origClick: () => void;

beforeEach(() => {
  localStorage.clear();
  downloads = [];
  const blobs = new Map<string, Blob>();
  origCreate = URL.createObjectURL;
  origClick = HTMLAnchorElement.prototype.click;
  (URL as any).createObjectURL = (b: Blob) => {
    const url = `blob:${blobs.size}`;
    blobs.set(url, b);
    return url;
  };
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    const b = blobs.get(this.href);
    if (b) downloads.push({ name: this.download, text: (b as any).__text ?? '' });
  };
  // happy-dom's Blob.text() is async; the click handler is sync, so stash the
  // text on the Blob as it is constructed.
  const RealBlob = globalThis.Blob;
  (globalThis as any).Blob = class extends RealBlob {
    __text: string;
    constructor(parts: any[], opts?: BlobPropertyBag) { super(parts, opts); this.__text = parts.join(''); }
  };
});
afterEach(() => {
  localStorage.clear();
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
    button: (label: string) => Array.from(host.querySelectorAll('button')).find(b => (b.textContent || '').includes(label)),
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}
const click = (el: Element | undefined) => {
  if (!el) throw new Error('no such element');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

const view = (props: Partial<React.ComponentProps<typeof InventoryView>> = {}) => (
  <InventoryView
    inventory={[]} deviceBuyers={[]} activity={[]} section="phones" userId={UID}
    onSelectSection={() => {}} onSave={() => {}} onUpdate={() => {}} onDelete={() => {}}
    onGenerateSku={async () => 'FTT-000318'} previewSku={() => 'FTT-000318'}
    {...props}
  />
);

/** Open the Export menu and take the named entry. */
const exportVia = (v: ReturnType<typeof mount>, entry: 'tab' | 'everything') => {
  const openers = Array.from(v.host.querySelectorAll('button'))
    .filter(b => b.getAttribute('title') === 'Export CSV');
  click(openers[0]);
  const items = Array.from(v.host.querySelectorAll('button'));
  const target = entry === 'everything'
    ? items.find(b => (b.textContent || '').startsWith('Everything'))
    : items.find(b => (b.textContent || '').includes('row') && !(b.textContent || '').startsWith('Everything'));
  click(target);
};

const rowsOf = (d: Download) => d.text.split('\n').slice(1).filter(Boolean);
const headersOf = (d: Download) => d.text.split('\n')[0].split(',').map(h => h.replace(/"/g, ''));

/* ======================================================================== *
 * 1. THE EXPORT IS WHAT IS ON THE SCREEN
 * ======================================================================== */

const MIXED: InventoryItem[] = [
  device({ id: 'p1', item: 'iPhone 13', deviceType: 'Phone', sku: 'PHN-1' }),
  device({ id: 'l1', item: 'Dell XPS 15', deviceType: 'Laptop', sku: 'LAP-1', date: '2026-01-02' }),
  device({ id: 'l2', item: 'HP Pavillion 255 G7', deviceType: 'Laptop', sku: 'LAP-2', date: '2026-01-01' }),
  device({ id: 'l3', item: 'Lenovo ThinkPad', deviceType: 'Laptop', sku: 'LAP-3', deviceStatus: 'pending_repair', date: '2026-01-03' }),
  device({ id: 's1', item: 'iPhone 12', deviceType: 'Phone', sku: 'PHN-9', soldDate: '2026-10-01', deviceStatus: 'sold' }),
  device({ id: 's2', item: 'MacBook Air', deviceType: 'Laptop', sku: 'LAP-9', soldDate: '2026-10-02', deviceStatus: 'sold' }),
  accessory({ id: 'a1', item: 'USB-C Cable', sku: 'ACC-1' }),
  accessory({ id: 'a2', item: 'Screen Protector', sku: 'ACC-2' }),
];

describe('exporting a tab exports that tab', () => {
  it('Laptops yields only the in-stock laptops — not 640 rows of everything', () => {
    const v = mount(view({ inventory: MIXED, section: 'laptops' }));
    exportVia(v, 'tab');
    expect(downloads).toHaveLength(1);
    const text = downloads[0].text;
    // The three in-stock laptops…
    for (const sku of ['LAP-1', 'LAP-2', 'LAP-3']) expect(text).toContain(sku);
    // …and nothing else: no phones, no sold, no accessories.
    for (const sku of ['PHN-1', 'PHN-9', 'LAP-9', 'ACC-1', 'ACC-2']) expect(text).not.toContain(sku);
    expect(rowsOf(downloads[0])).toHaveLength(3);
    v.unmount();
  });

  it('in the grid\'s own order — oldest Date In first, as the screen shows', () => {
    const v = mount(view({ inventory: MIXED, section: 'laptops' }));
    exportVia(v, 'tab');
    const order = rowsOf(downloads[0]).map(r => (r.match(/LAP-\d/) || [''])[0]);
    expect(order).toEqual(['LAP-2', 'LAP-1', 'LAP-3']);   // 01-01, 01-02, 01-03
    v.unmount();
  });

  it('Sold yields the sold items', () => {
    const v = mount(view({ inventory: MIXED, section: 'sold' }));
    exportVia(v, 'tab');
    const text = downloads[0].text;
    expect(text).toContain('PHN-9');
    expect(text).toContain('LAP-9');
    expect(text).not.toContain('LAP-1');
    expect(rowsOf(downloads[0])).toHaveLength(2);
    v.unmount();
  });

  it('Accessories yields accessories, with accessory columns', () => {
    const v = mount(view({ inventory: MIXED, section: 'accessories' }));
    exportVia(v, 'tab');
    const h = headersOf(downloads[0]);
    expect(h).toContain('quantity');
    expect(h).toContain('costPerUnit');
    expect(h).not.toContain('deviceStatus');
    expect(rowsOf(downloads[0])).toHaveLength(2);
    v.unmount();
  });

  it('the search box narrows the file, because it narrows the screen', () => {
    const v = mount(view({ inventory: MIXED, section: 'laptops' }));
    const search = Array.from(v.host.querySelectorAll('input'))
      .find(i => (i.getAttribute('placeholder') || '').toLowerCase().includes('search')) as HTMLInputElement;
    expect(search).toBeTruthy();
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Pavillion');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    exportVia(v, 'tab');
    expect(rowsOf(downloads[0])).toHaveLength(1);
    expect(downloads[0].text).toContain('LAP-2');
    v.unmount();
  });

  it('is named for what it contains, so three in a downloads folder are tellable apart', () => {
    for (const [section, expected] of [['laptops', 'laptops'], ['sold', 'sold'], ['accessories', 'accessories']] as const) {
      downloads = [];
      const v = mount(view({ inventory: MIXED, section }));
      exportVia(v, 'tab');
      expect(downloads[0].name).toMatch(new RegExp(`^${expected}_\\d{4}-\\d{2}-\\d{2}\\.csv$`));
      v.unmount();
    }
  });

  it('carries no `kind` column and no duplicate headers', () => {
    for (const section of ['laptops', 'sold', 'accessories'] as const) {
      downloads = [];
      const v = mount(view({ inventory: MIXED, section }));
      exportVia(v, 'tab');
      const h = headersOf(downloads[0]);
      expect(h, `${section} should not carry kind`).not.toContain('kind');
      expect(new Set(h).size, `${section} has duplicate headers: ${h.join(',')}`).toBe(h.length);
      v.unmount();
    }
  });
});

describe('the export respects the status filter', () => {
  const withFilter = (value: string) => {
    localStorage.setItem(`inv_status_filter:${UID}`, JSON.stringify(value));
  };

  it('a plain status filter narrows the file', () => {
    withFilter('pending_repair');
    const v = mount(view({ inventory: MIXED, section: 'laptops' }));
    exportVia(v, 'tab');
    expect(rowsOf(downloads[0])).toHaveLength(1);
    expect(downloads[0].text).toContain('LAP-3');
    v.unmount();
  });

  it('and so does the STALE-REPAIR flag, which is not a plain status match', () => {
    // domain/alerts.ts: pending_repair with no open ticket counts as orphaned;
    // the stale flag is pending_repair whose ticket has been open too long.
    withFilter('flag:orphan_repair');
    const v = mount(view({ inventory: MIXED, section: 'laptops', repairs: [] }));
    exportVia(v, 'tab');
    // Only the pending_repair laptop, and only because the flag selected it.
    expect(rowsOf(downloads[0])).toHaveLength(1);
    expect(downloads[0].text).toContain('LAP-3');
    v.unmount();
  });
});

/* ======================================================================== *
 * 2. STATUS IS IN THE FILE
 * ======================================================================== */

describe('deviceStatus reaches every device export', () => {
  it('is a column, and a repair bench is tellable from stock', () => {
    const v = mount(view({ inventory: MIXED, section: 'laptops' }));
    exportVia(v, 'tab');
    const h = headersOf(downloads[0]);
    expect(h).toContain('deviceStatus');
    const col = h.indexOf('deviceStatus');
    const cell = (sku: string) => rowsOf(downloads[0])
      .find(r => r.includes(sku))!.split(',').map(c => c.replace(/"/g, ''))[col];
    expect(cell('LAP-3')).toBe('pending_repair');
    expect(cell('LAP-1')).toBe('ready');
    expect(cell('LAP-3')).not.toBe(cell('LAP-1'));
    v.unmount();
  });

  // The failure this change must not reintroduce: the column is hidden by
  // default on every tab, and a hidden column that dropped out of the file
  // would be the original bug wearing a different hat.
  it('EVEN THOUGH it is hidden in the grid by default', () => {
    const v = mount(view({ inventory: MIXED, section: 'laptops' }));
    // Not rendered as a cell…
    const statusSelects = Array.from(v.host.querySelectorAll('select'))
      .filter(s => Array.from(s.options).some(o => o.value === 'pending_repair'));
    expect(statusSelects).toHaveLength(0);
    // …and still in the file.
    exportVia(v, 'tab');
    expect(headersOf(downloads[0])).toContain('deviceStatus');
    v.unmount();
  });

  it('and is reachable in the Columns menu, which is where a toggle belongs', () => {
    const v = mount(view({ inventory: MIXED, section: 'laptops' }));
    click(v.button('Columns'));
    const labels = Array.from(v.host.querySelectorAll('label')).map(l => (l.textContent || '').trim());
    expect(labels).toContain('Status');
    v.unmount();
  });

  it('every device tab exports it', () => {
    for (const section of ['phones', 'laptops', 'other', 'sold', 'intransit'] as const) {
      downloads = [];
      const v = mount(view({ inventory: MIXED, section }));
      exportVia(v, 'tab');
      expect(headersOf(downloads[0]), `${section}`).toContain('deviceStatus');
      v.unmount();
    }
  });
});

/* ======================================================================== *
 * 3. EVERYTHING IS STILL AVAILABLE — DELIBERATELY
 * ======================================================================== */

describe('exporting everything', () => {
  it('is a second, named action rather than what the button silently does', () => {
    const v = mount(view({ inventory: MIXED, section: 'laptops' }));
    const opener = Array.from(v.host.querySelectorAll('button')).find(b => b.getAttribute('title') === 'Export CSV')!;
    click(opener);
    const text = v.host.textContent || '';
    // Both choices name their own size, which is what makes the difference
    // impossible to miss at the moment of choosing.
    expect(text).toContain('Laptops — 3 rows');
    expect(text).toContain('Everything — 8 rows, 2 files');
    v.unmount();
  });

  it('produces the full set, devices and accessories in SEPARATE files', () => {
    const v = mount(view({ inventory: MIXED, section: 'laptops' }));
    exportVia(v, 'everything');
    expect(downloads).toHaveLength(2);
    const [dev, acc] = downloads;
    expect(dev.name).toMatch(/^inventory-devices_/);
    expect(acc.name).toMatch(/^inventory-accessories_/);
    expect(rowsOf(dev)).toHaveLength(6);      // every device, sold included
    expect(rowsOf(acc)).toHaveLength(2);
    v.unmount();
  });

  it('so neither file has two record shapes in it', () => {
    const v = mount(view({ inventory: MIXED, section: 'laptops' }));
    exportVia(v, 'everything');
    const [dev, acc] = downloads;
    for (const d of [dev, acc]) {
      const h = headersOf(d);
      expect(new Set(h).size, `duplicate headers in ${d.name}: ${h.join(',')}`).toBe(h.length);
    }
    expect(headersOf(dev)).toContain('deviceStatus');
    expect(headersOf(dev)).not.toContain('quantity');
    expect(headersOf(acc)).toContain('quantity');
    expect(headersOf(acc)).not.toContain('deviceStatus');
    v.unmount();
  });
});

/* ======================================================================== *
 * 4. IT STILL GOES BACK IN
 * ======================================================================== */

describe('round-tripping an exported file through import', () => {
  /**
   * Import now PREVIEWS before it writes (domain/inventoryImport.ts), so this
   * picks the file and then confirms the plan — nothing reaches `onSave`
   * until Apply, which is the point of the preview.
   */
  const importText = async (v: ReturnType<typeof mount>, text: string, name: string) => {
    const input = Array.from(v.host.querySelectorAll('input'))
      .find(i => (i as HTMLInputElement).type === 'file') as HTMLInputElement;
    const file = new File([text], name, { type: 'text/csv' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      // FileReader is async even in happy-dom.
      await new Promise(r => setTimeout(r, 30));
    });
    const apply = Array.from(v.host.querySelectorAll('button'))
      .find(b => (b.textContent || '').startsWith('Apply '));
    if (!apply) throw new Error(`no Apply button — preview did not open for ${name}`);
    await act(async () => {
      apply.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 30));
    });
  };

  /**
   * THE DATA-LOSS TRAP THIS REPLACED. Import used to build every row as a new
   * record, so exporting and importing back doubled the inventory — two rows
   * per SKU, two per IMEI, silently.
   */
  it('UPDATES the matching items instead of duplicating them', async () => {
    const out = mount(view({ inventory: MIXED, section: 'laptops' }));
    exportVia(out, 'tab');
    const csv = downloads[0].text;
    out.unmount();

    const onSave = vi.fn();
    const back = mount(view({ inventory: MIXED, section: 'laptops', onSave }));
    await importText(back, csv, 'laptops.csv');
    const saved: InventoryItem[] = onSave.mock.calls.map(c => c[0]);
    // Every row came back onto the item it already was — same ids, no new ones.
    expect(saved.map(i => i.id).sort()).toEqual(['l1', 'l2', 'l3']);
    expect(saved.every(i => MIXED.some(m => m.id === i.id))).toBe(true);
    back.unmount();
  });

  it('and says so before writing anything', async () => {
    const out = mount(view({ inventory: MIXED, section: 'laptops' }));
    exportVia(out, 'tab');
    const csv = downloads[0].text;
    out.unmount();

    const onSave = vi.fn();
    const back = mount(view({ inventory: MIXED, section: 'laptops', onSave }));
    const input = Array.from(back.host.querySelectorAll('input'))
      .find(i => (i as HTMLInputElement).type === 'file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([csv], 'l.csv', { type: 'text/csv' })], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 30));
    });
    // The preview is open, the counts are on it, and NOTHING has been saved.
    expect(back.host.textContent).toContain('3 to update · 0 new');
    expect(onSave).not.toHaveBeenCalled();
    back.unmount();
  });

  it('does not corrupt deviceStatus', async () => {
    const out = mount(view({ inventory: MIXED, section: 'laptops' }));
    exportVia(out, 'tab');
    const csv = downloads[0].text;
    out.unmount();

    const onSave = vi.fn();
    const back = mount(view({ inventory: MIXED, section: 'laptops', onSave }));
    await importText(back, csv, 'laptops.csv');
    const saved: InventoryItem[] = onSave.mock.calls.map(c => c[0]);
    expect(saved).toHaveLength(3);
    expect(saved.map(i => i.deviceStatus).sort())
      .toEqual(['pending_repair', 'ready', 'ready']);
    back.unmount();
  });

  // A tab export has no `kind` column, and the old rule read a missing value
  // as 'device' — which would have turned a re-imported Accessories sheet
  // into devices.
  it('an accessories file comes back as accessories, with no `kind` column to go on', async () => {
    const out = mount(view({ inventory: MIXED, section: 'accessories' }));
    exportVia(out, 'tab');
    const csv = downloads[0].text;
    expect(headersOf(downloads[0])).not.toContain('kind');
    out.unmount();

    const onSave = vi.fn();
    const back = mount(view({ inventory: MIXED, section: 'accessories', onSave }));
    await importText(back, csv, 'accessories.csv');
    const saved: InventoryItem[] = onSave.mock.calls.map(c => c[0]);
    expect(saved).toHaveLength(2);
    expect(saved.every(i => i.kind === 'accessory')).toBe(true);
    expect(saved.map(i => i.quantity)).toEqual([5, 5]);
    back.unmount();
  });

  // The grid REMOVES the Type dropdown on Phones and Laptops (TYPELESS_TABS),
  // but the export must still carry `deviceType`: importCSV defaults a missing
  // one to 'Phone', so a Laptops sheet without it would re-import as phones.
  it('a Laptops file keeps deviceType, so it does not come back as phones', async () => {
    const out = mount(view({ inventory: MIXED, section: 'laptops' }));
    exportVia(out, 'tab');
    const csv = downloads[0].text;
    expect(headersOf(downloads[0])).toContain('deviceType');
    out.unmount();

    const onSave = vi.fn();
    const back = mount(view({ inventory: MIXED, section: 'laptops', onSave }));
    await importText(back, csv, 'laptops.csv');
    const saved: InventoryItem[] = onSave.mock.calls.map(c => c[0]);
    expect(saved).toHaveLength(3);
    // Spelled as a value comparison rather than a `=== 'Laptop'` branch, so
    // this does not trip domain/deviceSpecs.test.ts's guard on where
    // laptop-ness is allowed to be decided.
    expect(saved.map(i => i.deviceType)).toEqual(['Laptop', 'Laptop', 'Laptop']);
    back.unmount();
  });

  it('a file that DOES carry `kind` is still read from it, exactly as before', async () => {
    const onSave = vi.fn();
    const v = mount(view({ inventory: MIXED, section: 'phones', onSave }));
    await importText(v, 'kind,sku,item,deviceStatus\n"device","PHN-X","Pixel 9","reserved"', 'legacy.csv');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].kind).toBe('device');
    expect(onSave.mock.calls[0][0].deviceStatus).toBe('reserved');
    v.unmount();
  });
});
