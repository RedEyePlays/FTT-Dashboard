// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { PcBuildsView } from './PcBuildsView';
import { PcBuild } from '../types';

/**
 * "EDITING A PART NAME MID-WORD SENDS THE CURSOR TO THE END."
 *
 * Every input was controlled straight off the saved build, and every keystroke
 * wrote to Firestore. The subscription echoed the document back, React
 * re-rendered the input with the round-tripped string, and the browser put the
 * caret at the end — so fixing one letter in the middle of "RTX 4070 Windfroce"
 * meant retyping the rest.
 *
 * domain/fieldDraft.test.ts pins the rule. This drives the real component:
 * a keystroke writes nothing, blur commits, the debounce catches somebody who
 * walks away, and an update arriving mid-edit does not clobber the draft.
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
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

const click = (el: Element) => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const button = (host: HTMLElement, re: RegExp) =>
  [...host.querySelectorAll('button')].find(b => re.test(b.textContent || ''))!;

/** Type into an input the way a browser does, preserving the caret. */
const typeInto = (el: HTMLInputElement, value: string, caret?: number) => {
  act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    if (caret != null) el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const focus = (el: HTMLInputElement) => { act(() => { el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); el.focus(); }); };
// React delegates onFocus/onBlur to focusin/focusout, so a bare 'blur' event
// (which does not bubble) would never reach the handler.
const blur = (el: HTMLInputElement) => { act(() => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); }); };

const build = (p: Partial<PcBuild> = {}): PcBuild => ({
  id: 'b1', name: 'Bench Build', kind: 'shelf', status: 'planning',
  parts: [{ id: 'p1', category: 'GPU', name: 'RTX 4070 Windfroce', cost: 500, condition: 'new', source: 'retail' }],
  labour: [], createdBy: 'u1', createdByEmail: 'sam@shop.test',
  targetPrice: 1200, createdAt: 1, updatedAt: 1, ...p,
});

const props = (builds: PcBuild[], onSave: (b: PcBuild) => void) => ({
  builds, inventory: [], customers: [],
  currentUserId: 'u1', currentUserEmail: 'sam@shop.test',
  labourRate: 15, warrantyDays: 90,
  onSave, onFinishBuild: () => {},
});

/** Open the build and hand back its part-name input. */
const openName = (m: ReturnType<typeof mount>) => {
  click(button(m.host, /Bench Build/));
  return [...m.host.querySelectorAll('input')]
    .find(i => (i as HTMLInputElement).placeholder?.startsWith('Exact model')) as HTMLInputElement;
};

