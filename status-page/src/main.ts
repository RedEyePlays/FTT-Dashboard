import './style.css';
import { lookupRepairStatus, LookupError, RepairStatusResult } from './api';

// A fully standalone public page: check a repair's status with a ticket number
// plus the name or last-4 phone on the ticket. No login, no navigation, no
// reference of any kind to the main shop-management app — this bundle only
// ever talks to the one public Cloud Function (see api.ts).

const app = document.getElementById('app')!;

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

type ToneKey = 'progress' | 'ready' | 'done' | 'cancelled' | 'none';
const toneFor = (status?: string): { tone: ToneKey; icon: string } => {
  switch (status) {
    case 'Ready for Pickup': return { tone: 'ready', icon: '✅' };
    case 'Completed': return { tone: 'done', icon: '☑️' };
    case 'Cancelled': return { tone: 'cancelled', icon: '⚠️' };
    default: return { tone: 'progress', icon: '⏳' };
  }
};

let loading = false;
let error: string | null = null;
let result: RepairStatusResult | null = null;
// Preserve what the visitor typed across a failed/loading render.
let ticketValue = '';
let identifierValue = '';

function errorMessage(err: unknown): string {
  if (err instanceof LookupError) {
    if (err.code === 'resource-exhausted') return 'Too many attempts. Please wait a minute and try again.';
    if (err.code === 'invalid-argument') return 'Enter your ticket number and the name or phone on the ticket.';
    if (err.code === 'unavailable') return err.message;
  }
  return 'Something went wrong. Please try again in a moment.';
}

function render() {
  app.innerHTML = `
    <div class="brand">
      <div class="brand-badge">🔧</div>
      <h1>Repair Status</h1>
    </div>
    <div class="card">${result ? renderResult(result) : renderForm()}</div>
  `;
  wireUp();
}

function renderForm(): string {
  return `
    <p class="hint">Enter your repair ticket number and the name or phone number on the ticket to check its status.</p>
    <form id="lookup-form">
      <div class="field">
        <label for="ticket">Ticket number</label>
        <input id="ticket" name="ticket" autocomplete="off" placeholder="e.g. RPR-000123" value="${escapeHtml(ticketValue)}" />
      </div>
      <div class="field">
        <label for="identifier">Name or phone on ticket</label>
        <input id="identifier" name="identifier" autocomplete="off" placeholder="Your name, or last 4 digits of your phone" value="${escapeHtml(identifierValue)}" />
      </div>
      ${error ? `<p class="error-text">${escapeHtml(error)}</p>` : ''}
      <button type="submit" class="submit-btn" ${loading ? 'disabled' : ''}>${loading ? 'Checking…' : 'Check status'}</button>
    </form>
  `;
}

function renderResult(r: RepairStatusResult): string {
  if (!r.found) {
    return `
      <div class="result">
        <span class="status-pill tone-none">⚠️ No matching repair</span>
        <p class="detail">We couldn't find a repair matching that ticket number and name/phone. Double-check both and try again — or contact the shop.</p>
        <button type="button" id="try-again" class="link-btn">← Try again</button>
      </div>
    `;
  }
  const { tone, icon } = toneFor(r.status);
  const dateLine = r.readyDate
    ? `<p class="detail"><strong>${r.status === 'Ready for Pickup' ? 'Ready since' : 'Completed'}:</strong> ${escapeHtml(r.readyDate)}</p>`
    : r.estimatedDate
      ? `<p class="detail"><strong>Estimated completion:</strong> ${escapeHtml(r.estimatedDate)}</p>`
      : '';
  return `
    <div class="result">
      <span class="status-pill tone-${tone}">${icon} ${escapeHtml(r.status || '')}</span>
      <p class="device">${escapeHtml(r.device || '')}</p>
      <p class="ticket">Ticket ${escapeHtml(r.ticket || '')}</p>
      ${dateLine}
      <p class="footnote">Questions? Contact the shop and reference your ticket number.</p>
      <button type="button" id="check-another" class="link-btn">← Check another ticket</button>
    </div>
  `;
}

function wireUp() {
  const form = document.getElementById('lookup-form') as HTMLFormElement | null;
  form?.addEventListener('submit', onSubmit);
  document.getElementById('try-again')?.addEventListener('click', reset);
  document.getElementById('check-another')?.addEventListener('click', reset);
}

function reset() {
  result = null;
  error = null;
  render();
}

async function onSubmit(e: Event) {
  e.preventDefault();
  const form = e.currentTarget as HTMLFormElement;
  const ticket = (form.elements.namedItem('ticket') as HTMLInputElement).value;
  const identifier = (form.elements.namedItem('identifier') as HTMLInputElement).value;
  ticketValue = ticket;
  identifierValue = identifier;

  if (!ticket.trim() || identifier.trim().length < 3) {
    error = 'Enter your ticket number and the name or phone on the ticket.';
    render();
    return;
  }

  loading = true;
  error = null;
  render();

  try {
    result = await lookupRepairStatus(ticket, identifier);
  } catch (err) {
    error = errorMessage(err);
  } finally {
    loading = false;
    render();
  }
}

render();
