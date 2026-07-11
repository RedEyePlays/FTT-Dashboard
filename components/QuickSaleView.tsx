import React from 'react';
import { InventoryItem, Customer } from '../types';
import { CartSaleView, CartCheckout } from './CartSaleView';

interface Props {
  inventory: InventoryItem[];
  customers?: Customer[];
  onSellCart: (payload: CartCheckout) => void;
}

// Quick Sale is a single cart-based checkout that handles one or many items.
export const QuickSaleView: React.FC<Props> = ({ inventory, customers, onSellCart }) => (
  <CartSaleView inventory={inventory} customers={customers} onComplete={onSellCart} />
);
