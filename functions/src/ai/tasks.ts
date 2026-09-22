import { MAX_TOKENS } from "./models";
import { AiRouter } from "./router";
import {
  BULK_PARSE_SCHEMA, IMEI_EXTRACT_SCHEMA, ImeiExtractResult,
  validateBulkParse, validateImeiExtract,
} from "./schemas";
import { AiTurn } from "./types";

/**
 * THE FOUR TASKS, PROVIDER-AGNOSTIC.
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
 * Nothing here changes them.
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
