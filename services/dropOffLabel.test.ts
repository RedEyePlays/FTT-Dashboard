import { describe, it, expect } from 'vitest';
import { DropOff, DeviceBuyer, PaidBy, DropOffStatus, Role } from '../types';
import { dropOffLabelContent } from './dropOffLabel';
import { canPrintDropOffLabel } from './rbac';
import { dropOffLabelMoney, dropOffOwed } from '../domain/dropoffs';
import {
  dropOffLabelsPrintDoc, dropOffLabelPreview, dropOffQrSizeMm, dropOffFontSizesMm,
  dropOffTextColumnWidthMm, estimateTextWidthMm, MIN_DROPOFF_QR_MM, LabelMedia, DropOffLabelContent,
} from './labelLayout';

// The DYMO 36 × 89 mm stock this shop actually prints labels on, plus the
// tighter 2 × 1" thermal template — the same two shapes the inventory label
// tests exercise.
const dymo: LabelMedia = { id: 'dymo-36x89', w: 3.5, h: 1.4125, label: 'DYMO 36 × 89 mm', dymo: true };
const media2x1: LabelMedia = { id: '2x1', w: 2, h: 1, label: '2 x 1' };

const d = (p: Partial<DropOff>): DropOff => ({
  id: 'do-1234567890', buyerId: 'b1', item: 'iPhone 13 Pro', imei: '356789012345678',
  sellerName: '', sellerContact: '', purchasePrice: 0, paidBy: 'store' as PaidBy,
  dropOffFee: 0, dateDropped: '2026-08-20', status: 'accepted' as DropOffStatus, notes: '', ...p,
});
const buyer: DeviceBuyer = { id: 'b1', name: 'Marcus Webb', phone: '', notes: '' };

const content = (p: Partial<DropOff>): DropOffLabelContent =>
  dropOffLabelContent(d(p), buyer, 'FlipThatTech');
const printed = (p: Partial<DropOff>, m: LabelMedia = dymo): string =>
  dropOffLabelsPrintDoc('t', m, [{ content: content(p), qr: 'data:image/png;base64,QR' }]);

describe('drop-off label money — just the amount owed, no funding-source wording', () => {
  it('STORE-FUNDED: prints principal+fee as one plain figure, no breakdown', () => {
    const html = printed({ paidBy: 'store', purchasePrice: 100, dropOffFee: 20 });
    expect(html).toContain('$100.00+20.00');
    expect(html).not.toContain('Store paid');
    expect(html).not.toContain('Fee');
    expect(html).not.toContain('Owed');
    // And the total is the same figure the drop-off screen shows.
    expect(dropOffOwed(d({ paidBy: 'store', purchasePrice: 100, dropOffFee: 20 }))).toBe(120);
  });

  it('BUYER-FUNDED: shows the fee alone as a bare dollar figure, never implying the store paid anything', () => {
    const html = printed({ paidBy: 'runner', purchasePrice: 100, dropOffFee: 20 });
    expect(html).toContain('$20.00');
    expect(html).not.toContain('Store paid');
    expect(html).not.toContain('Buyer funded');
    expect(html).not.toContain('$100.00');   // the buyer's own money is never stated as a store figure
    expect(html).not.toContain('$120.00');
    expect(dropOffOwed(d({ paidBy: 'runner', purchasePrice: 100, dropOffFee: 20 }))).toBe(20);
  });

  it("PERSONAL-FUNDED: buyer owes principal + fee just like store-funded, printed the same plain way", () => {
    // Mirrors domain/dropoffs.ts's documented judgment call (settlementReviewTotals):
    // the buyer owes the same as a store-funded device — the label no longer
    // distinguishes who fronted the cash, only what's owed.
    const html = printed({ paidBy: 'personal', purchasePrice: 100, dropOffFee: 20 });
    expect(html).toContain('$100.00+20.00');
    expect(html).not.toContain('Owner paid');
    expect(html).not.toContain('Store paid');
    expect(dropOffOwed(d({ paidBy: 'personal', purchasePrice: 100, dropOffFee: 20 }))).toBe(120);
    expect(dropOffLabelMoney(d({ paidBy: 'personal', purchasePrice: 100, dropOffFee: 20 })).totalOwed).toBe(120);
  });

  it('no PAID_BY_LABEL / funding-source wording prints on the label at all — the bottom meta row is date + ref only', () => {
    for (const paidBy of ['store', 'runner', 'personal'] as const) {
      const html = printed({ paidBy });
      expect(html).not.toContain('Store-funded');
      expect(html).not.toContain('Buyer-funded');
      expect(html).not.toContain('Owner-funded');
    }
  });
});

