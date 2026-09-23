import { FUNCTIONS_BASE_URL, SHOWROOM_FUNCTION_NAME } from './config';
import { LookupError, toErrorCode } from './api';

/**
 * Client for the public showroomLookup Cloud Function — the only thing the
 * counter kiosk talks to.
 *
 * The shape below mirrors functions/src/showroomPolicy.ts. It IS the
 * allow-list, and there is deliberately no field on it for a cost, an IMEI or
 * a customer — the server never sends those, and this page would have nowhere
 * to put them if it did.
 */

export interface PublicPhoto {
  url: string;
  thumbUrl?: string;
  stock?: true;
  credit?: string;
}

export interface ShowroomItem {
  sku: string;
  kind: 'device' | 'build';
  category: string;
  title: string;
  photo?: PublicPhoto;
  storage?: string;
  colour?: string;
  condition?: string;
  batteryHealth?: string;
  price: number;
  warrantyDays: number;
  specs?: string;
  compareTotal?: number;
  compareStore?: string;
  saving?: number;
}

export interface ShowroomRepair {
  deviceModel: string;
  repairType: string;
  price: number;
  fromPrice?: true;
  turnaround?: string;
}

export interface ShowroomTradeIn {
  deviceModel: string;
  condition: string;
  lowPrice: number;
  highPrice: number;
}

export interface Showroom {
  found: true;
  shopName: string;
  shopPhone?: string;
  items: ShowroomItem[];
  repairs: ShowroomRepair[];
  repairWarrantyDays: number;
  tradeIns: ShowroomTradeIn[];
  updatedAt: number;
}

export type ShowroomResult = Showroom | { found: false };

export async function lookupShowroom(token: string): Promise<ShowroomResult> {
  let res: Response;
  try {
    res = await fetch(`${FUNCTIONS_BASE_URL}/${SHOWROOM_FUNCTION_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { token: token.trim() } }),
    });
  } catch {
    throw new LookupError('unavailable', 'Could not reach the server.');
  }
  const body = await res.json().catch(() => ({}) as any);
  if (!res.ok || body?.error) {
    throw new LookupError(toErrorCode(body?.error?.status), body?.error?.message || 'Something went wrong.');
  }
  return body.result as ShowroomResult;
}
