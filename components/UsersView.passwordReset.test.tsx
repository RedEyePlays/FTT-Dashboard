// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { UsersView } from './UsersView';
import { AppUser, Role } from '../types';

// The owner-only "Reset password" action in Users & Roles. Mounts the real
// component (React 19 act(), happy-dom) rather than testing a predicate, so
// what's asserted is what an actual session can reach and click:
//   • only an owner is offered the action, and never on another owner;
//   • the submit is wrapped in useSubmitGuard, so a double-click fires the
//     callable exactly once;
//   • the out-of-band warning is on screen, and the "staff emails aren't real
//     mailboxes" note explains why the owner is the reset path.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mkUser = (id: string, role: Role, email = `${id}@shop.test`): AppUser => ({
  id, email, role, workspaceId: 'owner-uid',
} as AppUser);

const owner = mkUser('owner-uid', 'owner');
const manager = mkUser('manager-uid', 'manager');
const employee = mkUser('employee-uid', 'employee');
const tech = mkUser('tech-uid', 'technician');
const users = [owner, manager, employee, tech];

interface MountOpts {
  me?: AppUser;
  canManageAll?: boolean;
  onResetPassword?: (uid: string, pw: string) => Promise<string | null>;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function mount({ me = owner, canManageAll = true, onResetPassword }: MountOpts = {}) {
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
        onResetPassword={onResetPassword}
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

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('who is offered the Reset password action', () => {
  it('an owner sees it for the manager, employee and technician rows', () => {
    mount({ onResetPassword: vi.fn().mockResolvedValue(null) });
    // Three non-owner members, and not the owner's own row.
    expect(buttons('Reset password')).toHaveLength(3);
  });

  it('no reset button renders at all when the handler is absent (non-owner session)', () => {
    mount({ me: manager, canManageAll: false, onResetPassword: undefined });
    expect(buttons('Reset password')).toHaveLength(0);
  });

  it('a manager session is not offered it even if a handler is somehow passed', () => {
    // Belt and braces: the row-level gate is canResetPasswordFor(me.role, ...),
    // which is owner-only regardless of what App.tsx wired up.
    mount({ me: manager, canManageAll: false, onResetPassword: vi.fn() });
    expect(buttons('Reset password')).toHaveLength(0);
  });
});

describe('the reset dialog', () => {
  it('warns that nothing is emailed and the password must be handed over directly', () => {
    mount({ onResetPassword: vi.fn().mockResolvedValue(null) });
    click(buttons('Reset password')[0]);
    const text = host.textContent || '';
    expect(text).toContain('No email is sent');
    expect(text.toLowerCase()).toContain('in person');
  });

  it('keeps submit disabled until the password is strong enough AND confirmed', () => {
    mount({ onResetPassword: vi.fn().mockResolvedValue(null) });
    click(buttons('Reset password')[0]);
    const submit = () => buttons('Set password')[0] as HTMLButtonElement;

    expect(submit().disabled).toBe(true);              // empty
    typeInto('#new-staff-password', 'short1');
    expect(submit().disabled).toBe(true);              // too short
    typeInto('#new-staff-password', 'shopfloor42');
    expect(submit().disabled).toBe(true);              // not confirmed
    typeInto('#confirm-staff-password', 'shopfloor4X');
    expect(submit().disabled).toBe(true);              // mismatch
    expect(host.textContent).toContain("Passwords don't match.");
    typeInto('#confirm-staff-password', 'shopfloor42');
    expect(submit().disabled).toBe(false);
  });

  it('a double-click fires the reset exactly once (useSubmitGuard)', async () => {
    // Deliberately never resolves during the clicks: this reproduces the real
    // gap the guard exists for — the callable is in flight, so nothing in
    // props/state has changed yet to disable the button on its own.
    let resolve!: (v: string | null) => void;
    const onResetPassword = vi.fn(() => new Promise<string | null>(r => { resolve = r; }));
    mount({ onResetPassword });

    click(buttons('Reset password')[0]);
    typeInto('#new-staff-password', 'shopfloor42');
    typeInto('#confirm-staff-password', 'shopfloor42');

    const submit = buttons('Set password')[0];
    click(submit);
    click(submit);   // same tick — state hasn't re-rendered yet
    click(submit);

    expect(onResetPassword).toHaveBeenCalledTimes(1);
    expect(onResetPassword).toHaveBeenCalledWith('manager-uid', 'shopfloor42');

    await act(async () => { resolve(null); });
    expect(host.textContent).toContain('Password updated');
  });

  it('shows the server\'s refusal instead of claiming success', async () => {
    const onResetPassword = vi.fn().mockResolvedValue('That user is not part of this shop.');
    mount({ onResetPassword });
    click(buttons('Reset password')[0]);
    typeInto('#new-staff-password', 'shopfloor42');
    typeInto('#confirm-staff-password', 'shopfloor42');
    await act(async () => { click(buttons('Set password')[0]); });
    expect(host.textContent).toContain('That user is not part of this shop.');
    expect(host.textContent).not.toContain('Password updated');
  });

  it('clears the password out of component state once the reset lands', async () => {
    const onResetPassword = vi.fn().mockResolvedValue(null);
    mount({ onResetPassword });
    click(buttons('Reset password')[0]);
    typeInto('#new-staff-password', 'shopfloor42');
    typeInto('#confirm-staff-password', 'shopfloor42');
    await act(async () => { click(buttons('Set password')[0]); });
    // The inputs are gone entirely on success — nothing left holding it.
    expect(host.querySelector('#new-staff-password')).toBeNull();
    expect(host.textContent).not.toContain('shopfloor42');
  });
});

describe('the staff-email explainer', () => {
  it('tells the owner that addresses need not be real, and that they own resets', () => {
    mount({ onResetPassword: vi.fn().mockResolvedValue(null) });
    const text = host.textContent || '';
    expect(text).toContain("Staff addresses don't have to be real mailboxes.");
    expect(text).toContain('Reset password');
  });

  it('is not shown on the manager-only Technicians screen', () => {
    mount({ me: manager, canManageAll: false });
    expect(host.textContent).not.toContain("Staff addresses don't have to be real mailboxes.");
  });
});
