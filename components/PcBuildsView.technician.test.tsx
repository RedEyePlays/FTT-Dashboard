// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { PcBuildsView } from './PcBuildsView';
import { PcBuild } from '../types';
import { can } from '../services/rbac';
import { RECORDED_LABEL } from '../domain/costVisibility';

/**
 * THE PEOPLE WHO BUILD THE MACHINES CAN USE THE SECTION.
 *
 * PC Builds shipped gated on 'inventory.add', which a technician does not
 * hold — so the staff the feature exists for could not open it at all. It now
 * has its own permission, 'builds.manage', held by every human role.
 *
 * services/rbac.test.ts pins who holds the permission and rules-tests pin what
 * the database allows. This file is the third leg: that a technician, once
 * through the gate, gets the WHOLE feature — create, parts with costs, labour,
 * status, price and finishing a shelf build — and that giving them that did
 * not also hand them the shop's cost figures.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    host,
    render: (next: React.ReactElement) => { act(() => root.render(next)); },
    text: () => host.textContent || '',
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

const setValue = (el: HTMLInputElement | HTMLSelectElement, value: string) => {
  act(() => {
    const proto = el instanceof window.HTMLSelectElement
      ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof window.HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
};

const click = (el: Element) => {
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

const button = (host: HTMLElement, re: RegExp): HTMLButtonElement =>
  [...host.querySelectorAll('button')].find(b => re.test(b.textContent || ''))! as HTMLButtonElement;

const inputAfterLabel = (host: HTMLElement, label: string): HTMLInputElement => {
  const el = [...host.querySelectorAll('label')].find(l => l.textContent?.trim() === label);
  return el!.parentElement!.querySelector('input')!;
};

/** A technician's props: they hold builds.manage, but never cost visibility. */
const techProps = (builds: PcBuild[], over: Record<string, unknown> = {}) => ({
  builds,
  inventory: [],
  customers: [],
  canViewCost: false,            // reports.profit.detailed — technicians never have it
  currentUserId: 'tech-uid',
  currentUserEmail: 'tech@shop.test',
  labourRate: 15,
  warrantyDays: 90,
  onSave: () => {},
  onFinishBuild: () => {},
  ...over,
});

const ready = (p: Partial<PcBuild> = {}): PcBuild => ({
  id: 'b1', name: 'Bench Build', kind: 'shelf', status: 'ready',
  parts: [{ id: 'p1', category: 'CPU', name: 'Ryzen 7 7800X3D', cost: 400, condition: 'new', source: 'retail' }],
  labour: [], createdBy: 'tech-uid', createdByEmail: 'tech@shop.test',
  targetPrice: 1200, createdAt: 1, updatedAt: 1, ...p,
});

describe('a technician holds the permission the section is gated on', () => {
  it("'builds.manage', not 'inventory.add' — the gate that locked them out", () => {
    expect(can('technician', 'builds.manage')).toBe(true);
    expect(can('technician', 'inventory.add')).toBe(false);
  });
});

