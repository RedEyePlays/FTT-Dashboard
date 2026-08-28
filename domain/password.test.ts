import { describe, it, expect } from 'vitest';
import { canResetPasswordFor, MIN_PASSWORD_LENGTH, validatePassword } from './password';

// This module is the CLIENT-SIDE mirror of
// functions/src/staffPasswordPolicy.ts (which carries the authoritative copy
// and its own node:test suite). These tests exist because the UI disables its
// submit button on this copy — a drift between the two would show up as a
// button that stays enabled for a password the server then rejects.

describe('validatePassword (UX mirror of the Cloud Function policy)', () => {
  it('accepts a password that is long enough and mixes two character classes', () => {
    expect(validatePassword('shopfloor42')).toBeNull();
    expect(validatePassword('Bluewidget99!')).toBeNull();
    expect(validatePassword('COUNTERTOP2026')).toBeNull();
  });

  it('rejects anything shorter than the minimum', () => {
    expect(validatePassword('aB1')).not.toBeNull();
    expect(validatePassword('aB' + 'x'.repeat(MIN_PASSWORD_LENGTH - 3))).not.toBeNull();
    expect(validatePassword('aB' + 'x'.repeat(MIN_PASSWORD_LENGTH - 2))).toBeNull();
  });

  it('rejects a single-character-class password however long', () => {
    expect(validatePassword('aaaaaaaaaaaaaaaaaaaa')).not.toBeNull();
    expect(validatePassword('12345678901234')).not.toBeNull();
  });

  it('rejects leading/trailing whitespace — an unreadable password to hand over verbally', () => {
    expect(validatePassword(' shopfloor42')).not.toBeNull();
    expect(validatePassword('shopfloor42 ')).not.toBeNull();
  });

  it('never echoes the candidate back in the reason', () => {
    const candidate = 'aaaaaaaaaaaa';
    expect(validatePassword(candidate)).not.toContain(candidate);
  });
});

describe('canResetPasswordFor — who the UI offers the action for', () => {
  it('an owner may reset a manager, employee or technician', () => {
    expect(canResetPasswordFor('owner', 'manager')).toBe(true);
    expect(canResetPasswordFor('owner', 'employee')).toBe(true);
    expect(canResetPasswordFor('owner', 'technician')).toBe(true);
  });

  it('an owner may NOT reset another owner (nor, therefore, themselves)', () => {
    expect(canResetPasswordFor('owner', 'owner')).toBe(false);
  });

  it('nobody below owner may reset anyone — including a manager over a technician', () => {
    expect(canResetPasswordFor('manager', 'technician')).toBe(false);
    expect(canResetPasswordFor('manager', 'employee')).toBe(false);
    expect(canResetPasswordFor('employee', 'technician')).toBe(false);
    expect(canResetPasswordFor('employee', 'employee')).toBe(false);
    expect(canResetPasswordFor('technician', 'employee')).toBe(false);
    expect(canResetPasswordFor(undefined, 'employee')).toBe(false);
  });

  it('an unknown/absent target role is refused rather than defaulted open', () => {
    expect(canResetPasswordFor('owner', undefined)).toBe(false);
    expect(canResetPasswordFor('owner', '')).toBe(false);
  });
});
