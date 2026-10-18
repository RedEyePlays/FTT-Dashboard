import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  COUNT_PREAMBLE, CountResult, SEED_MODEL_ALIASES, SOLD_DATE_FLOOR, cleanAliases,
  countFilters, countKindFor, expandAliases, looksLikeClockTime, renderCounts,
  renderWithheld, wantsCount, withheldFor,
} from "./countPolicy";
import { modelKeyOf, normalizeModelName, withModelKey } from "./modelKey";
import {
  MAX_RECORDS_PER_KIND, matchesModelQuery, matchesWords, planQuestion,
  selectDevices,
} from "./retrievalPolicy";

/**
 * "HOW MANY 15PM IN STOCK" — the question that produced a shrug.
 *
 * It failed twice over: "15pm" is in none of the data, and even with the right
 * words the retrieval path reads the newest 40 rows and keeps 12, so with 162
 * devices in stock it can list examples and never say how many.
 *
 * The caps are not the bug — they are why per-message cost stopped scaling
 * with the shop — so counting happens by aggregation instead, and the parser
 * learns the owner's words first.
 */

const TODAY = "2026-10-20";
const ALIASES = [
  { alias: "15pm", model: "iPhone 15 Pro Max" },
  { alias: "s24u", model: "Galaxy S24 Ultra" },
];

/* ---------------- The model key ---------------- */

test("folds every way the same model is actually typed into one key", () => {
  const key = normalizeModelName("iPhone 15 Pro Max");
  for (const written of [
    "iPhone 15 Pro Max", "iphone 15 pro max", "iPhone-15-Pro-Max",
    "iphone15 promax", "  IPHONE 15 PRO MAX  ",
  ]) {
    assert.equal(normalizeModelName(written), key, written);
  }
});

test("storage, colour and condition are NOT part of the model", () => {
  // "how many 15 Pro Max" means all of them, and capacity and colour are
  // already their own searchable fields.
  const base = modelKeyOf({ model: "iPhone 15 Pro Max" });
  for (const model of [
    "iPhone 15 Pro Max 256GB", "iPhone 15 Pro Max Blue Titanium",
    "iPhone 15 Pro Max 512GB Black unlocked", "iPhone 15 Pro Max — Good",
  ]) {
    assert.equal(modelKeyOf({ model }), base, model);
  }
});

test("keys from `item` when there is no model field, brand stripped", () => {
  // The one code path that CONSTRUCTS item writes "[brand] [model]", which is
  // exactly why a prefix range over item was rejected.
  assert.equal(
    modelKeyOf({ item: "Apple iPhone 15 Pro Max", brand: "Apple" }),
    modelKeyOf({ model: "iPhone 15 Pro Max" }),
  );
  // And still keys something sane with no brand recorded.
  assert.equal(
    modelKeyOf({ item: "iPhone 15 Pro Max 256GB Blue" }),
    modelKeyOf({ model: "iPhone 15 Pro Max" }),
  );
});

test("an accessory and an empty row are unkeyable, and say so by omission", () => {
  assert.equal(modelKeyOf({ kind: "accessory", item: "USB-C cable" }), "");
  assert.equal(modelKeyOf({ item: "", model: "" }), "");
  // withModelKey omits the field rather than storing '' — the server counts
  // keyed rows with `modelKey >= ""`, and an empty string would make an
  // unkeyable row look keyed.
  assert.equal("modelKey" in withModelKey({ kind: "accessory", item: "cable" }), false);
  assert.equal(withModelKey({ model: "iPhone 15 Pro Max" }).modelKey, normalizeModelName("iphone15promax"));
});

/* ---------------- Shop shorthand ---------------- */

test("'15pm' and 'iPhone 15 Pro Max' name the SAME model", () => {
  const viaAlias = expandAliases("how many 15pm in stock", ALIASES);
  assert.deepEqual(viaAlias, ["iPhone 15 Pro Max"]);
  // Which is the same key the plain question would count on.
  assert.equal(normalizeModelName(viaAlias[0]), normalizeModelName("iPhone 15 Pro Max"));
});

test("matches whole tokens only, so one alias cannot fire inside another", () => {
  // "s24" must not fire on "s24u", which is a different handset.
  const aliases = [{ alias: "s24", model: "Galaxy S24" }, { alias: "s24u", model: "Galaxy S24 Ultra" }];
  assert.deepEqual(expandAliases("how many s24u left", aliases), ["Galaxy S24 Ultra"]);
  assert.deepEqual(expandAliases("how many s24 left", aliases), ["Galaxy S24"]);
});

