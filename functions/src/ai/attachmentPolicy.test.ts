import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_BYTES, MAX_CSV_ROWS, MAX_PDF_PAGES, MAX_TEXT_CHARS,
  checkAttachment, kindOf, prepareAttachment, prepareCsv, preSendNotice, splitCsvLine,
} from "./attachmentPolicy";

const file = (over: Partial<Parameters<typeof checkAttachment>[0]> = {}) => ({
  name: "prices.csv",
  mimeType: "text/csv",
  sizeBytes: 1024,
  data: "Model,Cost\niPhone 13,540",
  ...over,
});

/* ---------------- What is allowed in ---------------- */

test("the four supported kinds are recognised by type", () => {
  assert.equal(kindOf("text/csv"), "csv");
  assert.equal(kindOf("application/pdf"), "pdf");
  assert.equal(kindOf("image/jpeg"), "image");
  assert.equal(kindOf("text/plain"), "text");
});

test("a CSV exported by a spreadsheet is recognised by EXTENSION when the type is junk", () => {
  // Excel and Numbers routinely send application/octet-stream or vnd.ms-excel.
  assert.equal(kindOf("application/octet-stream", "batch.csv"), "csv");
  assert.equal(kindOf("application/vnd.ms-excel", "batch.csv"), "csv");
  assert.equal(kindOf("", "invoice.pdf"), "pdf");
});

test("an unsupported type is REJECTED with something a person can act on", () => {
  const r = checkAttachment(file({ name: "clip.mp4", mimeType: "video/mp4" }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, "type");
  assert.match(r.message, /PDF, a CSV, a text file or an image/);
});

test("an over-size file is rejected, with the limit in the message", () => {
  const r = checkAttachment(file({ sizeBytes: MAX_ATTACHMENT_BYTES + 1 }));
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, "too-big");
  assert.match(r.message, /8 MB/);
});

test("an empty file is rejected rather than sent as nothing", () => {
  assert.equal(checkAttachment(file({ data: "" })).ok, false);
  assert.equal(checkAttachment(file({ sizeBytes: 0 })).ok, false);
});

test("more than the per-message limit is refused", () => {
  assert.equal(checkAttachment(file(), MAX_ATTACHMENTS_PER_MESSAGE - 1).ok, true);
  const r = checkAttachment(file(), MAX_ATTACHMENTS_PER_MESSAGE);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "too-many");
});

test("a good file passes and is told what it is", () => {
  const r = checkAttachment(file());
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.kind, "csv");
});

/* ---------------- Turning it into something worth sending ---------------- */

test("a CSV is parsed to TEXT, never sent as an image", () => {
  const prepared = prepareAttachment(file(), "csv");
  assert.equal(prepared.kind, "csv");
  assert.ok(prepared.text);
  assert.equal(prepared.base64, undefined);
  assert.match(prepared.text!, /Model \| Cost/);
  assert.match(prepared.text!, /iPhone 13 \| 540/);
});

test("quoted commas inside a field survive the parse", () => {
  assert.deepEqual(splitCsvLine('"Smith, Dana",540,"a ""nice"" one"'),
    ["Smith, Dana", "540", 'a "nice" one']);
});

test("a tab-separated file is split on tabs", () => {
  const prepared = prepareCsv("batch.tsv", "Model\tCost\niPhone\t540");
  assert.match(prepared.text!, /Model \| Cost/);
});

test("rows are CAPPED and the summary says how many were read", () => {
  const rows = ["Model,Cost", ...Array.from({ length: 500 }, (_, i) => `Phone ${i},${i}`)].join("\n");
  const prepared = prepareCsv("big.csv", rows);
  assert.equal(prepared.truncated, true);
  assert.equal(prepared.text!.split("\n").length, MAX_CSV_ROWS);
  assert.match(prepared.summary, /of 500/);
});

test("blank lines are dropped — they are pure cost", () => {
  const prepared = prepareCsv("gappy.csv", "A,B\n\n\n1,2\n\n");
  assert.equal(prepared.text!.split("\n").length, 2);
});

test("a text file is truncated at the character cap", () => {
  const prepared = prepareAttachment(
    file({ name: "notes.txt", mimeType: "text/plain", data: "z".repeat(MAX_TEXT_CHARS * 2) }),
    "text",
  );
  assert.equal(prepared.text!.length, MAX_TEXT_CHARS);
  assert.equal(prepared.truncated, true);
});

test("a PDF and an image are carried as base64 with their media type", () => {
  const pdf = prepareAttachment(
    file({ name: "invoice.pdf", mimeType: "application/pdf", data: "JVBERi0=" }), "pdf");
  assert.equal(pdf.base64, "JVBERi0=");
  assert.equal(pdf.mediaType, "application/pdf");
  assert.equal(pdf.text, undefined);

  const img = prepareAttachment(
    file({ name: "label.jpg", mimeType: "image/jpeg", data: "AAAA" }), "image");
  assert.equal(img.mediaType, "image/jpeg");
});

test("every prepared file carries a one-line summary, which is what later turns reuse", () => {
  // Resending a 40-page PDF on every message is the inventory bug with a
  // different payload.
  for (const [f, kind] of [
    [file(), "csv"],
    [file({ name: "notes.txt", mimeType: "text/plain", data: "hello" }), "text"],
    [file({ name: "invoice.pdf", mimeType: "application/pdf", data: "JVBERi0=" }), "pdf"],
    [file({ name: "label.jpg", mimeType: "image/jpeg", data: "AAAA" }), "image"],
  ] as const) {
    const prepared = prepareAttachment(f, kind);
    assert.ok(prepared.summary.includes(f.name), `${kind} summary should name the file`);
    assert.ok(prepared.summary.length < 120);
  }
});

/* ---------------- Saying so before it is sent ---------------- */

test("the pre-send notice states the cap in rows and pages, not bytes", () => {
  assert.match(preSendNotice({ name: "big.csv", kind: "csv", rows: 900 }), new RegExp(`first ${MAX_CSV_ROWS} rows of 900`));
  assert.match(preSendNotice({ name: "small.csv", kind: "csv", rows: 12 }), /all 12 rows/);
  assert.match(preSendNotice({ name: "invoice.pdf", kind: "pdf" }), new RegExp(`first ${MAX_PDF_PAGES} pages`));
  assert.match(preSendNotice({ name: "label.jpg", kind: "image" }), /sending the image/);
});
