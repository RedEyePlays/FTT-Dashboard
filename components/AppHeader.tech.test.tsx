// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { AppHeader } from './AppHeader';
import { Permission, Role, ViewState } from '../types';
import { can } from '../services/rbac';

/**
 * ONE BUTTON, IN THE CORNER.
 *
 * The technician shell had no navigation at all, so 'builds.manage' was a
 * permission a technician held and could never use. The owner's decision was
 * explicitly NOT to give technicians a full nav — one button that switches to
 * PC Builds and back, and nothing else.
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

const buttons = (host: HTMLElement) => [...host.querySelectorAll('button')];
const button = (host: HTMLElement, re: RegExp) =>
  buttons(host).find(b => re.test(b.textContent || ''));
const click = (el: Element) => { act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };

/** The header as the technician shell renders it. */
const techHeader = (view: ViewState, onNavigate: (v: ViewState) => void, role: Role = 'technician') => (
  <AppHeader
    isTech
    view={view}
    onNavigate={onNavigate}
    allow={(p: Permission) => can(role, p)}
    userEmail="tech@shop.test"
    userRole={role}
    darkMode={false}
    onToggleTheme={() => {}}
    onToggleAiSidebar={() => {}}
    onOpenFinder={() => {}}
    onOpenSettings={() => {}}
    onOpenBulk={() => {}}
    onStartAdd={() => {}}
    onLock={() => {}}
    onManualLock={() => {}}
  />
);

describe('the technician header', () => {
  it('OFFERS PC BUILDS from the repairs screen', () => {
    const onNavigate = vi.fn();
    const m = mount(techHeader('repairs', onNavigate));

    const btn = button(m.host, /PC Builds/);
    expect(btn).toBeTruthy();
    click(btn!);
    expect(onNavigate).toHaveBeenCalledWith('pcbuilds');
    m.unmount();
  });

  it('OFFERS THE WAY BACK from the builds screen', () => {
    const onNavigate = vi.fn();
    const m = mount(techHeader('pcbuilds', onNavigate));

    const btn = button(m.host, /My Repairs/);
    expect(btn).toBeTruthy();
    click(btn!);
    expect(onNavigate).toHaveBeenCalledWith('repairs');
    // The label names the DESTINATION, so it reads as an action from either
    // side rather than as a tab that might already be selected.
    expect(button(m.host, /PC Builds/)).toBeUndefined();
    m.unmount();
  });

  it('is ONE button, not a tab bar — both are never shown at once', () => {
    for (const view of ['repairs', 'pcbuilds'] as ViewState[]) {
      const m = mount(techHeader(view, () => {}));
      const shown = ['PC Builds', 'My Repairs'].filter(l => m.text().includes(l));
      expect({ view, shown: shown.length }).toEqual({ view, shown: 1 });
      m.unmount();
    }
  });

  it('opens NO other destination — no Inventory, Reports, Customers or Settings', () => {
    const m = mount(techHeader('repairs', () => {}));
    const text = m.text();
    for (const label of ['Inventory', 'Reports', 'Customers', 'Quick Sale', 'Quick Purchase',
      'Drop-Offs', 'Dashboard', 'Analytics', 'Audit', 'Users', 'Time Clock', 'Close Out', 'Notes']) {
      expect({ label, present: text.includes(label) }).toEqual({ label, present: false });
    }
    m.unmount();
  });

  it('a technician without the permission sees the header exactly as before', () => {
    // Defensive: if the owner revokes builds.manage, nothing new appears.
    const m = mount(techHeader('repairs', () => {}, 'technician'));
    expect(m.text()).toContain('PC Builds');
    m.render(
      <AppHeader
        isTech view="repairs" onNavigate={() => {}}
        allow={(p: Permission) => p !== 'builds.manage' && can('technician', p)}
        userEmail="tech@shop.test" userRole="technician" darkMode={false}
        onToggleTheme={() => {}} onToggleAiSidebar={() => {}} onOpenFinder={() => {}}
        onOpenSettings={() => {}} onOpenBulk={() => {}} onStartAdd={() => {}}
        onLock={() => {}} onManualLock={() => {}}
      />,
    );
    expect(m.text()).not.toContain('PC Builds');
    expect(m.text()).toContain('Repairs');
    m.unmount();
  });
});

describe('other roles are unaffected', () => {
  it('an owner still gets the full navigation, not the technician header', () => {
    const m = mount(
      <AppHeader
        view="dashboard" onNavigate={() => {}}
        allow={(p: Permission) => can('owner', p)}
        userEmail="owner@shop.test" userRole="owner" darkMode={false}
        onToggleTheme={() => {}} onToggleAiSidebar={() => {}} onOpenFinder={() => {}}
        onOpenSettings={() => {}} onOpenBulk={() => {}} onStartAdd={() => {}}
        onLock={() => {}} onManualLock={() => {}}
      />,
    );
    const text = m.text();
    expect(text).toContain('Inventory');
    expect(text).toContain('Quick Sale');
    expect(text).toContain('PC Builds');
    // And never the technician shell's back button.
    expect(text).not.toContain('My Repairs');
    m.unmount();
  });
});
