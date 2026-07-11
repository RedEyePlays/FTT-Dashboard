// Thin client for Zebra Browser Print — a small local app the user installs that
// exposes an HTTP API on localhost, letting a web page talk to USB/network Zebra
// printers. If it isn't installed/running, detection fails and callers fall back
// to normal browser printing.
//
// An HTTPS-hosted page can only reach the HTTPS endpoint (9101, self-signed cert
// the user trusts once); an HTTP page can use 9100. We try the matching scheme
// first, then the other, so both dev (http) and prod (https) work.

export interface ZebraDevice {
  name: string;
  uid: string;
  connection: string;
  deviceType: string;
  version?: number;
  provider?: string;
  manufacturer?: string;
}

export interface ZebraDetect {
  available: boolean;
  host?: string;
  devices: ZebraDevice[];
  defaultUid?: string;
}

const HOSTS = typeof window !== 'undefined' && window.location.protocol === 'https:'
  ? ['https://localhost:9101', 'http://localhost:9100', 'http://127.0.0.1:9100']
  : ['http://localhost:9100', 'http://127.0.0.1:9100', 'https://localhost:9101'];

const TIMEOUT_MS = 2500;

const fetchJson = async (url: string, init?: RequestInit): Promise<any> => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  } finally {
    clearTimeout(t);
  }
};

const looksLikeDevice = (d: any): d is ZebraDevice =>
  d && typeof d === 'object' && typeof d.uid === 'string' && typeof d.connection === 'string';

// Browser Print's /available returns device arrays keyed by category; collect
// every printer-looking entry regardless of the exact key names.
const collectDevices = (payload: any): ZebraDevice[] => {
  const out: ZebraDevice[] = [];
  const push = (arr: any) => Array.isArray(arr) && arr.forEach(d => { if (looksLikeDevice(d)) out.push(d); });
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload)) push(payload);
    else Object.values(payload).forEach(push);
  }
  // De-dupe by uid.
  const seen = new Set<string>();
  return out.filter(d => (seen.has(d.uid) ? false : (seen.add(d.uid), true)));
};

/** Detect Browser Print + connected printers. Never throws. */
export async function detectZebra(): Promise<ZebraDetect> {
  for (const host of HOSTS) {
    try {
      const available = await fetchJson(`${host}/available`);
      const devices = collectDevices(available);
      let defaultUid: string | undefined;
      try {
        const def = await fetchJson(`${host}/default?type=printer`);
        if (looksLikeDevice(def)) defaultUid = def.uid;
      } catch { /* default is optional */ }
      return { available: true, host, devices, defaultUid: defaultUid || devices[0]?.uid };
    } catch {
      // try next host
    }
  }
  return { available: false, devices: [] };
}

/** Send raw ZPL to a device via Browser Print. Resolves with the response text
 * (usually empty) on 2xx, else throws. */
export async function sendZpl(host: string, device: ZebraDevice, zpl: string): Promise<string> {
  const res = await fetchJson(`${host}/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device, data: zpl }),
  });
  return typeof res === 'string' ? res : JSON.stringify(res);
}

/** UTF-8 byte length of a ZPL payload (what actually goes over the wire). */
export const zplBytes = (zpl: string): number =>
  (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(zpl).length : zpl.length);

/** Infer the printer's control language from a ~HI host-identification reply.
 * ZPL firmware answers ~HI at all (model,firmware,dpm,mem); EPL units generally
 * do not, so a non-empty reply is treated as ZPL unless it names EPL. */
export function inferLanguage(hostId: string | null): 'ZPL' | 'EPL' | 'unknown' {
  if (!hostId) return 'unknown';
  if (/epl/i.test(hostId)) return 'EPL';
  if (/zpl|dpi|dpm|,V\d|ZTC|ZD\d|GK\d|GX\d|ZT\d/i.test(hostId)) return 'ZPL';
  return 'unknown';
}

/**
 * Best-effort model/language probe: send ~HI (Host Identification) and read the
 * reply. ZPL-capable firmware answers with the model + a "V..." firmware string.
 * Returns null if the round-trip isn't supported.
 */
export async function probeModel(host: string, device: ZebraDevice): Promise<string | null> {
  try {
    await sendZpl(host, device, '~HI');
    const reply = await fetchJson(`${host}/read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device }),
    });
    const s = typeof reply === 'string' ? reply : (reply && (reply.data || reply.output)) || '';
    return typeof s === 'string' && s.trim() ? s.trim() : null;
  } catch {
    return null;
  }
}
