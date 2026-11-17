// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InventoryItem } from '../types';
import { labelPrintDoc, labelsPrintDoc, LabelMedia, LABEL_PREFS_KEY } from './labelLayout';
import {
  MAX_BATCH_LABELS, batchTooLargeMessage, buildLabelContent, buildLabelImages, buildLabelOpts,
  loadLabelPrefs, printInventoryLabelsBatch, qrPayload,
} from './inventoryLabel';

/**
 * BULK QR LABELS.
 *
 * Selecting rows in Inventory has offered Print Shelf Tags in bulk all along,
 * with no equivalent for the QR label — the one the owner puts on a device in
 * the showcase. Putting a shelf of stock out meant opening the Print Label
 * modal once per device.
 *
 * The machinery already existed: `labelPrintDoc` is a ONE-ELEMENT call into a
 * multi-page builder, and the drop-off labels already pass an array to the
 * same helper. So the batch is that call with more bodies — not a second
 * print path — and one label's content is assembled in exactly one place so
 * the batch and the modal cannot drift.
 */

const MEDIA: LabelMedia = { id: 'dymo-36x89', w: 3.5039370078740157, h: 1.4173228346456694, label: 'DYMO 36 × 89 mm', dymo: true };
const SIZES = [{ id: 'dymo-36x89' }, { id: '2x1' }];
const PREFS = { template: 'dymo-36x89', showBarcode: true, showQR: true, showStatus: true, qrContent: 'sku' as const };
const SPACING = { paddingMm: 2, lineGapMm: 1.1, pushDownMm: 0 };
const STORE = 'FlipThatTech';

const dev = (p: Partial<InventoryItem> = {}): InventoryItem => ({
  id: `d${Math.random()}`, kind: 'device', sku: 'FTT-000101', date: '2026-01-01', item: 'iPhone 14 Pro',
  imei: '490154203237518', boughtFrom: '', purchaseCost: 0, repairCost: 0, soldDate: '', soldTo: '',
  salePrice: 0, notes: '', deviceType: 'Phone', deviceStatus: 'ready', storage: '256GB', ...p,
});
const laptop = dev({
  id: 'lap', sku: 'FTT-000102', item: 'Dell XPS 15 9520', deviceType: 'Laptop',
  cpu: 'i7-12700H', ram: '16GB', storage: '256GB', screenSize: '15.6"', gpu: 'RTX 3050 Ti',
});
const phone = dev({ id: 'ph', sku: 'FTT-000101' });
const acc: InventoryItem = {
  id: 'acc', kind: 'accessory', sku: 'ACC-000001', manufacturerBarcode: '012345678905',
  date: '2026-01-01', item: 'USB-C Cable', imei: '', boughtFrom: '', purchaseCost: 0, repairCost: 0,
  soldDate: '', soldTo: '', salePrice: 0, notes: '', quantity: 5, costPerUnit: 2, sellingPrice: 9.99,
};

/* ---------------- Capturing the opened print window ---------------- */

interface Win { written: string; closed: boolean }
let opened: Win[] = [];
let alerts: string[] = [];
let origOpen: typeof window.open;
let origAlert: typeof window.alert;

beforeEach(() => {
  localStorage.clear();
  opened = []; alerts = [];
  origOpen = window.open; origAlert = window.alert;
  (window as any).open = () => {
    const w: Win = { written: '', closed: false };
    opened.push(w);
    return { document: { write: (s: string) => { w.written += s; }, close: () => { w.closed = true; } } } as any;
  };
  (window as any).alert = (m: string) => { alerts.push(m); };
});
afterEach(() => {
  localStorage.clear();
  (window as any).open = origOpen; (window as any).alert = origAlert;
});

/** One <div class="page"> per physical label. */
const pageCount = (html: string) => (html.match(/class="page"/g) || []).length;

/* ======================================================================== *
 * ONE JOB, ONE LABEL PER ITEM
 * ======================================================================== */

