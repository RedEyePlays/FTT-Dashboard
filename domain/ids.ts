import { ActivityEntry } from '../types';

// Short, sortable-ish unique id. Consolidated from the copies previously inlined
// in App.tsx and CartSaleView.tsx so every caller mints ids the same way.
export const newId = (): string =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export const mkActivity = (text: string): ActivityEntry => ({
  id: newId(),
  ts: Date.now(),
  text,
});
