import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import { defineSecret, defineString } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { Role, hasProfitVisibility } from "./permissions";
import { createClaudeProvider } from "./ai/claude";
import { createGeminiProvider } from "./ai/gemini";
import { AiRouter, fallbackFromConfig, providerFromConfig } from "./ai/router";
import { ProviderError, ValidationError } from "./ai/types";
import {
  ChatTurn, InventoryRow, needsProfitVisibility, runBulkParse, runChat,
  runImeiExtract, runInsights, runListing, runGpuPerformance,
} from "./ai/tasks";
import { Viewer } from "./ai/retrievalPolicy";
import { retrieveContext } from "./ai/context";
import {
  AttachmentInput, PreparedAttachment, checkAttachment, prepareAttachment,
} from "./ai/attachmentPolicy";
import { capStateFor, recordUsage } from "./ai/usage";
import { capMessage, estimateTokens, overCap, usageDay } from "./ai/usagePolicy";
import { modelFor } from "./ai/models";

if (!admin.apps.length) admin.initializeApp();

// Scheduled automated Firestore→Storage backups (see backups.ts).
export { scheduledBackups } from "./backups";

// Public, no-auth repair-status lookup for customers (see repairLookup.ts).
export { repairStatusLookup } from "./repairLookup";

// Public PC-build listing lookup — one link per build for Marketplace posts.
// Link-only: the token is the whole access check, and what comes back is
// built from an allow-list (publicBuildPolicy.ts), never the stored document.
export { buildShareLookup } from "./buildLookup";

// Automatic stock device photos from Wikimedia Commons. Every licence and
// match decision is in commonsPolicy.ts and fails closed — a wrong photo is
// worse than no photo, and an unlicensed one is worse than both.
export { autoDevicePhoto, findDevicePhoto } from "./deviceImage";

// The counter kiosk's listing. No account is signed into the tablet: it is
// identified by an unguessable token, and everything returned is built from
// an allow-list (showroomPolicy.ts). Assume the tablet is picked up by
// somebody who would like to know what the shop paid.
export { showroomLookup } from "./showroomLookup";

// The only write path a technician has for completedAt/warrantyUntil now
// that firestore.rules excludes them from direct client writes (see repairs.ts).
export { techUpdateRepair } from "./repairs";

// Owner-only, in-app staff password reset (see staffPassword.ts). Firebase's
// email reset is useless for staff accounts here — they routinely use
// addresses that don't receive mail — so the owner sets the password directly
// via the Admin SDK and hands it over out-of-band.
export { setStaffPassword } from "./staffPassword";

// Owner (or manager, for a technician account only), in-app staff account
// creation (see staffUser.ts) — sets the email/password/PIN directly, no
// self-claimed "pending invite" step.
export { createStaffUser } from "./staffUser";

// Keeps the kiosk punch roster (user_data/{ws}/kioskStaff) in sync with
// users/{uid} — the ONLY writer of that collection (see kioskStaff.ts for why
// the mirror exists and why it's a trigger, not a callable).
export { syncKioskStaff } from "./kioskStaff";

// Fast user switching on a shared counter register. Server-side because
// firestore.rules will not let a technician's session read a colleague's
// pinHash, so the browser cannot do the check in the general case — see
// switchUser.ts.
export { switchUser } from "./switchUser";

// --- AI provider keys ---------------------------------------------------
//
// Both keys live in Firebase's server-side Secret Manager and are NEVER
// shipped to the client. Both are declared on the function so either provider
// can answer (see src/ai/router.ts for when the fallback fires). Set them with:
//   firebase functions:secrets:set ANTHROPIC_API_KEY
//   firebase functions:secrets:set GEMINI_API_KEY
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

// Which provider answers, and whether the other one covers for it. Plain
// environment values rather than secrets — neither is sensitive, and a typo in
// either falls back to the default rather than taking AI features down.
//   AI_PROVIDER = "claude" (default) | "gemini"
//   AI_FALLBACK = "on" (default) | "off"   <- ONE FLAG to retire the fallback
const AI_PROVIDER = defineString("AI_PROVIDER", { default: "claude" });
const AI_FALLBACK = defineString("AI_FALLBACK", { default: "on" });

