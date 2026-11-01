// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { InventoryView } from './InventoryView';
import { InventoryItem } from '../types';

/**
 * TWO FIXES FOUND IN THE FIRST DAY OF USING THE TABS.
 *
 *  1. THE QUICK-ADD ROW SWALLOWED ITS OWN SKU. The row saved on the first
 *     edit with `{ ...draft, sku, [field]: value }` — `sku` BEFORE the edit —
 *     so typing into the SKU column (the first column, rendering empty) wrote
 *     over the number that had just been allocated. The owner got an item
 *     called `eee` with no auto-number, silently, and because `nextSku` never
 *     reuses a number the allocated one was gone for good.
 *
 *  2. THE COLUMNS IGNORED THE TAB. The Laptops tab showed STORAGE, COLOR and
 *     BATTERY — a column that is always blank on a laptop — and none of the
 *     specs the laptop work was for. Worse, those spec columns carried
 *     `hideCol: true`, which also removes a column from the COLUMNS MENU, so
 *     they were not hidden-by-default: they were unreachable.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: `d${Math.random()}`, kind: 'device', sku: 'FTT-000001', date: '2026-11-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready', deviceType: 'Phone', ...p,
});

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    host,
    text: () => host.textContent || '',
    headers: () => Array.from(host.querySelectorAll('th')).map(th => (th.textContent || '').trim()),
    inputs: () => Array.from(host.querySelectorAll('input')) as HTMLInputElement[],
    values: () => Array.from(host.querySelectorAll('input')).map(i => (i as HTMLInputElement).value),
    selects: () => Array.from(host.querySelectorAll('select')) as HTMLSelectElement[],
    button: (label: string) => Array.from(host.querySelectorAll('button')).find(b => (b.textContent || '').includes(label)),
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

const click = (el: Element | undefined) => {
  if (!el) throw new Error('no such element');
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const setValue = (el: HTMLInputElement, value: string) => act(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const blur = (el: HTMLElement) => act(() => { el.dispatchEvent(new FocusEvent('blur', { bubbles: true })); });

/**
 * The quick-add row, found by the previewed SKU sitting in it — and its TEXT
 * cells in column order, so a test can say which column it is typing into
 * instead of grabbing whatever input happens to be empty (the CSV file input,
 * for one).
 *
 * Device text columns, in order: sku, imei, item, …
 */
const draftCells = (v: ReturnType<typeof mount>, preview: string): HTMLInputElement[] => {
  const row = Array.from(v.host.querySelectorAll('tr'))
    .find(tr => Array.from(tr.querySelectorAll('input')).some(i => (i as HTMLInputElement).value === preview));
  if (!row) throw new Error(`no draft row showing ${preview}`);
  return (Array.from(row.querySelectorAll('input')) as HTMLInputElement[])
    .filter(i => i.type === 'text');
};
const skuCell = (v: ReturnType<typeof mount>, preview: string) => draftCells(v, preview)[0];
const itemCell = (v: ReturnType<typeof mount>, preview: string) => draftCells(v, preview)[2];

const view = (props: Partial<React.ComponentProps<typeof InventoryView>> = {}) => (
  <InventoryView
    inventory={[]} deviceBuyers={[]} activity={[]} section="phones"
    onSelectSection={() => {}} onSave={() => {}} onUpdate={() => {}} onDelete={() => {}}
    onGenerateSku={async () => 'FTT-000318'} previewSku={() => 'FTT-000318'}
    {...props}
  />
);

beforeEach(() => { localStorage.clear(); });
afterEach(() => { localStorage.clear(); });

/* ---------------- 1. The quick-add SKU ---------------- */

