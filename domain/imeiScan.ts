import { normalizeIdentifier, normalizeSerial } from './autoInventory';

// The camera scanner's pure decision layer: classifying raw decoded values
// (barcode payloads, OCR tokens) and validating Gemini's structured
// extraction, all independent of any browser API so it's fully unit-testable
// without a camera, a barcode reader, or a network call. components/
// ImeiScanner.tsx and services/imeiBarcode.ts / services/imeiOcr.ts are the
// only callers that ever touch real device/browser APIs.

export type ScanTier = 'barcode' | 'ocr' | 'ai';

export type ScannedFieldKey = 'imei1' | 'imei2' | 'serial' | 'eid';

export interface ScannedField {
  key: ScannedFieldKey;
  label: string;
  value: string;
  // False when an IMEI-shaped value failed the Luhn checksum — still
  // surfaced to the user (flagged), never silently accepted as good and
  // never silently dropped.
  verified: boolean;
}

const FIELD_LABELS: Record<ScannedFieldKey, string> = {
  imei1: 'IMEI1', imei2: 'IMEI2', serial: 'Serial', eid: 'EID',
};

/**
 * Classify one raw decoded string (a barcode payload, or an OCR token) as a
 * scanned field, or null if it doesn't look like an IMEI or a plausible
 * serial. A 15-digit value is always treated as an IMEI candidate (verified
 * only if it also passes Luhn — reuses domain/autoInventory.ts's existing
 * normalization so this never re-implements the checksum). Anything else is
 * only accepted as a serial if it's alphanumeric and a plausible length —
 * short/long junk (a lone digit, a URL, a part-number barcode) is dropped
 * rather than surfaced as a fake "serial".
 */
export function classifyScannedValue(raw: string): ScannedField | null {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  const { normalized, looksLikeImei, imeiValid } = normalizeIdentifier(trimmed);
  if (looksLikeImei) {
    return { key: 'imei1', label: FIELD_LABELS.imei1, value: normalized, verified: imeiValid };
  }

  const serial = normalizeSerial(trimmed);
  // A plausible serial is purely alphanumeric — punctuation-laden junk (OCR
  // noise, a stray "##", a URL fragment) is rejected rather than surfaced as
  // a fake "serial", and it must contain at least one digit (a pure word
  // like "PHONE" read off a label isn't a serial either).
  if (serial.length >= 5 && serial.length <= 30 && /^[A-Z0-9]+$/.test(serial) && /\d/.test(serial)) {
    return { key: 'serial', label: FIELD_LABELS.serial, value: serial, verified: true };
  }
  return null;
}

/**
 * Classify a batch of raw decoded values from a single capture (a barcode
 * scan can find several codes on one box; an OCR pass can find several
 * tokens on one screen). Values are classified independently, never assuming
 * a fixed print order. The second distinct valid IMEI-shaped value found in
 * the same batch is assigned to IMEI2 (dual-SIM boxes print both IMEI1 and
 * IMEI2 barcodes) rather than overwriting IMEI1 or being dropped.
 */
export function classifyScannedValues(raws: string[]): ScannedField[] {
  const out: ScannedField[] = [];
  const seen = new Set<string>();
  let nextImeiSlot: 'imei1' | 'imei2' | null = 'imei1';

  for (const raw of raws) {
    const field = classifyScannedValue(raw);
    if (!field) continue;
    if (seen.has(`${field.key}:${field.value}`)) continue;

    if (field.key === 'imei1') {
      if (!nextImeiSlot) continue; // already have IMEI1 and IMEI2 this batch
      const key = nextImeiSlot;
      nextImeiSlot = key === 'imei1' ? 'imei2' : null;
      out.push({ ...field, key, label: FIELD_LABELS[key] });
      seen.add(`${key}:${field.value}`);
    } else {
      out.push(field);
      seen.add(`${field.key}:${field.value}`);
    }
  }
  return out;
}

// Gemini's structured imeiExtract response, before validation. Every field is
// the literal string it read (or absent/blank) — the server prompt is
// instructed to never invent a value it can't actually see.
export interface RawExtractedFields {
  imei1?: string | null;
  imei2?: string | null;
  serial?: string | null;
  eid?: string | null;
}

/**
 * Validate Gemini's structured extraction before any of it reaches the UI as
 * a trustworthy value. IMEI fields must be 15 digits and pass Luhn to come
 * back verified; a candidate that fails is still returned — flagged
 * unverified — rather than silently accepted as a good IMEI or silently
 * dropped, so the user can still choose to use it deliberately. A field the
 * model left blank/absent is omitted entirely: never fabricated as an empty
 * placeholder value.
 */
export function validateExtractedFields(raw: RawExtractedFields): ScannedField[] {
  const out: ScannedField[] = [];

  (['imei1', 'imei2'] as const).forEach(key => {
    const v = (raw[key] || '').trim();
    if (!v) return;
    const { normalized, imeiValid } = normalizeIdentifier(v);
    out.push({ key, label: FIELD_LABELS[key], value: normalized || v, verified: imeiValid });
  });

  const serial = (raw.serial || '').trim();
  if (serial) out.push({ key: 'serial', label: FIELD_LABELS.serial, value: normalizeSerial(serial), verified: true });

  const eid = (raw.eid || '').trim();
  if (eid) out.push({ key: 'eid', label: FIELD_LABELS.eid, value: eid.toUpperCase().replace(/\s+/g, ''), verified: true });

  return out;
}

/**
 * Merge a newly-captured set of fields into what earlier shots in the same
 * scanning session already found. A rescan of the same field (a deliberate
 * retake) overwrites it with the fresh read; a field seen for the first time
 * is added; a field NOT present in this capture is left untouched — so
 * scanning the box for the serial, then the screen for IMEI1/IMEI2, keeps
 * everything found across both shots instead of the second capture
 * clobbering the first.
 */
export function mergeScannedFields(existing: ScannedField[], incoming: ScannedField[]): ScannedField[] {
  const byKey = new Map(existing.map(f => [f.key, f] as const));
  for (const f of incoming) byKey.set(f.key, f);
  const order: ScannedFieldKey[] = ['imei1', 'imei2', 'serial', 'eid'];
  return order.filter(k => byKey.has(k)).map(k => byKey.get(k)!);
}