describe('a part field keeps the caret', () => {
  it('WRITES NOTHING ON A KEYSTROKE — the round-trip is what moved the caret', () => {
    const onSave = vi.fn();
    const m = mount(<PcBuildsView {...props([build()], onSave)} />);
    const name = openName(m);

    focus(name);
    // Fixing "Windfroce" → "Windforce": one letter, mid-string.
    typeInto(name, 'RTX 4070 Windforce', 15);

    expect(onSave).not.toHaveBeenCalled();
    // The caret is exactly where it was put, and the text is the draft.
    expect(name.selectionStart).toBe(15);
    expect(name.value).toBe('RTX 4070 Windforce');
    m.unmount();
  });

  it('commits ON BLUR', () => {
    const onSave = vi.fn();
    const m = mount(<PcBuildsView {...props([build()], onSave)} />);
    const name = openName(m);

    focus(name);
    typeInto(name, 'RTX 4070 Windforce');
    blur(name);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0][0] as PcBuild).parts[0].name).toBe('RTX 4070 Windforce');
    m.unmount();
  });

  it('commits AFTER THE PAUSE, so an edit is not lost if nobody blurs', () => {
    vi.useFakeTimers();
    try {
      const onSave = vi.fn();
      const m = mount(<PcBuildsView {...props([build()], onSave)} />);
      const name = openName(m);

      focus(name);
      typeInto(name, 'RTX 4070 Windforce');
      expect(onSave).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(600); });
      expect(onSave).toHaveBeenCalledTimes(1);
      expect((onSave.mock.calls[0][0] as PcBuild).parts[0].name).toBe('RTX 4070 Windforce');
      m.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('DOES NOT CLOBBER THE DRAFT when an update arrives mid-edit', () => {
    const onSave = vi.fn();
    const m = mount(<PcBuildsView {...props([build()], onSave)} />);
    const name = openName(m);

    focus(name);
    typeInto(name, 'RTX 4070 Windforce', 15);

    // The subscription delivers a different value underneath — the echo of an
    // earlier save, or a colleague's edit. Either way it must not replace what
    // is being typed.
    m.render(<PcBuildsView {...props([build({ parts: [{ ...build().parts[0], name: 'SOMETHING ELSE' }] })], onSave)} />);

    expect(name.value).toBe('RTX 4070 Windforce');
    expect(name.selectionStart).toBe(15);
    m.unmount();
  });

  it('takes the saved value once the field is left', () => {
    const onSave = vi.fn();
    const m = mount(<PcBuildsView {...props([build()], onSave)} />);
    const name = openName(m);
    blur(name);

    m.render(<PcBuildsView {...props([build({ parts: [{ ...build().parts[0], name: 'RTX 4080' }] })], onSave)} />);
    expect(name.value).toBe('RTX 4080');
    m.unmount();
  });

  it('writes nothing when the value did not actually change', () => {
    const onSave = vi.fn();
    const m = mount(<PcBuildsView {...props([build()], onSave)} />);
    const name = openName(m);

    focus(name);
    blur(name);          // tabbed through without editing
    expect(onSave).not.toHaveBeenCalled();
    m.unmount();
  });

  it('applies to the BUILD NAME too, not only the part row', () => {
    const onSave = vi.fn();
    const m = mount(<PcBuildsView {...props([build()], onSave)} />);
    click(button(m.host, /Bench Build/));
    const nameField = m.host.querySelector('input[value="Bench Build"]') as HTMLInputElement;

    focus(nameField);
    typeInto(nameField, 'Bench Build 2');
    expect(onSave).not.toHaveBeenCalled();

    blur(nameField);
    expect((onSave.mock.calls.at(-1)![0] as PcBuild).name).toBe('Bench Build 2');
    m.unmount();
  });

  const retailField = (m: ReturnType<typeof mount>) => {
    click(button(m.host, /Bench Build/));
    return [...m.host.querySelectorAll('input')]
      .find(i => (i as HTMLInputElement).placeholder === 'Retail') as HTMLInputElement;
  };

  it('a typed price commits, stamped with the date it was checked', () => {
    const onSave = vi.fn();
    const m = mount(<PcBuildsView {...props([build()], onSave)} />);
    const retail = retailField(m);

    focus(retail);
    typeInto(retail, '700');
    blur(retail);

    const saved = (onSave.mock.calls.at(-1)![0] as PcBuild).parts[0];
    expect(saved.retailPrice).toBe(700);
    expect(saved.retailCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    m.unmount();
  });

  it('CLEARING a price removes it rather than setting it to zero', () => {
    // "Unknown retail price" and "this part is free" are different facts, and
    // a 0 would quietly join the retail total as a real figure.
    const onSave = vi.fn();
    const priced = build({ parts: [{ ...build().parts[0], retailPrice: 700, retailCheckedAt: '2026-09-01' }] });
    const m = mount(<PcBuildsView {...props([priced], onSave)} />);
    const retail = retailField(m);
    expect(retail.value).toBe('700');

    focus(retail);
    typeInto(retail, '');
    blur(retail);

    const saved = (onSave.mock.calls.at(-1)![0] as PcBuild).parts[0];
    expect(saved.retailPrice).toBeUndefined();
    // The date goes with it — a date with no price behind it is noise.
    expect(saved.retailCheckedAt).toBeUndefined();
    m.unmount();
  });
});
