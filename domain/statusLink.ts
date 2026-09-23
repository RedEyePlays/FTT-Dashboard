// Builds the public repair-status lookup link for a ticket — always
// status.flipthat.tech (the standalone public site, see status-page/),
// never this app's own app.flipthat.tech origin. Shared by the "Copy Link"
// action wherever a ticket is viewable and by the standalone page itself
// (status-page/src/main.ts) for prefilling the ticket field from the query
// string, so the two ends of the link agree on the param name.
export const STATUS_PAGE_ORIGIN = 'https://status.flipthat.tech';

/**
 * THE HOST THE SHOP ADVERTISES for a build's share link — the one that goes
 * into a Facebook Marketplace description as plain text for a customer to
 * type: "flipthat.tech/b/kadamuze".
 *
 * It is separate from STATUS_PAGE_ORIGIN on purpose. The page is SERVED by the
 * status-page hosting target; this is the address the shop wants to be seen
 * saying, and it is short because somebody is typing it off a screen.
 *
 * IT IS CONFIG, AND IT HAS A DEPLOYMENT DEPENDENCY. For this exact form to
 * resolve, flipthat.tech (and www.flipthat.tech) must be attached to the
 * `status` Firebase Hosting target, or redirect to it. Until that is done, the
 * working address is status.flipthat.tech/b/<code> — change the one line below
 * to `'status.flipthat.tech'` and every link, QR code and ad snippet in the
 * app follows, because nothing else hardcodes it.
 */
export const SHARE_LINK_HOST = 'flipthat.tech';

export function statusPageUrl(ticket: string): string {
  const t = (ticket || '').trim();
  if (!t) return STATUS_PAGE_ORIGIN;
  return `${STATUS_PAGE_ORIGIN}/?ticket=${encodeURIComponent(t)}`;
}
