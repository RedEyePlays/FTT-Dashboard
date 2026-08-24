// Real-time phone-number formatting for input fields: as the visitor types,
// reshape whatever's in the field into (123) 456-7890 — the one format used
// everywhere a phone number is entered (customers, repairs, drop-off, etc).
// Purely a display formatter for the live input value: it only runs on
// onChange, so an already-stored value (which may predate this format, or be
// a non-North-American number) is left exactly as-is until someone edits it.
export function formatPhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  const len = digits.length;
  if (len === 0) return '';
  if (len < 4) return `(${digits}`;
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
