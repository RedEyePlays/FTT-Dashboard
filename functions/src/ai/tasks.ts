import { MAX_TOKENS } from "./models";
import { AiRouter } from "./router";
import {
  BULK_PARSE_SCHEMA, IMEI_EXTRACT_SCHEMA, ImeiExtractResult,
  validateBulkParse, validateImeiExtract,
} from "./schemas";
import { AiTurn, ValidationError } from "./types";
import { Viewer } from "./retrievalPolicy";
import { ChatTurn as PolicyTurn, chatSystemPrompt, trimHistory, toTurns } from "./chatPolicy";

// Re-exported because router.test.ts and the callable both reach for it here;
// the implementation lives in chatPolicy.ts with the rest of the trimming.
export { toTurns };
import { PreparedAttachment } from "./attachmentPolicy";
import {
  LISTING_SCHEMA, ListingRequest, ListingResult, checkOutput,
  listingSystemPrompt, listingUserPrompt, parseListing,
} from "./listingPolicy";
import {
  GPU_PERFORMANCE_SCHEMA, GpuPerformanceProposal,
  gpuPerformanceSystemPrompt, gpuPerformanceUserPrompt, validateGpuPerformance,
} from "./gpuPolicy";

/**
 * THE TASKS, PROVIDER-AGNOSTIC.
 *
 * Each one owns its prompt and its return shape and knows nothing about which
 * vendor answers. The prompts below are the ones that were inline in index.ts,
 * carried over with their intent unchanged — every instruction that was load-
 * bearing is still there, in the same words:
 *
 *   • insights strips user-typed `notes` before sending, to keep a note
 *     somebody typed into a device record from reaching the model as an
 *     instruction;
 *   • bulkParse's "most items are being PURCHASED, not sold" paragraph is what
 *     stops the model inventing a resale value for everything it reads;
 *   • imeiExtract's "never guess, estimate, or reuse a value from another
 *     field" is what stops a half-legible label producing four confident wrong
 *     numbers.
 *
 * RETURN SHAPES ARE THE CONTRACT. The client calls aiGenerate from ~10 places
 * and only ever sees `{ text }`, `{ items }`, and the imeiExtract object.
 * Nothing here changes them; the two newer ops (listing, gpuPerformance) add
 * their own shapes rather than altering any of those.
 */

/**
 * The ops that surface profit/margin figures and therefore need
 * requireProfitVisibility.
 *
 * Declared as a LIST rather than left as two `await` calls buried in a switch:
 * the gate is the only thing stopping a technician calling aiGenerate directly
 * and getting the shop's margins back, and a list is something a test can
 * assert on. bulkParse and imeiExtract are deliberately absent — one parses
 * text the caller just typed, the other reads a label off a photo, and neither
 * is shown any inventory at all.
 */
export const PROFIT_GATED_OPS = ["insights", "chat"] as const;

export const needsProfitVisibility = (op: string): boolean =>
  (PROFIT_GATED_OPS as readonly string[]).includes(op);

/** Minimal structural shape of an inventory row (mirrors the client type). */
export interface InventoryRow {
  [key: string]: unknown;
  notes?: string;
  salePrice?: number;
  purchaseCost?: number;
  repairCost?: number;
  soldDate?: string;
}

/** The client's history shape, unchanged — see chatPolicy.ts's toTurns. */
export type ChatTurn = PolicyTurn;

const userTurn = (text: string): AiTurn[] => [{ role: "user", text }];

/* ---------------- insights ---------------- */

