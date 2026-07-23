import React from 'react';
import { InventoryItem, Customer, DeviceType } from '../types';
import { CartSaleView, CartCheckout } from './CartSaleView';
import { MobileCheckout } from './MobileCheckout';
import { useIsMobile } from '../hooks/useMediaQuery';

interface Props {
  inventory: InventoryItem[];
  customers?: Customer[];
  initialCustomer?: Customer;      // pre-seed the sale with this customer (CRM quick action)
  onConsumeInitial?: () => void;
  onSellCart: (payload: CartCheckout) => void;
  canViewProfit?: boolean;         // gate cost/profit figures (same pattern as Dashboard)
  onGenerateSku?: (deviceType?: DeviceType) => Promise<string>; // real SKU for a custom device added to inventory
}

// Quick Sale = the desktop split-screen cart on ≥md, a step-based flow on phones.
// Both share the same checkout logic (hooks/useCheckout) — no duplicated business
// logic; only the presentation differs, and only one renders at a time.
export const QuickSaleView: React.FC<Props> = ({ inventory, customers, initialCustomer, onConsumeInitial, onSellCart, canViewProfit = true, onGenerateSku }) => {
  const isMobile = useIsMobile();
  const common = { inventory, customers, initialCustomer, onConsumeInitial, canViewProfit, onGenerateSku } as const;
  return isMobile
    ? <MobileCheckout {...common} onComplete={onSellCart} />
    : <CartSaleView {...common} onComplete={onSellCart} />;
};
