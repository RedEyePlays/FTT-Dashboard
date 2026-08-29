import { describe, it, expect } from 'vitest';
import { DropOff, DeviceBuyer, PaidBy, DropOffStatus, Role } from '../types';
import { dropOffLabelContent } from './dropOffLabel';
import { canPrintDropOffLabel } from './rbac';
import { dropOffLabelMoney, dropOffOwed } from '../domain/dropoffs';
import {
  dropOffLabelsPrintDoc, dropOffLabelPreview, dropOffQrSizeMm,
  LabelMedia, DropOffLabelContent,
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

  it('no PAID_BY_LABEL / funding-source wording prints on the label at all', () => {
    for (const paidBy of ['store', 'runner', 'personal'] as const) {
      const html = printed({ paidBy });
      expect(html).not.toContain('Store-funded');
      expect(html).not.toContain('Buyer-funded');
      expect(html).not.toContain('Owner-funded');
    }
  });
});

describe('drop-off label content — who and what (the bottom meta row is gone)', () => {
  it('names the device buyer and the device (the IMEI is no longer printed as text)', () => {
    const html = printed({});
    expect(html).toContain('Marcus Webb');
    expect(html).toContain('iPhone 13 Pro');
    expect(html).toContain('FlipThatTech');
  });

  // The written IMEI line was removed at the owner's request — the QR is now
  // the ONLY place the IMEI/serial appears on the label.
  it('never prints the IMEI/serial as text, even though the QR still encodes it', () => {
    const html = printed({});
    expect(html).not.toContain('356789012345678');
    // The QR image is still there, still built from that same value.
    expect(content({}).serial).toBe('356789012345678');
    expect(html).toContain('<img src="data:image/png;base64,QR"');
  });

  // The bottom meta row ("Dropped {date} · Ref {id}") was removed at the
  // owner's request: the label now ENDS at the money line. These assertions
  // used to require exactly the opposite (toContain 'Dropped 2026-08-20' /
  // 'Ref do-12345') — they're inverted here rather than deleted, so the
  // removal itself is what's pinned down, not merely un-checked.
  it('prints no "Dropped {date}" text and no "Ref {id}" text anywhere', () => {
    const html = printed({});
    expect(html).not.toContain('Dropped');
    expect(html).not.toContain('Ref ');
    expect(html).not.toContain('2026-08-20'); // the date value itself, not just its label
    expect(html).not.toContain('do-12345');   // the reference value itself
  });

  it('the money line is unaffected — it is still present, and it is now the LAST thing on the label', () => {
    const html = printed({ paidBy: 'store', purchasePrice: 100, dropOffFee: 20 });
    expect(html).toContain('$100.00+20.00');
    // Nothing renders after the money row: its <div> is the final element
    // inside the label body, immediately followed by the body's closing tag.
    const moneyDiv = html.match(/<div style="[^"]*border-top[^"]*">[^<]*<\/div>/)![0];
    expect(moneyDiv).toContain('$100.00+20.00');
    expect(html).toContain(`${moneyDiv}\n    </div>`);
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
describe('non-truncation — the money figure never ellipsis-clips', () => {
  it('the money line uses wrap-not-ellipsis CSS, and never white-space:nowrap', () => {
    const html = printed({ paidBy: 'store', purchasePrice: 1299.99, dropOffFee: 149.5 });
    const value = '$1299.99+149.50';
    const div = html.match(new RegExp(`<div style="[^"]*">${value.replace(/[$.*+?()|[\]\\]/g, '\\$&')}</div>`));
    expect(div, `${value} should render in its own line box`).toBeTruthy();
    expect(div![0]).toContain('overflow-wrap:anywhere');
    expect(div![0]).not.toContain('white-space:nowrap');
    expect(div![0]).not.toContain('text-overflow:ellipsis');
    expect(html).not.toContain('text-overflow:ellipsis'); // nowhere on this label
  });

  it('every content line disables flex-shrink, so none can be silently compressed to fit', () => {
    const html = printed({ paidBy: 'store', purchasePrice: 100, dropOffFee: 20 });
    // One per line: store, buyer, device, money (+ the QR img). The IMEI/
    // serial line was removed (no longer printed as text — QR only) and the
    // meta row (Dropped/Ref) was removed earlier, so the count dropped from 6+ to 5+.
    const shrinkGuards = html.match(/flex-shrink:0/g) || [];
    expect(shrinkGuards.length).toBeGreaterThanOrEqual(5);
  });

  // The QR no longer has a printed serial line to negotiate width with, so
  // it always renders at its comfortably-scannable "ideal" size regardless
  // of how long the underlying IMEI/serial is — there's nothing left on this
  // label for it to shrink for.
  it('the QR size is constant regardless of the (no longer printed) serial length', () => {
    const short = dropOffQrSizeMm(dymo);
    const withLongImei = dropOffLabelsPrintDoc('t', dymo, [{
      content: { ...content({}), serial: '1'.repeat(80) }, qr: 'data:image/png;base64,QR',
    }]);
    expect(withLongImei).not.toContain('1'.repeat(80)); // never printed as text
    expect(dropOffQrSizeMm(dymo)).toBe(short); // sizing has no serial-length input at all
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
