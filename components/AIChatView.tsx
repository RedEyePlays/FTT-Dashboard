import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChatMessage } from '../types';
import { ChatAttachmentPayload, generateChatResponse } from '../services/geminiService';
import { OfflineError } from '../services/functionsGuard';
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import {
  Send, Bot, User, Loader2, Sparkles, Trash2, X, Plus, MessageSquare,
  Paperclip, FileText, Image as ImageIcon, Pencil, Check, AlertTriangle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import {
  ACCEPT_ATTRIBUTE, AiChat, AttachmentKind, MAX_ATTACHMENTS_PER_MESSAGE,
  attachmentKind, checkAttachment, countCsvRows, preSendNotice, toHistory,
} from '../domain/aiChat';
import {
  createChat, deleteChat, readAsBase64, readAsText, renameChat, saveChat,
  subscribeChats, pruneSavedChats, uploadAttachment,
} from '../services/aiChats';
import { newId } from '../domain/ids';
import { writeErrorMessage } from '../domain/writeErrors';

/**
 * THE ASSISTANT.
 *
 * Three things changed here and they are related:
 *
 *   • It no longer ships the inventory. The client sends the CONVERSATION;
 *     the server retrieves what the question refers to.
 *   • There is more than one conversation, saved per user, so asking about
 *     something else no longer means losing the thread you were on.
 *   • The header shows the model that ACTUALLY answered, reported by the
 *     server. It used to read "Gemini 2.5 Flash" whatever was running, which
 *     is how somebody debugs the wrong model for an hour.
 *
 * Nothing here generates on its own: no call on mount, no retry loop, no
 * regeneration without a tap.
 */

interface AIChatViewProps {
  /** The signed-in user. Chats are theirs alone — see services/aiChats.ts. */
  userId: string;
  variant?: 'full' | 'sidebar';
  onClose?: () => void;
}

interface PendingAttachment {
  id: string;
  file: File;
  kind: AttachmentKind;
  notice: string;
}

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'model',
  text: "Ask me about a device, a repair, a customer or how the shop is doing. Name a SKU, an IMEI or a ticket number and I'll pull that record's history.",
  timestamp: new Date(),
};

