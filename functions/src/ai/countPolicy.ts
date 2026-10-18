/**
 * SHOP SHORTHAND, AND QUESTIONS THAT WANT A NUMBER.
 *
 * Two things the assistant could not do, both exposed by one question —
 * "how many 15pm in stock":
 *
 *   1. "15pm" appears nowhere in the data. Stock reads "iPhone 15 Pro Max",
 *      and matchesWords needs every word of the question to appear in the
 *      row's searchable text, so nothing matched at all.
 *   2. Even with the right words it could not COUNT. The word search reads the
 *      newest LOOKUP_LIMIT rows and keeps MAX_RECORDS_PER_KIND of them; with
 *      162 devices in stock that is a slice. It can list examples. It can
 *      never say how many.
 *
 * The caps are not the bug — they are why per-message cost stopped scaling
 * with the shop, and they stay exactly where they are. The fix is to count
 * WITHOUT READING DOCUMENTS, the way businessSummary already does, and to
 * teach the question parser the owner's own words first.
 *
 * Pure: no Firestore, no model. context.ts runs the aggregations.
 */

/**
 * A date range, declared here rather than imported from retrievalPolicy.
 *
 * retrievalPolicy imports THIS module (for expandAliases and wantsCount), so
 * importing back would make a cycle. Structurally identical to its DateRange
 * on purpose, and a test asserts the two stay assignable.
 */
export interface CountDateRange {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
}

/* ---------------- Shop shorthand ---------------- */

/**
 * One of the owner's own terms, and what it means.
 *
 * STORED IN SETTINGS, not here. These are his words and they change with every
 * phone generation — hardcoding them would mean a code change each September.
 * The seeds below are a starting point, not the list.
 */
export interface ModelAlias {
  /** What he types: "15pm". Matched as a whole token, case-insensitively. */
  alias: string;
  /** What it means: "iPhone 15 Pro Max". */
  model: string;
}

/**
 * A handful of obvious ones, so the feature works the day it ships. The point
 * is that the owner adds his own.
 */
export const SEED_MODEL_ALIASES: ModelAlias[] = [
  { alias: "15pm", model: "iPhone 15 Pro Max" },
  { alias: "15p", model: "iPhone 15 Pro" },
  { alias: "14pm", model: "iPhone 14 Pro Max" },
  { alias: "14p", model: "iPhone 14 Pro" },
  { alias: "13pm", model: "iPhone 13 Pro Max" },
  { alias: "s24u", model: "Galaxy S24 Ultra" },
  { alias: "s23u", model: "Galaxy S23 Ultra" },
  { alias: "s24", model: "Galaxy S24" },
  { alias: "fold5", model: "Galaxy Z Fold 5" },
  { alias: "flip5", model: "Galaxy Z Flip 5" },
];

export const cleanAliases = (raw: unknown): ModelAlias[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ModelAlias[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const alias = (typeof e.alias === "string" ? e.alias : "").trim().toLowerCase();
    const model = (typeof e.model === "string" ? e.model : "").trim();
    // An alias shorter than two characters would match half the shop; an
    // alias with no model behind it means nothing.
    if (alias.length < 2 || !model || seen.has(alias)) continue;
    seen.add(alias);
    out.push({ alias, model });
  }
  return out;
};

/**
 * COULD THIS TOKEN BE A CLOCK TIME SOMEBODY MEANT LITERALLY?
 *
 * The one way an alias could change the meaning of a question that already
 * worked. "15pm" is safe — no clock reads 15pm — but an owner may well add
 * "5pm" or "11p" for some handset, and "we closed at 5pm" must not become a
 * question about a phone.
 *
 * So an alias that LOOKS like a time (1–12, optional minutes, am/pm) is not
 * expanded when it sits right after a word that introduces a time. Anything
 * that cannot be a clock reading is expanded normally.
 */
const CLOCK_SHAPED = /^(1[0-2]|[1-9])(:[0-5]\d)?\s?[ap]m?$/;
const TIME_LEAD_IN = /\b(at|by|around|until|till|til|before|after|from|since|past)\s*$/i;

export const looksLikeClockTime = (alias: string, text: string): boolean => {
  if (!CLOCK_SHAPED.test(alias.trim())) return false;
  const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  const at = re.exec(text);
  if (!at) return false;
  return TIME_LEAD_IN.test(text.slice(0, at.index));
};

