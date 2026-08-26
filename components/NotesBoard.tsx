import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Note, Task, NoteLinkType, Customer, InventoryItem, Repair } from '../types';
import {
  checklistProgress, sortNotes, stampNoteEdit, editedSummary,
} from '../domain/notes';
import { NoteEditor, applyBold, applyBlockKind } from './NoteEditor';
import { htmlToMarkdown } from '../domain/notesHtml';
import { getDeviceDisplayName } from '../domain/inventory';
import {
  Plus, X, Check, Trash2, FileText,
  CheckSquare, Calendar, Clock, Search, File, Pin, Bold, Heading1, Heading2,
  List, Link2, User, Package, Wrench,
} from 'lucide-react';

interface NotesBoardProps {
  notes: Note[];
  tasks: Task[];
  onUpdateNotes: (notes: Note[]) => void;
  onUpdateTasks: (tasks: Task[]) => void;
  /** Signed-in user, recorded as the editor on every note save. */
  currentUser?: { id: string; email: string } | null;
  // Records the link picker can point at. Optional so the board still renders
  // if a caller doesn't have them loaded.
  customers?: Customer[];
  inventory?: InventoryItem[];
  repairs?: Repair[];
  /** Open this note on mount — set when arriving from a record's linked-notes panel. */
  initialNoteId?: string;
  onConsumeInitial?: () => void;
}

const ICON_COLORS = {
  yellow: 'text-yellow-500 bg-yellow-100 dark:bg-yellow-900/30',
  blue: 'text-blue-500 bg-blue-100 dark:bg-blue-900/30',
  green: 'text-emerald-500 bg-emerald-100 dark:bg-emerald-900/30',
  rose: 'text-rose-500 bg-rose-100 dark:bg-rose-900/30',
  violet: 'text-violet-500 bg-violet-100 dark:bg-violet-900/30',
  slate: 'text-slate-500 bg-slate-100 dark:bg-slate-800',
};

const LINK_META: Record<NoteLinkType, { label: string; icon: React.ReactNode }> = {
  customer: { label: 'Customer', icon: <User className="w-3.5 h-3.5" /> },
  inventory: { label: 'Item', icon: <Package className="w-3.5 h-3.5" /> },
  repair: { label: 'Repair', icon: <Wrench className="w-3.5 h-3.5" /> },
};

