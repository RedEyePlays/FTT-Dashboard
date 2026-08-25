import { FocusEvent } from 'react';

// Selects a number input's existing text when it gains focus, so clicking
// into a price/cost field lets the user type over the value immediately
// instead of having to select it manually first.
export function selectOnFocus(e: FocusEvent<HTMLInputElement>): void {
  e.target.select();
}
