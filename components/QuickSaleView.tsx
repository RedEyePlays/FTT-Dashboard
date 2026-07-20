import React from 'react';
import { InventoryItem, Customer } from '../types';
import { CartSaleView, CartCheckout } from './CartSaleView';

interface Props {
  inventory: InventoryItem[];
  customers?: Customer[];
  initialCustomer?: Customer;      // pre-seed the sale with this customer (CRM quick action)
  onConsumeInitial?: () => void;
  onSellCart: (payload: CartCheckout) => void;
}

// Quick Sale is a single cart-based checkout that handles one or many items.
export const QuickSaleView: React.FC<Props> = ({ inventory, customers, initialCustomer, onConsumeInitial, onSellCart }) => (
  <CartSaleView inventory={inventory} customers={customers} initialCustomer={initialCustomer} onConsumeInitial={onConsumeInitial} onComplete={onSellCart} />
);
