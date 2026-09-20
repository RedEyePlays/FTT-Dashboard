import { webcrypto } from "node:crypto";

/**
 * SERVER-SIDE PIN VERIFICATION — a deliberate mirror of domain/pin.ts.
 *
 * The browser cannot do this check for the general case: firestore.rules lets
 * a user read users/{uid} only for themselves or, as owner/manager, for
 * colleagues. A register signed in as a technician therefore cannot read the
 * pinHash of whoever wants to take over.
 *
 * WHY A MIRROR AND NOT AN IMPORT: functions/ is a separately deployed package
 * with its own tsconfig and its own node_modules; it does not compile the
 * app's `domain/` tree, and reaching up out of the functions root is exactly
 * the kind of build coupling that breaks a deploy at the worst moment.
 *
 * A DRIFTING SECOND IMPLEMENTATION HERE IS A SILENT LOCKOUT — everyone's PIN
 * stops working and nothing says why. So this is not merely "the same idea":
 * it is the same algorithm, the same parameters, the same hex conventions, and
 * pinHash.test.ts pins it against FIXED VECTORS that domain/pin.test.ts
 * asserts the browser implementation produces too. If either side is ever
 * changed, one of those two suites fails.
 *
 * PBKDF2-SHA256, 256-bit output, lowercase hex, hex salt — identical to
 * domain/pin.ts's deriveHex.
 */

export const PIN_HASH_ITERATIONS = 150_000;

const toHex = (buf: ArrayBuffer): string =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

const fromHex = (hex: string): Uint8Array =>
  new Uint8Array((hex.match(/.{2}/g) || []).map(b => parseInt(b, 16)));

export async function deriveHex(pin: string, saltHex: string, iterations: number): Promise<string> {
  const key = await webcrypto.subtle.importKey(
    "raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"],
  );
  const bits = await webcrypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromHex(saltHex), iterations, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

/** Constant-time compare, so the check leaks no timing signal about the PIN. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface StoredPin {
  hash?: string;
  salt?: string;
  iterations?: number;
}

export async function verifyPin(pin: string, stored: StoredPin): Promise<boolean> {
  if (!stored.hash || !stored.salt) return false;
  const hash = await deriveHex(pin, stored.salt, stored.iterations || PIN_HASH_ITERATIONS);
  return timingSafeEqual(hash, stored.hash);
}
