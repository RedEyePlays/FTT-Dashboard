import { JsonSchema, ValidationError } from "./types";

/**
 * THE RESULT SHAPES, AND THE CHECKS A SCHEMA CANNOT MAKE.
 *
 * One JSON Schema definition per structured task, shared by both providers (the
 * Claude adapter passes it through as a tool input schema; the Gemini adapter
 * translates it). Keeping one definition is the point: two copies would drift,
 * and the drift would show up as one provider quietly returning a different
 * shape to the client than the other.
 *
 * THE VALIDATORS ARE NOT REDUNDANT with `strict: true`. The API guarantees the
 * arguments match the schema; it does not guarantee they are the right TYPE for
 * the client, because:
 *
 *   • the Gemini path has no strict mode at all — its JSON is parsed by hand,
 *     and `JSON.parse` of a truncated response yields whatever it yields;
 *   • a fallback answer and a primary answer must be indistinguishable to the
 *     client, so both go through the same gate;
 *   • the client's contract is narrower than the schema in places the schema
 *     can't say (a numeric field arriving as the string "250" validates as a
 *     number nowhere, but a model that returns it is a real thing).
 *
 * So: nothing reaches the client without passing through here, and a failure
 * raises ValidationError — which never falls back (see router.ts).
 */

/* ---------------- bulkParse ---------------- */

export const BULK_PARSE_SCHEMA = (todayISO: string): JsonSchema => ({
  type: "object",
  properties: {
    items: {
      type: "array",
      description: "Every inventory item found in the text.",
      items: {
        type: "object",
        properties: {
          item: { type: "string", description: "Name of the product" },
          date: {
            type: "string",
            description: `Purchase date (YYYY-MM-DD). If not found, use ${todayISO}.`,
          },
          purchaseCost: { type: "number", description: "How much it was bought for." },
          boughtFrom: { type: "string", description: "Who it was bought from." },
          imei: { type: "string", description: "IMEI or Serial number." },
          salePrice: {
            type: "number",
            description: "How much it was ALREADY sold for. Use exactly 0 unless the text explicitly says this item was sold — never a guessed/estimated resale value.",
          },
          soldDate: {
            type: "string",
            description: "Sale date (YYYY-MM-DD). Leave this an empty string unless the text explicitly says this item was already sold.",
          },
          soldTo: { type: "string", description: "Who it was sold to." },
          repairCost: { type: "number", description: "Any repair costs mentioned (default 0)." },
          notes: { type: "string", description: "Any other details." },
        },
        required: ["item", "date", "purchaseCost"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
});

/**
 * The client's contract for bulkParse is `{ items: unknown[] }` — it maps the
 * rows itself. So the validator's job is the shape around the rows, plus the
 * three fields the prompt declares required; a row missing those is dropped
 * rather than handed over half-formed.
 *
 * THE RETURN TYPE IS UNCHANGED: an array, exactly as before.
 */
export const validateBulkParse = (raw: unknown): unknown[] => {
  // A bare array is accepted too — that is what the Gemini schema produced
  // before this change, and an old-shaped answer is still a good answer.
  const list = Array.isArray(raw)
    ? raw
    : (raw as { items?: unknown })?.items;
  if (!Array.isArray(list)) {
    throw new ValidationError("bulkParse", "Model did not return a list of items.");
  }
  const rows = list.filter((row): row is Record<string, unknown> => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const r = row as Record<string, unknown>;
    // The three the prompt marks required. Everything else is optional and the
    // client already treats it as such.
    return typeof r.item === "string" && r.item.trim().length > 0
      && typeof r.date === "string"
      && typeof r.purchaseCost === "number" && Number.isFinite(r.purchaseCost);
  });
  // An empty result is legitimate — a paste with no items in it parses to
  // nothing — but a result where EVERY row was malformed is not: that is a
  // model failure being silently reported as "found nothing".
  if (rows.length === 0 && list.length > 0) {
    throw new ValidationError("bulkParse", "Every parsed row was malformed.");
  }
  return rows;
};

/* ---------------- imeiExtract ---------------- */

export interface ImeiExtractResult {
  imei1: string;
  imei2: string;
  serial: string;
  eid: string;
}

export const IMEI_EXTRACT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    imei1: { type: "string", description: "Primary IMEI/IMEI1, digits only. Empty string if not visible." },
    imei2: { type: "string", description: "Secondary IMEI2 (dual-SIM), digits only. Empty string if not visible." },
    serial: { type: "string", description: "Serial number as printed. Empty string if not visible." },
    eid: { type: "string", description: "EID, digits only. Empty string if not visible." },
  },
  required: ["imei1", "imei2", "serial", "eid"],
  additionalProperties: false,
};

/**
 * All four fields, always strings — the client labels IMEI1/IMEI2/Serial/EID
 * separately and independently re-validates (Luhn) before trusting any of them
 * as "verified" (domain/imeiScan.ts), so a missing field must arrive as an
 * empty string rather than as `undefined`.
 *
 * A response that is not an object at all is a ValidationError; a response that
 * is an object with a non-string field has that ONE field emptied. The
 * difference matters: the second case still gives the scanner the three fields
 * it did read, and a half-read label is the normal case for this task.
 */
export const validateImeiExtract = (raw: unknown): ImeiExtractResult => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("imeiExtract", "Model did not return an object.");
  }
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  return { imei1: str(r.imei1), imei2: str(r.imei2), serial: str(r.serial), eid: str(r.eid) };
};
