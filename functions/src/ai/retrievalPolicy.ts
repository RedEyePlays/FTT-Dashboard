/**
 * WHAT THE ASSISTANT IS ALLOWED TO LOOK AT, AND WHAT IT COSTS.
 *
 * THE BUG THIS REPLACES, in one line of the old runChat:
 *
 *     FULL INVENTORY DATA (JSON): ${JSON.stringify(inventory)}
 *
 * Every message sent the entire inventory. It grew with the shop, it was
 * resent on every turn of every conversation, and almost none of it had
 * anything to do with the question. It was also why "what happened to
 * PHN-000123" could not be answered properly: the model had the inventory row
 * and NOTHING else — no repairs, no sale, no drop-off, no audit trail.
 *
 * So the model is no longer handed the shop. A RETRIEVAL step runs server-side
 * first: a small always-on business summary, plus the specific records the
 * question actually refers to, rendered as a compact TIMELINE rather than raw
 * documents. A timeline costs a fraction of the JSON and answers better,
 * because "sold 12 Sep for $850, warranty claim 3 Oct, refunded" is the answer
 * — the documents are just where it is written down.
 *
 * This module is the PURE half: what a question refers to, what the caps are,
 * what a record is allowed to say to this particular caller, and how the
 * timeline reads. context.ts does the fetching. Everything here runs under
 * plain `node --test`.
 */

/* ---------------- The caps ---------------- */

/**
 * Hard limits, as constants, because "it grew with the shop" is the failure
 * being fixed and an uncapped retrieval is the same bug wearing a better hat.
 *
 * MAX_RECORDS is per KIND, not overall: a device with nine repairs and four
 * audit entries is one story and should be told whole, but a question that
 * happens to match two hundred devices must not paste two hundred rows in.
 */
export const MAX_RECORDS_PER_KIND = 12;
/** Everything retrieved, rendered, must fit in this. Truncated at a line. */
export const MAX_CONTEXT_CHARS = 12_000;
/** How many previous turns are replayed verbatim. Older ones are summarised. */
export const MAX_HISTORY_TURNS = 12;
/** A single turn longer than this is cut — a pasted logfile is not a question. */
export const MAX_TURN_CHARS = 4_000;

/* ---------------- Reading the question ---------------- */

/** Normalise a code the way the app's own scanner does (domain/identifierSearch.ts). */
export const normalizeForLookup = (raw: unknown): string =>
  (typeof raw === "string" ? raw : "").replace(/[^a-z0-9]/gi, "").toUpperCase();

export interface DateRange {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
}

export interface QuestionPlan {
  /** SKUs, IMEIs, serials, barcodes — anything that looks like an exact code. */
  identifiers: string[];
  /** Repair ticket numbers, which are identifiers with their own collection. */
  repairNumbers: string[];
  /** The words to match a device on, the way inventory search does. */
  words: string[];
  /** Explicitly named date range, when the question carries one. */
  range?: DateRange;
  /**
   * Is this question ABOUT a particular customer by name? Only then may their
   * phone, email or address be retrieved — see redactCustomer.
   */
  customerQuery?: string;
  /** Does the question ask about money the shop paid or made? */
  asksMoney: boolean;
  /** Does it ask about wages, hours or payroll? */
  asksPayroll: boolean;
  /** Nothing specific was named — answer from the summary alone. */
  broad: boolean;
}

/** Words that are never worth searching stock on. */
const STOP_WORDS = new Set([
  "what", "whats", "what's", "when", "where", "who", "why", "how", "did", "do", "does",
  "is", "are", "was", "were", "the", "a", "an", "of", "to", "for", "in", "on", "at",
  "with", "and", "or", "it", "this", "that", "we", "i", "my", "our", "you", "me",
  "happened", "happen", "tell", "show", "give", "about", "please", "can", "could",
  "much", "many", "have", "has", "had", "been", "get", "got", "there", "any", "all",
  "sold", "sell", "buy", "bought", "paid", "cost", "costs", "price", "profit", "margin",
  // Generic business words. A question made only of these is a question about
  // the shop, not about a device — it is answered from the summary, and
  // searching stock for "doing" would retrieve whatever happened to be newest.
  "doing", "going", "looking", "business", "shop", "store", "today", "yesterday",
  "week", "month", "year", "stock", "inventory", "sales", "summary", "overview",
  "total", "totals", "performance", "numbers", "figures", "made", "making",
]);

const MONEY_WORDS = /\b(cost|costs|pay|pays|paying|paid|profit|margin|markup|made|makes|revenue|spend|spent|expense|expenses|takings|cash)\b/i;
const PAYROLL_WORDS = /\b(payroll|wage|wages|salary|salaries|hours|shift|shifts|timesheet|clock(ed)?\s?(in|out)|bonus|pay\s?period|paid\s?breaks?)\b/i;
const CUSTOMER_WORDS = /\b(customer|client|buyer|seller|contact|phone number|email|address)\b/i;

