// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * THE ASSISTANT'S CLIENT SIDE.
 *
 * Two properties matter here and neither is visible by reading the component
 * top to bottom:
 *
 *   • an attachment is sent ONCE — on turn two it is a one-line summary, not
 *     the file again (resending a 40-page PDF every message is the inventory
 *     bug with a different payload);
 *   • the inventory is not sent AT ALL any more.
 */

const chats: Record<string, unknown>[] = [];
const saved: { calls: Record<string, unknown>[] } = { calls: [] };

vi.mock('../services/aiChats', () => ({
  subscribeChats: (_uid: string, onChats: (c: unknown[]) => void) => { onChats(chats); return () => {}; },
  createChat: async (_uid: string, id: string) => ({
    id, title: 'New chat', createdAt: 1, updatedAt: 1, messageCount: 0, messages: [],
  }),
  saveChat: async (_uid: string, _id: string, input: Record<string, unknown>) => { saved.calls.push(input); },
  renameChat: async () => {},
  deleteChat: async () => {},
  pruneSavedChats: async () => undefined,
  uploadAttachment: async () => ({ name: 'prices.csv', path: 'p', url: 'u', mimeType: 'text/csv', sizeBytes: 10 }),
  readAsText: async () => 'Model,Cost\niPhone,540',
  readAsBase64: async () => 'AAAA',
  loadAiUsage: async () => [],
}));

const chatCalls: { messages: unknown[]; opts: Record<string, unknown> }[] = [];
vi.mock('../services/geminiService', () => ({
  generateChatResponse: async (messages: unknown[], opts: Record<string, unknown> = {}) => {
    chatCalls.push({ messages, opts });
    return {
      text: 'Answer.',
      notices: [],
      model: 'claude-sonnet-5',
      provider: 'claude',
      attachmentSummaries: ['prices.csv — spreadsheet, 1 row read'],
    };
  },
}));

vi.mock('../hooks/useConnectionStatus', () => ({ useConnectionStatus: () => 'online' }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let AIChatView: React.FC<{ userId: string; variant?: 'full' | 'sidebar'; onClose?: () => void }>;

beforeEach(async () => {
  chats.length = 0;
  saved.calls.length = 0;
  chatCalls.length = 0;
  ({ AIChatView } = await import('./AIChatView'));
});

afterEach(() => { vi.clearAllMocks(); });

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const type = (el: HTMLTextAreaElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});

const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

const sendButton = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('button')).find(b => b.querySelector('svg') && b.className.includes('rounded-xl') && !b.title)!;

const attachFile = (host: HTMLElement, file: File) => {
  const input = host.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  return act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
};

const csv = () => new File(['Model,Cost\niPhone,540'], 'prices.csv', { type: 'text/csv' });

describe('what the client actually sends', () => {
  it('sends the conversation and NOT the inventory', async () => {
    const { host, unmount } = mount(<AIChatView userId="u1" />);
    type(host.querySelector('textarea')!, 'what happened to PHN-000123');
    click(sendButton(host));
    await flush();

    expect(chatCalls).toHaveLength(1);
    const sent = JSON.stringify(chatCalls[0]);
    expect(sent).toContain('PHN-000123');
    // The old call took `inventory` as its first argument and serialised the
    // whole shop into it.
    expect(chatCalls[0].opts.inventory).toBeUndefined();
    expect(sent).not.toMatch(/purchaseCost|targetSalePrice/);
    unmount();
  });

  it('shows the model the SERVER reported, not a hardcoded label', async () => {
    const { host, unmount } = mount(<AIChatView userId="u1" />);
    expect(host.textContent).not.toContain('Gemini 2.5 Flash');
    type(host.querySelector('textarea')!, 'hello');
    click(sendButton(host));
    await flush();
    expect(host.textContent).toContain('claude-sonnet-5');
    unmount();
  });
});

describe('attachments', () => {
  it('states what will be sent BEFORE sending', async () => {
    const { host, unmount } = mount(<AIChatView userId="u1" />);
    await attachFile(host, csv());
    await flush();
    expect(host.textContent).toMatch(/prices\.csv: sending all 1 row/);
    unmount();
  });

  it('sends the file on turn one and the SUMMARY on turn two', async () => {
    chats.push({
      id: 'c1', title: 'x', createdAt: 1, updatedAt: 1, messageCount: 0, messages: [],
      attachmentSummaries: [],
    });
    const { host, unmount } = mount(<AIChatView userId="u1" />);

    await attachFile(host, csv());
    await flush();
    type(host.querySelector('textarea')!, 'what is in this list?');
    click(sendButton(host));
    await flush();

    // Turn one carries the file itself.
    const first = chatCalls[0].opts as { attachments?: unknown[] };
    expect(first.attachments).toHaveLength(1);
    expect(JSON.stringify(first.attachments)).toContain('prices.csv');

    // The saved chat now carries the summary the server handed back…
    expect(saved.calls[0].attachmentSummaries).toEqual(['prices.csv — spreadsheet, 1 row read']);

    // …and turn two sends NO file.
    type(host.querySelector('textarea')!, 'and the second row?');
    click(sendButton(host));
    await flush();

    expect(chatCalls).toHaveLength(2);
    const second = chatCalls[1].opts as { attachments?: unknown[] };
    expect(second.attachments ?? []).toHaveLength(0);
    unmount();
  });

  it('refuses an unsupported type before anything is uploaded or sent', async () => {
    const { host, unmount } = mount(<AIChatView userId="u1" />);
    await attachFile(host, new File(['x'], 'clip.mp4', { type: 'video/mp4' }));
    await flush();
    expect(host.textContent).toMatch(/Only PDFs, spreadsheets/);
    expect(chatCalls).toHaveLength(0);
    unmount();
  });

  it('refuses an over-size file the same way', async () => {
    const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 });
    const { host, unmount } = mount(<AIChatView userId="u1" />);
    await attachFile(host, big);
    await flush();
    expect(host.textContent).toMatch(/too big/);
    unmount();
  });
});

/**
 * NOTHING GENERATES ON ITS OWN.
 *
 * Asserted against the source of all three AI surfaces, because the failure
 * mode is a `useEffect` somebody adds later "so it's ready when you open it" —
 * which is a paid request per page view.
 */
describe('no automatic generation, anywhere', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  const CALLS: Record<string, string> = {
    'components/AIChatView.tsx': 'generateChatResponse',
    'components/ListingModal.tsx': 'generateListing',
    'components/GpuPerformanceSettings.tsx': 'proposeGpuPerformance',
  };

  for (const [file, call] of Object.entries(CALLS)) {
    it(`${file} never calls ${call} from a useEffect`, () => {
      const src = read(file);
      // Every useEffect body in the file, non-greedy to its closing `}, [`.
      const effects = src.match(/useEffect\(\(\)\s*=>\s*\{[\s\S]*?\n\s*\}, \[/g) || [];
      for (const effect of effects) {
        expect({ file, auto: effect.includes(call) }).toEqual({ file, auto: false });
      }
    });

    it(`${file} calls ${call} exactly where a human asked for it`, () => {
      const src = read(file);
      // It is still called — a test that passes because the feature is gone
      // is not a useful test.
      expect(src.includes(call)).toBe(true);
      // …and never in a retry loop.
      expect(/setInterval|setTimeout\([^)]*generate/i.test(src)).toBe(false);
    });
  }
});
