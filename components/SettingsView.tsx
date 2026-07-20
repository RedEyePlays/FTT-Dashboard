import React, { useMemo, useState } from 'react';
import {
  Store, Building2, Wrench, ShoppingCart, Percent, Tag, Contact, LayoutDashboard,
  Palette, ShieldCheck, DatabaseBackup, Info, Save, RotateCcw, Check, Lock,
} from 'lucide-react';
import { Role, Permission } from '../types';
import {
  AppSettings, ThemeMode, PaymentMethodKey, CURRENCIES, TIME_ZONES,
  DASHBOARD_WIDGETS, STATUS_COLOR_OPTIONS,
} from '../domain/settings';
import { ROLE_PERMISSIONS, ROLE_LABEL } from '../services/rbac';
import { REPAIR_STATUS_LABEL } from '../domain/repairs';
import { useIsMobile } from '../hooks/useMediaQuery';
import { SettingsSection, SettingsCard, SettingsToggle, SettingsSelect, SettingsTextField } from './settingsPrimitives';

// The centralized Settings module. Owners configure the whole business here —
// store profile, repairs, checkout/payments, taxes, labels, customers,
// dashboard, appearance, roles and backups — without touching code. Values are
// held in a local draft and persisted (to Firestore) only when Save is pressed.

type SectionId =
  | 'general' | 'store' | 'repairs' | 'checkout' | 'taxes' | 'labels'
  | 'customers' | 'dashboard' | 'appearance' | 'roles' | 'data' | 'about';

const SECTIONS: { id: SectionId; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Store className="w-4 h-4" /> },
  { id: 'store', label: 'Store Profile', icon: <Building2 className="w-4 h-4" /> },
  { id: 'repairs', label: 'Repairs', icon: <Wrench className="w-4 h-4" /> },
  { id: 'checkout', label: 'Checkout & Payments', icon: <ShoppingCart className="w-4 h-4" /> },
  { id: 'taxes', label: 'Taxes', icon: <Percent className="w-4 h-4" /> },
  { id: 'labels', label: 'Labels & Printing', icon: <Tag className="w-4 h-4" /> },
  { id: 'customers', label: 'Customers', icon: <Contact className="w-4 h-4" /> },
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'appearance', label: 'Appearance', icon: <Palette className="w-4 h-4" /> },
  { id: 'roles', label: 'Security & Roles', icon: <ShieldCheck className="w-4 h-4" /> },
  { id: 'data', label: 'Data & Backups', icon: <DatabaseBackup className="w-4 h-4" /> },
  { id: 'about', label: 'About', icon: <Info className="w-4 h-4" /> },
];

const WIDGET_LABELS: Record<string, string> = {
  periods: 'Period summary cards', inventory: 'Inventory snapshot', repairs: 'Repairs snapshot',
  recentSales: 'Recent sales', lowStock: 'Low-stock alerts', topPlatforms: 'Top platforms',
};

const LANDING_OPTIONS: { value: string; label: string }[] = [
  { value: 'dashboard', label: 'Dashboard' },
  { value: 'grid', label: 'Inventory' },
  { value: 'pos', label: 'Quick Sale' },
  { value: 'repairs', label: 'Repairs' },
  { value: 'customers', label: 'Customers' },
];

interface Props {
  settings: AppSettings;
  onSave: (next: AppSettings) => void | Promise<void>;
  canManage: boolean;
  role: Role;
  appVersion?: string;
  backupSlot?: React.ReactNode;
}

