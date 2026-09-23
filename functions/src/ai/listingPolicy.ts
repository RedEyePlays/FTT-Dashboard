import { JsonSchema, ValidationError } from "./types";

/**
 * THE LISTING OP — THE PROMPT, AND THE CHECK ON WHAT COMES BACK.
 *
 * A pure module: no Firebase, no provider, no network. tasks.ts calls the
 * router and hands the answer here, so every rule below can be exercised with
 * plain `node --test`.
 *
 * THE FACTS SHAPE MIRRORS domain/listingCopy.ts, which is where it is built (field
 * by field, from an allow-list) on the client. The mirroring is deliberate and
 * is the same arrangement as showroomPolicy.ts: functions/ and the app are
 * separate TypeScript projects, so the alternative to two definitions is a
 * shared package nothing else needs.
 *
 * NOTHING HERE TRUSTS THE CLIENT'S FACTS TO BE COMPLETE. What it does rely on
 * is that a number in the output must appear in the facts — and since the
 * facts are what the caller sent, a caller who sends more gets more allowed.
 * That is correct: it is their own shop's data either way, and the check
 * exists to stop the MODEL inventing, not to police the caller.
 */

export interface ListingRequest {
  facts: Record<string, unknown>;
  platform?: string;
  length?: string;
  markUsedParts?: boolean;
}

export interface ListingResult {
  title: string;
  description: string;
}

export const LISTING_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description:
        "The listing title. A device reads model-first, e.g. 'iPhone 13 Pro 256GB — Graphite'. " +
        "A PC build leads with the build's own name then the headline parts, GPU first, " +
        "e.g. 'REAPER Gaming PC — RTX 5060 Ti / Ryzen 9 5900X / 32GB / 1TB'. " +
        "No filler adjectives, no exclamation marks, no all-caps except a build name that is already written that way.",
    },
    description: {
      type: "string",
      description:
        "The listing body. Short prose first, then for a PC build a spec LIST, one component per line.",
    },
  },
  required: ["title", "description"],
  additionalProperties: false,
};

const PLATFORM_TONE: Record<string, string> = {
  facebook:
    "Facebook Marketplace. Plain, friendly and direct — the way a person writes, not a brochure. " +
    "Short paragraphs. Links in a description are NOT clickable there, so any link must read as " +
    "plain text somebody can type.",
  kijiji:
    "Kijiji. Slightly more formal and more complete than Marketplace; buyers there read the whole ad.",
  ebay:
    "eBay. Factual and specification-led. No local-pickup assumptions, and no invented shipping or " +
    "returns terms — say nothing about either unless it is in the facts.",
  generic: "A general classified listing. Neutral and factual.",
};

const LENGTH_RULE: Record<string, string> = {
  short: "Keep the description to about 40-70 words, plus the spec list if there is one.",
  standard: "Keep the description to about 90-150 words, plus the spec list if there is one.",
};

/** The part categories a build's spec list uses, in the order a buyer reads. */
export const SPEC_ORDER = [
  "CPU", "GPU", "Motherboard", "RAM", "Storage", "PSU", "Case", "Cooler", "OS",
];

/**
 * THE SYSTEM PROMPT.
 *
 * Every restriction here is also enforced after the fact (see checkOutput) or
 * is structurally impossible because the facts do not contain the data. The
 * prompt is how you get a good answer; the checks are how you know.
 */
