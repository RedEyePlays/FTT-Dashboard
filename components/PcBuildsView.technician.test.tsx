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

/**
 * Text and number fields now hold a local draft and commit on blur, so the
 * caret survives mid-word editing (hooks/useFieldDraft.ts). React delegates
 * onBlur to focusout, so a bare 'blur' event would never reach the handler.
 */
const blur = (el: HTMLInputElement) => {
  act(() => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
};
const setAndCommit = (el: HTMLInputElement, value: string) => { setValue(el, value); blur(el); };

const button = (host: HTMLElement, re: RegExp): HTMLButtonElement =>
  [...host.querySelectorAll('button')].find(b => re.test(b.textContent || ''))! as HTMLButtonElement;

const inputAfterLabel = (host: HTMLElement, label: string): HTMLInputElement => {
  const el = [...host.querySelectorAll('label')].find(l => l.textContent?.trim() === label);
  return el!.parentElement!.querySelector('input')!;
};

/** A technician's props. There is no cost flag: opening a build IS the grant. */
const techProps = (builds: PcBuild[], over: Record<string, unknown> = {}) => ({
  builds,
  inventory: [],
  customers: [],
  currentUserId: 'tech-uid',
  currentUserEmail: 'tech@shop.test',
  labourRate: 15,
  warrantyDays: 90,
  statusHost: 'https://status.shop.test',
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
    setAndCommit(costField, '400');

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
    setAndCommit(nameField, 'Starter Gaming PC');
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

/**
 * WHOEVER CAN WORK ON A BUILD SEES EVERYTHING ON IT.
 *
 * This used to assert the opposite: a technician typed a part cost once and
 * then saw the word "Recorded", locked, with the Parts and Total cost tiles
 * reading "Recorded" too. That hid the numbers from the person who had just
 * gone out and bought the parts — they could not check or correct their own
 * entry. The owner's decision reversed it.
 *
 * The boundary is this screen and nothing beyond it — see
 * PcBuildsView.costScope.test.tsx.
 */
describe('a technician sees the real numbers on a build', () => {
  const open = () => {
    const m = mount(<PcBuildsView {...techProps([ready()])} />);
    click(button(m.host, /Bench Build/));
    return m;
  };

  it('shows the part cost as a FIGURE, not as "Recorded"', () => {
    const m = open();
    expect(m.text()).not.toContain(RECORDED_LABEL);
    const costField = [...m.host.querySelectorAll('input')]
      .find(i => (i as HTMLInputElement).placeholder === 'Cost') as HTMLInputElement;
    expect(costField.value).toBe('400');
    m.unmount();
  });

  it('LETS THEM CORRECT IT AFTER IT IS SET — the whole complaint', () => {
    const onSave = vi.fn();
    const m = mount(<PcBuildsView {...techProps([ready()], { onSave })} />);
    click(button(m.host, /Bench Build/));

    const costField = [...m.host.querySelectorAll('input')]
      .find(i => (i as HTMLInputElement).placeholder === 'Cost') as HTMLInputElement;
    expect(costField.disabled).toBe(false);       // not locked once set
    setAndCommit(costField, '385');
    expect((onSave.mock.calls.at(-1)![0] as PcBuild).parts[0].cost).toBe(385);
    m.unmount();
  });

  it('shows Parts, Labour and Total cost as real numbers', () => {
    const m = open();
    expect(m.text()).toContain('$400.00');       // Parts and Total cost
    expect(m.text()).not.toContain(RECORDED_LABEL);
    m.unmount();
  });

  it('shows the margin against the target, and the labour rate', () => {
    const m = open();
    expect(m.text()).toMatch(/Profit/);
    expect(m.text()).toMatch(/margin/i);
    expect(m.text()).toContain('$15.00/hr');
    m.unmount();
  });

  it('still shows the price, which was never the problem', () => {
    // The Target tile is now an editable field rather than a rendered figure,
    // so the price lives in the input's value — a technician can both see it
    // and set it, which is the same rule as every other number on this screen.
    const m = open();
    const price = Array.from(m.host.querySelectorAll('input[type="number"]'))
      .find(i => (i as HTMLInputElement).placeholder === '—') as HTMLInputElement;
    expect(price).toBeTruthy();
    expect(price.value).toBe('1200');
    expect(price.disabled).toBe(false);
    m.unmount();
  });

  it('shows RETAIL PRICE on the row itself, no "More" needed', () => {
    const m = mount(<PcBuildsView {...techProps([ready({
      parts: [{ id: 'p1', category: 'GPU', name: 'RTX 4070', cost: 500, condition: 'new',
        source: 'retail', retailPrice: 700, retailCheckedAt: '2026-09-20' }],
    })])} />);
    click(button(m.host, /Bench Build/));

    const retail = [...m.host.querySelectorAll('input')]
      .find(i => (i as HTMLInputElement).placeholder === 'Retail') as HTMLInputElement;
    expect(retail).toBeTruthy();
    expect(retail.value).toBe('700');
    expect(retail.disabled).toBe(false);
    // The date travels with it, quietly — a stale price must look stale.
    expect(m.text()).toContain('2026-09-20');
    m.unmount();
  });

  it('LOCKS a SOLD build for everyone — that lock is about the record, not the viewer', () => {
    const m = mount(<PcBuildsView {...techProps([ready({ status: 'sold' })])} />);
    click(button(m.host, /Completed/));   // a sold build leaves the working list
    click(button(m.host, /Bench Build/));

    const costField = [...m.host.querySelectorAll('input')]
      .find(i => (i as HTMLInputElement).placeholder === 'Cost') as HTMLInputElement;
    expect(costField.disabled).toBe(true);
    // …but the figure is still readable. Locked is not hidden.
    expect(costField.value).toBe('400');
    expect(m.text()).toContain('$400.00');
    m.unmount();
  });
});
