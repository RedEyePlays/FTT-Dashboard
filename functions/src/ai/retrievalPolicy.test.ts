import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MAX_CONTEXT_CHARS, MAX_HISTORY_TURNS, MAX_RECORDS_PER_KIND, MAX_TURN_CHARS,
  MONEY_FIELDS, PAYROLL_FIELDS, CONTACT_FIELDS,
  matchesIdentifier, matchesWords, parseDateRange, planQuestion, redactRecord, selectDevices,
} from "./retrievalPolicy";

/**
 * The retrieval step replaced `JSON.stringify(inventory)` on every turn. Its
 * job is to pull the RIGHT records and nothing else, and to hand this
 * particular caller only what they are allowed to see.
 */

const TODAY = "2026-09-24";

const device = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: "d1",
  sku: "PHN-000123",
  imei: "356789012340005",
  imeiNormalized: "356789012340005",
  item: "iPhone 13 Pro",
  brand: "Apple",
  model: "iPhone 13 Pro",
  storage: "128GB",
  color: "Graphite",
  purchaseCost: 540,
  targetSalePrice: 850,
  boughtFrom: "Dana Wu",
  ...over,
});

/* ---------------- Reading the question ---------------- */

test("a SKU in the question is picked up as an exact identifier", () => {
  const plan = planQuestion("what happened to PHN-000123?", TODAY);
  assert.deepEqual(plan.identifiers, ["PHN000123"]);
  assert.equal(plan.broad, false);
});

test("a SKU written with different punctuation resolves the same way", () => {
  // The app's own scanner normalises both sides; so does this.
  assert.deepEqual(planQuestion("phn 000123", TODAY).identifiers, ["PHN000123"]);
});

test("an IMEI is picked up, spaced or not", () => {
  assert.ok(planQuestion("356789012340005", TODAY).identifiers.includes("356789012340005"));
  assert.ok(planQuestion("35 678901 234000 5", TODAY).identifiers.includes("356789012340005"));
});

test("a repair number is kept separate from an inventory code", () => {
  const plan = planQuestion("is RPR-000412 ready?", TODAY);
  assert.deepEqual(plan.repairNumbers, ["RPR000412"]);
  assert.ok(!plan.identifiers.includes("RPR000412"));
});

test("a plain description becomes search words, minus the noise", () => {
  const plan = planQuestion("what did we do with the iphone 13 128gb?", TODAY);
  assert.ok(plan.words.includes("iphone"));
  assert.ok(plan.words.includes("128gb"));
  for (const noise of ["what", "did", "we", "with", "the"]) {
    assert.ok(!plan.words.includes(noise), `"${noise}" should not be a search word`);
  }
});

test("a question that names nothing is BROAD and retrieves no records", () => {
  const plan = planQuestion("how are we doing?", TODAY);
  assert.equal(plan.broad, true);
  assert.deepEqual(plan.identifiers, []);
});

test("money and payroll questions are recognised", () => {
  assert.equal(planQuestion("what did we pay for PHN-000123", TODAY).asksMoney, true);
  assert.equal(planQuestion("how many hours did Sam work", TODAY).asksPayroll, true);
  assert.equal(planQuestion("is it ready", TODAY).asksMoney, false);
});

test("a customer is only a customer question when they are NAMED in quotes", () => {
  assert.equal(planQuestion('what is the phone number for customer "Dana Wu"', TODAY).customerQuery, "Dana Wu");
  // Asking about customers in general must not open the contact book.
  assert.equal(planQuestion("how many customers do we have", TODAY).customerQuery, undefined);
});

test("an enormous pasted message is cut before it is even parsed", () => {
  const plan = planQuestion("x".repeat(MAX_TURN_CHARS * 3), TODAY);
  assert.ok(plan.words.length <= 8);
});

/* ---------------- Date ranges ---------------- */

test("two ISO dates become a range, in order", () => {
  assert.deepEqual(parseDateRange("sales between 2026-09-01 and 2026-09-15", TODAY),
    { from: "2026-09-01", to: "2026-09-15" });
});

test("today, yesterday, this month and last month", () => {
  assert.deepEqual(parseDateRange("what sold today", TODAY), { from: TODAY, to: TODAY });
  assert.deepEqual(parseDateRange("what sold yesterday", TODAY), { from: "2026-09-23", to: "2026-09-23" });
  assert.deepEqual(parseDateRange("this month", TODAY), { from: "2026-09-01", to: TODAY });
  assert.deepEqual(parseDateRange("last month", TODAY), { from: "2026-08-01", to: "2026-08-31" });
});

test("a bare month name means the most recent one that has happened", () => {
  // Asked in September, "March" is this year's March; "November" is last year's.
  assert.deepEqual(parseDateRange("sales in march", TODAY), { from: "2026-03-01", to: "2026-03-31" });
  assert.deepEqual(parseDateRange("sales in november", TODAY), { from: "2025-11-01", to: "2025-11-30" });
});

test("no date in the question means no range, rather than a guessed one", () => {
  assert.equal(parseDateRange("what happened to PHN-000123", TODAY), undefined);
});

/* ---------------- Choosing the records ---------------- */

test("the referenced SKU is included and unrelated stock is not", () => {
  const items = [
    device(),
    device({ id: "d2", sku: "PHN-000999", item: "Pixel 8", brand: "Google", model: "Pixel 8", imei: "1", imeiNormalized: "1" }),
    device({ id: "d3", sku: "LAP-000004", item: "MacBook Air", brand: "Apple", model: "MacBook Air", imei: "2", imeiNormalized: "2" }),
  ];
  const chosen = selectDevices(items, planQuestion("what happened to PHN-000123?", TODAY));
  assert.deepEqual(chosen.map(i => i.id), ["d1"]);
});

