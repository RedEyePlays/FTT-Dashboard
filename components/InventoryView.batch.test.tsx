// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { InventoryView } from './InventoryView';
import { InventoryItem } from '../types';

/**
 * BUILDING A BATCH, AND THE SELECTION SURVIVING IT.
 *
 * Selling thirty devices to a wholesale buyer meant ticking thirty checkboxes,
 * and the screen fought it the whole way: the selection was wiped by every
 * search, tab, filter and sort change; "select all" only covered the current
 * 50-row page; and the scanner types into the SEARCH box, so each scan both
 * filtered the table and — through that same wipe — threw away everything
 * ticked so far. The one fast way to find a device was the way that destroyed
 * the batch.
 *
 * Two things are asserted here, and they are deliberately in tension:
 *   • a BUILT batch survives the search, the tab, the filter and the sort;
 *   • a HAND-TICKED selection still does not. That wipe is right for ticks
 *     scoped to what is on screen, and the pin is what tells them apart.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: `d${Math.random()}`, kind: 'device', sku: 'FTT-000001', date: '2026-11-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready', deviceType: 'Phone', ...p,
});

const INV: InventoryItem[] = [
  device({ id: 'p1', sku: 'FTT-000101', item: 'iPhone 13', imei: '490154203237518' }),
  device({ id: 'p2', sku: 'FTT-000102', item: 'iPhone 14', imei: '356789012340002' }),
  device({ id: 'p3', sku: 'FTT-000103', item: 'Pixel 8' }),
  device({ id: 'l1', sku: 'FTT-000201', item: 'Dell XPS 15', deviceType: 'Laptop' }),
  device({ id: 's1', sku: 'FTT-000301', item: 'iPhone 11', soldDate: '2026-10-01', deviceStatus: 'sold' }),
  device({ id: 'r1', sku: 'FTT-000401', item: 'iPhone 15', deviceStatus: 'reserved' }),
];

beforeEach(() => { localStorage.clear(); });

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
  act(() => {
    setNative.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const pressEnter = (el: Element) => act(() => {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
});

const view = (props: Partial<React.ComponentProps<typeof InventoryView>> = {}) => (
  <InventoryView
    inventory={INV} deviceBuyers={[]} activity={[]} section="phones" userId="owner-uid"
    onSelectSection={() => {}} onSave={() => {}} onUpdate={() => {}} onDelete={() => {}}
    onGenerateSku={async () => 'FTT-000318'} previewSku={() => 'FTT-000318'}
    {...props}
  />
);

const searchBox = (v: ReturnType<typeof mount>) =>
  v.host.querySelector('input[placeholder]') as HTMLInputElement;
const pasteBox = (v: ReturnType<typeof mount>) =>
  v.host.querySelector('textarea[aria-label="Identifiers to add"]') as HTMLTextAreaElement;

/** Open the paste panel, put `text` in it, resolve it. Nothing is added yet. */
const paste = (v: ReturnType<typeof mount>, text: string) => {
  click(v.host.querySelector('button[title="Paste a list of SKUs, IMEIs or serials and select all of them"]')!);
  typeInto(pasteBox(v), text);
  click(v.button('Find these'));
};

/* ======================================================================== *
 * 1. A PASTED LIST BECOMES THE SELECTION
 * ======================================================================== */

describe('pasting a list selects those rows', () => {
  it('whatever shape the list arrives in, and across tabs', () => {
    const v = mount(view());
    // A SKU with the prefix, one without (the form printed on a shelf tag), a
    // grouped IMEI, and a laptop — which is not even on the open tab.
    paste(v, 'FTT-000101\n000103\n35 678901 234000 2\nFTT-000201');
    expect(v.text()).toContain('4 found');
    click(v.button('Add 4 to selection'));
    expect(v.text()).toContain('4 selected');
    v.unmount();
  });

  it('NOTHING is selected until the owner has read what it found', () => {
    const v = mount(view());
    paste(v, 'FTT-000101\nFTT-999999');
    expect(v.text()).not.toMatch(/\d+ selected/);
    // …and the miss is named, by identifier.
    expect(v.text()).toContain('1 found · 1 not found');
    expect(v.text()).toContain('FTT-999999');
    v.unmount();
  });

  it('names a sold or reserved match rather than quietly including it', () => {
    const v = mount(view());
    paste(v, 'FTT-000301\nFTT-000401');
    expect(v.text()).toContain('already sold');
    expect(v.text()).toContain('reserved for a customer');
    // Named, not blocked: both are still selected.
    click(v.button('Add 2 to selection'));
    expect(v.text()).toContain('2 selected');
    v.unmount();
  });

  it('a second paste ADDS to the batch rather than replacing it', () => {
    const v = mount(view());
    paste(v, 'FTT-000101');
    click(v.button('Add 1 to selection'));
    paste(v, 'FTT-000102\nFTT-000103');
    click(v.button('Add 2 to selection'));
    expect(v.text()).toContain('3 selected');
    v.unmount();
  });

  it('…and the same device twice is still one row in the batch', () => {
    const v = mount(view());
    paste(v, 'FTT-000101');
    click(v.button('Add 1 to selection'));
    paste(v, 'FTT-000101\n490154203237518');   // same device, both identifiers
    click(v.button('Add 2 to selection'));
    expect(v.text()).toContain('1 selected');
    v.unmount();
  });
});