export const listingSystemPrompt = (req: ListingRequest): string => {
  const allNew = req.facts.allPartsNew === true || req.facts.condition === "Brand new, sealed";
  return [
    "You write classified listings for a phone and computer shop. You are given FACTS about one item.",
    "",
    "ABSOLUTE RULES:",
    "1. Use ONLY the facts given. Do not add, upgrade, infer or estimate anything.",
    "2. Never state a specification that is not in the facts — no storage size, no RAM amount, no " +
      "battery percentage, no screen size, no generation, no year.",
    "3. Never describe condition in words that were not given. If the facts say 'Good — light " +
      "scratches', do not write 'mint', 'flawless', 'immaculate' or 'like new'.",
    "4. Never claim anything about history or testing that is not in the facts: not 'one owner', " +
      "not 'never dropped', not 'fully tested', not 'battery replaced'.",
    allNew
      ? "5. Every part is recorded as new, so you may say so."
      : "5. This item is NOT new. The words 'brand new', 'sealed', 'unopened' and 'new in box' are " +
        "FORBIDDEN anywhere in the title or description. If you want to say something positive about " +
        "how it was put together, write 'Custom built and tested in-shop.' and nothing stronger.",
    "6. Never mention what the shop paid, its margin, where the item came from, who sold it, any " +
      "customer, any staff member, an IMEI, a serial number or an internal reference.",
    "7. If a fact is missing, leave it out. Do not guess at it and do not draw attention to it.",
    "",
    "STYLE:",
    PLATFORM_TONE[req.platform || "generic"] || PLATFORM_TONE.generic,
    LENGTH_RULE[req.length === "short" ? "short" : "standard"],
    "No emoji. No exclamation marks. No 'DM me'. Do not invent a phone number, an address or hours.",
    "",
    "IF THE ITEM IS A PC BUILD:",
    `• The description must contain a spec LIST, one component per line, in this order where present: ${SPEC_ORDER.join(", ")}.`,
    "• Use the exact model name as given for each part. Do not shorten, expand or 'correct' it.",
    req.markUsedParts
      ? "• Where a part's facts include a condition, put it after the model name in brackets."
      : "• The parts carry no condition markers in this listing. Do NOT add any, and do NOT describe " +
        "the parts as new — simply name them.",
    "• Keep the prose above the list short. The list carries the detail.",
    "",
    ...(Array.isArray(req.facts.performance) && req.facts.performance.length > 0
      ? [
        "PERFORMANCE (PC builds only, and only from the figures in the facts):",
        "• Add a short 'Expected performance' block before the ending lines.",
        "• One line per game, in the form: Game — resolution, preset: low-high fps.",
        "• Use the exact fpsLow and fpsHigh given. NEVER average them, never round them to a single",
        "  number, and never add a game that is not in the facts.",
        "• Where a row is marked measured, say 'tested in-shop' on that line. Do not say it on any other.",
        "• End the block with exactly: 'Estimates based on published benchmarks; actual performance varies with settings and game updates.'",
        "",
      ]
      : []),
    "ENDING (always, in this order, as the last lines):",
    "• the warranty line, when warrantyDays is greater than zero;",
    "• the share line exactly as given in the facts, when one is present. Reproduce it character for character.",
  ].join("\n");
};

export const listingUserPrompt = (req: ListingRequest): string =>
  `FACTS (JSON):\n${JSON.stringify(req.facts)}\n\nWrite the listing.`;

/* ---------------- Checking what came back ---------------- */

export const numbersIn = (text: string): string[] =>
  (text.match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(/,/g, ""));

export const NEW_CLAIM_WORDS = [
  "brand new", "brand-new", "sealed", "unopened", "new in box", "nib", "bnib",
];

export interface OutputCheck {
  ok: boolean;
  invented: string[];
  impliedNew?: string;
  /** One sentence for the retry, naming what was wrong. */
  reason?: string;
}

/**
 * THE SAME TWO CHECKS AS THE CLIENT'S, RUN WHERE THE RETRY IS.
 *
 * Doing it here means a bad answer costs one extra call and the user never
 * sees it; doing it only on the client would mean a visible failure and a
 * round trip to try again.
 */
export const checkOutput = (
  facts: Record<string, unknown>,
  out: ListingResult,
): OutputCheck => {
  const text = `${out.title}\n${out.description}`;
  const allowed = new Set(numbersIn(JSON.stringify(facts)));
  const invented = numbersIn(text).filter((n) => {
    if (allowed.has(n)) return false;
    const value = parseFloat(n);
    if (Number.isInteger(value) && value >= 1 && value <= 12) return false;      // list numbering
    if (Number.isInteger(value) && value >= 1990 && value <= 2100) return false; // a year
    return true;
  });

  const check: OutputCheck = { ok: invented.length === 0, invented };
  if (invented.length > 0) {
    check.reason = `The previous attempt contained numbers that are not in the facts: ${invented.join(", ")}. Use only numbers that appear in the facts.`;
  }

  const allNew = facts.allPartsNew === true || facts.condition === "Brand new, sealed";
  if (!allNew) {
    const lower = text.toLowerCase();
    const hit = NEW_CLAIM_WORDS.find((w) =>
      new RegExp(`\\b${w.replace(/[-\s]/g, "[-\\s]")}\\b`).test(lower));
    if (hit) {
      check.impliedNew = hit;
      check.ok = false;
      check.reason = `The previous attempt said "${hit}". This item is not new — remove any claim that it is.`;
    }
  }
  return check;
};

/** A result object from the model, or a ValidationError. */
export const parseListing = (raw: unknown): ListingResult => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("listing", "Model did not return an object.");
  }
  const r = raw as Record<string, unknown>;
  const title = typeof r.title === "string" ? r.title.trim() : "";
  const description = typeof r.description === "string" ? r.description.trim() : "";
  if (!title || !description) {
    throw new ValidationError("listing", "Model returned an empty title or description.");
  }
  return { title, description };
};