/**
 * Which model names a question refers to by shorthand.
 *
 * THE EXPANSION IS ADDITIVE AND NEVER SUBSTITUTIVE. This returns model names
 * as a SEPARATE result; it does not rewrite the question's words. That is what
 * makes it impossible for an alias to break a question that already worked:
 * the existing all-words match is untouched and still runs on the original
 * words, and the alias only adds a second way for a row to match. Nothing is
 * removed, reworded or reinterpreted.
 *
 * Matched on whole tokens, so "3pm" never matches an alias of "15pm" and an
 * alias of "s24" never fires inside "s24u".
 */
export const expandAliases = (text: string, aliases: ModelAlias[]): string[] => {
  const t = (text || "").toLowerCase();
  const out: string[] = [];
  for (const { alias, model } of cleanAliases(aliases)) {
    const re = new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
    if (!re.test(t)) continue;
    if (looksLikeClockTime(alias, t)) continue;
    if (!out.includes(model)) out.push(model);
  }
  return out;
};

/* ---------------- Questions that want a number ---------------- */

/**
 * Is this a question about HOW MANY, rather than about which ones?
 *
 * Deliberately narrow. A question that merely mentions stock is answered the
 * way it always was; this only fires on a phrasing that wants a total, because
 * a count is a different answer from a list and giving the wrong one of the
 * two is how the original reply came to be useless.
 */
const COUNT_PHRASES = /\b(how\s+many|how\s+much\s+stock|count\s+of|number\s+of|do\s+we\s+have\s+any|have\s+we\s+got\s+any|any\s+left|how\s+many\s+left|stock\s+count)\b/i;

export const wantsCount = (text: string): boolean => COUNT_PHRASES.test(text || "");

/** Which side of the ledger the count is about. */
export type CountKind = "inStock" | "sold";

/**
 * "how many did we SELL" is a sold count; everything else is a stock count.
 *
 * A date range in the question implies sold too — "how many 15 Pro Max in
 * March" cannot be a question about what is on the shelf today.
 */
export const countKindFor = (text: string, hasRange: boolean): CountKind => {
  if (/\b(sold|sell|sales|shifted|moved|went)\b/i.test(text || "")) return "sold";
  return hasRange ? "sold" : "inStock";
};

export interface CountRequest {
  /** The model name as the owner would recognise it, for the answer line. */
  model: string;
  /** The normalised key the aggregation matches on. */
  key: string;
  kind: CountKind;
  range?: CountDateRange;
}

export interface CountResult extends CountRequest {
  count: number;
}

/**
 * How many rows are not yet keyed, and therefore not counted.
 *
 * THE WHOLE REASON THIS IS REPORTED. A count over a stored key silently omits
 * any row written before the key existed, and an undercount presented as a
 * total is worse than a refusal — the owner would act on it. So the count
 * carries this number, and `renderCounts` says so in words whenever it is not
 * zero.
 */
export interface CountCoverage {
  /** Devices with no modelKey, so invisible to the aggregation. */
  unkeyed: number;
  /** Total devices, for context in the note. */
  total: number;
}

/**
 * WHICH FILTERS A COUNT APPLIES, decided here rather than inside the Firestore
 * call.
 *
 * Extracted so the branch that distinguishes "in stock" from "sold" from
 * "sold in a range" is testable without a live project — it is the part most
 * likely to be quietly wrong, and a count answering the wrong question is
 * worse than no count. context.ts applies these to the query and nothing else.
 *
 * `soldDate` is '' on an unsold row, so "has been sold" is expressed as a
 * range with a floor below any real date — a presence test is not something
 * Firestore can index, but that range is.
 */
export interface CountFilter {
  field: string;
  op: "==" | ">=" | "<=";
  value: string;
}

export const SOLD_DATE_FLOOR = "1900-01-01";

