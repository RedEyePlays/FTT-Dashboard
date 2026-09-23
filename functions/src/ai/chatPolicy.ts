import { MAX_HISTORY_TURNS, MAX_TURN_CHARS, Viewer } from "./retrievalPolicy";

/**
 * HOW MUCH OF THE CONVERSATION GETS RESENT, AND WHAT THE MODEL IS TOLD.
 *
 * The old chat resent the whole history AND the whole inventory on every turn,
 * so a twenty-message conversation cost twenty times the inventory. The
 * inventory is dealt with by retrieval; this file deals with the history:
 *
 *   • the most recent turns go verbatim, because that is the conversation;
 *   • everything older is replaced ONCE by a short summary, which is then
 *     carried forward — the summary is computed from the turns being dropped,
 *     not re-derived from scratch each time;
 *   • a single enormous turn (somebody pastes a logfile) is cut rather than
 *     being allowed to blow the budget on its own.
 *
 * The UI is told when this happened, because a conversation that silently
 * forgets its own beginning is worse than one that says it has.
 *
 * Pure: no Firebase, no model.
 */

export interface ChatTurn {
  role: string;
  parts: { text: string }[];
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface TrimResult {
  turns: Turn[];
  /** How many turns were dropped from the front. */
  dropped: number;
  /**
   * A one-paragraph stand-in for the dropped turns, or undefined when nothing
   * was dropped. Sent as the first user turn so the model has the thread.
   */
  summary?: string;
}

const clamp = (text: string): string =>
  text.length <= MAX_TURN_CHARS
    ? text
    : `${text.slice(0, MAX_TURN_CHARS)}\n…(cut — that message was too long to send in full)`;

/** The client's Gemini-shaped history → provider-neutral turns. */
export const toTurns = (history: ChatTurn[]): Turn[] => {
  const turns: Turn[] = (history || [])
    .map((h) => ({
      role: (h.role === "model" || h.role === "assistant" ? "assistant" : "user") as Turn["role"],
      text: clamp((h.parts || []).map((p) => p?.text || "").join("").trim()),
    }))
    .filter((t) => t.text.length > 0);
  // Every provider requires the conversation to start with the user.
  while (turns.length > 0 && turns[0].role === "assistant") turns.shift();
  return turns;
};

/**
 * Summarise the turns being dropped.
 *
 * DELIBERATELY NOT A MODEL CALL. Summarising with the model would mean a
 * second paid request on every long conversation — to save money. What the
 * model actually needs from turn 3 of 40 is what was ASKED about, so the
 * summary is the questions, shortened, in order. It is cheap, it is accurate,
 * and it cannot hallucinate.
 */
export const summariseDropped = (dropped: Turn[]): string | undefined => {
  const asked = dropped
    .filter((t) => t.role === "user")
    .map((t) => t.text.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((t) => (t.length > 120 ? `${t.slice(0, 117)}…` : t));
  if (asked.length === 0) return undefined;
  return [
    "EARLIER IN THIS CONVERSATION (summarised to keep the request small).",
    "These questions were already asked and answered:",
    ...asked.map((q, i) => `  ${i + 1}. ${q}`),
    "If the current question refers back to one of them, say what you need rather than guessing at the earlier answer.",
  ].join("\n");
};

/**
 * Keep the last `max` turns; summarise the rest.
 *
 * The cut lands on a USER turn so the replayed conversation still starts with
 * a question — cutting mid-exchange leaves an answer with nothing to answer.
 */
export const trimHistory = (turns: Turn[], max = MAX_HISTORY_TURNS): TrimResult => {
  if (turns.length <= max) return { turns, dropped: 0 };
  let cut = turns.length - max;
  while (cut < turns.length && turns[cut].role !== "user") cut++;
  const dropped = turns.slice(0, cut);
  const kept = turns.slice(cut);
  const summary = summariseDropped(dropped);
  return { turns: kept, dropped: dropped.length, ...(summary ? { summary } : {}) };
};

/* ---------------- The system prompt ---------------- */

export interface ChatPromptInput {
  shopName: string;
  /** The retrieved context block (timeline + summary), already redacted. */
  context: string;
  viewer: Viewer;
  /** Summaries of files attached earlier in this conversation. */
  attachmentSummaries?: string[];
}

/**
 * What the assistant is, and what it may not do.
 *
 * The old prompt pasted the inventory in and said "answer from the data
 * provided above". This one says the opposite thing explicitly: you have been
 * given a SELECTION, so say when you need more rather than inventing it — a
 * model given partial data and no warning that it is partial will fill the gap
 * confidently.
 */
export const chatSystemPrompt = (input: ChatPromptInput): string => {
  const lines: string[] = [
    `You are the assistant for ${input.shopName || "a phone and computer repair shop"}, talking to a member of staff.`,
    "",
    "WHAT YOU HAVE BEEN GIVEN:",
    "A short business summary, and ONLY the records that appear to relate to the question. This is a",
    "SELECTION, not the whole shop. If the answer needs something you were not given, say exactly what",
    "you need — 'I can see the sale but not the repair history; ask again naming the ticket number' —",
    "rather than guessing or extrapolating from what happens to be in front of you.",
    "",
    "RULES:",
    "1. Answer from the records below. Never invent a figure, a date, a customer or a device.",
    "2. Never state a total you have not been given the parts of. If you only have three of the sales,",
    "   say so instead of adding up three and calling it the month.",
    "3. Quote dates and amounts exactly as they appear.",
    "4. Be brief. A staff member at a counter wants the answer, not an essay.",
  ];

  if (!input.viewer.canSeeMoney) {
    lines.push(
      "5. This person's account does NOT have access to cost, margin or profit figures, so those have",
      "   been removed from what you can see. If they ask what something cost or what the shop made on",
      "   it, tell them plainly that their account does not have access to that — do not estimate it,",
      "   do not infer it from the sale price, and do not work it out from anything else in the records.",
    );
  }
  if (!input.viewer.canSeePayroll) {
    lines.push(
      "6. This person's account does not have access to payroll. Wages, hours, bonuses and pay periods",
      "   are not available to you for them — say so if asked.",
    );
  }

  if (input.attachmentSummaries?.length) {
    lines.push(
      "",
      "FILES ATTACHED EARLIER IN THIS CONVERSATION:",
      ...input.attachmentSummaries.map((s) => `  • ${s}`),
      "The full contents were read once and are not repeated on every message. If you need something",
      "specific from a file again, ask for it to be re-attached.",
    );
  }

  lines.push("", "RECORDS:", input.context);
  return lines.join("\n");
};
