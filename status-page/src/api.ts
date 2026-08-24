import { FUNCTIONS_BASE_URL, LOOKUP_FUNCTION_NAME } from './config';

// Minimal client for the public repairStatusLookup Cloud Function — the ONLY
// thing this page talks to. Deliberately implemented with plain fetch against
// Firebase's documented callable-function wire protocol (POST { data } ->
// { result } | { error }) instead of the firebase/functions SDK: it avoids
// pulling any Firebase client library (or the main app's shared Firebase init)
// into this bundle, keeping the page tiny and provably self-contained.

export interface RepairStatusResult {
  found: boolean;
  ticket?: string;
  device?: string;
  status?: string;         // customer-friendly label
  estimatedDate?: string;  // YYYY-MM-DD, still in progress
  readyDate?: string;      // YYYY-MM-DD, ready / completed
}

export class LookupError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

// A gRPC-style status name ("INVALID_ARGUMENT") down to the callable error
// code convention ("invalid-argument") used by the UI to pick a message.
export const toErrorCode = (status: unknown): string =>
  typeof status === 'string' ? status.toLowerCase().replace(/_/g, '-') : 'internal';

export async function lookupRepairStatus(ticket: string, identifier: string): Promise<RepairStatusResult> {
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_BASE_URL}/${LOOKUP_FUNCTION_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { ticket: ticket.trim(), identifier: identifier.trim() } }),
    });
  } catch {
    throw new LookupError('unavailable', 'Could not reach the server. Check your connection and try again.');
  }

  const body = await res.json().catch(() => ({}) as any);

  if (!res.ok || body?.error) {
    throw new LookupError(toErrorCode(body?.error?.status), body?.error?.message || 'Something went wrong. Please try again.');
  }

  return body.result as RepairStatusResult;
}
