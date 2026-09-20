import { describe, it, expect } from 'vitest';
import {
  REGISTER_IDLE_SECONDS, REGISTER_IDLE_MIN_SECONDS, REGISTER_IDLE_MAX_SECONDS,
  DEFAULT_DEVICE_MODE, autoLockApplies, idleMinutesFor, clampIdleSeconds,
  switchingAvailable, switchCandidates, DeviceMode,
} from './registerMode';
import { autoLockAppliesToRole } from './pin';

// Register mode describes the MACHINE. The counter is shared by two or three
// people all day; the laptop in the back is one person's. Neither a workspace
// setting nor a user setting can say that.

const register: DeviceMode = { isRegister: true };
const normal: DeviceMode = DEFAULT_DEVICE_MODE;

describe('off a register, nothing changes at all', () => {
  it('auto-lock is still owner/manager only', () => {
    expect(autoLockApplies('owner', normal)).toBe(true);
    expect(autoLockApplies('manager', normal)).toBe(true);
    expect(autoLockApplies('employee', normal)).toBe(false);
    expect(autoLockApplies('technician', normal)).toBe(false);
  });

  it('the existing one-argument call site keeps its exact behaviour', () => {
    // Every pre-existing caller passes no device mode. They must not move.
    expect(autoLockAppliesToRole('owner')).toBe(true);
    expect(autoLockAppliesToRole('employee')).toBe(false);
    expect(autoLockAppliesToRole(undefined)).toBe(false);
  });

  it('the idle timeout is still the workspace setting, untouched', () => {
    expect(idleMinutesFor(normal, 4)).toBe(4);
    expect(idleMinutesFor(normal, 0)).toBe(0);
  });

  it('and switching is not offered — there is nobody to hand over to', () => {
    expect(switchingAvailable(normal)).toBe(false);
  });
});

describe('on a register, the lock applies to EVERYONE', () => {
  it('including the roles that never locked before', () => {
    // A technician's screen never locking is why there was no moment at which
    // a handover would even be prompted.
    expect(autoLockApplies('employee', register)).toBe(true);
    expect(autoLockApplies('technician', register)).toBe(true);
    expect(autoLockApplies('owner', register)).toBe(true);
    expect(autoLockApplies('manager', register)).toBe(true);
  });

  it('but NEVER the kiosk device — an idle overlay there just blocks punching in', () => {
    expect(autoLockApplies('kiosk', register)).toBe(false);
    expect(autoLockApplies('kiosk', normal)).toBe(false);
  });

  it('nobody signed in is nobody to lock out', () => {
    expect(autoLockApplies(undefined, register)).toBe(false);
  });

  it('uses its own seconds-based timer, not autoLockMinutes', () => {
    // A handover happens in the gap between two customers. A four-minute timer
    // would leave most of a shift's sales on whoever signed in first.
    expect(REGISTER_IDLE_SECONDS).toBe(60);
    expect(idleMinutesFor(register, 4)).toBe(1);
    expect(idleMinutesFor({ isRegister: true, idleSeconds: 30 }, 4)).toBe(0.5);
  });

  it('offers switching', () => {
    expect(switchingAvailable(register)).toBe(true);
  });
});

describe('the idle timer cannot be set to something absurd', () => {
  it('never locks mid-transaction', () => {
    expect(clampIdleSeconds(1)).toBe(REGISTER_IDLE_MIN_SECONDS);
    expect(clampIdleSeconds(-30)).toBe(REGISTER_IDLE_SECONDS);
    expect(clampIdleSeconds(0)).toBe(REGISTER_IDLE_SECONDS);
  });

  it('and never so long that it is no lock at all', () => {
    expect(clampIdleSeconds(99999)).toBe(REGISTER_IDLE_MAX_SECONDS);
  });

  it('a missing or unparseable value falls back to the default', () => {
    expect(clampIdleSeconds(undefined)).toBe(REGISTER_IDLE_SECONDS);
    expect(clampIdleSeconds(NaN)).toBe(REGISTER_IDLE_SECONDS);
  });
});

describe('who appears in the switch list', () => {
  const users = [
    { id: 'u1', email: 'sara@shop.test', role: 'employee' as const },
    { id: 'u2', email: 'ali@shop.test', role: 'technician' as const },
    { id: 'u3', email: 'gone@shop.test', role: 'employee' as const, disabled: true },
    { id: 'u4', email: 'ipad@shop.test', role: 'kiosk' as const },
    { id: 'me', email: 'me@shop.test', role: 'manager' as const },
  ];

  it('active humans, minus the kiosk device and minus whoever is already on', () => {
    expect(switchCandidates(users, 'me').map(u => u.id)).toEqual(['u2', 'u1']);
  });

  it('a disabled account is not offered', () => {
    expect(switchCandidates(users, 'me').some(u => u.id === 'u3')).toBe(false);
  });

  it('somebody with NO PIN is still listed — they fall back to a password', () => {
    // Hiding them would look like they had been removed from the shop.
    expect(switchCandidates(users, 'me').map(u => u.id)).toContain('u1');
  });

  it('is stably ordered, so the tile you tap does not move between taps', () => {
    const a = switchCandidates(users, 'me').map(u => u.id);
    const b = switchCandidates([...users].reverse(), 'me').map(u => u.id);
    expect(a).toEqual(b);
  });
});
