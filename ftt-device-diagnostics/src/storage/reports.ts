import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DeviceReport, ResultMap } from '../types';

/**
 * Simple local persistence for saved reports (v1 — no backend).
 * Reports are stored as a single JSON array under one key. That is more than
 * enough for the volume a single tech generates and keeps read/write trivial.
 */
const STORAGE_KEY = 'ftt.reports.v1';

function summarize(results: ResultMap, total: number): DeviceReport['summary'] {
  let pass = 0;
  let fail = 0;
  let skip = 0;
  for (const r of Object.values(results)) {
    if (r.status === 'pass') pass += 1;
    else if (r.status === 'fail') fail += 1;
    else if (r.status === 'skip') skip += 1;
  }
  const answered = pass + fail + skip;
  return { total, pass, fail, skip, untested: Math.max(0, total - answered) };
}

/** Build (but do not persist) a report snapshot from the current run. */
export function buildReport(
  deviceLabel: string,
  results: ResultMap,
  totalTests: number,
): DeviceReport {
  const createdAt = new Date().toISOString();
  return {
    id: `rpt_${Date.now()}`,
    deviceLabel: deviceLabel.trim() || 'Unlabeled device',
    createdAt,
    results,
    summary: summarize(results, totalTests),
  };
}

export async function getReports(): Promise<DeviceReport[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DeviceReport[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist a report (newest first) and return the updated list. */
export async function saveReport(report: DeviceReport): Promise<DeviceReport[]> {
  const existing = await getReports();
  const next = [report, ...existing];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function deleteReport(id: string): Promise<DeviceReport[]> {
  const existing = await getReports();
  const next = existing.filter((r) => r.id !== id);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export async function clearAllReports(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
