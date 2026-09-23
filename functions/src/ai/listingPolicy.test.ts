import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LISTING_SCHEMA, NEW_CLAIM_WORDS, SPEC_ORDER,
  checkOutput, listingSystemPrompt, listingUserPrompt, numbersIn, parseListing,
} from "./listingPolicy";
import { ValidationError } from "./types";

/**
 * The listing op's two jobs: ask for the right thing, and refuse the wrong
 * answer. Both are pure, so both are testable without a key or a network.
 */

const buildFacts = (over: Record<string, unknown> = {}) => ({
  kind: "build",
  name: "REAPER Gaming PC",
  specs: "Ryzen 9 5900X / RTX 5060 Ti / 32GB / 1TB",
  parts: [
    { category: "GPU", name: "RTX 5060 Ti" },
    { category: "CPU", name: "Ryzen 9 5900X" },
  ],
  warrantyDays: 90,
  performance: [],
  allPartsNew: false,
  shareLine: "Full specs and photos: flipthat.tech/b/kadamuze",
  ...over,
});

/* ---------------- The prompt ---------------- */

test("the prompt forbids inventing, upgrading or inferring anything", () => {
  const p = listingSystemPrompt({ facts: buildFacts() });
  assert.match(p, /Use ONLY the facts given/);
  assert.match(p, /Do not add, upgrade, infer or estimate/);
  assert.match(p, /no battery percentage/i);
});

test("the prompt forbids condition words that were not given", () => {
  const p = listingSystemPrompt({ facts: buildFacts() });
  assert.match(p, /do not write 'mint', 'flawless', 'immaculate' or 'like new'/i);
});

test("the prompt forbids cost, seller, customer, IMEI and serial by name", () => {
  const p = listingSystemPrompt({ facts: buildFacts() });
  for (const word of ["what the shop paid", "margin", "customer", "IMEI", "serial number"]) {
    assert.ok(p.toLowerCase().includes(word.toLowerCase()), `prompt should mention ${word}`);
  }
});

test("a machine with a used part is told the new-words are FORBIDDEN", () => {
  const p = listingSystemPrompt({ facts: buildFacts() });
  assert.match(p, /'brand new', 'sealed', 'unopened' and 'new in box' are\s+FORBIDDEN/);
  assert.match(p, /Custom built and tested in-shop/);
});

test("a machine where every part is new is allowed to say so", () => {
  const p = listingSystemPrompt({ facts: buildFacts({ allPartsNew: true }) });
  assert.match(p, /you may say so/);
  assert.ok(!/FORBIDDEN/.test(p));
});

test("with used-part marking OFF the model is told not to add markers OR call them new", () => {
  const p = listingSystemPrompt({ facts: buildFacts(), markUsedParts: false });
  assert.match(p, /Do NOT add any/);
  assert.match(p, /do NOT describe\s+the parts as new/);
});

test("with used-part marking ON the model is told to include the condition", () => {
  const p = listingSystemPrompt({ facts: buildFacts(), markUsedParts: true });
  assert.match(p, /put it after the model name in brackets/);
});

test("the spec list order is CPU-first and names every component slot", () => {
  const p = listingSystemPrompt({ facts: buildFacts() });
  for (const cat of SPEC_ORDER) assert.ok(p.includes(cat), `prompt should list ${cat}`);
});

test("platform changes the tone, never the facts", () => {
  const fb = listingSystemPrompt({ facts: buildFacts(), platform: "facebook" });
  const eb = listingSystemPrompt({ facts: buildFacts(), platform: "ebay" });
  assert.match(fb, /NOT clickable/i);
  assert.match(eb, /No local-pickup assumptions/);
  // The absolute rules are identical in both.
  for (const p of [fb, eb]) assert.match(p, /Use ONLY the facts given/);
});

test("length changes only the word count", () => {
  assert.match(listingSystemPrompt({ facts: buildFacts(), length: "short" }), /40-70 words/);
  assert.match(listingSystemPrompt({ facts: buildFacts(), length: "standard" }), /90-150 words/);
  // An unknown length falls back to standard rather than sending nothing.
  assert.match(listingSystemPrompt({ facts: buildFacts(), length: "epic" }), /90-150 words/);
});

test("the user prompt carries the facts and nothing else", () => {
  const facts = buildFacts();
  const p = listingUserPrompt({ facts });
  assert.ok(p.includes(JSON.stringify(facts)));
});

test("the schema asks for exactly a title and a description", () => {
  assert.deepEqual(Object.keys(LISTING_SCHEMA.properties!), ["title", "description"]);
  assert.deepEqual(LISTING_SCHEMA.required, ["title", "description"]);
  assert.equal(LISTING_SCHEMA.additionalProperties, false);
});

/* ---------------- The check on the answer ---------------- */

test("numbersIn ignores thousands separators", () => {
  assert.deepEqual(numbersIn("$1,800 and 32GB"), ["1800", "32"]);
});