describe('the quick-add row and its SKU', () => {
  // An EMPTY workspace renders the first-item empty state instead of the
  // toolbar, so these mount with one existing row and add a second.
  const openRow = (overrides: Partial<React.ComponentProps<typeof InventoryView>> = {}) => {
    const v = mount(view({ inventory: [device({ id: 'existing' })], ...overrides }));
    click(v.button('Quick add row'));
    return v;
  };

  it('SHOWS THE SKU BEFORE ANYTHING IS TYPED', () => {
    // The whole fix: the number is on screen, so it can only be replaced
    // deliberately.
    const v = openRow();
    expect(v.values()).toContain('FTT-000318');
    v.unmount();
  });

  it('TYPING INTO ANY OTHER COLUMN KEEPS THE GENERATED SKU', async () => {
    const onSave = vi.fn();
    const v = openRow({ onSave });
    const cell = itemCell(v, 'FTT-000318');
    setValue(cell, 'iPhone 15');
    blur(cell);
    await act(async () => {});
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].sku).toBe('FTT-000318');
    v.unmount();
  });

  it('TYPING A CUSTOM SKU KEEPS WHAT WAS TYPED — it does not lock the field', async () => {
    const onSave = vi.fn();
    const v = openRow({ onSave });
    const cell = skuCell(v, 'FTT-000318')!;
    setValue(cell, 'eee');
    blur(cell);
    await act(async () => {});
    expect(onSave).toHaveBeenCalledTimes(1);
    // The owner meant this. It is kept, and nothing was lost silently.
    expect(onSave.mock.calls[0][0].sku).toBe('eee');
    v.unmount();
  });

  it('AND A GENERATED SKU IS NO LONGER SILENTLY LOST', async () => {
    // Before the fix the allocator ran, its number was overwritten by the
    // typed text, and the counter had already advanced — so the row saved as
    // `eee` AND a number was burned. Now the allocator is not called at all
    // when the owner has typed their own.
    const onGenerateSku = vi.fn(async () => 'FTT-000318');
    const v = openRow({ onGenerateSku, onSave: vi.fn() });
    const cell = skuCell(v, 'FTT-000318')!;
    setValue(cell, 'eee');
    blur(cell);
    await act(async () => {});
    expect(onGenerateSku).not.toHaveBeenCalled();
    v.unmount();
  });

  it('an UNTOUCHED preview is allocated for real, not trusted', async () => {
    // The preview reserves nothing, so the authoritative number comes from the
    // atomic allocator — which is also what makes two rows in a row distinct.
    const onGenerateSku = vi.fn(async () => 'FTT-000319');
    const onSave = vi.fn();
    const v = openRow({ onGenerateSku, onSave });
    const cell = itemCell(v, 'FTT-000318');
    setValue(cell, 'Pixel 8');
    blur(cell);
    await act(async () => {});
    expect(onGenerateSku).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].sku).toBe('FTT-000319');
    v.unmount();
  });

  it('AN ABANDONED ROW LEAVES NOTHING BEHIND AND BURNS NO NUMBER', async () => {
    // The preview is not a reservation. Opening a row, then another, then
    // walking away must save nothing and allocate nothing.
    const onGenerateSku = vi.fn(async () => 'FTT-000318');
    const onSave = vi.fn();
    const v = openRow({ onGenerateSku, onSave });
    click(v.button('Quick add row'));
    await act(async () => {});
    expect(onSave).not.toHaveBeenCalled();
    expect(onGenerateSku).not.toHaveBeenCalled();
    v.unmount();
  });

  it('TWO ROWS IN A ROW GET DIFFERENT SKUs', async () => {
    // The preview advances because it reads the live counter mirror, and the
    // committed number comes from the allocator either way.
    const allocated = ['FTT-000318', 'FTT-000319'];
    let n = 0;
    const previews = ['FTT-000318', 'FTT-000319'];
    let p = 0;
    const onSave = vi.fn();
    const v = mount(view({
      inventory: [device({ id: 'existing' })],
      onSave,
      onGenerateSku: async () => allocated[n++],
      previewSku: () => previews[p++],
    }));

    click(v.button('Quick add row'));
    let cell = itemCell(v, 'FTT-000318');
    setValue(cell, 'First');
    blur(cell);
    await act(async () => {});

    click(v.button('Quick add row'));
    cell = itemCell(v, 'FTT-000319');
    setValue(cell, 'Second');
    blur(cell);
    await act(async () => {});

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[0][0].sku).toBe('FTT-000318');
    expect(onSave.mock.calls[1][0].sku).toBe('FTT-000319');
    v.unmount();
  });

  it('a caller with no preview starts blank, exactly as before', () => {
    const v = mount(view({ inventory: [device({ id: 'existing' })], previewSku: undefined }));
    click(v.button('Quick add row'));
    expect(v.values()).not.toContain('FTT-000318');
    v.unmount();
  });
});

/* ---------------- 2. Columns follow the tab ---------------- */

