/**
 * FILES ATTACHED TO A MESSAGE — WHAT IS ALLOWED, AND WHAT IT COSTS.
 *
 * The shop's real cases are a supplier invoice (PDF), a price list or a batch
 * spreadsheet (CSV), and a photo of a label (image). All three are useful and
 * all three are the most expensive thing in this feature, so:
 *
 *   • CSV AND TEXT ARE PARSED HERE AND SENT AS TEXT. Sending a spreadsheet as
 *     a picture of a spreadsheet costs far more and reads far worse — the
 *     model has to do OCR on data that was already text.
 *   • ROWS AND PAGES ARE CAPPED, and the caller is told the cap BEFORE they
 *     send, so "I attached the whole price list" and "it read the first 200
 *     rows" cannot be two different beliefs held at once.
 *   • AN ATTACHMENT IS SENT ONCE. On later turns of the same conversation it
 *     is represented by a one-line summary. Resending a 40-page PDF on every
 *     message is the inventory bug again with a different payload.
 *
 * Both this and the client enforce the type and size rules. The client's copy
 * is for a decent error before an upload; THIS one is the rule.
 *
 * Pure: no Firebase, no model.
 */

export type AttachmentKind = "csv" | "text" | "pdf" | "image";

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;      // 8 MB
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;
/** Rows of a spreadsheet read, header included. */
export const MAX_CSV_ROWS = 200;
/** Characters of a text or parsed CSV file passed to the model. */
export const MAX_TEXT_CHARS = 20_000;
/** Pages of a PDF passed to the model. */
export const MAX_PDF_PAGES = 10;

export const ALLOWED_TYPES: Record<string, AttachmentKind> = {
  "text/csv": "csv",
  "application/csv": "csv",
  "text/plain": "text",
  "text/tab-separated-values": "csv",
  "application/pdf": "pdf",
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
};

export const ALLOWED_EXTENSIONS = [".csv", ".tsv", ".txt", ".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif"];

export interface AttachmentInput {
  name: string;
  mimeType: string;
  sizeBytes: number;
  /** Base64 for pdf/image, raw text for csv/text. */
  data: string;
}

export type AttachmentRejection =
  | "too-many"
  | "too-big"
  | "empty"
  | "type";

export const REJECTION_MESSAGE: Record<AttachmentRejection, string> = {
  "too-many": `Attach at most ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message.`,
  "too-big": `That file is too big — the limit is ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`,
  empty: "That file appears to be empty.",
  type: "That file type is not supported. Attach a PDF, a CSV, a text file or an image.",
};

export const kindOf = (mimeType: string, name = ""): AttachmentKind | null => {
  const direct = ALLOWED_TYPES[(mimeType || "").toLowerCase().split(";")[0].trim()];
  if (direct) return direct;
  // A CSV exported by a spreadsheet often arrives as application/octet-stream
  // or vnd.ms-excel; the extension is the better evidence in that case.
  const lower = (name || "").toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "csv";
  if (lower.endsWith(".txt")) return "text";
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png|webp|gif)$/.test(lower)) return "image";
  return null;
};

export type AttachmentCheck =
  | { ok: true; kind: AttachmentKind }
  | { ok: false; reason: AttachmentRejection; message: string };

export const checkAttachment = (a: AttachmentInput, indexInMessage = 0): AttachmentCheck => {
  const fail = (reason: AttachmentRejection): AttachmentCheck =>
    ({ ok: false, reason, message: REJECTION_MESSAGE[reason] });
  if (indexInMessage >= MAX_ATTACHMENTS_PER_MESSAGE) return fail("too-many");
  if (!a || !a.data) return fail("empty");
  if (a.sizeBytes > MAX_ATTACHMENT_BYTES) return fail("too-big");
  const kind = kindOf(a.mimeType, a.name);
  if (!kind) return fail("type");
  if (a.sizeBytes <= 0) return fail("empty");
  return { ok: true, kind };
};

/* ---------------- Turning a file into something worth sending ---------------- */

