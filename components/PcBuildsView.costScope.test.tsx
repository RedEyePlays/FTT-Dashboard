import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { can, ROLE_PERMISSIONS } from '../services/rbac';
import { Permission } from '../types';

/**
 * THE BOUNDARY: costs are open INSIDE a build, and nowhere else.
 *
 * Whoever can open a build sees and edits everything on it — they bought the
 * parts. That decision is deliberately scoped to that one screen: a technician
 * must still see no cost on a device in Inventory, no P&L, no Sales Ledger,
 * no Money Trail figure and no dashboard profit.
 *
 * The risk is not that today's code is wrong — it is that somebody later
 * reaches for 'builds.manage' when they want "a permission a technician has"
 * and quietly widens it. So this file asserts the boundary STRUCTURALLY,
 * against App.tsx's actual wiring, rather than only describing it in a comment.
 */

const APP = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');

/** Every prop in the app that turns a cost, profit or margin figure on. */
const MONEY_PROPS = ['canViewCost', 'canViewProfit', 'canViewDetailedProfit'];

describe("'builds.manage' does not leak out of PC Builds", () => {
  it('NEVER feeds a cost or profit prop anywhere in App.tsx', () => {
    // e.g. canViewCost={allow('builds.manage')} — the exact mistake this guards.
    for (const prop of MONEY_PROPS) {
      const leak = new RegExp(`${prop}=\\{[^}]*builds\\.manage`);
      expect({ prop, leaks: leak.test(APP) }).toEqual({ prop, leaks: false });
    }
  });

  it('every cost/profit prop is still fed by reports.profit.*', () => {
    // Each occurrence must name a profit permission. If a new surface appears
    // that is gated some other way, this fails and somebody has to look at it.
    for (const prop of MONEY_PROPS) {
      const uses = APP.match(new RegExp(`${prop}=\\{[^}]*\\}`, 'g')) || [];
      expect({ prop, found: uses.length > 0 }).toEqual({ prop, found: true });
      for (const use of uses) {
        expect({ use, ok: /reports\.profit\.(detailed|summary)/.test(use) })
          .toEqual({ use, ok: true });
      }
    }
  });

  it('is used only to REACH or WRITE a build, never to unlock a figure', () => {
    // Every allow('builds.manage') in App.tsx, with the line it sits on.
    const uses = APP.split('\n')
      .map(l => l.trim())
      .filter(l => l.includes("allow('builds.manage')"))
      // Comments explain the rule; they are not wiring.
      .filter(l => !/^(\/\/|\*|\{\/\*)/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      const use = line.trim();
      // Legitimate: routing to the section, or guarding a build write.
      const routes = /pcbuilds|PC Builds|canBuild/.test(use);
      const guardsBuildWrite = /^if \(!uid \|\| !allow\('builds\.manage'\)\) return/.test(use);
      expect({ use, ok: routes || guardsBuildWrite }).toEqual({ use, ok: true });
      // And never near a money figure, whichever kind of use it is.
      for (const prop of MONEY_PROPS) {
        expect({ use, prop, near: use.includes(prop) }).toEqual({ use, prop, near: false });
      }
    }
  });

  it('PcBuildsView takes no cost flag at all, so none can be passed', () => {
    // Removing the prop is what makes "pass false by accident" impossible.
    const view = readFileSync(join(__dirname, 'PcBuildsView.tsx'), 'utf8');
    expect(view).not.toContain('canViewCost');
    expect(view).not.toContain('costAccessFor');
    expect(view).not.toContain('RECORDED_LABEL');
  });

  it('but the masking is UNTOUCHED on every screen that had it', () => {
    // Inventory's grid and both device forms still hide a recorded cost.
    for (const file of ['InventoryView.tsx', 'ItemFormModal.tsx', 'DataEntryForm.tsx']) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect({ file, masks: src.includes('costAccessFor') && src.includes('RECORDED_LABEL') })
        .toEqual({ file, masks: true });
    }
    // And App.tsx still refuses an inline edit of a locked cost field.
    expect(APP).toContain("costAccessFor(allow('reports.profit.detailed')");
  });
});

describe('a technician with builds.manage is still not financial', () => {
  it('holds neither profit tier, and the Financials override cannot grant one', () => {
    for (const p of ['reports.profit.detailed', 'reports.profit.summary'] as Permission[]) {
      expect({ p, has: can('technician', p) }).toEqual({ p, has: false });
      // The per-user allowProfit toggle reaches managers and employees only.
      expect({ p, viaOverride: can('technician', p, { allowProfit: true }) })
        .toEqual({ p, viaOverride: false });
    }
  });

  it('cannot reach any screen that shows the shop\'s money', () => {
    // Reports (P&L, Sales Ledger, Money Trail), Analytics and Close Out.
    for (const p of ['reports.view', 'cash.reconcile', 'closeout.view'] as Permission[]) {
      expect({ p, has: can('technician', p) }).toEqual({ p, has: false });
    }
  });

  it('cannot reach Inventory\'s cost columns — no inventory permission at all', () => {
    for (const p of ['inventory.add', 'inventory.edit', 'inventory.delete'] as Permission[]) {
      expect({ p, has: can('technician', p) }).toEqual({ p, has: false });
    }
  });

  it('and their whole permission set is still just the three', () => {
    // Pinned so widening the role has to be a deliberate edit here too.
    expect([...ROLE_PERMISSIONS.technician].sort())
      .toEqual(['builds.manage', 'repairs.tech', 'timeclock.use']);
  });
});
