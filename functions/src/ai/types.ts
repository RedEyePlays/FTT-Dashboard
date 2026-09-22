/**
 * THE PROVIDER INTERFACE.
 *
 * Every AI task in this codebase used to call `@google/genai` directly, which
 * meant the prompt, the vendor's request shape and the vendor's response
 * parsing were one inseparable lump per task. Changing provider meant rewriting
 * all four tasks; running two providers side by side was not expressible at all.
 *
 * So each task now describes WHAT it wants — a text answer, or a structured
 * object matching a schema — and a provider decides how to ask for it. The four
 * task functions in index.ts call this interface and never touch a vendor SDK.
 *
 * TWO KINDS OF TASK, deliberately, not one generic `generate`:
 *
 *   • `runText` returns prose. The caller gets a string.
 *   • `runStructured` returns the model's RAW object, unvalidated. Validation is
 *     the caller's job (see validate.ts) and happens OUTSIDE the provider on
 *     purpose — a schema violation is a fact about the answer, not about the
 *     provider, so it must never look like a provider failure and must never
 *     trigger the fallback. That distinction is the whole reason the two are
 *     separated here rather than folded together.
 *
 * ROOM FOR TOOLS, WITHOUT BUILDING THEM. A "look up retail price" task using
 * Claude's web search is planned for the PC-builds feature. `TextTask.tools`
 * exists so that task can opt in later without reshaping this interface; no op
 * sets it today, and a provider that cannot serve a requested tool says so
 * rather than silently answering without it.
 */

/** Which vendor actually answered. Logged on every call. */
export type ProviderName = "claude" | "gemini";

/**
 * A server-side tool a task may opt into.
 *
 * Deliberately vendor-neutral and deliberately tiny: this is a placeholder with
 * a real shape, not a tool implementation. The planned retail-price lookup will
 * add `{ kind: "webSearch" }` to a task and nothing else in this file changes.
 */
export type ServerTool =
  | { kind: "webSearch"; maxUses?: number; allowedDomains?: string[] };

/** One turn of a conversation. Text only, plus an optional inline image. */
export interface AiTurn {
  role: "user" | "assistant";
  text: string;
  /** Base64 image data, no data: prefix. Only meaningful on a user turn. */
  image?: { base64: string; mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" };
}

export interface TextTask {
  /** Which model tier to use — resolved per provider by models.ts. */
  tier: ModelTier;
  system?: string;
  turns: AiTurn[];
  maxTokens: number;
  /** Not used by any op yet — see the note above. */
  tools?: ServerTool[];
}

export interface StructuredTask {
  tier: ModelTier;
  system?: string;
  turns: AiTurn[];
  maxTokens: number;
  /**
   * The name the provider gives the extraction tool. Part of the prompt the
   * model sees, so it is descriptive rather than generic.
   */
  resultName: string;
  resultDescription: string;
  /**
   * A JSON Schema object describing the result. Plain JSON Schema, not a vendor
   * type, so one schema definition serves both providers — the Gemini adapter
   * translates it, the Claude adapter passes it through.
   */
  schema: JsonSchema;
}

/** The subset of JSON Schema these tasks need. */
export interface JsonSchema {
  type: "object" | "array" | "string" | "number" | "boolean";
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  additionalProperties?: boolean;
}

/**
 * Model TIER rather than model name, because the two providers have different
 * names for "the good one" and "the fast one". The actual ids live in one
 * object in models.ts.
 */
export type ModelTier = "reasoning" | "fast";

export interface AiProvider {
  readonly name: ProviderName;
  runText(task: TextTask): Promise<string>;
  /** The model's raw result. NEVER validated here — see the header. */
  runStructured(task: StructuredTask): Promise<unknown>;
}

/**
 * A failure that is the PROVIDER's fault — the request never got a usable
 * answer out of the vendor. Only these fall back.
 *
 * A validation failure is not one of these, and neither is a permission
 * refusal: both mean the system worked and the answer (or the caller) was
 * wrong, and retrying the identical request on another vendor would either
 * produce the same bad answer or paper over a real access problem.
 */
export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly reason: ProviderErrorReason,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export type ProviderErrorReason =
  | "missing_key"
  | "timeout"
  | "overloaded"
  | "rate_limited"
  | "server_error"
  | "connection"
  | "unknown";

/** The model answered, but not in the shape the task requires. Never falls back. */
export class ValidationError extends Error {
  constructor(readonly task: string, message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
