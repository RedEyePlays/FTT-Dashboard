import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, runTransaction, setDoc } from 'firebase/firestore';
import { can } from '../services/rbac';
import { Role } from '../types';

/**
 * WHO MAY DELETE A STOCK ROW.
 *
 * THE BUG: services/rbac.ts grants a manager 'inventory.delete' — the owner's
 * decision — and firestore.rules said `allow delete: if isOwnerOf(ws)`. So the
 * app showed a manager the delete control, they tapped it, and the write was
 * refused with nothing on screen to say why.
 *
 * This file pins BOTH SIDES of that agreement, per role, and the related
 * records a delete touches: the IMEI index entry (leave it behind and you have
 * a phantom claiming an identity nothing owns) and the fact that the audit
 * entry survives the row it describes.
 *
 * Run with `npm run test:rules`.
 */

const PROJECT_ID = 'ftt-dashboard-inventory-delete-rules-test';
const WORKSPACE = 'owner-uid';
const IMEI = '351234567890123';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [uid, role] of [
      [WORKSPACE, 'owner'], ['manager-uid', 'manager'], ['employee-uid', 'employee'],
      ['tech-uid', 'technician'], ['kiosk-uid', 'kiosk'],
    ] as const) {
      await setDoc(doc(db, 'users', uid), {
        id: uid, email: `${role}@shop.test`, role, workspaceId: WORKSPACE, disabled: false,
      });
    }
    await setDoc(doc(db, 'user_data', WORKSPACE, 'inventory', 'dev1'), {
      id: 'dev1', sku: 'PHN-000123', item: 'iPhone 13', imei: IMEI, imeiNormalized: IMEI,
      purchaseCost: 540, targetSalePrice: 850,
    });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'accessories', 'acc1'), { id: 'acc1', sku: 'ACC-000004', item: 'USB-C cable' });
    await setDoc(doc(db, 'user_data', WORKSPACE, 'inventoryImeiIndex', IMEI), { inventoryId: 'dev1' });
  });
});

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();
const asManager = () => as('manager-uid');

describe('inventory delete — the app and the rules now agree', () => {
  it('A MANAGER CAN DELETE A DEVICE', async () => {
    await assertSucceeds(deleteDoc(doc(asManager(), 'user_data', WORKSPACE, 'inventory', 'dev1')));
  });

  it('the owner still can', async () => {
    await assertSucceeds(deleteDoc(doc(as(WORKSPACE), 'user_data', WORKSPACE, 'inventory', 'dev1')));
  });

  it('an EMPLOYEE cannot', async () => {
    await assertFails(deleteDoc(doc(as('employee-uid'), 'user_data', WORKSPACE, 'inventory', 'dev1')));
  });

  it('a TECHNICIAN cannot', async () => {
    await assertFails(deleteDoc(doc(as('tech-uid'), 'user_data', WORKSPACE, 'inventory', 'dev1')));
  });

  it('a KIOSK device cannot — it holds nothing at all', async () => {
    await assertFails(deleteDoc(doc(as('kiosk-uid'), 'user_data', WORKSPACE, 'inventory', 'dev1')));
  });

  it('a signed-out visitor cannot', async () => {
    await assertFails(deleteDoc(doc(testEnv.unauthenticatedContext().firestore(), 'user_data', WORKSPACE, 'inventory', 'dev1')));
  });

  it('a manager in ANOTHER workspace cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'other-manager'), {
        id: 'other-manager', role: 'manager', workspaceId: 'someone-else', disabled: false,
      });
    });
    await assertFails(deleteDoc(doc(as('other-manager'), 'user_data', WORKSPACE, 'inventory', 'dev1')));
  });

  it('a DISABLED manager cannot', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'manager-uid'), { disabled: true }, { merge: true });
    });
    await assertFails(deleteDoc(doc(asManager(), 'user_data', WORKSPACE, 'inventory', 'dev1')));
  });
});

describe('accessories move with inventory — same button, same screen', () => {
  it('a manager can delete an accessory', async () => {
    await assertSucceeds(deleteDoc(doc(asManager(), 'user_data', WORKSPACE, 'accessories', 'acc1')));
  });

  it('an employee and a technician cannot', async () => {
    await assertFails(deleteDoc(doc(as('employee-uid'), 'user_data', WORKSPACE, 'accessories', 'acc1')));
    await assertFails(deleteDoc(doc(as('tech-uid'), 'user_data', WORKSPACE, 'accessories', 'acc1')));
  });
});