type AiRequest =
  | { op: "insights"; data: InventoryRow[] }
  | { op: "bulkParse"; text: string }
  | { op: "imeiExtract"; base64Image: string }
  // NO INVENTORY. The client sends the QUESTION and the conversation; the
  // server retrieves what the question refers to (src/ai/context.ts). The old
  // shape sent every row of the shop's inventory on every single turn.
  | {
    op: "chat";
    history: ChatTurn[];
    /** Files attached to THIS message only. Never resent on later turns. */
    attachments?: AttachmentInput[];
    /** One-liners for files attached earlier in this conversation. */
    attachmentSummaries?: string[];
    /** Legacy field from the previous shape. Ignored — see above. */
    inventory?: InventoryRow[];
  }
  // The FACTS object is built on the client from an allow-list
  // (domain/listing.ts) — never an inventory row, never a build document.
  | { op: "listing"; facts: Record<string, unknown>; platform?: string; length?: string; markUsedParts?: boolean }
  | { op: "gpuPerformance"; gpuModel: string };

// insights/chat send the full inventory — including purchaseCost, salePrice,
// repairCost — to the model and can return real profit/margin figures, so they
// need the same server-side gate reports.profit.summary already enforces for
// every other profit-surfacing view. The frontend menu gate (App.tsx/
// AppHeader) is UX only; this is what actually stops a technician/employee
// from calling aiGenerate directly and getting profit data back regardless.
//
// UNCHANGED BY THE PROVIDER SWITCH, and it runs BEFORE any provider is called,
// so a permission refusal can never be mistaken for a provider failure and can
// never trigger the fallback.
async function requireProfitVisibility(uid: string): Promise<void> {
  const caller = await loadCaller(uid);
  if (!caller.viewer.canSeeMoney) {
    throw new HttpsError(
      "permission-denied",
      "This AI feature surfaces profit/margin figures your account doesn't have access to."
    );
  }
}

/**
 * WHO IS ASKING, AND WHAT THEY MAY BE TOLD.
 *
 * Read from the caller's OWN user document, never from anything the client
 * sent — the workspace a request reads from is not the client's to choose.
 *
 * Two separate visibilities, because they are two separate doors:
 *   • money  — reports.profit.*, gating cost, margin and profit;
 *   • payroll — payroll.manage (owner and manager), gating wages and hours.
 * A manager without the Financials override passes the chat's own gate and
 * must STILL not be handed a purchase cost by the assistant, which is what
 * the per-field stripping in retrievalPolicy.ts is for.
 */
interface Caller {
  workspaceId: string;
  role: Role | undefined;
  viewer: Viewer;
}

async function loadCaller(uid: string): Promise<Caller> {
  const snap = await admin.firestore().collection("users").doc(uid).get();
  const data = snap.data() as {
    role?: Role; disabled?: boolean; allowProfit?: boolean; workspaceId?: string;
  } | undefined;
  if (!data || data.disabled) {
    return { workspaceId: "", role: undefined, viewer: { canSeeMoney: false, canSeePayroll: false } };
  }
  return {
    workspaceId: typeof data.workspaceId === "string" ? data.workspaceId : "",
    role: data.role,
    viewer: {
      canSeeMoney: hasProfitVisibility(data.role, data.allowProfit),
      // Mirrors services/rbac.ts: payroll.manage is owner and manager only,
      // and the allowProfit override does NOT grant it.
      canSeePayroll: data.role === "owner" || data.role === "manager",
    },
  };
}

/**
 * A rough input size for ops that do not report their own.
 *
 * The request body is what was sent, so its length is the honest stand-in.
 * Never LOGGED — only measured, and only as a character count.
 */
function approxRequestChars(body: AiRequest): number {
  try { return JSON.stringify(body).length; } catch { return 0; }
}

/** The last thing the user actually asked — what retrieval plans against. */
function lastUserText(history: ChatTurn[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h?.role === "user") return (h.parts || []).map(p => p?.text || "").join(" ").trim();
  }
  return "";
}

