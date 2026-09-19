import { DeviceMode, DEFAULT_DEVICE_MODE, clampIdleSeconds } from '../domain/registerMode';

/**
 * The device-local register flag, in localStorage.
 *
 * localStorage and NOT Firestore on purpose: this describes the MACHINE. A
 * workspace setting would put the back-office laptop on a 60-second timer, and
 * a user setting would follow the owner home to their own computer. It is also
 * why it survives a user switch — the counter is still the counter whoever is
 * standing at it.
 *
 * Every read is defensive: a browser in private mode, or with site data
 * blocked, throws on access. A device that cannot remember the flag is simply
 * not a register, which is the safe answer — it keeps today's behaviour.
 */
const KEY = 'ftt_register_mode_v1';

const newDeviceId = (): string => {
  try {
    return crypto.randomUUID();
  } catch {
    return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
};

export const readDeviceMode = (): DeviceMode => {
  if (typeof window === 'undefined') return DEFAULT_DEVICE_MODE;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_DEVICE_MODE;
    const parsed = JSON.parse(raw) as Partial<DeviceMode>;
    return {
      isRegister: parsed.isRegister === true,
      idleSeconds: clampIdleSeconds(parsed.idleSeconds),
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : undefined,
    };
  } catch {
    return DEFAULT_DEVICE_MODE;
  }
};

export const writeDeviceMode = (mode: DeviceMode): DeviceMode => {
  // A register gets a device id the first time it is turned on, so the audit
  // trail can say two failed PIN attempts happened on the same machine.
  const next: DeviceMode = {
    isRegister: mode.isRegister,
    idleSeconds: clampIdleSeconds(mode.idleSeconds),
    deviceId: mode.deviceId || (mode.isRegister ? newDeviceId() : undefined),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* storage unavailable — the flag just won't persist past reload */ }
  return next;
};
