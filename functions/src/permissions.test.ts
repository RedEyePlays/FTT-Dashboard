import { test } from "node:test";
import assert from "node:assert/strict";
import { hasProfitVisibility } from "./permissions";

// Mirrors the truth table services/rbac.test.ts already covers for
// can(role, 'reports.profit.summary', {allowProfit}) — this is the server-side
// copy aiGenerate's insights/chat ops gate on (see index.ts's
// requireProfitVisibility), so it needs the exact same answers.

test("owner always has profit visibility", () => {
  assert.equal(hasProfitVisibility("owner", false), true);
  assert.equal(hasProfitVisibility("owner", undefined), true);
});

test("manager always has profit visibility", () => {
  assert.equal(hasProfitVisibility("manager", false), true);
  assert.equal(hasProfitVisibility("manager", undefined), true);
});

test("employee has profit visibility only with the allowProfit override", () => {
  assert.equal(hasProfitVisibility("employee", true), true);
  assert.equal(hasProfitVisibility("employee", false), false);
  assert.equal(hasProfitVisibility("employee", undefined), false);
});

test("technician never has profit visibility, even with allowProfit set", () => {
  assert.equal(hasProfitVisibility("technician", true), false);
  assert.equal(hasProfitVisibility("technician", false), false);
});

test("an unknown/missing role never has profit visibility", () => {
  assert.equal(hasProfitVisibility(undefined, true), false);
  assert.equal(hasProfitVisibility("something-else", true), false);
});
