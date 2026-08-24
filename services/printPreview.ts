// Shared "print preview" chrome for every print popup (sales receipts, repair
// documents, shelf labels, invoices): a small floating toolbar pinned to the
// top of the popup with a "Print" button, so the browser's print dialog opens
// only when the user confirms — not immediately on click like before. Hidden
// via `@media print`, so it never shows up in the printed output itself; the
// rest of each document's layout/sizing is untouched.
export const PRINT_PREVIEW_BAR_STYLE = `
  .ftt-print-bar{position:sticky;top:0;left:0;right:0;z-index:9999;display:flex;justify-content:center;gap:8px;padding:8px;background:#111827;box-shadow:0 1px 4px rgba(0,0,0,.25);}
  .ftt-print-bar button{font-family:-apple-system,'Inter',Arial,sans-serif;font-size:13px;font-weight:600;padding:6px 14px;border-radius:6px;border:none;cursor:pointer;}
  .ftt-print-bar .ftt-print-go{background:#4f46e5;color:#fff;}
  .ftt-print-bar .ftt-print-close{background:#374151;color:#e5e7eb;}
  @media print{.ftt-print-bar{display:none !important;}}
`;

export const PRINT_PREVIEW_BAR_HTML =
  `<div class="ftt-print-bar"><button type="button" class="ftt-print-go" onclick="window.print()">Print</button><button type="button" class="ftt-print-close" onclick="window.close()">Close</button></div>`;
