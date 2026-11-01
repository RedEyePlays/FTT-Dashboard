// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { UsersView } from './UsersView';
import { AppUser, Location, Role } from '../types';

/**
 * WHICH STORE EACH IPAD IS — the owner's screen, multi-store stage 3.
 *
 * The integrity of the whole feature is that a staff member punching in
 * cannot change which store the iPad claims to be. That is enforced in
 * firestore.rules (see rules-tests/shiftLocation.rules.test.ts: a kiosk cannot
 * write its own store, and neither can an employee or a manager). This is the
 * screen half: the control exists for the owner and for nobody else, and
 * changing a configured device is confirmed rather than a stray tap.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const mkUser = (id: string, role: Role, extra: Partial<AppUser> = {}): AppUser =>
  ({ id, email: `${id}@shop.test`, role, workspaceId: 'owner-uid', ...extra } as AppUser);

const owner = mkUser('owner-uid', 'owner');
const manager = mkUser('manager-uid', 'manager');
const padBram = mkUser('kiosk-bram', 'kiosk', { kioskLocationId: 'brampton', kioskLocationName: 'Brampton' });
const padNew = mkUser('kiosk-new', 'kiosk');

const loc = (id: string, name: string, extra: Partial<Location> = {}): Location =>
  ({ id, name, active: true, createdAt: 1, ...extra });
const STORES = [loc('brampton', 'Brampton', { isDefault: true }), loc('mississauga', 'Mississauga')];

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function mount(opts: {
  me?: AppUser; users?: AppUser[]; canManageAll?: boolean;
  onSetKioskLocation?: (uid: string, id: string) => void;
  locations?: Location[];
} = {}) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <UsersView
        me={opts.me || owner}
        users={opts.users || [owner, manager, padBram, padNew]}
        invites={[]}
        canManageAll={opts.canManageAll ?? true}
        onSetRole={vi.fn()} onSetDisabled={vi.fn()} onSetAllowProfit={vi.fn()}
        onInvite={vi.fn()} onDeleteInvite={vi.fn()}
        onCreateKioskDevice={vi.fn()} onRevokeKioskDevice={vi.fn()}
        locations={opts.locations ?? STORES}
        onSetKioskLocation={opts.onSetKioskLocation}
      />,
    );
  });
  return {
    text: () => host.textContent || '',
    selects: () => [...host.querySelectorAll('select')] as HTMLSelectElement[],
    kioskSelects: () => ([...host.querySelectorAll('select')] as HTMLSelectElement[])
      .filter(s => s.getAttribute('aria-label') === 'Kiosk store'),
    buttonLabels: () => [...host.querySelectorAll('button')].map(b => (b.textContent || '').trim()),
  };
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe('the owner sets each iPad\'s store', () => {
  it('one picker per kiosk device', () => {
    const v = mount({ onSetKioskLocation: vi.fn() });
    expect(v.kioskSelects()).toHaveLength(2);
    expect(v.kioskSelects()[0].value).toBe('brampton');
    expect(v.kioskSelects()[1].value).toBe('');
  });

  it('an unconfigured iPad is flagged as one that will not record hours', () => {
    const v = mount({ onSetKioskLocation: vi.fn() });
    expect(v.text()).toContain('Will not record hours');
  });

  it('setting an UNCONFIGURED iPad needs no confirmation — nothing to misfile', () => {
    const onSet = vi.fn();
    const confirm = vi.spyOn(window, 'confirm');
    const v = mount({ onSetKioskLocation: onSet });
    const sel = v.kioskSelects()[1];
    act(() => {
      sel.value = 'mississauga';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(onSet).toHaveBeenCalledWith('kiosk-new', 'mississauga');
  });

  it('MOVING A CONFIGURED IPAD IS CONFIRMED, and says what it does and does not change', () => {
    const onSet = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const v = mount({ onSetKioskLocation: onSet });
    const sel = v.kioskSelects()[0];
    act(() => {
      sel.value = 'mississauga';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const msg = confirm.mock.calls[0][0] as string;
    expect(msg).toContain('Brampton');
    expect(msg).toContain('Mississauga');
    // The two facts that make an accidental switch dangerous.
    expect(msg).toMatch(/from now on/i);
    expect(msg).toMatch(/switching back does not undo them/i);
    expect(onSet).toHaveBeenCalledWith('kiosk-bram', 'mississauga');
  });

  it('declining the confirmation changes nothing', () => {
    const onSet = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const v = mount({ onSetKioskLocation: onSet });
    const sel = v.kioskSelects()[0];
    act(() => {
      sel.value = 'mississauga';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSet).not.toHaveBeenCalled();
  });

  it('TWO SHOPS NEED TWO IPADS — another device can always be added', () => {
    // This used to be offered only while there were none, which was right for
    // one shop and wrong the moment there are two.
    const v = mount({ onSetKioskLocation: vi.fn() });
    expect(v.buttonLabels()).toContain('Add another kiosk device');
  });
});

describe('A STAFF MEMBER CANNOT CHANGE WHICH STORE AN IPAD IS', () => {
  it('a manager gets no picker at all', () => {
    // The manager view (canManageAll false) does not render the kiosk panel,
    // and App.tsx passes no setter for anyone but the owner. firestore.rules
    // refuses the write regardless.
    const v = mount({ me: manager, canManageAll: false, onSetKioskLocation: undefined });
    expect(v.kioskSelects()).toHaveLength(0);
  });

  it('and nor does the owner\'s own screen without the setter', () => {
    const v = mount({ onSetKioskLocation: undefined });
    expect(v.kioskSelects()).toHaveLength(0);
  });
});

describe('a workspace with no stores', () => {
  it('shows no kiosk store picker, because there is nothing to pick', () => {
    const v = mount({ onSetKioskLocation: vi.fn(), locations: [] });
    expect(v.kioskSelects()).toHaveLength(0);
  });
});
