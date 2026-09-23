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
  runImeiExtract, runInsights,
} from "./ai/tasks";

if (!admin.apps.length) admin.initializeApp();

// Scheduled automated Firestore→Storage backups (see backups.ts).
export { scheduledBackups } from "./backups";

// Public, no-auth repair-status lookup for customers (see repairLookup.ts).
export { repairStatusLookup } from "./repairLookup";

// Public PC-build listing lookup — one link per build for Marketplace posts.
// Link-only: the token is the whole access check, and what comes back is
// built from an allow-list (publicBuildPolicy.ts), never the stored document.
export { buildShareLookup } from "./buildLookup";

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
  | { op: "chat"; inventory: InventoryRow[]; history: ChatTurn[] };

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
  const snap = await admin.firestore().collection("users").doc(uid).get();
  const data = snap.data() as { role?: Role; disabled?: boolean; allowProfit?: boolean } | undefined;
  if (!data || data.disabled || !hasProfitVisibility(data.role, data.allowProfit)) {
    throw new HttpsError(
      "permission-denied",
      "This AI feature surfaces profit/margin figures your account doesn't have access to."
    );
  }
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
 *   - chat:         conversational assistant over the inventory
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

    const router = buildRouter();

    try {
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
        case "chat":
          return {
            text: await runChat(router, body.inventory ?? [], body.history ?? []),
          };
        default:
          throw new HttpsError(
            "invalid-argument",
            `Unknown op: ${(body as { op: string }).op}`
          );
      }
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
