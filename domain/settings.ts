import { ViewState, RepairStatus } from '../types';
import { REPAIR_STATUSES } from './repairs';

// Central, owner-configurable business settings. Persisted in Firestore (the
// workspace meta doc) so the shop can be configured without code changes.
// `mergeSettings` layers a stored partial over the defaults, so new fields are
// forward-compatible and older docs keep working.

export type ThemeMode = 'light' | 'dark' | 'system';
export type PaymentMethodKey = 'cash' | 'card' | 'mixed' | 'etransfer' | 'storeCredit';

export interface RepairStatusConfig { key: RepairStatus; label: string; color: string }

// A label-stock size, shared by the browser/HTML print path (labelLayout.ts's
// LabelMedia) and the Zebra ZPL path (zpl.ts's LabelDims) — same shape so a size
// defined once works for both printers. Geometry is in INCHES (landscape content
// orientation); `dymo` marks DYMO address stock (portrait-fed, content rotated
// 90°). `custom` marks a user-added size (removable) vs a built-in preset.
export interface LabelSize {
  id: string;
  label: string;
  w: number;       // inches
  h: number;       // inches
  dymo?: boolean;
  custom?: boolean;
}

const mmToIn = (v: number) => v / 25.4;

// The five built-in presets. These must keep working exactly as before — the ids
// match the previous fixed union (dymo-36x89 / 2x1 / 2x2 / 2x3 / 4x6).
export const BUILT_IN_LABEL_SIZES: LabelSize[] = [
  { id: 'dymo-36x89', label: 'DYMO 36 × 89 mm', w: mmToIn(89), h: mmToIn(36), dymo: true },
  { id: '2x1', label: '2 × 1"', w: 2, h: 1 },
  { id: '2x2', label: '2 × 2"', w: 2, h: 2 },
  { id: '2x3', label: '2 × 3"', w: 2, h: 3 },
  { id: '4x6', label: '4 × 6"', w: 4, h: 6 },
];

// Merge the built-in presets with the user's custom sizes into one open list.
// Built-ins always come first and can't be overridden or removed; invalid or
// built-in-clashing custom entries are dropped, and the rest are tagged custom.
export function mergeLabelSizes(custom?: LabelSize[] | null): LabelSize[] {
  const builtIns = BUILT_IN_LABEL_SIZES.map(s => ({ ...s, custom: false }));
  const seen = new Set(builtIns.map(s => s.id));
  const extra: LabelSize[] = [];
  for (const c of Array.isArray(custom) ? custom : []) {
    if (!c || typeof c.id !== 'string' || !c.id.trim()) continue;
    if (seen.has(c.id)) continue; // no overriding a built-in, no duplicates
    if (!(typeof c.w === 'number' && c.w > 0 && typeof c.h === 'number' && c.h > 0)) continue;
    seen.add(c.id);
    extra.push({ id: c.id, label: (c.label || c.id).trim() || c.id, w: c.w, h: c.h, dymo: !!c.dymo, custom: true });
  }
  return [...builtIns, ...extra];
}

export interface AppSettings {
  general: {
    storeName: string;
    logoUrl: string;
    address: string;
    phone: string;
    email: string;
    website: string;
    businessNumber: string;
    currency: string;      // ISO code, e.g. CAD
    timeZone: string;      // IANA tz
    dateFormat: 'YYYY-MM-DD' | 'MM/DD/YYYY' | 'DD/MM/YYYY';
  };
  repairStatuses: RepairStatusConfig[];
  checkout: {
    defaultPaymentMethod: 'cash' | 'card' | 'mixed';
    requireCustomer: boolean;
    allowWalkIn: boolean;
    receiptPrinter: string;
  };
  payments: Record<PaymentMethodKey, boolean>;
  tax: {
    name: string;
    percent: number;
    inclusive: boolean;
    taxableCategories: string[];
  };
  labels: {
    defaultSize: string;         // id of a built-in preset or a custom size
    customSizes: LabelSize[];    // user-added sizes, merged with the built-ins
    barcodeFormat: 'CODE128' | 'EAN13';
    qrContent: 'sku' | 'id' | 'url' | 'imei';
    marginMm: number;
    density: number;       // Zebra ^MD darkness (-30..30)
    // Content padding + inter-line spacing for the non-Dymo (inch/ZP 450) HTML
    // label templates — self-serve tuning knobs since getting these right has
    // taken several rounds of physical print calibration. Undefined/omitted
    // means "use the built-in default" (labelLayout.ts / shelf/PDF paths each
    // fall back sensibly); Dymo labels keep their own separately-tuned constants.
    paddingMm?: number;
    lineSpacingMm?: number;
  };
  customers: {
    requirePhone: boolean;
    requireEmail: boolean;
    duplicateDetection: boolean;
    defaultTags: string[];
  };
  dashboard: {
    widgets: Record<string, boolean>;
    landingView: ViewState;
    analyticsRange: 'today' | 'yesterday' | 'last7' | 'month' | 'year';
  };
  appearance: {
    theme: ThemeMode;
  };
  backups: {
    enabled: boolean;                  // opt-in: run the scheduled Cloud Function for this workspace
    frequency: 'daily' | 'weekly';     // how often the automated snapshot is taken
    retention: number;                 // how many past automated backups to keep (older ones auto-deleted)
  };
  operations: {
    openingFloatDefault: number;       // default opening cash float pre-filled on the reconciliation screen
    voidWindowDays: number;            // how many days after a sale it can still be voided (0 = same day only)
    returnRestockingFeePercent: number;// default restocking fee % pre-filled when processing a return (0 = none)
    agingInventoryDays: number;        // unsold-device age (days) that triggers the aging-inventory alert
    autoLockMinutes: number;           // idle minutes before the auto-lock screen appears; 0 = never (must be chosen explicitly)
  };
}

