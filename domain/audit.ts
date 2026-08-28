import { AppSettings } from './settings';
import { AuditEntry } from '../types';

// --- Audit helpers ----------------------------------------------------------
//
// Pure helpers for the audit trail, kept out of App.tsx / AuditLogView so they
// can be unit-tested (mirrors domain/pos.ts, domain/timeclock.ts, …). The audit
// WRITES themselves live in App.tsx (they need the signed-in user); this module
// only covers the reusable, side-effect-free pieces: human-readable action
// labels for the log view, and the settings-change diff recorded on save.

// Friendly labels for the action strings emitted by audit(). Anything not listed
// falls back to a prettified version of the raw string (see auditActionLabel),
// so the log never shows a bare `some.raw_action` token to a human.
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  // Inventory
  'inventory.add': 'Item added',
  'inventory.edit': 'Item edited',
  'inventory.delete': 'Item deleted',
  'accessory.quantity': 'Stock adjusted',
  // Sales
  'sale.complete': 'Sale completed',
  // Drop-offs
  'dropoff.accept': 'Drop-off accepted',
  'dropoff.edit': 'Drop-off edited',
  'dropoff.settle': 'Device buyer settled',
  // 'runner.edit' is a legacy STORED action string, kept as-is on purpose: it
  // is written into historical auditLogs documents, and renaming the key would
  // make every past entry fall through to prettify() and render as "Runner
  // edit" — reintroducing the old term in the one place we can't edit. New
  // writes keep emitting 'runner.edit' too, so there is exactly one action
  // string for this event; only the human-readable label changed.
  'runner.edit': 'Device buyer edited',
  // Repairs
  'repair.create': 'Repair created',
  'repair.edit': 'Repair edited',
  'repair.status_change': 'Repair status changed',
  'repair.completed': 'Repair completed',
  'repair.price_change': 'Repair price changed',
  'repair.customer_update': 'Repair customer updated',
  'repair.delete': 'Repair deleted',
  'batch.create': 'Batch created',
  'batch.edit': 'Batch edited',
  'batch.status_change': 'Batch status changed',
  'batch.delete': 'Batch deleted',
  'batch.payment': 'Batch payment recorded',
  'invoice.printed': 'Document printed',
  // Customers
  'customer.update': 'Customer updated',
  'customer.merge': 'Customers merged',
  // Users / access
  'user.role_change': 'Role changed',
  'user.disable': 'User disabled',
  'user.enable': 'User enabled',
  'user.allow_profit': 'Financial access changed',
  'user.set_rate': 'Pay rate changed',
  'user.invite': 'User invited',
  'user.invite_revoke': 'Invite revoked',
  // Time clock
  'timeclock.clock_in': 'Clocked in',
  'timeclock.clock_out': 'Clocked out',
  'timeclock.break_start': 'Break started',
  'timeclock.break_end': 'Break ended',
  'timeclock.mark_paid': 'Pay period marked paid',
  'timeclock.unmark_paid': 'Pay period reopened',
  // Settings / data
  'settings.update': 'Settings updated',
  'backup.export': 'Backup exported',
  'backup.seed': 'Sample data loaded',
};

// Title-case a raw dotted/underscored action into something readable, e.g.
// 'repair.tech.diagnostics' -> 'Repair tech diagnostics'. Used as the fallback
// for any action without an explicit label (including the dynamic
// `repair.tech.<field>` actions).
const prettify = (action: string): string => {
  const spaced = action.replace(/[._]/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : action;
};

/** Human-readable label for an audit action string (never the raw token). */
export const auditActionLabel = (action: string): string =>
  AUDIT_ACTION_LABELS[action] ?? prettify(action);

// Sensitive actions worth a one-click filter in the audit log, instead of
// picking them out of the full action dropdown one at a time — confirmed
// against the real action strings App.tsx's audit() calls actually emit
// (see the exhaustive `audit(` grep this was built from), not guessed names.
export const CRITICAL_AUDIT_ACTIONS: readonly string[] = [
  'sale.void', 'sale.return',
  'user.set_pin', 'user.role_change', 'user.allow_profit',
  'cash.reconcile', 'settings.update',
];

/** Whether an audit action is on the critical/sensitive list above. */
export const isCriticalAuditAction = (action: string): boolean => CRITICAL_AUDIT_ACTIONS.includes(action);

/**
 * A clean, human-readable one-line diff for an audit entry's before/after —
 * e.g. "status: in_repair → picked_up" — instead of raw JSON. Only produced
 * when both sides are "flat" (no nested object/array values): a genuinely
 * complex/nested change isn't something a one-liner can represent honestly,
 * so this returns null and the caller falls back to a JSON view for those.
 */
export function auditChangeSummary(before?: Record<string, unknown>, after?: Record<string, unknown>): string | null {
  if (!before && !after) return null;
  const isFlat = (o?: Record<string, unknown>) =>
    !o || Object.values(o).every(v => v === null || v === undefined || typeof v !== 'object');
  if (!isFlat(before) || !isFlat(after)) return null;

  const fmt = (v: unknown): string => (v === undefined || v === null || v === '' ? '—' : String(v));
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})])).sort();
  const parts = keys.map(k => {
    const hasBefore = !!before && k in before;
    const hasAfter = !!after && k in after;
    if (hasBefore && hasAfter) return `${k}: ${fmt(before![k])} → ${fmt(after![k])}`;
    if (hasAfter) return `${k}: ${fmt(after![k])}`;
    return `${k}: ${fmt(before![k])}`;
  });
  return parts.length ? parts.join(', ') : null;
}

export interface AuditExportRow {
  Timestamp: string;
  User: string;
  Action: string;
  Entity: string;
  'Entity ID': string;
  Change: string;
}

/**
 * Flatten audit entries into plain CSV-ready rows (see AuditLogView's Export
 * CSV button) — the caller passes whatever set is currently filtered/visible,
 * so the export always matches what's on screen. The Change column reuses
 * the same readable summary the table itself shows, falling back to raw
 * JSON only where a clean one-liner isn't practical (see auditChangeSummary).
 */
export const auditExportRows = (entries: AuditEntry[]): AuditExportRow[] =>
  entries.map(l => ({
    Timestamp: new Date(l.ts).toLocaleString(),
    User: l.userEmail,
    Action: auditActionLabel(l.action),
    Entity: l.entityType,
    'Entity ID': l.entityId || '',
    Change: auditChangeSummary(l.before, l.after)
      ?? [l.before && `before: ${JSON.stringify(l.before)}`, l.after && `after: ${JSON.stringify(l.after)}`].filter(Boolean).join('  '),
  }));

/**
 * The top-level settings sections that differ between two AppSettings snapshots
 * (e.g. ['tax', 'labels']). Recorded on a settings save so the audit trail shows
 * WHAT changed instead of a bare "Settings updated". Empty when nothing changed.
 */
export const changedSettingsSections = (
  prev: AppSettings | undefined,
  next: AppSettings | undefined,
): string[] => {
  const a = (prev ?? {}) as Record<string, unknown>;
  const b = (next ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) changed.push(k);
  }
  return changed.sort();
};