/* ======================================================================== *
 * 2. THE BATCH SURVIVES WHAT USED TO WIPE IT
 * ======================================================================== */

describe('a built batch survives the screen', () => {
  const built = () => {
    const v = mount(view());
    paste(v, 'FTT-000101\nFTT-000102');
    click(v.button('Add 2 to selection'));
    expect(v.text()).toContain('2 selected');
    return v;
  };

  it('survives a search', () => {
    const v = built();
    typeInto(searchBox(v), 'Pixel');
    expect(v.text()).toContain('2 selected');
    v.unmount();
  });

  it('survives switching tabs', () => {
    const v = built();
    v.rerender(view({ section: 'laptops' }));
    expect(v.text()).toContain('2 selected');
    v.rerender(view({ section: 'sold' }));
    expect(v.text()).toContain('2 selected');
    v.unmount();
  });

  it('survives a sort', () => {
    const v = built();
    const header = Array.from(v.host.querySelectorAll('th')).find(t => (t.textContent || '').includes('Item'));
    click(header);
    expect(v.text()).toContain('2 selected');
    v.unmount();
  });

  it('survives a status filter', () => {
    const v = built();
    click(v.button('Filters'));
    const status = v.host.querySelector('select') as HTMLSelectElement;
    act(() => {
      status.value = 'reserved';
      status.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(v.text()).toContain('2 selected');
    v.unmount();
  });

  it('says on screen that it is being kept', () => {
    const v = built();
    expect(v.text()).toContain('batch kept across filters');
    v.unmount();
  });

  it('and Clear is the one thing that empties it', () => {
    const v = built();
    click(v.button('Clear'));
    expect(v.text()).not.toContain('2 selected');
    v.unmount();
  });
});

/* ======================================================================== *
 * 3. A HAND-TICKED SELECTION IS STILL WIPED — THE OTHER HALF OF THE DECISION
 * ======================================================================== */

describe('ticking rows by hand keeps the old behaviour', () => {
  // Row 0 is FTT-000101, which the batch tests also paste — ticking THAT one
  // would toggle it off. The untouched row is the honest one to tick.
  const tick = (v: ReturnType<typeof mount>, row = 0) =>
    click(v.host.querySelectorAll('button[title="Select"]')[row]);

  it('a tick is wiped by a search, because it was scoped to what was on screen', () => {
    const v = mount(view());
    tick(v);
    expect(v.text()).toContain('1 selected');
    typeInto(searchBox(v), 'Pixel');
    expect(v.text()).not.toContain('1 selected');
    v.unmount();
  });

  it('a tick is NOT pinned, so it carries no "kept" badge', () => {
    const v = mount(view());
    tick(v);
    expect(v.text()).toContain('1 selected');
    expect(v.text()).not.toContain('batch kept across filters');
    v.unmount();
  });

  it('clearing a batch un-pins, so the next hand-tick is wiped again', () => {
    const v = mount(view());
    paste(v, 'FTT-000101');
    click(v.button('Add 1 to selection'));
    click(v.button('Clear'));
    tick(v, 2);
    typeInto(searchBox(v), 'Pixel');
    expect(v.text()).not.toMatch(/\d+ selected/);
    v.unmount();
  });

  it('a tick ADDED to a built batch is kept with it — one selection, one rule', () => {
    const v = mount(view());
    paste(v, 'FTT-000101');
    click(v.button('Add 1 to selection'));
    tick(v, 2);
    expect(v.text()).toContain('2 selected');
    typeInto(searchBox(v), 'Pixel');
    expect(v.text()).toContain('2 selected');
    v.unmount();
  });
});

/* ======================================================================== *
 * 4. SCANNING ADDS INSTEAD OF FILTERING
 * ======================================================================== */

describe('scan-to-add', () => {
  const enableScanAdds = (v: ReturnType<typeof mount>) =>
    click(v.host.querySelector('button[title^="Switch the scanner to ADD"]')!);

  const scan = (v: ReturnType<typeof mount>, code: string) => {
    const box = searchBox(v);
    typeInto(box, code);
    pressEnter(box);
  };

  it('is off by default — Enter still finds and opens, as it always did', () => {
    const v = mount(view());
    scan(v, 'FTT-000101');
    expect(v.text()).not.toMatch(/\d+ selected/);
    v.unmount();
  });

  it('is an explicit mode, and says so where the scanner types', () => {
    const v = mount(view());
    enableScanAdds(v);
    expect(searchBox(v).placeholder).toContain('ADD to the batch');
    expect(v.text()).toContain('adding to batch');
    v.unmount();
  });

  it('each scan adds one device and empties the box, so nothing is filtered', () => {
    const v = mount(view());
    enableScanAdds(v);
    scan(v, 'FTT-000101');
    expect(v.text()).toContain('1 selected');
    expect(searchBox(v).value).toBe('');     // the query never lingers
    scan(v, '490154203237518');              // the same device, by IMEI
    expect(v.text()).toContain('1 selected');
    scan(v, '356789012340002');              // a second device
    expect(v.text()).toContain('2 selected');
    v.unmount();
  });

  it('a scan that matches nothing says so instead of silently doing nothing', () => {
    const v = mount(view());
    enableScanAdds(v);
    scan(v, '999999999999999');
    expect(v.text()).toMatch(/No device with IMEI/);
    expect(v.text()).not.toMatch(/\d+ selected/);
    v.unmount();
  });

  it('a scan-built batch is pinned too', () => {
    const v = mount(view());
    enableScanAdds(v);
    scan(v, 'FTT-000101');
    expect(v.text()).toContain('batch kept across filters');
    v.unmount();
  });
});

/* ======================================================================== *
 * 5. SELLING THE BATCH AS ONE SALE
 * ======================================================================== */

describe('sending the batch to Quick Sale', () => {
  const build = (onSellSelection: (ids: string[]) => void, list = 'FTT-000101\nFTT-000102') => {
    const v = mount(view({ onSellSelection }));
    paste(v, list);
    click(v.button(`Add ${list.split('\n').length} to selection`));
    click(v.button('Sell as one sale'));
    return v;
  };

  it('hands over exactly the devices that are going', () => {
    const onSellSelection = vi.fn();
    const v = build(onSellSelection);
    click(v.button('Send 2 to Quick Sale'));
    expect(onSellSelection).toHaveBeenCalledWith(['p1', 'p2']);
    v.unmount();
  });

  it('shows the lot total at target prices, and says no price is set for you', () => {
    const v = build(() => {});
    expect(v.text()).toContain('2 devices to the cart');
    expect(v.text()).toContain('Nothing is priced for you');
    v.unmount();
  });

  it('names a sold device as NOT sent, and a reserved one as going', () => {
    const v = build(() => {}, 'FTT-000101\nFTT-000301\nFTT-000401');
    expect(v.text()).toContain('already sold — not sent');
    expect(v.text()).toContain('reserved for a customer');
    // Two go (the ordinary one and the reserved one), one does not.
    expect(v.button('Send 2 to Quick Sale')).toBeTruthy();
    v.unmount();
  });

  it('nothing is handed over until the confirmation, and Cancel hands over nothing', () => {
    const onSellSelection = vi.fn();
    const v = build(onSellSelection);
    expect(onSellSelection).not.toHaveBeenCalled();
    click(v.button('Cancel'));
    expect(onSellSelection).not.toHaveBeenCalled();
    expect(v.text()).toContain('2 selected');   // the batch is still there
    v.unmount();
  });

  it('clears the selection afterwards, so the same lot cannot be sent twice', () => {
    const v = build(() => {});
    click(v.button('Send 2 to Quick Sale'));
    expect(v.text()).not.toMatch(/\d+ selected/);
    v.unmount();
  });

  it('the action is absent without selling permission', () => {
    const v = mount(view());           // no onSellSelection
    paste(v, 'FTT-000101');
    click(v.button('Add 1 to selection'));
    expect(v.button('Sell as one sale')).toBeUndefined();
    v.unmount();
  });
});

/* ======================================================================== *
 * 6. THE PASTE BOX KEEPS FOCUS WHILE YOU TYPE
 * ======================================================================== */

describe('typing into the paste dialog', () => {
  // The reported bug, at the real call site: every keystroke re-rendered
  // InventoryView, gave ResponsiveDialog's inline `onClose` a new identity,
  // re-ran its focus effect and pulled the caret out of this textarea. See
  // components/responsive.focus.test.tsx for the fix.
  it('keeps the caret in the textarea for a whole multi-line paste', () => {
    const v = mount(view());
    click(v.host.querySelector('button[title="Paste a list of SKUs, IMEIs or serials and select all of them"]')!);
    const box = pasteBox(v);
    act(() => { box.focus(); });
    const text = 'FTT-000101\nFTT-000102';
    for (let k = 1; k <= text.length; k++) {
      typeInto(box, text.slice(0, k));
      expect(document.activeElement, `after ${k} chars`).toBe(box);
    }
    expect(box.value).toBe(text);
    v.unmount();
  });
});
