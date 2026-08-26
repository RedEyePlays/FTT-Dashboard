// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { RestoreConfirmModal } from './RestoreConfirmModal';
import { AppData } from '../types';

// The whole point of this modal is that a destructive restore CANNOT proceed
// without the explicit, hard-to-reflex-dismiss confirmation the task asked
// for — mounted here for real (React 19 act(), happy-dom) rather than
// asserted on props/markup, so a wiring mistake (e.g. the button not
// actually being disabled) would fail this the same way it'd fail a real
// user.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const data: AppData = {
  inventory: [{ id: 'i1' } as any, { id: 'i2' } as any],
  notes: [], tasks: [],
  customers: [{ id: 'c1' } as any],
  salesTransactions: [{ id: 's1' } as any, { id: 's2' } as any, { id: 's3' } as any],
};

function mount(onConfirm: (mode: 'merge' | 'replace') => Promise<void>, onCancel = () => {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<RestoreConfirmModal data={data} exportedAtMs={Date.parse('2026-06-01T00:00:00Z')} onCancel={onCancel} onConfirm={onConfirm} />);
  });
  return {
    host,
    confirmBtn: () => Array.from(host.querySelectorAll('button')).find(b => /merge backup|permanently replace/i.test(b.textContent || ''))!,
    replaceRadio: () => host.querySelector('input[type="radio"][name="restore-mode"]:nth-of-type(2)') as HTMLInputElement,
    radios: () => Array.from(host.querySelectorAll('input[type="radio"]')) as HTMLInputElement[],
    phraseInput: () => host.querySelector('input[type="text"], input:not([type])') as HTMLInputElement,
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

describe('RestoreConfirmModal', () => {
  it('shows the backup date and record counts so the owner can sanity-check the file before confirming', () => {
    const h = mount(vi.fn());
    expect(h.host.textContent).toContain(new Date(Date.parse('2026-06-01T00:00:00Z')).toLocaleString());
    expect(h.host.textContent).toContain('2 inventory items');
    expect(h.host.textContent).toContain('3 sales');
    expect(h.host.textContent).toContain('1 customers');
    h.unmount();
  });

  it('defaults to Merge and lets a merge confirm through with no typed phrase', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const h = mount(onConfirm);
    const btn = h.confirmBtn();
    expect(btn.disabled).toBe(false);
    await act(async () => { btn.click(); });
    expect(onConfirm).toHaveBeenCalledWith('merge');
    h.unmount();
  });

  it('Replace All cannot be confirmed without typing the exact phrase — this is the core safety property', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const h = mount(onConfirm);
    const radios = h.radios();
    act(() => { radios[1].click(); }); // select "Replace all"

    const btn = h.confirmBtn();
    expect(btn.disabled).toBe(true);
    await act(async () => { btn.click(); });
    expect(onConfirm).not.toHaveBeenCalled();

    // A near-miss (wrong case, extra text) still doesn't unlock it.
    const input = h.host.querySelector('input[placeholder="DELETE MY DATA"]') as HTMLInputElement;
    const setValue = (v: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        setter.call(input, v);
        input.dispatchEvent(new (window as any).Event('input', { bubbles: true }));
      });
    };
    setValue('delete my data');
    expect(h.confirmBtn().disabled).toBe(true);

    setValue('DELETE MY DATA');
    expect(h.confirmBtn().disabled).toBe(false);
    await act(async () => { h.confirmBtn().click(); });
    expect(onConfirm).toHaveBeenCalledWith('replace');
    h.unmount();
  });

  it('the destructive-consequence copy is present and unmissable, and the typed-phrase gate only appears once Replace All is selected', () => {
    const h = mount(vi.fn());
    // Visible up front (not hidden behind selecting the dangerous option
    // first) — the owner should see the consequence before choosing it.
    expect(h.host.textContent).toContain('permanently deleted');
    expect(h.host.textContent?.toLowerCase()).toContain('cannot be undone');
    expect(h.host.querySelector('input[placeholder="DELETE MY DATA"]')).toBeNull();
    act(() => { h.radios()[1].click(); });
    expect(h.host.querySelector('input[placeholder="DELETE MY DATA"]')).not.toBeNull();
    h.unmount();
  });

  it('states the automatic safety snapshot explicitly', () => {
    const h = mount(vi.fn());
    expect(h.host.textContent).toMatch(/backup of your current data is downloaded automatically/i);
    h.unmount();
  });

  it('shows an unknown-date message for a backup with no timestamp, rather than a blank or wrong date', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(<RestoreConfirmModal data={data} exportedAtMs={undefined} onCancel={() => {}} onConfirm={vi.fn()} />);
    });
    expect(host.textContent).toContain('unknown');
    act(() => root.unmount());
    host.remove();
  });

  it('surfaces a rejection from onConfirm as an error rather than silently closing', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('network blip'));
    const h = mount(onConfirm);
    await act(async () => { h.confirmBtn().click(); });
    expect(h.host.textContent).toContain('network blip');
    h.unmount();
  });
});