test("AN UNKNOWN ALIAS IS NOT AN ERROR — it degrades to the word search", () => {
  const plan = planQuestion("how many pixel 9 pro in stock", TODAY, ALIASES);
  assert.deepEqual(plan.modelQueries, []);
  // The words survive untouched, so the existing path runs exactly as before.
  assert.ok(plan.words.includes("pixel"));
  assert.equal(plan.broad, false);
});

test("AN ALIAS NEVER CORRUPTS AN UNRELATED QUESTION", () => {
  // The guard that matters. An owner may well add "5pm" for some handset, and
  // "we closed at 5pm" must stay a question about a time.
  const timeAliases = [{ alias: "5pm", model: "Some Phone 5 Pro Max" }];
  assert.deepEqual(expandAliases("what did we take after 5pm", timeAliases), []);
  assert.deepEqual(expandAliases("sales until 5pm yesterday", timeAliases), []);
  assert.equal(looksLikeClockTime("5pm", "we closed at 5pm"), true);

  // Spoken as a model rather than a time, it still expands.
  assert.deepEqual(expandAliases("how many 5pm in stock", timeAliases), ["Some Phone 5 Pro Max"]);

  // And "15pm" is never a clock reading, so it is never vetoed.
  assert.equal(looksLikeClockTime("15pm", "at 15pm"), false);
  assert.deepEqual(expandAliases("stock at 15pm", ALIASES), ["iPhone 15 Pro Max"]);
});

test("THE EXPANSION IS ADDITIVE: words are left exactly as they were", () => {
  // This is what makes it impossible for an alias to break a question that
  // already worked — nothing is rewritten, only widened.
  const withAliases = planQuestion("how many 15pm in stock", TODAY, ALIASES);
  const without = planQuestion("how many 15pm in stock", TODAY, []);
  assert.deepEqual(withAliases.words, without.words);
  assert.deepEqual(withAliases.identifiers, without.identifiers);
  assert.deepEqual(without.modelQueries, []);
  assert.deepEqual(withAliases.modelQueries, ["iPhone 15 Pro Max"]);
});

test("a question carrying only shorthand is not treated as 'broad'", () => {
  // "how many 15pm" is words-empty after stop-word filtering. Answering it
  // from the summary alone is the original uselessness.
  const plan = planQuestion("how many 15pm", TODAY, ALIASES);
  assert.equal(plan.broad, false);
  assert.equal(plan.asksCount, true);
});

test("the alias list tolerates whatever is stored", () => {
  assert.deepEqual(cleanAliases(undefined), []);
  assert.deepEqual(cleanAliases("nope"), []);
  // Case-insensitive duplicates collapse, and the first one wins.
  const dupes = cleanAliases([{ alias: "XR", model: "Thing" }, { alias: "xr", model: "Other" }]);
  assert.equal(dupes.length, 1);
  assert.deepEqual(dupes[0], { alias: "xr", model: "Thing" });
  // A one-character alias would match half the shop; an alias with no model
  // means nothing.
  assert.deepEqual(cleanAliases([{ alias: "a", model: "Thing" }]), []);
  assert.deepEqual(cleanAliases([{ alias: "15pm", model: "  " }]), []);
  assert.ok(cleanAliases(SEED_MODEL_ALIASES).length >= 8);
});

/* ---------------- Counting questions ---------------- */

test("recognises a question that wants a NUMBER, not a list", () => {
  for (const q of [
    "how many 15pm in stock", "how many did we sell", "count of iphones",
    "number of 15 pro max", "do we have any s24u", "any left?",
  ]) assert.equal(wantsCount(q), true, q);

  // Deliberately narrow: merely mentioning stock is answered as before.
  for (const q of [
    "what happened to PHN-000123", "show me the 15 pro max",
    "which iphones are in stock", "tell me about our stock",
  ]) assert.equal(wantsCount(q), false, q);
});

test("in stock vs sold is read off the question", () => {
  assert.equal(countKindFor("how many 15pm in stock", false), "inStock");
  assert.equal(countKindFor("how many 15pm do we have", false), "inStock");
  assert.equal(countKindFor("how many 15pm did we sell", false), "sold");
  assert.equal(countKindFor("how many 15pm sold", false), "sold");
  // A date range can only be about what has already happened.
  assert.equal(countKindFor("how many 15pm in march", true), "sold");
});

test("a date range comes from parseDateRange, not a second parser", () => {
  // Asserted through planQuestion, which is the only thing that builds a
  // range — countPolicy has no date parsing of its own.
  const plan = planQuestion("how many 15pm did we sell last month", TODAY, ALIASES);
  assert.deepEqual(plan.range, { from: "2026-09-01", to: "2026-09-30" });
  assert.equal(countKindFor("how many 15pm did we sell last month", !!plan.range), "sold");
});

/* ---------------- The answer lines ---------------- */

