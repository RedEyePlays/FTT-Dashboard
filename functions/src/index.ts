import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI, Type } from "@google/genai";

// Scheduled automated Firestore→Storage backups (see backups.ts).
export { scheduledBackups } from "./backups";

// Public, no-auth repair-status lookup for customers (see repairLookup.ts).
export { repairStatusLookup } from "./repairLookup";

// The Gemini API key lives in Firebase's server-side Secret Manager — it is
// NEVER shipped to the client. Set it before deploy with:
//   firebase functions:secrets:set GEMINI_API_KEY
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// Minimal structural shape of an inventory row (mirrors the client `InventoryItem`
// well enough for prompting; we don't import the client type into this subproject).
interface InventoryRow {
  [key: string]: unknown;
  notes?: string;
  salePrice?: number;
  purchaseCost?: number;
  repairCost?: number;
  soldDate?: string;
}

interface ChatTurn {
  role: string;
  parts: { text: string }[];
}

type AiRequest =
  | { op: "insights"; data: InventoryRow[] }
  | { op: "bulkParse"; text: string }
  | { op: "imeiExtract"; base64Image: string }
  | { op: "chat"; inventory: InventoryRow[]; history: ChatTurn[] };

/**
 * Single HTTPS callable that proxies every Gemini interaction the dashboard
 * needs. The client sends `{ op, ...payload }`; we read the API key from Secret
 * Manager, call Gemini server-side, and return the result. This keeps the key
 * off the client entirely (previously baked into the bundle via VITE_API_KEY).
 *
 * Ops:
 *   - insights:     financial insights markdown from the inventory log
 *   - bulkParse:    parse free text into structured inventory items
 *   - imeiExtract:  read an IMEI/serial from a base64 image
 *   - chat:         conversational assistant over the inventory
 */
export const aiGenerate = onCall(
  { secrets: [GEMINI_API_KEY], region: "us-central1" },
  async (request: CallableRequest<AiRequest>) => {
    // Auth gate: only signed-in Firebase users may spend Gemini quota.
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be signed in to use AI features."
      );
    }

    const body = request.data;
    if (!body || typeof body !== "object" || !("op" in body)) {
      throw new HttpsError("invalid-argument", "Missing 'op' in request.");
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY.value() });

    switch (body.op) {
      case "insights":
        return { text: await runInsights(ai, body.data ?? []) };
      case "bulkParse":
        return { items: await runBulkParse(ai, body.text ?? "") };
      case "imeiExtract":
        return { text: await runImeiExtract(ai, body.base64Image ?? "") };
      case "chat":
        return {
          text: await runChat(ai, body.inventory ?? [], body.history ?? []),
        };
      default:
        throw new HttpsError(
          "invalid-argument",
          `Unknown op: ${(body as { op: string }).op}`
        );
    }
  }
);

async function runInsights(ai: GoogleGenAI, data: InventoryRow[]): Promise<string> {
  // Strip user-provided 'notes' to prevent prompt injection.
  const sanitizedData = data.map(({ notes, ...retainedFields }) => retainedFields);
  const dataString = JSON.stringify(sanitizedData);
  const prompt = `
      Act as a senior business analyst. Analyze the following inventory log for a flipping/reselling business.

      Data (JSON): ${dataString}

      Please provide a Markdown formatted response with:
      1. **Performance Summary**: Overall profit, margin health, and sales velocity.
      2. **Top Performers**: Which items or models are generating the best return?
      3. **Sourcing Insights**: Observations on where items are bought vs. profitability (if pattern exists).
      4. **Inventory Alert**: specific items that have been in stock too long (stale inventory) or anomalies.
      5. **Actionable Tip**: One specific strategy for next month.

      Keep it concise and professional.
    `;

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: prompt,
    config: {
      systemInstruction:
        "You are a sharp, data-driven business consultant for a retail reseller.",
    },
  });

  return response.text || "No insights generated.";
}

async function runBulkParse(ai: GoogleGenAI, text: string): Promise<unknown[]> {
  const prompt = `
      Extract inventory items from the following text.
      The text may contain multiple items, prices, dates, and descriptions mixed together.

      Text to parse:
      "${text}"
    `;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            item: {
              type: Type.STRING,
              description: "Name of the product",
            },
            date: {
              type: Type.STRING,
              description: `Purchase date (YYYY-MM-DD). If not found, use ${new Date().toISOString().split("T")[0]}.`,
            },
            purchaseCost: {
              type: Type.NUMBER,
              description: "How much it was bought for.",
            },
            boughtFrom: {
              type: Type.STRING,
              description: "Who it was bought from.",
            },
            imei: {
              type: Type.STRING,
              description: "IMEI or Serial number.",
            },
            salePrice: {
              type: Type.NUMBER,
              description: "How much it was sold for (0 if not sold).",
            },
            soldDate: {
              type: Type.STRING,
              description: "Sale date (YYYY-MM-DD).",
            },
            soldTo: {
              type: Type.STRING,
              description: "Who it was sold to.",
            },
            repairCost: {
              type: Type.NUMBER,
              description: "Any repair costs mentioned (default 0).",
            },
            notes: {
              type: Type.STRING,
              description: "Any other details.",
            },
          },
          required: ["item", "date", "purchaseCost"],
        },
      },
    },
  });

  if (response.text) {
    const parsed = JSON.parse(response.text);
    return Array.isArray(parsed) ? parsed : [];
  }
  return [];
}

async function runImeiExtract(
  ai: GoogleGenAI,
  base64Image: string
): Promise<string> {
  // Remove header if present (e.g., "data:image/jpeg;base64,")
  const cleanBase64 = base64Image.split(",")[1] || base64Image;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: cleanBase64,
          },
        },
        {
          text: "Look at this image. Find the IMEI number or Serial Number. Return ONLY the alphanumeric string. If there are multiple, prefer IMEI. Do not include labels like 'IMEI:' or 'S/N', just the number. If none found, return nothing.",
        },
      ],
    },
  });

  return response.text?.trim() || "";
}

async function runChat(
  ai: GoogleGenAI,
  inventory: InventoryRow[],
  history: ChatTurn[]
): Promise<string> {
  const soldItems = inventory.filter((i) => i.soldDate);
  const stockItems = inventory.filter((i) => !i.soldDate);
  const totalProfit = soldItems.reduce(
    (acc, i) =>
      acc + ((i.salePrice ?? 0) - (i.purchaseCost ?? 0) - (i.repairCost ?? 0)),
    0
  );

  const systemInstruction = `
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

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: history,
    config: {
      systemInstruction,
    },
  });

  return response.text || "I'm having trouble analyzing that right now.";
}
