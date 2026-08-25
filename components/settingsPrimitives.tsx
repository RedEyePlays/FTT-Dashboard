import React from 'react';

// Reusable building blocks for the Settings module. Kept deliberately small and
// presentational so every settings section reads the same way. All controls are
// theme-aware and sized for both desktop and touch.

export const SettingsSection: React.FC<{
  title: string;
  description?: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <section className="space-y-4">
    <div>
      <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">{title}</h2>
      {description && <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>}
    </div>
    <div className="space-y-4">{children}</div>
  </section>
);

export const SettingsCard: React.FC<{
  title?: string;
  description?: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 sm:p-5 shadow-sm">
    {title && <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h3>}
    {description && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 mb-3">{description}</p>}
    <div className={title && !description ? 'mt-3' : ''}>{children}</div>
  </div>
);

const labelCls = 'text-sm font-medium text-slate-700 dark:text-slate-200';
const hintCls = 'text-xs text-slate-400 dark:text-slate-500 mt-0.5';
const inputCls =
  'w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 ' +
  'px-3 py-2 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition';

export const SettingsToggle: React.FC<{
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}> = ({ label, hint, checked, onChange, disabled }) => (
  <label className={`flex items-center justify-between gap-4 py-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
    <span className="min-w-0">
      <span className={`block ${labelCls}`}>{label}</span>
      {hint && <span className={`block ${hintCls}`}>{hint}</span>}
    </span>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? 'bg-indigo-600' : 'bg-slate-300 dark:bg-slate-600'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  </label>
);

export const SettingsSelect: React.FC<{
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}> = ({ label, hint, value, onChange, options, disabled }) => (
  <label className="block py-2">
    <span className={labelCls}>{label}</span>
    {hint && <span className={`block ${hintCls} mb-1`}>{hint}</span>}
    <select
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className={`${inputCls} mt-1 disabled:opacity-50`}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </label>
);

export const SettingsTextField: React.FC<{
  label: string;
  hint?: string;
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'number' | 'email' | 'tel' | 'url';
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
}> = ({ label, hint, value, onChange, placeholder, type = 'text', min, max, step, disabled, onFocus }) => (
  <label className="block py-2">
    <span className={labelCls}>{label}</span>
    {hint && <span className={`block ${hintCls} mb-1`}>{hint}</span>}
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      onChange={e => onChange(e.target.value)}
      onFocus={onFocus}
      className={`${inputCls} mt-1 disabled:opacity-50`}
    />
  </label>
);