/** "RPR-000123" / "RPR000123". */
const REPAIR_NUMBER = /\brpr[-\s]?\d{3,}\b/gi;
/** "PHN-000123", "LAP-000012", "FTT-0000777" — the app's SKU shapes. */
const SKU_LIKE = /\b[a-z]{3}[-\s]?\d{4,}\b/gi;
/** A 14–17 digit run is an IMEI; 8+ alphanumerics with a digit is a serial. */
const IMEI_LIKE = /\b\d[\d\s-]{12,20}\d\b/g;
const SERIAL_LIKE = /\b(?=[a-z0-9-]*\d)(?=[a-z0-9-]*[a-z])[a-z0-9]{8,20}\b/gi;

const ISO_DATE = /\b(\d{4}-\d{2}-\d{2})\b/g;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const pad = (n: number): string => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number): string => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/**
 * A date range named in the question, or nothing.
 *
 * Deliberately small: two ISO dates, "today", "yesterday", "this/last week",
 * "this/last month", "this year", and a bare month name. Anything cleverer
 * would be guessing at what somebody meant, and a wrong range quietly answers
 * a different question than the one asked.
 */
export const parseDateRange = (text: string, todayISO: string): DateRange | undefined => {
  const t = text.toLowerCase();
  const isoHits = [...text.matchAll(ISO_DATE)].map((m) => m[1]);
  if (isoHits.length >= 2) {
    const [a, b] = [isoHits[0], isoHits[1]].sort();
    return { from: a, to: b };
  }
  if (isoHits.length === 1) return { from: isoHits[0], to: isoHits[0] };

  const [y, m, d] = todayISO.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  const shiftDays = (days: number): string => {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    return iso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  };

  if (/\btoday\b/.test(t)) return { from: todayISO, to: todayISO };
  if (/\byesterday\b/.test(t)) return { from: shiftDays(-1), to: shiftDays(-1) };
  if (/\blast\s+week\b/.test(t)) return { from: shiftDays(-13), to: shiftDays(-7) };
  if (/\b(this\s+week|past\s+week|last\s+7\s+days)\b/.test(t)) return { from: shiftDays(-6), to: todayISO };
  if (/\blast\s+month\b/.test(t)) {
    const ly = m === 1 ? y - 1 : y;
    const lm = m === 1 ? 12 : m - 1;
    return { from: iso(ly, lm, 1), to: iso(ly, lm, lastDay(ly, lm)) };
  }
  if (/\b(this\s+month|so\s+far\s+this\s+month)\b/.test(t)) return { from: iso(y, m, 1), to: todayISO };
  if (/\bthis\s+year\b/.test(t)) return { from: iso(y, 1, 1), to: todayISO };
  if (/\blast\s+30\s+days\b/.test(t)) return { from: shiftDays(-29), to: todayISO };

  for (let i = 0; i < MONTHS.length; i++) {
    if (new RegExp(`\\b${MONTHS[i]}\\b`).test(t)) {
      // The most recent occurrence of that month: "sales in March" asked in
      // February means last March, not one that has not happened yet.
      const yr = i + 1 > m ? y - 1 : y;
      return { from: iso(yr, i + 1, 1), to: iso(yr, i + 1, lastDay(yr, i + 1)) };
    }
  }
  return undefined;
};

/** Everything the question points at. */
export const planQuestion = (question: string, todayISO: string): QuestionPlan => {
  const text = (question || "").slice(0, MAX_TURN_CHARS);
  const repairNumbers = [...new Set((text.match(REPAIR_NUMBER) || []).map(normalizeForLookup))];

  const identifiers = new Set<string>();
  for (const re of [SKU_LIKE, IMEI_LIKE, SERIAL_LIKE]) {
    for (const hit of text.match(re) || []) {
      const norm = normalizeForLookup(hit);
      // A repair number is handled on its own; it is not an inventory code.
      if (norm.length >= 6 && !repairNumbers.includes(norm)) identifiers.add(norm);
    }
  }

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w) && !/^\d{1,2}$/.test(w))
    .slice(0, 8);

  const quoted = /["“']([^"”']{3,60})["”']/.exec(text);
  const customerQuery = CUSTOMER_WORDS.test(text) && quoted ? quoted[1].trim() : undefined;

  const range = parseDateRange(text, todayISO);

  return {
    identifiers: [...identifiers],
    repairNumbers,
    words,
    ...(range ? { range } : {}),
    ...(customerQuery ? { customerQuery } : {}),
    asksMoney: MONEY_WORDS.test(text),
    asksPayroll: PAYROLL_WORDS.test(text),
    broad: identifiers.size === 0 && repairNumbers.length === 0 && words.length === 0,
  };
};

/* ---------------- Matching stock, the way the app does ---------------- */

const DEVICE_FIELDS = [
  "sku", "imei", "manufacturerBarcode", "item", "brand", "model",
  "storage", "color", "carrier", "condition", "batteryHealth", "deviceType",
  "notes", "boughtFrom", "category",
];