const result = (over: Partial<CountResult> = {}): CountResult => ({
  model: "iPhone 15 Pro Max", key: "iphone15promax", kind: "inStock", count: 7, ...over,
});

test("a count reads as a plain number", () => {
  const text = renderCounts([result()], { total: 162, unkeyed: 0 });
  assert.match(text, /iPhone 15 Pro Max: 7 devices in stock now/);
  assert.equal(/NOTE:/.test(text), false);
});

test("ZERO IS AN ANSWER, and is named as a counted zero", () => {
  // "No 15 Pro Max in stock" is a fact the owner can act on. "I don't have
  // records" was the original complaint.
  const text = renderCounts([result({ count: 0 })], { total: 162, unkeyed: 0 });
  assert.match(text, /NONE in stock now/);
  assert.match(text, /definite zero, counted — not a gap in the records/);
});

test("a sold count names its range", () => {
  const text = renderCounts(
    [result({ kind: "sold", count: 3, range: { from: "2026-09-01", to: "2026-09-30" } })],
    { total: 162, unkeyed: 0 },
  );
  assert.match(text, /sold between 2026-09-01 and 2026-09-30/);
  assert.match(text, /3 devices/);
  // All-time sold says so rather than inventing a range.
  assert.match(renderCounts([result({ kind: "sold" })], { total: 1, unkeyed: 0 }), /sold, all time/);
});

test("UNKEYED ROWS ARE REPORTED, so an undercount is never passed off as a total", () => {
  const text = renderCounts([result()], { total: 162, unkeyed: 40 });
  assert.match(text, /40 of 162 devices have not been indexed for counting yet/);
  assert.match(text, /may be short/);
  // And it names the fix, so the note is actionable rather than a disclaimer.
  assert.match(text, /Re-index stock for counting/);
});

test("the model is told the counts are exact, because it hedges numbers otherwise", () => {
  assert.match(COUNT_PREAMBLE, /EXACT COUNTS/);
  assert.match(COUNT_PREAMBLE, /NOT a sample/);
  assert.match(COUNT_PREAMBLE, /do not hedge/i);
});

/* ---------------- Partial answers ---------------- */

test("A GATED FIGURE NO LONGER KILLS THE WHOLE QUESTION", () => {
  // "how many 15 Pro Max did we sell last month and what's the margin", from
  // somebody without Financials. The count was always answerable.
  const plan = planQuestion(
    "how many 15pm did we sell last month and what's the margin", TODAY, ALIASES,
  );
  assert.equal(plan.asksMoney, true);
  assert.equal(plan.asksCount, true);

  const parts = withheldFor(plan, { canSeeMoney: false, canSeePayroll: true });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].asked, "money");

  const text = renderWithheld(parts);
  assert.match(text, /cost, margin and profit figures are not visible/);
  assert.match(text, /ANSWER EVERY OTHER PART OF THE QUESTION NORMALLY/);
  assert.match(text, /Do not refuse the whole question/);
  // And it must not be reconstructed from whatever else was supplied.
  assert.match(text, /do not estimate,\n  derive or imply the withheld figure/);
});

test("nothing is withheld from somebody who may see it", () => {
  const plan = planQuestion("what's the margin on 15pm", TODAY, ALIASES);
  assert.deepEqual(withheldFor(plan, { canSeeMoney: true, canSeePayroll: true }), []);
  assert.equal(renderWithheld([]), "");
});

test("payroll is reported separately from money", () => {
  const plan = planQuestion("how many hours did we pay last week", TODAY, []);
  const parts = withheldFor(plan, { canSeeMoney: false, canSeePayroll: false });
  assert.deepEqual(parts.map(p => p.asked), ["money", "payroll"]);
});

/* ---------------- The caps are untouched ---------------- */

test("THE COUNT IS NOT A CAPPED SAMPLE — the record limits are unchanged", () => {
  // The fixture is deliberately bigger than MAX_RECORDS_PER_KIND, and bigger
  // than LOOKUP_LIMIT (40), which is the whole point: a word search over this
  // can only ever return a slice, so a test on a small fixture would prove
  // nothing about counting.
  const devices = Array.from({ length: 162 }, (_, i) => ({
    id: `d${i}`, item: "Apple iPhone 15 Pro Max", brand: "Apple",
    model: "iPhone 15 Pro Max", deviceStatus: "ready",
  }));
  assert.ok(devices.length > MAX_RECORDS_PER_KIND);
  assert.ok(devices.length > 40);

  const plan = planQuestion("how many 15pm in stock", TODAY, ALIASES);
  // The RETRIEVAL path still returns at most the cap — unchanged, on purpose.
  assert.equal(selectDevices(devices, plan).length, MAX_RECORDS_PER_KIND);

  // Which is exactly why the count cannot come from here. Every row shares one
  // key, so the aggregation the server runs counts all 162.
  const keys = new Set(devices.map(d => modelKeyOf(d)));
  assert.equal(keys.size, 1);
  assert.equal([...keys][0], normalizeModelName(plan.modelQueries[0]));
});

