// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { InventoryView } from './InventoryView';
import { ItemFormModal } from './ItemFormModal';
import { InventoryItem } from '../types';

/**
 * LAPTOPS GET THEIR OWN SPEC FIELDS, AND INVENTORY GETS TABS.
 *
 * The screens, not the logic — domain/deviceSpecs.test.ts pins the rules. What
 * matters here is what somebody actually meets:
 *
 *  • adding from the Laptops tab produces a laptop with no dropdown touched;
 *  • a laptop's form shows its specs and NOT the phone fields;
 *  • a phone's form is exactly what it was;
 *  • a sold laptop is in Sold, not in Laptops, and the screen says so;
 *  • Sold filters by type within the tab;
 *  • retyping an existing row is one control away.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const device = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: `d${Math.random()}`, kind: 'device', sku: 'INV-000001', date: '2026-08-01', item: 'iPhone 13',
  imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', deviceStatus: 'ready', ...p,
});

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    host,
    text: () => host.textContent || '',
    labels: () => Array.from(host.querySelectorAll('label')).map(l => (l.textContent || '').trim()),
    // Row names live in editable <input> cells, so textContent never has
    // them — the grid is read through its input values.
    rowNames: () => Array.from(host.querySelectorAll('input')).map(i => (i as HTMLInputElement).value),
    button: (label: string) => Array.from(host.querySelectorAll('button')).find(b => (b.textContent || '').includes(label)),
    selects: () => Array.from(host.querySelectorAll('select')) as HTMLSelectElement[],
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
const field = (host: HTMLElement, label: string): HTMLInputElement => {
  const l = Array.from(host.querySelectorAll('label')).find(x => (x.textContent || '').trim() === label);
  if (!l) throw new Error(`no field labelled "${label}"`);
  const input = l.parentElement?.querySelector('input, select');
  if (!input) throw new Error(`"${label}" has no input`);
  return input as HTMLInputElement;
};

const view = (props: Partial<React.ComponentProps<typeof InventoryView>> = {}) => (
  <InventoryView
    inventory={[]} deviceBuyers={[]} activity={[]} section="phones"
    onSelectSection={() => {}} onSave={() => {}} onUpdate={() => {}} onDelete={() => {}}
    onGenerateSku={async () => 'INV-000002'} {...props}
  />
);

/* ---------------- The form ---------------- */

describe("a laptop's form", () => {
  const laptopForm = (onSave = vi.fn()) => mount(
    <ItemFormModal initialKind="device" initialDeviceType="Laptop" deviceBuyers={[]}
      onSave={onSave} onGenerateSku={async () => 'INV-000002'} onClose={() => {}} />,
  );

  it('SHOWS CPU, RAM, STORAGE TYPE, SCREEN SIZE AND GPU', () => {
    const v = laptopForm();
    for (const l of ['CPU', 'RAM', 'Storage', 'Storage Type', 'Screen Size', 'GPU']) {
      expect(v.labels()).toContain(l);
    }
    v.unmount();
  });

  it('AND DOES NOT SHOW CARRIER, BATTERY HEALTH OR CONDITION', () => {
    const v = laptopForm();
    for (const l of ['Carrier', 'Battery Health', 'Condition']) {
      expect(v.labels()).not.toContain(l);
    }
    v.unmount();
  });

  it('nor Brand or Model — the whole name goes in the item', () => {
    const v = laptopForm();
    expect(v.labels()).not.toContain('Brand');
    expect(v.labels()).not.toContain('Model');
    expect(v.labels()).toContain('Item Name');
    v.unmount();
  });

  it('shows no device-type dropdown when the tab already decided', () => {
    const v = laptopForm();
    expect(v.text()).toContain('Laptop');
    // The type is stated as a fact; the only selects left are Storage Type and
    // Status, neither of which is the device type.
    const options = v.selects().flatMap(s => Array.from(s.options).map(o => o.value));
    expect(options).not.toContain('Tablet');
    v.unmount();
  });

  it('ASKS FOR ITS NAME — even with a serial, which would be enough for a phone', () => {
    // The discriminating case. A blank form is unsaveable for every kind of
    // item, so a blank laptop proves nothing: this one HAS a serial, which
    // satisfies the ordinary "any identity will do" rule, and is still
    // refused because a laptop has no brand or model to be named by.
    const onSave = vi.fn();
    const v = laptopForm(onSave);
    setValue(v.host.querySelector('input[placeholder="Scan or type IMEI"]') as HTMLInputElement, 'SERIAL123');
    expect(v.text()).toMatch(/Give the laptop a name/i);
    expect(v.button('Save')?.hasAttribute('disabled')).toBe(true);
    // Naming it is what unlocks the save.
    setValue(field(v.host, 'Item Name'), 'Dell XPS 15');
    expect(v.button('Save')?.hasAttribute('disabled')).toBe(false);
    v.unmount();
  });

  it('saves a laptop with its specs once named', async () => {
    const onSave = vi.fn();
    const v = laptopForm(onSave);
    setValue(field(v.host, 'Item Name'), 'Dell XPS 15');
    setValue(field(v.host, 'CPU'), 'i7-11800H');
    setValue(field(v.host, 'RAM'), '16GB');
    setValue(field(v.host, 'Storage'), '512GB');
    setValue(field(v.host, 'GPU'), 'RTX 3050');
    await act(async () => { click(v.button('Save')); });
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as InventoryItem;
    expect(saved).toMatchObject({
      deviceType: 'Laptop', item: 'Dell XPS 15', cpu: 'i7-11800H', ram: '16GB', storage: '512GB', gpu: 'RTX 3050',
    });
    // No condition was invented for it.
    expect(saved.condition).toBe('');
    v.unmount();
  });
});

