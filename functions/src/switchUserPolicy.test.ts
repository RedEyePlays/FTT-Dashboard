import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeSwitch, buildSwitchAuditEntry, cooldownMessage, EMPTY_ATTEMPTS,
  GENERIC_DENY, hasPin, isCoolingDown, MAX_PIN_ATTEMPTS, NO_PIN_MESSAGE,
  recordFailure, recordSuccess, ATTEMPT_WINDOW_MS, PIN_COOLDOWN_MS,
  AttemptState, UserRecord,
} from "./switchUserPolicy";

const WS = "workspace-owner-uid";
const owner: UserRecord = { role: "owner", workspaceId: WS, email: "owner@shop.test" };
const manager: UserRecord = { role: "manager", workspaceId: WS, email: "mgr@shop.test" };
const employee: UserRecord = { role: "employee", workspaceId: WS, email: "emp@shop.test" };
const tech: UserRecord = { role: "technician", workspaceId: WS, email: "tech@shop.test" };
const kiosk: UserRecord = { role: "kiosk", workspaceId: WS, email: "kiosk@shop.test" };

const authz = (caller?: UserRecord, target?: UserRecord, callerUid = "a", targetUid = "b") =>
  authorizeSwitch({ callerUid, targetUid, caller, target });

/* ---------------- Who may hand the register over ---------------- */

test("a technician may hand the register to an employee", () => {
  // This is the case the browser CANNOT do: firestore.rules will not let a
  // technician's session read the employee's pinHash. It is not an escalation
  // — the PIN is the employee's own credential.
  assert.equal(authz(tech, employee).ok, true);
});

test("switching works in every direction between active members", () => {
  assert.equal(authz(employee, manager).ok, true);
  assert.equal(authz(manager, employee).ok, true);
  assert.equal(authz(owner, tech).ok, true);
});

test("a disabled account can neither switch nor be switched to", () => {
  assert.equal(authz({ ...tech, disabled: true }, employee).ok, false);
  assert.equal(authz(tech, { ...employee, disabled: true }).ok, false);
});

test("the kiosk DEVICE is not a person on either side", () => {
  assert.equal(authz(kiosk, employee).ok, false);
  assert.equal(authz(employee, kiosk).ok, false);
});

test("cross-workspace is refused", () => {
  assert.equal(authz(tech, { ...employee, workspaceId: "someone-else" }).ok, false);
});

test("switching to yourself is refused rather than auditing a handover that never happened", () => {
  const r = authz(tech, tech, "same", "same");
  assert.equal(r.ok, false);
  assert.match(r.ok === false ? r.message : "", /already signed in/i);
});

test("every refusal gives the SAME message, so uids cannot be probed", () => {
  // A technician's session must not be able to enumerate the workspace by
  // reading different errors back.
  const messages = [
    authz(tech, undefined),
    authz(tech, { ...employee, workspaceId: "other" }),
    authz(tech, { ...employee, disabled: true }),
    authz(tech, kiosk),
  ].map(r => (r.ok === false ? r.message : "ALLOWED"));
  assert.deepEqual(messages, [GENERIC_DENY, GENERIC_DENY, GENERIC_DENY, GENERIC_DENY]);
});

test("a missing target uid or unauthenticated caller is rejected first", () => {
  assert.equal(authorizeSwitch({ callerUid: "", targetUid: "b" }).ok, false);
  assert.equal(authorizeSwitch({ callerUid: "a", targetUid: "", caller: tech }).ok, false);
});

/* ---------------- PIN presence ---------------- */

test("the no-PIN message is a FALLBACK instruction, never a probe", () => {
  assert.equal(hasPin(employee), false);
  assert.equal(hasPin({ ...employee, pinHash: "h", pinSalt: "s" }), true);
  // It says what to do instead; it never confirms an account exists, because
  // it is only reachable after authorization has already passed.
  assert.match(NO_PIN_MESSAGE, /email and password/i);
});

/* ---------------- Rate limiting ---------------- */

test("locks out after the cap, and the cooldown is what blocks further tries", () => {
  let s: AttemptState = EMPTY_ATTEMPTS;
  const now = 1_700_000_000_000;
  for (let i = 0; i < MAX_PIN_ATTEMPTS - 1; i++) {
    s = recordFailure(s, now + i);
    assert.equal(isCoolingDown(s, now + i), false);
  }
  s = recordFailure(s, now + MAX_PIN_ATTEMPTS);
  assert.equal(isCoolingDown(s, now + MAX_PIN_ATTEMPTS), true);
  assert.equal(isCoolingDown(s, now + MAX_PIN_ATTEMPTS + PIN_COOLDOWN_MS + 1), false);
});

test("old failures age out of the window rather than accumulating forever", () => {
  const now = 1_700_000_000_000;
  const stale: AttemptState = { failures: [now - ATTEMPT_WINDOW_MS - 1, now - ATTEMPT_WINDOW_MS - 2] };
  assert.equal(recordFailure(stale, now).failures.length, 1);
});

test("a successful switch clears the counter", () => {
  const s = recordFailure(recordFailure(EMPTY_ATTEMPTS, 1), 2);
  assert.deepEqual(recordSuccess(s).failures, []);
});

test("but a success does NOT hand back a budget that was already burned", () => {
  // Otherwise somebody could spend five guesses on a colleague's PIN, switch
  // to their own account, and start again.
  const cooling: AttemptState = { failures: [], cooldownUntil: Date.now() + 60_000 };
  assert.equal(recordSuccess(cooling).cooldownUntil, cooling.cooldownUntil);
});

test("the cooldown message says how long and offers the way round it", () => {
  const now = 1_700_000_000_000;
  const msg = cooldownMessage({ failures: [], cooldownUntil: now + 120_000 }, now);
  assert.match(msg, /2 minutes/);
  assert.match(msg, /password/i);
});

/* ---------------- Audit ---------------- */

test("a successful switch records who handed over to whom, and the machine", () => {
  const e = buildSwitchAuditEntry({
    id: "a1", now: 5, fromUid: "u1", fromEmail: "a@x", toUid: "u2", toEmail: "b@x",
    deviceId: "reg-1", outcome: "switched",
  });
  assert.equal(e.action, "auth.switch_user");
  assert.equal(e.userId, "u1");
  assert.equal(e.entityId, "u2");
  assert.deepEqual(e.after, {
    fromUid: "u1", fromEmail: "a@x", toUid: "u2", toEmail: "b@x",
    outcome: "switched", deviceId: "reg-1",
  });
});

test("a FAILED attempt is audited too — that is the pattern worth seeing", () => {
  const e = buildSwitchAuditEntry({
    id: "a2", now: 5, fromUid: "u1", fromEmail: "a@x", toUid: "u2", toEmail: "b@x",
    outcome: "wrong_pin",
  });
  assert.equal(e.action, "auth.switch_user_failed");
  assert.equal((e.after as Record<string, unknown>).outcome, "wrong_pin");
});

test("an audit entry never carries the PIN, the hash or the salt", () => {
  const e = buildSwitchAuditEntry({
    id: "a3", now: 5, fromUid: "u1", fromEmail: "a@x", toUid: "u2", toEmail: "b@x",
    outcome: "switched",
  });
  const blob = JSON.stringify(e);
  for (const forbidden of ["pin", "hash", "salt"]) {
    assert.equal(blob.toLowerCase().includes(`"${forbidden}"`), false);
  }
});
