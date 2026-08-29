import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeStaffUserCreate,
  buildCreateAuditEntry,
  buildFailureLog,
  classifyCreateUserError,
  UserRecord,
  validateEmail,
  validatePinTriple,
} from "./staffUserPolicy";

// Every authorization branch of createStaffUser (staffUser.ts) lives in this
// pure module precisely so it can be exercised without a live Firebase
// project — the onCall wrapper does nothing but read users/{uid} with the
// Admin SDK and hand the record + requested role to authorizeStaffUserCreate.

const WS = "workspace-owner-uid";
const owner: UserRecord = { role: "owner", workspaceId: WS, email: "owner@shop.test" };
const manager: UserRecord = { role: "manager", workspaceId: WS, email: "manager@shop.test" };
const employee: UserRecord = { role: "employee", workspaceId: WS, email: "employee@shop.test" };
const technician: UserRecord = { role: "technician", workspaceId: WS, email: "tech@shop.test" };

const authz = (caller: UserRecord | undefined, targetRole: unknown) =>
  authorizeStaffUserCreate({ callerUid: "caller-uid", caller, targetRole });

// --- Who may call, and which roles they may create --------------------------

test("an owner may create a manager, employee, or technician", () => {
  for (const role of ["manager", "employee", "technician"]) {
    assert.deepEqual(authz(owner, role), { ok: true });
  }
});

test("an owner may NOT create a second owner", () => {
  const r = authz(owner, "owner");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "permission-denied");
});

test("a manager may create a technician only", () => {
  assert.deepEqual(authz(manager, "technician"), { ok: true });
});

test("a manager may NOT create a manager, employee, or owner", () => {
  for (const role of ["manager", "employee", "owner"]) {
    const r = authz(manager, role);
    assert.equal(r.ok, false, `manager creating ${role} should be denied`);
    assert.equal(r.ok === false && r.code, "permission-denied");
  }
});

test("an employee caller is DENIED regardless of target role", () => {
  const r = authz(employee, "technician");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "permission-denied");
});

test("a technician caller is DENIED", () => {
  const r = authz(technician, "technician");
  assert.equal(r.ok, false);
});

test("a caller with no user record at all is DENIED", () => {
  assert.equal(authz(undefined, "technician").ok, false);
});

test("a DISABLED owner is DENIED", () => {
  assert.equal(authz({ ...owner, disabled: true }, "employee").ok, false);
});

test("an owner with no workspaceId is DENIED", () => {
  assert.equal(authz({ role: "owner", email: "x@y.z" }, "employee").ok, false);
});

test("an invalid/unknown target role is rejected as invalid-argument, even for an owner caller", () => {
  const r = authz(owner, "superadmin");
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.code, "invalid-argument");
});

test("a client-supplied role/workspace on the request cannot help — only the caller record read server-side is consulted", () => {
  assert.equal(authz({ role: "employee", workspaceId: WS } as UserRecord, "technician").ok, false);
});

// --- Email shape --------------------------------------------------------------

test("a well-formed email is accepted", () => {
  assert.equal(validateEmail("jordan@yourshop.local"), null);
  assert.equal(validateEmail("  jordan@yourshop.local  "), null);
});

test("a missing/blank/malformed email is rejected", () => {
  assert.notEqual(validateEmail(undefined), null);
  assert.notEqual(validateEmail(""), null);
  assert.notEqual(validateEmail("   "), null);
  assert.notEqual(validateEmail("not-an-email"), null);
  assert.notEqual(validateEmail("missing-domain@"), null);
  assert.notEqual(validateEmail(12345), null);
});

test("an absurdly long email is rejected", () => {
  assert.notEqual(validateEmail(`${"a".repeat(320)}@shop.test`), null);
});

// --- PIN triple consistency ---------------------------------------------------

test("no PIN fields at all is valid (PIN is optional)", () => {
  assert.equal(validatePinTriple({}), null);
});

test("a complete, well-typed PIN triple is valid", () => {
  assert.equal(validatePinTriple({ pinHash: "abc123", pinSalt: "def456", pinIterations: 150000 }), null);
});

test("a partial PIN triple (some fields present, some missing) is rejected", () => {
  assert.notEqual(validatePinTriple({ pinHash: "abc123" }), null);
  assert.notEqual(validatePinTriple({ pinHash: "abc123", pinSalt: "def456" }), null);
  assert.notEqual(validatePinTriple({ pinSalt: "def456", pinIterations: 150000 }), null);
});

test("a non-positive or non-numeric iterations count is rejected", () => {
  assert.notEqual(validatePinTriple({ pinHash: "a", pinSalt: "b", pinIterations: 0 }), null);
  assert.notEqual(validatePinTriple({ pinHash: "a", pinSalt: "b", pinIterations: -5 }), null);
  assert.notEqual(validatePinTriple({ pinHash: "a", pinSalt: "b", pinIterations: "150000" }), null);
});

// --- Audit entry -------------------------------------------------------------

test("the create audit entry identifies who created whom, and contains no password/PIN material", () => {
  const entry = buildCreateAuditEntry({
    id: "audit-1",
    now: 1_700_000_000_000,
    callerUid: "owner-uid",
    callerEmail: "owner@shop.test",
    targetUid: "new-employee-uid",
    targetEmail: "jordan@yourshop.local",
    targetRole: "employee",
  });

  assert.equal(entry.action, "user.create");
  assert.equal(entry.userId, "owner-uid");
  assert.equal(entry.userEmail, "owner@shop.test");
  assert.equal(entry.entityId, "new-employee-uid");
  assert.equal(entry.after.email, "jordan@yourshop.local");
  assert.equal(entry.after.role, "employee");

  // The structural guarantee: the builder has no password/PIN parameter, so
  // the serialized entry cannot carry one.
  const json = JSON.stringify(entry);
  assert.equal(json.toLowerCase().includes("password"), false);
  assert.equal(json.toLowerCase().includes("pin"), false);
});

