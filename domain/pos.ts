// Shared POS constants/helpers. Extracted from CartSaleView so the platform-fee
// list has a single home and can be unit-tested and reused by future POS views.

export interface PlatformFee {
  name: string;
  fee: number; // percent
}

export const PLATFORMS: PlatformFee[] = [
  { name: 'None / In-Store', fee: 0 },
  { name: 'eBay', fee: 13.25 },
  { name: 'Amazon', fee: 15 },
  { name: 'Facebook Marketplace', fee: 5 },
  { name: 'Best Buy', fee: 10 },
  { name: 'Swappa', fee: 3 },
  { name: 'Other', fee: 0 },
];

/** Dollar platform fee for a subtotal at a given percent. */
export const platformFeeAmount = (subtotal: number, percent: number): number =>
  Math.max(0, subtotal) * (Math.max(0, percent) / 100);
