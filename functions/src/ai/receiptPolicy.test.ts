import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CategoryOption, MAX_RECEIPT_TEXT_CHARS, clampCategory, currencyCode, isoDate,
  liveCategories, money, parseIsEmpty, receiptPrompt, receiptSchema,
  validateReceiptParse,
} from "./receiptPolicy";

/**
 * THE MODEL MUST NOT GUESS.
 *
 * A field it cannot read comes back absent, not approximated. An empty field
 * the owner fills in is a minor annoyance; a confidently wrong total that
 * reaches a draft is the failure the whole feature exists to avoid — somebody
 * will rely on these figures months later with the paper already binned.
 *
 * And the category is always one of the SHOP's own, never one the model
 * invented, because a suggestion the expense form cannot accept turns a
 * one-tap confirm into a puzzle.
 */

const CATEGORIES: CategoryOption[] = [
  { key: "supplies", label: "Supplies" },
  { key: "rent", label: "Rent" },
  { key: "tools", label: "Tools" },
  { key: "old", label: "Old Thing", archived: true },
];

/* ---------------- The prompt ---------------- */

test("the prompt lists ONLY this shop's live categories, by key", () => {
  const p = receiptPrompt(CATEGORIES, "2026-10-18");
  assert.match(p, /- supplies \(Supplies\)/);
  assert.match(p, /- rent \(Rent\)/);
  // An archived category is valid on history but is not something to file
  // anything new under.
  assert.ok(!/- old \(/.test(p));
});

test("the prompt forbids guessing, in the three ways models actually guess", () => {
  // Whitespace-normalised: the prompt is hard-wrapped for legibility, so a
  // phrase can span a line break. Asserting on the raw string would make the
  // test fail on reflowing a paragraph, which teaches you to weaken it.
  const p = receiptPrompt(CATEGORIES, "2026-10-18").replace(/\s+/g, " ");
  assert.match(p, /DO NOT GUESS/);
  assert.match(p, /OMIT THE FIELD/);
  // Calculating a total off the line items.
  assert.match(p, /Never calculate a total you cannot see printed/);
  // Borrowing the year from today.
  assert.match(p, /Never infer the year from today's date/);
  // Assuming a currency.
  assert.match(p, /Never convert a currency/);
});

test("today's date is given as context and named as NOT the answer", () => {
  const p = receiptPrompt(CATEGORIES, "2026-10-18").replace(/\s+/g, " ");
  assert.match(p, /2026-10-18/);
  assert.match(p, /NEVER the answer on its own/);
});

test("a shop with no categories is told to omit the field entirely", () => {
  const p = receiptPrompt([], "2026-10-18");
  assert.match(p, /none configured — leave category out entirely/);
});

/* ---------------- The schema ---------------- */

test("NOTHING is required — requiring a field is what makes a model invent one", () => {
  const s = receiptSchema(CATEGORIES) as unknown as { required: string[]; type: string };
  assert.deepEqual(s.required, []);
  assert.equal(s.type, "object");
});

test("the category is an enum of this shop's keys", () => {
  const s = receiptSchema(CATEGORIES) as unknown as {
    properties: { category?: { enum?: string[] } };
  };
  assert.deepEqual(s.properties.category?.enum, ["supplies", "rent", "tools"]);
});

test("with no categories there is no category property at all", () => {
  const s = receiptSchema([]) as unknown as { properties: Record<string, unknown> };
  assert.equal("category" in s.properties, false);
});

/* ---------------- Field validation: drop, never default ---------------- */

test("a money figure is kept only when it is a plausible reading", () => {
  assert.equal(money(84.21), 84.21);
  assert.equal(money("84.21"), 84.21);
  assert.equal(money("$1,284.21"), 1284.21);
  // A zero total is not a reading, it is a blank being filled in.
  assert.equal(money(0), undefined);
  assert.equal(money(-5), undefined);
  assert.equal(money("abc"), undefined);
  assert.equal(money(null), undefined);
  // An absurd magnitude is almost always a misread decimal separator.
  assert.equal(money(5_000_000), undefined);
  // Rounded to cents, never a floating-point tail.
  assert.equal(money(12.3456), 12.35);
});

test("a date must be a real calendar date, and is never coerced", () => {
  assert.equal(isoDate("2026-10-02"), "2026-10-02");
  // Passes the regex, is not a day.
  assert.equal(isoDate("2026-02-31"), undefined);
  assert.equal(isoDate("2026-13-01"), undefined);
  // Other formats are DROPPED rather than reinterpreted — guessing day/month
  // order is how a receipt ends up in the wrong month.
  assert.equal(isoDate("02/10/2026"), undefined);
  assert.equal(isoDate("October 2 2026"), undefined);
  assert.equal(isoDate("2026-10"), undefined);
  assert.equal(isoDate(""), undefined);
  // A year that cannot be right is a misread.
  assert.equal(isoDate("1026-10-02"), undefined);
});

test("a currency is kept only as a real three-letter code", () => {
  assert.equal(currencyCode("cad"), "CAD");
  assert.equal(currencyCode("USD"), "USD");
  assert.equal(currencyCode("$"), undefined);
  assert.equal(currencyCode("dollars"), undefined);
});

/* ---------------- The category clamp ---------------- */

test("the suggested category is ALWAYS one of the workspace's own", () => {
  assert.equal(clampCategory("supplies", CATEGORIES), "supplies");
  // A label is accepted because that is what a model reads off a list, but it
  // still has to land on a real key.
  assert.equal(clampCategory("Rent", CATEGORIES), "rent");
  assert.equal(clampCategory("  tools  ", CATEGORIES), "tools");
  // Invented categories are refused outright.
  assert.equal(clampCategory("Office Supplies", CATEGORIES), undefined);
  assert.equal(clampCategory("Meals & Entertainment", CATEGORIES), undefined);
  // Archived is refused.
  assert.equal(clampCategory("old", CATEGORIES), undefined);
  assert.equal(clampCategory("supplies", []), undefined);
});

test("liveCategories drops archived and malformed entries", () => {
  const list = liveCategories([
    ...CATEGORIES,
    { key: "", label: "Nameless" },
    null as unknown as CategoryOption,
  ]);
  assert.deepEqual(list.map(c => c.key), ["supplies", "rent", "tools"]);
});

/* ---------------- The whole validation ---------------- */

test("a clean answer comes through intact", () => {
  const out = validateReceiptParse({
    date: "2026-10-02", total: 84.21, currency: "CAD", payee: "Cable Depot",
    tax: 9.73, category: "supplies", text: "CABLE DEPOT",
  }, CATEGORIES);
  assert.deepEqual(out, {
    date: "2026-10-02", total: 84.21, currency: "CAD", payee: "Cable Depot",
    tax: 9.73, category: "supplies", text: "CABLE DEPOT",
  });
});

test("EVERY unreadable field is dropped, not defaulted", () => {
  const out = validateReceiptParse({
    date: "sometime in October", total: "unclear", currency: "dollars",
    payee: "   ", tax: "n/a", category: "Office Supplies", text: "",
  }, CATEGORIES);
  // An entirely unreadable photo yields {} — and that is the honest answer.
  assert.deepEqual(out, {});
  assert.equal(parseIsEmpty(out), true);
});

test("a missing object, null or a string is handled without throwing", () => {
  for (const raw of [undefined, null, "nope", 42, []]) {
    assert.deepEqual(validateReceiptParse(raw, CATEGORIES), {});
  }
});

test("tax larger than the total is DROPPED as a misread", () => {
  // Keeping it would put a wrong figure in front of somebody as though it had
  // been read off the paper.
  const out = validateReceiptParse({ total: 10, tax: 95 }, CATEGORIES);
  assert.equal(out.total, 10);
  assert.equal(out.tax, undefined);
  // Equal is fine (a fully-taxed line), and so is tax with no total.
  assert.equal(validateReceiptParse({ total: 10, tax: 10 }, CATEGORIES).tax, 10);
  assert.equal(validateReceiptParse({ tax: 9.73 }, CATEGORIES).tax, 9.73);
});

test("a model that ignores the enum still cannot smuggle a category through", () => {
  const out = validateReceiptParse({ category: "Shop Supplies & Misc" }, CATEGORIES);
  assert.equal(out.category, undefined);
});

test("long text is capped, and the payee is bounded", () => {
  const out = validateReceiptParse({
    text: "x".repeat(MAX_RECEIPT_TEXT_CHARS + 500),
    payee: "y".repeat(400),
  }, CATEGORIES);
  assert.equal(out.text!.length, MAX_RECEIPT_TEXT_CHARS);
  assert.equal(out.payee!.length, 120);
});

test("parseIsEmpty is false as soon as anything was actually read", () => {
  assert.equal(parseIsEmpty({}), true);
  assert.equal(parseIsEmpty({ currency: "CAD" }), true);   // a currency alone tells you nothing
  assert.equal(parseIsEmpty({ total: 10 }), false);
  assert.equal(parseIsEmpty({ payee: "Cable Depot" }), false);
  assert.equal(parseIsEmpty({ text: "CABLE DEPOT" }), false);
});

test("nothing in this module can write an expense — it is pure", () => {
  // Asserted here as well as in domain/receipt.test.ts because this is the
  // half that runs on the server with Admin credentials. There is no Firestore
  // handle in it to write one with.
  const mod = { clampCategory, money, isoDate, validateReceiptParse, receiptPrompt, receiptSchema };
  for (const fn of Object.values(mod)) assert.equal(typeof fn, "function");
  const out = validateReceiptParse({ date: "2026-10-02", total: 84.21, category: "supplies" }, CATEGORIES);
  // The result is suggestions and carries nothing expense-shaped.
  assert.equal("enteredBy" in out, false);
  assert.equal("amount" in out, false);
  assert.equal("id" in out, false);
});
