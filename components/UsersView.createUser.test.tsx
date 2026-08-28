// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { UsersView } from './UsersView';
import { AppUser, Role } from '../types';

// The "Create a user" action — sets email, password, and an optional PIN
// directly, instead of a "pending invite" the new hire has to self-claim.
// Mounts the real component, same pattern as UsersView.passwordReset.test.tsx.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mkUser = (id: string, role: Role, email = `${id}@shop.test`): AppUser => ({
  id, email, role, workspaceId: 'owner-uid',
} as AppUser);

const owner = mkUser('owner-uid', 'owner');
const manager = mkUser('manager-uid', 'manager');
const users = [owner, manager];

interface MountOpts {
  me?: AppUser;
  canManageAll?: boolean;
  onCreateUser?: (input: { email: string; password: string; role: Role; pin?: string }) => Promise<string | null>;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function mount({ me = owner, canManageAll = true, onCreateUser }: MountOpts = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <UsersView
        me={me}
        users={users}
        invites={[]}
        canManageAll={canManageAll}
        onSetRole={vi.fn()}
        onSetDisabled={vi.fn()}
        onSetAllowProfit={vi.fn()}
        onInvite={vi.fn()}
        onDeleteInvite={vi.fn()}
        onCreateUser={onCreateUser}
      />,
    );
  });
  return host;
}

const buttons = (label: string) =>
  Array.from(host.querySelectorAll('button')).filter(b => (b.textContent || '').includes(label));

const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });

