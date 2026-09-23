import { MAX_TOKENS } from "./models";
import { AiRouter } from "./router";
import {
  BULK_PARSE_SCHEMA, IMEI_EXTRACT_SCHEMA, ImeiExtractResult,
  validateBulkParse, validateImeiExtract,
} from "./schemas";
import { AiTurn, ValidationError } from "./types";
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

export interface ChatTurn {
  role: string;
  parts: { text: string }[];
}

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

export const runChat = async (
  router: AiRouter,
  inventory: InventoryRow[],
  history: ChatTurn[],
): Promise<string> => {
  const soldItems = inventory.filter(i => i.soldDate);
  const stockItems = inventory.filter(i => !i.soldDate);
  const totalProfit = soldItems.reduce(
    (acc, i) => acc + ((i.salePrice ?? 0) - (i.purchaseCost ?? 0) - (i.repairCost ?? 0)),
    0,
  );

  const system = `
        You are an expert business analyst and assistant for a reselling business called "FlipThatTech".

        CURRENT BUSINESS CONTEXT:
        - Total Items Tracked: ${inventory.length}
        - Items In Stock: ${stockItems.length}
        - Items Sold: ${soldItems.length}
        - Total All-Time Profit: $${totalProfit.toFixed(2)}

        FULL INVENTORY DATA (JSON):
        ${JSON.stringify(inventory)}

        INSTRUCTIONS:
        1. Answer questions based specifically on the inventory data provided above.
        2. If asked to write a listing, use the details from the inventory item (Model, Specs, Condition Notes) to write a compelling sales description.
        3. If asked about financial performance, calculate metrics dynamically from the JSON data.
        4. Keep answers professional but conversational. Use Markdown for formatting tables or lists.
        5. If the user asks about an item not in the list, politely inform them you don't see it in the database.
      `;

  const text = await router.runText("chat", {
    tier: "reasoning",
    maxTokens: MAX_TOKENS.reasoning,
    system,
    turns: toTurns(history),
  });
  return text || "I'm having trouble analyzing that right now.";
};

/**
 * The client's history format (Gemini's, from when this was Gemini-only) →
 * provider-neutral turns.
 *
 * The client still sends `{ role: "model" | "user", parts: [{ text }] }`
 * because THAT SHAPE IS PART OF THE CONTRACT — changing it would mean changing
 * the client, which this work is explicitly not doing. So the translation
 * happens here. A leading assistant turn is dropped: every provider requires
 * the conversation to start with the user, and a stray greeting at the front is
 * the one thing that would make an otherwise fine history rejected outright.
 */
export const toTurns = (history: ChatTurn[]): AiTurn[] => {
  const turns: AiTurn[] = history
    .map(h => ({
      role: (h.role === "model" || h.role === "assistant" ? "assistant" : "user") as AiTurn["role"],
      text: (h.parts || []).map(p => p?.text || "").join("").trim(),
    }))
    .filter(t => t.text.length > 0);
  while (turns.length > 0 && turns[0].role === "assistant") turns.shift();
  return turns;
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
