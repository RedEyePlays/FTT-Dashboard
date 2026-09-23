import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_HISTORY_TURNS, MAX_TURN_CHARS } from "./retrievalPolicy";
import { Turn, chatSystemPrompt, summariseDropped, toTurns, trimHistory } from "./chatPolicy";

const user = (text: string): Turn => ({ role: "user", text });
const bot = (text: string): Turn => ({ role: "assistant", text });

/** n exchanges: user, assistant, user, assistant… */
const conversation = (n: number): Turn[] =>
  Array.from({ length: n }, (_, i) => (i % 2 === 0 ? user(`question ${i / 2 + 1}`) : bot(`answer ${(i + 1) / 2}`)));

test("the client's history shape still converts, and a stray greeting is dropped", () => {
  const turns = toTurns([
    { role: "model", parts: [{ text: "Hi! Ask me anything." }] },
    { role: "user", parts: [{ text: "what sold today" }] },
    { role: "model", parts: [{ text: "Three devices." }] },
  ]);
  assert.deepEqual(turns, [
    { role: "user", text: "what sold today" },
    { role: "assistant", text: "Three devices." },
  ]);
});

test("a single enormous message is CUT rather than being allowed to blow the budget", () => {
  const [turn] = toTurns([{ role: "user", parts: [{ text: "x".repeat(MAX_TURN_CHARS * 2) }] }]);
  assert.ok(turn.text.length < MAX_TURN_CHARS + 120);
  assert.match(turn.text, /too long to send in full/);
});

test("a short conversation is sent whole, with nothing dropped", () => {
  const turns = conversation(6);
  const r = trimHistory(turns);
  assert.equal(r.dropped, 0);
  assert.equal(r.summary, undefined);
  assert.deepEqual(r.turns, turns);
});

test("a long conversation drops the OLDEST turns first", () => {
  const turns = conversation(40);
  const r = trimHistory(turns, 10);
  assert.ok(r.dropped > 0);
  assert.ok(r.turns.length <= 10);
  // The most recent exchange is always kept.
  assert.deepEqual(r.turns[r.turns.length - 1], turns[turns.length - 1]);
  // …and the very first is gone.
  assert.ok(!r.turns.some(t => t.text === "question 1"));
});

test("what survives still STARTS with a question", () => {
  // Cutting mid-exchange leaves an answer with nothing to answer, and every
  // provider requires the conversation to start with the user.
  for (const max of [5, 6, 7, 8, 9, 10]) {
    const r = trimHistory(conversation(40), max);
    assert.equal(r.turns[0].role, "user", `max=${max} should start on a user turn`);
  }
});

test("the dropped turns are replaced ONCE by a summary of what was asked", () => {
  const r = trimHistory(conversation(40), 10);
  assert.ok(r.summary);
  assert.match(r.summary!, /EARLIER IN THIS CONVERSATION/);
  assert.match(r.summary!, /question 1/);
  // The summary is built from the questions, not from the answers: it is what
  // the model needs to follow a reference back, and it cannot hallucinate.
  assert.ok(!r.summary!.includes("answer 1"));
});

test("the summary is not a model call — it is derived from the text", () => {
  // Deliberate: summarising with the model would mean a second paid request
  // on every long conversation, to save money.
  const summary = summariseDropped([user("what happened to PHN-000123"), bot("It sold.")]);
  assert.match(summary!, /PHN-000123/);
  assert.equal(summariseDropped([bot("only an answer")]), undefined);
});

test("a very long earlier question is shortened inside the summary", () => {
  const summary = summariseDropped([user("y".repeat(400))]);
  assert.ok(summary!.length < 400);
  assert.match(summary!, /…/);
});

test("the default cap is used when none is given", () => {
  const r = trimHistory(conversation(MAX_HISTORY_TURNS * 3));
  assert.ok(r.turns.length <= MAX_HISTORY_TURNS);
});

/* ---------------- The prompt ---------------- */

const viewer = { canSeeMoney: true, canSeePayroll: true };

test("the prompt says the records are a SELECTION, not the whole shop", () => {
  const p = chatSystemPrompt({ shopName: "FlipThatTech", context: "BUSINESS SUMMARY", viewer });
  assert.match(p, /SELECTION, not the whole shop/);
  assert.match(p, /say exactly what\s+you need/);
  assert.match(p, /Never invent a figure/);
});

test("it forbids totalling a partial set — the failure a selection invites", () => {
  const p = chatSystemPrompt({ shopName: "x", context: "", viewer });
  assert.match(p, /Never state a total you have not been given the parts of/);
});

test("a caller without money access is told to refuse, not to estimate", () => {
  const p = chatSystemPrompt({ shopName: "x", context: "", viewer: { canSeeMoney: false, canSeePayroll: true } });
  assert.match(p, /does NOT have access to cost, margin or profit/);
  assert.match(p, /do not estimate it/);
  assert.match(p, /do not infer it from the sale price/);
});

test("a caller with money access is told nothing about refusing", () => {
  const p = chatSystemPrompt({ shopName: "x", context: "", viewer });
  assert.ok(!/does NOT have access to cost/.test(p));
});

test("a caller without payroll access is told so", () => {
  const p = chatSystemPrompt({ shopName: "x", context: "", viewer: { canSeeMoney: true, canSeePayroll: false } });
  assert.match(p, /does not have access to payroll/);
});

test("earlier attachments are named as summaries, and the model is told not to expect them again", () => {
  const p = chatSystemPrompt({
    shopName: "x", context: "", viewer,
    attachmentSummaries: ["prices.csv — spreadsheet, 40 rows read"],
  });
  assert.match(p, /prices\.csv/);
  assert.match(p, /not repeated on every message/);
});

test("the context block is the last thing in the prompt", () => {
  const p = chatSystemPrompt({ shopName: "x", context: "THE-RECORDS-GO-HERE", viewer });
  assert.ok(p.trimEnd().endsWith("THE-RECORDS-GO-HERE"));
});
