import React, { useState } from 'react';
import { Star, X, Copy, Check, MessageSquare, Mail } from 'lucide-react';
import { Customer } from '../types';
import { ReviewEligibility, renderReviewMessage, smsDeepLink, whatsappDeepLink } from '../domain/reviews';
import { useEscapeKey } from '../hooks/useEscapeKey';

const REASON_LABEL: Record<NonNullable<ReviewEligibility['reason']>, string> = {
  opted_out: 'This customer has opted out of review requests.',
  warranty_claim: 'This was a warranty claim — not a happy-path visit to ask for a review on.',
  cancelled: 'This ticket was cancelled — no completed work to ask about.',
  reversed: 'This sale was voided or returned — no completed sale to ask about.',
  requested_recently: 'A review was already requested from this customer recently.',
};

interface Props {
  customer: Customer;
  eligibility: ReviewEligibility;
  shopName: string;
  reviewLink: string;
  template: string;
  onClose: () => void;
  onSend: (customer: Customer, channel: 'sms' | 'whatsapp' | 'email' | 'manual') => void;
}

// No sentiment pre-screening here by design (domain/reviews.ts's comment) —
// every eligible customer sees the exact same message and the exact same
// send options; there is no "were you happy?" gate anywhere in this flow.
export const RequestReviewModal: React.FC<Props> = ({ customer, eligibility, shopName, reviewLink, template, onClose, onSend }) => {
  const [copied, setCopied] = useState(false);
  useEscapeKey(onClose);

  const message = renderReviewMessage(template, { shopName, name: customer.name, link: reviewLink });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      onSend(customer, 'manual');
    } catch {
      // Clipboard access denied — the text is still visible in the preview
      // for the staff member to select manually.
    }
  };

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2"><Star className="w-5 h-5 text-amber-500" /> Request a review</h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
        </div>

        {!eligibility.eligible ? (
          <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-300 rounded-lg p-3 text-sm">
            {eligibility.reason ? REASON_LABEL[eligibility.reason] : 'Not eligible for a review request right now.'}
          </div>
        ) : (
          <>
            <div>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Preview — sent to {customer.name || 'this customer'}</p>
              <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">{message}</div>
            </div>
            <div className="grid grid-cols-1 gap-2">
              <button onClick={copy} className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied!' : 'Copy message'}
              </button>
              {customer.phone && (
                <a href={smsDeepLink(customer.phone, message, isIOS ? '&' : '?')} onClick={() => onSend(customer, 'sms')}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400">
                  <MessageSquare className="w-4 h-4" /> Open in Messages
                </a>
              )}
              {customer.phone && (
                <a href={whatsappDeepLink(customer.phone, message)} target="_blank" rel="noreferrer" onClick={() => onSend(customer, 'whatsapp')}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-emerald-400">
                  <MessageSquare className="w-4 h-4" /> Open in WhatsApp
                </a>
              )}
              {customer.email && (
                <a href={`mailto:${customer.email}?subject=${encodeURIComponent(`How did we do, ${customer.name}?`)}&body=${encodeURIComponent(message)}`} onClick={() => onSend(customer, 'email')}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:border-indigo-400">
                  <Mail className="w-4 h-4" /> Open in Email
                </a>
              )}
            </div>
            <p className="text-xs text-slate-400">Every eligible customer gets the exact same request — reviews are never pre-screened by how happy they seemed.</p>
          </>
        )}
      </div>
    </div>
  );
};
