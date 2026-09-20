/**
 * THE CONTRACT BETWEEN domain/pin.ts AND functions/src/pinHash.ts.
 *
 * These vectors are asserted by BOTH suites — functions/src/pinHash.test.ts
 * (node:test, against the Admin-side implementation) and domain/pin.test.ts
 * (vitest, against the browser implementation). They are the reason the two
 * PBKDF2 implementations cannot drift apart without something going red.
 *
 * A drift here is a SILENT LOCKOUT: everyone's PIN stops working at the
 * counter and nothing explains why. Do not regenerate these to make a test
 * pass — if they no longer match, one of the two implementations changed and
 * that is the bug.
 *
 * Deliberately duplicated verbatim in domain/pinFixtures.ts rather than
 * imported across the package boundary: functions/ is a separately deployed
 * package that does not compile the app's tree, and a cross-root import is
 * exactly the build coupling that breaks a deploy. The duplication is the
 * point — two copies that must agree, checked by two suites.
 */
export interface PinVector {
  pin: string;
  salt: string;
  iterations: number;
  hash: string;
}

export const PIN_VECTORS: PinVector[] = [
  {
    pin: "1234",
    salt: "00112233445566778899aabbccddeeff",
    iterations: 1000,
    hash: "b8ad0f1dacec0beb4f418fadcb2ee5939ef45823391bb89692028dd1b67e9cef",
  },
  {
    // At the REAL iteration count the app ships with, so the shipped
    // parameters are pinned and not just the algorithm.
    pin: "4821",
    salt: "a1b2c3d4e5f60718293a4b5c6d7e8f90",
    iterations: 150000,
    hash: "c57d7374271d13f89d28f12060634f0ce5c970891119a23f40d3aa8d342d55c6",
  },
  {
    // A 6-digit PIN with leading zeros — the case a numeric coercion anywhere
    // in the chain would quietly destroy.
    pin: "000000",
    salt: "ffeeddccbbaa99887766554433221100",
    iterations: 1000,
    hash: "2c5066e70c3f063da7c9b165e125b229ac6d206fd5ed9dea0cf234d7accb580f",
  },
];
