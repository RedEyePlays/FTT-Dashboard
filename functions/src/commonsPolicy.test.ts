import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Candidate, MIN_MATCH_CONFIDENCE, canSearch, creditLine, licenceAllowsCommercialUse,
  matchConfidence, modelCacheKey, pickBest, plainArtist, searchPhrase,
} from "./commonsPolicy";

// Two decisions, both of which must fail CLOSED: may we use this file, and is
// it actually a picture of the thing we asked about.

const lic = (shortName: string, extra: Record<string, string> = {}) =>
  ({ shortName, ...extra });

// --- Licence -----------------------------------------------------------------

test("accepts the licences a shop may actually use", () => {
  for (const name of ["CC0", "Public domain", "CC BY 4.0", "CC BY-SA 4.0", "CC-BY-SA-3.0", "cc by 2.0"]) {
    assert.equal(licenceAllowsCommercialUse(lic(name)), true, name);
  }
});

test("REFUSES non-commercial — a shop is commercial", () => {
  for (const name of ["CC BY-NC 4.0", "CC BY-NC-SA 3.0", "Non-commercial use only"]) {
    assert.equal(licenceAllowsCommercialUse(lic(name)), false, name);
  }
});

test("REFUSES no-derivatives — resizing is a derivative", () => {
  for (const name of ["CC BY-ND 4.0", "CC BY-NC-ND 4.0", "No derivatives"]) {
    assert.equal(licenceAllowsCommercialUse(lic(name)), false, name);
  }
});

test("REFUSES fair use, non-free, and anything it does not recognise", () => {
  for (const name of ["Fair use", "Non-free logo", "All rights reserved", "Some new tag", ""]) {
    assert.equal(licenceAllowsCommercialUse(lic(name)), false, name);
  }
});

test("a refusal beats an acceptance — CC BY-NC starts like CC BY", () => {
  // The exact trap: a prefix match on "cc-by" would wave this through.
  assert.equal(licenceAllowsCommercialUse(lic("CC BY-NC 4.0")), false);
  assert.equal(licenceAllowsCommercialUse(lic("CC BY 4.0", { usageTerms: "Non-commercial" })), false);
});

test("a missing licence is refused, not assumed", () => {
  assert.equal(licenceAllowsCommercialUse({}), false);
});

// --- Credit ------------------------------------------------------------------

test("the credit names the author and the licence, as CC-BY requires", () => {
  const credit = creditLine(
    lic("CC BY-SA 4.0", { artist: '<a href="/wiki/User:Someone">Someone</a>' }),
    "File:IPhone 13 Pro.jpg",
  );
  assert.equal(credit, "Someone / Wikimedia Commons / CC BY-SA 4.0");
});

test("a file with no author still gets a line", () => {
  const credit = creditLine(lic("CC0"), "File:IPhone 13 Pro.jpg");
  assert.equal(credit, "IPhone 13 Pro / Wikimedia Commons / CC0");
});

test("the artist field is HTML and is flattened to text", () => {
  assert.equal(plainArtist('<span class="x">Jane &amp; Co</span>'), "Jane & Co");
  assert.equal(plainArtist(undefined), "");
});

// --- Match -------------------------------------------------------------------

test("an exact model match scores full marks", () => {
  assert.equal(matchConfidence("iPhone 13 Pro", "File:IPhone 13 Pro.jpg"), 1);
});

test('"iPhone 13" MUST NOT match a file about the iPhone 13 Pro, or the reverse', () => {
  // The distinguishing word in a phone model is usually the last one, which is
  // exactly the one a loose matcher drops.
  assert.equal(matchConfidence("iPhone 13 Pro", "File:IPhone 13.jpg"), 0);
  assert.ok(matchConfidence("iPhone 13", "File:IPhone 13 Pro.jpg") < 1);
});

