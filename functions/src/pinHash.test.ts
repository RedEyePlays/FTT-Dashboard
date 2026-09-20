import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveHex, verifyPin, timingSafeEqual, PIN_HASH_ITERATIONS } from "./pinHash";
import { PIN_VECTORS } from "./pinFixtures";

// THIS IS THE ANTI-DRIFT SUITE. The browser verifies a PIN with domain/pin.ts;
// this package verifies it with pinHash.ts, because firestore.rules will not
// let a technician's session read a colleague's pinHash. Two implementations
// of one PBKDF2 scheme is a silent lockout waiting to happen — everyone's PIN
// stops working at the counter and nothing says why.
//
// Both sides assert the SAME vectors (pinFixtures.ts here, domain/pinFixtures.ts
// there), so neither can change without one of the two suites going red.

test("matches the shared vectors byte for byte", async () => {
  for (const v of PIN_VECTORS) {
    assert.equal(await deriveHex(v.pin, v.salt, v.iterations), v.hash);
  }
});

test("ships the same iteration count the browser does", () => {
  assert.equal(PIN_HASH_ITERATIONS, 150_000);
});

test("verifies a correct PIN against a stored hash", async () => {
  const v = PIN_VECTORS[0];
  assert.equal(await verifyPin(v.pin, { hash: v.hash, salt: v.salt, iterations: v.iterations }), true);
});

test("rejects a wrong PIN", async () => {
  const v = PIN_VECTORS[0];
  assert.equal(await verifyPin("9999", { hash: v.hash, salt: v.salt, iterations: v.iterations }), false);
});

test("a PIN with leading zeros is not coerced to a number anywhere", async () => {
  const v = PIN_VECTORS[2];
  assert.equal(await verifyPin("000000", { hash: v.hash, salt: v.salt, iterations: v.iterations }), true);
  assert.equal(await verifyPin("0", { hash: v.hash, salt: v.salt, iterations: v.iterations }), false);
});

test("a record with no hash or no salt never verifies", async () => {
  assert.equal(await verifyPin("1234", { salt: "aa" }), false);
  assert.equal(await verifyPin("1234", { hash: "bb" }), false);
  assert.equal(await verifyPin("1234", {}), false);
});

test("falls back to the shipped iteration count when the record omits it", async () => {
  // Written before iterations were stored per-record. Verifying such a record
  // must not silently fail — that is a lockout too.
  const salt = PIN_VECTORS[1].salt;
  const hash = await deriveHex("4821", salt, PIN_HASH_ITERATIONS);
  assert.equal(await verifyPin("4821", { hash, salt }), true);
});

test("the hash compare is length-safe and constant-time in shape", () => {
  assert.equal(timingSafeEqual("abcd", "abcd"), true);
  assert.equal(timingSafeEqual("abcd", "abce"), false);
  assert.equal(timingSafeEqual("abcd", "abc"), false);
});
