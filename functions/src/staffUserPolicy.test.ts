import { test } from "node:test";
import assert from "node:assert/strict";
import {
  authorizeStaffUserCreate,
  buildCreateAuditEntry,
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