test("the alias gives the retrieval path a SECOND way to match, not a different one", () => {
  const row = { id: "d1", item: "Apple iPhone 15 Pro Max 256GB", brand: "Apple", model: "iPhone 15 Pro Max" };
  // The words of the shorthand question match nothing in the row — this is
  // failure #1 from the report, reproduced.
  assert.equal(matchesWords(row, ["15pm"]), false);
  // The expanded model does match.
  assert.equal(matchesModelQuery(row, ["iPhone 15 Pro Max"]), true);
  // And together they select it, without the all-words rule having changed.
  const plan = planQuestion("how many 15pm in stock", TODAY, ALIASES);
  assert.deepEqual(selectDevices([row], plan).map(r => r.id), ["d1"]);
});

test("a model query does not match an unrelated device", () => {
  const other = { id: "d2", item: "Samsung Galaxy S24 Ultra", brand: "Samsung", model: "Galaxy S24 Ultra" };
  assert.equal(matchesModelQuery(other, ["iPhone 15 Pro Max"]), false);
  // An unkeyable row never matches, rather than matching everything.
  assert.equal(matchesModelQuery({ kind: "accessory", item: "cable" }, ["iPhone 15 Pro Max"]), false);
  assert.equal(matchesModelQuery(other, []), false);
});

/* ---------------- Which filters a count actually applies ---------------- */

test("IN STOCK AND SOLD ARE DIFFERENT COUNTS of the same model", () => {
  const key = normalizeModelName("iPhone 15 Pro Max");
  const inStock = countFilters({ model: "iPhone 15 Pro Max", key, kind: "inStock" });
  const sold = countFilters({ model: "iPhone 15 Pro Max", key, kind: "sold" });

  // Both pin the same model...
  for (const f of [inStock, sold]) {
    assert.deepEqual(f[0], { field: "modelKey", op: "==", value: key });
  }
  // ...and then ask opposite questions of it.
  assert.deepEqual(inStock[1], { field: "deviceStatus", op: "==", value: "ready" });
  assert.equal(sold[1].field, "soldDate");
  assert.notDeepEqual(inStock, sold);

  // The in-stock predicate is the SAME one businessSummary uses for the
  // headline figure, so the two can never disagree about "in stock".
  assert.equal(inStock.length, 2);
});

test("a sold count over a range uses the range from parseDateRange", () => {
  const plan = planQuestion("how many 15pm did we sell last month", TODAY, ALIASES);
  const filters = countFilters({
    model: "iPhone 15 Pro Max", key: "iphone15promax", kind: "sold", range: plan.range,
  });
  assert.deepEqual(filters.slice(1), [
    { field: "soldDate", op: ">=", value: "2026-09-01" },
    { field: "soldDate", op: "<=", value: "2026-09-30" },
  ]);
});

test("sold-all-time is a presence test expressed as an indexable range", () => {
  const filters = countFilters({ model: "m", key: "k", kind: "sold" });
  // `soldDate` is '' on an unsold row, so a floor below any real date is what
  // separates sold from unsold. Firestore cannot index "field is non-empty".
  assert.deepEqual(filters[1], { field: "soldDate", op: ">=", value: SOLD_DATE_FLOOR });
  assert.ok(SOLD_DATE_FLOOR < "2000-01-01");
});

test("every filter a count uses is covered by a declared composite index", () => {
  // The queries are aggregations and read no documents, but they still need an
  // index to run at all — without one the question fails rather than answering.
  const spec = JSON.parse(
    readFileSync(join(__dirname, "..", "..", "..", "firestore.indexes.json"), "utf8"),
  ) as { indexes: { collectionGroup: string; fields: { fieldPath: string }[] }[] };

  const declared = spec.indexes
    .filter(i => i.collectionGroup === "inventory")
    .map(i => i.fields.map(f => f.fieldPath).join("+"));

  for (const req of [
    { model: "m", key: "k", kind: "inStock" as const },
    { model: "m", key: "k", kind: "sold" as const },
    { model: "m", key: "k", kind: "sold" as const, range: { from: "2026-09-01", to: "2026-09-30" } },
  ]) {
    // The fields a query filters on, de-duplicated in order.
    const fields = [...new Set(countFilters(req).map(f => f.field))].join("+");
    assert.ok(declared.includes(fields), `no index declared for ${fields}`);
  }
});
