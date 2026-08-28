import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { GoogleGenAI, Type } from "@google/genai";
import * as admin from "firebase-admin";
import { Role, hasProfitVisibility } from "./permissions";

if (!admin.apps.length) admin.initializeApp();

// Scheduled automated Firestore→Storage backups (see backups.ts).
export { scheduledBackups } from "./backups";

// Public, no-auth repair-status lookup for customers (see repairLookup.ts).
export { repairStatusLookup } from "./repairLookup";

// The only write path a technician has for completedAt/warrantyUntil now
// that firestore.rules excludes them from direct client writes (see repairs.ts).
export { techUpdateRepair } from "./repairs";

// Owner-only, in-app staff password reset (see staffPassword.ts). Firebase's
// email reset is useless for staff accounts here — they routinely use
// addresses that don't receive mail — so the owner sets the password directly
// via the Admin SDK and hands it over out-of-band.
export { setStaffPassword } from "./staffPassword";

// Owner (or manager, for a technician account only), in-app staff account
// creation (see staffUser.ts) — sets the email/password/PIN directly, no
// self-claimed "pending invite" step.
export { createStaffUser } from "./staffUser";

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

// insights/chat send the full inventory — including purchaseCost, salePrice,
// repairCost — to Gemini and can return real profit/margin figures, so they
// need the same server-side gate reports.profit.summary already enforces for
// every other profit-surfacing view. The frontend menu gate (App.tsx/
// AppHeader) is UX only; this is what actually stops a technician/employee
// from calling aiGenerate directly and getting profit data back regardless.
async function requireProfitVisibility(uid: string): Promise<void> {
  const snap = await admin.firestore().collection("users").doc(uid).get();
  const data = snap.data() as { role?: Role; disabled?: boolean; allowProfit?: boolean } | undefined;
  if (!data || data.disabled || !hasProfitVisibility(data.role, data.allowProfit)) {
    throw new HttpsError(
      "permission-denied",
      "This AI feature surfaces profit/margin figures your account doesn't have access to."
    );
  }
}

/**
 * Single HTTPS callable that proxies every Gemini interaction the dashboard
 * needs. The client sends `{ op, ...payload }`; we read the API key from Secret
 * Manager, call Gemini server-side, and return the result. This keeps the key
 * off the client entirely (previously baked into the bundle via VITE_API_KEY).
 *
 * Ops:
 *   - insights:     financial insights markdown from the inventory log
 *   - bulkParse:    parse free text into structured inventory items
 *   - imeiExtract:  read IMEI1/IMEI2/Serial/EID separately from a base64 image
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
        await requireProfitVisibility(request.auth.uid);
        return { text: await runInsights(ai, body.data ?? []) };
      case "bulkParse":
        return { items: await runBulkParse(ai, body.text ?? "") };
      case "imeiExtract":
        return await runImeiExtract(ai, body.base64Image ?? "");
      case "chat":
        await requireProfitVisibility(request.auth.uid);
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

      IMPORTANT: Most items mentioned are only being PURCHASED/added to stock, not
      sold. Only set salePrice/soldDate/soldTo when the text explicitly says that
      specific item was already sold to someone (e.g. "sold X to Y for $Z"). Never
      guess or estimate a resale value for an item the text doesn't say was sold —
      leave salePrice at 0 and soldDate empty for it.

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
              description: "How much it was ALREADY sold for. Use exactly 0 unless the text explicitly says this item was sold — never a guessed/estimated resale value.",
            },
            soldDate: {
              type: Type.STRING,
              description: "Sale date (YYYY-MM-DD). Leave this an empty string unless the text explicitly says this item was already sold.",
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

interface ImeiExtractResult {
  imei1: string;
  imei2: string;
  serial: string;
  eid: string;
}

// Tier 3 (last resort) of the client's three-tier scanner — only reached once
// the free barcode/on-device-OCR tiers both fail. Returns structured fields
// so the client can label IMEI1/IMEI2/Serial/EID separately instead of
// guessing which single string it got back. Every field is whatever the
// model literally read, or an empty string when that field isn't visible in
// the image — the prompt is explicit about never guessing/inventing a value,
// and the client independently re-validates (Luhn) before trusting anything
// as "verified" (see domain/imeiScan.ts's validateExtractedFields), so this
// function does not need to (and cannot reliably) enforce the checksum
// itself.
async function runImeiExtract(
  ai: GoogleGenAI,
  base64Image: string
): Promise<ImeiExtractResult> {
  // Remove header if present (e.g., "data:image/jpeg;base64,")
  const cleanBase64 = base64Image.split(",")[1] || base64Image;
  const empty: ImeiExtractResult = { imei1: "", imei2: "", serial: "", eid: "" };
  if (!cleanBase64) return empty;

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
          text: `Look at this image of a phone/tablet's "About" screen or its
retail box label. Identify each of these fields SEPARATELY if visible:
- Primary IMEI, labelled any of: "IMEI", "IMEI1", "IMEI 1"
- Secondary IMEI (dual-SIM devices), labelled any of: "IMEI2", "IMEI 2"
- Serial number, labelled any of: "Serial Number", "Serial No", "S/N"
- EID (eSIM identifier), labelled: "EID"

For each field, return ONLY the literal alphanumeric value as printed/shown —
never the label text itself, never spaces or punctuation inside the value.
If a field is not visible anywhere in the image, leave it as an empty
string — do NOT guess, estimate, or reuse a value from another field. Do not
invent a value that isn't actually legible in the image.`,
        },
      ],
    },
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          imei1: { type: Type.STRING, description: "Primary IMEI/IMEI1, digits only. Empty string if not visible." },
          imei2: { type: Type.STRING, description: "Secondary IMEI2 (dual-SIM), digits only. Empty string if not visible." },
          serial: { type: Type.STRING, description: "Serial number as printed. Empty string if not visible." },
          eid: { type: Type.STRING, description: "EID, digits only. Empty string if not visible." },
        },
        required: ["imei1", "imei2", "serial", "eid"],
      },
    },
  });

  if (!response.text) return empty;
  try {
    const parsed = JSON.parse(response.text);
    return {
      imei1: typeof parsed.imei1 === "string" ? parsed.imei1 : "",
      imei2: typeof parsed.imei2 === "string" ? parsed.imei2 : "",
      serial: typeof parsed.serial === "string" ? parsed.serial : "",
      eid: typeof parsed.eid === "string" ? parsed.eid : "",
    };
  } catch {
    return empty;
  }
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
