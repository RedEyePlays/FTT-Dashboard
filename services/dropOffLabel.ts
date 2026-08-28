import QRCode from 'qrcode';
import { DropOff, DeviceBuyer } from '../types';
import { dropOffLabelMoney } from '../domain/dropoffs';
import {
  LabelMedia, DropOffLabelContent, DropOffLabelOpts, dropOffLabelsPrintDoc,
} from './labelLayout';

// Printable per-device DROP-OFF LABEL: the physical tag that goes on a
// financed device so anyone handling it can see whose it is and what's owed
// on it, and scan its IMEI.
//
// This file is only the thin, untestable shell — QR bitmap generation (the
// same `qrcode` library and options components/LabelModal.tsx and
// services/shelfTag.ts already use) plus the window.open/write dance. ALL
// layout, geometry, media handling and the physical print page live in the
// shared label system (services/labelLayout.ts's drop-off template, which
// prints through the very same page/rotation builder as the inventory label),
// and all the money wording comes from domain/dropoffs.ts's dropOffLabelMoney.
// Nothing here duplicates either.

// WHO MAY PRINT ONE: services/rbac.ts's canPrintDropOffLabel ('dropoffs.manage'
// — these labels carry cost and fee figures). It deliberately lives there, not
// here, so App.tsx can read the gate without importing this module's `qrcode`
// dependency into the main bundle — see that function's own comment.

/**
 * Build one label's content from a drop-off + its buyer. Pure — no DOM, no
 * QR — so what the label actually SAYS can be asserted directly.
 *
 * The reference id is the drop-off's own id, shortened the same way sale and
 * layaway references are shown throughout the app (first 8 characters), which
 * is what staff match against on screen.
 */
export function dropOffLabelContent(
  d: DropOff,
  buyer: DeviceBuyer | undefined,
  storeName: string,
): DropOffLabelContent {
  const money = dropOffLabelMoney(d);
  return {
    org: storeName,
    buyerName: buyer?.name || 'Unknown buyer',
    device: d.item || 'Device',
    serial: (d.imei || '').trim() || undefined,
    fundingLabel: money.fundingLabel,
    moneyLine: money.moneyLine,
    dateDropped: d.dateDropped,
    ref: d.id.slice(0, 8),
  };
}

// The QR encodes the device's IMEI/serial — matching the inventory label's
// IMEI QR behaviour and the shelf tag's, so one scanner workflow reads every
// label this shop prints. A drop-off with no IMEI recorded simply gets no QR
// rather than a QR of an empty string.
const serialQr = (c: DropOffLabelContent): Promise<string | undefined> =>
  c.serial
    ? QRCode.toDataURL(c.serial, { margin: 1, width: 320, errorCorrectionLevel: 'M' }).catch(() => undefined)
    : Promise.resolve(undefined);

/**
 * Print labels for one or more drop-off devices as a SINGLE print job (one
 * physical label per page). Used for both the single-device action and the
 * "print all pending for this buyer" batch — one code path, so a batch can
 * never render differently from a single label.
 *
 * The window is opened synchronously, before the QRs are generated, so popup
 * blockers don't kill it mid-await (same reason services/shelfTag.ts does).
 */
export async function printDropOffLabels(
  contents: DropOffLabelContent[],
  media: LabelMedia | undefined,
  opts: DropOffLabelOpts = {},
): Promise<boolean> {
  if (!contents.length || !media) return false;
  const win = window.open('', '_blank', 'width=420,height=320');
  if (!win) return false;
  const qrs = await Promise.all(contents.map(serialQr));
  const title = contents.length === 1
    ? `Drop-Off Label ${contents[0].ref}`
    : `Drop-Off Labels (${contents.length})`;
  win.document.write(dropOffLabelsPrintDoc(title, media, contents.map((content, i) => ({ content, qr: qrs[i] })), opts));
  win.document.close();
  return true;
}