export interface PreparedAttachment {
  name: string;
  kind: AttachmentKind;
  /** For csv/text: the text to send. */
  text?: string;
  /** For pdf/image: base64, passed to the provider as a document/image block. */
  base64?: string;
  mediaType?: string;
  /** What the user is told, and what later turns reuse instead of the file. */
  summary: string;
  /** True when the cap cut something off. */
  truncated: boolean;
}

/** Split a CSV line, honouring quoted fields. Good enough for a price list. */
export const splitCsvLine = (line: string, delimiter = ","): string[] => {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { quoted = false; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
};

/**
 * A spreadsheet, as text the model can actually read.
 *
 * Rendered as aligned rows rather than raw CSV: a model reads "Model | Cost |
 * Qty" far better than a line of commas, and it costs about the same. Blank
 * lines and blank trailing columns are dropped because they are pure cost.
 */
export const prepareCsv = (name: string, raw: string): PreparedAttachment => {
  const text = raw.replace(/\r\n?/g, "\n");
  const delimiter = name.toLowerCase().endsWith(".tsv") || text.split("\n")[0]?.includes("\t") ? "\t" : ",";
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const kept = lines.slice(0, MAX_CSV_ROWS);
  const rows = kept.map((l) => splitCsvLine(l, delimiter));
  const width = Math.max(0, ...rows.map((r) => r.length));
  const rendered = rows
    .map((r) => [...r, ...Array(Math.max(0, width - r.length)).fill("")].join(" | "))
    .join("\n")
    .slice(0, MAX_TEXT_CHARS);
  const truncated = lines.length > kept.length || rendered.length >= MAX_TEXT_CHARS;
  const dataRows = Math.max(0, kept.length - 1);
  return {
    name,
    kind: "csv",
    text: rendered,
    truncated,
    summary: `${name} — spreadsheet, ${dataRows} row${dataRows === 1 ? "" : "s"} read${truncated ? ` of ${Math.max(0, lines.length - 1)}` : ""}`,
  };
};

export const prepareText = (name: string, raw: string): PreparedAttachment => {
  const text = raw.slice(0, MAX_TEXT_CHARS);
  const truncated = raw.length > text.length;
  return {
    name, kind: "text", text, truncated,
    summary: `${name} — text file, ${text.length} character${text.length === 1 ? "" : "s"} read${truncated ? " (truncated)" : ""}`,
  };
};

export const prepareBinary = (
  name: string,
  kind: "pdf" | "image",
  base64: string,
  mediaType: string,
): PreparedAttachment => ({
  name,
  kind,
  base64,
  mediaType,
  truncated: false,
  summary: kind === "pdf"
    ? `${name} — PDF, first ${MAX_PDF_PAGES} pages read`
    : `${name} — image`,
});

export const prepareAttachment = (a: AttachmentInput, kind: AttachmentKind): PreparedAttachment => {
  if (kind === "csv") return prepareCsv(a.name, a.data);
  if (kind === "text") return prepareText(a.name, a.data);
  return prepareBinary(a.name, kind, a.data, (a.mimeType || "").split(";")[0].trim());
};

/**
 * What the UI says BEFORE sending, so nobody believes the whole file went.
 *
 * Stated in rows and pages rather than bytes: "sending the first 200 rows" is
 * something a shop owner can act on; "sending 1.4 MB" is not.
 */
export const preSendNotice = (a: { name: string; kind: AttachmentKind; rows?: number }): string => {
  if (a.kind === "csv") {
    const rows = a.rows ?? 0;
    return rows > MAX_CSV_ROWS
      ? `${a.name}: sending the first ${MAX_CSV_ROWS} rows of ${rows}.`
      : `${a.name}: sending all ${rows} row${rows === 1 ? "" : "s"}.`;
  }
  if (a.kind === "pdf") return `${a.name}: sending the first ${MAX_PDF_PAGES} pages.`;
  if (a.kind === "text") return `${a.name}: sending the first ${MAX_TEXT_CHARS.toLocaleString()} characters.`;
  return `${a.name}: sending the image.`;
};
