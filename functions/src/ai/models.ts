import { ModelTier, ProviderName } from "./types";

/**
 * EVERY MODEL NAME IN THE CODEBASE, IN ONE OBJECT.
 *
 * Changing which model a task runs on is a one-line edit here. Nothing else in
 * functions/src names a model.
 *
 * The two tiers:
 *
 *   reasoning — insights and chat. These read the whole inventory and write
 *               analysis a human acts on; they get the capable model.
 *   fast      — bulkParse and imeiExtract. Both are extraction against a fixed
 *               schema with a validator behind them, which is exactly the shape
 *               a small fast model is good at, and both sit in a loop a person
 *               is waiting on. If Haiku is ever shown to mis-parse, change the
 *               one line below to the reasoning model's id — the validator will
 *               have been rejecting the bad output rather than passing it
 *               through, so the symptom will be visible before the fix is.
 */
export const MODELS: Record<ProviderName, Record<ModelTier, string>> = {
  claude: {
    reasoning: "claude-sonnet-5",
    fast: "claude-haiku-4-5-20251001",
  },
  gemini: {
    reasoning: "gemini-3-pro-preview",
    fast: "gemini-2.5-flash",
  },
};

export const modelFor = (provider: ProviderName, tier: ModelTier): string =>
  MODELS[provider][tier];

/**
 * Output ceilings, per tier.
 *
 * The extraction tasks return a handful of short strings and a bulk parse of a
 * long paste; the analysis tasks write a page of Markdown. Neither needs the
 * model's full output window, and a ceiling that is too low truncates an answer
 * mid-sentence, so these are generous rather than tight.
 */
export const MAX_TOKENS: Record<ModelTier, number> = {
  reasoning: 8000,
  fast: 4000,
};