test("a wholly different model scores zero", () => {
  assert.equal(matchConfidence("iPhone 13 Pro", "File:Samsung Galaxy S21.jpg"), 0);
  assert.equal(matchConfidence("Galaxy S21", "File:IPhone 13 Pro.jpg"), 0);
});

test("filename noise does not penalise a good match", () => {
  const score = matchConfidence("iPhone 13 Pro", "File:IPhone 13 Pro white background photo.jpg");
  assert.ok(score >= MIN_MATCH_CONFIDENCE, `scored ${score}`);
});

test("a title stuffed with OTHER models is rejected", () => {
  // "Comparison of iPhone 13 Pro, 14 Pro, 15 Pro and 16 Pro" contains every
  // token we asked for and is still the wrong picture.
  const score = matchConfidence(
    "iPhone 13 Pro",
    "File:Comparison of IPhone 13 Pro 14 Pro 15 Pro 16 Pro and Samsung Galaxy S22 Ultra.jpg",
  );
  assert.ok(score < MIN_MATCH_CONFIDENCE, `scored ${score}`);
});

// --- Picking -----------------------------------------------------------------

const candidate = (over: Partial<Candidate> = {}): Candidate => ({
  title: "File:IPhone 13 Pro.jpg",
  licence: lic("CC BY-SA 4.0"),
  width: 2000,
  ...over,
});

test("picks a well-licensed, well-matched, big-enough file", () => {
  assert.equal(pickBest("iPhone 13 Pro", [candidate()])?.title, "File:IPhone 13 Pro.jpg");
});

test("STORES NOTHING on a weak match — a wrong photo is worse than none", () => {
  assert.equal(pickBest("iPhone 13 Pro", [candidate({ title: "File:IPhone 14.jpg" })]), null);
});

test("skips a file it may not use, however well it matches", () => {
  assert.equal(pickBest("iPhone 13 Pro", [candidate({ licence: lic("CC BY-NC 4.0") })]), null);
});

test("skips an icon — there is nothing to resize down from", () => {
  assert.equal(pickBest("iPhone 13 Pro", [candidate({ width: 64 })]), null);
  assert.equal(pickBest("iPhone 13 Pro", [candidate({ width: undefined })]), null);
});

test("prefers the tighter title when several qualify", () => {
  const best = pickBest("iPhone 13 Pro", [
    candidate({ title: "File:IPhone 13 Pro on a desk next to a laptop and a cup.jpg" }),
    candidate({ title: "File:IPhone 13 Pro.jpg" }),
  ]);
  assert.equal(best?.title, "File:IPhone 13 Pro.jpg");
});

test("no candidates at all is a normal, quiet answer", () => {
  assert.equal(pickBest("iPhone 13 Pro", []), null);
});

// --- Search phrase and caching ----------------------------------------------

test("searches on brand AND model, without repeating the brand", () => {
  assert.equal(searchPhrase("Apple", "iPhone 13 Pro"), "Apple iPhone 13 Pro");
  // The model already names the brand — "Apple Apple iPhone" finds nothing.
  assert.equal(searchPhrase("Apple", "Apple iPhone 13 Pro"), "Apple iPhone 13 Pro");
  assert.equal(searchPhrase("", "iPhone 13 Pro"), "iPhone 13 Pro");
});

test("refuses to search on too little — one word finds everything", () => {
  assert.equal(canSearch("Apple", "iPhone 13 Pro"), true);
  assert.equal(canSearch("", "iPhone"), false);
  assert.equal(canSearch("", ""), false);
});

test("THE CACHE IS KEYED ON THE MODEL, so two identical phones cost one fetch", () => {
  const a = modelCacheKey("Apple", "iPhone 13 Pro");
  const b = modelCacheKey("apple", "iphone   13  pro");
  assert.equal(a, b);
  assert.equal(a, "apple-iphone-13-pro");
  // A different model is a different entry.
  assert.notEqual(a, modelCacheKey("Apple", "iPhone 13"));
});