export const SettingsView: React.FC<Props> = ({ settings, onSave, canManage, role, appVersion = '1.0.0', backupSlot }) => {
  const isMobile = useIsMobile();
  const [active, setActive] = useState<SectionId>('general');
  const [draft, setDraft] = useState<AppSettings>(settings);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // Keep the draft in sync if the persisted settings change underneath us
  // (e.g. another device saved) — but only when there are no local edits.
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);
  React.useEffect(() => { if (!dirty) setDraft(settings); /* eslint-disable-next-line */ }, [settings]);

  // Section-scoped updater: patch(section, partialFields)
  const patch = <K extends keyof AppSettings>(section: K, value: Partial<AppSettings[K]>) =>
    setDraft(d => ({ ...d, [section]: { ...(d[section] as object), ...value } }));

  const handleSave = async () => {
    if (!canManage) return;
    setBusy(true);
    try {
      await onSave(draft);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally { setBusy(false); }
  };

  const readOnly = !canManage;

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 py-4 sm:py-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Settings</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Configure your business without touching code.</p>
        </div>
        {!readOnly && (
          <div className="flex items-center gap-2 shrink-0">
            {dirty && (
              <button onClick={() => setDraft(settings)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg">
                <RotateCcw className="w-4 h-4" /> Reset
              </button>
            )}
            <button onClick={handleSave} disabled={!dirty || busy}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium shadow-sm transition-colors">
              {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
              {saved ? 'Saved' : 'Save changes'}
            </button>
          </div>
        )}
      </div>

      {readOnly && (
        <div className="mb-4 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30 rounded-lg px-3 py-2">
          <Lock className="w-4 h-4 shrink-0" /> You have read-only access. Only owners can change settings.
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-5">
        {/* Sidebar (desktop) / horizontal chip scroller (mobile) */}
        <nav className={isMobile
          ? 'flex gap-2 overflow-x-auto -mx-3 px-3 pb-1 no-scrollbar'
          : 'w-56 shrink-0 space-y-1'}>
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setActive(s.id)}
              className={`flex items-center gap-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                isMobile ? 'px-3 py-2 shrink-0' : 'w-full px-3 py-2'
              } ${active === s.id
                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
              {s.icon}<span>{s.label}</span>
            </button>
          ))}
        </nav>

        {/* Active section */}
        <div className="flex-1 min-w-0">
          <fieldset disabled={readOnly} className={readOnly ? 'opacity-70' : ''}>
            {active === 'general' && <GeneralSection draft={draft} patch={patch} />}
            {active === 'store' && <StoreSection draft={draft} patch={patch} />}
            {active === 'repairs' && <RepairsSection draft={draft} setDraft={setDraft} />}
            {active === 'checkout' && <CheckoutSection draft={draft} patch={patch} togglePay={(k, v) => patch('payments', { [k]: v } as any)} />}
            {active === 'taxes' && <TaxesSection draft={draft} patch={patch} />}
            {active === 'labels' && <LabelsSection draft={draft} patch={patch} />}
            {active === 'customers' && <CustomersSection draft={draft} patch={patch} />}
            {active === 'dashboard' && <DashboardSection draft={draft} patch={patch} />}
            {active === 'appearance' && <AppearanceSection draft={draft} patch={patch} />}
            {active === 'roles' && <RolesSection />}
            {active === 'data' && <DataSection backupSlot={backupSlot} />}
            {active === 'about' && <AboutSection appVersion={appVersion} role={role} />}
          </fieldset>

          {/* Sticky mobile save bar */}
          {!readOnly && dirty && isMobile && (
            <div className="sticky bottom-0 mt-4 -mx-3 px-3 py-3 bg-white/90 dark:bg-slate-950/90 backdrop-blur border-t border-slate-200 dark:border-slate-800 safe-b flex gap-2">
              <button onClick={() => setDraft(settings)} className="px-4 py-2.5 text-sm text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-lg">Reset</button>
              <button onClick={handleSave} disabled={busy} className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium">
                {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />} {saved ? 'Saved' : 'Save changes'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ------------------------------ Sections ------------------------------ */

type PatchFn = <K extends keyof AppSettings>(section: K, value: Partial<AppSettings[K]>) => void;

const GeneralSection: React.FC<{ draft: AppSettings; patch: PatchFn }> = ({ draft, patch }) => (
  <SettingsSection title="General" description="Core identity and regional formatting.">
    <SettingsCard>
      <SettingsTextField label="Store name" value={draft.general.storeName} onChange={v => patch('general', { storeName: v })} placeholder="FlipThatTech" />
      <SettingsSelect label="Currency" value={draft.general.currency} onChange={v => patch('general', { currency: v })}
        options={CURRENCIES.map(c => ({ value: c, label: c }))} />
      <SettingsSelect label="Time zone" value={draft.general.timeZone} onChange={v => patch('general', { timeZone: v })}
        options={TIME_ZONES.map(t => ({ value: t, label: t }))} />
      <SettingsSelect label="Date format" value={draft.general.dateFormat} onChange={v => patch('general', { dateFormat: v as any })}
        options={[
          { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD (2026-07-20)' },
          { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (07/20/2026)' },
          { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (20/07/2026)' },
        ]} />
    </SettingsCard>
  </SettingsSection>
);

const StoreSection: React.FC<{ draft: AppSettings; patch: PatchFn }> = ({ draft, patch }) => (
  <SettingsSection title="Store Profile" description="Contact details used on receipts, labels and documents.">
    <SettingsCard>
      <SettingsTextField label="Address" value={draft.general.address} onChange={v => patch('general', { address: v })} placeholder="123 Main St, Toronto, ON" />
      <SettingsTextField label="Phone" type="tel" value={draft.general.phone} onChange={v => patch('general', { phone: v })} placeholder="(555) 123-4567" />
      <SettingsTextField label="Email" type="email" value={draft.general.email} onChange={v => patch('general', { email: v })} placeholder="shop@flipthattech.com" />
      <SettingsTextField label="Website" type="url" value={draft.general.website} onChange={v => patch('general', { website: v })} placeholder="https://flipthattech.com" />
      <SettingsTextField label="Business / tax number" value={draft.general.businessNumber} onChange={v => patch('general', { businessNumber: v })} placeholder="Optional" />
      <SettingsTextField label="Logo URL" value={draft.general.logoUrl} onChange={v => patch('general', { logoUrl: v })} hint="Shown on documents where supported." placeholder="https://…/logo.png" />
    </SettingsCard>
  </SettingsSection>
);

const RepairsSection: React.FC<{ draft: AppSettings; setDraft: React.Dispatch<React.SetStateAction<AppSettings>> }> = ({ draft, setDraft }) => {
  const move = (i: number, dir: -1 | 1) => setDraft(d => {
    const arr = [...d.repairStatuses];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return d;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    return { ...d, repairStatuses: arr };
  });
  const setField = (i: number, f: 'label' | 'color', v: string) => setDraft(d => {
    const arr = d.repairStatuses.map((s, k) => k === i ? { ...s, [f]: v } : s);
    return { ...d, repairStatuses: arr };
  });
  return (
    <SettingsSection title="Repairs" description="Rename and reorder repair statuses, and set their badge colors. The underlying workflow is unchanged.">
      <SettingsCard>
        <div className="space-y-2">
          {draft.repairStatuses.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div className="flex flex-col text-slate-300 dark:text-slate-600">
                <button type="button" aria-label="Move up" onClick={() => move(i, -1)} className="hover:text-slate-500 disabled:opacity-30" disabled={i === 0}>▲</button>
                <button type="button" aria-label="Move down" onClick={() => move(i, 1)} className="hover:text-slate-500 disabled:opacity-30" disabled={i === draft.repairStatuses.length - 1}>▼</button>
              </div>
              <input value={s.label} onChange={e => setField(i, 'label', e.target.value)}
                className="flex-1 min-w-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <select value={s.color} onChange={e => setField(i, 'color', e.target.value)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-2 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500">
                {STATUS_COLOR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="text-xs text-slate-400 w-16 hidden sm:block truncate" title={REPAIR_STATUS_LABEL[s.key]}>{s.key}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">Adding or removing statuses isn't supported — the set is fixed by the repair workflow. You can rename, recolor and reorder them.</p>
      </SettingsCard>
    </SettingsSection>
  );
};

const PAYMENT_LABELS: Record<PaymentMethodKey, string> = {
  cash: 'Cash', card: 'Card', mixed: 'Mixed (split)', etransfer: 'E-Transfer', storeCredit: 'Store credit',
};

const CheckoutSection: React.FC<{ draft: AppSettings; patch: PatchFn; togglePay: (k: PaymentMethodKey, v: boolean) => void }> = ({ draft, patch, togglePay }) => (
  <SettingsSection title="Checkout & Payments" description="Point-of-sale defaults and which payment methods are accepted.">
    <SettingsCard title="Checkout">
      <SettingsSelect label="Default payment method" value={draft.checkout.defaultPaymentMethod} onChange={v => patch('checkout', { defaultPaymentMethod: v as any })}
        options={[{ value: 'cash', label: 'Cash' }, { value: 'card', label: 'Card' }, { value: 'mixed', label: 'Mixed' }]} />
      <SettingsToggle label="Require a customer" hint="Prompt for a customer before completing a sale." checked={draft.checkout.requireCustomer} onChange={v => patch('checkout', { requireCustomer: v })} />
      <SettingsToggle label="Allow walk-in sales" hint="Permit sales without attaching a customer record." checked={draft.checkout.allowWalkIn} onChange={v => patch('checkout', { allowWalkIn: v })} />
      <SettingsTextField label="Receipt printer name" value={draft.checkout.receiptPrinter} onChange={v => patch('checkout', { receiptPrinter: v })} placeholder="Optional" />
    </SettingsCard>
    <SettingsCard title="Accepted payment methods">
      {(Object.keys(PAYMENT_LABELS) as PaymentMethodKey[]).map(k => (
        <SettingsToggle key={k} label={PAYMENT_LABELS[k]} checked={draft.payments[k]} onChange={v => togglePay(k, v)} />
      ))}
    </SettingsCard>
  </SettingsSection>
);

const TaxesSection: React.FC<{ draft: AppSettings; patch: PatchFn }> = ({ draft, patch }) => (
  <SettingsSection title="Taxes" description="Sales tax applied at checkout. The rate feeds the Quick Sale calculator.">
    <SettingsCard>
      <SettingsTextField label="Tax name" value={draft.tax.name} onChange={v => patch('tax', { name: v })} placeholder="HST" />
      <SettingsTextField label="Rate (%)" type="number" min={0} max={100} step={0.01} value={draft.tax.percent}
        onChange={v => patch('tax', { percent: Math.max(0, Math.min(100, parseFloat(v) || 0)) })} />
      <SettingsToggle label="Prices include tax" hint="Treat listed prices as tax-inclusive." checked={draft.tax.inclusive} onChange={v => patch('tax', { inclusive: v })} />
    </SettingsCard>
  </SettingsSection>
);

const LabelsSection: React.FC<{ draft: AppSettings; patch: PatchFn }> = ({ draft, patch }) => (
  <SettingsSection title="Labels & Printing" description="Defaults for the inventory and repair label printer.">
    <SettingsCard>
      <SettingsSelect label="Default label size" value={draft.labels.defaultSize} onChange={v => patch('labels', { defaultSize: v as any })}
        options={[
          { value: 'dymo-36x89', label: 'DYMO 36×89mm (primary)' },
          { value: '2x1', label: '2×1 in' }, { value: '2x2', label: '2×2 in' },
          { value: '2x3', label: '2×3 in' }, { value: '4x6', label: '4×6 in' },
        ]} />
      <SettingsSelect label="Barcode format" value={draft.labels.barcodeFormat} onChange={v => patch('labels', { barcodeFormat: v as any })}
        options={[{ value: 'CODE128', label: 'CODE128' }, { value: 'EAN13', label: 'EAN-13' }]} />
      <SettingsSelect label="QR encodes" value={draft.labels.qrContent} onChange={v => patch('labels', { qrContent: v as any })}
        options={[{ value: 'sku', label: 'SKU' }, { value: 'id', label: 'Item ID' }, { value: 'url', label: 'Lookup URL' }]} />
      <SettingsTextField label="Margin (mm)" type="number" min={0} max={10} step={0.5} value={draft.labels.marginMm} onChange={v => patch('labels', { marginMm: parseFloat(v) || 0 })} />
      <SettingsTextField label="Print density (Zebra ^MD)" type="number" min={-30} max={30} step={1} value={draft.labels.density} onChange={v => patch('labels', { density: Math.round(parseFloat(v) || 0) })} hint="-30 (light) to 30 (dark)." />
    </SettingsCard>
  </SettingsSection>
);

const CustomersSection: React.FC<{ draft: AppSettings; patch: PatchFn }> = ({ draft, patch }) => (
  <SettingsSection title="Customers" description="Required fields and CRM behavior.">
    <SettingsCard>
      <SettingsToggle label="Require phone number" checked={draft.customers.requirePhone} onChange={v => patch('customers', { requirePhone: v })} />
      <SettingsToggle label="Require email" checked={draft.customers.requireEmail} onChange={v => patch('customers', { requireEmail: v })} />
      <SettingsToggle label="Duplicate detection" hint="Warn when a new customer matches an existing phone or email." checked={draft.customers.duplicateDetection} onChange={v => patch('customers', { duplicateDetection: v })} />
      <SettingsTextField label="Default tags" hint="Comma-separated. Offered as quick-add tags." value={draft.customers.defaultTags.join(', ')}
        onChange={v => patch('customers', { defaultTags: v.split(',').map(t => t.trim()).filter(Boolean) })} />
    </SettingsCard>
  </SettingsSection>
);

const DashboardSection: React.FC<{ draft: AppSettings; patch: PatchFn }> = ({ draft, patch }) => (
  <SettingsSection title="Dashboard" description="Landing page and which home widgets are shown.">
    <SettingsCard title="Landing">
      <SettingsSelect label="Default landing page" value={draft.dashboard.landingView as string} onChange={v => patch('dashboard', { landingView: v as any })} options={LANDING_OPTIONS} />
      <SettingsSelect label="Default analytics range" value={draft.dashboard.analyticsRange} onChange={v => patch('dashboard', { analyticsRange: v as any })}
        options={[
          { value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' },
          { value: 'last7', label: 'Last 7 days' }, { value: 'month', label: 'This month' }, { value: 'year', label: 'This year' },
        ]} />
    </SettingsCard>
    <SettingsCard title="Home widgets">
      {DASHBOARD_WIDGETS.map(w => (
        <SettingsToggle key={w} label={WIDGET_LABELS[w] || w} checked={draft.dashboard.widgets[w] !== false}
          onChange={v => patch('dashboard', { widgets: { ...draft.dashboard.widgets, [w]: v } })} />
      ))}
    </SettingsCard>
  </SettingsSection>
);

const AppearanceSection: React.FC<{ draft: AppSettings; patch: PatchFn }> = ({ draft, patch }) => (
  <SettingsSection title="Appearance" description="Theme for this workspace.">
    <SettingsCard>
      <div className="grid grid-cols-3 gap-2">
        {(['light', 'dark', 'system'] as ThemeMode[]).map(t => (
          <button key={t} type="button" onClick={() => patch('appearance', { theme: t })}
            className={`py-3 rounded-lg border text-sm font-medium capitalize transition-colors ${
              draft.appearance.theme === t
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
            {t}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">"System" follows your device's light/dark preference.</p>
    </SettingsCard>
  </SettingsSection>
);

const ROLE_ORDER: Role[] = ['owner', 'manager', 'employee', 'technician'];
const PERM_ROWS: { perm: Permission; label: string }[] = [
  { perm: 'inventory.add', label: 'Add inventory' },
  { perm: 'inventory.edit', label: 'Edit inventory' },
  { perm: 'inventory.delete', label: 'Delete inventory' },
  { perm: 'sales.complete', label: 'Complete sales' },
  { perm: 'repairs.tech', label: 'Work on repairs' },
  { perm: 'repairs.manage', label: 'Manage repairs' },
  { perm: 'reports.view', label: 'View reports' },
  { perm: 'reports.profit', label: 'See profit / margins' },
  { perm: 'users.tech', label: 'Manage technicians' },
  { perm: 'users.manage', label: 'Manage all users' },
  { perm: 'audit.view', label: 'View audit log' },
  { perm: 'backup.export', label: 'Export backups' },
  { perm: 'settings.manage', label: 'Manage settings' },
];

const RolesSection: React.FC = () => {
  const has = (role: Role, perm: Permission) => {
    if (perm === 'reports.profit') return role === 'owner'; // owner-default; others via per-user override
    return ROLE_PERMISSIONS[role].includes(perm);
  };
  return (
    <SettingsSection title="Security & Roles" description="Reference matrix of what each role can do. Roles are fixed to protect data integrity; assign roles per user in the Users area.">
      <SettingsCard>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <th className="py-2 pr-3 font-medium">Capability</th>
                {ROLE_ORDER.map(r => <th key={r} className="py-2 px-2 font-medium text-center">{ROLE_LABEL[r]}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERM_ROWS.map(row => (
                <tr key={row.perm} className="border-b border-slate-100 dark:border-slate-800/60">
                  <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">{row.label}</td>
                  {ROLE_ORDER.map(r => (
                    <td key={r} className="py-2 px-2 text-center">
                      {has(r, row.perm)
                        ? <Check className="w-4 h-4 text-emerald-500 inline" />
                        : <span className="text-slate-300 dark:text-slate-600">—</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">Profit visibility for managers/employees can be granted per user via the "allow profit" override in the Users area.</p>
      </SettingsCard>
    </SettingsSection>
  );
};

const DataSection: React.FC<{ backupSlot?: React.ReactNode }> = ({ backupSlot }) => (
  <SettingsSection title="Data & Backups" description="Export your workspace data. Restores and imports are available from the backup dialog.">
    <SettingsCard>
      {backupSlot || <p className="text-sm text-slate-500 dark:text-slate-400">Backup tools are unavailable.</p>}
    </SettingsCard>
  </SettingsSection>
);

const AboutSection: React.FC<{ appVersion: string; role: Role }> = ({ appVersion, role }) => (
  <SettingsSection title="About" description="FlipThatTech Dashboard.">
    <SettingsCard>
      <dl className="text-sm divide-y divide-slate-100 dark:divide-slate-800">
        <div className="flex justify-between py-2"><dt className="text-slate-500 dark:text-slate-400">Application</dt><dd className="text-slate-800 dark:text-slate-100 font-medium">FlipThatTech Dashboard</dd></div>
        <div className="flex justify-between py-2"><dt className="text-slate-500 dark:text-slate-400">Version</dt><dd className="text-slate-800 dark:text-slate-100 font-medium">{appVersion}</dd></div>
        <div className="flex justify-between py-2"><dt className="text-slate-500 dark:text-slate-400">Your role</dt><dd className="text-slate-800 dark:text-slate-100 font-medium">{ROLE_LABEL[role]}</dd></div>
      </dl>
    </SettingsCard>
  </SettingsSection>
);
