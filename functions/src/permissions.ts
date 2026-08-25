// Mirrors services/rbac.ts's can(role, 'reports.profit.summary', {allowProfit})
// — the one permission check aiGenerate needs server-side. Kept as an
// independent, minimal copy rather than importing the client's rbac module:
// functions/ is a fully separate deployable package (its own package.json/
// tsconfig, deployed via `npm --prefix functions run build`, see
// firebase.json) with no build-time access to the app's src tree.
//
// Pure and dependency-free on purpose (no firebase-admin/firebase-functions
// imports) so it can be unit-tested in isolation from the Cloud Functions
// runtime — see permissions.test.ts.

export type Role = "owner" | "manager" | "employee" | "technician";

/**
 * Owner/manager always have profit visibility; an employee only with the
 * allowProfit override; a technician (or no role) never.
 */
export function hasProfitVisibility(role: unknown, allowProfit: unknown): boolean {
  if (role === "owner" || role === "manager") return true;
  if (role === "employee") return !!allowProfit;
  return false;
}