/** The shop's own name, for the prompt. Best effort — never fails the call. */
async function shopNameFor(ws: string): Promise<string> {
  try {
    const snap = await admin.firestore().doc(`user_data/${ws}/meta/app`).get();
    const settings = (snap.data() as Record<string, unknown> | undefined)?.settings as Record<string, unknown> | undefined;
    const general = (settings?.general || {}) as Record<string, unknown>;
    const name = general.storeName;
    return typeof name === "string" && name.trim() ? name.trim() : "the shop";
  } catch {
    return "the shop";
  }
}

/**
 * Check and prepare the files attached to this message.
 *
 * REJECTED LOUDLY, not skipped: somebody who attached a 30 MB video and got a
 * normal-looking answer would reasonably believe it had been read.
 */
function prepareAttachments(inputs: AttachmentInput[] | undefined): PreparedAttachment[] {
  const out: PreparedAttachment[] = [];
  (inputs || []).forEach((a, i) => {
    const check = checkAttachment(a, i);
    if (!check.ok) throw new HttpsError("invalid-argument", `${a?.name || "That file"}: ${check.message}`);
    out.push(prepareAttachment(a, check.kind));
  });
  return out;
}

/** Build the router for this invocation from the configured provider + keys. */
function buildRouter(): AiRouter {
  const claude = createClaudeProvider(ANTHROPIC_API_KEY.value());
  const gemini = createGeminiProvider(GEMINI_API_KEY.value());
  const primaryName = providerFromConfig(AI_PROVIDER.value());
  const primary = primaryName === "gemini" ? gemini : claude;
  const other = primaryName === "gemini" ? claude : gemini;
  return new AiRouter({
    primary,
    fallback: fallbackFromConfig(AI_FALLBACK.value()) === "on" ? other : undefined,
  });
}

/**
 * Single HTTPS callable that proxies every AI interaction the dashboard needs.
 * The client sends `{ op, ...payload }`; we read the API key from Secret
 * Manager, call the provider server-side, and return the result. This keeps the
 * key off the client entirely (previously baked into the bundle via
 * VITE_API_KEY).
 *
 * THE RETURN SHAPES ARE THE CONTRACT — the client calls this from ~10 places
 * and only sees `{ text }`, `{ items }` and the imeiExtract object. Moving from
 * Gemini to Claude changed none of them.
 *
 * Ops:
 *   - insights:     financial insights markdown from the inventory log
 *   - bulkParse:    parse free text into structured inventory items
 *   - imeiExtract:  read IMEI1/IMEI2/Serial/EID separately from a base64 image
 *   - chat:           conversational assistant over the inventory
 *   - listing:        a Marketplace title + description, from an allow-listed
 *                     facts object, checked for invented figures before it is
 *                     returned (src/ai/listingPolicy.ts)
 *   - gpuPerformance: proposed fps ranges for one GPU, from published
 *                     benchmarks via web search, for a human to review
 */
