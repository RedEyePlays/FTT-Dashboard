import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTechRepairUpdate, computeWarrantyUntil } from "./repairUpdate";

// This is the server-side equivalent of a Firestore rules test — it can't be
// exercised via the Rules Playground/emulator in this repo's CI (see
// firestore.rules' top comment), so this exercises the same guarantee the
// rules change is meant to enforce: a technician cannot make completedAt or
// warrantyUntil come out to a value they supplied.

test("a technician cannot smuggle an arbitrary completedAt/warrantyUntil/completedBy through draft", () => {
  const stored = { status: "in_repair", warrantyDays: 30 };
  const draft = {
    status: "picked_up",
    techNotes: "fixed screen",
    // An attacker hitting the callable directly (bypassing the app UI) could
    // put anything here — none of it may end up in the update.
    completedAt: 1, // a suspiciously old/backdated timestamp
    warrantyUntil: "2099-12-31",
    completedBy: "someone-elses-uid",
  };
  const now = Date.parse("2026-08-25T12:00:00Z");
  const update = buildTechRepairUpdate(stored, draft, "tech-uid", now);

  assert.equal(update.completedAt, now); // computed here, not the attacker's `1`
  assert.equal(update.completedBy, "tech-uid"); // the verified caller, not the attacker's uid
  assert.equal(update.warrantyUntil, computeWarrantyUntil("2026-08-25", 30)); // derived from warrantyDays, not "2099-12-31"
  assert.notEqual(update.warrantyUntil, "2099-12-31");
});

test("drops any field outside the technician whitelist, even if present in draft", () => {
  const stored = { status: "in_repair" };
  const draft = {
    status: "in_repair",
    techNotes: "ok",
    repairPrice: 9999,       // price — never technician-writable
    customerName: "Nobody",  // customer — never technician-writable
    inventoryId: "hijacked", // device link — never technician-writable
  };
  const update = buildTechRepairUpdate(stored, draft, "tech-uid", Date.now());

  assert.equal(update.techNotes, "ok");
  assert.equal("repairPrice" in update, false);
  assert.equal("customerName" in update, false);
  assert.equal("inventoryId" in update, false);
});

test("ignores a status value outside the technician-allowed set", () => {
  const stored = { status: "in_repair" };
  // 'completed' is deliberately not technician-settable (see TECH_STATUSES) —
  // a technician stays on 'picked_up' as their terminal state.
  const update = buildTechRepairUpdate(stored, { status: "completed" }, "tech-uid", Date.now());
  assert.equal("status" in update, false);
  // and completion is therefore not stamped either, since the status never changed.
  assert.equal("completedAt" in update, false);
});

test("stamps completion once, from the server's own clock, when status reaches picked_up", () => {
  const stored = { status: "testing", warrantyDays: 14 };
  const now = Date.parse("2026-01-10T00:00:00Z");
  const update = buildTechRepairUpdate(stored, { status: "picked_up" }, "tech-uid", now);

  assert.equal(update.status, "picked_up");
  assert.equal(update.completedAt, now);
  assert.equal(update.completedBy, "tech-uid");
  assert.equal(update.warrantyUntil, "2026-01-24");
});

test("never re-stamps completion once it is already set (idempotent)", () => {
  const stored = { status: "picked_up", completedAt: 12345, warrantyDays: 30 };
  const update = buildTechRepairUpdate(stored, { status: "picked_up", techNotes: "later edit" }, "tech-uid", Date.now());

  assert.equal("completedAt" in update, false);
  assert.equal("completedBy" in update, false);
  assert.equal("warrantyUntil" in update, false);
  assert.equal(update.techNotes, "later edit"); // the actual edit still goes through
});

test("does not stamp completion for a non-terminal status change", () => {
  const stored = { status: "received" };
  const update = buildTechRepairUpdate(stored, { status: "diagnosing" }, "tech-uid", Date.now());
  assert.equal(update.status, "diagnosing");
  assert.equal("completedAt" in update, false);
});

test("computeWarrantyUntil mirrors domain/repairs.ts: empty without a positive warrantyDays", () => {
  assert.equal(computeWarrantyUntil("2026-01-01", 0), "");
  assert.equal(computeWarrantyUntil("2026-01-01", undefined), "");
  assert.equal(computeWarrantyUntil("2026-01-01", 10), "2026-01-11");
});
