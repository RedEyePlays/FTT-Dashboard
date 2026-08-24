import React from 'react';
import { InventoryItem, Customer, DeviceType, Repair } from '../types';
import { RepairSalePrefill } from '../domain/repairs';
import { CashDrawerSummary } from '../domain/reports';
import { CartSaleView, CartCheckout } from './CartSaleView';
import { MobileCheckout } from './MobileCheckout';
import { CashDrawerPanel } from './CashDrawerPanel';
import type { CashMovementKind } from './LogCashMovementModal';
import { useIsMobile } from '../hooks/useMediaQuery';

interface Props {
  inventory: InventoryItem[];
  customers?: Customer[];
  repairs?: Repair[];              // ready repairs, searchable/selectable in-cart
  initialCustomer?: Customer;      // pre-seed the sale with this customer (CRM quick action)
  onConsumeInitial?: () => void;
  initialRepair?: RepairSalePrefill; // pre-seed a repair checkout (Repairs → Check Out)
  onConsumeInitialRepair?: () => void;
  onSellCart: (payload: CartCheckout) => void;
  canViewProfit?: boolean;         // gate cost/profit figures (same pattern as Dashboard)
  onGenerateSku?: (deviceType?: DeviceType) => Promise<string>; // real SKU for a custom device added to inventory
  // Register cash drawer — shown here, where cash is actually handled. Present
  // only when the user may log cash (cash.log).
  cashDrawer?: CashDrawerSummary;
  onOpenDrawer?: () => void;
  onLogCash?: (kind: CashMovementKind) => void;
}

// Quick Sale = the desktop split-screen cart on ≥md, a step-based flow on phones.
// Both share the same checkout logic (hooks/useCheckout) — no duplicated business
// logic; only the presentation differs, and only one renders at a time.
export const QuickSaleView: React.FC<Props> = ({ inventory, customers, repairs, initialCustomer, onConsumeInitial, initialRepair, onConsumeInitialRepair, onSellCart, canViewProfit = true, onGenerateSku, cashDrawer, onOpenDrawer, onLogCash }) => {
  const isMobile = useIsMobile();
  const common = { inventory, customers, repairs, initialCustomer, onConsumeInitial, initialRepair, onConsumeInitialRepair, canViewProfit, onGenerateSku } as const;
  const checkout = isMobile
    ? <MobileCheckout {...common} onComplete={onSellCart} />
    : <CartSaleView {...common} onComplete={onSellCart} />;
  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {cashDrawer && onOpenDrawer && onLogCash && (
        <CashDrawerPanel summary={cashDrawer} onOpenDrawer={onOpenDrawer} onLog={onLogCash} />
      )}
      {checkout}
    </div>
  );
};
