import { ViewState, RepairStatus } from '../types';
import { REPAIR_STATUSES } from './repairs';

// Central, owner-configurable business settings. Persisted in Firestore (the
// workspace meta doc) so the shop can be configured without code changes.
// `mergeSettings` layers a stored partial over the defaults, so new fields are
// forward-compatible and older docs keep working.

export type ThemeMode = 'light' | 'dark' | 'system';
export type PaymentMethodKey = 'cash' | 'card' | 'mixed' | 'etransfer' | 'storeCredit';

export interface RepairStatusConfig { key: RepairStatus; label: string; color: string }

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
    defaultSize: 'dymo-36x89' | '2x1' | '2x2' | '2x3' | '4x6';
    barcodeFormat: 'CODE128' | 'EAN13';
    qrContent: 'sku' | 'id' | 'url';
    marginMm: number;
    density: number;       // Zebra ^MD darkness (-30..30)
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
  labels: { defaultSize: 'dymo-36x89', barcodeFormat: 'CODE128', qrContent: 'sku', marginMm: 1, density: 0 },
  customers: { requirePhone: false, requireEmail: false, duplicateDetection: true, defaultTags: ['VIP', 'Wholesale', 'Business'] },
  dashboard: { widgets: Object.fromEntries(DASHBOARD_WIDGETS.map(w => [w, true])), landingView: 'dashboard', analyticsRange: 'today' },
  appearance: { theme: 'system' },
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
    labels: { ...d.labels, ...partial.labels },
    customers: { ...d.customers, ...partial.customers, defaultTags: partial.customers?.defaultTags ?? d.customers.defaultTags },
    dashboard: { ...d.dashboard, ...partial.dashboard, widgets: { ...d.dashboard.widgets, ...partial.dashboard?.widgets } },
    appearance: { ...d.appearance, ...partial.appearance },
  };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