export const countFilters = (req: CountRequest): CountFilter[] => {
  const base: CountFilter[] = [{ field: "modelKey", op: "==", value: req.key }];
  if (req.kind === "inStock") {
    // The same predicate businessSummary uses for the headline figure, so the
    // two can never disagree about what "in stock" means.
    return [...base, { field: "deviceStatus", op: "==", value: "ready" }];
  }
  if (req.range) {
    return [
      ...base,
      { field: "soldDate", op: ">=", value: req.range.from },
      { field: "soldDate", op: "<=", value: req.range.to },
    ];
  }
  return [...base, { field: "soldDate", op: ">=", value: SOLD_DATE_FLOOR }];
};

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/**
 * The counts, as lines for the context block.
 *
 * ZERO IS AN ANSWER. "No iPhone 15 Pro Max in stock" is a fact the owner can
 * act on; "I don't have records" is not, and was the original complaint.
 */
export const renderCounts = (
  results: CountResult[],
  coverage: CountCoverage,
): string => {
  if (results.length === 0) return "";
  const lines = results.map((r) => {
    const where = r.kind === "inStock"
      ? "in stock now"
      : r.range
        ? `sold between ${r.range.from} and ${r.range.to}`
        : "sold, all time";
    return r.count === 0
      ? `  ${r.model}: NONE ${where}. That is a definite zero, counted — not a gap in the records.`
      : `  ${r.model}: ${r.count} ${plural(r.count, "device", "devices")} ${where}.`;
  });

  if (coverage.unkeyed > 0) {
    lines.push(
      `  NOTE: ${coverage.unkeyed} of ${coverage.total} devices have not been indexed for counting yet,`
      + " so these figures may be short by up to that many. Say so when you give the number."
      + " An owner can fix it from Settings → Operations (Re-index stock for counting).",
    );
  }
  return lines.join("\n");
};

/**
 * THE COUNTS ARE EXACT, AND THE MODEL MUST BE TOLD THAT.
 *
 * Left to itself a model hedges a number it was handed ("around 7", "at least
 * 7"), because most of the context it ever sees is a capped sample. These
 * figures are not a sample — they come from an aggregation over the whole
 * collection — and a hedged exact count is a worse answer than no count.
 */
export const COUNT_PREAMBLE =
  "EXACT COUNTS, from a full aggregation over the whole collection — NOT a sample,"
  + " and not subject to the record limits that apply to the device records below."
  + " State these numbers plainly and do not hedge them, qualify them as approximate,"
  + " or recount them from the records listed further down.";

/* ---------------- Saying what could not be answered ---------------- */

/**
 * The part of a question that was refused, named.
 *
 * The old refusal was all-or-nothing: "how many 15 Pro Max did we sell last
 * month and what's the margin", asked by somebody without Financials, got
 * nothing at all. The count is not a money figure and was always answerable.
 *
 * THIS REPORTS THE GAP; IT DOES NOT WIDEN IT. The viewer flags still decide
 * what may be shown, and every money and payroll field is stripped exactly as
 * before — this only makes the assistant say which half it withheld instead of
 * dropping the whole question.
 */
export interface WithheldPart {
  /** What was asked for, in the owner's terms. */
  asked: "money" | "payroll";
  /** Why it is not here. */
  reason: string;
}

export const withheldFor = (
  plan: { asksMoney: boolean; asksPayroll: boolean },
  viewer: { canSeeMoney: boolean; canSeePayroll: boolean },
): WithheldPart[] => {
  const out: WithheldPart[] = [];
  if (plan.asksMoney && !viewer.canSeeMoney) {
    out.push({
      asked: "money",
      reason: "cost, margin and profit figures are not visible to this account",
    });
  }
  if (plan.asksPayroll && !viewer.canSeePayroll) {
    out.push({
      asked: "payroll",
      reason: "wages, hours and payroll figures are not visible to this account",
    });
  }
  return out;
};

/**
 * The instruction that turns a blanket refusal into a partial answer.
 *
 * Phrased as "answer the rest" rather than "refuse", because the failure being
 * fixed is a model that saw one gated word and gave up on the whole question.
 */
export const renderWithheld = (parts: WithheldPart[]): string => {
  if (parts.length === 0) return "";
  const lines = parts.map((p) => `  - ${p.reason}`);
  return [
    "WHAT THIS ACCOUNT MAY NOT BE TOLD",
    ...lines,
    "  ANSWER EVERY OTHER PART OF THE QUESTION NORMALLY, then say plainly which",
    "  part you are not able to give and that it is a permissions matter, not a",
    "  missing record. Do not refuse the whole question, and do not estimate,",
    "  derive or imply the withheld figure from anything else you were given.",
  ].join("\n");
};