const typeInto = (selector: string, value: string) => {
  const input = host.querySelector<HTMLInputElement>(selector)!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('Create a user — panel visibility', () => {
  it('renders the "Create a user" panel (and hides the invite panel) once onCreateUser is wired', () => {
    mount({ onCreateUser: vi.fn() });
    expect(host.textContent).toContain('Create a user');
    expect(host.textContent).not.toContain('Invite a user');
  });

  it('falls back to the invite panel when onCreateUser is absent', () => {
    mount({ onCreateUser: undefined });
    expect(host.textContent).toContain('Invite a user');
    expect(buttons('Create User')).toHaveLength(0);
  });

  it('the "Or send an invite instead" link reveals the invite panel alongside it', () => {
    mount({ onCreateUser: vi.fn() });
    expect(host.textContent).not.toContain('Send Invite');
    click(buttons('Or send an invite instead')[0]);
    expect(host.textContent).toContain('Send Invite');
  });

  it('a manager session (canManageAll false) sees "Create a technician" and only the technician role', () => {
    mount({ me: manager, canManageAll: false, onCreateUser: vi.fn() });
    expect(host.textContent).toContain('Create a technician');
    click(buttons('Create User')[0]);
    const roleSelect = host.querySelector('select') as HTMLSelectElement;
    expect(roleSelect.disabled).toBe(true);
    expect(roleSelect.value).toBe('technician');
  });
});

describe('the create-user dialog', () => {
  it('warns that nothing is emailed', () => {
    mount({ onCreateUser: vi.fn() });
    click(buttons('Create User')[0]);
    expect(host.textContent).toContain('No email is sent');
  });

  it('keeps submit disabled until email + password are valid and confirmed', () => {
    mount({ onCreateUser: vi.fn() });
    click(buttons('Create User')[0]);
    const submit = () => buttons('Create User').find(b => b.closest('[role="dialog"]')) as HTMLButtonElement;

    expect(submit().disabled).toBe(true); // nothing entered
    typeInto('#new-user-email', 'not-an-email');
    typeInto('#new-user-password', 'shopfloor42');
    typeInto('#new-user-confirm-password', 'shopfloor42');
    expect(submit().disabled).toBe(true); // bad email
    typeInto('#new-user-email', 'jordan@yourshop.local');
    expect(submit().disabled).toBe(false);
  });

  it('rejects a weak password the same way the reset dialog does', () => {
    mount({ onCreateUser: vi.fn() });
    click(buttons('Create User')[0]);
    typeInto('#new-user-email', 'jordan@yourshop.local');
    typeInto('#new-user-password', 'short1');
    typeInto('#new-user-confirm-password', 'short1');
    const submit = buttons('Create User').find(b => b.closest('[role="dialog"]')) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('a mismatched confirm-password blocks submit and shows the mismatch', () => {
    mount({ onCreateUser: vi.fn() });
    click(buttons('Create User')[0]);
    typeInto('#new-user-email', 'jordan@yourshop.local');
    typeInto('#new-user-password', 'shopfloor42');
    typeInto('#new-user-confirm-password', 'shopfloorXX');
    expect(host.textContent).toContain("Passwords don't match.");
    const submit = buttons('Create User').find(b => b.closest('[role="dialog"]')) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('submits without a PIN when "Set a PIN now too" is left unchecked', async () => {
    const onCreateUser = vi.fn().mockResolvedValue(null);
    mount({ onCreateUser });
    click(buttons('Create User')[0]);
    typeInto('#new-user-email', 'jordan@yourshop.local');
    typeInto('#new-user-password', 'shopfloor42');
    typeInto('#new-user-confirm-password', 'shopfloor42');
    const submit = buttons('Create User').find(b => b.closest('[role="dialog"]')) as HTMLButtonElement;
    await act(async () => { click(submit); });
    // Default role is the first option offered to this caller (owner → 'manager').
    expect(onCreateUser).toHaveBeenCalledWith({ email: 'jordan@yourshop.local', password: 'shopfloor42', role: 'manager', pin: undefined });
  });

  it('requires a valid, matching PIN before submit is enabled once "Set a PIN now too" is checked', () => {
    mount({ onCreateUser: vi.fn() });
    click(buttons('Create User')[0]);
    typeInto('#new-user-email', 'jordan@yourshop.local');
    typeInto('#new-user-password', 'shopfloor42');
    typeInto('#new-user-confirm-password', 'shopfloor42');
    // Scoped to the dialog — UsersView's own members list also renders a
    // "Financials" checkbox per staff row, which a bare document-order query
    // would find first.
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    const pinCheckbox = dialog.querySelector('input[type="checkbox"]') as HTMLInputElement;
    click(pinCheckbox);
    const submit = () => buttons('Create User').find(b => b.closest('[role="dialog"]')) as HTMLButtonElement;
    expect(submit().disabled).toBe(true); // no PIN yet

    const pinInputs = Array.from(dialog.querySelectorAll('input[inputmode="numeric"]')) as HTMLInputElement[];
    const setValue = (el: HTMLInputElement, v: string) => {
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        setter.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    };
    setValue(pinInputs[0], '1234');
    expect(submit().disabled).toBe(true); // not confirmed yet
    setValue(pinInputs[1], '5678');
    expect(host.textContent).toContain("PINs don't match.");
    expect(submit().disabled).toBe(true);
    setValue(pinInputs[1], '1234');
    expect(submit().disabled).toBe(false);
  });

  it('a double-click fires create exactly once (useSubmitGuard)', async () => {
    let resolve!: (v: string | null) => void;
    const onCreateUser = vi.fn(() => new Promise<string | null>(r => { resolve = r; }));
    mount({ onCreateUser });
    click(buttons('Create User')[0]);
    typeInto('#new-user-email', 'jordan@yourshop.local');
    typeInto('#new-user-password', 'shopfloor42');
    typeInto('#new-user-confirm-password', 'shopfloor42');

    const submit = buttons('Create User').find(b => b.closest('[role="dialog"]')) as HTMLButtonElement;
    click(submit);
    click(submit); // same tick — state hasn't re-rendered yet
    click(submit);

    expect(onCreateUser).toHaveBeenCalledTimes(1);
    await act(async () => { resolve(null); });
  });

  it('shows the server\'s refusal instead of claiming success', async () => {
    const onCreateUser = vi.fn().mockResolvedValue('An account with that email already exists.');
    mount({ onCreateUser });
    click(buttons('Create User')[0]);
    typeInto('#new-user-email', 'jordan@yourshop.local');
    typeInto('#new-user-password', 'shopfloor42');
    typeInto('#new-user-confirm-password', 'shopfloor42');
    const submit = buttons('Create User').find(b => b.closest('[role="dialog"]')) as HTMLButtonElement;
    await act(async () => { click(submit); });
    expect(host.textContent).toContain('An account with that email already exists.');
    // Dialog stays open on failure — the fields aren't silently lost.
    expect(host.querySelector('#new-user-email')).not.toBeNull();
  });

  it('closes the dialog on success', async () => {
    const onCreateUser = vi.fn().mockResolvedValue(null);
    mount({ onCreateUser });
    click(buttons('Create User')[0]);
    typeInto('#new-user-email', 'jordan@yourshop.local');
    typeInto('#new-user-password', 'shopfloor42');
    typeInto('#new-user-confirm-password', 'shopfloor42');
    const submit = buttons('Create User').find(b => b.closest('[role="dialog"]')) as HTMLButtonElement;
    await act(async () => { click(submit); });
    expect(host.querySelector('#new-user-email')).toBeNull();
  });
});
