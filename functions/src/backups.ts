import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions/v2";
import * as admin from "firebase-admin";

// Single shared Admin app (aiGenerate in index.ts doesn't init one).
if (!admin.apps.length) admin.initializeApp();

// The workspace collections to snapshot. Kept in sync with COLLECTIONS in
// services/firestoreDb.ts (the client can't be imported into this subproject).
const COLLECTIONS = [
  "inventory", "accessories", "salesTransactions", "customers",
  "dropOffs", "runners", "settlements", "activityLog", "auditLogs",
  "repairs", "repairBatches", "timeEntries", "payPeriods",
] as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_RETENTION = 14;

interface BackupConfig {
  enabled: boolean;
  frequency: "daily" | "weekly";
  retention: number;
}

const readConfig = (raw: unknown): BackupConfig => {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: b.enabled === true,
    frequency: b.frequency === "weekly" ? "weekly" : "daily",
    retention: Number.isFinite(b.retention) && (b.retention as number) > 0
      ? Math.floor(b.retention as number)
      : DEFAULT_RETENTION,
  };
};

// Filename-safe, lexicographically-sortable timestamp (no colons for clean URLs).
const stamp = (d: Date): string => d.toISOString().replace(/[:]/g, "-");

/**
 * Gather every workspace collection (plus users + meta) into one JSON-able
 * object — the server-side mirror of the client's exportWorkspaceData().
 */
async function gatherWorkspace(
  db: admin.firestore.Firestore,
  wsId: string
): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const name of COLLECTIONS) {
    const snap = await db.collection("user_data").doc(wsId).collection(name).get();
    out[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  const usersSnap = await db.collection("users").where("workspaceId", "==", wsId).get();
  out.users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const metaSnap = await db.collection("user_data").doc(wsId).collection("meta").doc("app").get();
  out.meta = metaSnap.exists ? [{ id: "app", ...metaSnap.data() }] : [];
  return out;
}

/** List a workspace's backup objects, newest first. */
async function listBackups(bucket: ReturnType<admin.storage.Storage["bucket"]>, wsId: string) {
  const [files] = await bucket.getFiles({ prefix: `backups/${wsId}/` });
  return files
    .filter((f) => f.name.endsWith(".json"))
    .sort((a, b) => (a.name < b.name ? 1 : -1)); // names are sortable timestamps → newest first
}

/** True if this workspace is due for a backup given its frequency + newest file. */
function isDue(frequency: "daily" | "weekly", newestName: string | undefined, now: number): boolean {
  if (!newestName) return true;
  const iso = newestName.split("/").pop()!.replace(".json", "").replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    "$1T$2:$3:$4.$5Z"
  );
  const last = Date.parse(iso);
  if (Number.isNaN(last)) return true;
  // Small margin so a job that runs a few minutes early each day still fires.
  const interval = frequency === "weekly" ? 7 * DAY_MS : DAY_MS;
  return now - last >= interval - 2 * HOUR_MS;
}

/**
 * Daily scheduled backup. The function itself runs every day; each workspace's
 * own config decides whether a snapshot is actually written (daily = every run,
 * weekly = only when ~7 days have passed) and how many to retain. This keeps the
 * schedule per-workspace without needing a separate cron per workspace.
 *
 * Snapshots are written to Cloud Storage at backups/{workspaceId}/{timestamp}.json.
 */
export const scheduledBackups = onSchedule(
  {
    schedule: "every day 09:00",
    timeZone: "Etc/UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const now = Date.now();

    // Each workspace is owned by one 'owner' user whose uid == workspaceId.
    const owners = await db.collection("users").where("role", "==", "owner").get();
    logger.info(`scheduledBackups: ${owners.size} workspace(s) to consider`);

    for (const owner of owners.docs) {
      const wsId = (owner.data().workspaceId as string) || owner.id;
      try {
        const metaSnap = await db.collection("user_data").doc(wsId).collection("meta").doc("app").get();
        const cfg = readConfig((metaSnap.data() as Record<string, unknown> | undefined)?.settings
          ? ((metaSnap.data() as { settings?: { backups?: unknown } }).settings?.backups)
          : undefined);

        if (!cfg.enabled) continue;

        const existing = await listBackups(bucket, wsId);
        if (!isDue(cfg.frequency, existing[0]?.name, now)) {
          logger.info(`workspace ${wsId}: not due (${cfg.frequency})`);
          continue;
        }

        const data = await gatherWorkspace(db, wsId);
        const payload = JSON.stringify({ exportedAt: now, workspaceId: wsId, data }, null, 2);
        const objectName = `backups/${wsId}/${stamp(new Date(now))}.json`;
        await bucket.file(objectName).save(payload, {
          contentType: "application/json",
          metadata: { cacheControl: "private, max-age=0" },
        });
        logger.info(`workspace ${wsId}: wrote ${objectName} (${payload.length} bytes)`);

        // Retention: keep the newest `retention`, delete the rest.
        const after = await listBackups(bucket, wsId);
        const stale = after.slice(cfg.retention);
        await Promise.all(stale.map((f) => f.delete().catch((e) => logger.warn(`delete ${f.name} failed`, e))));
        if (stale.length) logger.info(`workspace ${wsId}: pruned ${stale.length} old backup(s)`);
      } catch (e) {
        logger.error(`workspace ${wsId}: backup failed`, e as Error);
      }
    }
  }
);
