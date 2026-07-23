// Pure ZPL II generation for repair labels. No DOM / network here so it can be
// unit-tested; the Browser Print transport lives in services/zebra.ts.
//
// Label sizes now come from the single shared definition in domain/settings.ts
// (built-in presets + user custom sizes), so a size added in Settings is usable
// for both the browser/HTML label path and this Zebra ZPL path. The built-ins are
// re-exported here as LABEL_SIZES; custom sizes reach buildZpl via the caller,
// which passes the chosen dims (from the merged list) — buildZpl takes any
// LabelDims, so no change is needed for a custom size to print.

import { BUILT_IN_LABEL_SIZES, LabelSize } from '../domain/settings';

export type LabelDims = LabelSize;
export type LabelSizeId = string; // kept for back-compat; ids are now open strings

// The built-in presets (Dymo 36 × 89 mm is primary). Callers with settings should
// use the merged list (built-ins + custom) instead of this static array.
export const LABEL_SIZES: LabelDims[] = BUILT_IN_LABEL_SIZES;

export type Dpi = 203 | 300;

export interface ZplLabelData {
  org: string;      // "FlipThatTech"
  idLine: string;   // repair number (retail) or batch number + line (wholesale)
  device: string;   // device name
  imei?: string;    // IMEI / serial
  issue?: string;   // reported issue
  qrData: string;   // encoded into the QR (the repair/device document id)
}

// Convert inches to printer dots. 2x1 @ 203 dpi -> 406 x 203 dots.
export const labelDots = (inches: number, dpi: Dpi) => Math.round(inches * dpi);

// ZPL is 7-bit safe by default; drop control chars (^ ~) and fold non-ASCII to a
// plain approximation so scalable fonts render predictably on the print head.
const zplText = (s: string | undefined, max: number): string =>
  (s || '')
    .replace(/[·•]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[\^~]/g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .slice(0, max)
    .trim();

/**
 * Build a ZPL II label sized to the physical stock at the given DPI. The layout
 * mirrors the on-screen/browser label: a left text column and a right QR code.
 */
export function buildZpl(data: ZplLabelData, dims: LabelDims, dpi: Dpi, density?: number): string {
  const w = labelDots(dims.w, dpi);
  const h = labelDots(dims.h, dpi);
  const pad = labelDots(0.06, dpi);
  const large = dims.w >= 4;

  // QR magnification: target ~40–62% of the short edge; a v1–v4 QR is ~21–33
  // modules, so mag = target / ~30, clamped to a sane thermal range.
  const qrTarget = Math.min(w, h) * (dims.h >= 3 ? 0.4 : 0.62);
  const qrMag = Math.max(2, Math.min(10, Math.round(qrTarget / 30)));
  const qrPx = qrMag * 30; // approximate rendered size for placement
  const qrX = Math.max(pad, w - pad - qrPx);
  const qrY = Math.max(0, Math.round((h - qrPx) / 2));

  // Text block width stops before the QR so long values truncate, never overlap.
  const blockW = Math.max(40, qrX - pad - pad);

  // Font heights (dots) scale with stock size.
  const fBig = large ? labelDots(0.2, dpi) : labelDots(0.13, dpi);
  const fMid = large ? labelDots(0.12, dpi) : labelDots(0.085, dpi);
  const fSml = large ? labelDots(0.095, dpi) : labelDots(0.07, dpi);

  const line = (y: number, fh: number, text: string) =>
    text ? `^FO${pad},${y}^A0N,${fh},${fh}^FB${blockW},1,0,L,0^FD${text}^FS\n` : '';

  // Stack the text column from the top padding downward.
  let y = pad;
  let body = '';
  body += line(y, fSml, zplText(data.org, 24)); y += fSml + Math.round(fSml * 0.35);
  body += line(y, fBig, zplText(data.idLine, 22)); y += fBig + Math.round(fBig * 0.25);
  body += line(y, fMid, zplText(data.device, 28)); y += fMid + Math.round(fMid * 0.3);
  if (data.imei) { body += line(y, fSml, zplText(data.imei, 26)); y += fSml + Math.round(fSml * 0.3); }
  if (data.issue) { body += line(y, fSml, zplText(data.issue, 30)); }

  const qr = data.qrData
    ? `^FO${qrX},${qrY}^BQN,2,${qrMag}^FDMA,${data.qrData.replace(/[\^~]/g, '')}^FS\n`
    : '';

  // ^MD sets media darkness (density) relative to the printer default (-30..30)
  // when the caller provides one; otherwise leave the printer's own setting.
  const md = typeof density === 'number' && !Number.isNaN(density)
    ? `^MD${Math.max(-30, Math.min(30, Math.round(density)))}\n`
    : '';

  return (
    `^XA\n` +
    `^CI28\n` +           // UTF-8 input
    `^PW${w}\n` +         // print width (dots)
    `^LL${h}\n` +         // label length (dots)
    `^LH0,0\n` +          // label home = top-left origin
    md +
    body +
    qr +
    `^PQ1\n` +            // one copy
    `^XZ`
  );
}
