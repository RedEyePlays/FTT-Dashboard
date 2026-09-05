import React, { useMemo, useState } from 'react';
import { Wrench, Search, ScanLine, Printer, X, Clock, Save, ChevronRight } from 'lucide-react';
import { Repair, RepairBatch, RepairStatus, AuditEntry } from '../types';
import {
  REPAIR_STATUS_LABEL, REPAIR_STATUS_CELL, TECH_STATUSES,
  repairAgeDays, balanceOwing, matchesRepair,
} from '../domain/repairs';
import { RepairLabelModal } from './RepairLabelModal';
import { isPrivateBatch } from '../domain/autoInventory';
import { showsCustomerPayment } from '../domain/repairVisibility';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useConnectionStatus } from '../hooks/useConnectionStatus';

interface Props {
  repairs: Repair[];
  batches: RepairBatch[];
  auditLogs: AuditEntry[];
  // Guarded write — App enforces the technician field whitelist + audit.
  onTechUpdate: (stored: Repair, draft: Partial<Repair>) => void;
  onPrintAudit?: (entityType: string, id: string, docName: string) => void;
}

// Technician-facing sections (per spec) + an Intake group so newly received /
// diagnosing tickets are visible to pick up.
const SECTIONS: { key: string; label: string; statuses: RepairStatus[] }[] = [
  { key: 'intake', label: 'Intake', statuses: ['received', 'diagnosing'] },
  { key: 'waiting_approval', label: 'Waiting for Approval', statuses: ['waiting_approval'] },
  { key: 'waiting_parts', label: 'Waiting for Parts', statuses: ['waiting_parts'] },
  { key: 'in_repair', label: 'In Repair', statuses: ['in_repair'] },
  { key: 'testing', label: 'Testing', statuses: ['testing'] },
  { key: 'ready_pickup', label: 'Ready for Pickup', statuses: ['ready_pickup'] },
];

const money = (n: number) => `$${n.toFixed(2)}`;

const TEST_CHECKLIST = [
  'Powers on', 'Touchscreen', 'Charging', 'Rear camera', 'Front camera',
  'Speakers', 'Microphone', 'Wi-Fi', 'Cellular / SIM', 'Face/Touch ID',
  'Buttons', 'Sensors',
];