describe('drop-off label content — who, what, when, which', () => {
  it('names the device buyer, the device, the IMEI, the drop-off date and a reference id', () => {
    const html = printed({});
    expect(html).toContain('Marcus Webb');
    expect(html).toContain('iPhone 13 Pro');
    expect(html).toContain('356789012345678');
    expect(html).toContain('Dropped 2026-08-20');
    expect(html).toContain('Ref do-12345'); // the drop-off id, shortened like sale refs
    expect(html).toContain('FlipThatTech');
  });

  it('falls back to a clear placeholder rather than a blank name when the buyer record is missing', () => {
    expect(dropOffLabelContent(d({}), undefined, 'FlipThatTech').buyerName).toBe('Unknown buyer');
  });

  it('a drop-off with no IMEI simply carries no serial (and so no QR payload)', () => {
    expect(content({ imei: '' }).serial).toBeUndefined();
  });
});

describe('drop-off label QR — encodes the IMEI/serial, matching the inventory label', () => {
  it('the QR payload is the IMEI itself (that is what dropOffLabelContent hands the generator)', () => {
    // services/dropOffLabel.ts generates the bitmap from exactly this value.
    expect(content({ imei: '356789012345678' }).serial).toBe('356789012345678');
  });

  it('the QR image is scaled, never cropped — its quiet zone stays intact', () => {
    const html = printed({});
    const img = html.match(/<img src="data:image\/png;base64,QR"[^>]*>/)![0];
    expect(img).toContain('flex-shrink:0');   // never squeezed by the flex row
    expect(img).not.toContain('object-fit');
    expect(img).not.toContain('clip-path');
  });

  it('is omitted entirely when there is no serial to encode', () => {
    const html = dropOffLabelsPrintDoc('t', dymo, [{ content: content({ imei: '' }) }]);
    expect(html).not.toContain('<img');
  });
});

// Same guarantee (and the same measured-geometry method) as the inventory
// label's non-truncation work in labelLayout.test.ts: prove the fit with real
// numbers, and prove the CSS can't ellipsis-clip the value either way.
describe('non-truncation — the IMEI and the money figures never ellipsis-clip', () => {
  it('the serial and money lines use wrap-not-ellipsis CSS, and never white-space:nowrap', () => {
    const html = printed({ paidBy: 'store', purchasePrice: 1299.99, dropOffFee: 149.5 });
    for (const value of ['356789012345678', '$1299.99+149.50']) {
      const div = html.match(new RegExp(`<div style="[^"]*">${value.replace(/[$.*+?()|[\]\\]/g, '\\$&')}</div>`));
      expect(div, `${value} should render in its own line box`).toBeTruthy();
      expect(div![0]).toContain('overflow-wrap:anywhere');
      expect(div![0]).not.toContain('white-space:nowrap');
      expect(div![0]).not.toContain('text-overflow:ellipsis');
    }
    expect(html).not.toContain('text-overflow:ellipsis'); // nowhere on this label
  });

  it('every content line disables flex-shrink, so none can be silently compressed to fit', () => {
    const html = printed({ paidBy: 'store', purchasePrice: 100, dropOffFee: 20 });
    // One per line: store, buyer, device, serial, money, meta (+ the QR img).
    const shrinkGuards = html.match(/flex-shrink:0/g) || [];
    expect(shrinkGuards.length).toBeGreaterThanOrEqual(6);
  });

  it('a real 15-digit IMEI needs no compromise at all: the full-size QR and the whole IMEI both fit, measured', () => {
    const imei = { serial: '356789012345678' };
    expect(dropOffQrSizeMm(dymo, imei)).toBe(dropOffQrSizeMm(dymo, { serial: undefined })); // no shrink needed
    const colW = dropOffTextColumnWidthMm(dymo, imei, { showQr: true });
    expect(estimateTextWidthMm(imei.serial, dropOffFontSizesMm(dymo).fSerial)).toBeLessThan(colW);
  });

  it('the QR SHRINKS to make room for an over-long serial rather than the serial being clipped', () => {
    const long = { serial: '3567890123456789012345678901AB' }; // 30 chars — far beyond an IMEI
    const ideal = dropOffQrSizeMm(dymo, { serial: undefined });
    const shrunk = dropOffQrSizeMm(dymo, long);
    expect(shrunk).toBeLessThan(ideal);
    expect(shrunk).toBeGreaterThan(MIN_DROPOFF_QR_MM); // gave up width, not scannability
    // ...and the shrink actually buys the text the width it needs (measured
    // geometry, not an assumption).
    const colW = dropOffTextColumnWidthMm(dymo, long, { showQr: true });
    expect(estimateTextWidthMm(long.serial, dropOffFontSizesMm(dymo).fSerial)).toBeLessThanOrEqual(colW + 0.01);
  });

  it('the QR never shrinks below the scannable floor — an absurd serial wraps instead of killing the QR', () => {
    const absurd = { serial: '1'.repeat(80) };
    expect(dropOffQrSizeMm(dymo, absurd)).toBe(MIN_DROPOFF_QR_MM);
    // The full value is still printed, in full, wrapped.
    const html = dropOffLabelsPrintDoc('t', media2x1, [{
      content: { ...content({}), serial: absurd.serial }, qr: 'data:image/png;base64,QR',
    }]);
    expect(html).toContain(absurd.serial);
    expect(html).toContain('overflow-wrap:anywhere');
  });

  it('a long device name and a long buyer name are printed in full, not cut short', () => {
    const name = 'iPhone 15 Pro Max 1TB Natural Titanium (Unlocked, Dual SIM)';
    const html = dropOffLabelsPrintDoc('t', media2x1, [{ content: { ...content({}), device: name } }]);
    expect(html).toContain(name);
    expect(html).not.toContain('text-overflow:ellipsis');
  });
});

