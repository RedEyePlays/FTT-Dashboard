import * as admin from "firebase-admin";
import {
  MAX_RECORDS_PER_KIND, QuestionPlan, Viewer,
  normalizeForLookup, planQuestion, selectDevices,
} from "./retrievalPolicy";
import {
  BusinessSummary, ContextBlock, DeviceStory,
  deviceHeadline, deviceTimeline, renderContext, renderRecord, renderTimeline,
} from "./timeline";

/**
 * THE RETRIEVAL STEP — the only part of this that touches Firestore.
 *
 * It runs BEFORE the model call, server-side, with the Admin SDK, and it reads
 * the workspace the CALLER belongs to (resolved from their own user document,
 * never from anything the client sent). What it hands back is a redacted,
 * capped block of text.
 *
 * WHY THE READS ARE SHAPED THE WAY THEY ARE:
 *
 *   • The summary uses COUNT and SUM aggregations, which do not read the
 *     documents at all. The old code sent the whole inventory to produce the
 *     same three numbers.
 *   • An identifier query goes straight at the indexed fields (sku,
 *     imeiNormalized) rather than scanning. A word search has no index to use,
 *     so it is bounded by a limit and filtered here — that is the one read
 *     that scales with the shop, and it is capped.
 *   • Nothing is fetched for a question that names nothing. "How are we doing"
 *     is answered from the summary, which costs one aggregation.
 */

const db = () => admin.firestore();
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const rows = (snap: FirebaseFirestore.QuerySnapshot): Record<string, unknown>[] =>
  snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));

/** Swallow a failed read: a missing collection must not take the chat down. */
const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try { return await fn(); } catch { return fallback; }
};

/* ---------------- The always-on summary ---------------- */

export const businessSummary = async (
  ws: string,
  viewer: Viewer,
  todayISO: string,
): Promise<BusinessSummary> => {
  const monthStart = `${todayISO.slice(0, 7)}-01`;
  const inventory = db().collection(`user_data/${ws}/inventory`);
  const sales = db().collection(`user_data/${ws}/salesTransactions`);
  const repairs = db().collection(`user_data/${ws}/repairs`);

  const [inStock, soldThisMonth, openRepairs] = await Promise.all([
    safe(async () => (await inventory.where("deviceStatus", "==", "ready").count().get()).data().count, 0),
    safe(async () => (await inventory.where("soldDate", ">=", monthStart).count().get()).data().count, 0),
    safe(async () => (await repairs.where("status", "in", ["received", "diagnosing", "waiting_approval", "in_progress", "ready_pickup"]).count().get()).data().count, 0),
  ]);

  const summary: BusinessSummary = {
    devicesInStock: inStock,
    devicesSoldThisMonth: soldThisMonth,
    openRepairs,
  };

  // MONEY TOTALS ARE PART OF THE SUMMARY ONLY FOR SOMEBODY WHO MAY SEE THEM.
  // Sales revenue is not a cost figure, but a day's takings is exactly the
  // sort of number the profit tiers exist to gate, so it follows the same rule
  // as everything else rather than being special-cased as harmless.
  if (viewer.canSeeMoney) {
    const [today, month] = await Promise.all([
      safe(async () => (await sales.where("date", "==", todayISO)
        .aggregate({ total: admin.firestore.AggregateField.sum("totalPaid") }).get()).data().total || 0, 0),
      safe(async () => (await sales.where("date", ">=", monthStart)
        .aggregate({ total: admin.firestore.AggregateField.sum("totalPaid") }).get()).data().total || 0, 0),
    ]);
    summary.salesToday = Math.round(today * 100) / 100;
    summary.salesThisMonth = Math.round(month * 100) / 100;
  }
  return summary;
};

/* ---------------- Finding the records a question names ---------------- */

const LOOKUP_LIMIT = 40;

/** Devices matching an exact code, straight at the indexed fields. */
const devicesByIdentifier = async (ws: string, identifiers: string[]): Promise<Record<string, unknown>[]> => {
  if (identifiers.length === 0) return [];
  const col = db().collection(`user_data/${ws}/inventory`);
  const found: Record<string, unknown>[] = [];
  for (const code of identifiers.slice(0, 4)) {
    const [bySku, byImei] = await Promise.all([
      safe(async () => rows(await col.where("sku", "==", code).limit(3).get()), []),
      safe(async () => rows(await col.where("imeiNormalized", "==", code).limit(3).get()), []),
    ]);
    for (const row of [...bySku, ...byImei]) {
      if (!found.some((f) => f.id === row.id)) found.push(row);
    }
  }
  return found;
};

/**
 * Devices matching the WORDS of the question.
 *
 * This is the one read whose cost grows with the shop, so it is bounded twice:
 * a hard `limit` on the query, and the word matcher applied here. Ordered
 * newest-first, because a question with no code in it is almost always about
 * something recent.
 */
const devicesByWords = async (ws: string, plan: QuestionPlan): Promise<Record<string, unknown>[]> => {
  if (plan.words.length === 0) return [];
  const snap = await safe(
    async () => rows(await db().collection(`user_data/${ws}/inventory`)
      .orderBy("date", "desc").limit(LOOKUP_LIMIT).get()),
    [],
  );
  return selectDevices(snap, plan);
};

