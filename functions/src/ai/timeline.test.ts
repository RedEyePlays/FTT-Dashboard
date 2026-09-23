import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CONTEXT_CHARS } from "./retrievalPolicy";
import {
  DeviceStory, deviceHeadline, deviceTimeline, renderContext, renderRecord,
  renderSummary, renderTimeline,
} from "./timeline";

/**
 * "What happened to PHN-000123" is a question about a sequence of events
 * spread over five collections. The answer is the sequence — not the five
 * documents.
 */

const FULL = { canSeeMoney: true, canSeePayroll: true };
const NO_MONEY = { canSeeMoney: false, canSeePayroll: true };

const story = (over: Partial<DeviceStory> = {}): DeviceStory => ({
  item: {
    id: "d1", sku: "PHN-000123", item: "iPhone 13 Pro", storage: "128GB", color: "Graphite",
    condition: "Good", date: "2026-06-01", boughtFrom: "Dana Wu", purchaseSource: "Marketplace",
    purchaseCost: 540, repairCost: 60, deviceStatus: "sold",
  },
  repairs: [{
    id: "r1", repairNumber: "RPR-000412", date: "2026-06-05", issue: "Screen replacement",
    status: "completed", repairPrice: 189,
  }],
  sales: [{
    id: "s1", date: "2026-06-12", customerName: "Ali Reza", totalPaid: 850, paymentMethod: "card",
  }],
  dropOffs: [],
  builds: [],
  audit: [{ id: "a1", ts: Date.UTC(2026, 5, 12, 15, 0), action: "sale.complete", userEmail: "sam@shop.test" }],
  ...over,
});

test("the timeline is the whole story, oldest first", () => {
  const events = deviceTimeline(story(), FULL);
  const dates = events.map(e => e.date);
  assert.deepEqual([...dates].sort(), dates);       // already in order
  const text = events.map(e => e.text).join("\n");
  assert.match(text, /Bought from Dana Wu/);
  assert.match(text, /Repair RPR-000412/);
  assert.match(text, /Sold to Ali Reza for \$850\.00/);
  assert.match(text, /sale complete by sam@shop\.test/);
});

test("a warranty claim reads as one, and is not shown as a charge", () => {
  const events = deviceTimeline(story({
    repairs: [{ id: "r2", repairNumber: "RPR-000500", date: "2026-07-01", issue: "Battery", status: "completed", repairPrice: 0, isWarrantyClaim: true }],
  }), FULL);
  const text = events.map(e => e.text).join("\n");
  assert.match(text, /Warranty claim RPR-000500/);
  assert.ok(!/charged/.test(text));
});

test("a drop-off and a build appear when they are part of the story", () => {
  const events = deviceTimeline(story({
    dropOffs: [{ id: "x", dateDropped: "2026-05-30", sellerName: "Marketplace Joe", purchasePrice: 500, status: "settled" }],
    builds: [{ id: "b1", name: "REAPER Gaming PC", finishedAt: Date.UTC(2026, 5, 2), parts: [1, 2, 3] }],
  }), FULL);
  const text = events.map(e => e.text).join("\n");
  assert.match(text, /Drop-off from Marketplace Joe at \$500\.00/);
  assert.match(text, /Built in-house as "REAPER Gaming PC" \(3 parts\)/);
});

test("WITHOUT money access the sale price stays and the COST goes", () => {
  // The sale price is on the customer's receipt and in every sales view an
  // employee already uses; the purchase cost is the gated figure.
  const events = deviceTimeline(story(), NO_MONEY);
  const text = events.map(e => e.text).join("\n");
  assert.match(text, /Sold to Ali Reza for \$850\.00/);
  assert.ok(!/540/.test(text), "the purchase cost must not appear");
  assert.match(text, /Bought from Dana Wu/);
});

test("the headline carries cost only for somebody who may see it", () => {
  assert.match(deviceHeadline(story().item, FULL), /cost \$540\.00/);
  const without = deviceHeadline(story().item, NO_MONEY);
  assert.ok(!/540/.test(without));
  assert.match(without, /SKU PHN-000123/);
  assert.match(without, /status sold/);
});

test("an undated event is kept, at the end, rather than dropped", () => {
  const events = deviceTimeline(story({
    repairs: [{ id: "r3", repairNumber: "RPR-000999", issue: "Unknown", status: "received" }],
  }), FULL);
  assert.equal(events[events.length - 1].date, undefined);
  assert.match(renderTimeline("head", events), /\(undated\)/);
});

/* ---------------- The context block ---------------- */

const summary = { devicesInStock: 42, devicesSoldThisMonth: 9, openRepairs: 4, salesToday: 1250.5, salesThisMonth: 18400 };

test("the summary is the cheap part and is always there", () => {
  const text = renderSummary(summary);
  assert.match(text, /Devices in stock: 42/);
  assert.match(text, /Sales today: \$1250\.50/);
});

test("a summary without money figures simply omits them", () => {
  const text = renderSummary({ devicesInStock: 42, devicesSoldThisMonth: 9, openRepairs: 4 });
  assert.ok(!/Sales/.test(text));
});

test("blocks past the character cap are left out, and the model is TOLD", () => {
  const big = { title: "DEVICE", body: "x".repeat(MAX_CONTEXT_CHARS) };
  const { text, truncated } = renderContext(summary, [
    { title: "DEVICE — A", body: "  small" },
    big,
    big,
  ]);
  assert.equal(truncated, 2);
  assert.ok(text.length <= MAX_CONTEXT_CHARS + 400);
  assert.match(text, /2 further records matched but were left out/);
  // The one that fitted is still whole — truncation lands on a block boundary,
  // never mid-line.
  assert.match(text, /DEVICE — A\n {2}small/);
});

test("nothing is truncated when everything fits", () => {
  const { truncated, text } = renderContext(summary, [{ title: "T", body: "  b" }]);
  assert.equal(truncated, 0);
  assert.ok(!/left out/.test(text));
});

test("renderRecord drops empty fields, nested objects, and anything redacted", () => {
  const text = renderRecord({
    sku: "PHN-1", purchaseCost: 540, notes: "", lines: [{ a: 1 }], nested: { x: 1 }, item: "iPhone",
  }, NO_MONEY);
  assert.match(text, /sku: PHN-1/);
  assert.match(text, /item: iPhone/);
  assert.ok(!/purchaseCost/.test(text));
  assert.ok(!/nested/.test(text));
  assert.ok(!/notes/.test(text));
});
