import * as admin from "firebase-admin";
import {
  CapState, DEFAULT_DAILY_AI_CALLS, UsageEntry, clampDailyCap, usageDay,
} from "./usagePolicy";

/**
 * COUNTING THE CALLS, AND REFUSING THE ONE PAST THE LIMIT.
 *
 * One document per workspace per day: `user_data/{ws}/aiUsage/{YYYY-MM-DD}`.
 * A counter document rather than one row per call, because the question the
 * owner asks is "how many today" and a thousand rows a day to answer it is the
 * cost problem again in miniature.
 *
 * THE LOG LINE is separate and goes to Cloud Logging, where it is already
 * indexed and already retained. It carries op, provider, model, approximate
 * tokens, duration and the caller's uid — and nothing from the shop's records.
 */

const db = () => admin.firestore();

export const usagePath = (ws: string, day: string): string => `user_data/${ws}/aiUsage/${day}`;

/** The workspace's configured ceiling, or the default. */
export const dailyCapFor = async (ws: string): Promise<number> => {
  try {
    const snap = await db().doc(`user_data/${ws}/meta/app`).get();
    const settings = (snap.data() as Record<string, unknown> | undefined)?.settings as Record<string, unknown> | undefined;
    const operations = (settings?.operations || {}) as Record<string, unknown>;
    return clampDailyCap(operations.aiDailyCallCap ?? DEFAULT_DAILY_AI_CALLS);
  } catch {
    // An unreadable settings document must not remove the cap — that is the
    // failure mode this whole thing exists to prevent.
    return DEFAULT_DAILY_AI_CALLS;
  }
};

export const usedToday = async (ws: string, day: string): Promise<number> => {
  try {
    const snap = await db().doc(usagePath(ws, day)).get();
    const n = (snap.data() as { total?: unknown } | undefined)?.total;
    return typeof n === "number" && Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};

export const capStateFor = async (ws: string, nowMs: number): Promise<CapState> => {
  const day = usageDay(nowMs);
  const [cap, used] = await Promise.all([dailyCapFor(ws), usedToday(ws, day)]);
  return { cap, used };
};

/**
 * Record one call.
 *
 * Incremented AFTER the provider answers, not before: a call that failed
 * because Claude was down cost the shop nothing, and counting it toward a
 * spending limit would punish the shop for the vendor's outage. The trade is
 * that a burst of simultaneous requests can overshoot the cap slightly, which
 * is the right way round — a hard pre-increment would refuse calls that never
 * happened.
 */
export const recordUsage = async (ws: string, entry: UsageEntry): Promise<void> => {
  const day = usageDay(entry.at);
  const inc = admin.firestore.FieldValue.increment(1);
  try {
    await db().doc(usagePath(ws, day)).set({
      day,
      total: inc,
      [`byOp.${entry.op}`]: inc,
      inputTokens: admin.firestore.FieldValue.increment(entry.inputTokens),
      outputTokens: admin.firestore.FieldValue.increment(entry.outputTokens),
      updatedAt: entry.at,
    }, { merge: true });
  } catch {
    // Never fail a request because the meter could not be written. The log
    // line below is the durable record either way.
  }
  // No inventory contents, no customer data, no model output — see the header.
  console.log(JSON.stringify({
    msg: "ai_usage",
    op: entry.op,
    provider: entry.provider,
    model: entry.model,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    ms: entry.ms,
    uid: entry.uid,
  }));
};
