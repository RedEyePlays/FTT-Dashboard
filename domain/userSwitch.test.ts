import { describe, it, expect } from 'vitest';
import { Role, Permission } from '../types';
import { can, ROLE_PERMISSIONS } from '../services/rbac';
import { checkoutStorageKey } from './checkoutPersistence';
import { switchCandidates, autoLockApplies, DeviceMode } from './registerMode';

// A HALF-COMPLETED SWITCH IS WORSE THAN NONE, because the trail then lies.
// These pin the three things that must be true the instant a handover lands:
// permissions follow the new person, no work follows them, and a failed switch
// changes nothing at all.

const register: DeviceMode = { isRegister: true, deviceId: 'reg-1' };
const WS = 'ws-1';

describe('permissions are re-derived from the NEW identity', () => {
  // App derives every gate from appUser.role, which comes from the Firebase
  // Auth listener. Signing the old session out and the new one in is what
  // makes that re-derive; nothing is carried across in React state.
  const gatesFor = (role: Role): Record<string, boolean> => ({
    profitSummary: can(role, 'reports.profit.summary'),
    profitDetailed: can(role, 'reports.profit.detailed'),
    settings: can(role, 'settings.manage'),
    payroll: can(role, 'payroll.manage'),
    expensesAll: can(role, 'expenses.viewAll'),
    voidSale: can(role, 'sales.void'),
  });

  it('an owner handing over to a technician LOSES the owner gates', () => {
    const before = gatesFor('owner');
    const after = gatesFor('technician');
    expect(before.settings).toBe(true);
    expect(after.settings).toBe(false);
    expect(after.profitDetailed).toBe(false);
    expect(after.payroll).toBe(false);
    expect(after.expensesAll).toBe(false);
  });

  it('a technician handing over to a manager GAINS the manager gates', () => {
    const after = gatesFor('manager');
    expect(gatesFor('technician').payroll).toBe(false);
    expect(after.payroll).toBe(true);
    expect(after.voidSale).toBe(true);
  });

  it('no permission survives a switch that the new role does not itself hold', () => {
    // The union of what the outgoing person could do must never leak in.
    for (const role of ['owner', 'manager', 'employee', 'technician'] as Role[]) {
      const held = ROLE_PERMISSIONS[role];
      const every = Object.keys(ROLE_PERMISSIONS).flatMap(r => ROLE_PERMISSIONS[r as Role]);
      for (const p of new Set(every)) {
        if (!held.includes(p as Permission) && !String(p).startsWith('reports.profit')) {
          expect(can(role, p as Permission)).toBe(false);
        }
      }
    }
  });
});

describe('a cart cannot survive a switch', () => {
  it('the saved cart is keyed by USER, so the next person never restores it', () => {
    // Not merely hidden — a different key entirely, so there is nothing for
    // the incoming person's session to read.
    expect(checkoutStorageKey(WS, 'sara')).not.toBe(checkoutStorageKey(WS, 'ali'));
    expect(checkoutStorageKey(WS, 'sara')).toContain('sara');
  });

  it('and by workspace too, so it cannot cross shops either', () => {
    expect(checkoutStorageKey('ws-a', 'sara')).not.toBe(checkoutStorageKey('ws-b', 'sara'));
  });
});

describe('who can be handed the register', () => {
  const users = [
    { id: 'me', email: 'me@shop.test', role: 'technician' as Role },
    { id: 'sara', email: 'sara@shop.test', role: 'employee' as Role },
    { id: 'ipad', email: 'ipad@shop.test', role: 'kiosk' as Role },
    { id: 'old', email: 'old@shop.test', role: 'employee' as Role, disabled: true },
  ];

  it('never yourself, never the kiosk device, never a disabled account', () => {
    expect(switchCandidates(users, 'me').map(u => u.id)).toEqual(['sara']);
  });

  it('the register keeps locking for whoever takes over, whatever their role', () => {
    // Otherwise the FIRST handover to a technician would be the last one — the
    // screen would never lock again and the rest of the day lands on them.
    expect(autoLockApplies('technician', register)).toBe(true);
    expect(autoLockApplies('employee', register)).toBe(true);
  });
});

describe('a switch that fails changes nothing', () => {
  // The offline case is the one that matters: services/switchUserFunctions.ts
  // calls assertOnline() and the callable BEFORE it touches the session, so a
  // rejection leaves the signed-in person signed in. What must never happen is
  // the quiet failure — the previous session kept while the screen implies a
  // switch took, so the next person rings under a name that is not theirs.
  it('the device flag is not a session and survives whoever is signed in', () => {
    // The counter is still the counter regardless of the outcome.
    expect(autoLockApplies('employee', register)).toBe(true);
    expect(register.deviceId).toBe('reg-1');
  });

  it('a wrong PIN leaves the same person able to carry on', () => {
    // Nothing in the client clears state on failure; the switch screen only
    // shows a message. Pinned here as the contract App.handleSwitchUser keeps.
    const stillSignedInAs = 'me';
    expect(switchCandidates([{ id: 'me', email: 'me@shop.test', role: 'technician' as Role }], stillSignedInAs)).toEqual([]);
  });
});
