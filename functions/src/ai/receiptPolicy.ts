/**
 * READING A PHOTOGRAPHED RECEIPT — THE PROMPT, THE SCHEMA, AND THE CLAMP.
 *
 * A pure module, like showroomPolicy.ts and publicBuildPolicy.ts: no Firebase,
 * no provider SDK, so every rule below is exercisable without a live project.
 * The op itself is registered alongside the existing ones in tasks.ts — there
 * is no second AI path, no OCR library, and no new callable.
 *
 * TWO RULES DO ALL THE WORK HERE.
 *
 * 1. THE MODEL MUST NOT GUESS. A field it cannot read comes back absent, not
 *    approximated. An empty field the owner fills in is a minor annoyance; a
 *    confidently wrong total that reaches a draft is the failure the whole
 *    feature is designed around — the owner is archiving paper precisely
 *    because he does not want to re-derive it later from memory.
 *
 * 2. THE CATEGORY COMES FROM THE WORKSPACE'S OWN LIST. The allowed keys are
 *    put in the schema as an enum and the answer is clamped against the same
 *    list afterwards, because a model that returns "Office Supplies" for a
 *    shop whose categories are `supplies`/`rent`/`tools` has produced something
 *    the expense form cannot accept.
 *
 * Nothing in this file writes an Expense or can cause one to be written. It
 * returns suggestions that land on the receipt document as suggestions.
 */

import { JsonSchema } from "./types";

/** The shape handed back to the client. Every field optional, on purpose. */
export interface ReceiptParseResult {
  date?: string;
  total?: number;
  currency?: string;
  payee?: string;
  tax?: number;
  category?: string;
  text?: string;
}

/** A category the workspace actually has. Mirrors domain/expenses.ts. */
export interface CategoryOption {
  key: string;
  label: string;
  archived?: boolean;
}

export const MAX_RECEIPT_TEXT_CHARS = 2_000;

/** Live categories only — an archived one is valid on history, not on new rows. */
export const liveCategories = (categories: CategoryOption[]): CategoryOption[] =>
  (categories || []).filter(c => c && typeof c.key === "string" && c.key && !c.archived);

/**
 * The prompt.
 *
 * The "leave it out" instruction is repeated in three different wordings
 * because it is the one behaviour that matters most and models are reliably
 * tempted to be helpful about a smudged total.
 */
export const receiptPrompt = (categories: CategoryOption[], todayISO: string): string => {
  const list = liveCategories(categories);
  const catLines = list.length
    ? list.map(c => `  - ${c.key} (${c.label})`).join("\n")
    : "  (none configured — leave category out entirely)";
  return `Read this photograph of a receipt or invoice and record only what is
ACTUALLY LEGIBLE in the image.

DO NOT GUESS. For every field below, if you cannot read it in the image, OMIT
THE FIELD. An omitted field is correct and expected. An approximated,
inferred or "probable" value is WRONG and worse than nothing — a person will
rely on these figures months from now without the paper to check them against.
In particular:
  - Never calculate a total you cannot see printed. If the total line is
    cropped, blurred or missing, omit the total, even if the line items would
    add up to something.
  - Never infer the year from today's date. If the receipt shows only a day and
    month, omit the date.
  - Never convert a currency, and never assume one from the language or the
    country. Record the currency only if a symbol or code is actually shown.

Fields:
  date     — the date ON THE RECEIPT, as YYYY-MM-DD. Not today's date (today
             is ${todayISO}, given only so you can resolve an explicit
             two-digit year; it is NEVER the answer on its own).
  total    — the final amount paid, as a number, no currency symbol, no
             thousands separators. The grand total, not a subtotal or one line.
  currency — ISO 4217 (CAD, USD, EUR) only if shown or unambiguous from a
             printed symbol.
  payee    — the business that issued it, as printed at the top. The shop's own
             name is never the payee.
  tax      — total tax/VAT/GST/HST as a number, only if shown as its own line.
  category — the single best fit from THIS shop's categories, chosen from the
             keys below and nothing else. If none fits, omit it. Never invent a
             category name and never return a label in place of a key.
${catLines}
  text     — a short plain-text transcription of the legible lines (at most
             ${MAX_RECEIPT_TEXT_CHARS} characters), so the archive is
             searchable later. Transcribe, do not summarise or interpret.`;
};

/**
 * The structured-output schema, with the category enum built from the list.
 *
 * Typed as the router's JsonSchema so a malformed schema is a compile error
 * rather than a provider rejection at runtime. `enum` is not on that interface,
 * so the one property that needs it is widened at the point of use and nowhere
 * else — see the cast below.
 */