describe('printing labels for a selection', () => {
  it('opens ONE window and writes ONE document with a label each', async () => {
    const ok = await printInventoryLabelsBatch([phone, laptop, acc], MEDIA, PREFS, { storeName: STORE, spacing: SPACING });
    expect(ok).toBe(true);
    expect(opened).toHaveLength(1);              // never one window per item
    expect(opened[0].closed).toBe(true);
    expect(pageCount(opened[0].written)).toBe(3);
  });

  it('does nothing at all for an empty selection', async () => {
    expect(await printInventoryLabelsBatch([], MEDIA, PREFS, { storeName: STORE, spacing: SPACING })).toBe(false);
    expect(opened).toHaveLength(0);
    expect(alerts).toHaveLength(0);
  });

  it('a MIXED selection renders each kind as itself, not as the first item\'s type', async () => {
    await printInventoryLabelsBatch([phone, laptop, acc], MEDIA, PREFS, { storeName: STORE, spacing: SPACING });
    const html = opened[0].written;
    expect(html).toContain('iPhone 14 Pro');
    // The laptop's own layout (PR #234/#235): its spec line and its screen size.
    expect(html).toContain('Dell XPS 15 9520');
    expect(html).toContain('i7-12700H · 256GB/16GB');
    expect(html).toContain('15.6&quot;'.replace('&quot;', '"'));
    // The accessory is barcode-only — no name, no status, no QR.
    expect(html).not.toContain('USB-C Cable');
  });

  it('an ACCESSORY gets a barcode-only label, not a QR — it has no IMEI to encode', async () => {
    const images = await buildLabelImages(acc, PREFS);
    expect(images.qr).toBe('');
    expect(buildLabelOpts(acc, PREFS, SPACING)).toMatchObject({ barcodeOnly: true, showStatus: false });
    // Its identifier is the manufacturer UPC, and that is what gets encoded.
    // (The bitmap itself is '' under this test environment — jsbarcode needs a
    // real canvas 2D context, which happy-dom does not provide. The PAYLOAD
    // and the label shape are what this can and should pin.)
    await printInventoryLabelsBatch([acc], MEDIA, PREFS, { storeName: STORE, spacing: SPACING });
    expect(pageCount(opened[0].written)).toBe(1);
    expect(opened[0].written).toContain('012345678905');
  });

  it('a DEVICE does get a real QR bitmap', async () => {
    const images = await buildLabelImages(phone, PREFS);
    expect(images.qr).toMatch(/^data:image\/(png|gif)/);
  });

  it('a device with no IMEI still gets a QR — it falls back to the SKU', () => {
    const noImei = dev({ imei: '' });
    expect(qrPayload(noImei, 'sku')).toBe('FTT-000101');
    expect(qrPayload(noImei, 'imei')).toBe('FTT-000101');   // fallback, never ''
  });
});

/* ======================================================================== *
 * IDENTICAL TO THE SINGLE-ITEM PRINT
 * ======================================================================== */

describe('a batched label is the same label', () => {
  it.each([['a phone', phone], ['a laptop', laptop], ['an accessory', acc]] as const)(
    '%s renders byte-for-byte as its own single-item print', async (_n, item) => {
      const content = buildLabelContent(item, STORE);
      const images = await buildLabelImages(item, PREFS);
      const opts = buildLabelOpts(item, PREFS, SPACING);

      const single = labelPrintDoc(`Label x`, MEDIA, content, images, opts);
      const batch = labelsPrintDoc(`Label x`, MEDIA, [{ content, images, opts }]);

      // The only intended difference is the auto-print script: a single print
      // fires the dialog, a batch waits for the operator.
      const strip = (h: string) => h.replace(/<script>[\s\S]*?<\/script>/, '');
      expect(strip(batch)).toBe(strip(single));
    });

  it('the single-item path auto-prints; the batch deliberately does not', async () => {
    const content = buildLabelContent(phone, STORE);
    const images = await buildLabelImages(phone, PREFS);
    const opts = buildLabelOpts(phone, PREFS, SPACING);
    expect(labelPrintDoc('t', MEDIA, content, images, opts)).toContain('window.print()');
    // THE CONFIRMATION STEP: the batch opens laid out and waits, so a
    // mis-click costs a window rather than a roll.
    expect(labelsPrintDoc('t', MEDIA, [{ content, images, opts }])).not.toContain('window.print()');
  });

  it('goes through the shared page builder, so the DYMO rotation is not re-implemented', async () => {
    const content = buildLabelContent(phone, STORE);
    const images = await buildLabelImages(phone, PREFS);
    const opts = buildLabelOpts(phone, PREFS, SPACING);
    const html = labelsPrintDoc('t', MEDIA, [{ content, images, opts }, { content, images, opts }]);
    expect(html).toContain('rotate(90deg)');
    expect((html.match(/class="rot"/g) || []).length).toBe(2);
    expect(html).toContain('page-break-after');
  });
});

