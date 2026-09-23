import Anthropic from "@anthropic-ai/sdk";
import { modelFor } from "./models";
import {
  AiProvider, AiTurn, ProviderError, ServerTool, StructuredTask, TextTask,
} from "./types";

/**
 * CLAUDE, BEHIND THE SHARED PROVIDER INTERFACE.
 *
 * STRUCTURED OUTPUT IS TOOL USE. The model is given exactly one tool whose
 * input schema IS the result schema, and is required to call it
 * (`tool_choice`). `strict: true` makes the API itself guarantee the arguments
 * validate against that schema, so the common failure mode — a model returning
 * prose around its JSON, or an almost-right object — is handled before the
 * response leaves Anthropic.
 *
 * That is not a substitute for validating. This file returns the tool input
 * RAW; validate.ts checks it afterwards, and the checks it makes are the ones a
 * schema cannot express (see that file). Unvalidated model output never reaches
 * the client.
 *
 * ERRORS ARE CLASSIFIED, NOT SWALLOWED. Everything that is the vendor's fault
 * — no key, a timeout, a 5xx, an overload, a dropped connection — is rethrown
 * as a ProviderError so the router can fall back. A 400 is NOT one of those: a
 * malformed request would fail identically on Gemini, and hiding it behind a
 * fallback would mean shipping a broken request shape that nobody ever sees.
 */

/** Anthropic's own error shape, narrowed to what classification needs. */
const statusOf = (e: unknown): number | undefined => {
  const s = (e as { status?: unknown })?.status;
  return typeof s === "number" ? s : undefined;
};

/**
 * Is this the vendor's fault, and if so which kind?
 *
 * Pure and exported so the fallback rule is directly testable without a network
 * call or a live key.
 */
export const classifyClaudeError = (e: unknown): ProviderError | null => {
  if (e instanceof ProviderError) return e;
  const status = statusOf(e);
  const make = (reason: ProviderError["reason"], msg: string) =>
    new ProviderError("claude", reason, msg, e);

  // A missing or rejected key is a deployment problem, not a bad request. It
  // falls back, because the entire point of keeping Gemini around is that the
  // shop keeps working while Claude is being set up.
  if (status === 401 || status === 403) return make("missing_key", `Claude auth failed (${status})`);
  if (status === 408) return make("timeout", "Claude request timed out");
  if (status === 429) return make("rate_limited", "Claude rate limited");
  if (status === 529) return make("overloaded", "Claude overloaded");
  if (typeof status === "number" && status >= 500) return make("server_error", `Claude server error (${status})`);
  // 400 / 404 / 422 are OUR bug. Surface them.
  if (typeof status === "number") return null;

  // No status at all: a connection failure, an abort, or the SDK constructor
  // refusing to build without a key.
  if (e instanceof Anthropic.APIConnectionTimeoutError) return make("timeout", "Claude connection timed out");
  if (e instanceof Anthropic.APIConnectionError) return make("connection", "Could not reach Claude");
  const message = String((e as { message?: unknown })?.message ?? "");
  if (/api[_ ]?key/i.test(message)) return make("missing_key", "Claude API key is not configured");
  if (/timeout|ETIMEDOUT|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(message)) {
    return make("connection", `Could not reach Claude: ${message}`);
  }
  return null;
};

/** Run `fn`, rethrowing anything vendor-side as a ProviderError. */
const guarded = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    const classified = classifyClaudeError(e);
    if (classified) throw classified;
    throw e;
  }
};

const toContent = (turn: AiTurn): Anthropic.ContentBlockParam[] => {
  const blocks: Anthropic.ContentBlockParam[] = [];
  // The image goes FIRST: a picture followed by the question about it is the
  // order the model reads best, and it is the order the old Gemini call used.
  if (turn.image?.base64) {
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: turn.image.mediaType, data: turn.image.base64 },
    });
  }
  if (turn.text) blocks.push({ type: "text", text: turn.text });
  return blocks;
};

const toMessages = (turns: AiTurn[]): Anthropic.MessageParam[] =>
  turns
    .map(t => ({ role: t.role, content: toContent(t) }))
    .filter(m => m.content.length > 0);

/**
 * Server tools a task opted into.
 *
 * `{ kind: "webSearch" }` is the only one, and gpuPerformance is the only op
 * that sets it. This is the only place that needs to know what it means for
 * Claude.
 */
const toTools = (tools: ServerTool[] | undefined) =>
  (tools ?? []).map(t => ({
    type: "web_search_20260209" as const,
    name: "web_search" as const,
    ...(t.maxUses != null ? { max_uses: t.maxUses } : {}),
    ...(t.allowedDomains?.length ? { allowed_domains: t.allowedDomains } : {}),
  }));

export const createClaudeProvider = (apiKey: string): AiProvider => {
  // Built lazily inside each call so a missing key surfaces as a classified
  // ProviderError on the request that needed it, rather than at module load
  // where it would take down every op including the ones that don't use Claude.
  const client = () => {
    if (!apiKey) throw new ProviderError("claude", "missing_key", "ANTHROPIC_API_KEY is not set");
    return new Anthropic({ apiKey });
  };

  return {
    name: "claude",

    async runText(task: TextTask): Promise<string> {
      return guarded(async () => {
        const tools = toTools(task.tools);
        const response = await client().messages.create({
          model: modelFor("claude", task.tier),
          max_tokens: task.maxTokens,
          ...(task.system ? { system: task.system } : {}),
          messages: toMessages(task.turns),
          ...(tools.length ? { tools } : {}),
        });
        return response.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map(b => b.text)
          .join("")
          .trim();
      });
    },

    async runStructured(task: StructuredTask): Promise<unknown> {
      return guarded(async () => {
        const serverTools = toTools(task.tools);
        const response = await client().messages.create({
          model: modelFor("claude", task.tier),
          max_tokens: task.maxTokens,
          ...(task.system ? { system: task.system } : {}),
          messages: toMessages(task.turns),
          tools: [
            ...serverTools,
            {
              name: task.resultName,
              description: task.resultDescription,
              // The API validates the arguments against this schema before
              // returning them. The task still re-checks afterwards — see the
              // header, and listingPolicy/gpuPolicy for what a schema cannot say.
              strict: true,
              input_schema: task.schema as Anthropic.Tool.InputSchema,
            },
          ],
          // FORCING the extraction tool is right when it is the only tool: it
          // removes the "model wrote prose instead" failure entirely. It is
          // WRONG when a server tool is also on the table, because forcing the
          // answer leaves no turn in which to search — the model would answer
          // from recall, which is the one thing that op exists to avoid. So
          // with tools present the choice is auto, and a response that never
          // calls the extraction tool is treated as a failed request below.
          tool_choice: serverTools.length
            ? { type: "auto" }
            : { type: "tool", name: task.resultName },
        });
        const call = response.content.find(
          (b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === task.resultName,
        );
        // No tool call at all is a vendor-side failure of the request, not a
        // schema violation — there is nothing for the validator to look at.
        if (!call) {
          throw new ProviderError(
            "claude", "unknown",
            `Claude returned no ${task.resultName} call (stop_reason: ${response.stop_reason})`,
          );
        }
        return call.input;
      });
    },
  };
};
