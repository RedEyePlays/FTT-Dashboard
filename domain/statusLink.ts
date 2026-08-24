// Builds the public repair-status lookup link for a ticket — always
// status.flipthat.tech (the standalone public site, see status-page/),
// never this app's own app.flipthat.tech origin. Shared by the "Copy Link"
// action wherever a ticket is viewable and by the standalone page itself
// (status-page/src/main.ts) for prefilling the ticket field from the query
// string, so the two ends of the link agree on the param name.
export const STATUS_PAGE_ORIGIN = 'https://status.flipthat.tech';

export function statusPageUrl(ticket: string): string {
  const t = (ticket || '').trim();
  if (!t) return STATUS_PAGE_ORIGIN;
  return `${STATUS_PAGE_ORIGIN}/?ticket=${encodeURIComponent(t)}`;
}