export const aiGenerate = onCall(
  { secrets: [ANTHROPIC_API_KEY, GEMINI_API_KEY], region: "us-central1" },
  async (request: CallableRequest<AiRequest>) => {
    // Auth gate: only signed-in Firebase users may spend AI quota.
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "You must be signed in to use AI features."
      );
    }

    const body = request.data;
    if (!body || typeof body !== "object" || !("op" in body)) {
      throw new HttpsError("invalid-argument", "Missing 'op' in request.");
    }

    // BEFORE any provider is touched, and driven by the declared list in
    // ai/tasks.ts rather than by remembering to write the call twice.
    if (needsProfitVisibility(body.op)) {
      await requireProfitVisibility(request.auth.uid);
    }

    // THE DAILY CAP APPLIES TO EVERY OP, not just the chat. A listing writer
    // stuck in a retry loop spends the shop's money exactly as fast as a
    // conversation does, and a cap with a hole in it is a cap nobody can rely
    // on. Checked once, here, before any provider is built.
    const caller = await loadCaller(request.auth.uid);
    const cap = caller.workspaceId
      ? await capStateFor(caller.workspaceId, Date.now())
      : null;
    if (cap && overCap(cap)) throw new HttpsError("resource-exhausted", capMessage(cap));

    const router = buildRouter();
    const provider = providerFromConfig(AI_PROVIDER.value());
    const startedAt = Date.now();
    /** Rough sizes for the meter, filled in by whichever branch ran. */
    let meter: { inputChars: number; outputChars: number } | null = null;
    const meterFor = (inputChars: number, outputChars: number) => {
      meter = { inputChars, outputChars };
    };

    try {
      const result = await (async () => {
        switch (body.op) {
          case "insights":
            return { text: await runInsights(router, body.data ?? []) };
          case "bulkParse":
            return {
              items: await runBulkParse(
                router, body.text ?? "", new Date().toISOString().split("T")[0]
              ),
            };
          case "imeiExtract":
            return await runImeiExtract(router, body.base64Image ?? "");
          case "chat": {
            if (!caller.workspaceId) {
              throw new HttpsError("permission-denied", "Your account is not attached to a workspace.");
            }
            const attachments = prepareAttachments(body.attachments);
            const question = lastUserText(body.history ?? []);
            const today = new Date().toISOString().split("T")[0];

            // RETRIEVAL, server-side, before the model is called at all.
            const retrieved = await retrieveContext(
              caller.workspaceId, question, caller.viewer, today,
            );

            const chat = await runChat(router, {
              context: retrieved.text,
              history: body.history ?? [],
              viewer: caller.viewer,
              shopName: await shopNameFor(caller.workspaceId),
              attachments,
              ...(body.attachmentSummaries?.length ? { attachmentSummaries: body.attachmentSummaries } : {}),
            });

            meterFor(chat.approxInputChars, chat.text.length);

            return {
              text: chat.text,
              notices: chat.notices,
              // WHAT ACTUALLY ANSWERED, from server config — the header used to
              // read "Gemini 2.5 Flash" regardless, which is how somebody
              // debugs the wrong model for an hour.
              provider,
              model: modelFor(provider, "reasoning"),
              recordsUsed: retrieved.records,
              attachmentSummaries: attachments.map(a => a.summary),
              usage: { used: (cap?.used ?? 0) + 1, cap: cap?.cap ?? 0, day: usageDay(Date.now()) },
            };
          }
          case "listing":
            return await runListing(router, {
              facts: body.facts ?? {},
              platform: body.platform,
              length: body.length,
              markUsedParts: body.markUsedParts === true,
            });
          case "gpuPerformance":
            return await runGpuPerformance(router, body.gpuModel ?? "");
          default:
            throw new HttpsError(
              "invalid-argument",
              `Unknown op: ${(body as { op: string }).op}`
            );
        }
      })();

      // ONE meter for every op, written after the provider answered — a call
      // that failed because a vendor was down cost the shop nothing and must
      // not count against its limit.
      if (caller.workspaceId) {
        const m = meter as { inputChars: number; outputChars: number } | null;
        await recordUsage(caller.workspaceId, {
          op: body.op,
          provider,
          model: modelFor(provider, body.op === "bulkParse" || body.op === "imeiExtract" ? "fast" : "reasoning"),
          inputTokens: estimateTokens("x".repeat(m?.inputChars ?? approxRequestChars(body))),
          outputTokens: estimateTokens("x".repeat(m?.outputChars ?? JSON.stringify(result ?? "").length)),
          ms: Date.now() - startedAt,
          uid: request.auth.uid,
          at: Date.now(),
        });
      }
      return result;
    } catch (e) {
      // A permission refusal (and every other HttpsError) passes straight
      // through — it is already the right error with the right message.
      if (e instanceof HttpsError) throw e;
      // The model answered in the wrong shape. Distinct from a provider being
      // down, and never retried elsewhere — see src/ai/router.ts.
      if (e instanceof ValidationError) {
        console.error(JSON.stringify({ msg: "ai_validation_failed", op: body.op, task: e.task }));
        throw new HttpsError("internal", "The AI returned an unusable result. Please try again.");
      }
      if (e instanceof ProviderError) {
        console.error(JSON.stringify({ msg: "ai_provider_failed", op: body.op, reason: e.reason }));
        throw new HttpsError("unavailable", "The AI service is unavailable right now. Please try again shortly.");
      }
      throw e;
    }
  }
);