describe("a phone's form is unchanged", () => {
  it('still has Brand, Model, Carrier, Battery Health and Condition, and no laptop specs', () => {
    const v = mount(
      <ItemFormModal initialKind="device" initialDeviceType="Phone" deviceBuyers={[]}
        onSave={vi.fn()} onGenerateSku={async () => 'INV-000002'} onClose={() => {}} />,
    );
    for (const l of ['Brand', 'Model', 'Storage', 'Color', 'Carrier', 'Battery Health', 'Condition']) {
      expect(v.labels()).toContain(l);
    }
    for (const l of ['CPU', 'RAM', 'GPU', 'Screen Size', 'Storage Type']) {
      expect(v.labels()).not.toContain(l);
    }
    v.unmount();
  });

  it('still saves on an IMEI alone, with no item name typed', async () => {
    const onSave = vi.fn();
    const v = mount(
      <ItemFormModal initialKind="device" initialDeviceType="Phone" deviceBuyers={[]}
        onSave={onSave} onGenerateSku={async () => 'INV-000002'} onClose={() => {}} />,
    );
    setValue(v.host.querySelector('input[placeholder="Scan or type IMEI"]') as HTMLInputElement, '351234567890123');
    await act(async () => { click(v.button('Save')); });
    expect(onSave).toHaveBeenCalledTimes(1);
    v.unmount();
  });
});

describe('editing an existing item', () => {
  it('OFFERS THE TYPE PICKER, so a mistyped row can be put right', () => {
    const v = mount(
      <ItemFormModal initial={device({ deviceType: 'Phone', item: 'MacBook Pro 14' })} deviceBuyers={[]}
        onSave={vi.fn()} onGenerateSku={async () => 'INV-000002'} onClose={() => {}} />,
    );
    const typeSelect = v.selects().find(s => Array.from(s.options).some(o => o.value === 'Laptop'));
    expect(typeSelect).toBeTruthy();
    expect(typeSelect!.value).toBe('Phone');
    v.unmount();
  });

  it('a laptop that was once a phone says what it kept, rather than hiding it', () => {
    const v = mount(
      <ItemFormModal initial={device({ deviceType: 'Laptop', item: 'XPS 15', carrier: 'Unlocked', batteryHealth: '92%' })}
        deviceBuyers={[]} onSave={vi.fn()} onGenerateSku={async () => 'INV-000002'} onClose={() => {}} />,
    );
    expect(v.text()).toMatch(/Kept from before this was a laptop/i);
    expect(v.text()).toMatch(/Carrier/);
    expect(v.text()).toMatch(/Nothing was deleted/i);
    v.unmount();
  });
});

/* ---------------- Adding from a tab ---------------- */

describe('ADDING FROM THE LAPTOPS TAB', () => {
  const addButton = (v: ReturnType<typeof mount>) =>
    Array.from(v.host.querySelectorAll('button')).find(b => /^Add Device$|^Add$|Add Device/.test((b.textContent || '').trim()));

  it('PRODUCES A LAPTOP WITH NO DROPDOWN TOUCHED', async () => {
    // The whole fix, end to end through the real screen: the tab decides the
    // type, so there is nothing to leave on its 'Phone' default.
    const onSave = vi.fn();
    const v = mount(view({ inventory: [], section: 'laptops', onSave }));
    const add = addButton(v);
    expect(add).toBeTruthy();
    click(add);
    // The form opened knowing what it is: no device-type picker at all.
    expect(v.labels()).toContain('CPU');
    expect(v.labels()).not.toContain('Carrier');
    const typePicker = v.selects().find(sel => Array.from(sel.options).some(o => o.value === 'Tablet'));
    expect(typePicker).toBeUndefined();

    setValue(field(v.host, 'Item Name'), 'Dell XPS 15');
    await act(async () => { click(v.button('Save')); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0][0] as InventoryItem).deviceType).toBe('Laptop');
    v.unmount();
  });

  it('and adding from the Phones tab produces a phone the same way', async () => {
    const onSave = vi.fn();
    const v = mount(view({ inventory: [], section: 'phones', onSave }));
    click(addButton(v));
    expect(v.labels()).toContain('Carrier');
    expect(v.labels()).not.toContain('CPU');
    setValue(field(v.host, 'Item Name (override)'), 'iPhone 14');
    await act(async () => { click(v.button('Save')); });
    expect((onSave.mock.calls[0][0] as InventoryItem).deviceType).toBe('Phone');
    v.unmount();
  });

  it('but the OTHER tab still asks, because it covers four kinds', () => {
    const v = mount(view({ inventory: [], section: 'other', onSave: vi.fn() }));
    click(addButton(v));
    const typePicker = v.selects().find(sel => Array.from(sel.options).some(o => o.value === 'Tablet'));
    expect(typePicker).toBeTruthy();
    v.unmount();
  });
});