describe('the columns follow the tab', () => {
  const laptop = device({ id: 'l1', item: 'Dell XPS 15', deviceType: 'Laptop', cpu: 'i7', ram: '16GB', gpu: 'RTX 3050' });
  const phone = device({ id: 'p1', item: 'iPhone 13', deviceType: 'Phone' });
  const tablet = device({ id: 't1', item: 'iPad 9', deviceType: 'Tablet' });
  const sold = device({ id: 's1', item: 'MacBook Air', deviceType: 'Laptop', soldDate: '2026-10-01' });

  it('LAPTOPS SHOWS CPU, RAM, GPU, SCREEN SIZE AND STORAGE TYPE', () => {
    const v = mount(view({ inventory: [laptop], section: 'laptops' }));
    for (const h of ['CPU', 'RAM', 'GPU', 'Screen Size', 'Storage Type', 'Storage']) {
      expect(v.headers()).toContain(h);
    }
    v.unmount();
  });

  it('AND DOES NOT SHOW BATTERY OR COLOR — always blank on a laptop', () => {
    const v = mount(view({ inventory: [laptop], section: 'laptops' }));
    expect(v.headers()).not.toContain('Battery');
    expect(v.headers()).not.toContain('Color');
    v.unmount();
  });

  it("THE PHONES TAB IS UNCHANGED — Storage, Color and Battery, and no laptop specs", () => {
    const v = mount(view({ inventory: [phone], section: 'phones' }));
    for (const h of ['Storage', 'Color', 'Battery']) expect(v.headers()).toContain(h);
    for (const h of ['CPU', 'RAM', 'GPU', 'Screen Size', 'Storage Type']) {
      expect(v.headers()).not.toContain(h);
    }
    v.unmount();
  });

  it('OTHER keeps the phone-ish set, which is real on a tablet and a watch', () => {
    const v = mount(view({ inventory: [tablet], section: 'other' }));
    for (const h of ['Storage', 'Color', 'Battery']) expect(v.headers()).toContain(h);
    expect(v.headers()).not.toContain('CPU');
    v.unmount();
  });

  it('SOLD keeps a neutral set, because it spans every type', () => {
    const v = mount(view({ inventory: [sold], section: 'sold' }));
    for (const h of ['Storage', 'Color', 'Battery']) expect(v.headers()).toContain(h);
    expect(v.headers()).not.toContain('CPU');
    v.unmount();
  });
});

describe('THE TYPE COLUMN IS GONE FROM PHONES AND LAPTOPS', () => {
  const phone = device({ id: 'p1', deviceType: 'Phone' });
  const tablet = device({ id: 't1', item: 'iPad 9', deviceType: 'Tablet' });
  const sold = device({ id: 's1', soldDate: '2026-10-01' });

  const typeCell = (v: ReturnType<typeof mount>) =>
    v.selects().find(s => Array.from(s.options).some(o => o.value === 'Laptop')
      && Array.from(s.options).some(o => o.value === 'Phone'));

  it('removed — not merely hidden — from Phones and Laptops', () => {
    for (const section of ['phones', 'laptops'] as const) {
      const v = mount(view({ inventory: [phone], section }));
      expect(v.headers()).not.toContain('Type');
      expect(typeCell(v)).toBeUndefined();
      // And NOT in the Columns menu either, which is what "removed" means.
      // Matched on the exact label, since "Storage Type" contains the word.
      click(v.button('Columns'));
      const menuLabels = Array.from(v.host.querySelectorAll('label')).map(l => (l.textContent || '').trim());
      expect(menuLabels).not.toContain('Type');
      expect(menuLabels).toContain('Storage');
      v.unmount();
    }
  });

  it('STILL THERE on Other, which spans four kinds', () => {
    const v = mount(view({ inventory: [tablet], section: 'other' }));
    expect(v.headers()).toContain('Type');
    expect(typeCell(v)).toBeTruthy();
    v.unmount();
  });

  it('and on Sold, which spans everything', () => {
    const v = mount(view({ inventory: [sold], section: 'sold' }));
    expect(v.headers()).toContain('Type');
    v.unmount();
  });
});

describe('every column stays available in the Columns menu', () => {
  it('a laptop spec hidden by default on Phones is still offered there', () => {
    // `hideCol` used to remove these from the menu as well, so they were not
    // hidden-by-default — they were unreachable. This is the difference.
    const v = mount(view({ inventory: [device()], section: 'phones' }));
    expect(v.headers()).not.toContain('CPU');
    click(v.button('Columns'));
    expect(v.text()).toContain('CPU');
    expect(v.text()).toContain('GPU');
    v.unmount();
  });

  it('a phone column hidden by default on Laptops is still offered there', () => {
    const v = mount(view({ inventory: [device({ deviceType: 'Laptop' })], section: 'laptops' }));
    expect(v.headers()).not.toContain('Battery');
    click(v.button('Columns'));
    expect(v.text()).toContain('Battery');
    expect(v.text()).toContain('Color');
    v.unmount();
  });
});