export const NotesBoard: React.FC<NotesBoardProps> = ({
  notes, tasks, onUpdateNotes, onUpdateTasks, currentUser,
  customers = [], inventory = [], repairs = [], initialNoteId, onConsumeInitial,
}) => {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [newTaskText, setNewTaskText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  // The contentEditable surface. Toolbar actions operate on it directly; there
  // is no longer an edit/preview split to coordinate.
  const editorRef = useRef<HTMLDivElement>(null);

  const ordered = useMemo(() => sortNotes(notes), [notes]);

  // Deep link from a record's linked-notes panel.
  useEffect(() => {
    if (initialNoteId && notes.some(n => n.id === initialNoteId)) {
      setSelectedNoteId(initialNoteId);
      onConsumeInitial?.();
    }
  }, [initialNoteId, notes, onConsumeInitial]);

  useEffect(() => {
    if (!selectedNoteId && ordered.length > 0) setSelectedNoteId(ordered[0].id);
  }, [ordered, selectedNoteId]);

  const activeNote = notes.find(n => n.id === selectedNoteId);

  const filteredNotes = ordered.filter(n =>
    n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    n.content.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Every write stamps who edited and when — these pages are shared.
  const patchNote = (id: string, patch: Partial<Note>) => {
    onUpdateNotes(notes.map(n => (n.id === id ? stampNoteEdit({ ...n, ...patch }, currentUser, Date.now()) : n)));
  };

  const handleAddNote = () => {
    const now = Date.now();
    const newNote: Note = stampNoteEdit({
      id: now.toString(), title: '', content: '', color: 'slate', date: new Date(now).toISOString(),
    }, currentUser, now);
    onUpdateNotes([newNote, ...notes]);
    setSelectedNoteId(newNote.id);
  };

  const handleDeleteNote = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const newNotes = notes.filter(n => n.id !== id);
    onUpdateNotes(newNotes);
    if (selectedNoteId === id) setSelectedNoteId(sortNotes(newNotes)[0]?.id ?? null);
  };

  const cycleColor = (id: string, currentColor: string) => {
    const colors = Object.keys(ICON_COLORS) as Array<keyof typeof ICON_COLORS>;
    const idx = colors.indexOf(currentColor as any);
    patchNote(id, { color: colors[(idx + 1) % colors.length] });
  };

  // --- Body editing -----------------------------------------------------
  // The editor owns its DOM (see NoteEditor); the board only receives the
  // markdown it produces and hands toolbar actions back down to it.
  const syncBody = () => {
    const el = editorRef.current;
    if (!el || !activeNote) return;
    // Toolbar actions mutate the editor's DOM directly, so the board reads the
    // result back here rather than waiting for the next input event.
    const md = htmlToMarkdown(el);
    if (md !== activeNote.content) patchNote(activeNote.id, { content: md });
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskText.trim()) return;
    onUpdateTasks([{ id: Date.now().toString(), text: newTaskText, completed: false }, ...tasks]);
    setNewTaskText('');
  };
  const handleToggleTask = (id: string) => onUpdateTasks(tasks.map(t => (t.id === id ? { ...t, completed: !t.completed } : t)));
  const handleDeleteTask = (id: string) => onUpdateTasks(tasks.filter(t => t.id !== id));

  const toolBtn = 'p-1.5 rounded text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-800 dark:hover:text-slate-200 transition-colors';

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 h-[calc(100vh-140px)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">

      {/* 1. LEFT SIDEBAR: page list */}
      <div className="md:col-span-3 lg:col-span-2 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/50 dark:bg-slate-950/50 min-w-0">

        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200">
              <div className="w-5 h-5 bg-indigo-500 rounded text-white flex items-center justify-center text-xs">F</div>
              <span>Workspace</span>
            </div>
            <button onClick={handleAddNote} className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded text-slate-500 transition-colors" title="New Page">
              <Plus className="w-4 h-4" />
            </button>
          </div>

          <div className="relative">
            <Search className="w-3 h-3 absolute left-2.5 top-2.5 text-slate-400" />
            <input
              type="text" placeholder="Search pages..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md py-1.5 pl-8 pr-3 text-xs focus:ring-1 focus:ring-indigo-500 outline-none dark:text-slate-200"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 py-2">Pages</div>

          {filteredNotes.map(note => {
            const prog = checklistProgress(note.content);
            return (
              <div
                key={note.id}
                onClick={() => setSelectedNoteId(note.id)}
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-md text-sm cursor-pointer transition-colors ${selectedNoteId === note.id ? 'bg-slate-200/60 dark:bg-slate-800 text-slate-900 dark:text-white font-medium' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                <div className="text-slate-400 shrink-0">
                  {note.pinned ? <Pin className="w-4 h-4 text-indigo-500 fill-indigo-500" /> : <FileText className="w-4 h-4" />}
                </div>
                <span className="truncate flex-1 min-w-0">{note.title || 'Untitled'}</span>
                {prog.total > 0 && (
                  <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${prog.done === prog.total ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>
                    {prog.done}/{prog.total}
                  </span>
                )}
                <button
                  onClick={(e) => handleDeleteNote(e, note.id)}
                  aria-label={`Delete ${note.title || 'Untitled'}`}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-300 dark:hover:bg-slate-700 rounded text-slate-400 hover:text-rose-500 transition-all shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {filteredNotes.length === 0 && (
            <div className="px-3 py-4 text-xs text-slate-400 italic text-center">
              {searchQuery ? 'No pages found' : 'No pages yet'}
            </div>
          )}
        </div>
      </div>

      {/* 2. CENTER PANEL: editor */}
      <div className="md:col-span-6 lg:col-span-7 flex flex-col bg-white dark:bg-slate-900 relative min-w-0">
        {activeNote ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden animate-fadeIn">
            <div className="pt-10 px-6 lg:px-10 w-full flex-shrink-0">
              <div className="flex items-start justify-between gap-3 mb-6">
                <button
                  onClick={() => cycleColor(activeNote.id, activeNote.color)}
                  title="Click to change color"
                  className={`w-16 h-16 rounded-xl flex items-center justify-center shadow-sm transition-transform hover:scale-105 ${ICON_COLORS[activeNote.color]} cursor-pointer shrink-0`}
                >
                  <File className="w-8 h-8" />
                </button>
                <div className="flex items-center gap-1">
                  <NoteLinkPicker
                    note={activeNote} open={linkPickerOpen} onOpenChange={setLinkPickerOpen}
                    customers={customers} inventory={inventory} repairs={repairs}
                    onLink={(patch) => patchNote(activeNote.id, patch)}
                  />
                  <button
                    onClick={() => patchNote(activeNote.id, { pinned: !activeNote.pinned })}
                    aria-pressed={!!activeNote.pinned}
                    title={activeNote.pinned ? 'Unpin from top' : 'Pin to top'}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${activeNote.pinned ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-indigo-400'}`}
                  >
                    <Pin className={`w-3.5 h-3.5 ${activeNote.pinned ? 'fill-current' : ''}`} />
                    {activeNote.pinned ? 'Pinned' : 'Pin'}
                  </button>
                </div>
              </div>

              <input
                type="text" value={activeNote.title}
                onChange={(e) => patchNote(activeNote.id, { title: e.target.value })}
                placeholder="Untitled"
                className="w-full text-4xl font-bold text-slate-900 dark:text-slate-100 placeholder:text-slate-300 dark:placeholder:text-slate-600 border-none outline-none bg-transparent p-0 mb-4"
              />

              <div className="flex items-center flex-wrap gap-x-6 gap-y-2 text-xs text-slate-400 pb-3">
                <div className="flex items-center gap-2">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Created</span>
                  <span className="text-slate-600 dark:text-slate-300">{new Date(activeNote.date).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" />
                  <span className="text-slate-600 dark:text-slate-300">{editedSummary(activeNote, Date.now()) ?? 'Not edited yet'}</span>
                </div>
                {activeNote.linkType && activeNote.linkId && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300 font-medium">
                    {LINK_META[activeNote.linkType].icon}
                    {LINK_META[activeNote.linkType].label}: {activeNote.linkLabel || activeNote.linkId}
                  </span>
                )}
              </div>

              {/* Formatting toolbar. Buttons suppress mousedown so the
                  contentEditable surface keeps focus and its selection — an
                  action that lost the caret would have nothing to apply to.
                  There is no Preview toggle: formatting is always visible. */}
              <div className="flex items-center gap-0.5 border-y border-slate-100 dark:border-slate-800 py-1.5 mb-1" onMouseDown={e => e.preventDefault()}>
                <button onClick={() => applyBold(editorRef.current, syncBody)} className={toolBtn} title="Bold"><Bold className="w-4 h-4" /></button>
                <button onClick={() => applyBlockKind(editorRef.current, 'h1', syncBody)} className={toolBtn} title="Heading"><Heading1 className="w-4 h-4" /></button>
                <button onClick={() => applyBlockKind(editorRef.current, 'h2', syncBody)} className={toolBtn} title="Subheading"><Heading2 className="w-4 h-4" /></button>
                <button onClick={() => applyBlockKind(editorRef.current, 'check', syncBody)} className={toolBtn} title="Checklist item"><CheckSquare className="w-4 h-4" /></button>
                <button onClick={() => applyBlockKind(editorRef.current, 'bullet', syncBody)} className={toolBtn} title="Bullet"><List className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 lg:px-10 pb-12 w-full custom-scrollbar">
              <NoteEditor
                ref={editorRef}
                noteId={activeNote.id}
                value={activeNote.content}
                onChange={(md) => patchNote(activeNote.id, { content: md })}
                placeholder={'Type "[] " for a checkbox, "# " for a heading'}
                className="min-h-[50vh] text-lg leading-8 text-slate-700 dark:text-slate-300"
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-300 dark:text-slate-600">
            <FileText className="w-16 h-16 mb-4 opacity-50" />
            <p className="text-lg font-medium">Select a page to edit</p>
          </div>
        )}
      </div>

      {/* 3. RIGHT SIDEBAR: tasks */}
      <div className="md:col-span-3 border-l border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50/30 dark:bg-slate-950/30 min-w-0">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="font-bold text-sm text-slate-700 dark:text-slate-200 flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-slate-400" />
            To-do List
          </h3>
        </div>

        <div className="p-3">
          <form onSubmit={handleAddTask} className="relative">
            <Plus className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text" value={newTaskText} onChange={(e) => setNewTaskText(e.target.value)}
              placeholder="Add a task..."
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md py-2 pl-9 pr-3 text-sm focus:ring-1 focus:ring-indigo-500 outline-none dark:text-slate-200 shadow-sm"
            />
          </form>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {tasks.map(task => (
            <div key={task.id} className="group flex items-start gap-2 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors">
              <button
                onClick={() => handleToggleTask(task.id)}
                aria-label={task.completed ? `Mark ${task.text} incomplete` : `Mark ${task.text} complete`}
                className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center transition-colors ${task.completed ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'}`}
              >
                {task.completed && <Check className="w-3 h-3" />}
              </button>
              <span className={`text-sm flex-1 min-w-0 break-words leading-tight pt-0.5 ${task.completed ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-700 dark:text-slate-300'}`}>
                {task.text}
              </span>
              <button onClick={() => handleDeleteTask(task.id)} aria-label={`Delete ${task.text}`} className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500 shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {tasks.length === 0 && <div className="text-center py-8 text-xs text-slate-400">No tasks pending</div>}
        </div>
      </div>

    </div>
  );
};

/**
 * Attach the page to one customer / inventory item / repair. A reference only —
 * it stores the type, id and a display label, and the record views look notes up
 * by type + id (see domain/notes.ts's notesForRecord).
 */
const NoteLinkPicker: React.FC<{
  note: Note;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customers: Customer[];
  inventory: InventoryItem[];
  repairs: Repair[];
  onLink: (patch: Partial<Note>) => void;
}> = ({ note, open, onOpenChange, customers, inventory, repairs, onLink }) => {
  const [type, setType] = useState<NoteLinkType>(note.linkType || 'customer');
  const [q, setQ] = useState('');

  const options = useMemo(() => {
    const term = q.toLowerCase().trim();
    const match = (label: string, extra?: string) => !term || label.toLowerCase().includes(term) || (extra || '').toLowerCase().includes(term);
    if (type === 'customer') {
      return customers
        .map(c => ({ id: c.id, label: c.name || c.company || c.phone || 'Customer', sub: c.phone || c.email || '' }))
        .filter(o => match(o.label, o.sub)).slice(0, 30);
    }
    if (type === 'inventory') {
      return inventory
        .map(i => ({ id: i.id, label: getDeviceDisplayName(i), sub: i.sku || i.imei || '' }))
        .filter(o => match(o.label, o.sub)).slice(0, 30);
    }
    return repairs
      .map(r => ({ id: r.id, label: r.repairNumber || [r.brand, r.model].filter(Boolean).join(' ') || 'Repair', sub: [r.brand, r.model].filter(Boolean).join(' ') }))
      .filter(o => match(o.label, o.sub)).slice(0, 30);
  }, [type, q, customers, inventory, repairs]);

  const linked = !!(note.linkType && note.linkId);

  return (
    <div className="relative">
      <button
        onClick={() => onOpenChange(!open)}
        title="Link this page to a record"
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${linked ? 'bg-indigo-50 dark:bg-indigo-900/30 border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-indigo-400'}`}
      >
        <Link2 className="w-3.5 h-3.5" />
        {linked ? 'Linked' : 'Link'}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => onOpenChange(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-80 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-3">
            <div className="flex items-center gap-1 mb-2">
              {(Object.keys(LINK_META) as NoteLinkType[]).map(t => (
                <button
                  key={t} onClick={() => { setType(t); setQ(''); }}
                  className={`flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-xs font-medium border ${type === t ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400'}`}
                >
                  {LINK_META[t].icon}{LINK_META[t].label}
                </button>
              ))}
            </div>
            <div className="relative mb-2">
              <Search className="w-3 h-3 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder={`Search ${LINK_META[type].label.toLowerCase()}s…`}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md py-1.5 pl-8 pr-3 text-xs outline-none focus:ring-1 focus:ring-indigo-500 dark:text-slate-200"
              />
            </div>
            <div className="max-h-56 overflow-y-auto custom-scrollbar space-y-0.5">
              {options.map(o => (
                <button
                  key={o.id}
                  onClick={() => { onLink({ linkType: type, linkId: o.id, linkLabel: o.label }); onOpenChange(false); }}
                  className={`w-full text-left px-2.5 py-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 ${note.linkId === o.id ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}
                >
                  <p className="text-sm text-slate-700 dark:text-slate-200 truncate">{o.label}</p>
                  {o.sub && <p className="text-[11px] text-slate-400 truncate">{o.sub}</p>}
                </button>
              ))}
              {options.length === 0 && <p className="text-xs text-slate-400 text-center py-4">No matches</p>}
            </div>
            {linked && (
              <button
                onClick={() => { onLink({ linkType: undefined, linkId: undefined, linkLabel: undefined }); onOpenChange(false); }}
                className="mt-2 w-full text-xs font-medium text-rose-500 hover:text-rose-600 py-1.5 rounded-md hover:bg-rose-50 dark:hover:bg-rose-900/20"
              >
                Remove link
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