/* ---------------- The tabs ---------------- */

describe('the tabs', () => {
  const phone = device({ id: 'p1', item: 'iPhone 13', deviceType: 'Phone' });
  const laptop = device({ id: 'l1', item: 'Dell XPS 15', deviceType: 'Laptop' });
  const soldLaptop = device({ id: 'l2', item: 'MacBook Air', deviceType: 'Laptop', soldDate: '2026-10-01', salePrice: 700 });
  const tablet = device({ id: 't1', item: 'iPad 9', deviceType: 'Tablet' });
  const all = [phone, laptop, soldLaptop, tablet];

  it('Laptops shows laptops in stock, and NOT the sold one', () => {
    const v = mount(view({ inventory: all, section: 'laptops' }));
    expect(v.rowNames()).toContain('Dell XPS 15');
    expect(v.rowNames()).not.toContain('MacBook Air');
    v.unmount();
  });

  it('AND SAYS WHERE THE SOLD ONE WENT, rather than leaving someone to wonder', () => {
    const v = mount(view({ inventory: all, section: 'laptops' }));
    expect(v.text()).toMatch(/In stock only/i);
    expect(v.text()).toMatch(/Sold tab/i);
    v.unmount();
  });

  it('Phones shows the phone and neither laptop', () => {
    const v = mount(view({ inventory: all, section: 'phones' }));
    expect(v.rowNames()).toContain('iPhone 13');
    expect(v.rowNames()).not.toContain('Dell XPS 15');
    expect(v.rowNames()).not.toContain('iPad 9');
    v.unmount();
  });

  it('OTHER shows the tablet, and offers a type picker when adding', () => {
    const v = mount(view({ inventory: all, section: 'other' }));
    expect(v.rowNames()).toContain('iPad 9');
    expect(v.rowNames()).not.toContain('iPhone 13');
    expect(v.text()).toMatch(/Tablets, watches, consoles and desktop PCs/i);
    v.unmount();
  });

  it('SOLD shows everything sold, whatever kind', () => {
    const v = mount(view({ inventory: all, section: 'sold' }));
    expect(v.rowNames()).toContain('MacBook Air');
    expect(v.text()).toMatch(/every kind of device together/i);
    v.unmount();
  });

  it('and FILTERS BY TYPE within the tab', () => {
    const soldPhone = device({ id: 'p2', item: 'Pixel 7', deviceType: 'Phone', soldDate: '2026-10-02' });
    const v = mount(view({ inventory: [...all, soldPhone], section: 'sold' }));
    expect(v.rowNames()).toContain('MacBook Air');
    expect(v.rowNames()).toContain('Pixel 7');
    const typeFilter = v.host.querySelector('select[aria-label="Sold device type"]') as HTMLSelectElement;
    expect(typeFilter).toBeTruthy();
    act(() => {
      typeFilter.value = 'Laptop';
      typeFilter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(v.rowNames()).toContain('MacBook Air');
    expect(v.rowNames()).not.toContain('Pixel 7');
    v.unmount();
  });

  it('counts each tab with the same rule it filters by', () => {
    const v = mount(view({ inventory: all, section: 'phones' }));
    const tab = (label: string) => Array.from(v.host.querySelectorAll('button'))
      .find(b => (b.textContent || '').startsWith(label));
    expect(tab('Phones')?.textContent).toContain('1');
    expect(tab('Laptops')?.textContent).toContain('1');   // the sold one is not counted here
    expect(tab('Sold')?.textContent).toContain('1');
    expect(tab('Other')?.textContent).toContain('1');
    v.unmount();
  });

  it('AN UNTYPED DEVICE APPEARS — in Phones, never nowhere', () => {
    const untyped = device({ id: 'u1', item: 'Galaxy S21' });
    const v = mount(view({ inventory: [untyped], section: 'phones' }));
    expect(v.rowNames()).toContain('Galaxy S21');
    v.unmount();
  });
});

describe('retyping an existing row', () => {
  it('is an editable Type cell in the grid', () => {
    const onUpdate = vi.fn();
    const v = mount(view({ inventory: [device({ id: 'p1', item: 'MacBook Pro', deviceType: 'Phone' })], section: 'phones', onUpdate }));
    const cell = v.selects().find(s => Array.from(s.options).some(o => o.value === 'Laptop')
      && Array.from(s.options).some(o => o.value === 'Phone'));
    expect(cell).toBeTruthy();
    act(() => {
      cell!.value = 'Laptop';
      cell!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onUpdate).toHaveBeenCalledWith('p1', 'deviceType', 'Laptop');
    v.unmount();
  });
});