describe('A CUSTOMISED COLUMN SET SURVIVES', () => {
  it('the owner\'s own choice on a tab beats the tab default, and persists', () => {
    // "Never touched it" vs "deliberately set" is decided by whether there is
    // a stored entry for that tab at all.
    const first = mount(view({ inventory: [device({ deviceType: 'Laptop' })], section: 'laptops' }));
    expect(first.headers()).toContain('CPU');
    click(first.button('Columns'));
    const cpuBox = Array.from(first.host.querySelectorAll('label'))
      .find(l => (l.textContent || '').trim() === 'CPU')
      ?.querySelector('input') as HTMLInputElement;
    act(() => { cpuBox.click(); });
    expect(first.headers()).not.toContain('CPU');
    first.unmount();

    // Re-mounted: their choice is still in force, not re-defaulted.
    const second = mount(view({ inventory: [device({ deviceType: 'Laptop' })], section: 'laptops' }));
    expect(second.headers()).not.toContain('CPU');
    // And the other tabs are untouched by it.
    second.unmount();
    const phones = mount(view({ inventory: [device()], section: 'phones' }));
    expect(phones.headers()).toContain('Storage');
    phones.unmount();
  });

  it('A PRE-TABS CUSTOMISED LAYOUT IS HONOURED ON PHONES, and does not hide the laptop specs', () => {
    // Somebody who trimmed the old single Devices tab made that choice about
    // the list Phones is the successor of. Carrying it to Laptops would hide
    // specs they have never seen — the stamping-over problem in reverse.
    localStorage.setItem('inv_hidden_cols_v2', JSON.stringify({ device: ['condition', 'color'], accessory: [] }));
    const phones = mount(view({ inventory: [device()], section: 'phones' }));
    expect(phones.headers()).not.toContain('Color');
    phones.unmount();

    const laptops = mount(view({ inventory: [device({ deviceType: 'Laptop' })], section: 'laptops' }));
    expect(laptops.headers()).toContain('CPU');
    laptops.unmount();
  });
});

/* ---------------- Where the two changes meet ---------------- */

describe('THE TWO FEATURES TOGETHER — columns and transfers on one grid', () => {
  // This PR and multi-store stage 4 both reworked this screen: stage 4 added
  // the In Transit tab and the transfer actions, this one made the columns
  // follow the tab. These are the seams between them, which neither PR's own
  // tests covered because neither existed when the other was written.
  const inTransit = device({ id: 'x1', item: 'iPhone 15', inTransferId: 't1' });
  const laptopInTransit = device({ id: 'x2', item: 'Dell XPS 15', deviceType: 'Laptop', inTransferId: 't1', cpu: 'i7' });

  it('IN TRANSIT GETS A NEUTRAL COLUMN SET — it spans types, like Sold', () => {
    // Without its own entry it fell through to the legacy per-kind default,
    // which no longer hides the spec columns now that they are real — so a
    // list of phones in a car would have shown CPU and GPU.
    const v = mount(view({ inventory: [inTransit, laptopInTransit], section: 'intransit' }));
    for (const h of ['CPU', 'RAM', 'GPU', 'Screen Size', 'Storage Type']) {
      expect(v.headers()).not.toContain(h);
    }
    for (const h of ['Storage', 'Color', 'Battery']) expect(v.headers()).toContain(h);
    v.unmount();
  });

  it('and keeps its Type column, because a phone and a laptop share the car', () => {
    const v = mount(view({ inventory: [inTransit, laptopInTransit], section: 'intransit' }));
    expect(v.headers()).toContain('Type');
    v.unmount();
  });

  it('every column is still offered in the Columns menu on In Transit', () => {
    const v = mount(view({ inventory: [inTransit], section: 'intransit' }));
    click(v.button('Columns'));
    const labels = Array.from(v.host.querySelectorAll('label')).map(l => (l.textContent || '').trim());
    expect(labels).toContain('CPU');
    expect(labels).toContain('Battery');
    expect(labels).toContain('Type');
    v.unmount();
  });

  it('the quick-add row still works on a tab that also carries transfer props', () => {
    const v = mount(view({
      inventory: [device({ id: 'existing' })], section: 'phones',
      locations: [{ id: 'brampton', name: 'Brampton', active: true, createdAt: 1 }],
      activeLocationId: 'brampton',
      onSendTransfer: vi.fn(), onReceiveTransfer: vi.fn(), onCancelTransfer: vi.fn(),
    }));
    click(v.button('Quick add row'));
    expect(v.values()).toContain('FTT-000318');
    // And Phones still has no inline Type cell, transfers or not.
    expect(v.headers()).not.toContain('Type');
    v.unmount();
  });
});
