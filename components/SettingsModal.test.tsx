// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { SettingsModal } from './SettingsModal';
import { AppData } from '../types';

// canManageSettings was accepted as a prop but never actually referenced
// anywhere in the component body — the Restore section rendered
// unconditionally regardless of its value. This mounts the real component
// (React 19 act(), happy-dom) to prove the fix: a non-owner session sees no
// way to trigger a restore at all, matching what App.tsx's handleRestoreData
// already enforces server-side (settings.manage).

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const data: AppData = { inventory: [], notes: [], tasks: [] };

function mount(canManageSettings: boolean) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <SettingsModal
        onClose={() => {}}
        currentData={data}
        onRestore={vi.fn().mockResolvedValue(undefined)}
        canManageSettings={canManageSettings}
      />
    );
  });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

describe('SettingsModal restore gating (canManageSettings)', () => {
  it('shows the Restore Data section for a manager/owner session', () => {
    const h = mount(true);
    expect(h.host.textContent).toContain('Restore Data');
    expect(h.host.textContent).toContain('Select Backup File');
    h.unmount();
  });

  it('hides the Restore Data section entirely for a non-owner session', () => {
    const h = mount(false);
    expect(h.host.textContent).not.toContain('Restore Data');
    expect(h.host.textContent).not.toContain('Select Backup File');
    h.unmount();
  });
});
