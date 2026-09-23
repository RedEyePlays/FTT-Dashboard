import {
  collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, setDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { ChatMessage } from '../types';
import {
  AiChat, AiChatSummary, MAX_SAVED_CHATS, autoTitle, capMessages, newChat, pruneChats,
} from '../domain/aiChat';

/**
 * SAVED CONVERSATIONS, AND THEIR FILES.
 *
 * STORED PER USER: `users/{uid}/aiChats/{chatId}`. Not under user_data — that
 * is the shared shop, and a half-finished question is not shop data. The rules
 * for this path allow exactly one person in, and there is no owner override:
 * an owner who can read every sale still cannot read a manager's chat.
 *
 * Messages live IN the chat document rather than in a subcollection, which
 * makes "deleting a chat deletes its messages" a property of the storage
 * rather than a cleanup step somebody has to remember. The cap on messages
 * per chat is what keeps that document inside Firestore's 1 MB limit.
 *
 * Attachments live in Cloud Storage under `aiAttachments/{uid}/{chatId}/…`,
 * which is also where the rules put the same single-user boundary.
 */

// Imported lazily, exactly as services/devicePhotoUpload.ts does, so the
// Firebase Storage SDK stays out of the bundle for anybody who never attaches
// a file.
async function storageApi() {
  const [{ ref, uploadBytes, getDownloadURL, deleteObject }, storage] = await Promise.all([
    import('firebase/storage'),
    import('./firebase').then(m => m.loadStorage()),
  ]);
  return { ref, uploadBytes, getDownloadURL, deleteObject, storage };
}

const chatsRef = (uid: string) => collection(db, 'users', uid, 'aiChats');
const chatRef = (uid: string, chatId: string) => doc(db, 'users', uid, 'aiChats', chatId);

/** Firestore rejects `undefined`; the chat document has several optional fields. */
const clean = <T extends Record<string, unknown>>(o: T): T => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
};

/** Timestamps round-trip as numbers; ChatMessage carries a Date. */
const toStored = (m: ChatMessage) => ({
  id: m.id, role: m.role, text: m.text,
  at: m.timestamp instanceof Date ? m.timestamp.getTime() : Date.now(),
});

const fromStored = (m: Record<string, unknown>): ChatMessage => ({
  id: String(m.id ?? ''),
  role: m.role === 'model' ? 'model' : 'user',
  text: String(m.text ?? ''),
  timestamp: new Date(typeof m.at === 'number' ? m.at : Date.now()),
});

const fromDoc = (id: string, data: Record<string, unknown>): AiChat => ({
  id,
  title: String(data.title ?? 'New chat'),
  createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
  updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : 0,
  messageCount: Array.isArray(data.messages) ? data.messages.length : 0,
  messages: Array.isArray(data.messages)
    ? (data.messages as Record<string, unknown>[]).map(fromStored)
    : [],
  ...(Array.isArray(data.attachmentSummaries) ? { attachmentSummaries: data.attachmentSummaries as string[] } : {}),
  ...(Array.isArray(data.attachmentPaths) ? { attachmentPaths: data.attachmentPaths as string[] } : {}),
  ...(typeof data.lastModel === 'string' ? { lastModel: data.lastModel } : {}),
  ...(typeof data.lastProvider === 'string' ? { lastProvider: data.lastProvider } : {}),
});

/** Live list of this user's chats, most recently used first. */
export const subscribeChats = (
  uid: string,
  onChats: (chats: AiChat[]) => void,
  onError?: (e: unknown) => void,
): (() => void) => onSnapshot(
  query(chatsRef(uid), orderBy('updatedAt', 'desc')),
  snap => onChats(snap.docs.map(d => fromDoc(d.id, d.data() as Record<string, unknown>))),
  e => onError?.(e),
);

export const createChat = async (uid: string, id: string): Promise<AiChat> => {
  const chat = newChat(id, Date.now());
  await setDoc(chatRef(uid, chat.id), clean({
    title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages: [],
  }));
  return chat;
};

export interface SaveChatInput {
  messages: ChatMessage[];
  title?: string;
  attachmentSummaries?: string[];
  attachmentPaths?: string[];
  lastModel?: string;
  lastProvider?: string;
}

export const saveChat = async (uid: string, chatId: string, input: SaveChatInput): Promise<void> => {
  const messages = capMessages(input.messages);
  const title = autoTitle({ title: input.title || '', messages });
  await setDoc(chatRef(uid, chatId), clean({
    title,
    updatedAt: Date.now(),
    messages: messages.map(toStored),
    attachmentSummaries: input.attachmentSummaries,
    attachmentPaths: input.attachmentPaths,
    lastModel: input.lastModel,
    lastProvider: input.lastProvider,
  }), { merge: true });
};

