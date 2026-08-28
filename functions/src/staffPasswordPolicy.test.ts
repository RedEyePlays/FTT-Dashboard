import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeStaffPasswordReset,
  buildResetAuditEntry,
  MIN_PASSWORD_LENGTH,
  recordAttempt,
  RATE_LIMIT_MAX_PER_WINDOW,
  RATE_LIMIT_WINDOW_MS,
  UserRecord,
  validatePassword,
} from "./staffPasswordPolicy";

// Every authorization branch of setStaffPassword (staffPassword.ts) lives in
// this pure module precisely so it can be exercised without a live Firebase
// project — the onCall wrapper does nothing but read users/{uid} with the
// Admin SDK and hand the two records to authorizeStaffPasswordReset.

const WS = "workspace-owner-uid";
const owner: UserRecord = { role: "owner", workspaceId: WS, email: "owner@shop.test" };
const manager: UserRecord = { role: "manager", workspaceId: WS, email: "manager@shop.test" };
const employee: UserRecord = { role: "employee", workspaceId: WS, email: "employee@shop.test" };
const technician: UserRecord = { role: "technician", workspaceId: WS, email: "tech@shop.test" };

const authz = (caller: UserRecord | undefined, target: UserRecord | undefined) =>
  authorizeStaffPasswordReset({ callerUid: "caller-uid", targetUid: "target-uid", caller, target });

// --- Who may call ------------------------------------------------------------

test("an owner may reset a manager/employee/technician password in their workspace", () => {
  for (const target of [manager, employee, technician]) {
    assert.deepEqual(authz(owner, target), { ok: true });
  }
});

test("a manager caller is DENIED", () => {
  const r = authz(manager, employee);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "permission-denied");
});

test("an employee caller is DENIED", () => {
  const r = authz(employee, technician);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "permission-denied");
});

test("a technician caller is DENIED", () => {
  const r = authz(technician, employee);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "permission-denied");
});

test("a caller with no user record at all is DENIED", () => {
  assert.equal(authz(undefined, employee).ok, false);
});

test("a DISABLED owner is DENIED", () => {
  assert.equal(authz({ ...owner, disabled: true }, employee).ok, false);
});

test("an owner with no workspaceId is DENIED", () => {
  assert.equal(authz({ role: "owner", email: "x@y.z" }, employee).ok, false);
});

// --- Who may be targeted -----------------------------------------------------

test("a cross-workspace target is DENIED", () => {
  const foreign: UserRecord = { role: "employee", workspaceId: "some-other-workspace", email: "e@other.test" };
  const r = authz(owner, foreign);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "not-found");
  // Must not confirm the uid exists elsewhere.
  assert.equal(r.ok === false && r.message, "That user is not part of this shop.");
});

test("a missing target is DENIED with the same message as a cross-workspace one", () => {
  const missing = authz(owner, undefined);
  const foreign = authz(owner, { role: "employee", workspaceId: "elsewhere" });
  assert.equal(missing.ok, false);
  assert.equal(
    missing.ok === false && foreign.ok === false && missing.message === foreign.message,
    true,
  );
});

test("an owner may NOT reset another owner's password", () => {
  const otherOwner: UserRecord = { role: "owner", workspaceId: WS, email: "co-owner@shop.test" };
  const r = authz(owner, otherOwner);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "permission-denied");
});

test("an owner may NOT reset their own password through this path (self is an owner)", () => {
  const r = authorizeStaffPasswordReset({
    callerUid: "same-uid", targetUid: "same-uid", caller: owner, target: owner,
  });
  assert.equal(r.ok, false);
});

test("a blank target uid is rejected as invalid-argument", () => {
  const r = authorizeStaffPasswordReset({ callerUid: "caller-uid", targetUid: "", caller: owner, target: employee });
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "invalid-argument");
});

test("a client-supplied role/workspace on the request cannot help — only the records read server-side are consulted", () => {
  // authorizeStaffPasswordReset's signature has no place to put a claimed
  // role or workspace: the only role/workspace it sees are the ones on the
  // `caller`/`target` records the callable read from Firestore by uid.
  // Handing it a caller record whose role is a lie still fails if that lie
  // isn't 'owner', and there is no third channel to inject one.
  assert.equal(authz({ role: "employee", workspaceId: WS } as UserRecord, employee).ok, false);
});

