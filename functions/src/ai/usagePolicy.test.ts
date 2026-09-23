import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_DAILY_AI_CALLS, MAX_DAILY_AI_CALLS, MIN_DAILY_AI_CALLS,
  buildUsageReport, capMessage, clampDailyCap, estimateTokens, overCap, usageDay,
} from "./usagePolicy";

test("the cap has a sane default and cannot be set to nothing or to infinity", () => {
  assert.equal(clampDailyCap(undefined), DEFAULT_DAILY_AI_CALLS);
  assert.equal(clampDailyCap("not a number"), DEFAULT_DAILY_AI_CALLS);
  assert.equal(clampDailyCap(0), MIN_DAILY_AI_CALLS);
  assert.equal(clampDailyCap(-50), MIN_DAILY_AI_CALLS);
  assert.equal(clampDailyCap(1_000_000), MAX_DAILY_AI_CALLS);
  assert.equal(clampDailyCap(250), 250);
});

test("the cap refuses at the limit, not one past it", () => {
  assert.equal(overCap({ used: 199, cap: 200 }), false);
  assert.equal(overCap({ used: 200, cap: 200 }), true);
  assert.equal(overCap({ used: 201, cap: 200 }), true);
});

test("hitting the cap produces a plain message, not a silent failure", () => {
  const msg = capMessage({ used: 200, cap: 200 });
  assert.match(msg, /200 requests/);
  assert.match(msg, /resets at midnight/i);
  assert.match(msg, /Settings/);
});

test("the usage day is UTC, so both ends agree on which day a call belongs to", () => {
  assert.equal(usageDay(Date.UTC(2026, 8, 24, 23, 59)), "2026-09-24");
  assert.equal(usageDay(Date.UTC(2026, 8, 25, 0, 1)), "2026-09-25");
});

test("token estimates are rough, positive, and never negative", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("a".repeat(4000)), 1000);
});

test("the usage report rolls days into today, the month, and a breakdown by op", () => {
  const report = buildUsageReport([
    { day: "2026-09-24", total: 12, byOp: { chat: 10, listing: 2 } },
    { day: "2026-09-23", total: 5, byOp: { chat: 5 } },
    { day: "2026-08-31", total: 99, byOp: { chat: 99 } },
  ], 200, "2026-09-24");

  assert.equal(report.today, 12);
  assert.equal(report.cap, 200);
  // August is a different month and must not be counted in "this month".
  assert.equal(report.monthToDate, 17);
  assert.deepEqual(report.byOp, { chat: 15, listing: 2 });
  assert.equal(report.days[0].day, "2026-09-24");
});

test("a day with no calls reads as zero rather than as missing", () => {
  const report = buildUsageReport([], 200, "2026-09-24");
  assert.equal(report.today, 0);
  assert.equal(report.monthToDate, 0);
  assert.deepEqual(report.byOp, {});
});