test("an exact identifier hit is never crowded out by word matches", () => {
  const items = [
    ...Array.from({ length: 20 }, (_, i) => device({ id: `w${i}`, sku: `PHN-0009${i}`, imeiNormalized: `x${i}` })),
    device({ id: "target", sku: "PHN-000123" }),
  ];
  const chosen = selectDevices(items, planQuestion("iphone 13 PHN-000123", TODAY));
  assert.ok(chosen.some(i => i.id === "target"));
  assert.ok(chosen.length <= MAX_RECORDS_PER_KIND);
});

test("a word search matches the way the app's own search does", () => {
  // Four words in four different fields, and "128" finding "128GB".
  assert.equal(matchesWords(device(), ["iphone", "13", "graphite", "128"]), true);
  assert.equal(matchesWords(device(), ["iphone", "pixel"]), false);
  assert.equal(matchesWords(device(), []), false);
});

test("an identifier match ignores punctuation and case on both sides", () => {
  assert.equal(matchesIdentifier(device(), ["PHN000123"]), true);
  assert.equal(matchesIdentifier(device({ sku: "phn-000123" }), ["PHN000123"]), true);
  assert.equal(matchesIdentifier(device(), ["PHN000999"]), false);
  assert.equal(matchesIdentifier(device(), []), false);
});

test("the caps are real numbers, not aspirations", () => {
  assert.ok(MAX_RECORDS_PER_KIND > 0 && MAX_RECORDS_PER_KIND <= 25);
  assert.ok(MAX_CONTEXT_CHARS > 0 && MAX_CONTEXT_CHARS <= 40_000);
  assert.ok(MAX_HISTORY_TURNS > 0 && MAX_HISTORY_TURNS <= 30);
});

/* ---------------- What a caller may be told ---------------- */

const FULL_VIEW = { canSeeMoney: true, canSeePayroll: true };
const NO_MONEY = { canSeeMoney: false, canSeePayroll: true };
const NO_PAYROLL = { canSeeMoney: true, canSeePayroll: false };

test("a caller WITHOUT profit visibility gets every cost field stripped", () => {
  // A manager without the Financials override passes the chat's own gate and
  // must still not be handed a purchase cost by asking the assistant nicely.
  const out = redactRecord(device(), NO_MONEY);
  for (const field of MONEY_FIELDS) {
    assert.equal(field in out, false, `${field} should have been stripped`);
  }
  // …and still gets the device itself.
  assert.equal(out.sku, "PHN-000123");
  assert.equal(out.item, "iPhone 13 Pro");
});

test("a caller WITH profit visibility keeps the cost", () => {
  const out = redactRecord(device(), FULL_VIEW);
  assert.equal(out.purchaseCost, 540);
});

test("payroll fields are stripped from ANY record without payroll visibility", () => {
  const row = { name: "Sam", hourlyRate: 22, hoursWorked: 38, bonus: 100, grossPay: 936 };
  const out = redactRecord(row, NO_PAYROLL);
  for (const field of PAYROLL_FIELDS) {
    assert.equal(field in out, false, `${field} should have been stripped`);
  }
  assert.equal(out.name, "Sam");
});

test("contact details are withheld unless the question was about that customer", () => {
  const customer = { name: "Dana Wu", phone: "416-555-0100", email: "dana@example.com", address: "12 Main St" };
  const withheld = redactRecord(customer, FULL_VIEW);
  for (const field of CONTACT_FIELDS) assert.equal(field in withheld, false);
  assert.equal(withheld.name, "Dana Wu");

  const allowed = redactRecord(customer, FULL_VIEW, { allowContact: true });
  assert.equal(allowed.phone, "416-555-0100");
});

test("redaction never mutates the record it was given", () => {
  const row = device();
  redactRecord(row, NO_MONEY);
  assert.equal(row.purchaseCost, 540);
});

/* ---------------- What retrieval never even asks for ---------------- */

// Tests run from lib/, so the SOURCE is two levels up. Reading the source is
// the point: these assert on what the code says, not on what it computes.
const contextSource = (): string =>
  readFileSync(join(__dirname, "..", "..", "src", "ai", "context.ts"), "utf8");

test("the retrieval step never READS a payroll collection, for anybody", () => {
  // Stripping payroll fields is the second lock. This is the first: there is
  // no code path that fetches wages, hours, pay periods or bonuses at all, so
  // "was the caller allowed?" is a question that never has to be right.
  const src = contextSource();
  for (const collection of ["timeEntries", "payPeriods", "payPeriodApprovals", "staffBonuses", "kioskStaff", "staffNotes"]) {
    assert.ok(!src.includes(collection), `context.ts must not read ${collection}`);
  }
});

test("retrieval reads only the collections that tell a device's story", () => {
  const src = contextSource();
  const read = [...src.matchAll(/user_data\/\$\{ws\}\/([a-zA-Z]+)|\$\{base\}\/([a-zA-Z]+)/g)]
    .map(m => m[1] || m[2]);
  const allowed = [
    "inventory", "repairs", "salesTransactions", "dropOffs", "pcBuilds", "auditLogs", "customers",
  ];
  for (const collection of new Set(read)) {
    assert.ok(allowed.includes(collection), `context.ts reads an unexpected collection: ${collection}`);
  }
});

test("customer CONTACT details are reachable only through the allowContact flag", () => {
  const src = contextSource();
  const uses = [...src.matchAll(/allowContact: true/g)];
  // Exactly one place: the block for a customer the question named.
  assert.equal(uses.length, 1);
  assert.match(src, /CUSTOMER — /);
});
