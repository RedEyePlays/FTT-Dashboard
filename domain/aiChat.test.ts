import { describe, it, expect } from 'vitest';
import { ChatMessage } from '../types';
import {
  ATTACHMENT_ERROR, MAX_ATTACHMENTS_PER_MESSAGE, MAX_ATTACHMENT_BYTES, MAX_CSV_ROWS,
  MAX_MESSAGES_PER_CHAT, MAX_SAVED_CHATS, NEW_CHAT_TITLE,
  attachmentKind, autoTitle, capMessages, checkAttachment, countCsvRows, newChat,
  preSendNotice, pruneChats, titleFromFirstMessage, toHistory,
} from './aiChat';

const msg = (over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: 'm1', role: 'user', text: 'what happened to PHN-000123', timestamp: new Date(), ...over,
});

const chat = (id: string, updatedAt: number) => ({
  id, title: id, createdAt: 1, updatedAt, messageCount: 2,
});

describe('titles', () => {
  it('come from the first question', () => {
    expect(titleFromFirstMessage('what happened to PHN-000123')).toBe('what happened to PHN-000123');
  });

  it('are cut at a word boundary, never mid-word', () => {
    const long = 'what happened to the iPhone 13 Pro we took in from Dana on the fourteenth of June';
    const title = titleFromFirstMessage(long);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith('…')).toBe(true);
    // The kept text is a prefix of the original that ends where a word ends —
    // a title broken mid-word reads as a rendering fault, not an abbreviation.
    const kept = title.slice(0, -1);
    expect(long.startsWith(kept)).toBe(true);
    expect(long[kept.length]).toBe(' ');
  });

  it('fall back rather than being empty', () => {
    expect(titleFromFirstMessage('')).toBe(NEW_CHAT_TITLE);
    expect(titleFromFirstMessage('   ')).toBe(NEW_CHAT_TITLE);
  });

  it('auto-title uses the first USER message, and never overwrites a rename', () => {
    expect(autoTitle({ title: NEW_CHAT_TITLE, messages: [msg({ role: 'model', text: 'Hello' }), msg({ text: 'stock levels' })] }))
      .toBe('stock levels');
    expect(autoTitle({ title: 'Warranty questions', messages: [msg()] })).toBe('Warranty questions');
    expect(autoTitle({ title: NEW_CHAT_TITLE, messages: [] })).toBe(NEW_CHAT_TITLE);
  });
});

describe('pruning', () => {
  it('keeps everything under the cap', () => {
    const r = pruneChats([chat('a', 3), chat('b', 2)]);
    expect(r.prune).toEqual([]);
    expect(r.notice).toBeUndefined();
    // …and returns them most-recent first.
    expect(r.keep.map(c => c.id)).toEqual(['a', 'b']);
  });

  it('prunes the LEAST RECENTLY USED, not the oldest by creation', () => {
    // A conversation somebody returns to every week is the one they would
    // miss, however long ago it started.
    const chats = Array.from({ length: MAX_SAVED_CHATS + 3 }, (_, i) => chat(`c${i}`, i));
    const r = pruneChats(chats);
    expect(r.keep).toHaveLength(MAX_SAVED_CHATS);
    expect(r.prune.map(c => c.id)).toEqual(['c2', 'c1', 'c0']);
  });

  it('says what went, rather than silently losing the tail', () => {
    const r = pruneChats(Array.from({ length: MAX_SAVED_CHATS + 1 }, (_, i) => chat(`c${i}`, i)));
    expect(r.notice).toMatch(/least recently used/);
    expect(r.notice).toContain(String(MAX_SAVED_CHATS));
  });
});

describe('one chat cannot grow forever either', () => {
  it('keeps the most recent messages', () => {
    const messages = Array.from({ length: MAX_MESSAGES_PER_CHAT + 10 }, (_, i) => msg({ id: `m${i}` }));
    const kept = capMessages(messages);
    expect(kept).toHaveLength(MAX_MESSAGES_PER_CHAT);
    expect(kept[kept.length - 1].id).toBe(`m${messages.length - 1}`);
  });

  it('leaves a short chat alone', () => {
    const messages = [msg()];
    expect(capMessages(messages)).toBe(messages);
  });
});

describe('the history sent to the server', () => {
  it('drops the UI-only welcome message', () => {
    const history = toHistory([msg({ id: 'welcome', role: 'model', text: 'Hi!' }), msg({ text: 'q' })]);
    expect(history).toEqual([{ role: 'user', parts: [{ text: 'q' }] }]);
  });

  it('carries NO inventory — the server retrieves what it needs', () => {
    // The whole point: the client sends the conversation, nothing else.
    const history = toHistory([msg()]);
    expect(JSON.stringify(history)).not.toMatch(/inventory/i);
    expect(Object.keys(history[0])).toEqual(['role', 'parts']);
  });
});

describe('a new chat', () => {
  it('starts empty and untitled', () => {
    const c = newChat('id-1', 1000);
    expect(c).toMatchObject({ id: 'id-1', title: NEW_CHAT_TITLE, createdAt: 1000, updatedAt: 1000, messageCount: 0 });
    expect(c.messages).toEqual([]);
  });
});

describe('attachments', () => {
  const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
    name: 'prices.csv', type: 'text/csv', size: 1024, ...over,
  });

  it('accepts the four supported kinds', () => {
    expect(attachmentKind('text/csv')).toBe('csv');
    expect(attachmentKind('application/pdf')).toBe('pdf');
    expect(attachmentKind('image/png')).toBe('image');
    expect(attachmentKind('text/plain')).toBe('text');
  });

  it('falls back to the extension when a spreadsheet sends a junk type', () => {
    expect(attachmentKind('application/octet-stream', 'batch.csv')).toBe('csv');
    expect(attachmentKind('application/vnd.ms-excel', 'batch.csv')).toBe('csv');
  });

  it('REJECTS an unsupported type, before an upload starts', () => {
    const r = checkAttachment(file({ name: 'clip.mp4', type: 'video/mp4' }), 0);
    expect(r).toMatchObject({ ok: false, error: 'type', message: ATTACHMENT_ERROR.type });
  });

  it('rejects an over-size file, with the limit in the message', () => {
    const r = checkAttachment(file({ size: MAX_ATTACHMENT_BYTES + 1 }), 0);
    expect(r).toMatchObject({ ok: false, error: 'size' });
    expect((r as { message: string }).message).toContain('8 MB');
  });

  it('rejects more than the per-message limit', () => {
    expect(checkAttachment(file(), MAX_ATTACHMENTS_PER_MESSAGE - 1).ok).toBe(true);
    expect(checkAttachment(file(), MAX_ATTACHMENTS_PER_MESSAGE)).toMatchObject({ ok: false, error: 'count' });
  });

  it('says what will actually be sent, in rows and pages', () => {
    expect(preSendNotice({ name: 'big.csv', kind: 'csv', rows: 900 }))
      .toBe(`big.csv: sending the first ${MAX_CSV_ROWS} rows of 900.`);
    expect(preSendNotice({ name: 'small.csv', kind: 'csv', rows: 3 })).toBe('small.csv: sending all 3 rows.');
    expect(preSendNotice({ name: 'invoice.pdf', kind: 'pdf' })).toMatch(/first 10 pages/);
  });

  it('counts CSV rows without the header, ignoring blank lines', () => {
    expect(countCsvRows('Model,Cost\niPhone,540\n\nPixel,300\n')).toBe(2);
  });
});
