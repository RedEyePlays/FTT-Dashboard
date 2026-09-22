import {
  AiProvider, ProviderError, ProviderName, StructuredTask, TextTask, ValidationError,
} from "./types";

/**
 * WHICH PROVIDER ANSWERS, AND WHAT HAPPENS WHEN ONE DOESN'T.
 *
 * Claude is the primary. Gemini stays wired up as a fallback while Claude beds
 * in, because the alternative — cutting over with no safety net — means the
 * first Anthropic incident takes the shop's AI features down with no way back
 * that doesn't involve a deploy.
 *
 * THE FALLBACK RULE, and it is narrow on purpose:
 *
 *   FALLS BACK — the provider never produced a usable answer: no key, a
 *     timeout, a 5xx, an overload, a rate limit, a dropped connection. Retrying
 *     the identical request elsewhere is exactly the right move.
 *
 *   DOES NOT FALL BACK — a validation failure (the model answered, the answer
 *     was the wrong shape) or a permission refusal. Both mean the system worked
 *     and something else is wrong. Bouncing them to Gemini would either produce
 *     the same bad answer more slowly or paper over an access bug that somebody
 *     needs to see. Permission checks run in index.ts BEFORE any provider is
 *     called, so they cannot reach this file at all.
 *
 * ONCE. A failing call retries on the other provider exactly one time. There is
 * no chain and no loop: if both are down, the caller gets an error rather than
 * a slow one.
 *
 * TO REMOVE THE FALLBACK LATER: set AI_FALLBACK to "off" (one flag). The Gemini
 * adapter can then be deleted along with this file's `fallback` field.
 */

export interface AiCallLog {
  op: string;
  provider: ProviderName;
  fellBack: boolean;
  ms: number;
  ok: boolean;
  /** Why the primary failed, when it did. Never a message from the model. */
  failure?: string;
}

export interface RouterOptions {
  primary: AiProvider;
  /** Omit (or pass undefined) to disable falling back entirely. */
  fallback?: AiProvider;
  /**
   * Structured log line per call. No user data, no inventory contents, no model
   * output — just which provider answered, whether it fell back, and how long
   * it took. Injected so tests can assert on it.
   */
  log?: (entry: AiCallLog) => void;
}

const defaultLog = (entry: AiCallLog): void => {
  // firebase-functions' logger emits JSON that Cloud Logging indexes; a plain
  // console.log with an object does the same thing without pulling the logger
  // into a module that is otherwise free of Firebase imports and therefore
  // testable with plain `node --test`.
  console.log(JSON.stringify({ msg: "ai_call", ...entry }));
};

export class AiRouter {
  private readonly log: (entry: AiCallLog) => void;

  constructor(private readonly opts: RouterOptions) {
    this.log = opts.log ?? defaultLog;
  }

  /** The provider that will be tried first. */
  get primaryName(): ProviderName {
    return this.opts.primary.name;
  }

  runText(op: string, task: TextTask): Promise<string> {
    return this.run(op, p => p.runText(task));
  }

  runStructured(op: string, task: StructuredTask): Promise<unknown> {
    return this.run(op, p => p.runStructured(task));
  }

  private async run<T>(op: string, call: (p: AiProvider) => Promise<T>): Promise<T> {
    const { primary, fallback } = this.opts;
    const startedAt = Date.now();
    try {
      const result = await call(primary);
      this.log({ op, provider: primary.name, fellBack: false, ms: Date.now() - startedAt, ok: true });
      return result;
    } catch (e) {
      // A validation failure is the caller's to handle and never falls back.
      // It cannot normally arrive here (validation happens after the provider
      // returns), but the guard is explicit so a future caller that validates
      // inside its own call cannot accidentally get a second vendor's attempt.
      if (e instanceof ValidationError) throw e;
      if (!(e instanceof ProviderError)) {
        this.log({
          op, provider: primary.name, fellBack: false, ms: Date.now() - startedAt,
          ok: false, failure: "not_provider_error",
        });
        throw e;
      }
      this.log({
        op, provider: primary.name, fellBack: false, ms: Date.now() - startedAt,
        ok: false, failure: e.reason,
      });
      if (!fallback) throw e;

      const fellBackAt = Date.now();
      try {
        const result = await call(fallback);
        this.log({ op, provider: fallback.name, fellBack: true, ms: Date.now() - fellBackAt, ok: true });
        return result;
      } catch (second) {
        this.log({
          op, provider: fallback.name, fellBack: true, ms: Date.now() - fellBackAt, ok: false,
          failure: second instanceof ProviderError ? second.reason : "unknown",
        });
        // Both are down. The PRIMARY's error is the one that gets thrown: it is
        // the provider the shop is meant to be on, so it is the one worth
        // reading in the logs.
        throw e;
      }
    }
  }
}

/* ---------------- Configuration ---------------- */

export type FallbackSetting = "on" | "off";

/**
 * Provider selection from config, defaulting to Claude.
 *
 * An unrecognised value falls back to the default rather than throwing — a
 * typo'd env var must not take the AI features down, and the log line says
 * which provider actually answered anyway.
 */
export const providerFromConfig = (value: string | undefined): ProviderName =>
  value?.trim().toLowerCase() === "gemini" ? "gemini" : "claude";

export const fallbackFromConfig = (value: string | undefined): FallbackSetting =>
  value?.trim().toLowerCase() === "off" ? "off" : "on";
