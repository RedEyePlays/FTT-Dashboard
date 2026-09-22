import { GoogleGenAI, Type } from "@google/genai";
import { modelFor } from "./models";
import {
  AiProvider, AiTurn, JsonSchema, ProviderError, StructuredTask, TextTask,
} from "./types";

/**
 * GEMINI, BEHIND THE SAME INTERFACE — the fallback.
 *
 * This is the code that was inline in index.ts, moved behind the provider
 * interface and otherwise unchanged in behaviour: same models, same
 * responseSchema mechanism, same JSON parse. Keeping it working is the point —
 * it is what answers while Claude beds in, and it is what answers if Claude is
 * down at 2pm on a Saturday.
 *
 * The one real translation is the schema: tasks now describe their result in
 * plain JSON Schema (so ONE definition serves both providers), and this file
 * converts that to Gemini's `Type` enum. The Claude adapter passes the same
 * object straight through.
 */

const TYPES: Record<JsonSchema["type"], Type> = {
  object: Type.OBJECT,
  array: Type.ARRAY,
  string: Type.STRING,
  number: Type.NUMBER,
  boolean: Type.BOOLEAN,
};

/** Plain JSON Schema → Gemini's responseSchema shape. Exported for testing. */
export const toGeminiSchema = (schema: JsonSchema): Record<string, unknown> => {
  const out: Record<string, unknown> = { type: TYPES[schema.type] };
  if (schema.description) out.description = schema.description;
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toGeminiSchema(v)]),
    );
  }
  // `additionalProperties` is deliberately dropped: Gemini's schema dialect has
  // no equivalent, and the validator enforces the shape either way.
  if (schema.required) out.required = schema.required;
  return out;
};

const statusOf = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown })?.status ?? (e as { code?: unknown })?.code;
  return typeof s === "number" ? s : undefined;
};

/** Same classification rule as the Claude adapter, for the same reasons. */
export const classifyGeminiError = (e: unknown): ProviderError | null => {
  if (e instanceof ProviderError) return e;
  const status = statusOf(e);
  const make = (reason: ProviderError["reason"], msg: string) =>
    new ProviderError("gemini", reason, msg, e);
  if (status === 401 || status === 403) return make("missing_key", `Gemini auth failed (${status})`);
  if (status === 408) return make("timeout", "Gemini request timed out");
  if (status === 429) return make("rate_limited", "Gemini rate limited");
  if (typeof status === "number" && status >= 500) return make("server_error", `Gemini server error (${status})`);
  if (typeof status === "number") return null;
  const message = String((e as { message?: unknown })?.message ?? "");
  if (/api[_ ]?key/i.test(message)) return make("missing_key", "Gemini API key is not configured");
  if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)) {
    return make("connection", `Could not reach Gemini: ${message}`);
  }
  return null;
};

const guarded = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    const classified = classifyGeminiError(e);
    if (classified) throw classified;
    throw e;
  }
};

/** Gemini calls the assistant role "model"; ours is "assistant". */
const toContents = (turns: AiTurn[]) =>
  turns.map(t => ({
    role: t.role === "assistant" ? "model" : "user",
    parts: [
      ...(t.image?.base64
        ? [{ inlineData: { mimeType: t.image.mediaType, data: t.image.base64 } }]
        : []),
      ...(t.text ? [{ text: t.text }] : []),
    ],
  }));

export const createGeminiProvider = (apiKey: string): AiProvider => {
  const client = () => {
    if (!apiKey) throw new ProviderError("gemini", "missing_key", "GEMINI_API_KEY is not set");
    return new GoogleGenAI({ apiKey });
  };

  return {
    name: "gemini",

    async runText(task: TextTask): Promise<string> {
      return guarded(async () => {
        const response = await client().models.generateContent({
          model: modelFor("gemini", task.tier),
          contents: toContents(task.turns),
          config: task.system ? { systemInstruction: task.system } : {},
        });
        return (response.text || "").trim();
      });
    },

    async runStructured(task: StructuredTask): Promise<unknown> {
      return guarded(async () => {
        const response = await client().models.generateContent({
          model: modelFor("gemini", task.tier),
          contents: toContents(task.turns),
          config: {
            ...(task.system ? { systemInstruction: task.system } : {}),
            responseMimeType: "application/json",
            responseSchema: toGeminiSchema(task.schema) as never,
          },
        });
        if (!response.text) {
          throw new ProviderError("gemini", "unknown", "Gemini returned no content");
        }
        try {
          return JSON.parse(response.text);
        } catch {
          // Unparseable JSON is a bad ANSWER, not a provider outage — it is
          // returned as-is so the validator rejects it, rather than being
          // dressed up as a failure that would bounce to another vendor.
          return null;
        }
      });
    },
  };
};