export const renameChat = (uid: string, chatId: string, title: string): Promise<void> =>
  setDoc(chatRef(uid, chatId), { title: title.trim().slice(0, 60) || 'New chat', updatedAt: Date.now() }, { merge: true });

/**
 * Delete a chat, and the files that belonged to it.
 *
 * The attachments go FIRST: a failure to remove a file must not leave the
 * chat behind as well, because then nobody can find the file to try again.
 */
export const deleteChat = async (uid: string, chat: Pick<AiChat, 'id' | 'attachmentPaths'>): Promise<void> => {
  await deleteAttachments(chat.attachmentPaths || []);
  await deleteDoc(chatRef(uid, chat.id));
};

/**
 * Keep the list to MAX_SAVED_CHATS, oldest-by-last-use first.
 *
 * Run after a save rather than on a schedule: it is the only moment the list
 * can have grown, and a background job to delete fifty-first chats would be a
 * lot of machinery for a list somebody looks at once a week.
 */
export const pruneSavedChats = async (uid: string, chats: AiChat[]): Promise<string | undefined> => {
  const { prune, notice } = pruneChats(chats as AiChatSummary[], MAX_SAVED_CHATS);
  if (prune.length === 0) return undefined;
  for (const summary of prune) {
    const full = chats.find(c => c.id === summary.id);
    await deleteChat(uid, full || { id: summary.id }).catch(() => { /* best effort */ });
  }
  return notice;
};

/* ---------------- Attachments ---------------- */

export interface UploadedAttachment {
  name: string;
  path: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
}

export const attachmentPath = (uid: string, chatId: string, fileId: string, name: string): string => {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
  return `aiAttachments/${uid}/${chatId}/${fileId}-${safe}`;
};

/**
 * Keep a copy of what was sent.
 *
 * The file's CONTENTS go to the model directly from the browser (the callable
 * reads them out of the request), so this upload is not on the critical path
 * of an answer — it is so the conversation still shows what was attached when
 * somebody opens it next week. A failed upload therefore warns and does not
 * block the question.
 */
export const uploadAttachment = async (
  uid: string, chatId: string, fileId: string, file: File,
): Promise<UploadedAttachment> => {
  const { storage, ref, uploadBytes, getDownloadURL } = await storageApi();
  const path = attachmentPath(uid, chatId, fileId, file.name);
  const objectRef = ref(storage, path);
  await uploadBytes(objectRef, file, { contentType: file.type || 'application/octet-stream' });
  return {
    name: file.name,
    path,
    url: await getDownloadURL(objectRef),
    mimeType: file.type,
    sizeBytes: file.size,
  };
};

export const deleteAttachments = async (paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  try {
    const { storage, ref, deleteObject } = await storageApi();
    await Promise.all(paths.map(async p => {
      try { await deleteObject(ref(storage, p)); }
      catch (e) {
        // Already gone is success — the goal is that it is not there.
        if ((e as { code?: string })?.code !== 'storage/object-not-found') throw e;
      }
    }));
  } catch {
    /* Storage unavailable: the chat document still goes. */
  }
};

/* ---------------- Reading a file for sending ---------------- */

export const readAsText = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
  reader.onload = () => resolve(String(reader.result ?? ''));
  reader.readAsText(file);
});

export const readAsBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
  reader.onload = () => {
    const result = String(reader.result ?? '');
    // Strip the "data:...;base64," header — the callable wants the payload.
    resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
  };
  reader.readAsDataURL(file);
});

/* ---------------- The owner's usage view ---------------- */

export interface UsageDay {
  day: string;
  total: number;
  byOp: Record<string, number>;
}

/**
 * The last 30 days of AI usage for a workspace.
 *
 * Read directly rather than through a callable: these are counters, they live
 * in the workspace, and the rules already say only an owner may read them.
 */
export const loadAiUsage = async (workspaceId: string): Promise<UsageDay[]> => {
  const snap = await getDocs(query(
    collection(db, 'user_data', workspaceId, 'aiUsage'),
    orderBy('day', 'desc'),
  ));
  return snap.docs.slice(0, 30).map(d => {
    const data = d.data() as Record<string, unknown>;
    const byOp = (data.byOp || {}) as Record<string, unknown>;
    return {
      day: String(data.day ?? d.id),
      total: typeof data.total === 'number' ? data.total : 0,
      byOp: Object.fromEntries(
        Object.entries(byOp).map(([k, v]) => [k, typeof v === 'number' ? v : 0]),
      ),
    };
  });
};
