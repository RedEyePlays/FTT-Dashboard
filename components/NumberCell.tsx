import React, { useEffect, useState } from 'react';

/**
 * ONE DRAFT-THEN-COMMIT NUMERIC CELL, shared by every inline money field.
 *
 * WHY IT IS NOT A PLAIN CONTROLLED `<input type="number">`. Typing a
 * multi-digit figure into one of those — `value={stored}`,
 * `onChange={v => save(parseFloat(v) || 0)}` — rewrites the stored number on
 * every keystroke, and each rewrite re-renders the input with a canonicalised
 * value. Type "1", "12", "125" and the field has been through 1 → 12 → 125 as
 * three separate saved values; type a leading "." or a trailing "0" and it is
 * rewritten under the cursor, which jumps to the end. The field holds a STRING
 * DRAFT while it is being typed and commits a number on blur or Enter, which
 * is the only way the cursor stays where the person put it.
 *
 * It was previously inlined as `ActualCell` in InventoryView for the Actual
 * (sale price) column, which is the one that could not tolerate per-keystroke
 * writes because each one marks the device sold. Extracted rather than copied
 * when the offer screen needed an editable Target: a second hand-rolled input
 * is exactly how two cells end up behaving differently.
 *
 * `confirm` is the hook ActualCell needs and Target does not: a chance to
 * refuse the commit (and roll the draft back) before it is written.
 */

export interface NumberCellProps {
  /** The stored value. 0 shows as blank, with `placeholder` in its place. */
  value: number;
  onCommit: (n: number) => void;
  className: string;
  placeholder?: string;
  ariaLabel?: string;
  /**
   * Asked just before a changed value is written. Return false to refuse it;
   * the draft is then reset to the stored value. Used for the one transition
   * that feels irreversible (a first Actual price marking a device sold).
   */
  confirm?: (n: number) => boolean;
  /**
   * Anything that should re-sync the draft from `value` besides `value`
   * itself — e.g. a sale being cleared elsewhere on the row.
   */
  resetOn?: unknown;
  disabled?: boolean;
}

export const NumberCell: React.FC<NumberCellProps> = ({
  value, onCommit, className, placeholder, ariaLabel, confirm, resetOn, disabled,
}) => {
  const stored = value || 0;
  const [draft, setDraft] = useState(stored ? String(stored) : '');
  // Re-sync when the stored value changes underneath — another user's edit, a
  // different row scrolling into this cell, a sale being voided.
  useEffect(() => { setDraft(stored ? String(stored) : ''); }, [stored, resetOn]);

  const commit = () => {
    // CLEARING THE FIELD COMMITS 0, which is what every other numeric cell in
    // the app does (`parseFloat('') || 0`) and therefore what "no target set"
    // already means in the data. A blank that committed `undefined` would be a
    // second way to say the same thing.
    const n = parseFloat(draft) || 0;
    if (n === stored) return;
    if (confirm && !confirm(n)) { setDraft(stored ? String(stored) : ''); return; }
    onCommit(n);
  };

  return (
    <input type="number" inputMode="decimal" value={draft}
      aria-label={ariaLabel}
      placeholder={!draft ? placeholder : undefined}
      disabled={disabled}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className={className} />
  );
};
