import { MAX_CONTEXT_CHARS, Viewer, redactRecord } from "./retrievalPolicy";

/**
 * THE STORY OF ONE DEVICE, AS LINES.
 *
 * "What happened to PHN-000123" is a question about a sequence of events that
 * lives in five collections: the inventory row, its repairs, the sale, the
 * drop-off it was bought through, the build it came from, and the audit trail.
 * Handing the model six JSON documents and hoping is both expensive and worse:
 * it has to reconstruct the order itself, and it frequently gets it wrong.
 *
 * So the server assembles the order and hands over a timeline — dates, what
 * happened, amounts. It costs a fraction of the JSON and it answers better.
 *
 * Every line goes through the same redaction as everything else: a caller
 * without profit visibility gets the sale price (which is on the receipt) and
 * never the cost or the margin.
 *
 * Pure: no Firebase, no model.
 */

export interface TimelineEvent {
  /** YYYY-MM-DD where known; events with no date sort last, in insertion order. */
  date?: string;
  text: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const money = (v: unknown): string | null => {
  const n = num(v);
  return n == null ? null : `$${n.toFixed(2)}`;
};
const dayOf = (ms: unknown): string | undefined => {
  const n = num(ms);
  if (n == null || n <= 0) return undefined;
  return new Date(n).toISOString().slice(0, 10);
};

export interface DeviceStory {
  item: Record<string, unknown>;
  repairs: Record<string, unknown>[];
  sales: Record<string, unknown>[];
  dropOffs: Record<string, unknown>[];
  builds: Record<string, unknown>[];
  audit: Record<string, unknown>[];
}

/**
 * The headline line for a device: what it is, what state it is in.
 *
 * Cost is on it ONLY for a caller who may see cost. The sale price is not
 * money-gated — it is on the customer's receipt and in every sales view an
 * employee already uses.
 */
export const deviceHeadline = (item: Record<string, unknown>, viewer: Viewer): string => {
  const name = str(item.item) || [str(item.brand), str(item.model)].filter(Boolean).join(" ") || "Device";
  const bits: string[] = [name];
  const sku = str(item.sku);
  if (sku) bits.push(`SKU ${sku}`);
  for (const [label, field] of [["storage", "storage"], ["colour", "color"], ["condition", "condition"], ["battery", "batteryHealth"]] as const) {
    const v = str(item[field]);
    if (v) bits.push(`${label} ${v}`);
  }
  if (viewer.canSeeMoney) {
    const cost = money(item.purchaseCost);
    if (cost) bits.push(`cost ${cost}`);
    const repair = num(item.repairCost);
    if (repair) bits.push(`repairs ${money(repair)}`);
  }
  const status = str(item.deviceStatus) || (str(item.soldDate) ? "sold" : "in stock");
  bits.push(`status ${status}`);
  return bits.join(" · ");
};

/** Every event on one device, oldest first. */
export const deviceTimeline = (story: DeviceStory, viewer: Viewer): TimelineEvent[] => {
  const events: TimelineEvent[] = [];
  const item = story.item;

  const bought = str(item.date);
  if (bought) {
    const from = str(item.boughtFrom);
    const cost = viewer.canSeeMoney ? money(item.purchaseCost) : null;
    events.push({
      date: bought,
      text: `Bought${from ? ` from ${from}` : ""}${cost ? ` for ${cost}` : ""}${str(item.purchaseSource) ? ` (${str(item.purchaseSource)})` : ""}`,
    });
  }

  for (const d of story.dropOffs) {
    const paid = viewer.canSeeMoney ? money(d.purchasePrice) : null;
    events.push({
      date: str(d.dateDropped) || undefined,
      text: `Drop-off${str(d.sellerName) ? ` from ${str(d.sellerName)}` : ""}${paid ? ` at ${paid}` : ""} — ${str(d.status) || "recorded"}`,
    });
  }

  for (const b of story.builds) {
    events.push({
      date: dayOf(b.finishedAt) || dayOf(b.createdAt),
      text: `Built in-house as "${str(b.name) || "custom PC"}" (${(Array.isArray(b.parts) ? b.parts.length : 0)} parts)`,
    });
  }

  for (const r of story.repairs) {
    const warranty = r.isWarrantyClaim === true ? "Warranty claim" : "Repair";
    const price = money(r.repairPrice);
    const parts: string[] = [
      `${warranty} ${str(r.repairNumber) || ""}`.trim(),
      str(r.issue) ? `— ${str(r.issue)}` : "",
      str(r.status) ? `(${str(r.status).replace(/_/g, " ")})` : "",
      price && !(r.isWarrantyClaim === true) ? `charged ${price}` : "",
    ].filter(Boolean);
    events.push({ date: str(r.date) || dayOf(r.createdAt), text: parts.join(" ") });
  }

  for (const s of story.sales) {
    const total = money(s.totalPaid) || money(s.subtotal);
    const method = str(s.paymentMethod);
    const who = str(s.customerName);
    events.push({
      date: str(s.date) || dayOf(s.createdAt),
      text: `Sold${who ? ` to ${who}` : ""}${total ? ` for ${total}` : ""}${method ? ` (${method})` : ""}`
        + (num(s.balanceOwing) ? ` — balance owing ${money(s.balanceOwing)}` : ""),
    });
    if (s.voided === true) events.push({ date: dayOf(s.voidedAt), text: "Sale voided" });
    if (s.returned === true) events.push({ date: dayOf(s.returnedAt), text: "Returned" });
  }

  for (const a of story.audit) {
    const action = str(a.action);
    if (!action) continue;
    events.push({ date: dayOf(a.ts), text: `${action.replace(/[._]/g, " ")} by ${str(a.userEmail) || "staff"}` });
  }

  // Oldest first; anything without a date goes last rather than being dropped,
  // because an undated event still happened.
  return events.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.localeCompare(b.date);
  });
};