export const runInsights = async (
  router: AiRouter,
  data: InventoryRow[],
): Promise<string> => {
  // Strip user-provided 'notes' to prevent prompt injection.
  const sanitizedData = data.map(({ notes, ...retainedFields }) => retainedFields);
  const prompt = `
      Act as a senior business analyst. Analyze the following inventory log for a flipping/reselling business.

      Data (JSON): ${JSON.stringify(sanitizedData)}

      Please provide a Markdown formatted response with:
      1. **Performance Summary**: Overall profit, margin health, and sales velocity.
      2. **Top Performers**: Which items or models are generating the best return?
      3. **Sourcing Insights**: Observations on where items are bought vs. profitability (if pattern exists).
      4. **Inventory Alert**: specific items that have been in stock too long (stale inventory) or anomalies.
      5. **Actionable Tip**: One specific strategy for next month.

      Keep it concise and professional.
    `;

  const text = await router.runText("insights", {
    tier: "reasoning",
    maxTokens: MAX_TOKENS.reasoning,
    system: "You are a sharp, data-driven business consultant for a retail reseller.",
    turns: userTurn(prompt),
  });
  return text || "No insights generated.";
};

/* ---------------- bulkParse ---------------- */

export const runBulkParse = async (
  router: AiRouter,
  text: string,
  todayISO: string,
): Promise<unknown[]> => {
  const prompt = `
      Extract inventory items from the following text.
      The text may contain multiple items, prices, dates, and descriptions mixed together.

      IMPORTANT: Most items mentioned are only being PURCHASED/added to stock, not
      sold. Only set salePrice/soldDate/soldTo when the text explicitly says that
      specific item was already sold to someone (e.g. "sold X to Y for $Z"). Never
      guess or estimate a resale value for an item the text doesn't say was sold —
      leave salePrice at 0 and soldDate empty for it.

      Text to parse:
      "${text}"
    `;

  const raw = await router.runStructured("bulkParse", {
    tier: "fast",
    maxTokens: MAX_TOKENS.fast,
    turns: userTurn(prompt),
    resultName: "record_inventory_items",
    resultDescription: "Record every inventory item found in the text.",
    schema: BULK_PARSE_SCHEMA(todayISO),
  });
  // Validated BEFORE it reaches the client, on both providers' paths.
  return validateBulkParse(raw);
};

/* ---------------- imeiExtract ---------------- */

const IMEI_PROMPT = `Look at this image of a phone/tablet's "About" screen or its
retail box label. Identify each of these fields SEPARATELY if visible:
- Primary IMEI, labelled any of: "IMEI", "IMEI1", "IMEI 1"
- Secondary IMEI (dual-SIM devices), labelled any of: "IMEI2", "IMEI 2"
- Serial number, labelled any of: "Serial Number", "Serial No", "S/N"
- EID (eSIM identifier), labelled: "EID"

For each field, return ONLY the literal alphanumeric value as printed/shown —
never the label text itself, never spaces or punctuation inside the value.
If a field is not visible anywhere in the image, leave it as an empty
string — do NOT guess, estimate, or reuse a value from another field. Do not
invent a value that isn't actually legible in the image.`;

export const EMPTY_IMEI_RESULT: ImeiExtractResult = { imei1: "", imei2: "", serial: "", eid: "" };

export const runImeiExtract = async (
  router: AiRouter,
  base64Image: string,
): Promise<ImeiExtractResult> => {
  // Remove header if present (e.g., "data:image/jpeg;base64,").
  const cleanBase64 = base64Image.split(",")[1] || base64Image;
  if (!cleanBase64) return EMPTY_IMEI_RESULT;

  const raw = await router.runStructured("imeiExtract", {
    tier: "fast",
    maxTokens: MAX_TOKENS.fast,
    turns: [{
      role: "user",
      text: IMEI_PROMPT,
      // The client's scanner captures JPEG (see components/ImeiScanner.tsx);
      // the media type has to be declared and has to be right, so it is stated
      // here once rather than sniffed.
      image: { base64: cleanBase64, mediaType: "image/jpeg" },
    }],
    resultName: "record_device_identifiers",
    resultDescription: "Record the device identifiers visible in the image.",
    schema: IMEI_EXTRACT_SCHEMA,
  });
  return validateImeiExtract(raw);
};

/* ---------------- chat ---------------- */