/* ======================================================================== *
 * NOTHING OVERFLOWS ONTO THE NEXT LABEL
 * ======================================================================== */

describe('the per-label fitting holds in a batch', () => {
  it('each label is its own fixed-size page', async () => {
    await printInventoryLabelsBatch([phone, laptop, acc], MEDIA, PREFS, { storeName: STORE, spacing: SPACING });
    const html = opened[0].written;
    // Every page carries the media's own dimensions and clips to them — the
    // bodies cannot run into one another.
    expect((html.match(/class="page" style="width:36mm;height:89mm;"/g) || []).length).toBe(3);
    expect(html).toContain('overflow: hidden');
  });

  it('a 2 × 1" batch drops the laptop extras exactly as a single print does', async () => {
    // PR #236: on the smallest stock the layout omits the GPU/screen line
    // rather than letting it push onto the following label. That decision is
    // made per body, so it must hold for every label in a run.
    const small: LabelMedia = { id: '2x1', w: 2, h: 1, label: '2 × 1"' };
    await printInventoryLabelsBatch([laptop, laptop], small, PREFS, { storeName: STORE, spacing: SPACING });
    const html = opened[0].written;
    expect(pageCount(html)).toBe(2);
    expect(html).toContain('i7-12700H · 256GB/16GB');
    expect(html).not.toContain('15.6"');
  });
});

/* ======================================================================== *
 * SETTINGS, AND A CEILING
 * ======================================================================== */

describe('the batch uses the owner\'s saved preferences', () => {
  it('reads the same stored blob the modal writes', () => {
    localStorage.setItem(LABEL_PREFS_KEY, JSON.stringify({
      template: '2x1', showBarcode: false, showQR: true, showStatus: false, qrContent: 'id',
    }));
    expect(loadLabelPrefs(SIZES)).toEqual({
      template: '2x1', showBarcode: false, showQR: true, showStatus: false, qrContent: 'id',
    });
  });

  it('falls back to the first template when the saved one no longer exists', () => {
    localStorage.setItem(LABEL_PREFS_KEY, JSON.stringify({ template: 'deleted-custom' }));
    expect(loadLabelPrefs(SIZES).template).toBe('dymo-36x89');
  });

  it('the toggles reach the printed labels', async () => {
    const noBarcode = { ...PREFS, showBarcode: false, showStatus: false };
    await printInventoryLabelsBatch([phone], MEDIA, noBarcode, { storeName: STORE, spacing: SPACING });
    const html = opened[0].written;
    // The status badge is off, and the barcode row with it.
    expect(html).not.toContain('Ready for Sale');
    expect(buildLabelOpts(phone, noBarcode, SPACING)).toMatchObject({ showBarcode: false, showStatus: false });
  });

  it('showQR: false means no QR bitmap is generated at all', async () => {
    const images = await buildLabelImages(phone, { ...PREFS, showQR: false });
    expect(images.qr).toBe('');
  });
});

describe('a very large selection', () => {
  it('refuses rather than silently printing part of it', async () => {
    const many = Array.from({ length: MAX_BATCH_LABELS + 1 }, (_, i) => dev({ id: `d${i}` }));
    const ok = await printInventoryLabelsBatch(many, MEDIA, PREFS, { storeName: STORE, spacing: SPACING });
    expect(ok).toBe(false);
    expect(opened).toHaveLength(0);              // nothing opened, nothing printed
    expect(alerts[0]).toBe(batchTooLargeMessage(MAX_BATCH_LABELS + 1));
    expect(alerts[0]).toContain(String(MAX_BATCH_LABELS));
  });

  it('prints a selection right at the ceiling', async () => {
    const many = Array.from({ length: MAX_BATCH_LABELS }, (_, i) => dev({ id: `d${i}` }));
    expect(await printInventoryLabelsBatch(many, MEDIA, PREFS, { storeName: STORE, spacing: SPACING })).toBe(true);
    expect(pageCount(opened[0].written)).toBe(MAX_BATCH_LABELS);
  });
});