export const renderTimeline = (headline: string, events: TimelineEvent[]): string =>
  [headline, ...events.map((e) => `  ${e.date || "(undated)"} — ${e.text}`)].join("\n");

/* ---------------- The whole context block ---------------- */

export interface BusinessSummary {
  devicesInStock: number;
  devicesSoldThisMonth: number;
  openRepairs: number;
  /** Omitted entirely for a caller without profit visibility. */
  salesThisMonth?: number;
  salesToday?: number;
}

export const renderSummary = (s: BusinessSummary): string => {
  const lines = [
    `Devices in stock: ${s.devicesInStock}`,
    `Devices sold this month: ${s.devicesSoldThisMonth}`,
    `Open repair tickets: ${s.openRepairs}`,
  ];
  if (s.salesToday != null) lines.push(`Sales today: $${s.salesToday.toFixed(2)}`);
  if (s.salesThisMonth != null) lines.push(`Sales this month: $${s.salesThisMonth.toFixed(2)}`);
  return `BUSINESS SUMMARY\n${lines.map((l) => `  ${l}`).join("\n")}`;
};

export interface ContextBlock {
  title: string;
  body: string;
}

/**
 * Join the blocks, stopping at the character cap.
 *
 * TRUNCATED AT A BLOCK BOUNDARY, never mid-line: half a timeline reads as a
 * complete one that is missing the ending, which is the worst way to be wrong.
 * What was dropped is stated, so the model can say it does not have everything
 * rather than answering confidently from a fragment.
 */
export const renderContext = (
  summary: BusinessSummary,
  blocks: ContextBlock[],
  limit = MAX_CONTEXT_CHARS,
): { text: string; truncated: number } => {
  const head = renderSummary(summary);
  const parts: string[] = [head];
  let used = head.length;
  let truncated = 0;

  for (const block of blocks) {
    const rendered = `\n\n${block.title}\n${block.body}`;
    if (used + rendered.length > limit) { truncated++; continue; }
    parts.push(rendered);
    used += rendered.length;
  }
  if (truncated > 0) {
    parts.push(`\n\n(${truncated} further record${truncated === 1 ? "" : "s"} matched but were left out to keep this short. Say so if the answer depends on them.)`);
  }
  return { text: parts.join(""), truncated };
};

/** A record rendered as compact key: value lines, after redaction. */
export const renderRecord = (
  record: Record<string, unknown>,
  viewer: Viewer,
  opts: { allowContact?: boolean } = {},
): string => {
  const clean = redactRecord(record, viewer, opts);
  const lines: string[] = [];
  for (const [k, v] of Object.entries(clean)) {
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    if (typeof v === "object") continue;   // nested documents are never worth the tokens
    lines.push(`  ${k}: ${String(v)}`);
  }
  return lines.join("\n");
};
