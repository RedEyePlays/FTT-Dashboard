import React, { useState } from 'react';
import { UserPlus, UserCheck, X, AlertTriangle } from 'lucide-react';
import { Customer } from '../types';
import { CustomerSearchInput } from './CustomerSearchInput';
import { findCustomerByContact, CustomerDraft } from '../domain/customers';
import { formatPhoneInput } from '../domain/phone';

// The "Bought From" field, everywhere it appears (Quick Purchase, the Add/Edit
// Item modal, the full Data Entry form) — one component so the same field never
// behaves two different ways.
//
// Buyers and sellers are the SAME people: one customer record per person. So
// this reuses CustomerSearchInput — the exact picker used at checkout and on
// repair intake — rather than introducing a third customer search.
//
// Linking stays OPTIONAL: the free-text name is always editable and always
// saved, so a one-off seller you don't want to record costs nothing extra and
// Quick Purchase stays fast. Legacy rows (free text, no id) simply show their
// text.

export interface SellerValue {
  boughtFrom: string;              // free-text seller name (always kept)
  boughtFromCustomerId?: string;   // link, when one was chosen/created
  boughtFromPhone?: string;        // snapshot of the seller's phone at purchase
}

interface Props {
  value: SellerValue;
  onChange: (v: SellerValue) => void;
  customers?: Customer[];
  // Create-and-link a new customer inline. Runs duplicate detection on the
  // caller's side too; omit the prop to hide inline creation entirely (e.g.
  // for a role that may not add customers).
  onCreateCustomer?: (draft: CustomerDraft) => Customer | undefined;
  label?: string;
  placeholder?: string;
  inputClassName?: string;
  labelClassName?: string;
}

const DEFAULT_INPUT = 'w-full px-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500';
const DEFAULT_LABEL = 'block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1';

export const SellerCustomerField: React.FC<Props> = ({
  value, onChange, customers = [], onCreateCustomer,
  label = 'Source / Bought From', placeholder = 'Seller name (optional)',
  inputClassName = DEFAULT_INPUT, labelClassName = DEFAULT_LABEL,
}) => {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', phone: '', email: '' });

  const linked = value.boughtFromCustomerId
    ? customers.find(c => c.id === value.boughtFromCustomerId)
    : undefined;

  // Duplicate detection, live: the same phone/email rule the Customers view
  // uses to flag duplicates, applied BEFORE a second record can be created.
  const dupe = adding ? findCustomerByContact(customers, { phone: draft.phone, email: draft.email }) : undefined;

  const select = (c: Customer) => {
    onChange({ boughtFrom: c.name || c.company || value.boughtFrom, boughtFromCustomerId: c.id, boughtFromPhone: c.phone || undefined });
    setAdding(false);
  };

  const unlink = () => onChange({ boughtFrom: value.boughtFrom, boughtFromCustomerId: undefined, boughtFromPhone: undefined });

  const openAdd = () => {
    setDraft({ name: value.boughtFrom.trim(), phone: '', email: '' });
    setAdding(true);
  };

  const create = () => {
    if (!onCreateCustomer || !draft.name.trim()) return;
    const created = onCreateCustomer({ name: draft.name.trim(), phone: draft.phone.trim(), email: draft.email.trim() });
    if (created) select(created);
    else setAdding(false);
  };

  return (
    <div>
      <label className={labelClassName}>{label}</label>

      {/* Linked: show who, with a one-click way back to free text. */}
      {value.boughtFromCustomerId ? (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-200 dark:border-emerald-500/40 bg-emerald-50 dark:bg-emerald-900/20">
          <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200 truncate">
              {linked?.name || linked?.company || value.boughtFrom || 'Linked customer'}
            </p>
            <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 truncate">
              Linked to customer{linked?.phone ? ` · ${linked.phone}` : value.boughtFromPhone ? ` · ${value.boughtFromPhone}` : ''}
            </p>
          </div>
          <button type="button" onClick={unlink} title="Unlink customer"
            className="shrink-0 p-1 rounded text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {customers.length > 0 && (
            <CustomerSearchInput customers={customers} onSelect={select} placeholder="Find existing customer…" />
          )}
          <input
            className={inputClassName}
            placeholder={placeholder}
            value={value.boughtFrom}
            onChange={e => onChange({ ...value, boughtFrom: e.target.value, boughtFromCustomerId: undefined })}
          />
          {onCreateCustomer && !adding && (
            <button type="button" onClick={openAdd}
              className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
              <UserPlus className="w-3.5 h-3.5" /> Add as a new customer
            </button>
          )}
          {onCreateCustomer && adding && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2 bg-slate-50 dark:bg-slate-800/50">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">New customer</p>
              <input className={inputClassName} placeholder="Name" value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
              <input className={inputClassName} type="tel" inputMode="tel" placeholder="Phone" value={draft.phone}
                onChange={e => setDraft(d => ({ ...d, phone: formatPhoneInput(e.target.value) }))} />
              <input className={inputClassName} type="email" inputMode="email" placeholder="Email (optional)" value={draft.email}
                onChange={e => setDraft(d => ({ ...d, email: e.target.value }))} />
              {dupe && (
                <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                  <span>
                    {dupe.customer.name || dupe.customer.company || 'A customer'} already has this {dupe.matchedOn} —
                    saving links to that existing record instead of creating a duplicate.
                  </span>
                </p>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={create} disabled={!draft.name.trim()}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-semibold">
                  {dupe ? 'Link existing customer' : 'Create & link'}
                </button>
                <button type="button" onClick={() => setAdding(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