/** Everything that happened to these devices, each fetched only if relevant. */
const storyFor = async (ws: string, item: Record<string, unknown>): Promise<DeviceStory> => {
  const id = str(item.id);
  const sku = str(item.sku);
  const imei = normalizeForLookup(item.imei);
  const base = `user_data/${ws}`;

  const [repairs, sales, dropOffs, builds, audit] = await Promise.all([
    safe(async () => rows(await db().collection(`${base}/repairs`).where("inventoryId", "==", id).limit(MAX_RECORDS_PER_KIND).get()), []),
    safe(async () => rows(await db().collection(`${base}/salesTransactions`).where("itemIds", "array-contains", id).limit(MAX_RECORDS_PER_KIND).get()), []),
    safe(async () => (imei
      ? rows(await db().collection(`${base}/dropOffs`).where("imei", "==", str(item.imei)).limit(3).get())
      : []), []),
    safe(async () => rows(await db().collection(`${base}/pcBuilds`).where("inventoryId", "==", id).limit(2).get()), []),
    safe(async () => rows(await db().collection(`${base}/auditLogs`).where("entityId", "==", id).orderBy("ts", "desc").limit(MAX_RECORDS_PER_KIND).get()), []),
  ]);

  // Sales are linked by line, and older documents have no itemIds array — fall
  // back to a small scan by SKU rather than losing the sale entirely.
  let saleRows = sales;
  if (saleRows.length === 0 && sku) {
    saleRows = await safe(
      async () => rows(await db().collection(`${base}/salesTransactions`)
        .orderBy("date", "desc").limit(LOOKUP_LIMIT).get())
        .filter((s) => Array.isArray(s.lines)
          && (s.lines as Record<string, unknown>[]).some((l) => str(l.inventoryId) === id || str(l.sku) === sku))
        .slice(0, MAX_RECORDS_PER_KIND),
      [],
    );
  }

  return { item, repairs, sales: saleRows, dropOffs, builds, audit };
};

/** A repair ticket named by number, with its own small story. */
const repairsByNumber = async (ws: string, numbers: string[]): Promise<Record<string, unknown>[]> => {
  if (numbers.length === 0) return [];
  const col = db().collection(`user_data/${ws}/repairs`);
  const out: Record<string, unknown>[] = [];
  for (const n of numbers.slice(0, 3)) {
    const found = await safe(
      async () => rows(await col.orderBy("createdAt", "desc").limit(LOOKUP_LIMIT).get())
        .filter((r) => normalizeForLookup(r.repairNumber) === n),
      [],
    );
    out.push(...found.slice(0, 3));
  }
  return out;
};

/**
 * ONE customer, and only when the question was explicitly about them.
 *
 * Never in bulk and never as a side effect of some other question: contact
 * details are the one category here that belongs to somebody who is not the
 * shop.
 */
const customerByName = async (ws: string, query: string): Promise<Record<string, unknown> | null> => {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return null;
  const found = await safe(
    async () => rows(await db().collection(`user_data/${ws}/customers`).limit(LOOKUP_LIMIT).get())
      .filter((c) => str(c.name).toLowerCase().includes(q) || str(c.company).toLowerCase().includes(q)),
    [],
  );
  return found[0] || null;
};

/* ---------------- Putting the block together ---------------- */

export interface RetrievedContext {
  text: string;
  /** For the log and for the UI: how much was actually looked at. */
  records: number;
  truncated: number;
  plan: QuestionPlan;
}

export const retrieveContext = async (
  ws: string,
  question: string,
  viewer: Viewer,
  todayISO: string,
): Promise<RetrievedContext> => {
  const plan = planQuestion(question, todayISO);
  const summary = await businessSummary(ws, viewer, todayISO);

  // A question that names nothing gets the summary and nothing else. That is
  // the common case for "how are we doing this month", and it now costs three
  // aggregations instead of the entire inventory.
  if (plan.broad && !plan.customerQuery) {
    const { text, truncated } = renderContext(summary, []);
    return { text, records: 0, truncated, plan };
  }

  const blocks: ContextBlock[] = [];
  let records = 0;

  const [byId, byWord] = await Promise.all([
    devicesByIdentifier(ws, plan.identifiers),
    devicesByWords(ws, plan),
  ]);
  const devices: Record<string, unknown>[] = [];
  for (const row of [...byId, ...byWord]) {
    if (devices.length >= MAX_RECORDS_PER_KIND) break;
    if (!devices.some((d) => d.id === row.id)) devices.push(row);
  }

  // A named device gets its whole story. Several matches get a line each —
  // twelve full timelines is not an answer, it is a wall.
  const wantsStory = devices.length <= 3;
  for (const item of devices) {
    records++;
    if (wantsStory) {
      const story = await storyFor(ws, item);
      records += story.repairs.length + story.sales.length + story.dropOffs.length + story.builds.length;
      blocks.push({
        title: `DEVICE — ${str(item.sku) || str(item.item) || "unnamed"}`,
        body: renderTimeline(deviceHeadline(item, viewer), deviceTimeline(story, viewer)),
      });
    } else {
      blocks.push({
        title: `DEVICE — ${str(item.sku) || str(item.item) || "unnamed"}`,
        body: `  ${deviceHeadline(item, viewer)}`,
      });
    }
  }

  const tickets = await repairsByNumber(ws, plan.repairNumbers);
  for (const r of tickets) {
    records++;
    blocks.push({
      title: `REPAIR — ${str(r.repairNumber) || str(r.id)}`,
      body: renderRecord(r, viewer),
    });
  }

  if (plan.customerQuery) {
    const customer = await customerByName(ws, plan.customerQuery);
    if (customer) {
      records++;
      blocks.push({
        title: `CUSTOMER — ${str(customer.name) || str(customer.company)}`,
        // The ONE place contact details are allowed through, and only because
        // the question named this person.
        body: renderRecord(customer, viewer, { allowContact: true }),
      });
    }
  }

  if (blocks.length === 0) {
    blocks.push({
      title: "NOTHING MATCHED",
      body: "  No record in this workspace matched that. Say so plainly rather than guessing at an answer.",
    });
  }

  const { text, truncated } = renderContext(summary, blocks);
  return { text, records, truncated, plan };
};
