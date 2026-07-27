import { ref, listAll, getMetadata, getDownloadURL } from 'firebase/storage';
import { storage } from './firebase';

// Client access to the automated backup snapshots in Cloud Storage. The
// scheduledBackups Cloud Function writes them to backups/{workspaceId}/; Storage
// security rules restrict read access to the workspace owner (uid == workspaceId).

export interface BackupFileMeta {
  path: string;      // full storage path, e.g. backups/<ws>/2026-07-27T09-00-00-000Z.json
  name: string;      // file name only
  size: number;      // bytes
  created: number;   // epoch ms
}

// Parse the timestamped filename back to epoch ms (mirrors the function's stamp()).
const parseStamp = (name: string): number => {
  const iso = name.replace('.json', '').replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z',
  );
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** The workspace's automated backups, newest first (owner-only via Storage rules). */
export async function listWorkspaceBackups(workspaceId: string): Promise<BackupFileMeta[]> {
  const dir = ref(storage, `backups/${workspaceId}`);
  const res = await listAll(dir);
  const metas = await Promise.all(
    res.items.map(async (item) => {
      let size = 0;
      let created = parseStamp(item.name);
      try {
        const m = await getMetadata(item);
        size = m.size ?? 0;
        if (m.timeCreated) created = Date.parse(m.timeCreated) || created;
      } catch { /* fall back to name-derived timestamp / zero size */ }
      return { path: item.fullPath, name: item.name, size, created };
    }),
  );
  return metas.sort((a, b) => b.created - a.created);
}

/** A tokenized download URL for one backup object (owner-only via Storage rules). */
export async function getBackupDownloadUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path));
}
