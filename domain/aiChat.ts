import { ChatMessage } from '../types';

/**
 * SAVED CONVERSATIONS.
 *
 * The assistant had exactly one conversation, held in React state, wiped by a
 * refresh. Asking a second question about something else meant losing the
 * first thread — so people cleared the chat constantly, which is also why the
 * old "resend everything" cost never looked as bad as it was.
 *
 * Chats are stored PER USER, never per workspace: a conversation is somebody
 * working something out, and the owner reading a manager's half-finished
 * questions is not a feature. firestore.rules says the same thing in the one
 * place that enforces it.
 *
 * Pure: no DOM, no Firestore.
 */

export interface AiChatSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface AiChat extends AiChatSummary {
  messages: ChatMessage[];
  /**
   * One line per file attached anywhere in this conversation. The files
   * themselves are sent ONCE; these are what later turns carry instead.
   */
  attachmentSummaries?: string[];
  /** Storage paths of this chat's attachments, so deleting the chat deletes them. */
  attachmentPaths?: string[];
  /** The model that last answered here, for the header. */
  lastModel?: string;
  lastProvider?: string;
}

/** Above this, the oldest chat is pruned — see pruneChats. */
export const MAX_SAVED_CHATS = 50;
/** A single conversation cannot grow without limit either. */
export const MAX_MESSAGES_PER_CHAT = 200;
export const MAX_TITLE_LENGTH = 60;

export const NEW_CHAT_TITLE = 'New chat';

/**
 * A title from the first thing somebody asked.
 *
 * The first question is what the conversation is about far more reliably than
 * anything else available, and it costs nothing. Cut at a word boundary so a
 * title never ends mid-word, which reads as a bug rather than as an
 * abbreviation.
 */
export const titleFromFirstMessage = (text: string): string => {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return NEW_CHAT_TITLE;
  if (clean.length <= MAX_TITLE_LENGTH) return clean;
  const cut = clean.slice(0, MAX_TITLE_LENGTH - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > MAX_TITLE_LENGTH * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`;
};

/** Retitle a chat from its first user message, unless it has been renamed. */
export const autoTitle = (chat: Pick<AiChat, 'title' | 'messages'>): string => {
  if (chat.title && chat.title !== NEW_CHAT_TITLE) return chat.title;
  const first = (chat.messages || []).find(m => m.role === 'user');
  return first ? titleFromFirstMessage(first.text) : NEW_CHAT_TITLE;
};

/**
 * Which chats to keep, and which to prune.
 *
 * Oldest by LAST USE, not by creation: a conversation somebody returns to
 * every week is the one they would miss, however long ago it started. The
 * caller is told what went, because a list that silently loses its tail is a
 * list nobody can trust.
 */
export interface PruneResult {
  keep: AiChatSummary[];
  prune: AiChatSummary[];
  notice?: string;
}

export const pruneChats = (
  chats: AiChatSummary[],
  max = MAX_SAVED_CHATS,
): PruneResult => {
  const sorted = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (sorted.length <= max) return { keep: sorted, prune: [] };
  const keep = sorted.slice(0, max);
  const prune = sorted.slice(max);
  return {
    keep,
    prune,
    notice: `You have more than ${max} saved chats, so the ${prune.length} least recently used ${prune.length === 1 ? 'was' : 'were'} removed.`,
  };
};

/** Trim a single conversation so one chat cannot grow forever either. */
export const capMessages = (
  messages: ChatMessage[],
  max = MAX_MESSAGES_PER_CHAT,
): ChatMessage[] => (messages.length <= max ? messages : messages.slice(messages.length - max));

/**
 * The history the callable is sent.
 *
 * The UI-only welcome message is dropped — it is not something anybody asked
 * and it is not something the assistant said.
 */
export const toHistory = (messages: ChatMessage[]): { role: string; parts: { text: string }[] }[] =>
  (messages || [])
    .filter(m => m.id !== 'welcome')
    .map(m => ({ role: m.role, parts: [{ text: m.text }] }));

/** A chat, fresh. */
export const newChat = (id: string, now: number): AiChat => ({
  id,
  title: NEW_CHAT_TITLE,
  createdAt: now,
  updatedAt: now,
  messageCount: 0,
  messages: [],
});

/* ---------------- Attachments, client side ---------------- */

/**
 * The same type and size rules as the callable
 * (functions/src/ai/attachmentPolicy.ts).
 *
 * THE SERVER'S COPY IS THE RULE. This one exists so somebody who picks a
 * 200 MB video gets told before an upload starts rather than after it
 * finishes — a decent error, not a second gate.
 */
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;
export const MAX_CSV_ROWS = 200;
export const MAX_PDF_PAGES = 10;

export type AttachmentKind = 'csv' | 'text' | 'pdf' | 'image';

export const ACCEPT_ATTRIBUTE = '.csv,.tsv,.txt,.pdf,image/jpeg,image/png,image/webp,image/gif';

export const attachmentKind = (mimeType: string, name = ''): AttachmentKind | null => {
  const type = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (type === 'text/csv' || type === 'application/csv' || type === 'text/tab-separated-values') return 'csv';
  if (type === 'text/plain') return 'text';
  if (type === 'application/pdf') return 'pdf';
  if (type.startsWith('image/')) {
    return ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(type) ? 'image' : null;
  }
  const lower = (name || '').toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) return 'csv';
  if (lower.endsWith('.txt')) return 'text';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (/\.(jpe?g|png|webp|gif)$/.test(lower)) return 'image';
  return null;
};

export type AttachmentError = 'type' | 'size' | 'count';

export const ATTACHMENT_ERROR: Record<AttachmentError, string> = {
  type: 'Only PDFs, spreadsheets (CSV), text files and images can be attached.',
  size: `That file is too big — the limit is ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`,
  count: `Attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message.`,
};

export const checkAttachment = (
  file: { name: string; type: string; size: number },
  alreadyAttached: number,
): { ok: true; kind: AttachmentKind } | { ok: false; error: AttachmentError; message: string } => {
  if (alreadyAttached >= MAX_ATTACHMENTS_PER_MESSAGE) {
    return { ok: false, error: 'count', message: ATTACHMENT_ERROR.count };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: 'size', message: ATTACHMENT_ERROR.size };
  }
  const kind = attachmentKind(file.type, file.name);
  if (!kind) return { ok: false, error: 'type', message: ATTACHMENT_ERROR.type };
  return { ok: true, kind };
};

/**
 * What the UI says BEFORE sending, so "I attached the whole price list" and
 * "it read the first 200 rows" cannot be two beliefs held at once.
 */
export const preSendNotice = (a: { name: string; kind: AttachmentKind; rows?: number }): string => {
  if (a.kind === 'csv') {
    const rows = a.rows;
    if (rows == null) return `${a.name}: sending the first ${MAX_CSV_ROWS} rows.`;
    return rows > MAX_CSV_ROWS
      ? `${a.name}: sending the first ${MAX_CSV_ROWS} rows of ${rows}.`
      : `${a.name}: sending all ${rows} row${rows === 1 ? '' : 's'}.`;
  }
  if (a.kind === 'pdf') return `${a.name}: sending the first ${MAX_PDF_PAGES} pages.`;
  if (a.kind === 'text') return `${a.name}: sending the text.`;
  return `${a.name}: sending the image.`;
};

/** Rows in a CSV the user picked, for the notice above. Cheap and local. */
export const countCsvRows = (text: string): number =>
  text.split(/\r\n?|\n/).filter(l => l.trim().length > 0).length - 1;
