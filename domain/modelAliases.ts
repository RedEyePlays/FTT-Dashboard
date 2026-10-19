/**
 * THE SEED SHORTHAND, and the client's copy of the alias shape.
 *
 * Its own tiny module so domain/settings.ts can hold the default without
 * importing from functions/ (a separate TypeScript project) and without
 * settings.ts and the AI parser each carrying their own list.
 *
 * The authoritative list is the one in settings — these are only what a new
 * workspace starts with. functions/src/ai/countPolicy.ts has the matching
 * server copy, which is what actually expands a question.
 */
export interface ModelAlias {
  /** What the owner types: "15pm". Matched as a whole token. */
  alias: string;
  /** What it means: "iPhone 15 Pro Max". */
  model: string;
}

export const SEED_MODEL_ALIASES: ModelAlias[] = [
  { alias: '15pm', model: 'iPhone 15 Pro Max' },
  { alias: '15p', model: 'iPhone 15 Pro' },
  { alias: '14pm', model: 'iPhone 14 Pro Max' },
  { alias: '14p', model: 'iPhone 14 Pro' },
  { alias: '13pm', model: 'iPhone 13 Pro Max' },
  { alias: 's24u', model: 'Galaxy S24 Ultra' },
  { alias: 's23u', model: 'Galaxy S23 Ultra' },
  { alias: 's24', model: 'Galaxy S24' },
  { alias: 'fold5', model: 'Galaxy Z Fold 5' },
  { alias: 'flip5', model: 'Galaxy Z Flip 5' },
];