export const DASHBOARD_WIDGETS = ['periods', 'inventory', 'repairs', 'recentSales', 'lowStock', 'topPlatforms'] as const;
export const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'AUD'];
export const TIME_ZONES = ['America/Toronto', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Vancouver', 'UTC', 'Europe/London'];

const STATUS_COLORS = ['slate', 'indigo', 'amber', 'orange', 'blue', 'purple', 'emerald', 'teal', 'rose'];
export const STATUS_COLOR_OPTIONS = STATUS_COLORS;
const defaultStatusColor: Record<string, string> = {
  received: 'slate', diagnosing: 'indigo', waiting_approval: 'amber', waiting_parts: 'orange',
  in_repair: 'blue', testing: 'purple', ready_pickup: 'emerald', completed: 'emerald', picked_up: 'teal', cancelled: 'rose',
};

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    storeName: 'FlipThatTech', logoUrl: '', address: '', phone: '', email: '', website: '',
    businessNumber: '', currency: 'CAD', timeZone: 'America/Toronto', dateFormat: 'YYYY-MM-DD',
  },
  repairStatuses: REPAIR_STATUSES.map(s => ({ key: s.value, label: s.label, color: defaultStatusColor[s.value] || 'slate' })),
  checkout: { defaultPaymentMethod: 'cash', requireCustomer: true, allowWalkIn: true, receiptPrinter: '' },
  payments: { cash: true, card: true, mixed: true, etransfer: true, storeCredit: false },
  tax: { name: 'HST', percent: 13, inclusive: false, taxableCategories: ['device', 'accessory'] },
  labels: { defaultSize: 'dymo-36x89', customSizes: [], barcodeFormat: 'CODE128', qrContent: 'sku', marginMm: 1, density: 0 },
  customers: { requirePhone: false, requireEmail: false, duplicateDetection: true, defaultTags: ['VIP', 'Wholesale', 'Business'] },
  dashboard: { widgets: Object.fromEntries(DASHBOARD_WIDGETS.map(w => [w, true])), landingView: 'dashboard', analyticsRange: 'today' },
  appearance: { theme: 'system' },
  backups: { enabled: false, frequency: 'daily', retention: 14 },
  operations: { openingFloatDefault: 0, voidWindowDays: 0, returnRestockingFeePercent: 0, agingInventoryDays: 30, autoLockMinutes: 4 },
};

// Deep-merge a stored partial over the defaults (one level per section is enough).
export function mergeSettings(partial?: DeepPartial<AppSettings>): AppSettings {
  const d = DEFAULT_SETTINGS;
  if (!partial) return d;
  return {
    general: { ...d.general, ...partial.general },
    repairStatuses: partial.repairStatuses && partial.repairStatuses.length ? partial.repairStatuses as RepairStatusConfig[] : d.repairStatuses,
    checkout: { ...d.checkout, ...partial.checkout },
    payments: { ...d.payments, ...partial.payments },
    tax: { ...d.tax, ...partial.tax, taxableCategories: partial.tax?.taxableCategories ?? d.tax.taxableCategories },
    labels: { ...d.labels, ...partial.labels, customSizes: (partial.labels?.customSizes as LabelSize[] | undefined) ?? d.labels.customSizes },
    customers: { ...d.customers, ...partial.customers, defaultTags: partial.customers?.defaultTags ?? d.customers.defaultTags },
    dashboard: { ...d.dashboard, ...partial.dashboard, widgets: { ...d.dashboard.widgets, ...partial.dashboard?.widgets } },
    appearance: { ...d.appearance, ...partial.appearance },
    backups: { ...d.backups, ...partial.backups },
    operations: { ...d.operations, ...partial.operations },
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
