import { FUNCTIONS_BASE_URL, BUILD_LOOKUP_FUNCTION_NAME } from './config';
import { LookupError, toErrorCode } from './api';

/**
 * Client for the public buildShareLookup Cloud Function — the only thing the
 * build page talks to.
 *
 * Plain fetch against Firebase's callable wire protocol, for the same reason
 * api.ts does it: no Firebase client library enters this bundle, so the page
 * stays tiny and provably self-contained.
 *
 * The shape below mirrors functions/src/publicBuildPolicy.ts's PublicBuild. It
 * is the allow-list, and there is deliberately nothing on it for a cost, a
 * supplier, a serial or a customer — the server never sends those, and this
 * page has no field to put them in if it did.
 */

export interface PublicPart {
  category: string;
  name: string;
  condition: string;
  /** Remaining manufacturer warranty in plain words. */
  warranty?: string;
  newPrice?: number;
  storePrice?: number;
  storeName?: string;
}

export interface PublicBuild {
  found: true;
  name: string;
  status: string;              // 'Available' | 'Sold'
  parts: PublicPart[];
  price?: number;
  retailTotal?: number;
  retailComplete: boolean;
  storeTotal?: number;
  storeName?: string;
  saving?: number;
  warrantyDays: number;
  shopName: string;
  shopPhone?: string;
  shopAddress?: string;
  shopEmail?: string;
}

export type BuildLookupResult = PublicBuild | { found: false };

export async function lookupBuild(token: string): Promise<BuildLookupResult> {
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_BASE_URL}/${BUILD_LOOKUP_FUNCTION_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { token: token.trim() } }),
    });
  } catch {
    throw new LookupError('unavailable', 'Could not reach the server. Check your connection and try again.');
  }

  const body = await res.json().catch(() => ({}) as any);

  if (!res.ok || body?.error) {
    throw new LookupError(toErrorCode(body?.error?.status), body?.error?.message || 'Something went wrong. Please try again.');
  }

  return body.result as BuildLookupResult;
}
