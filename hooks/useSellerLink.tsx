import React, { useState } from 'react';
import { UserPlus, UserCheck } from 'lucide-react';
import { Customer } from '../types';
import { CustomerDraft } from '../domain/customers';
import {
  SellerLinkDecision, sellerLinkDecision, candidateLabel, askPrompt,
} from '../domain/sellerLink';

/**
 * ONE save-time path for "the seller they typed should become a customer".
 *
 * Every screen with a Bought From field calls `resolve` on save and renders
 * `prompt`. The decision is pure (domain/sellerLink.ts) and the actual write is
 * App.tsx's existing handleCreateCustomerInline → resolveCustomerForDraft —
 * neither is reimplemented here. This hook exists only so the ASK isn't written
 * out four times, once per screen, with four chances to differ.
 *
 * `resolve` is deliberately callback-based rather than a promise: the ambiguous
 * case has to wait for a click, and a dangling promise across an unmount is a
 * worse shape for that than a continuation the component owns.
 */
export interface UseSellerLink {
  /**
   * Decide, possibly ask, then hand back the customer id to store (or
   * undefined when there is nothing to link).
   */
  resolve: (
    seller: { name: string; phone?: string; customerId?: string; email?: string },
    done: (customerId: string | undefined) => void,
  ) => void;
  /** Render this somewhere in the screen; it is null unless a question is open. */
  prompt: React.ReactNode;
}

export const useSellerLink = (args: {
  customers: Customer[];
  onCreateCustomer?: (draft: CustomerDraft) => Customer | undefined;
}): UseSellerLink => {
  const { customers, onCreateCustomer } = args;
  const [pending, setPending] = useState<{
    decision: Extract<SellerLinkDecision, { action: 'ask' }>;
    done: (id: string | undefined) => void;
  } | null>(null);

  const create = (draft: CustomerDraft): string | undefined =>
    onCreateCustomer?.(draft)?.id;

  const resolve: UseSellerLink['resolve'] = (seller, done) => {
    // Without the ability to create customers there is nothing to do — the
    // free-text name is saved exactly as it always was.
    if (!onCreateCustomer) { done(seller.customerId); return; }
    const decision = sellerLinkDecision(customers, seller);
    switch (decision.action) {
      case 'none':
        done(seller.customerId);
        return;
      case 'link':
        // A contact match is not a guess. The DRAFT goes through the same path
        // (resolveCustomerForDraft finds the same record by the same rule) so a
        // newly-supplied phone or email enriches it rather than being dropped —
        // and so there is still only one place that writes a customer.
        done(create(decision.draft) ?? decision.customer.id);
        return;
      case 'create':
        done(create(decision.draft));
        return;
      case 'ask':
        // DON'T GUESS. A name with nothing to tell two people apart is a
        // question, asked once, with create-new a plain option.
        setPending({ decision, done });
        return;
    }
  };

  const answer = (customerId: string | undefined) => {
    const p = pending;
    setPending(null);
    p?.done(customerId);
  };

  const prompt = pending ? (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-sm border border-slate-200 dark:border-slate-700 p-5 space-y-3">
        <h3 className="font-bold text-slate-800 dark:text-slate-100">Which {pending.decision.draft.name}?</h3>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          {askPrompt(pending.decision.draft.name, pending.decision.candidates)}
        </p>
        <div className="space-y-1.5 max-h-56 overflow-y-auto">
          {pending.decision.candidates.map(c => (
            <button key={c.id} onClick={() => answer(c.id)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-left text-sm hover:border-indigo-400">
              <UserCheck className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="truncate">{candidateLabel(c)}</span>
            </button>
          ))}
          <button onClick={() => answer(create(pending.decision.draft))}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-indigo-300 dark:border-indigo-700 text-left text-sm text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20">
            <UserPlus className="w-4 h-4 shrink-0" />
            Create a new customer called {pending.decision.draft.name}
          </button>
        </div>
        {/* Skipping still saves the purchase with the typed name — linking is
            a convenience, never a gate in front of taking a device in. */}
        <button onClick={() => answer(undefined)}
          className="w-full px-3 py-1.5 rounded-lg text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          Don’t link — just keep the name
        </button>
      </div>
    </div>
  ) : null;

  return { resolve, prompt };
};
