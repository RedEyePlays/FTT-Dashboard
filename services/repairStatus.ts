import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

// Thin client wrapper for the public `repairStatusLookup` Cloud Function. The
// function is the only thing that touches repair data — this just relays the two
// identifiers the customer typed and returns the minimal, non-sensitive result.
export interface RepairStatusResult {
  found: boolean;
  ticket?: string;
  device?: string;
  status?: string;         // customer-friendly label
  estimatedDate?: string;  // YYYY-MM-DD (still in progress)
  readyDate?: string;      // YYYY-MM-DD (ready / completed)
}

const call = httpsCallable<{ ticket: string; identifier: string }, RepairStatusResult>(functions, 'repairStatusLookup');

export async function lookupRepairStatus(ticket: string, identifier: string): Promise<RepairStatusResult> {
  const res = await call({ ticket: ticket.trim(), identifier: identifier.trim() });
  return res.data;
}
