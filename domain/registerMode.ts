import { Role } from '../types';
import { autoLockAppliesToRole } from './pin';

/**
 * REGISTER MODE — a property of the MACHINE, not of a person or a workspace.
 *
 * The counter register is shared by two or three people all day. The laptop in
 * the back is one person's. Those need different answers about locking, and
 * neither a user setting nor a workspace setting can express that: a workspace
 * setting would put the back office on a 60-second timer, and a user setting
 * would follow the owner home.
 *
 * So the flag lives in localStorage on the device (services/registerMode.ts
 * reads and writes it). This module holds the decisions it feeds, kept pure.
 *
 * OFF A REGISTER, NOTHING CHANGES AT ALL. Every function here returns exactly
 * what the app did before when `isRegister` is false.
 */

/**
 * How long a shared register sits idle before it locks.
 *
 * SECONDS, not minutes, and deliberately separate from
 * settings.operations.autoLockMinutes (which stays exactly as it is for normal
 * machines). A handover happens in the gap between two customers; a four-minute
 * timer would mean most of a shift's sales still land on whoever signed in
 * first, which is the whole problem.
 */
export const REGISTER_IDLE_SECONDS = 60;

/** Never lock a register so fast that it locks mid-transaction. */
export const REGISTER_IDLE_MIN_SECONDS = 15;
export const REGISTER_IDLE_MAX_SECONDS = 600;

export interface DeviceMode {
  isRegister: boolean;
  /** Idle seconds for this register. Absent = REGISTER_IDLE_SECONDS. */
  idleSeconds?: number;
  /**
   * A random, device-local id. Not an identity and not a credential — it only
   * lets an audit trail say "this happened on the same machine as that", which
   * is what makes a pattern of failed PIN attempts traceable to a counter.
   */
  deviceId?: string;
}

export const DEFAULT_DEVICE_MODE: DeviceMode = { isRegister: false };

/** Does the idle timer apply to this person on this device? */
export const autoLockApplies = (role: Role | undefined, mode: DeviceMode): boolean =>
  autoLockAppliesToRole(role, mode.isRegister);

/**
 * The idle timeout to arm, in MINUTES (what useInactivityTimer takes).
 *
 * A register uses its own seconds-based timer; everything else keeps reading
 * settings.operations.autoLockMinutes untouched.
 */
export const idleMinutesFor = (mode: DeviceMode, autoLockMinutes: number): number =>
  mode.isRegister ? clampIdleSeconds(mode.idleSeconds) / 60 : autoLockMinutes;

export const clampIdleSeconds = (secs?: number): number => {
  const n = Math.round(secs ?? REGISTER_IDLE_SECONDS);
  if (!Number.isFinite(n) || n <= 0) return REGISTER_IDLE_SECONDS;
  return Math.min(REGISTER_IDLE_MAX_SECONDS, Math.max(REGISTER_IDLE_MIN_SECONDS, n));
};

/**
 * Is fast user switching offered on this device?
 *
 * Only on a register. Everywhere else the lock screen keeps its existing
 * behaviour — unlock as yourself with your own PIN or password — because there
 * is nobody to hand over to.
 */
export const switchingAvailable = (mode: DeviceMode): boolean => mode.isRegister;

/**
 * Who shows up in the switch list.
 *
 * Active humans in the workspace, minus the kiosk DEVICE account (not a
 * person, no session to take over) and minus whoever is already signed in
 * (switching to yourself is a no-op that would still write a handover into the
 * audit log). Sorted by name so the tile order is stable between taps.
 *
 * Everyone else is listed whether or not they have a PIN: somebody without one
 * falls back to email and password, and hiding them would look like they had
 * been removed from the shop.
 */
export const switchCandidates = <T extends { id: string; email: string; role?: Role; disabled?: boolean }>(
  users: T[],
  currentUid: string | undefined,
): T[] =>
  users
    .filter(u => !u.disabled && u.role !== 'kiosk' && u.id !== currentUid)
    .sort((a, b) => (a.email || '').localeCompare(b.email || ''));