describe('and gets the whole feature', () => {
  it('CREATES a build, with a target price', () => {
    const onSave = vi.fn();
    const m = mount(<PcBuildsView {...techProps([], { onSave })} />);

    click(button(m.host, /Build to sell/));
    setValue(inputAfterLabel(m.host, 'Build name'), 'Bench Build');
    setValue(inputAfterLabel(m.host, 'Target price'), '1200');
    click(button(m.host, /^Create$/));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as PcBuild;
    expect(saved.name).toBe('Bench Build');
    expect(saved.targetPrice).toBe(1200);
    expect(saved.kind).toBe('shelf');
    expect(saved.createdByEmail).toBe('tech@shop.test');
    m.unmount();
  });

  it('ADDS A PART AND ENTERS ITS COST', () => {
    const onSave = vi.fn();
    const build = ready({ parts: [], status: 'planning' });
    const m = mount(<PcBuildsView {...techProps([build], { onSave })} />);
    click(button(m.host, /Bench Build/));

    click(button(m.host, /Add part/));
    const added = onSave.mock.calls[0][0] as PcBuild;
    expect(added.parts).toHaveLength(1);

    // Re-render with the part present (the detail stays open) and type a cost.
    m.render(<PcBuildsView {...techProps([added], { onSave })} />);
    const costField = [...m.host.querySelectorAll('input')]
      .find(i => (i as HTMLInputElement).placeholder === 'Cost') as HTMLInputElement;
    expect(costField).toBeTruthy();       // enterable, not locked
    expect(costField.disabled).toBe(false);
    setValue(costField, '400');

    const withCost = onSave.mock.calls.at(-1)![0] as PcBuild;
    expect(withCost.parts[0].cost).toBe(400);
    m.unmount();
  });

  it('LOGS LABOUR, with the rate snapshotted', () => {
    const onSave = vi.fn();
    const m = mount(<PcBuildsView {...techProps([ready()], { onSave })} />);
    click(button(m.host, /Bench Build/));

    setValue(inputAfterLabel(m.host, 'Hours'), '3');
    click(button(m.host, /Log time/));

    const saved = onSave.mock.calls.at(-1)![0] as PcBuild;
    expect(saved.labour).toHaveLength(1);
    expect(saved.labour[0].hours).toBe(3);
    expect(saved.labour[0].rate).toBe(15);            // snapshotted, not looked up later
    expect(saved.labour[0].userEmail).toBe('tech@shop.test');
    m.unmount();
  });

  it('MOVES THE STATUS along the pipeline', () => {
    const onSave = vi.fn();
    const m = mount(<PcBuildsView {...techProps([ready({ status: 'assembling' })], { onSave })} />);
    click(button(m.host, /Bench Build/));

    click(button(m.host, /^Testing$/));
    expect((onSave.mock.calls.at(-1)![0] as PcBuild).status).toBe('testing');
    m.unmount();
  });

  it('SETS THE NAME, and can PRINT both customer-facing pieces', () => {
    const onSave = vi.fn();
    const m = mount(<PcBuildsView {...techProps([ready()], { onSave })} />);
    click(button(m.host, /Bench Build/));

    const nameField = m.host.querySelector('input[value="Bench Build"]') as HTMLInputElement;
    setValue(nameField, 'Starter Gaming PC');
    expect((onSave.mock.calls.at(-1)![0] as PcBuild).name).toBe('Starter Gaming PC');

    expect(button(m.host, /Spec sheet/)).toBeTruthy();
    expect(button(m.host, /Display card/)).toBeTruthy();
    m.unmount();
  });

  it('FINISHES A SHELF BUILD — which creates the inventory device', () => {
    const onFinishBuild = vi.fn();
    const m = mount(<PcBuildsView {...techProps([ready()], { onFinishBuild })} />);
    click(button(m.host, /Bench Build/));

    click(button(m.host, /Finish build/));
    expect(onFinishBuild).toHaveBeenCalledTimes(1);
    expect((onFinishBuild.mock.calls[0][0] as PcBuild).id).toBe('b1');
    m.unmount();
  });
});

describe('without becoming financial', () => {
  it('a recorded cost reads back as "Recorded", never as a figure', () => {
    const m = mount(<PcBuildsView {...techProps([ready()])} />);
    click(button(m.host, /Bench Build/));

    // The $400 part cost is not on the page in any form.
    expect(m.text()).toContain(RECORDED_LABEL);
    expect(m.text()).not.toContain('$400.00');
    // Nor the totals, profit or margin that reading costs would give.
    expect(m.text()).not.toMatch(/Profit \$/);
    expect(m.text()).not.toMatch(/margin/i);
    m.unmount();
  });

  it('but the PRICE is theirs to set and to see — a price is not a cost', () => {
    const m = mount(<PcBuildsView {...techProps([ready()])} />);
    click(button(m.host, /Bench Build/));
    expect(m.text()).toContain('$1200.00');
    m.unmount();
  });

  it('an owner, by contrast, sees the figures', () => {
    const m = mount(<PcBuildsView {...techProps([ready()], { canViewCost: true })} />);
    click(button(m.host, /Bench Build/));
    expect(m.text()).toContain('$400.00');
    expect(m.text()).toMatch(/Profit/);
    m.unmount();
  });
});
