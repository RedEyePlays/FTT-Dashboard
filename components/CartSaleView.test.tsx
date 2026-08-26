// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { CartSaleView } from './CartSaleView';

// Item 8 of the layaway-completion batch: the deposit field must be off by
// default, and Quick Sale must gain no other new field from this batch.

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

describe('CartSaleView layaway toggle', () => {
  it('hides the deposit field by default, and reveals it only once the toggle is switched on', () => {
    const { host, unmount } = mount(<CartSaleView inventory={[]} onComplete={() => {}} />);

    expect(host.textContent).not.toContain('Deposit / partial payment');
    expect(host.textContent).toContain('Layaway / partial payment');

    const toggle = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Layaway / partial payment')) as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    act(() => { toggle.click(); });

    expect(host.textContent).toContain('Deposit / partial payment');
    unmount();
  });
});
