// Pure client-side download helpers for the backup/export feature.

export const triggerDownload = (filename: string, content: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
};

export const downloadJson = (filename: string, data: unknown) =>
  triggerDownload(filename, JSON.stringify(data, null, 2), 'application/json;charset=utf-8;');

// Flatten a collection of records to CSV (union of all keys as headers).
export const toCSV = (rows: Record<string, any>[]): string => {
  if (!rows.length) return '';
  const keySet = new Set<string>();
  rows.forEach(r => Object.keys(r).forEach(k => keySet.add(k)));
  const keys = Array.from(keySet);
  const esc = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `"${s.replace(/"/g, '""')}"`;
  };
  return [keys.join(','), ...rows.map(r => keys.map(k => esc(r[k])).join(','))].join('\n');
};