export const receiptSchema = (categories: CategoryOption[]): JsonSchema => {
  const keys = liveCategories(categories).map(c => c.key);
  return {
    type: "object",
    properties: {
      date: { type: "string", description: "YYYY-MM-DD as printed on the receipt. Omit if not legible." },
      total: { type: "number", description: "Grand total actually printed. Omit if not legible." },
      currency: { type: "string", description: "ISO 4217 code, only if shown." },
      payee: { type: "string", description: "Issuing business as printed." },
      tax: { type: "number", description: "Tax total, only if shown on its own line." },
      // The enum is the first of the two category gates. A provider that
      // honours it cannot return anything else; clampCategory below covers the
      // one that does not.
      // `enum` is a real JSON Schema keyword the providers honour but which
      // JsonSchema does not model, so this one property is widened here.
      ...(keys.length
        ? { category: { type: "string", enum: keys, description: "One of this shop's category keys, or omit." } as unknown as JsonSchema }
        : {}),
      text: { type: "string", description: `Plain transcription, max ${MAX_RECEIPT_TEXT_CHARS} chars.` },
    },
    // DELIBERATELY EMPTY. Requiring any field would push the model to invent
    // one, which is the single thing this must not do.
    required: [],
  };
};

/* ---------------- Validation ---------------- */

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : undefined;
};

/**
 * A money figure, or nothing.
 *
 * Rejects negatives and zero: a receipt total of 0 is not a reading, it is a
 * model filling in a blank, and a negative is a refund shape this does not
 * handle. Also rejects absurd magnitudes, which are almost always a misread
 * decimal separator.
 */
export const money = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/[^0-9.-]/g, "")) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 1_000_000) return undefined;
  return Math.round(n * 100) / 100;
};

/** A real calendar date in YYYY-MM-DD, or nothing. No coercion, no today. */
export const isoDate = (v: unknown): string | undefined => {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  // Rejects 2026-02-31, which passes the regex.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return undefined;
  // A receipt from before the first pocket calculator is a misread year.
  if (y < 2000 || y > 2100) return undefined;
  return s;
};

export const currencyCode = (v: unknown): string | undefined => {
  const s = (str(v) || "").toUpperCase();
  return /^[A-Z]{3}$/.test(s) ? s : undefined;
};

/**
 * The category clamp — the second gate, run on the answer whatever the
 * provider did with the enum.
 *
 * Mirrors domain/receipt.ts's clampCategory. Both exist because the client and
 * the functions are separate TypeScript projects (the pattern documented in
 * showroomPolicy.ts); this copy is the one that decides what leaves the server.
 */
export const clampCategory = (v: unknown, categories: CategoryOption[]): string | undefined => {
  const key = str(v);
  if (!key) return undefined;
  const live = liveCategories(categories);
  const exact = live.find(c => c.key === key);
  if (exact) return exact.key;
  const byLabel = live.find(c => (c.label || "").toLowerCase() === key.toLowerCase());
  return byLabel ? byLabel.key : undefined;
};

/**
 * Validate the model's raw object into suggestions.
 *
 * EVERY unreadable or implausible field is DROPPED rather than defaulted. The
 * result may legitimately be `{}` — an entirely unreadable photo is still a
 * filed, viewable, searchable receipt, and saying "I could not read this" is
 * the honest outcome.
 */
export const validateReceiptParse = (
  raw: unknown,
  categories: CategoryOption[],
): ReceiptParseResult => {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: ReceiptParseResult = {};

  const date = isoDate(o.date);
  if (date) out.date = date;
  const total = money(o.total);
  if (total != null) out.total = total;
  const currency = currencyCode(o.currency);
  if (currency) out.currency = currency;
  const payee = str(o.payee);
  if (payee) out.payee = payee.slice(0, 120);
  const tax = money(o.tax);
  // Tax larger than the total is a misread, and keeping it would put a wrong
  // figure in front of somebody as though it had been read off the paper.
  if (tax != null && (out.total == null || tax <= out.total)) out.tax = tax;
  const category = clampCategory(o.category, categories);
  if (category) out.category = category;
  const text = str(o.text);
  if (text) out.text = text.slice(0, MAX_RECEIPT_TEXT_CHARS);

  return out;
};

/** Did the parse find anything usable at all? Drives the "could not read" note. */
export const parseIsEmpty = (r: ReceiptParseResult): boolean =>
  r.date == null && r.total == null && r.payee == null && r.category == null && !r.text;
