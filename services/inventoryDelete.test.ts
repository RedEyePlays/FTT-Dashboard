import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { can } from './rbac';
import { Role } from '../types';

/**
 * DELETING A STOCK ROW — the parts that are not visible from one file.
 *
 * The bug was a disagreement between services/rbac.ts and firestore.rules
 * about who may delete. Fixing it means three things have to stay true, and
 * each of them lives somewhere different:
 *
 *   1. rbac and the rules name the same tier;
 *   2. the audit entry is written BEFORE the row goes, carrying the item —
 *      afterwards there is nothing left to describe it;
 *   3. the IMEI index entry goes with the device, or the workspace keeps a
 *      claim on an identity nothing owns.
 *
 * (2) and (3) are asserted structurally against the source, the same way
 * PcBuildsView.costScope.test.tsx pins App.tsx's permission wiring. The
 * end-to-end behaviour is in rules-tests/inventoryDelete.rules.test.ts, which
 * runs against the emulator.
 */

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const APP = read('App.tsx');
const DB = read('services/firestoreDb.ts');
const RULES = read('firestore.rules');

/** App.tsx's handleDeleteItem, from its signature to the closing brace. */
const deleteHandler = (): string => {
  const start = APP.indexOf('const handleDeleteItem =');
  expect(start).toBeGreaterThan(-1);
  const end = APP.indexOf('\n  };', start);
  return APP.slice(start, end);
};

describe('who may delete', () => {
  const TIERS: [Role, boolean][] = [
    ['owner', true], ['manager', true], ['employee', false], ['technician', false], ['kiosk', false],
  ];

  it('rbac grants inventory.delete to exactly owner and manager', () => {
    for (const [role, expected] of TIERS) {
      expect({ role, can: can(role, 'inventory.delete') }).toEqual({ role, can: expected });
    }
  });

  it('the rules use isManagerUp for the three collections a delete touches', () => {
    // The helper, not a hand-written condition: `isManagerUp` already means
    // "manager or owner" everywhere else in the file, and one definition of a
    // tier is what stops the next edit disagreeing with this one.
    for (const collection of ['inventory', 'accessories', 'inventoryImeiIndex']) {
      const block = new RegExp(`match /${collection}/\\{id\\} \\{[\\s\\S]*?\\n      \\}`).exec(RULES)?.[0] || '';
      expect({ collection, found: block.length > 0 }).toEqual({ collection, found: true });
      expect({ collection, rule: /allow delete: if isManagerUp\(ws\);/.test(block) })
        .toEqual({ collection, rule: true });
    }
  });

  it('nothing else in the rules quietly loosened to manager while we were in here', () => {
    // Every other `allow delete` in the file. The three above are the only
    // ones that moved; if a fourth appears, somebody has to look at it.
    const managerDeletes = (RULES.match(/allow delete: if isManagerUp\(ws\);/g) || []).length;
    expect(managerDeletes).toBe(3);
  });

  it('the delete is still gated in the app by the permission, not by a role string', () => {
    expect(deleteHandler()).toMatch(/allow\('inventory\.delete'\)/);
  });
});

describe('the audit entry outlives the row', () => {
  const handler = deleteHandler();

  it('is written BEFORE the delete', () => {
    const auditAt = handler.indexOf("audit('inventory.delete'");
    const deleteAt = handler.indexOf('deleteInventoryItem');
    expect(auditAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(-1);
    expect(auditAt).toBeLessThan(deleteAt);
  });

  it('carries the whole item as `before` — SKU, cost and price included', () => {
    // audit(action, entityType, entityId, before) — `target` is the live row.
    expect(handler).toMatch(/audit\('inventory\.delete', collection, id, target\)/);
    // And logAudit stores `before` as given; clean() only drops undefined.
    expect(DB).toMatch(/export const logAudit = \(wsId: string, entry: AuditEntry\) =>\s*\n\s*setDoc\(docRef\(wsId, 'auditLogs', entry\.id\), clean\(entry\)\);/);
  });

  it('and auditLogs is append-only, so it cannot be tidied away afterwards', () => {
    const block = /match \/auditLogs\/\{id\} \{[\s\S]*?\n      \}/.exec(RULES)?.[0] || '';
    expect(block).toMatch(/allow update, delete: if false;/);
  });
});

describe('the records keyed to the item go with it', () => {
  it('the delete path removes the IMEI index entry, not just the document', () => {
    expect(deleteHandler()).toMatch(/deleteInventoryItem/);
    expect(DB).toMatch(/export async function deleteInventoryItem/);
    expect(DB).toMatch(/inventoryImeiIndex/);
  });

  it('the index goes FIRST, so a failure cannot leave a phantom', () => {
    const fn = DB.slice(DB.indexOf('export async function deleteInventoryItem'));
    const indexAt = fn.indexOf("'inventoryImeiIndex'");
    const docAt = fn.indexOf('docRef(uid, name, item.id)');
    expect(indexAt).toBeGreaterThan(-1);
    expect(docAt).toBeGreaterThan(-1);
    expect(indexAt).toBeLessThan(docAt);
  });

  it('a device with no IMEI does not try to delete an index entry keyed on nothing', () => {
    const fn = DB.slice(DB.indexOf('export async function deleteInventoryItem'));
    expect(fn).toMatch(/if \(normalized\)/);
  });

  it('its photos are removed from Storage', () => {
    // A device photo outliving its device is a file the shop pays for monthly
    // and nobody can reach.
    expect(deleteHandler()).toMatch(/deleteDevicePhotoObjects/);
  });

  it('a failed delete is SAID OUT LOUD rather than swallowed', () => {
    // The whole bug was a refused write with nothing on screen to explain it.
    expect(deleteHandler()).toMatch(/writeFailed\('The item'/);
  });
});
