import { describe, it, expect } from 'vitest';
import { describeCallableError } from './callableErrors';

// `internal` is what a Firebase callable returns for ANY unhandled server
// exception, so surfacing it verbatim told the user nothing and left the real
// cause visible only in the Functions logs. These guard the client half of the
// fix: offline / unreachable / a deliberate refusal / a genuine crash are four
// different things and now read as four different things.

const callableErr = (code: string, message = '') =>
  Object.assign(new Error(message || code), { code: `functions/${code}` });

describe('describeCallableError', () => {
  it('reports offline without ever blaming the server', () => {
    const f = describeCallableError(callableErr('internal'), { online: false });
    expect(f.kind).toBe('offline');
    expect(f.unexpected).toBe(false);
    expect(f.message).toMatch(/you're offline/i);
  });

  it('recognises OfflineError by name', () => {
    const f = describeCallableError(Object.assign(new Error('x'), { name: 'OfflineError' }));
    expect(f.kind).toBe('offline');
  });

  it('separates "could not reach the server" from "the server refused"', () => {
    for (const code of ['unavailable', 'deadline-exceeded']) {
      const f = describeCallableError(callableErr(code), { online: true });
      expect(f.kind).toBe('unreachable');
      expect(f.unexpected).toBe(false); // retryable, not a bug
    }
  });

  it('shows the server\'s own specific sentence for a classified refusal', () => {
    const f = describeCallableError(
      callableErr('already-exists', 'An account with that email already exists. Use a different email.'),
      { online: true },
    );
    expect(f.kind).toBe('rejected');
    expect(f.unexpected).toBe(false);
    expect(f.message).toBe('An account with that email already exists. Use a different email.');
  });

  it('strips the SDK\'s "code: " prefix so the message reads as a sentence', () => {
    const err = Object.assign(new Error('already-exists: That email is taken.'), { code: 'functions/already-exists' });
    expect(describeCallableError(err, { online: true }).message).toBe('That email is taken.');
  });

  it('flags ONLY `internal` as a genuine crash worth reporting', () => {
    const crash = describeCallableError(callableErr('internal', 'internal: Something went wrong.'), { online: true });
    expect(crash.kind).toBe('crashed');
    expect(crash.unexpected).toBe(true);

    // Every classified refusal is expected — a full dashboard of "already
    // exists" would drown the one report that means a bug ran.
    for (const code of ['already-exists', 'invalid-argument', 'permission-denied', 'resource-exhausted', 'failed-precondition', 'unavailable']) {
      expect(describeCallableError(callableErr(code), { online: true }).unexpected).toBe(false);
    }
  });

  it('treats an error with no code as a transport failure, not a server response', () => {
    const f = describeCallableError(new TypeError('Failed to fetch'), { online: true });
    expect(f.kind).toBe('unreachable');
    expect(f.message).toMatch(/couldn't reach the server/i);
  });

  it('falls back to the caller\'s message only when the server supplied none', () => {
    const bare = Object.assign(new Error(''), { code: 'functions/internal' });
    expect(describeCallableError(bare, { online: true, fallback: 'Could not create the account.' }).message)
      .toBe('Could not create the account.');
  });

  it('handles a session-expired call distinctly from a permission refusal', () => {
    expect(describeCallableError(callableErr('unauthenticated'), { online: true }).kind).toBe('unauthenticated');
    expect(describeCallableError(callableErr('permission-denied'), { online: true }).kind).toBe('permission-denied');
  });
});
