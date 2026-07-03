import React from 'react';
import { InventoryItem } from '../types';
import { CartSaleView, CartCheckout } from './CartSaleView';

interface Props {
  inventory: InventoryItem[];
  onSellCart: (payload: CartCheckout) => void;
}

// Quick Sale is a single cart-based checkout that handles one or many items.
export const QuickSaleView: React.FC<Props> = ({ inventory, onSellCart }) => (
  <CartSaleView inventory={inventory} onComplete={onSellCart} />
);
