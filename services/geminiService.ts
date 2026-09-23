import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import { InventoryItem, ChatMessage } from "../types";
import { assertOnline } from "./functionsGuard";

// All Gemini calls now go through the `aiGenerate` Cloud Function, which holds
// the API key server-side (Firebase Secret Manager) and requires an
// authenticated caller. The key is NEVER present in the client bundle.
const aiGenerate = httpsCallable(functions, "aiGenerate");

// A conversational turn as the callable expects it.
interface ChatTurn {
  role: string;
  parts: { text: string }[];
}

export const getFinancialInsights = async (data: InventoryItem[]): Promise<string> => {
  assertOnline();
  try {
    const result = await aiGenerate({ op: "insights", data });
    const { text } = (result.data ?? {}) as { text?: string };
    return text || "No insights generated.";
  } catch (error) {
    console.error("Error generating insights:", error);
    return "Unable to generate insights at this time.";
  }
};

export const parseBulkInventory = async (text: string): Promise<InventoryItem[]> => {
  assertOnline();
  try {
    const result = await aiGenerate({ op: "bulkParse", text });
    const { items } = (result.data ?? {}) as { items?: any[] };

    // Ensure IDs are generated and defaults are applied (unchanged from before).
    // A real sale always has BOTH a sale price and a sold date — the model's
    // JSON schema forces it to fill in a numeric salePrice for every item even
    // when the text never mentions a sale, and it sometimes hallucinates a
    // guessed resale value instead of a literal 0. Since domain/inventory.ts's
    // applyDirectSale marks any device with a positive salePrice as sold the
    // moment it's saved, that hallucination silently sold every freshly-added
    // item. Requiring soldDate too (which the model has far less reason to
    // invent) is a cheap, reliable guard against a lone stray salePrice.
    return Array.isArray(items)
      ? items.map((item: any) => {
          const soldDate = item.soldDate || "";
          return {
            ...item,
            id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
            repairCost: item.repairCost || 0,
            purchaseCost: item.purchaseCost || 0,
            salePrice: soldDate ? (item.salePrice || 0) : 0,
            boughtFrom: item.boughtFrom || "",
            imei: item.imei || "",
            soldDate,
            soldTo: item.soldTo || "",
            notes: item.notes || "",
          };
        })
      : [];
  } catch (error) {
    console.error("Error parsing bulk inventory:", error);
    throw new Error("Failed to parse inventory data.");
  }
};

// Tier 3 (last resort) of the camera scanner — Gemini structured extraction.
// Returns the raw, unvalidated fields the model read off the image;
// domain/imeiScan.ts's validateExtractedFields is what actually checks Luhn
// and normalizes before any of this reaches the UI as a trustworthy value.
export interface ExtractedImeiFields {
  imei1: string;
  imei2: string;
  serial: string;
  eid: string;
}

export const extractImeiFromImage = async (base64Image: string): Promise<ExtractedImeiFields> => {
  assertOnline();
  try {
    const result = await aiGenerate({ op: "imeiExtract", base64Image });
    const data = (result.data ?? {}) as Partial<ExtractedImeiFields>;
    return {
      imei1: (data.imei1 || "").trim(),
      imei2: (data.imei2 || "").trim(),
      serial: (data.serial || "").trim(),
      eid: (data.eid || "").trim(),
    };
  } catch (error) {
    console.error("Error processing image:", error);
    throw new Error("Failed to extract text from image.");
  }
};

/**
 * The assistant.
 *
 * THE INVENTORY IS NO LONGER SENT. It used to go in full, on every message of
 * every conversation — the client serialised the whole shop and the prompt
 * pasted it in. The server now RETRIEVES the records the question refers to
 * (functions/src/ai/context.ts), so what leaves the browser is the
 * conversation and the files attached to this message, and nothing else.
 */
export interface ChatAttachmentPayload {
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** Text for a CSV or a text file; base64 for a PDF or an image. */
  data: string;
}

