import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import { InventoryItem, DeviceStatus } from '../types';
import { getDeviceDisplayName, kindOf } from '../domain/inventory';
import {
  LabelContent, LabelImages, LabelMedia, LabelOpts, LABEL_PREFS_KEY,
  deviceSubLine, deviceLabelSpecs, shortLabelSku, labelsPrintDoc,
} from './labelLayout';

/**
 * ONE INVENTORY LABEL, ASSEMBLED ONCE.
 *
 * The QR label is the one the owner puts on a device in the showcase. It was
 * only ever printable one row at a time, through the Print Label modal, so
 * putting a shelf of stock out meant opening that modal once per device —
 * while the SHELF TAG has had a bulk action all along.
 *
 * Everything the modal needs to build a label — the prefs, the content, the
 * QR/barcode images, the render options — lives here rather than in the
 * modal, so the batch is not a second implementation of the same label. That
 * is the only way "a batched label is identical to that item's single-item
 * print" can be a fact rather than a hope: both call the same functions, and
 * a test asserts the two documents agree.
 *
 * NOT in services/labelLayout.ts: that file is deliberately dependency-light
 * and has no DOM in it, and barcode generation needs a canvas.
 */

export type QrContent = 'sku' | 'id' | 'url' | 'imei';
export interface LabelPrefs {
  template: string;
  showBarcode: boolean;
  showQR: boolean;
  showStatus: boolean;
  qrContent: QrContent;
}

const QR_CONTENTS: QrContent[] = ['sku', 'id', 'url', 'imei'];

export const STATUS_LABEL: Record<DeviceStatus, string> = {
  pending_purchase: 'Pending Purchase',
  pending_repair: 'Pending Repair',
  ready: 'Ready for Sale',
  reserved: 'Reserved',
  sold: 'Sold',
  returned: 'Returned',
};

/**
 * The owner's saved label preferences — the SAME blob the modal writes.
 *
 * There is deliberately no second set of settings for the batch and no
 * template picker on it: the owner chose their stock once, in the modal or in
 * Settings, and a batch that asked again every time would be worse than the
 * per-item flow it replaces.
 */
export const loadLabelPrefs = (sizes: { id: string }[]): LabelPrefs => {
  try {
    const s = JSON.parse(localStorage.getItem(LABEL_PREFS_KEY) || '{}');
    return {
      template: sizes.some(t => t.id === s.template) ? s.template : (sizes[0]?.id || 'dymo-36x89'),
      showBarcode: s.showBarcode !== false, // default on
      showQR: s.showQR !== false,           // default on
      showStatus: s.showStatus !== false,   // default on
      qrContent: QR_CONTENTS.includes(s.qrContent) ? s.qrContent : 'sku',
    };
  } catch {
    return { template: 'dymo-36x89', showBarcode: true, showQR: true, showStatus: true, qrContent: 'sku' };
  }
};

/** Pick a retail symbology for a plain numeric UPC/EAN; otherwise CODE128. */
export const barcodeFormat = (v: string): string =>
  /^\d{12}$/.test(v) ? 'UPC' : /^\d{13}$/.test(v) ? 'EAN13' : /^\d{8}$/.test(v) ? 'EAN8' : 'CODE128';

export const genBarcode = (value: string, opts?: { format?: string; displayValue?: boolean }): string => {
  const displayValue = opts?.displayValue ?? false;
  const render = (format: string): string => {
    const c = document.createElement('canvas');
    JsBarcode(c, value || '0', { format, displayValue, margin: displayValue ? 6 : 0, height: 90, width: 2, fontSize: 20, textMargin: 2 });
    return c.toDataURL('image/png');
  };
  try { return render(opts?.format || 'CODE128'); }
  // A value that doesn't fit the chosen retail symbology falls back to CODE128.
  catch { try { return render('CODE128'); } catch { return ''; } }
};

/** The SKU-ish identifier a label is built around. */
export const labelSku = (item: InventoryItem): string => item.sku || item.imei || '';
/** Accessories print a UPC barcode — prefer the manufacturer's. */
export const labelUpc = (item: InventoryItem): string => (item.manufacturerBarcode || item.sku || '').trim();

/** What the device QR encodes, per the owner's Settings → Labels choice. */
export const qrPayload = (item: InventoryItem, qrContent: QrContent): string => {
  const sku = labelSku(item);
  const fallback = sku || 'N/A';
  if (qrContent === 'id') return item.id || fallback;
  if (qrContent === 'imei') return (item.imei || '').trim() || fallback;
  if (qrContent === 'url') return `${window.location.origin}/?sku=${encodeURIComponent(item.sku || item.id || '')}`;
  return sku || fallback;
};

/** The printed content for one item. Pure. */
export const buildLabelContent = (item: InventoryItem, storeName: string): LabelContent => {
  const isAccessory = kindOf(item) === 'accessory';
  const dn = getDeviceDisplayName(item);
  return {
    org: storeName,
    code: shortLabelSku(isAccessory ? (labelUpc(item) || labelSku(item)) : labelSku(item)),
    device: dn === '—' ? 'Item' : dn,
    sub: deviceSubLine(item),
    // A laptop's GPU and screen size. Empty for everything else, so a phone's
    // content shape is unchanged (PR #235).
    ...deviceLabelSpecs(item),
    serial: item.imei || undefined,
    status: item.deviceStatus ? STATUS_LABEL[item.deviceStatus] : undefined,
  };
};