describe('the IMEI index entry goes with the device', () => {
  it('a manager can delete the index entry too — otherwise they leave a phantom', async () => {
    await assertSucceeds(deleteDoc(doc(asManager(), 'user_data', WORKSPACE, 'inventoryImeiIndex', IMEI)));
  });

  it('an employee cannot', async () => {
    await assertFails(deleteDoc(doc(as('employee-uid'), 'user_data', WORKSPACE, 'inventoryImeiIndex', IMEI)));
  });

  it('END TO END: a manager deletes the device and its index, then the same IMEI can be re-added', async () => {
    const db = asManager();
    // The order services/firestoreDb.ts's deleteInventoryItem uses: index
    // first, so a failure cannot leave a claim on an identity nothing owns.
    await assertSucceeds(deleteDoc(doc(db, 'user_data', WORKSPACE, 'inventoryImeiIndex', IMEI)));
    await assertSucceeds(deleteDoc(doc(db, 'user_data', WORKSPACE, 'inventory', 'dev1')));

    // Re-adding the same phone: this is commitAutoInventory's transaction,
    // which reads the index and creates both documents when it is free.
    await assertSucceeds(runTransaction(db, async tx => {
      const indexRef = doc(db, 'user_data', WORKSPACE, 'inventoryImeiIndex', IMEI);
      const existing = await tx.get(indexRef);
      expect(existing.exists()).toBe(false);          // no phantom left behind
      tx.set(doc(db, 'user_data', WORKSPACE, 'inventory', 'dev2'), {
        id: 'dev2', sku: 'PHN-000124', item: 'iPhone 13', imei: IMEI, imeiNormalized: IMEI,
      });
      tx.set(indexRef, { inventoryId: 'dev2' });
    }));

    const check = await getDoc(doc(db, 'user_data', WORKSPACE, 'inventoryImeiIndex', IMEI));
    expect(check.data()).toEqual({ inventoryId: 'dev2' });
  });
});

describe('the audit entry outlives the device', () => {
  it('a manager writes it, and it survives the delete', async () => {
    const db = asManager();
    // Written BEFORE the row goes, carrying the whole item — after the delete
    // there is nothing left to describe it.
    await assertSucceeds(setDoc(doc(db, 'user_data', WORKSPACE, 'auditLogs', 'a1'), {
      id: 'a1', ts: Date.now(), userId: 'manager-uid', userEmail: 'manager@shop.test',
      action: 'inventory.delete', entityType: 'inventory', entityId: 'dev1',
      before: { sku: 'PHN-000123', purchaseCost: 540, targetSalePrice: 850, imei: IMEI },
    }));
    await assertSucceeds(deleteDoc(doc(db, 'user_data', WORKSPACE, 'inventory', 'dev1')));

    const entry = await getDoc(doc(db, 'user_data', WORKSPACE, 'auditLogs', 'a1'));
    expect(entry.exists()).toBe(true);
    expect((entry.data() as { before: Record<string, unknown> }).before).toMatchObject({
      sku: 'PHN-000123', purchaseCost: 540, targetSalePrice: 850,
    });
  });

  it('and nobody can edit or remove it afterwards — not even the owner', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'user_data', WORKSPACE, 'auditLogs', 'a1'),
        { action: 'inventory.delete', ts: 1 });
    });
    await assertFails(setDoc(doc(as(WORKSPACE), 'user_data', WORKSPACE, 'auditLogs', 'a1'),
      { action: 'nothing.happened' }, { merge: true }));
    await assertFails(deleteDoc(doc(as(WORKSPACE), 'user_data', WORKSPACE, 'auditLogs', 'a1')));
  });
});

describe('the rules and services/rbac.ts say the same thing', () => {
  // The bug was a disagreement between these two, so the agreement itself is
  // worth asserting rather than leaving to two files that look right apart.
  const DELETERS: [Role, boolean][] = [
    ['owner', true], ['manager', true], ['employee', false], ['technician', false], ['kiosk', false],
  ];

  for (const [role, expected] of DELETERS) {
    it(`${role}: rbac says ${expected}, and the rules agree`, async () => {
      expect(can(role, 'inventory.delete')).toBe(expected);
      const uid = role === 'owner' ? WORKSPACE : `${role === 'technician' ? 'tech' : role}-uid`;
      const attempt = deleteDoc(doc(as(uid), 'user_data', WORKSPACE, 'inventory', 'dev1'));
      if (expected) await assertSucceeds(attempt); else await assertFails(attempt);
    });
  }
});
