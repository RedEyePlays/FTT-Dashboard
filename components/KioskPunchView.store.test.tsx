// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { KioskPunchView } from './KioskPunchView';
import { kioskStoreFor } from '../domain/kiosk';
import { KioskStaff, TimeEntry } from '../types';

/**
 * WHAT THE PERSON AT THE DOOR SEES — multi-store stage 3.
 *
 * Two things, and both of them are about not being quietly wrong:
 *
 *  1. THE SCREEN SAYS WHICH SHOP IT IS. The shop has twice been bitten by a
 *     screen not saying what it was showing; this one decides where somebody's
 *     pay is filed, so the store is named on it.
 *
 *  2. AN UNCONFIGURED KIOSK REFUSES, VISIBLY. No name tiles, no keypad, no
 *     punch — and a sentence saying to get the owner. A tappable name on a
 *     kiosk that cannot file the punch correctly is worse than no name at all,
 *     because staff would believe they had clocked in.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    text: () => host.textContent || '',
    buttons: () => [...host.querySelectorAll('button')] as HTMLButtonElement[],
    click: (label: string) => {
      const b = [...host.querySelectorAll('button')].find(x => (x.textContent || '').includes(label));
      if (!b) throw new Error(`no button matching ${label}`);
      act(() => { (b as HTMLButtonElement).click(); });
    },
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

const alice: KioskStaff = {
  id: 'u1', uid: 'u1', displayName: 'Alice', workspaceId: 'ws', active: true,
  pinHash: 'h', pinSalt: 's', pinIterations: 150000, updatedAt: 1,
};

const view = (store: ReturnType<typeof kioskStoreFor> | undefined, onClockIn = vi.fn(), entries: TimeEntry[] = []) => ({
  onClockIn,
  el: (
    <KioskPunchView
      staff={[alice]} entries={entries} shopName="FlipThatTech" store={store}
      onClockIn={onClockIn} onClockOut={vi.fn()} onStartBreak={vi.fn()} onEndBreak={vi.fn()}
      onSignOut={vi.fn()}
    />
  ),
});

describe('a configured kiosk', () => {
  const store = kioskStoreFor({ kioskLocationId: 'mississauga', kioskLocationName: 'Mississauga' });

  it('NAMES ITS STORE, where nobody can miss it', () => {
    const v = mount(view(store).el);
    expect(v.text()).toContain('Mississauga');
    // And says what that means, rather than leaving a bare place name.
    expect(v.text()).toMatch(/hours recorded here|recorded at Mississauga/i);
    v.unmount();
  });

  it('still takes punches — the name tiles are there', () => {
    const v = mount(view(store).el);
    expect(v.text()).toContain('Alice');
    v.unmount();
  });
});

describe('AN UNCONFIGURED KIOSK', () => {
  const store = kioskStoreFor({});

  it('refuses, and says why and whose job it is', () => {
    const v = mount(view(store).el);
    expect(v.text()).toContain("This kiosk isn't set up yet");
    expect(v.text()).toMatch(/get the owner/i);
    expect(v.text()).toMatch(/Clock-in kiosk/);
    v.unmount();
  });

  it('SHOWS NO NAME TILES — nobody can believe they clocked in', () => {
    const v = mount(view(store).el);
    expect(v.text()).not.toContain('Alice');
    v.unmount();
  });

  it('and offers something to do instead of a dead end', () => {
    const v = mount(view(store).el);
    expect(v.text()).toMatch(/clock in on your phone|ask a manager/i);
    v.unmount();
  });

  it('cannot be made to punch by any button on the screen', () => {
    const { el, onClockIn } = view(store);
    const v = mount(el);
    // The only controls left are the footer's sign-out and nothing that punches.
    for (const b of v.buttons()) act(() => { b.click(); });
    expect(onClockIn).not.toHaveBeenCalled();
    v.unmount();
  });
});

describe('a kiosk in a workspace with no store list at all', () => {
  it('behaves exactly as it did before this stage', () => {
    // `store` omitted: the caller has no device record to resolve from.
    const v = mount(view(undefined).el);
    expect(v.text()).toContain('Alice');
    expect(v.text()).toContain('Tap your name to clock in or out');
    v.unmount();
  });
});