// --- Password strength -------------------------------------------------------

test("a password shorter than the minimum is rejected", () => {
  assert.notEqual(validatePassword("aB1" + "x".repeat(MIN_PASSWORD_LENGTH - 4)), null);
  assert.notEqual(validatePassword("Ab1"), null);
});

test("a long single-class password is rejected", () => {
  assert.notEqual(validatePassword("aaaaaaaaaaaaaa"), null);
});

test("a password with two character classes and enough length is accepted", () => {
  assert.equal(validatePassword("shopfloor42"), null);
  assert.equal(validatePassword("Bluewidget99!"), null);
});

test("non-strings, leading/trailing spaces and absurd lengths are rejected", () => {
  assert.notEqual(validatePassword(undefined), null);
  assert.notEqual(validatePassword(12345678901), null);
  assert.notEqual(validatePassword(" shopfloor42"), null);
  assert.notEqual(validatePassword("shopfloor42 "), null);
  assert.notEqual(validatePassword("a1" + "x".repeat(5000)), null);
});

test("a rejection reason never contains the candidate password", () => {
  const secret = "correcthorse";
  const reason = validatePassword("ab") || "";
  assert.equal(reason.includes(secret), false);
  assert.equal(reason.includes("ab"), false);
});

// --- Rate limiting -----------------------------------------------------------

test("the first RATE_LIMIT_MAX_PER_WINDOW attempts in a window pass, the next is throttled", () => {
  let history: number[] = [];
  const t0 = 1_000_000;
  for (let i = 0; i < RATE_LIMIT_MAX_PER_WINDOW; i++) {
    const r = recordAttempt(history, t0 + i * 1000);
    history = r.history;
    assert.equal(r.exceeded, false, `attempt ${i + 1} should be allowed`);
  }
  const over = recordAttempt(history, t0 + RATE_LIMIT_MAX_PER_WINDOW * 1000);
  assert.equal(over.exceeded, true);
});

test("attempts older than the window are pruned and stop counting", () => {
  const t0 = 1_000_000;
  const stale = Array.from({ length: RATE_LIMIT_MAX_PER_WINDOW }, (_, i) => t0 + i);
  const later = recordAttempt(stale, t0 + RATE_LIMIT_WINDOW_MS + RATE_LIMIT_MAX_PER_WINDOW);
  assert.equal(later.exceeded, false);
  assert.equal(later.history.length, 1);
});

test("the window is a sliding one — a burst at the edge still trips", () => {
  const t0 = 1_000_000;
  const recent = Array.from({ length: RATE_LIMIT_MAX_PER_WINDOW }, () => t0);
  const r = recordAttempt(recent, t0 + RATE_LIMIT_WINDOW_MS - 1);
  assert.equal(r.exceeded, true);
});

// --- Audit entry -------------------------------------------------------------

test("the reset audit entry identifies who reset whom, and contains no password material", () => {
  const entry = buildResetAuditEntry({
    id: "audit-1",
    now: 1_700_000_000_000,
    callerUid: "owner-uid",
    callerEmail: "owner@shop.test",
    targetUid: "employee-uid",
    targetEmail: "employee@shop.test",
    sessionsRevoked: true,
  });

  assert.equal(entry.action, "user.password_reset");
  assert.equal(entry.userId, "owner-uid");
  assert.equal(entry.userEmail, "owner@shop.test");
  assert.equal(entry.entityId, "employee-uid");
  assert.equal(entry.after.targetEmail, "employee@shop.test");
  assert.equal(entry.after.sessionsRevoked, true);

  // The structural guarantee: the builder has no password parameter, so the
  // serialized entry cannot carry one. Assert on the persisted JSON that no
  // password VALUE appears — the only "password" substring present is the
  // action name 'user.password_reset', which is exactly what should be there.
  const json = JSON.stringify(entry);
  const values = Object.values(entry).concat(Object.values(entry.after)).map(String);
  assert.equal(values.some((v) => v === "hunter2secret" || v === "shopfloor42"), false);
  assert.equal(json.includes("newPassword"), false);
  assert.equal(json.match(/password/gi)?.length, 1, "only the action name may mention 'password'");
  assert.equal(json.includes("user.password_reset"), true);
});