export const AIChatView: React.FC<AIChatViewProps> = ({ userId, variant = 'full', onClose }) => {
  const [chats, setChats] = useState<AiChat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [notices, setNotices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [lastModel, setLastModel] = useState<string | null>(null);

  const isOffline = useConnectionStatus() === 'offline';
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const active = useMemo(() => chats.find(c => c.id === activeId) || null, [chats, activeId]);

  // The list of saved chats, live. Opening the view does NOT call the model.
  useEffect(() => {
    if (!userId) return;
    return subscribeChats(userId, next => {
      setChats(next);
      setActiveId(current => current ?? next[0]?.id ?? null);
    }, e => setError(writeErrorMessage(e, 'Could not load your saved chats.')));
  }, [userId]);

  // Switching chats loads its messages; the current one is kept while it is open.
  useEffect(() => {
    if (!activeId) { setMessages([WELCOME]); setLastModel(null); return; }
    const chat = chats.find(c => c.id === activeId);
    if (!chat) return;
    setMessages(chat.messages.length ? chat.messages : [WELCOME]);
    setLastModel(chat.lastModel || null);
    setNotices([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, variant]);

  const startNewChat = async () => {
    if (!userId) return;
    try {
      const chat = await createChat(userId, newId());
      setActiveId(chat.id);
      setMessages([WELCOME]);
      setPending([]);
      setNotices([]);
      setListOpen(false);
    } catch (e) {
      setError(writeErrorMessage(e, 'Could not start a new chat.'));
    }
  };

  const removeChat = async (chat: AiChat) => {
    if (!window.confirm(`Delete “${chat.title}”?\n\nThe conversation and anything attached to it go with it.`)) return;
    try {
      await deleteChat(userId, chat);
      if (chat.id === activeId) { setActiveId(null); setMessages([WELCOME]); }
    } catch (e) {
      setError(writeErrorMessage(e, 'Could not delete that chat.'));
    }
  };

  const commitRename = async (chat: AiChat) => {
    setRenaming(null);
    if (!renameText.trim() || renameText.trim() === chat.title) return;
    try { await renameChat(userId, chat.id, renameText); }
    catch (e) { setError(writeErrorMessage(e, 'Could not rename that chat.')); }
  };

  /** Files are checked BEFORE anything is uploaded or sent. */
  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const next: PendingAttachment[] = [...pending];
    for (const file of Array.from(files)) {
      const check = checkAttachment(file, next.length);
      if (check.ok === false) { setError(`${file.name}: ${check.message}`); break; }
      // For a CSV, count the rows now so the notice can be exact rather than
      // a generic "the first 200 rows".
      let rows: number | undefined;
      if (check.kind === 'csv') {
        try { rows = countCsvRows(await readAsText(file)); } catch { rows = undefined; }
      }
      next.push({
        id: newId(), file, kind: check.kind,
        notice: preSendNotice({ name: file.name, kind: check.kind, rows }),
      });
    }
    setPending(next);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSend = async () => {
    if ((!input.trim() && pending.length === 0) || isLoading || isOffline || !userId) return;

    let chatId = activeId;
    if (!chatId) {
      try {
        const chat = await createChat(userId, newId());
        chatId = chat.id;
        setActiveId(chat.id);
      } catch (e) {
        setError(writeErrorMessage(e, 'Could not start a chat.'));
        return;
      }
    }

    const attached = pending;
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: [input.trim(), ...attached.map(a => `📎 ${a.file.name}`)].filter(Boolean).join('\n'),
      timestamp: new Date(),
    };

    const newHistory = [...messages.filter(m => m.id !== 'welcome'), userMsg];
    setMessages([...messages, userMsg]);
    setInput('');
    setPending([]);
    setError(null);
    setNotices([]);
    setIsLoading(true);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    try {
      // Read the files for THIS message. They are sent once; later turns carry
      // the summaries the server hands back.
      const payloads: ChatAttachmentPayload[] = [];
      for (const a of attached) {
        const data = a.kind === 'csv' || a.kind === 'text'
          ? await readAsText(a.file)
          : await readAsBase64(a.file);
        payloads.push({ name: a.file.name, mimeType: a.file.type, sizeBytes: a.file.size, data });
      }

      const reply = await generateChatResponse(newHistory, {
        attachments: payloads,
        ...(active?.attachmentSummaries?.length ? { attachmentSummaries: active.attachmentSummaries } : {}),
      });

      const aiMsg: ChatMessage = {
        id: (Date.now() + 1).toString(), role: 'model', text: reply.text, timestamp: new Date(),
      };
      const finalMessages = [...newHistory, aiMsg];
      setMessages(finalMessages);
      setNotices(reply.notices);
      if (reply.model) setLastModel(reply.model);

      // Keep a copy of what was attached, so the conversation still shows it
      // next week. A failed upload warns; it never loses the answer.
      const paths = [...(active?.attachmentPaths || [])];
      for (const a of attached) {
        try {
          const uploaded = await uploadAttachment(userId, chatId, a.id, a.file);
          paths.push(uploaded.path);
        } catch {
          setNotices(n => [...n, `${a.file.name} was read, but could not be saved to this chat.`]);
        }
      }

      await saveChat(userId, chatId, {
        messages: finalMessages,
        title: active?.title,
        attachmentSummaries: [...(active?.attachmentSummaries || []), ...(reply.attachmentSummaries || [])],
        attachmentPaths: paths,
        ...(reply.model ? { lastModel: reply.model } : {}),
        ...(reply.provider ? { lastProvider: reply.provider } : {}),
      });
      const pruneNotice = await pruneSavedChats(userId, chats);
      if (pruneNotice) setNotices(n => [...n, pruneNotice]);
    } catch (e) {
      // The draft is kept and the failure is shown — never a silent empty box.
      setError(e instanceof OfflineError
        ? "You're offline — the assistant needs an internet connection."
        : writeErrorMessage(e, 'The assistant could not answer that. Please try again.'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  };

  const isSidebar = variant === 'sidebar';

  return (
    <div className={`flex flex-col bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden relative ${isSidebar ? 'h-full border-l' : 'h-[calc(100vh-140px)] border rounded-xl'}`}>

      {/* Header */}
      <div className={`px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex justify-between items-center z-10 ${isSidebar ? 'bg-white dark:bg-slate-900' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-lg text-white shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
              {active?.title && active.messageCount > 0 ? active.title : 'AI Assistant'}
            </h2>
            {/* THE MODEL THAT ANSWERED, reported by the server. A label that
                lies about the model is how somebody debugs the wrong thing. */}
            <p className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
              {lastModel || 'Model set by the server'}
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setListOpen(v => !v)} title="Saved chats"
            className={`p-1.5 rounded-lg transition-colors ${listOpen ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-300' : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
            <MessageSquare className="w-4 h-4" />
          </button>
          <button onClick={() => void startNewChat()} title="New chat"
            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-lg transition-colors">
            <Plus className="w-4 h-4" />
          </button>
          {onClose && (
            <button onClick={onClose} title="Close"
              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Saved chats */}
      {listOpen && (
        <div className="border-b border-slate-100 dark:border-slate-800 max-h-56 overflow-y-auto bg-slate-50/60 dark:bg-slate-950/40">
          {chats.length === 0 && (
            <p className="text-xs text-slate-400 px-4 py-3">No saved chats yet. Ask something and it will be kept here.</p>
          )}
          {chats.map(chat => (
            <div key={chat.id}
              className={`flex items-center gap-2 px-3 py-2 text-sm cursor-pointer ${chat.id === activeId ? 'bg-indigo-50 dark:bg-indigo-900/20' : 'hover:bg-white dark:hover:bg-slate-900'}`}
              onClick={() => { setActiveId(chat.id); setListOpen(false); }}>
              {renaming === chat.id ? (
                <>
                  <input autoFocus value={renameText} onClick={e => e.stopPropagation()}
                    onChange={e => setRenameText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void commitRename(chat); }}
                    className="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800" />
                  <button onClick={e => { e.stopPropagation(); void commitRename(chat); }} className="p-1 text-emerald-600"><Check className="w-3.5 h-3.5" /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 truncate text-slate-700 dark:text-slate-200">{chat.title}</span>
                  <span className="text-[10px] text-slate-400 shrink-0">{new Date(chat.updatedAt).toLocaleDateString()}</span>
                  <button onClick={e => { e.stopPropagation(); setRenaming(chat.id); setRenameText(chat.title); }}
                    title="Rename" className="p-1 text-slate-400 hover:text-indigo-600 shrink-0"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={e => { e.stopPropagation(); void removeChat(chat); }}
                    title="Delete" className="p-1 text-slate-400 hover:text-rose-500 shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar bg-slate-50/30 dark:bg-slate-950/30">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'model' && (
              <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center flex-shrink-0 border border-indigo-200 dark:border-indigo-800 mt-1">
                <Bot className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
              </div>
            )}
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm text-sm leading-relaxed ${
              msg.role === 'user'
                ? 'bg-indigo-600 text-white rounded-br-none'
                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-100 dark:border-slate-700 rounded-bl-none'
            }`}>
              {msg.role === 'model' ? (
                <div className="prose prose-sm dark:prose-invert max-w-none text-xs sm:text-sm">
                  <ReactMarkdown>{msg.text}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap text-xs sm:text-sm">{msg.text}</p>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0 mt-1">
                <User className="w-3.5 h-3.5 text-slate-500 dark:text-slate-300" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3">
            <div className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center flex-shrink-0 border border-indigo-200 dark:border-indigo-800">
              <Bot className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]" />
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]" />
              <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Notices and errors */}
      {notices.length > 0 && (
        <div className="px-3 pt-2 space-y-1">
          {notices.map((n, i) => (
            <p key={i} className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800/60 rounded-lg px-2.5 py-1.5">{n}</p>
          ))}
        </div>
      )}
      {error && (
        <div className="px-3 pt-2">
          <p className="text-[11px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" /> {error}
          </p>
        </div>
      )}

      {/* Input */}
      <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
        {/* WHAT WILL ACTUALLY BE SENT, before it is sent. */}
        {pending.length > 0 && (
          <div className="mb-2 space-y-1">
            {pending.map(a => (
              <div key={a.id} className="flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-lg px-2.5 py-1.5">
                {a.kind === 'image' ? <ImageIcon className="w-3.5 h-3.5 shrink-0" /> : <FileText className="w-3.5 h-3.5 shrink-0" />}
                <span className="flex-1 min-w-0 truncate">{a.notice}</span>
                <button onClick={() => setPending(p => p.filter(x => x.id !== a.id))}
                  aria-label={`Remove ${a.file.name}`} className="p-0.5 text-slate-400 hover:text-rose-500 shrink-0">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative flex items-end gap-2">
          <input ref={fileRef} type="file" multiple accept={ACCEPT_ATTRIBUTE} className="hidden"
            onChange={e => void addFiles(e.target.files)} />
          <button onClick={() => fileRef.current?.click()}
            disabled={isOffline || isLoading || pending.length >= MAX_ATTACHMENTS_PER_MESSAGE}
            title="Attach a PDF, spreadsheet, text file or image"
            className="p-2.5 rounded-xl flex-shrink-0 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 disabled:opacity-40 disabled:cursor-not-allowed">
            <Paperclip className="w-4 h-4" />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder={isOffline ? 'Unavailable offline' : 'Ask about a SKU, a ticket, a customer…'}
            disabled={isOffline}
            className="flex-1 pl-3 pr-3 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700 dark:text-slate-200 text-sm resize-none max-h-[100px] custom-scrollbar disabled:opacity-50 disabled:cursor-not-allowed"
            rows={1}
          />
          <button
            onClick={() => void handleSend()}
            disabled={(!input.trim() && pending.length === 0) || isLoading || isOffline}
            title={isOffline ? 'Unavailable offline' : undefined}
            className={`p-2.5 rounded-xl flex-shrink-0 transition-all ${
              (input.trim() || pending.length > 0) && !isLoading && !isOffline
                ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-md'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed'
            }`}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        {isOffline && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1.5 text-center">
            You're offline — the assistant needs an internet connection.
          </p>
        )}
      </div>
    </div>
  );
};

/** Exported for the tests — the history the callable is actually sent. */
export const __test = { toHistory, attachmentKind };