export interface ChatInput {
  /** The retrieved, redacted context block (src/ai/context.ts). */
  context: string;
  history: ChatTurn[];
  viewer: Viewer;
  shopName: string;
  /** Files attached to THIS message, already checked and prepared. */
  attachments?: PreparedAttachment[];
  /** One-line summaries of files attached EARLIER in this conversation. */
  attachmentSummaries?: string[];
}

export interface ChatOutput {
  text: string;
  /** Surfaced in the UI so a trimmed conversation says so. */
  notices: string[];
  /** Roughly what this cost, for the usage meter. */
  approxInputChars: number;
}

/**
 * THE ASSISTANT, NO LONGER HOLDING THE WHOLE SHOP.
 *
 * What changed, and why it is the whole point of this file now:
 *
 *   BEFORE  the system prompt contained `JSON.stringify(inventory)` — every
 *           row, every field, on every turn of every conversation.
 *   NOW     it contains a business summary and the handful of records the
 *           question actually refers to, rendered as a timeline, redacted for
 *           this particular caller.
 *
 * The history is trimmed rather than resent whole (chatPolicy.ts), and an
 * attachment is sent ONCE — later turns carry a one-line summary of it.
 */
export const runChat = async (
  router: AiRouter,
  input: ChatInput,
): Promise<ChatOutput> => {
  const trimmed = trimHistory(toTurns(input.history));
  const notices: string[] = [];
  if (trimmed.dropped > 0) {
    notices.push(
      `This conversation is long, so the earliest ${trimmed.dropped} message${trimmed.dropped === 1 ? " was" : "s were"} summarised rather than resent in full.`,
    );
  }

  const system = chatSystemPrompt({
    shopName: input.shopName,
    context: input.context,
    viewer: input.viewer,
    ...(input.attachmentSummaries?.length ? { attachmentSummaries: input.attachmentSummaries } : {}),
  });

  const turns: AiTurn[] = [];
  // The summary of what was dropped goes FIRST, as its own user turn, so the
  // model sees the thread before the surviving messages.
  if (trimmed.summary) turns.push({ role: "user", text: trimmed.summary });
  for (const t of trimmed.turns) turns.push({ role: t.role, text: t.text });

  // Attachments ride on the LAST user turn, which is the message they were
  // attached to.
  const attachments = input.attachments || [];
  if (attachments.length > 0) {
    const last = turns[turns.length - 1];
    const textual = attachments.filter(a => a.text != null);
    const binary = attachments.filter(a => a.base64 != null);
    if (last && last.role === "user") {
      // A spreadsheet is TEXT, never a picture of a spreadsheet — see
      // attachmentPolicy.ts.
      for (const a of textual) {
        last.text += `\n\nATTACHED FILE: ${a.name}\n${a.text}`;
        if (a.truncated) last.text += `\n(only the first part of this file was sent)`;
      }
      // One image per turn is what every provider's turn shape supports here;
      // the rest are named so the model knows they exist and can ask.
      const first = binary[0];
      if (first?.base64 && first.mediaType?.startsWith("image/")) {
        last.image = {
          base64: first.base64,
          mediaType: first.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        };
      }
      const unsent = binary.slice(first?.mediaType?.startsWith("image/") ? 1 : 0);
      if (unsent.length > 0) {
        last.text += `\n\n(Also attached, not readable in this message: ${unsent.map(a => a.name).join(", ")})`;
        notices.push(`${unsent.length} attachment${unsent.length === 1 ? "" : "s"} could not be read directly — ask about ${unsent.length === 1 ? "it" : "them"} one at a time.`);
      }
    }
  }

  const text = await router.runText("chat", {
    tier: "reasoning",
    maxTokens: MAX_TOKENS.reasoning,
    system,
    turns,
  });

  return {
    text: text || "I'm having trouble analyzing that right now.",
    notices,
    approxInputChars: system.length + turns.reduce((n, t) => n + t.text.length, 0),
  };
};

/* ---------------- listing ---------------- */

