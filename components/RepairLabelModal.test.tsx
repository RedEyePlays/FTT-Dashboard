// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { Repair, RepairStatus, RepairType } from '../types';
import { nonDymoQrSizeMm, LabelMedia } from '../services/labelLayout';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Zebra Browser Print does a real localhost probe on mount; stub it so this
// suite is about label CONTENT, not transport.
vi.mock('../services/zebra', () => ({
  detectZebra: async () => ({ available: false, devices: [] }),
  sendZpl: async () => 'ok',
}));
// The QR/barcode generators need a canvas. Stub them, and record exactly what
// payload each was asked to encode — that payload (the FULL repair number) is
// what a scan has to resolve, and it must NOT follow the shortened display
// code onto the label.
const qrPayloads: string[] = [];
const barcodePayloads: string[] = [];
vi.mock('qrcode', () => ({
  default: { toDataURL: async (v: string) => { qrPayloads.push(v); return 'data:image/png;base64,QR'; } },
}));
vi.mock('jsbarcode', () => ({
  default: (_c: unknown, v: string) => { barcodePayloads.push(v); },
}));

// Imported after the mocks are registered.
const { RepairLabelModal } = await import('./RepairLabelModal');

const repair = (p: Partial<Repair>): Repair => ({
  id: 'rep-1', repairNumber: 'RPR-000123', type: 'retail' as RepairType,
  createdAt: 0, date: '2026-08-20', brand: 'Apple', model: 'iPhone 14 Pro',
  deviceType: 'phone' as Repair['deviceType'], imei: '356789101234567',
  issue: 'Cracked screen, no touch on the top third, battery drains overnight',
  repairPrice: 199, status: 'in_repair' as RepairStatus, ...p,
});

async function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

// The rendered label preview is the exact HTML labelPrintDoc puts on paper
// (labelPreview and labelPrintDoc share labelBody), so asserting on it is
// asserting on the printed tag.
const label = async (r: Repair, context?: { batchNumber?: string; lineNumber?: number; isPrivate?: boolean }) => {
  const { host, unmount } = await mount(<RepairLabelModal repair={r} context={context} onClose={() => {}} />);
  const html = host.innerHTML;
  unmount();
  return html;
};

beforeEach(() => { qrPayloads.length = 0; barcodePayloads.length = 0; localStorage.clear(); });

describe('retail repair label — shortened code, no device/model', () => {
  it('prints "R" + the ticket digits, never the full "RPR-000123"', async () => {
    const html = await label(repair({}));
    expect(html).toContain('R000123');
    expect(html).not.toContain('RPR-000123');
  });

  it('prints no brand/model text anywhere on the label', async () => {
    const html = await label(repair({}));
    expect(html).not.toContain('Apple');
    expect(html).not.toContain('iPhone 14 Pro');
    // What SHOULD still be there is: the repair type, the IMEI and the status.
    expect(html).toContain('Retail repair');
    expect(html).toContain('356789101234567');
  });

  it('the barcode and QR still encode the FULL repair number, so a scan resolves the real ticket', async () => {
    await label(repair({}));
    expect(qrPayloads).toContain('RPR-000123');
    expect(barcodePayloads).toContain('RPR-000123');
    expect(qrPayloads).not.toContain('R000123');
    expect(barcodePayloads).not.toContain('R000123');
  });

  it('a ticket number with no trailing digits is printed unchanged rather than turned into a fabricated "R…" id', async () => {
    const html = await label(repair({ repairNumber: 'LEGACY' }));
    expect(html).toContain('LEGACY');
    expect(html).not.toContain('RLEGACY');
  });

  it('renders a QR measurably smaller than an inventory label\'s at the same media', async () => {
    const html = await label(repair({}));
    const media: LabelMedia = { id: 'dymo-36x89', w: 89 / 25.4, h: 36 / 25.4, label: 'DYMO', dymo: true };
    // The default template is the DYMO preset, whose QR is derived from the
    // label height; assert against the shared ratio rather than re-deriving
    // the whole formula here (services/labelLayout.test.ts proves the exact
    // per-template numbers for the non-DYMO stock).
    const qrImg = html.match(/<img[^>]*base64,QR[^>]*>/)![0];
    const size = Number(qrImg.match(/width:\s*([\d.]+)px/)![1]);
    const fullHeightPx = Number(html.match(/height:\s*([\d.]+)px;border/)![1]);
    expect(size).toBeLessThan(fullHeightPx * 0.65);
    expect(nonDymoQrSizeMm(media, 'repairRetail')).toBeLessThan(nonDymoQrSizeMm(media));
  });
});

describe('wholesale repair label — no batch number, "Store Device" only for the shop\'s own stock', () => {
  const wholesale = (p: Partial<Repair> = {}) => repair({ type: 'wholesale' as RepairType, ...p });

  it('never prints a batch number — private or a real client batch — and never the old "· #{line}" line number', async () => {
    const html = await label(wholesale(), { batchNumber: 'WB-45', lineNumber: 3, isPrivate: true });
    expect(html).not.toContain('WB-45');
    expect(html).not.toContain('#3');
    expect(html).not.toContain('· #');
  });

  it('a real (non-private) wholesale batch label carries no sub-line text at all', async () => {
    const html = await label(wholesale(), { batchNumber: 'WB-45', isPrivate: false });
    expect(html).not.toContain('Wholesale');
    expect(html).not.toContain('Store Device');
  });

  it('the shop\'s own ("private") batch is labeled "Store Device", on the smaller sub-line — not the big code font', async () => {
    const html = await label(wholesale(), { batchNumber: 'WB-45', isPrivate: true });
    const subDiv = html.match(/<div[^>]*>Store Device<\/div>/)![0];
    expect(subDiv).not.toContain("Courier New"); // that's the big id-line/serial font, not this
    expect(subDiv).toContain('font-weight:600'); // the sub line's own weight
  });

  it('prints no brand/model text anywhere on the label', async () => {
    const html = await label(wholesale(), { batchNumber: 'WB-45', isPrivate: true });
    expect(html).not.toContain('Apple');
    expect(html).not.toContain('iPhone 14 Pro');
  });

  it('prints the reported issue in full, wrapped rather than ellipsis-clipped', async () => {
    const r = wholesale();
    const html = await label(r, { batchNumber: 'WB-45', isPrivate: true });
    expect(html).toContain(r.issue);
    const issueDiv = html.match(new RegExp(`<div[^>]*>${r.issue}</div>`))![0];
    expect(issueDiv).toContain('overflow-wrap:anywhere');
    expect(issueDiv).not.toContain('text-overflow:ellipsis');
  });

  it('the RETAIL label carries no issue line — the ticket in hand already has it', async () => {
    const r = repair({});
    const html = await label(r);
    expect(html).not.toContain(r.issue);
  });

  it('never prints the full IMEI anywhere on the wholesale label', async () => {
    const r = wholesale({ imei: '356789101234567' });
    const html = await label(r, { batchNumber: 'WB-45', isPrivate: true });
    expect(html).not.toContain('356789101234567');
  });

  it('the RETAIL label is unaffected — still "Retail repair" and the full IMEI', async () => {
    const html = await label(repair({}));
    expect(html).toContain('Retail repair');
    expect(html).toContain('356789101234567');
  });
});