/**
 * The render options for one item.
 *
 * AN ACCESSORY GETS A BARCODE-ONLY LABEL — no QR, no text, no status badge —
 * which is exactly what the single-item modal already gives it, and the
 * answer to "accessories may have no IMEI/serial for the QR": they do not get
 * one at all. Their identifier is the manufacturer's UPC, printed as a
 * scannable barcode with readable digits under it.
 */
export const buildLabelOpts = (
  item: InventoryItem,
  prefs: LabelPrefs,
  spacing: { paddingMm?: number; lineGapMm?: number; pushDownMm?: number },
): LabelOpts => (kindOf(item) === 'accessory'
  ? { showBarcode: true, showStatus: false, barcodeOnly: true }
  : {
      showBarcode: prefs.showBarcode, showStatus: prefs.showStatus,
      padMm: spacing.paddingMm, lineGapMm: spacing.lineGapMm, pushDownMm: spacing.pushDownMm,
    });

/** The QR/barcode bitmaps for one item. Async only because QR generation is. */
export const buildLabelImages = async (item: InventoryItem, prefs: LabelPrefs): Promise<LabelImages> => {
  if (kindOf(item) === 'accessory') {
    const upc = labelUpc(item) || labelSku(item);
    return { qr: '', barcode: genBarcode(upc, { format: barcodeFormat(upc), displayValue: true }) };
  }
  const qr = prefs.showQR
    ? await QRCode.toDataURL(qrPayload(item, prefs.qrContent), { margin: 2, width: 320, errorCorrectionLevel: 'M' })
        .catch(() => '')
    : '';
  return { qr, barcode: genBarcode(labelSku(item)) };
};

/**
 * HOW MANY LABELS ONE JOB WILL RENDER.
 *
 * Not a confirmation threshold — see `printInventoryLabelsBatch` for why there
 * is no dialog — but a ceiling on the WORK. Each label generates a QR bitmap
 * and a barcode canvas, so a stray select-all on a 600-row workspace would
 * lock the tab up for a long time before anything appeared on screen.
 *
 * 100 is comfortably more than a shelf of stock, which is what this is for.
 * Above it the batch refuses and says so, rather than silently printing the
 * first 100 — a truncated run is the worst outcome here, because the labels
 * that did print look fine and the missing ones are only noticed later.
 */
export const MAX_BATCH_LABELS = 100;
export const batchTooLargeMessage = (n: number): string =>
  `${n} items selected. Labels print in batches of up to ${MAX_BATCH_LABELS} — `
  + `narrow the selection and print it in parts.`;

/**
 * PRINT ONE LABEL PER SELECTED ITEM, IN ONE JOB.
 *
 * One window, every QR resolved together, one document — the same shape as
 * services/shelfTag.ts's `printShelfTagsBatch`, and through the same
 * multi-page builder every other label type in this app prints through
 * (`labelsPrintDoc` → `pagesPrintDoc`). No second print path, and no
 * `window.open` per item, which browsers block after the first anyway.
 *
 * NO CONFIRMATION STEP, DELIBERATELY. A 40-label job sent to a roll printer by
 * a mis-click is expensive; a dialog on every print is a tax on the thing this
 * was built to speed up. The resolution is that the batch does NOT auto-print:
 * it opens the laid-out document and waits, exactly as the shelf-tag batch and
 * the drop-off label batch do, so the operator sees the actual labels — not a
 * count in a dialog — and presses print themselves. A mis-click costs a window
 * they close. The single-item path keeps its auto-print, unchanged.
 *
 * A MIXED SELECTION IS FINE. Content, images and options are built per item,
 * so a phone, a laptop and an accessory in one job each render as their own
 * kind — including the laptop layout and the per-media fitting from PR #235,
 * which is computed per label body and so holds in a batch exactly as it does
 * alone.
 */
export async function printInventoryLabelsBatch(
  items: InventoryItem[],
  media: LabelMedia,
  prefs: LabelPrefs,
  opts: { storeName: string; spacing: { paddingMm?: number; lineGapMm?: number; pushDownMm?: number } },
): Promise<boolean> {
  if (items.length === 0) return false;
  if (items.length > MAX_BATCH_LABELS) {
    window.alert(batchTooLargeMessage(items.length));
    return false;
  }
  // Opened synchronously, in direct response to the click, so popup blockers
  // do not kick in while the QR codes are generated.
  const win = window.open('', '_blank', 'width=520,height=680');
  if (!win) return false;
  const entries = await Promise.all(items.map(async item => ({
    content: buildLabelContent(item, opts.storeName),
    images: await buildLabelImages(item, prefs),
    opts: buildLabelOpts(item, prefs, opts.spacing),
  })));
  win.document.write(labelsPrintDoc(`Labels (${items.length})`, media, entries));
  win.document.close();
  return true;
}
