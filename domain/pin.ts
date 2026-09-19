import { Role } from '../types';

// --- PIN codes: format, role hierarchy, and hashing -------------------------
//
// A PIN is a short numeric code a manager/owner assigns to staff below them,
// used ONLY to unlock the auto-lock overlay after inactivity — never a
// substitute for the real Firebase Auth login. It is never stored or compared
// in plaintext: hashed here with PBKDF2-SHA256 (Web Crypto — available in the
// browser and in this test environment) and a random per-user salt, with
// enough iterations to meaningfully slow offline brute-forcing of a
// low-entropy 4-6 digit code.

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;
export const PIN_HASH_ITERATIONS = 150_000;

export const isValidPinFormat = (pin: string): boolean =>
  /^\d+$/.test(pin) && pin.length >= PIN_MIN_LENGTH && pin.length <= PIN_MAX_LENGTH;

// --- Role hierarchy: who may assign a PIN to whom ---------------------------
// Strictly-lower rank than the assigner only — never a peer or someone above,
// so a manager can never PIN another manager or the owner, and nobody can PIN
// themselves via this path.

// 'kiosk' is ranked -1 and is then REFUSED outright below. The rank alone
// would have let it through (−1 is below everyone), which is exactly the
// silent fall-through this role must never have: a kiosk is a shared device
// by the door, not a person with a session to unlock, so it can never hold an
// app-unlock PIN. Its own punch PIN is a different field entirely
// (AppUser.kioskPinHash — see KIOSK_PIN_LENGTH below).
const ROLE_RANK: Record<Role, number> = { owner: 3, manager: 2, employee: 1, technician: 0, kiosk: -1 };

export const canAssignPin = (assignerRole: Role | undefined, targetRole: Role): boolean =>
  targetRole !== 'kiosk'
  && (assignerRole === 'owner' || assignerRole === 'manager')
  && ROLE_RANK[targetRole] < ROLE_RANK[assignerRole];

// --- Kiosk punch PIN --------------------------------------------------------
//
// SEPARATE from the app-unlock PIN above, and deliberately so: a PIN typed at
// a shared iPad by the front door is shoulder-surfable, so it must not also
// unlock anyone's dashboard session. Stored as AppUser.kioskPinHash, hashed by
// the same PBKDF2 helpers below.
//
// Exactly 6 digits — longer than the 4-digit minimum the unlock PIN allows,
// because this one is typed in public.
export const KIOSK_PIN_LENGTH = 6;

export const isValidKioskPinFormat = (pin: string): boolean =>
  /^\d+$/.test(pin) && pin.length === KIOSK_PIN_LENGTH;

/**
 * Who may be given a KIOSK punch PIN: anyone who actually clocks in — owner,
 * manager, employee, technician. Never the kiosk device account itself, which
 * is a device and does not have shifts.
 */
export const canHaveKioskPin = (role: Role | undefined): boolean =>
  role === 'owner' || role === 'manager' || role === 'employee' || role === 'technician';

// --- Who the INACTIVITY auto-lock timer applies to ---------------------------
// Owner/manager only — they're the roles with access to sensitive screens
// (profit figures, settings, users). An employee/technician working the
// counter is never auto-locked by idle time; they can still lock manually at
// any time (App.tsx's handleManualLock), which isn't role-gated.
// A kiosk is never auto-locked: it has nothing sensitive on screen, and an
// idle overlay on the door iPad would just stop staff punching in.
export const autoLockAppliesToRole = (role: Role | undefined): boolean =>
  role === 'owner' || role === 'manager';

// --- Hashing (PBKDF2-SHA256 via Web Crypto) ---------------------------------

export interface PinHash {
  hash: string;
  salt: string;
  iterations: number;
}

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string): Uint8Array =>
  new Uint8Array((hex.match(/.{2}/g) || []).map(b => parseInt(b, 16)));

const randomSaltHex = (bytes: number = 16): string =>
  toHex(crypto.getRandomValues(new Uint8Array(bytes)).buffer);

async function deriveHex(pin: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(bits);
}

// Constant-time comparison of two equal-convention hex hashes, to avoid a
// timing side-channel on the PIN check.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function hashPin(pin: string, iterations: number = PIN_HASH_ITERATIONS): Promise<PinHash> {
  const salt = randomSaltHex();
  const hash = await deriveHex(pin, salt, iterations);
  return { hash, salt, iterations };
}

export async function verifyPin(pin: string, stored: PinHash): Promise<boolean> {
  if (!stored.hash || !stored.salt) return false;
  const hash = await deriveHex(pin, stored.salt, stored.iterations || PIN_HASH_ITERATIONS);
  return timingSafeEqual(hash, stored.hash);
}