// --- Failure classification --------------------------------------------------
// A bare `internal` is what a callable returns for ANY unhandled exception, so
// it told the person hitting it nothing and left the real cause visible only in
// the Functions logs. These lock in that every named failure gets its own code,
// that `internal` is reserved for a genuine crash, and — the security-relevant
// one — that no log line can carry a credential.

test("classifyCreateUserError: a duplicate email is 'already-exists', not 'internal'", () => {
  const c = classifyCreateUserError({ code: "auth/email-already-exists" });
  assert.equal(c.code, "already-exists");
  assert.equal(c.unexpected, false);
  assert.match(c.message, /already exists/i);
});

test("classifyCreateUserError: invalid email and weak password are both invalid-argument", () => {
  assert.equal(classifyCreateUserError({ code: "auth/invalid-email" }).code, "invalid-argument");
  assert.equal(classifyCreateUserError({ code: "auth/invalid-password" }).code, "invalid-argument");
  assert.equal(classifyCreateUserError({ code: "auth/weak-password" }).code, "invalid-argument");
});

test("classifyCreateUserError: a server-side permission problem is failed-precondition, with actionable advice", () => {
  const c = classifyCreateUserError({ code: "auth/insufficient-permission" });
  assert.equal(c.code, "failed-precondition");
  assert.equal(c.unexpected, false);
  assert.match(c.message, /permissions/i);

  // Email/password sign-in disabled is a project misconfiguration, not a crash.
  const off = classifyCreateUserError({ code: "auth/operation-not-allowed" });
  assert.equal(off.code, "failed-precondition");
  assert.match(off.message, /Firebase console/i);
});

test("classifyCreateUserError: transient service and network failures are retryable, not crashes", () => {
  for (const code of ["auth/internal-error", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]) {
    const c = classifyCreateUserError({ code });
    assert.equal(c.code, "unavailable", `expected ${code} -> unavailable`);
    assert.equal(c.unexpected, false);
  }
  assert.equal(classifyCreateUserError({ code: "auth/too-many-requests" }).code, "resource-exhausted");
});

test("classifyCreateUserError: 'internal' is reserved for genuinely unexpected failures", () => {
  for (const err of [new Error("kaboom"), { code: "something/unheard-of" }, null, undefined, "a string"]) {
    const c = classifyCreateUserError(err);
    assert.equal(c.code, "internal");
    assert.equal(c.unexpected, true); // the ONLY case flagged as a real crash
  }
});

test("buildFailureLog: carries enough to debug — caller, target, stage, auth code", () => {
  const err = { code: "auth/email-already-exists" };
  const log = buildFailureLog({
    stage: "auth",
    callerUid: "owner-uid",
    targetEmail: "jordan@yourshop.local",
    targetRole: "employee",
    err,
    classified: classifyCreateUserError(err),
  });
  assert.equal(log.event, "createStaffUser.failure");
  assert.equal(log.stage, "auth");
  assert.equal(log.callerUid, "owner-uid");
  assert.equal(log.authCode, "auth/email-already-exists");
  assert.equal(log.resultCode, "already-exists");
  assert.equal(log.unexpected, false);
});

test("buildFailureLog: NEVER carries a password or PIN, even when handed one", () => {
  // The structural guarantee: the builder has no password/PIN parameter, so an
  // extra property on the thrown error cannot reach the serialized log line.
  const err = Object.assign(new Error("boom"), {
    code: "auth/invalid-password",
    password: "hunter2-super-secret",
    pinHash: "deadbeef",
  });
  const log = buildFailureLog({
    stage: "auth",
    callerUid: "owner-uid",
    targetEmail: "jordan@yourshop.local",
    targetRole: "technician",
    err,
    classified: classifyCreateUserError(err),
  });
  const json = JSON.stringify(log).toLowerCase();
  // The credential VALUES are what must never appear.
  assert.equal(json.includes("hunter2"), false);
  assert.equal(json.includes("deadbeef"), false);
  // And no field carries them: the log's keys are a closed, known set. (The
  // literal word "password" CAN legitimately appear inside `authCode` — e.g.
  // "auth/invalid-password" — which is a Firebase error code, not a secret,
  // and is exactly the sort of detail that makes a failure debuggable.)
  assert.deepEqual(Object.keys(log).sort(), [
    "authCode", "callerUid", "event", "resultCode", "stage", "targetEmail", "targetRole", "unexpected",
  ]);
  assert.equal(log.authCode, "auth/invalid-password");
  const asRecord = log as unknown as Record<string, unknown>;
  assert.equal(asRecord.password, undefined);
  assert.equal(asRecord.pinHash, undefined);
});

test("no classified message ever echoes a credential back to the caller", () => {
  // Every message is a fixed string chosen by code — none is built from input.
  for (const code of [
    "auth/email-already-exists", "auth/invalid-email", "auth/invalid-password", "auth/weak-password",
    "auth/uid-already-exists", "auth/insufficient-permission", "auth/internal-error",
    "auth/too-many-requests", "auth/operation-not-allowed", "unknown/whatever",
  ]) {
    const msg = classifyCreateUserError({ code, password: "hunter2-super-secret" }).message.toLowerCase();
    assert.equal(msg.includes("hunter2"), false, `leaked for ${code}`);
  }
});
