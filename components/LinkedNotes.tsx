import React from 'react';
import { Note, NoteLinkType, Role } from '../types';
import { notesForRecord, checklistProgress, editedSummary, visibleNotes } from '../domain/notes';
import { FileText, Pin, ExternalLink } from 'lucide-react';

/**
 * The record-detail side of a note link: every Notes page attached to this
 * customer / inventory item / repair. Read-only on purpose — notes are authored
 * in the Notes board, and this is just the way back to them.
 *
 * Renders nothing at all when there are no linked notes, so it can be dropped
 * into a detail view without adding an empty section to every record.
 *
 * Per-note visibility is re-applied here rather than trusted from the caller.
 * This panel is the one place a note surfaces OUTSIDE the Notes board — a
 * technician opening a repair ticket must not see a Managers+ page attached to
 * it — so the filter lives at the leaf where the notes are actually rendered.
 * `role` is therefore required and fail-closed: an unknown role sees nothing.
 */
export const LinkedNotes: React.FC<{
  notes?: Note[];
  role: Role | undefined;
  linkType: NoteLinkType;
  linkId: string;
  onOpenNote?: (noteId: string) => void;
  className?: string;
}> = ({ notes, role, linkType, linkId, onOpenNote, className }) => {
  const linked = notesForRecord(visibleNotes(role, notes || []), linkType, linkId);
  if (linked.length === 0) return null;

  return (
    <div className={className}>
      <h3 className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5 mb-2">
        <FileText className="w-3.5 h-3.5 text-indigo-500" /> Linked Notes ({linked.length})
      </h3>
      <ul className="space-y-1.5">
        {linked.map(n => {
          const prog = checklistProgress(n.content);
          const edited = editedSummary(n, Date.now());
          return (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => onOpenNote?.(n.id)}
                disabled={!onOpenNote}
                className={`w-full text-left rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 transition-colors ${onOpenNote ? 'hover:border-indigo-400 cursor-pointer' : 'cursor-default'}`}
              >
                <div className="flex items-center gap-2">
                  {n.pinned && <Pin className="w-3 h-3 text-indigo-500 fill-indigo-500 shrink-0" />}
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate flex-1 min-w-0">
                    {n.title || 'Untitled'}
                  </span>
                  {prog.total > 0 && (
                    <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${prog.done === prog.total ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                      {prog.done}/{prog.total}
                    </span>
                  )}
                  {onOpenNote && <ExternalLink className="w-3 h-3 text-slate-400 shrink-0" />}
                </div>
                {edited && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{edited}</p>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};