export interface ChatReply {
  text: string;
  /** Shown in the UI — e.g. that a long conversation was trimmed. */
  notices: string[];
  /** What actually answered, from server config. Never a hardcoded label. */
  model?: string;
  provider?: string;
  /** How many records the retrieval step looked at, for the footer. */
  recordsUsed?: number;
  /** One line per file sent, reused on later turns instead of the file. */
  attachmentSummaries?: string[];
  usage?: { used: number; cap: number; day: string };
}

export const generateChatResponse = async (
  messages: ChatMessage[],
  opts: {
    attachments?: ChatAttachmentPayload[];
    /** Summaries of files attached EARLIER in this conversation. */
    attachmentSummaries?: string[];
  } = {},
): Promise<ChatReply> => {
  assertOnline();
  const history: ChatTurn[] = messages
    .filter((m) => m.id !== "welcome")
    .map((m) => ({ role: m.role, parts: [{ text: m.text }] }));

  const result = await aiGenerate({
    op: "chat",
    history,
    ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
    ...(opts.attachmentSummaries?.length ? { attachmentSummaries: opts.attachmentSummaries } : {}),
  });
  const data = (result.data ?? {}) as Partial<ChatReply>;
  return {
    text: data.text || "I'm having trouble analyzing that right now.",
    notices: Array.isArray(data.notices) ? data.notices : [],
    ...(data.model ? { model: data.model } : {}),
    ...(data.provider ? { provider: data.provider } : {}),
    ...(typeof data.recordsUsed === "number" ? { recordsUsed: data.recordsUsed } : {}),
    ...(Array.isArray(data.attachmentSummaries) ? { attachmentSummaries: data.attachmentSummaries } : {}),
    ...(data.usage ? { usage: data.usage } : {}),
  };
};

/* ---------------- Listing copy (domain/listingCopy.ts) ---------------- */

export interface GeneratedListing {
  title: string;
  description: string;
}

/**
 * One Marketplace listing, from an allow-listed FACTS object.
 *
 * The caller builds the facts (domain/listingCopy.ts) — this never touches an
 * inventory row or a build document, so there is no path by which a cost, a
 * customer or a serial could travel with the request.
 *
 * ERRORS ARE THROWN, NOT SWALLOWED. Unlike getFinancialInsights, a listing
 * that quietly comes back empty would leave somebody staring at a blank box
 * with no idea whether to wait; and the server has already retried once
 * (functions/src/ai/tasks.ts) before it gives up.
 */
export const generateListing = async (
  facts: Record<string, unknown>,
  opts: { platform: string; length: string; markUsedParts: boolean },
): Promise<GeneratedListing> => {
  assertOnline();
  const result = await aiGenerate({
    op: "listing",
    facts,
    platform: opts.platform,
    length: opts.length,
    markUsedParts: opts.markUsedParts,
  });
  const data = (result.data ?? {}) as Partial<GeneratedListing>;
  const title = (data.title || "").trim();
  const description = (data.description || "").trim();
  if (!title || !description) throw new Error("The AI returned an empty listing.");
  return { title, description };
};

/* ---------------- GPU performance (domain/gpuPerformance.ts) ---------------- */

export interface GpuPerformanceProposal {
  gpuModel: string;
  rows: {
    game: string;
    resolution: string;
    preset: string;
    fpsLow: number;
    fpsHigh: number;
  }[];
  sources: string[];
}

/**
 * Proposed frame-rate ranges for ONE graphics card, from published benchmarks.
 *
 * NOTHING IS SAVED BY THIS CALL. What comes back is a proposal for the owner
 * to edit and confirm in Settings; the write happens there, with `source: 'ai'`
 * and the date stamped on.
 */
export const proposeGpuPerformance = async (gpuModel: string): Promise<GpuPerformanceProposal> => {
  assertOnline();
  const result = await aiGenerate({ op: "gpuPerformance", gpuModel });
  const data = (result.data ?? {}) as Partial<GpuPerformanceProposal>;
  if (!Array.isArray(data.rows) || data.rows.length === 0) {
    throw new Error("The AI returned no usable figures for that card.");
  }
  return {
    gpuModel: (data.gpuModel || gpuModel).trim(),
    rows: data.rows,
    sources: Array.isArray(data.sources) ? data.sources : [],
  };
};
