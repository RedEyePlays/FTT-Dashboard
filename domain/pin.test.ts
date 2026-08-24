import { describe, it, expect } from 'vitest';
import { isValidPinFormat, canAssignPin, hashPin, verifyPin, PIN_HASH_ITERATIONS } from './pin';

describe('isValidPinFormat', () => {
  it('accepts 4-6 digit numeric codes', () => {
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidPinFormat('123456')).toBe(true);
    expect(isValidPinFormat('12345')).toBe(true);
  });

  it('rejects too short, too long, non-numeric, or empty', () => {
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('1234567')).toBe(false);
    expect(isValidPinFormat('12a4')).toBe(false);
    expect(isValidPinFormat('')).toBe(false);
    expect(isValidPinFormat('12 34')).toBe(false);
  });
});

describe('canAssignPin', () => {
  it('owner may assign a PIN to manager, employee, or technician', () => {
    expect(canAssignPin('owner', 'manager')).toBe(true);
    expect(canAssignPin('owner', 'employee')).toBe(true);
    expect(canAssignPin('owner', 'technician')).toBe(true);
  });

  it('manager may assign a PIN to employee or technician, never a peer or above', () => {
    expect(canAssignPin('manager', 'employee')).toBe(true);
    expect(canAssignPin('manager', 'technician')).toBe(true);
    expect(canAssignPin('manager', 'manager')).toBe(false);
    expect(canAssignPin('manager', 'owner')).toBe(false);
  });

  it('nobody may assign a PIN to a peer or someone of equal/higher rank, including owner', () => {
    expect(canAssignPin('owner', 'owner')).toBe(false);
    expect(canAssignPin('employee', 'technician')).toBe(false);
    expect(canAssignPin('technician', 'technician')).toBe(false);
  });

  it('employees and technicians can never assign PINs to anyone', () => {
    expect(canAssignPin('employee', 'employee')).toBe(false);
    expect(canAssignPin('employee', 'technician')).toBe(false);
    expect(canAssignPin('technician', 'employee')).toBe(false);
  });

  it('an undefined assigner role can never assign a PIN', () => {
    expect(canAssignPin(undefined, 'technician')).toBe(false);
  });
});

describe('hashPin / verifyPin', () => {
  it('never stores the plaintext PIN — the hash is not the PIN itself', async () => {
    const stored = await hashPin('4242');
    expect(stored.hash).not.toBe('4242');
    expect(stored.salt).not.toBe('4242');
    expect(stored.hash).toMatch(/^[0-9a-f]{64}$/); // 256-bit hex digest
  });

  it('round-trips: the correct PIN verifies against its own hash', async () => {
    const stored = await hashPin('123456');
    expect(await verifyPin('123456', stored)).toBe(true);
  });

  it('rejects a wrong PIN', async () => {
    const stored = await hashPin('1234');
    expect(await verifyPin('9999', stored)).toBe(false);
    expect(await verifyPin('12345', stored)).toBe(false);
  });

  it('uses a random salt per call, so the same PIN hashes differently each time', async () => {
    const a = await hashPin('1234');
    const b = await hashPin('1234');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    // But both still verify correctly against their own record.
    expect(await verifyPin('1234', a)).toBe(true);
    expect(await verifyPin('1234', b)).toBe(true);
  });

  it('defaults to the standard iteration count', async () => {
    const stored = await hashPin('1234');
    expect(stored.iterations).toBe(PIN_HASH_ITERATIONS);
  });

  it('verifyPin is false for an empty/missing stored record', async () => {
    expect(await verifyPin('1234', { hash: '', salt: '', iterations: 0 })).toBe(false);
  });
});
