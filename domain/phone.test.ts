import { describe, it, expect } from 'vitest';
import { formatPhoneInput } from './phone';

describe('formatPhoneInput', () => {
  it('formats progressively as digits are added', () => {
    expect(formatPhoneInput('')).toBe('');
    expect(formatPhoneInput('1')).toBe('(1');
    expect(formatPhoneInput('123')).toBe('(123');
    expect(formatPhoneInput('1234')).toBe('(123) 4');
    expect(formatPhoneInput('123456')).toBe('(123) 456');
    expect(formatPhoneInput('1234567')).toBe('(123) 456-7');
    expect(formatPhoneInput('1234567890')).toBe('(123) 456-7890');
  });

  it('strips non-digit characters (e.g. re-formatting an already-formatted value)', () => {
    expect(formatPhoneInput('(123) 456-7890')).toBe('(123) 456-7890');
    expect(formatPhoneInput('123.456.7890')).toBe('(123) 456-7890');
  });

  it('caps at 10 digits, ignoring anything beyond', () => {
    expect(formatPhoneInput('123456789099999')).toBe('(123) 456-7890');
  });
});
