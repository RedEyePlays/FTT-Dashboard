import { describe, it, expect } from 'vitest';
import { InventoryItem } from '../types';
import {
  COST_ENTRY_FIELDS, isCostEntryField, isDerivedCostColumn, isCostRevealingColumn,
  costAccessFor, hasRecordedCost, maskedCostLabel, RECORDED_LABEL,
  stripCostFields, costFiguresFor, isCostEntry,
} from './costVisibility';

// "Can't see" and "can't enter" were one rule. The inventory table is
// inline-editable, so hiding the cost column also removed the only place to
// TYPE the value — and every device an employee added looked like 100% margin
// until the owner went back and filled it in.

describe('which columns are which', () => {
  it('the three cost fields are ENTERABLE, so they are masked rather than removed', () => {
    expect([...COST_ENTRY_FIELDS]).toEqual(['purchaseCost', 'repairCost', 'costPerUnit']);
    for (const f of COST_ENTRY_FIELDS) expect(isCostEntryField(f)).toBe(true);
  });

  it('total and profit are DERIVED, so they stay hidden outright', () => {
    // Nothing to enter, so there is no trade-off to make.
    expect(isDerivedCostColumn('__total')).toBe(true);
    expect(isDerivedCostColumn('__profit')).toBe(true);
    expect(isDerivedCostColumn('purchaseCost')).toBe(false);
  });

  it('prices are not costs and were never hidden', () => {
    for (const k of ['salePrice', 'targetSalePrice', 'sellingPrice', 'sku', 'notes']) {
      expect(isCostRevealingColumn(k)).toBe(false);
    }
  });
});

describe('what a staff member may do with a cost field', () => {
  it('somebody WITH cost access just edits it', () => {
    expect(costAccessFor(true, 0)).toBe('edit');
    expect(costAccessFor(true, 250)).toBe('edit');
  });

  it('a BLANK cost is enterable by staff — the whole point of this change', () => {
    expect(costAccessFor(false, 0)).toBe('enter');
    expect(costAccessFor(false, undefined)).toBe('enter');
    expect(costAccessFor(false, null)).toBe('enter');
  });

  it('a RECORDED cost is locked to staff', () => {
    // Otherwise re-typing the field is a way to learn it: type a number and
    // see whether the app treats it as a change.
    expect(costAccessFor(false, 250)).toBe('locked');
  });

  it('0 counts as NOT recorded, deliberately', () => {
    // Every row is created with these defaulted to 0. Treating that as
    // "already recorded" would lock every existing device forever and leave
    // the original problem exactly where it was.
    expect(hasRecordedCost(0)).toBe(false);
    expect(hasRecordedCost(250)).toBe(true);
    expect(hasRecordedCost(undefined)).toBe(false);
    expect(hasRecordedCost('250')).toBe(false);
    expect(hasRecordedCost(NaN)).toBe(false);
  });
});

describe('the mask never leaks the figure', () => {
  it('shows "Recorded", not the number', () => {
    expect(maskedCostLabel(false, 250)).toBe(RECORDED_LABEL);
    expect(maskedCostLabel(false, 250)).not.toContain('250');
  });

  it('shows nothing at all when there is nothing recorded', () => {
    expect(maskedCostLabel(false, 0)).toBe('');
  });

  it('gets out of the way entirely for somebody who may see costs', () => {
    expect(maskedCostLabel(true, 250)).toBeNull();
  });
});

describe('anything that LEAVES the screen is stripped, not just masked', () => {
  // A masked column with an exportable value underneath is a mask in name
  // only — the CSV writes raw fields.
  const row = { sku: 'PHN-1', purchaseCost: 250, repairCost: 40, costPerUnit: 0, salePrice: 500 };

  it('the CSV row carries no cost figure for staff', () => {
    const out = stripCostFields(row, false);
    expect(out.purchaseCost).toBe(RECORDED_LABEL);
    expect(out.repairCost).toBe(RECORDED_LABEL);
    expect(JSON.stringify(out)).not.toContain('250');
    expect(JSON.stringify(out)).not.toContain('40');
  });

  it('a blank cost exports as blank, not as "Recorded"', () => {
    expect(stripCostFields(row, false).costPerUnit).toBe('');
  });

  it('prices are untouched — they are not costs', () => {
    expect(stripCostFields(row, false).salePrice).toBe(500);
    expect(stripCostFields(row, false).sku).toBe('PHN-1');
  });

  it('the owner gets the real row back, unchanged', () => {
    expect(stripCostFields(row, true)).toBe(row);
  });
});

describe('derived figures', () => {
  const item = { purchaseCost: 250, repairCost: 40, salePrice: 500 } as InventoryItem;

  it('are computed for somebody who may see them', () => {
    expect(costFiguresFor(item, true)).toEqual({ totalCost: 290, profit: 210 });
  });

  it('are NULL for staff — not zero, which would read as a real figure', () => {
    expect(costFiguresFor(item, false)).toEqual({ totalCost: null, profit: null });
  });
});

describe('recording a cost is audited', () => {
  it('blank → a figure is the moment worth recording', () => {
    // It is when a device stops looking like 100% margin, and the owner needs
    // to see who supplied the number.
    expect(isCostEntry('purchaseCost', 0, 250)).toBe(true);
    expect(isCostEntry('costPerUnit', undefined, 5)).toBe(true);
  });

  it('a change to an already-recorded cost is not a first entry', () => {
    expect(isCostEntry('purchaseCost', 250, 300)).toBe(false);
  });

  it('a non-cost field never is', () => {
    expect(isCostEntry('salePrice', 0, 500)).toBe(false);
  });
});