test("a listing built only from the facts passes", () => {
  const r = checkOutput(buildFacts(), {
    title: "REAPER Gaming PC — RTX 5060 Ti / Ryzen 9 5900X",
    description: "Custom built and tested in-shop. 90-day warranty.",
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.invented, []);
});

test("an invented figure is REJECTED, and the reason names it", () => {
  const r = checkOutput(buildFacts(), {
    title: "REAPER Gaming PC",
    description: "Runs at 240 fps in every game.",
  });
  assert.equal(r.ok, false);
  assert.ok(r.invented.includes("240"));
  assert.match(r.reason!, /240/);
  assert.match(r.reason!, /not in the facts/);
});

test("an fps figure that WAS given passes — which is how the performance block works", () => {
  const facts = buildFacts({
    performance: [{ game: "Fortnite", resolution: "1080p", preset: "High", fpsLow: 120, fpsHigh: 160, measured: false }],
  });
  const r = checkOutput(facts, {
    title: "REAPER Gaming PC",
    description: "Fortnite at 1080p High: 120-160 fps.",
  });
  assert.equal(r.ok, true);
});

test("list numbering and a year are not treated as claims", () => {
  const r = checkOutput(buildFacts(), {
    title: "REAPER Gaming PC",
    description: "1. RTX 5060 Ti\n2. Ryzen 9 5900X\nBuilt in 2026.",
  });
  assert.equal(r.ok, true);
});

test("'brand new' on a machine with a used part is REJECTED", () => {
  const r = checkOutput(buildFacts(), { title: "Brand new gaming PC", description: "Ready to go." });
  assert.equal(r.ok, false);
  assert.equal(r.impliedNew, "brand new");
  assert.match(r.reason!, /not new/);
});

test("every new-claim word is caught, in the title or the body", () => {
  for (const word of NEW_CLAIM_WORDS) {
    const inBody = checkOutput(buildFacts(), { title: "PC", description: `It is ${word}.` });
    assert.equal(inBody.ok, false, `${word} should be rejected in the body`);
    const inTitle = checkOutput(buildFacts(), { title: `${word} PC`, description: "Solid." });
    assert.equal(inTitle.ok, false, `${word} should be rejected in the title`);
  }
});

test("the same words are allowed when every part really is new", () => {
  const r = checkOutput(buildFacts({ allPartsNew: true }), {
    title: "REAPER Gaming PC",
    description: "Brand new, sealed parts throughout.",
  });
  assert.equal(r.ok, true);
});

test("a device recorded as brand new may say so", () => {
  const r = checkOutput(
    { kind: "device", model: "iPhone 15", condition: "Brand new, sealed", warrantyDays: 90 },
    { title: "iPhone 15", description: "Brand new, sealed." },
  );
  assert.equal(r.ok, true);
});

test("a model number in the TITLE must still come from the facts", () => {
  // "iPhone 15" on a facts object for an iPhone 13 is an invented number, and
  // it is exactly the kind of near-miss nobody proofreads.
  const r = checkOutput(
    { kind: "device", model: "iPhone 13", warrantyDays: 90 },
    { title: "iPhone 15", description: "Great phone." },
  );
  assert.equal(r.ok, false);
  assert.ok(r.invented.includes("15"));
});

test("a word that merely CONTAINS one does not fire", () => {
  // "Newegg" is a shop and "renewed" is about thermal paste.
  const r = checkOutput(buildFacts(), {
    title: "REAPER Gaming PC",
    description: "Priced against Newegg. Thermal paste renewed.",
  });
  assert.equal(r.ok, true);
});

/* ---------------- Parsing ---------------- */

test("parseListing rejects a non-object and an empty field", () => {
  assert.throws(() => parseListing("nope"), ValidationError);
  assert.throws(() => parseListing({ title: "x" }), ValidationError);
  assert.throws(() => parseListing({ title: "  ", description: "y" }), ValidationError);
});

test("parseListing trims what it accepts", () => {
  assert.deepEqual(parseListing({ title: "  A  ", description: " B " }), { title: "A", description: "B" });
});


test("a build with performance rows is told to word them, never to produce them", () => {
  const p = listingSystemPrompt({
    facts: buildFacts({
      performance: [
        { game: "Fortnite", resolution: "1080p", preset: "High", fpsLow: 120, fpsHigh: 160, measured: false },
      ],
    }),
  });
  assert.match(p, /Expected performance/);
  assert.match(p, /Use the exact fpsLow and fpsHigh given/);
  assert.match(p, /NEVER average them/);
  assert.match(p, /never add a game that is not in the facts/);
  assert.match(p, /Estimates based on published benchmarks/);
});

test("a build with NO performance rows is told nothing about performance at all", () => {
  // No block, no invitation to improvise one.
  const p = listingSystemPrompt({ facts: buildFacts() });
  assert.ok(!/Expected performance/.test(p));
});

test("only a MEASURED row may be called tested in-shop", () => {
  const p = listingSystemPrompt({
    facts: buildFacts({
      performance: [{ game: "CS2", resolution: "1080p", preset: "Competitive", fpsLow: 300, fpsHigh: 300, measured: true }],
    }),
  });
  assert.match(p, /Do not say it on any other/);
});
