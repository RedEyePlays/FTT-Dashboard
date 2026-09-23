import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

/**
 * A SAVED CHAT BELONGS TO ONE PERSON.
 *
 * Every other collection in firestore.rules is shared shop data with a role
 * model over it. This one is not: a conversation with the assistant is
 * somebody working something out, half-finished questions and all.
 *
 * The property worth pinning hardest is the one that looks like an oversight
 * and is not: THERE IS NO OWNER OVERRIDE. An owner who can read every sale,
 * every cost and every audit entry in the workspace still cannot read a
 * manager's chat.
 *
 * Run with `npm run test:rules`.
 */

const PROJECT_ID = 'ftt-dashboard-aichat-rules-test';
const WORKSPACE = 'owner-uid';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', WORKSPACE), { id: WORKSPACE, email: 'owner@shop.test', role: 'owner', workspaceId: WORKSPACE, disabled: false });
    await setDoc(doc(db, 'users', 'manager-uid'), { id: 'manager-uid', email: 'manager@shop.test', role: 'manager', workspaceId: WORKSPACE, disabled: false });
    await setDoc(doc(db, 'users', 'employee-uid'), { id: 'employee-uid', email: 'employee@shop.test', role: 'employee', workspaceId: WORKSPACE, disabled: false });
    // A chat belonging to the manager, and one belonging to the employee.
    await setDoc(doc(db, 'users', 'manager-uid', 'aiChats', 'chat-1'), {
      title: 'Warranty questions', createdAt: 1, updatedAt: 2,
      messages: [{ id: 'm1', role: 'user', text: 'what happened to PHN-000123', at: 1 }],
    });
    await setDoc(doc(db, 'users', 'employee-uid', 'aiChats', 'chat-2'), {
      title: 'Stock levels', createdAt: 1, updatedAt: 2, messages: [],
    });
    // A usage counter, written by the callable in real life.
    await setDoc(doc(db, 'user_data', WORKSPACE, 'aiUsage', '2026-09-24'), {
      day: '2026-09-24', total: 12, byOp: { chat: 10, listing: 2 },
    });
  });
});

const as = (uid: string) => testEnv.authenticatedContext(uid).firestore();

describe('one user cannot reach another user’s chats', () => {
  it('the owner CANNOT read a manager’s chat — there is no override', async () => {
    const db = as(WORKSPACE);
    await assertFails(getDoc(doc(db, 'users', 'manager-uid', 'aiChats', 'chat-1')));
  });

  it('the owner cannot LIST them either', async () => {
    const db = as(WORKSPACE);
    await assertFails(getDocs(collection(db, 'users', 'manager-uid', 'aiChats')));
  });

  it('a manager cannot read an employee’s chat', async () => {
    const db = as('manager-uid');
    await assertFails(getDoc(doc(db, 'users', 'employee-uid', 'aiChats', 'chat-2')));
  });

  it('an employee cannot read a manager’s chat', async () => {
    const db = as('employee-uid');
    await assertFails(getDoc(doc(db, 'users', 'manager-uid', 'aiChats', 'chat-1')));
  });

  it('nobody can WRITE into somebody else’s chat', async () => {
    const db = as(WORKSPACE);
    await assertFails(setDoc(doc(db, 'users', 'manager-uid', 'aiChats', 'chat-1'),
      { title: 'Renamed by the boss' }, { merge: true }));
  });

  it('nobody can DELETE somebody else’s chat', async () => {
    const db = as('manager-uid');
    await assertFails(deleteDoc(doc(db, 'users', 'employee-uid', 'aiChats', 'chat-2')));
  });

  it('a signed-out visitor gets nothing', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'users', 'manager-uid', 'aiChats', 'chat-1')));
  });
});

describe('a user has full control of their own chats', () => {
  it('reads, lists, writes, renames and deletes their own', async () => {
    const db = as('manager-uid');
    await assertSucceeds(getDoc(doc(db, 'users', 'manager-uid', 'aiChats', 'chat-1')));
    await assertSucceeds(getDocs(collection(db, 'users', 'manager-uid', 'aiChats')));
    await assertSucceeds(setDoc(doc(db, 'users', 'manager-uid', 'aiChats', 'chat-3'),
      { title: 'New chat', createdAt: 5, updatedAt: 5, messages: [] }));
    await assertSucceeds(setDoc(doc(db, 'users', 'manager-uid', 'aiChats', 'chat-1'),
      { title: 'Renamed' }, { merge: true }));
    await assertSucceeds(deleteDoc(doc(db, 'users', 'manager-uid', 'aiChats', 'chat-1')));
  });

  it('a technician — who cannot use the assistant at all — still owns their own path', async () => {
    // The rule is about ownership, not about role. Whether the assistant is
    // offered to them is decided in the app and in the callable's profit gate.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'tech-uid'),
        { id: 'tech-uid', role: 'technician', workspaceId: WORKSPACE, disabled: false });
    });
    const db = as('tech-uid');
    await assertSucceeds(setDoc(doc(db, 'users', 'tech-uid', 'aiChats', 'c'),
      { title: 'x', createdAt: 1, updatedAt: 1, messages: [] }));
  });
});

describe('the AI usage meter', () => {
  it('is readable by the OWNER — it is the shop’s spending', async () => {
    const db = as(WORKSPACE);
    const snap = await assertSucceeds(getDoc(doc(db, 'user_data', WORKSPACE, 'aiUsage', '2026-09-24')));
    expect((snap as { data: () => Record<string, unknown> }).data().total).toBe(12);
  });

  it('is NOT readable by a manager or an employee', async () => {
    await assertFails(getDoc(doc(as('manager-uid'), 'user_data', WORKSPACE, 'aiUsage', '2026-09-24')));
    await assertFails(getDoc(doc(as('employee-uid'), 'user_data', WORKSPACE, 'aiUsage', '2026-09-24')));
  });

  it('is NOT writable by anybody, including the owner', async () => {
    // A meter the client can edit is not a spending limit. Only the callable
    // writes here, with Admin credentials that bypass these rules.
    await assertFails(setDoc(doc(as(WORKSPACE), 'user_data', WORKSPACE, 'aiUsage', '2026-09-24'),
      { total: 0 }, { merge: true }));
    await assertFails(setDoc(doc(as('manager-uid'), 'user_data', WORKSPACE, 'aiUsage', '2026-09-25'),
      { day: '2026-09-25', total: 0 }));
  });
});