describe('drop-off label printing — shared media, shared print path', () => {
  it('prints on the configured label stock, using the shared DYMO portrait-media rotation', () => {
    const html = printed({}, dymo);
    // 36 × 89 mm portrait page with the landscape label rotated into it —
    // exactly what services/labelLayout.ts does for the inventory label.
    expect(html).toContain('@page { size: 35.88mm 88.9mm; margin: 0; }');
    expect(html).toContain('rotate(90deg)');
  });

  it('non-DYMO (ZP 450 / inch) stock prints unrotated at the label\'s own size', () => {
    const html = printed({}, media2x1);
    expect(html).toContain('@page { size: 50.8mm 25.4mm; margin: 0; }');
    expect(html).not.toContain('rotate(90deg)');
  });

  it('respects the owner\'s configured content padding and line spacing instead of hardcoding them', () => {
    const c = content({});
    const a = dropOffLabelsPrintDoc('t', media2x1, [{ content: c }], { padMm: 3.2, lineGapMm: 1.4 });
    expect(a).toContain('padding:3.2mm');
    expect(a).toContain('gap:1.4mm');
    // Clamped defensively, same ceiling as the inventory label's line gap.
    expect(dropOffLabelsPrintDoc('t', media2x1, [{ content: c }], { lineGapMm: 99 })).toContain('gap:1.5mm');
  });

  it('a batch prints one page per device in a SINGLE job, not one document per label', () => {
    const html = dropOffLabelsPrintDoc('Drop-Off Labels (3)', dymo, [
      { content: content({ id: 'a1', item: 'iPhone 13' }) },
      { content: content({ id: 'b2', item: 'Pixel 8' }) },
      { content: content({ id: 'c3', item: 'Galaxy S23' }) },
    ]);
    expect((html.match(/class="page"/g) || []).length).toBe(3);
    expect((html.match(/<!DOCTYPE html>/g) || []).length).toBe(1);
    expect(html).toContain('iPhone 13');
    expect(html).toContain('Pixel 8');
    expect(html).toContain('Galaxy S23');
  });

  it('the on-screen preview renders the same content as the printed label', () => {
    const preview = dropOffLabelPreview(dymo, content({ paidBy: 'store', purchasePrice: 100, dropOffFee: 20 }), undefined);
    expect(preview).toContain('$100.00+20.00');
    expect(preview).toContain('Marcus Webb');
  });
});

describe('drop-off label printing is gated to dropoffs.manage', () => {
  // The label carries the purchase price and the service fee, so it is gated
  // to the same permission that already exposes drop-off financials on screen.
  it('allows the roles that hold dropoffs.manage', () => {
    for (const role of ['owner', 'manager', 'employee'] as Role[]) {
      expect(canPrintDropOffLabel(role), role).toBe(true);
    }
  });

  it('denies a technician and a signed-out/unknown role', () => {
    expect(canPrintDropOffLabel('technician' as Role)).toBe(false);
    expect(canPrintDropOffLabel(undefined)).toBe(false);
  });
});
