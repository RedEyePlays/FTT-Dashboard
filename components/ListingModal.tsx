import React, { useState } from 'react';
import { Check, Copy, Loader2, RefreshCw, Sparkles, X, AlertTriangle } from 'lucide-react';
import { SavedListing } from '../types';
import {
  DEFAULT_LISTING_OPTIONS, LISTING_COPY_PLATFORMS, ListingFacts, ListingLength,
  ListingOptions, ListingPlatform, checkListingOutput,
} from '../domain/listingCopy';
import { generateListing } from '../services/geminiService';
import { writeErrorMessage } from '../domain/writeErrors';
import { useEscapeKey } from '../hooks/useEscapeKey';

/**
 * THE LISTING GENERATOR.
 *
 * A DRAFT, NOT A PUBLISH BUTTON. Nothing here posts anything anywhere: it
 * writes an advert, the shop reads it, edits it, and pastes it into whichever
 * site they are using. Both fields are editable before they are copied, and
 * they are copied separately because title and description are separate boxes
 * on every platform.
 *
 * ONE GENERATION PER TAP. No generate-on-open, no regenerate loop, no
 * regenerate-on-option-change — each call costs money and the shop is not
 * asking for a slot machine.
 *
 * A FAILURE SAYS SO AND KEEPS THE DRAFT. The writeFailed pattern: an empty box
 * with no explanation is the failure mode this is written to avoid, because
 * somebody will assume it is still thinking.
 */

interface Props {
  /** What the model is allowed to know. Built by domain/listingCopy.ts. */
  facts: (options: ListingOptions) => ListingFacts;
  /** The item's stored draft, so navigating away does not lose it. */
  saved?: SavedListing;
  /** Persist the draft on the record. */
  onSave: (listing: SavedListing) => void;
  onClose: () => void;
  /** Offered when the item has no share link yet — the ad is better with one. */
  onCreateShareLink?: () => void;
  hasShareLink: boolean;
  /** Builds only: the used-parts toggle is meaningless on a device. */
  isBuild: boolean;
}

export const ListingModal: React.FC<Props> = ({
  facts, saved, onSave, onClose, onCreateShareLink, hasShareLink, isBuild,
}) => {
  useEscapeKey(onClose);
  const [platform, setPlatform] = useState<ListingPlatform>(
    (saved?.platform as ListingPlatform) || DEFAULT_LISTING_OPTIONS.platform);
  const [length, setLength] = useState<ListingLength>(
    (saved?.length as ListingLength) || DEFAULT_LISTING_OPTIONS.length);
  const [includePrice, setIncludePrice] = useState(false);
  const [markUsedParts, setMarkUsedParts] = useState(false);

  const [title, setTitle] = useState(saved?.title || '');
  const [description, setDescription] = useState(saved?.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState<'title' | 'description' | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setWarning(null);
    const options: ListingOptions = { platform, length, includePrice, markUsedParts };
    try {
      const f = facts(options);
      const result = await generateListing(f as unknown as Record<string, unknown>, {
        platform, length, markUsedParts,
      });
      // The server checks and retries; this is the belt to that braces. If
      // something got through, the draft is still shown — the shop can fix it
      // — but it is flagged rather than presented as finished work.
      const check = checkListingOutput(f, result);
      if (!check.ok) {
        setWarning(check.impliedNew
          ? `This draft says “${check.impliedNew}”, and not every part of this item is new. Take that out before you post it.`
          : `This draft contains figures that are not on the record (${check.invented.join(', ')}). Check them before you post it.`);
      }
      setTitle(result.title);
      setDescription(result.description);
      onSave({ ...result, platform, length, generatedAt: Date.now() });
    } catch (e) {
      setError(writeErrorMessage(e, 'The listing could not be generated.'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what: 'title' | 'description', text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Could not copy — select the text and copy it manually.');
    }
  };

  const saveEdits = () => {
    if (!title.trim() && !description.trim()) return;
    onSave({ title: title.trim(), description: description.trim(), platform, length, generatedAt: Date.now() });
  };

  const hasDraft = !!(title || description);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-slate-200 dark:border-slate-700 p-5 space-y-4"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" /> Write a listing
          </h2>
          <button onClick={onClose} aria-label="Close"><X className="w-5 h-5 text-slate-400" /></button>
        </div>

        {/* Options, chosen BEFORE generating — changing one never fires a call. */}
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Platform</span>
            <select value={platform} onChange={e => setPlatform(e.target.value as ListingPlatform)}
              className="w-full mt-1 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
              {LISTING_COPY_PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Length</span>
            <select value={length} onChange={e => setLength(e.target.value as ListingLength)}
              className="w-full mt-1 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm">
              <option value="short">Short</option>
              <option value="standard">Standard</option>
            </select>
          </label>
        </div>

        <div className="space-y-1.5 text-sm">
          <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={includePrice} onChange={e => setIncludePrice(e.target.checked)} className="rounded" />
            Put the price in the description
            <span className="text-[11px] text-slate-400">— off by default; the site has its own price box</span>
          </label>
          {isBuild && (
            <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300 cursor-pointer">
              <input type="checkbox" checked={markUsedParts} onChange={e => setMarkUsedParts(e.target.checked)} className="rounded" />
              Mark used parts in the listing
            </label>
          )}
          {isBuild && !markUsedParts && (
            <p className="text-[11px] text-slate-400 pl-6">
              With this off the parts are named without condition markers. The listing still never calls
              them new, and the per-part condition stays on the build’s share page.
            </p>
          )}
          {!hasShareLink && onCreateShareLink && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
              No share link yet, so the advert cannot point anywhere for the full specs.
              <button onClick={onCreateShareLink} className="underline font-medium">Create one</button>
            </p>
          )}
        </div>

        <button onClick={generate} disabled={busy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : hasDraft ? <RefreshCw className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
          {busy ? 'Writing…' : hasDraft ? 'Regenerate' : 'Generate listing'}
        </button>

        {error && (
          <p className="text-sm text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {warning && (
          <p className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg px-3 py-2">
            {warning}
          </p>
        )}

        {hasDraft && (
          <>
            <Field label="Title" copied={copied === 'title'} onCopy={() => copy('title', title)}>
              <input value={title} onChange={e => setTitle(e.target.value)} onBlur={saveEdits}
                className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium" />
            </Field>
            <Field label="Description" copied={copied === 'description'} onCopy={() => copy('description', description)}>
              <textarea value={description} onChange={e => setDescription(e.target.value)} onBlur={saveEdits} rows={12}
                className="w-full p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-mono leading-relaxed" />
            </Field>
            <p className="text-[11px] text-slate-400">
              This is a draft. Read it before you post it — it is written from what is on the record, and
              anything that is not on the record is not in it.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

const Field: React.FC<{
  label: string;
  copied: boolean;
  onCopy: () => void;
  children: React.ReactNode;
}> = ({ label, copied, onCopy, children }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <button onClick={onCopy}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400">
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} {copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
      </button>
    </div>
    {children}
  </div>
);
