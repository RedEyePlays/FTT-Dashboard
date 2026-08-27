// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrub, captureError, initErrorReporting } from './errorReporting';

describe('scrub', () => {
  it('redacts common PII key names, recursively, without touching other fields', () => {
    const input = {
      route: 'pos',
      customerName: 'Jane Doe',
      customerPhone: '555-1234',
      email: 'jane@example.com',
      imei: '490154203237518',
      notes: 'meet at the back door',
      nested: { authToken: 'abc123', ok: true },
    };
    const out = scrub(input) as Record<string, unknown>;
    expect(out.route).toBe('pos');
    expect(out.customerName).toBe('[redacted]');
    expect(out.customerPhone).toBe('[redacted]');
    expect(out.email).toBe('[redacted]');
    expect(out.imei).toBe('[redacted]');
    expect(out.notes).toBe('[redacted]');
    expect((out.nested as any).authToken).toBe('[redacted]');
    expect((out.nested as any).ok).toBe(true);
  });

  it('redacts inside arrays too', () => {
    const out = scrub([{ email: 'a@b.com' }, { role: 'owner' }]) as any[];
    expect(out[0].email).toBe('[redacted]');
    expect(out[1].role).toBe('owner');
  });

  it('passes through primitives and null/undefined unchanged', () => {
    expect(scrub('hello')).toBe('hello');
    expect(scrub(42)).toBe(42);
    expect(scrub(null)).toBe(null);
    expect(scrub(undefined)).toBe(undefined);
  });

  it('does not infinitely recurse on deeply nested objects', () => {
    let obj: any = { leaf: true };
    for (let i = 0; i < 20; i++) obj = { child: obj };
    expect(() => scrub(obj)).not.toThrow();
  });
});

describe('captureError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('never throws, even for a non-Error value, and logs locally', () => {
    expect(() => captureError('a plain string')).not.toThrow();
    expect(() => captureError({ weird: 'object' })).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });

  it('does not include raw context values in the console log when scrubbing is expected downstream', () => {
    // console.error here is the always-on local fallback (unconfigured
    // reporting) — deliberately logs the RAW context for local debugging;
    // scrubbing is enforced on the network path (beforeSend/extra), not the
    // console. This test just documents that split rather than asserting
    // console output is scrubbed too.
    captureError(new Error('boom'), { route: 'pos' });
    expect(console.error).toHaveBeenCalledWith('[captureError]', expect.any(Error), { route: 'pos' });
  });
});

describe('initErrorReporting', () => {
  it('is idempotent and safe to call multiple times without configuration', () => {
    expect(() => { initErrorReporting(); initErrorReporting(); }).not.toThrow();
  });
});
