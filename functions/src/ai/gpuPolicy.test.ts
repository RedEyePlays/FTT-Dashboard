import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GPU_GAMES, GPU_PERFORMANCE_SCHEMA, GPU_RESOLUTIONS,
  MAX_PLAUSIBLE_FPS, MIN_PLAUSIBLE_FPS,
  gpuPerformanceSystemPrompt, gpuPerformanceUserPrompt, validateGpuPerformance,
} from "./gpuPolicy";

/**
 * An fps figure is a performance claim, so the validator's job is to be hard
 * to satisfy: ranges only, plausible bounds, every game present, and no
 * single number dressed up as a range.
 */

const row = (game: string, resolution: string, over: Record<string, unknown> = {}) => ({
  game, resolution, preset: "High", fpsLow: 90, fpsHigh: 140, ...over,
});

const fullAnswer = (over: Record<string, unknown> = {}) => ({
  rows: GPU_GAMES.flatMap(g => GPU_RESOLUTIONS.map(r => row(g, r))),
  sources: ["https://www.techpowerup.com/review/x"],
  ...over,
});

test("the six games are fixed, and Minecraft is qualified with shaders", () => {
  assert.equal(GPU_GAMES.length, 6);
  assert.ok(GPU_GAMES.includes("Minecraft (with shaders)"));
  // Vanilla Minecraft runs at several hundred frames on anything with a fan,
  // so an unqualified figure for it would be meaningless in an advert.
  assert.ok(!(GPU_GAMES as readonly string[]).includes("Minecraft"));
});

test("the prompt demands ranges, both resolutions and real sources", () => {
  const p = gpuPerformanceSystemPrompt();
  assert.match(p, /Every figure is a RANGE/);
  assert.match(p, /Never report a\s+single number/);
  assert.match(p, /1080p and 1440p/);
  assert.match(p, /Do not invent a source/);
  assert.match(p, /widen the range rather than picking a side/);
  for (const g of GPU_GAMES) assert.ok(p.includes(g), `prompt should name ${g}`);
});

test("the user prompt names the card and nothing else", () => {
  assert.match(gpuPerformanceUserPrompt("RTX 5060 Ti"), /RTX 5060 Ti/);
});

test("the schema requires a low AND a high on every row", () => {
  const item = GPU_PERFORMANCE_SCHEMA.properties!.rows.items!;
  assert.deepEqual(item.required, ["game", "resolution", "preset", "fpsLow", "fpsHigh"]);
});

test("a complete answer is accepted, and the card's name is carried", () => {
  const r = validateGpuPerformance("RTX 5060 Ti", fullAnswer());
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.gpuModel, "RTX 5060 Ti");
  assert.equal(r.value.rows.length, GPU_GAMES.length * GPU_RESOLUTIONS.length);
  assert.deepEqual(r.value.sources, ["https://www.techpowerup.com/review/x"]);
});

test("a row whose 'range' is one number twice is DROPPED, and the answer fails", () => {
  const rows = fullAnswer().rows.map((x, i) => (i === 0 ? { ...x, fpsLow: 120, fpsHigh: 120 } : x));
  const r = validateGpuPerformance("RTX 5060 Ti", { rows, sources: [] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /Fortnite/);
  assert.match(r.reason, /low-to-high range/);
});

test("a reversed range is rejected rather than silently swapped", () => {
  // Swapping it would be guessing at what somebody meant about a claim the
  // shop publishes. Ask again instead.
  const rows = fullAnswer().rows.map((x, i) => (i === 0 ? { ...x, fpsLow: 200, fpsHigh: 100 } : x));
  assert.equal(validateGpuPerformance("x", { rows, sources: [] }).ok, false);
});

test("implausible figures are rejected — 0 means it did not know", () => {
  for (const bad of [{ fpsLow: 0, fpsHigh: 3 }, { fpsLow: 900, fpsHigh: 4000 }]) {
    const rows = fullAnswer().rows.map((x, i) => (i === 0 ? { ...x, ...bad } : x));
    const r = validateGpuPerformance("x", { rows, sources: [] });
    assert.equal(r.ok, false, `${JSON.stringify(bad)} should be rejected`);
  }
  assert.ok(MIN_PLAUSIBLE_FPS > 0);
  assert.ok(MAX_PLAUSIBLE_FPS <= 1000);
});

test("a missing game fails the whole answer rather than half-filling the table", () => {
  const rows = fullAnswer().rows.filter(x => x.game !== "CS2");
  const r = validateGpuPerformance("x", { rows, sources: [] });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.reason, /CS2/);
});

test("a game named loosely is matched to the canonical one", () => {
  const rows = fullAnswer().rows.map(x =>
    x.game === "Minecraft (with shaders)" ? { ...x, game: "Minecraft" } : x);
  const r = validateGpuPerformance("x", { rows, sources: [] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  // …and stored under the canonical name, so the table never grows two
  // spellings of one game.
  assert.ok(r.value.rows.every(row2 => GPU_GAMES.includes(row2.game as typeof GPU_GAMES[number])));
});

test("a resolution written as '1080p (Full HD)' is still 1080p", () => {
  const rows = fullAnswer().rows.map(x =>
    x.resolution === "1080p" ? { ...x, resolution: "1080p (Full HD)" } : x);
  const r = validateGpuPerformance("x", { rows, sources: [] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.ok(r.value.rows.every(row2 => GPU_RESOLUTIONS.includes(row2.resolution as typeof GPU_RESOLUTIONS[number])));
});

test("a duplicate game+resolution keeps the first and does not fail", () => {
  const rows = [...fullAnswer().rows, row("Fortnite", "1080p", { fpsLow: 10, fpsHigh: 20 })];
  const r = validateGpuPerformance("x", { rows, sources: [] });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.rows.length, GPU_GAMES.length * GPU_RESOLUTIONS.length);
  assert.equal(r.value.rows.find(x => x.game === "Fortnite" && x.resolution === "1080p")!.fpsLow, 90);
});

test("a row with no preset is dropped — a figure with no settings behind it says nothing", () => {
  const rows = fullAnswer().rows.map((x, i) => (i === 0 ? { ...x, preset: "  " } : x));
  assert.equal(validateGpuPerformance("x", { rows, sources: [] }).ok, false);
});

test("junk, a missing rows array and a non-object are all rejected", () => {
  for (const bad of ["nope", 42, null, [], {}, { rows: "many" }]) {
    assert.equal(validateGpuPerformance("x", bad).ok, false);
  }
});

test("sources are kept as strings and capped", () => {
  const r = validateGpuPerformance("x", fullAnswer({ sources: Array.from({ length: 30 }, (_, i) => `s${i}`) }));
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.value.sources.length, 10);
});

test("a missing sources list is not fatal — the rows still stand or fall on their own", () => {
  const r = validateGpuPerformance("x", { rows: fullAnswer().rows });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.value.sources, []);
});