const deviceName = (r: Repair) => [r.brand, r.model].filter(Boolean).join(' ') || r.deviceType || 'Device';
const dateReceived = (r: Repair) => r.date || (r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—');

const StatusPill: React.FC<{ status: RepairStatus }> = ({ status }) => (
  <span className={`inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold ${REPAIR_STATUS_CELL[status]}`}>
    {REPAIR_STATUS_LABEL[status]}
  </span>
);

export const TechRepairsView: React.FC<Props> = ({ repairs, batches, auditLogs, onTechUpdate, onPrintAudit }) => {
  const [query, setQuery] = useState('');
  const [scanMsg, setScanMsg] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const open = openId ? repairs.find(r => r.id === openId) || null : null;

  // Scan/enter a Repair ID / QR / barcode → open the exact ticket.
  const handleScan = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    const hit = repairs.find(r =>
      r.id === v || r.repairNumber?.toLowerCase() === v.toLowerCase() || (r.imei && r.imei === v));
    if (hit) { setOpenId(hit.id); setScanMsg(''); setQuery(''); }
    else setScanMsg(`No repair matches “${v}”.`);
  };

  const filtered = useMemo(
    () => (query ? repairs.filter(r => matchesRepair(r, query)) : repairs),
    [repairs, query],
  );

  const grouped = useMemo(() => SECTIONS.map(s => ({
    ...s,
    items: filtered
      .filter(r => s.statuses.includes(r.status))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)), // oldest first (most urgent)
  })), [filtered]);

  const totalOpen = grouped.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <Wrench className="w-6 h-6 text-indigo-500" /> My Repairs
          <span className="text-sm font-medium text-slate-400">{totalOpen} open</span>
        </h1>
      </div>

      {/* Search + scan */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={e => { setQuery(e.target.value); setScanMsg(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleScan((e.target as HTMLInputElement).value); }}
            placeholder="Search or scan a Repair ID / QR / barcode, then Enter…"
            className="w-full pl-9 pr-3 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-700 dark:text-slate-200" />
        </div>
        <button onClick={() => handleScan(query)}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
          <ScanLine className="w-4 h-4" /> Open
        </button>
      </div>
      {scanMsg && <p className="text-sm text-rose-600 dark:text-rose-400">{scanMsg}</p>}

      {/* Sections */}
      <div className="space-y-5">
        {grouped.map(section => (
          <div key={section.key}>
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 uppercase tracking-wide">{section.label}</h2>
              <span className="text-xs text-slate-400">{section.items.length}</span>
            </div>
            {section.items.length === 0 ? (
              <p className="text-sm text-slate-400 italic px-1">Nothing here.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {section.items.map(r => (
                  <button key={r.id} onClick={() => setOpenId(r.id)}
                    className="text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 hover:border-indigo-400 transition group">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-slate-800 dark:text-slate-100">{r.repairNumber}</span>
                      <StatusPill status={r.status} />
                    </div>
                    <div className="font-semibold text-slate-700 dark:text-slate-200 mt-1 truncate">{deviceName(r)}</div>
                    {r.imei && <div className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">{r.imei}</div>}
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">{r.issue || 'No issue recorded'}</div>
                    <div className="flex items-center justify-between mt-2 text-[11px] text-slate-400">
                      <span>Received {dateReceived(r)}</span>
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {repairAgeDays(r)}d open</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {open && (
        <TechRepairDrawer
          repair={open}
          batches={batches}
          auditLogs={auditLogs}
          onClose={() => setOpenId(null)}
          onSave={onTechUpdate}
          onPrintAudit={onPrintAudit}
        />
      )}
    </div>
  );
};

const Field: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div>
    <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">{label}</div>
    <div className="text-sm text-slate-800 dark:text-slate-100 font-medium">{value || '—'}</div>
  </div>
);

const TechRepairDrawer: React.FC<{
  repair: Repair;
  batches: RepairBatch[];
  auditLogs: AuditEntry[];
  onClose: () => void;
  onSave: (stored: Repair, draft: Partial<Repair>) => void;
  onPrintAudit?: (entityType: string, id: string, docName: string) => void;
}> = ({ repair: r, batches, auditLogs, onClose, onSave, onPrintAudit }) => {
  // A technician's edits go through the techUpdateRepair Cloud Function
  // (services/repairFunctions.ts), not a plain Firestore write — there is no
  // offline queue behind it, so it's disabled outright while offline rather
  // than appearing to save and then silently failing.
  const isOffline = useConnectionStatus() === 'offline';
  const [status, setStatus] = useState<RepairStatus>(r.status);
  const [techNotes, setTechNotes] = useState(r.techNotes || '');
  const [diagnostics, setDiagnostics] = useState(r.diagnostics || '');
  const [workPerformed, setWorkPerformed] = useState(r.workPerformed || '');
  const [partsUsed, setPartsUsed] = useState(r.partsUsed || '');
  const [testingResults, setTestingResults] = useState(r.testingResults || '');
  const [testChecks, setTestChecks] = useState<string[]>(r.testChecks || []);
  const [label, setLabel] = useState(false);

  // Dirty check against the ticket's stored values, so a stray backdrop/X click
  // doesn't silently discard the technician's typed work log.
  const dirty =
    status !== r.status ||
    techNotes !== (r.techNotes || '') ||
    diagnostics !== (r.diagnostics || '') ||
    workPerformed !== (r.workPerformed || '') ||
    partsUsed !== (r.partsUsed || '') ||
    testingResults !== (r.testingResults || '') ||
    JSON.stringify(testChecks) !== JSON.stringify(r.testChecks || []);
  const requestClose = () => { if (!dirty || window.confirm('Discard unsaved changes to this repair?')) onClose(); };

  useEscapeKey(requestClose);

  const history = auditLogs
    .filter(a => a.entityId === r.id)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 30);

  const toggleCheck = (c: string) =>
    setTestChecks(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const save = () => {
    onSave(r, { status, techNotes, diagnostics, workPerformed, partsUsed, testingResults, testChecks });
    onClose();
  };

  // Wholesale device → its batch (for the label's batch number).
  const batch = r.batchId ? batches.find(b => b.id === r.batchId) : undefined;
  const ta = 'w-full text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-100';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-fadeIn" onClick={requestClose}>
      <div className="bg-slate-50 dark:bg-slate-900 w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between sticky top-0 bg-slate-50 dark:bg-slate-900 z-10">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-slate-800 dark:text-slate-100">{r.repairNumber}</span>
            <StatusPill status={r.status} />
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setLabel(true)} title="Print / reprint label" className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400"><Printer className="w-5 h-5" /></button>
            <button onClick={requestClose} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Device + approved details (read-only) */}
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 grid grid-cols-2 gap-3">
            <Field label="Device" value={deviceName(r)} />
            <Field label="IMEI / Serial" value={r.imei ? <span className="font-mono">{r.imei}</span> : '—'} />
            <Field label="Type" value={r.type === 'wholesale' ? 'Wholesale' : r.type === 'internal' ? 'Internal' : 'Retail'} />
            <Field label="Received" value={dateReceived(r)} />
            <div className="col-span-2"><Field label="Reported issue" value={r.issue} /></div>
          </section>

          <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 grid grid-cols-2 gap-3">
            <div className="col-span-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Approved repair details</div>
            {/* An internal refurb (private-batch device or internal ticket) is
                the shop's own stock — there is no customer to charge, so the
                price/deposit/balance are meaningless here. Display only; the
                stored fields are untouched. */}
            {showsCustomerPayment(r, batch) && <>
              <Field label="Repair price" value={money(r.repairPrice || 0)} />
              <Field label="Deposit" value={money(r.deposit || 0)} />
              <Field label="Balance owing" value={money(balanceOwing(r))} />
            </>}
            <Field label="Est. completion" value={r.estimatedCompletion || '—'} />
            {r.warrantyDays ? <Field label="Warranty" value={`${r.warrantyDays} days`} /> : null}
            {r.cosmetic?.checks?.length ? <div className="col-span-2"><Field label="Cosmetic" value={r.cosmetic.checks.join(', ')} /></div> : null}
          </section>

          {/* Status selector */}
          <section>
            <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Status</label>
            <select value={status} onChange={e => setStatus(e.target.value as RepairStatus)} className={ta}>
              {TECH_STATUSES.map(s => <option key={s} value={s}>{REPAIR_STATUS_LABEL[s]}</option>)}
            </select>
          </section>

          {/* Technician work log */}
          <section className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Diagnostic findings</label>
              <textarea value={diagnostics} onChange={e => setDiagnostics(e.target.value)} rows={2} className={ta} placeholder="What you found…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Work performed</label>
              <textarea value={workPerformed} onChange={e => setWorkPerformed(e.target.value)} rows={2} className={ta} placeholder="What you did…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Parts used</label>
              <textarea value={partsUsed} onChange={e => setPartsUsed(e.target.value)} rows={2} className={ta} placeholder="Free text — e.g. OEM screen, battery…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Technician notes</label>
              <textarea value={techNotes} onChange={e => setTechNotes(e.target.value)} rows={2} className={ta} />
            </div>
          </section>

          {/* Testing checklist + results */}
          <section className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Testing checklist</div>
            <div className="grid grid-cols-2 gap-1.5">
              {TEST_CHECKLIST.map(c => (
                <label key={c} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={testChecks.includes(c)} onChange={() => toggleCheck(c)} className="rounded" /> {c}
                </label>
              ))}
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Testing results</label>
              <textarea value={testingResults} onChange={e => setTestingResults(e.target.value)} rows={2} className={ta} placeholder="Outcome / anything still failing…" />
            </div>
          </section>

          {/* Timeline */}
          <section>
            <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Repair timeline</div>
            {history.length === 0 ? (
              <p className="text-sm text-slate-400 italic">No history yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {history.map(a => (
                  <li key={a.id} className="text-xs text-slate-600 dark:text-slate-300 flex items-start gap-2">
                    <ChevronRight className="w-3 h-3 mt-0.5 text-slate-400 shrink-0" />
                    <span>
                      <span className="font-medium">{a.action}</span>
                      {a.before?.status && a.after?.status ? ` · ${REPAIR_STATUS_LABEL[a.before.status as RepairStatus] || a.before.status} → ${REPAIR_STATUS_LABEL[a.after.status as RepairStatus] || a.after.status}` : ''}
                      <span className="text-slate-400"> · {new Date(a.ts).toLocaleString()} · {a.userEmail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {isOffline && (
            <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
              You're offline — saving ticket changes needs a connection.
            </p>
          )}
          <div className="flex gap-2 pt-1">
            <button onClick={save} disabled={isOffline} title={isOffline ? "Unavailable offline" : undefined}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium"><Save className="w-4 h-4" /> Save changes</button>
            <button onClick={() => setLabel(true)} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-sm font-medium hover:border-indigo-400"><Printer className="w-4 h-4" /> Label</button>
          </div>
        </div>
      </div>

      {label && (
        <RepairLabelModal
          repair={r}
          context={batch ? { batchNumber: batch.batchNumber, isPrivate: isPrivateBatch(batch) } : undefined}
          onClose={() => setLabel(false)}
          onPrinted={() => onPrintAudit?.('repair', r.id, 'QR label')}
        />
      )}
    </div>
  );
};
