// @vitest-environment happy-dom
// Printing goes through window.open, which the default node environment has no
// notion of — the repo's per-file opt-in (vitest.config.ts).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { printRetailReceipt } from './repairPrint';
import { STATUS_PAGE_ORIGIN } from '../domain/statusLink';
import { Repair } from '../types';

/**
 * THE PRINTED RECEIPT'S TRACKING LINK COMES FROM ONE PLACE.
 *
 * It used to carry its own copy of 'https://status.flipthat.tech'. Paper is the
 * one surface that cannot be re-deployed, so it was also the only one that
 * would NOT follow when the shop moves the public site: every share link, QR
 * code and ad snippet derives from STATUS_PAGE_ORIGIN and would move together,
 * while receipts already in customers' hands kept pointing at the old host.
 *
 * The last test is the one that matters. It does not check for a host — it
 * changes the constant and asserts the receipt follows, so restoring a second
 * copy of the address makes it fail. Asserting the literal string instead would
 * pass just as happily with the duplication back in place.
 */

const repair = (over: Partial<Repair> = {}): Repair => ({
  id: 'r1', repairNumber: 'RPR-000123', customerName: 'Ali Reza', customerPhone: '416-555-0100',
  deviceType: 'Phone', brand: 'Apple', model: 'iPhone 13', issue: 'Screen replacement',
  status: 'received', date: '2026-03-10', createdAt: 1, repairPrice: 189,
  ...over,
} as Repair);

/** Print into a fake window and hand back everything written to it. */
const printed = (
  kind: 'intake' | 'repair' | 'pickup' = 'intake',
  opts: { internal?: boolean } = {},
  r: Repair = repair(),
): string => {
  const chunks: string[] = [];
  const win = {
    document: { write: (s: string) => chunks.push(s), close: () => {} },
  } as unknown as Window;
  const open = vi.spyOn(window, 'open').mockReturnValue(win);
  try {
    printRetailReceipt(r, kind, opts);
  } finally {
    open.mockRestore();
  }
  return chunks.join('');
};

afterEach(() => vi.restoreAllMocks());

describe('the repair receipt tracking link', () => {
  it('renders the host from STATUS_PAGE_ORIGIN', () => {
    const html = printed();
    expect(html).toContain('Track Your Repair');
    expect(html).toContain(STATUS_PAGE_ORIGIN);
  });

  it('prints the ticket number beside it, since the page needs both', () => {
    // The link is useless on its own — the page asks for the ticket plus the
    // name or phone on it.
    const html = printed();
    expect(html).toContain('RPR-000123');
  });

  it('is omitted on a pickup receipt and on an internal work order', () => {
    // A pickup receipt is handed over as the device leaves, and an internal
    // refurb has no customer to track anything.
    expect(printed('pickup')).not.toContain('Track Your Repair');
    expect(printed('intake', { internal: true })).not.toContain('Track Your Repair');
  });

  it('FOLLOWS THE CONSTANT — changing it in one place changes the receipt', async () => {
    // The real assertion of the fix. Re-import both modules with the constant
    // stubbed to a different host: the receipt must render THAT host and no
    // trace of the real one. A second hardcoded copy fails this immediately.
    const MOVED = 'https://example-moved.test';
    vi.resetModules();
    vi.doMock('../domain/statusLink', () => ({
      STATUS_PAGE_ORIGIN: MOVED,
      SHARE_LINK_HOST: 'example-moved.test',
      statusPageUrl: (t: string) => `${MOVED}/?ticket=${encodeURIComponent(t)}`,
    }));
    const { printRetailReceipt: reimported } = await import('./repairPrint');

    const chunks: string[] = [];
    const win = { document: { write: (s: string) => chunks.push(s), close: () => {} } } as unknown as Window;
    const open = vi.spyOn(window, 'open').mockReturnValue(win);
    try {
      reimported(repair(), 'intake', {});
    } finally {
      open.mockRestore();
      vi.doUnmock('../domain/statusLink');
      vi.resetModules();
    }
    const html = chunks.join('');
    expect(html).toContain(MOVED);
    expect(html).not.toContain('status.flipthat.tech');
  });
});
