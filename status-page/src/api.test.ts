import { describe, it, expect } from 'vitest';
import { toErrorCode } from './api';

describe('toErrorCode', () => {
  it('converts a gRPC-style status name to the callable error-code convention', () => {
    expect(toErrorCode('INVALID_ARGUMENT')).toBe('invalid-argument');
    expect(toErrorCode('RESOURCE_EXHAUSTED')).toBe('resource-exhausted');
    expect(toErrorCode('NOT_FOUND')).toBe('not-found');
  });

  it('falls back to "internal" for a missing or non-string status', () => {
    expect(toErrorCode(undefined)).toBe('internal');
    expect(toErrorCode(null)).toBe('internal');
    expect(toErrorCode(500)).toBe('internal');
  });
});
