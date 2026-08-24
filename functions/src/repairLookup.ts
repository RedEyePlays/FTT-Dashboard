import { onCall, HttpsError, CallableRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

// Shared Admin app (backups.ts may also init it — guard against double init).
if (!admin.apps.length) admin.initializeApp();

// --- Public repair-status lookup --------------------------------------------
//
// A deliberately PUBLIC callable (no auth gate) so a customer can check their
// repair status from a printed link without an account. Security model:
//   • The Admin SDK reads server-side, so no client Firestore rule is relaxed
//     and the browser never touches the repairs collection directly.
//   • A caller MUST supply the exact ticket number AND a matching identifier
//     (last-4 of the phone on file, or the customer's name). Ticket number
//     alone returns nothing — so tickets can't be enumerated or browsed.
//   • Only ONE ticket's minimal, non-sensitive fields are ever returned: ticket
//     number, device, a coarse status label, and an estimated/ready date. No
//     price, phone, email, address, notes, or any other customer's data.
//   • A best-effort in-memory rate limit throttles abusive repeat calls.
//     (For production, also enable Firebase App Check on this callable.)

interface LookupRequest {
  ticket?: unknown;
  identifier?: unknown;
}

interface PublicRepair {
  found: true;
  ticket: string;
  device: string;
  status: string;       // customer-friendly label
  estimatedDate?: string; // YYYY-MM-DD, when still in progress
  readyDate?: string;     // YYYY-MM-DD, when ready/completed
}

// Internal status → customer-friendly bucket. Anything not listed is treated as
// "In Progress" so we never leak an unexpected internal state verbatim.
const FRIENDLY_STATUS: Record<string, string> = {
  received: "Received",
  diagnosing: "In Progress",
  waiting_approval: "Awaiting Your Approval",
  waiting_parts: "Waiting on Parts",
  in_repair: "In Progress",
  testing: "In Progress",
  ready_pickup: "Ready for Pickup",
  completed: "Completed",
  picked_up: "Completed",
  cancelled: "Cancelled",
};

const digits = (s: unknown): string => String(s ?? "").replace(/\D/g, "");
const norm = (s: unknown): string => String(s ?? "").trim().toLowerCase();

// Does the supplied identifier verify this repair? Accept the last 4 phone
// digits, or the customer's name (full, or first name — case-insensitive).
function identifierMatches(repair: Record<string, unknown>, identifier: string): boolean {
  const id = identifier.trim();
  if (id.length < 3) return false;
  const idDigits = digits(id);
  if (idDigits.length >= 4) {
    const phone = digits(repair.customerPhone);
    if (phone && phone.slice(-4) === idDigits.slice(-4)) return true;
  }
  const name = norm(repair.customerName);
  if (name) {
    const given = norm(id);
    if (name === given) return true;
    if (name.split(/\s+/)[0] === given) return true; // first-name match
  }
  return false;
}

// Best-effort per-instance throttle: cap distinct-ticket lookups from spinning.
const HITS = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
function throttled(key: string): boolean {
  const now = Date.now();
  const recent = (HITS.get(key) || []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  HITS.set(key, recent);
  if (HITS.size > 5000) HITS.clear(); // crude memory bound
  return recent.length > MAX_PER_WINDOW;
}

export const repairStatusLookup = onCall(
  { region: "us-central1" },
  async (request: CallableRequest<LookupRequest>): Promise<PublicRepair | { found: false }> => {
    const ticket = String(request.data?.ticket ?? "").trim();
    const identifier = String(request.data?.identifier ?? "").trim();

    // Both fields are required — never allow a ticket-only lookup.
    if (!ticket || !identifier) {
      throw new HttpsError("invalid-argument", "Enter your ticket number and the name or phone on the ticket.");
    }

    const rateKey = (request.rawRequest?.ip || "anon") + "|" + ticket.toLowerCase();
    if (throttled(rateKey)) {
      throw new HttpsError("resource-exhausted", "Too many attempts. Please wait a minute and try again.");
    }

    // Cross-workspace lookup by exact ticket number (server-side, Admin SDK).
    const snap = await admin
      .firestore()
      .collectionGroup("repairs")
      .where("repairNumber", "==", ticket)
      .limit(5)
      .get();

    // Keep only those the identifier verifies. A generic "not found" is returned
    // for a wrong ticket AND a wrong identifier, so neither can be probed apart.
    const matches = snap.docs
      .map((d: admin.firestore.QueryDocumentSnapshot) => d.data() as Record<string, unknown>)
      .filter((r: Record<string, unknown>) => identifierMatches(r, identifier));

    if (matches.length !== 1) {
      return { found: false };
    }

    const r: any = matches[0];
    const device = [r.brand, r.model].filter(Boolean).join(" ") || r.deviceType || "Device";
    const status = FRIENDLY_STATUS[String(r.status)] || "In Progress";
    const ready = status === "Ready for Pickup" || status === "Completed";

    const out: PublicRepair = { found: true, ticket: String(r.repairNumber), device: String(device), status };
    if (ready) {
      const readyDate = r.completedAt ? new Date(r.completedAt).toISOString().split("T")[0] : (r.warrantyUntil || undefined);
      if (readyDate) out.readyDate = String(readyDate);
    } else if (r.estimatedCompletion) {
      out.estimatedDate = String(r.estimatedCompletion);
    }
    return out;
  }
);
