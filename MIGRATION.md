# Migration & Firebase setup — Roles / Audit / Backups (PR #14)

## Did this require a data migration?

**No structural migration of existing data is required.**

- **Paths unchanged.** All shop data still lives at `user_data/{workspaceId}/…`.
  For an existing owner, `workspaceId === your uid`, so every collection
  (`inventory`, `accessories`, `salesTransactions`, `customers`, `dropOffs`,
  `runners`, `settlements`, `activityLog`) is in exactly the same place as before.
  Nothing moves.
- **No documents reshaped.** Only new *optional* fields/collections were added;
  nothing was renamed or removed. No per-document transform to run.

### What changed structurally (all new, created going forward)

| New | Where | Created by |
|-----|-------|-----------|
| `users/{uid}` | top-level | **auto** on each user's first login |
| `workspaceInvites/{email}` | top-level | when an Owner invites someone |
| `user_data/{ws}/auditLogs/{id}` | per workspace | on the first audited action |
| `meta.lastBackup` | `user_data/{ws}/meta/app` | on first backup export |

`users/{uid}` shape: `{ id, email, role, workspaceId, disabled?, allowProfit?, lastLogin?, createdAt? }`.

### Automatic migration

On next login the app self-provisions the only required new doc: it finds no
`users/{uid}`, so it creates `{ role: 'owner', workspaceId: <your uid> }`.
**You don't have to do anything** for a normal single-owner shop.

### When a one-time script IS needed

Only if **multiple people already used the app as separate accounts** and you
want to merge them into one shared shop. Each already auto-provisioned as Owner
of their own workspace, and the in-app invite flow only fires on a *first* login,
so it can't merge existing accounts. Use `scripts/provision-users.mjs`
(Firebase Admin SDK) — it sets each member's `users/{uid}` doc with a shared
`workspaceId`. See the header of that file for exact steps (service account key,
`--apply`, optional data copy).

## Firebase Console changes you must make

1. **Firestore security rules — REQUIRED.** Deploy `firestore.rules` (they are
   not deployed by the Hosting workflow):
   ```
   firebase deploy --only firestore:rules
   ```
   ⚠️ Test them first in **Firestore → Rules → Playground** — they encode the
   role model and can't be exercised in CI.

2. **Authentication — verify.** Email/Password provider must be **enabled**
   (Authentication → Sign-in method). No new providers are needed. Nothing to
   change if sign-in already worked.

3. **Composite indexes — none required.** The only new queries filter by a single
   field (`where('workspaceId','==',…)` on `users` and `workspaceInvites`);
   Firestore's automatic single-field indexes cover these. No `firestore.indexes.json`
   needed. (If you later add a query combining `where` + `orderBy` on different
   fields, Firestore will prompt you with a one-click index link.)

4. **Nothing else.** No Storage, Functions, or App Check changes for this PR.

## Server-side follow-ups (not in this PR, need Admin SDK / Cloud Functions)

- Truly blocking a **disabled** user's login (this PR flags `disabled` and the app
  signs them out + rules deny writes, but their token isn't revoked server-side).
- Reliable **last-login** for all users (currently best-effort, written by the app).
- **Scheduled** automatic backups (use Cloud Functions + Cloud Scheduler, or GCP's
  managed Firestore export — never put privileged credentials in the frontend).
- Fully tamper-proof **invites** (client-claimed today, guarded by rules).
