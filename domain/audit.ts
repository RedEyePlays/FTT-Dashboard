import { AppSettings } from './settings';

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
  'dropoff.settle': 'Runner settled',
  'runner.edit': 'Runner edited',
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
