// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { QuickPurchaseView } from './QuickPurchaseView';

/**
 * A QUICK PURCHASE DISAPPEARED, BEHIND THE WORD "SAVED".
 *
 * commit() called onSave without awaiting it and then, on the very next line,
 * said "Saved" and wiped the form. App.tsx's handler is async and re-throws
 * when SKU allocation fails — so a failed purchase was reported as added, with
 * everything the staff member had typed already gone.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const byLabel = (host: HTMLElement, label: string): HTMLInputElement => {
  const el = [...host.querySelectorAll('label')].find(l => l.textContent?.trim() === label);
  return el!.parentElement!.querySelector('input')!;
};

const type = (el: HTMLInputElement, value: string) => {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const saveButton = (host: HTMLElement): HTMLButtonElement =>
  [...host.querySelectorAll('button')].find(b => /add to inventory|adding/i.test(b.textContent || ''))! as HTMLButtonElement;

const clickSave = (host: HTMLElement) => {
  act(() => { saveButton(host).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

/** Fill the three required fields and press the button. */
const fillAndSave = (host: HTMLElement) => {
  type(byLabel(host, 'Device'), 'iPhone 13 Pro 256GB');
  type(byLabel(host, 'Purchase Price'), '400');
  clickSave(host);
};

const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

describe('Quick Purchase only says "Saved" once it is', () => {
  it('KEEPS THE FORM AND SHOWS THE REAL REASON when the save fails', async () => {
    const onSave = vi.fn().mockRejectedValue(
      new Error('A SKU cannot be allocated while offline — reconnect and try again.'),
    );
    const m = mount(<QuickPurchaseView inventory={[]} onSave={onSave} />);
    fillAndSave(m.host);
    await flush();

    expect(onSave).toHaveBeenCalledTimes(1);
    // Nothing to retype: every field is exactly as it was.
    expect(byLabel(m.host, 'Device').value).toBe('iPhone 13 Pro 256GB');
    expect(byLabel(m.host, 'Purchase Price').value).toBe('400');
    // And it says what actually went wrong, not "Saved".
    expect(m.host.textContent).toContain('Not saved.');
    expect(m.host.textContent).toContain('A SKU cannot be allocated while offline');
    expect(m.host.textContent).not.toContain('Added "iPhone 13 Pro 256GB"');
    m.unmount();
  });

  it('translates a raw Firestore permission refusal into plain words', async () => {
    const onSave = vi.fn().mockRejectedValue(Object.assign(new Error('[firebase] x'), { code: 'permission-denied' }));
    const m = mount(<QuickPurchaseView inventory={[]} onSave={onSave} />);
    fillAndSave(m.host);
    await flush();
    expect(m.host.textContent).toContain("You don't have permission to save this.");
    m.unmount();
  });

  it('clears the form and confirms exactly once on success', async () => {
    const onSave = vi.fn().mockResolvedValue({ queued: false });
    const m = mount(<QuickPurchaseView inventory={[]} onSave={onSave} />);
    fillAndSave(m.host);
    await flush();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(byLabel(m.host, 'Device').value).toBe('');
    expect(byLabel(m.host, 'Purchase Price').value).toBe('');
    expect(m.host.textContent).toContain('Added "iPhone 13 Pro 256GB"');
    expect(m.host.textContent).not.toContain('Not saved.');
    m.unmount();
  });

  it('says so when the write only queued offline, rather than claiming it landed', async () => {
    const onSave = vi.fn().mockResolvedValue({ queued: true });
    const m = mount(<QuickPurchaseView inventory={[]} onSave={onSave} />);
    fillAndSave(m.host);
    await flush();
    expect(m.host.textContent).toContain("Offline — it will sync when you're back online.");
    m.unmount();
  });

  it('a second attempt after a failure still works — the guard does not stick', async () => {
    // The double-tap guard (hooks/useSubmitGuard.ts) holds the button for its
    // cooldown after ANY attempt, failed ones included — that is deliberate,
    // since a second write at a busy counter is worse than a second wait. What
    // matters is that it always clears itself, so a retry is possible.
    vi.useFakeTimers();
    try {
      const onSave = vi.fn()
        .mockRejectedValueOnce(new Error('Network unreachable'))
        .mockResolvedValueOnce({ queued: false });
      const m = mount(<QuickPurchaseView inventory={[]} onSave={onSave} />);
      fillAndSave(m.host);
      await flush();
      expect(m.host.textContent).toContain('Not saved.');
      expect(saveButton(m.host).disabled).toBe(true);

      act(() => { vi.advanceTimersByTime(3000); });
      expect(saveButton(m.host).disabled).toBe(false);

      // The form is still filled, so pressing the button again is the whole retry.
      clickSave(m.host);
      await flush();
      expect(onSave).toHaveBeenCalledTimes(2);
      expect(m.host.textContent).not.toContain('Not saved.');
      m.unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