/**
 * ONE MARKETPLACE LISTING, FROM FACTS ONLY.
 *
 * The caller sends a FACTS object built from an allow-list on the client
 * (domain/listing.ts) — never an inventory row and never a build document. So
 * the cost, the margin, the seller, the customer, the IMEI and the serial are
 * not absent because the prompt asks for them to be left out; they are absent
 * because they were never sent.
 *
 * VALIDATED, AND RETRIED ONCE. If the answer contains a number that was not in
 * the facts, or claims the goods are new when they are not, it is thrown away
 * and asked for again WITH THE REASON — a second attempt that is not told what
 * was wrong is just a second roll of the dice. A second failure is a visible
 * error: half a listing is worse than none, because somebody will post it.
 */
export const runListing = async (
  router: AiRouter,
  req: ListingRequest,
): Promise<ListingResult> => {
  const system = listingSystemPrompt(req);
  const ask = async (extra?: string): Promise<ListingResult> => {
    const raw = await router.runStructured("listing", {
      tier: "reasoning",
      maxTokens: MAX_TOKENS.reasoning,
      system,
      turns: userTurn(extra ? `${listingUserPrompt(req)}\n\n${extra}` : listingUserPrompt(req)),
      resultName: "write_listing",
      resultDescription: "Write the classified listing's title and description.",
      schema: LISTING_SCHEMA,
    });
    return parseListing(raw);
  };

  const first = await ask();
  const check = checkOutput(req.facts, first);
  if (check.ok) return first;

  const second = await ask(check.reason);
  const recheck = checkOutput(req.facts, second);
  if (recheck.ok) return second;

  // Never hand back something that failed the check. The client shows the
  // error and keeps whatever draft was already on screen.
  throw new ValidationError(
    "listing",
    recheck.impliedNew
      ? "The listing kept claiming the item is new."
      : `The listing kept inventing figures: ${recheck.invented.join(", ")}.`,
  );
};

/* ---------------- gpuPerformance ---------------- */

/**
 * GAME FPS RANGES FOR ONE GPU, FILLED ONCE AND REVIEWED BY A HUMAN.
 *
 * WHY THIS IS NOT PART OF THE LISTING PROMPT. An fps figure is a PERFORMANCE
 * CLAIM. A model asked for one fresh on every advert will produce confident,
 * differing numbers for the same card, and two of the shop's own ads quoting
 * different fps for an RTX 5060 Ti is exactly the screenshot a buyer sends
 * back. So the numbers are filled in ONCE per GPU, a human approves them, and
 * every build quotes the same table.
 *
 * WEB SEARCH IS ON for this op — it is the one task in this codebase that
 * should be reading published benchmarks rather than recalling them, and the
 * sources come back with the rows so the owner can check where a number came
 * from. A provider that cannot serve the tool says so rather than quietly
 * answering from memory (see types.ts's ServerTool).
 *
 * NOTHING IS SAVED HERE. The rows are proposals; the review screen writes them.
 */
export const runGpuPerformance = async (
  router: AiRouter,
  gpuModel: string,
): Promise<GpuPerformanceProposal> => {
  const model = (gpuModel || "").trim();
  if (!model) throw new ValidationError("gpuPerformance", "No GPU model given.");

  const ask = async (extra?: string): Promise<unknown> => router.runStructured("gpuPerformance", {
    tier: "reasoning",
    maxTokens: MAX_TOKENS.reasoning,
    system: gpuPerformanceSystemPrompt(),
    turns: userTurn(extra ? `${gpuPerformanceUserPrompt(model)}\n\n${extra}` : gpuPerformanceUserPrompt(model)),
    resultName: "record_gpu_performance",
    resultDescription: "Record the expected frame-rate ranges for this graphics card.",
    schema: GPU_PERFORMANCE_SCHEMA,
    tools: [{ kind: "webSearch", maxUses: 5 }],
  });

  const first = validateGpuPerformance(model, await ask());
  if (first.ok) return first.value;
  const second = validateGpuPerformance(model, await ask(first.reason));
  if (second.ok) return second.value;
  throw new ValidationError("gpuPerformance", second.reason);
};