export interface Searchable { plain: string; squashed: string }

/** Mirrors domain/itemSearch.ts's buildSearchable. */
export const buildSearchable = (item: Record<string, unknown>): Searchable => {
  const parts = DEVICE_FIELDS.map((f) => {
    const v = item[f];
    return typeof v === "string" || typeof v === "number" ? String(v) : "";
  });
  const plain = parts.filter(Boolean).join(" ").toLowerCase();
  return { plain, squashed: plain.replace(/\s+/g, "") };
};

/** Mirrors domain/itemSearch.ts's wordMatches, including the bare-"128" case. */
export const wordMatches = (word: string, s: Searchable): boolean => {
  if (!word) return true;
  if (s.plain.includes(word)) return true;
  const squashed = word.replace(/\s+/g, "");
  if (squashed && s.squashed.includes(squashed)) return true;
  if (/^\d+$/.test(squashed) && s.squashed.includes(`${squashed}gb`)) return true;
  return false;
};

/** EVERY word must appear, as in the app — adding a word narrows the result. */
export const matchesWords = (item: Record<string, unknown>, words: string[]): boolean => {
  if (words.length === 0) return false;
  const s = buildSearchable(item);
  return words.every((w) => wordMatches(w, s));
};

/** Does this row carry one of the codes the question named? */
export const matchesIdentifier = (item: Record<string, unknown>, identifiers: string[]): boolean => {
  if (identifiers.length === 0) return false;
  const codes = ["sku", "imei", "serial", "manufacturerBarcode", "imeiNormalized"]
    .map((f) => normalizeForLookup(item[f]))
    .filter(Boolean);
  return identifiers.some((q) => codes.includes(q));
};

/**
 * The devices worth sending, most relevant first.
 *
 * An EXACT identifier hit always wins and is never crowded out by a word
 * match — that is the rule the app's own search follows, and it is what makes
 * "PHN-000123" reliable.
 */
export const selectDevices = (
  items: Record<string, unknown>[],
  plan: QuestionPlan,
  limit = MAX_RECORDS_PER_KIND,
): Record<string, unknown>[] => {
  const exact = items.filter((i) => matchesIdentifier(i, plan.identifiers));
  if (exact.length >= limit) return exact.slice(0, limit);
  const rest = items.filter((i) => !exact.includes(i) && matchesWords(i, plan.words));
  return [...exact, ...rest].slice(0, limit);
};

/* ---------------- What a caller may be told ---------------- */

export interface Viewer {
  /** reports.profit.* — may see cost, margin and profit. */
  canSeeMoney: boolean;
  /** payroll.manage — may see wages and hours. */
  canSeePayroll: boolean;
}

/**
 * Money fields stripped from a retrieved record for a caller without profit
 * visibility.
 *
 * THE GATE IS NOT ENOUGH ON ITS OWN. requireProfitVisibility keeps the chat
 * shut for a technician entirely, but a MANAGER without the Financials
 * override holds reports.profit.summary and passes it — and must still not be
 * handed a per-device purchase cost by asking the assistant nicely. The app
 * strips those figures at the data layer everywhere else (the Sales Ledger,
 * the Money Trail, costVisibility.ts); this is the same rule in the one place
 * that did not have it.
 */
export const MONEY_FIELDS = [
  "purchaseCost", "repairCost", "cost", "costPerUnit", "totalCost", "partsCost",
  "labourCost", "profit", "margin", "marginPercent", "targetSalePrice", "targetPrice",
  "quotePrice", "floorPrice", "minMargin", "wholesaleCost", "purchasePrice",
] as const;

/** Never retrieved for anybody without payroll visibility, at any price. */
export const PAYROLL_FIELDS = [
  "hourlyRate", "rate", "wage", "salary", "bonus", "payRate", "payGroup",
  "hoursWorked", "grossPay", "netPay", "payPeriodId",
] as const;

/** Customer contact details — only ever for a question about that customer. */
export const CONTACT_FIELDS = ["phone", "email", "address", "customerPhone", "customerEmail"] as const;

export const stripFields = (
  record: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (fields.includes(k)) continue;
    out[k] = v;
  }
  return out;
};

/** Everything a viewer may not see, removed in one pass. */
export const redactRecord = (
  record: Record<string, unknown>,
  viewer: Viewer,
  opts: { allowContact?: boolean } = {},
): Record<string, unknown> => {
  let out = record;
  if (!viewer.canSeeMoney) out = stripFields(out, MONEY_FIELDS);
  // Payroll is stripped from EVERY record regardless of where it appears.
  // There is no retrieval path that fetches payroll for a caller without it,
  // and this is the second lock on the same door.
  if (!viewer.canSeePayroll) out = stripFields(out, PAYROLL_FIELDS);
  if (!opts.allowContact) out = stripFields(out, CONTACT_FIELDS);
  return out;
};
