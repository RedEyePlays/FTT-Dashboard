import { describe, it, expect } from 'vitest';
import { CrashReport, crashId, formatCrashDetails, crashActivityLine } from './crashReport';

// The owner hit "Inventory hit an error" with a Try again button and NOTHING
// else — no message, no stack, no id. Diagnosing it meant asking him to open
// dev tools in the middle of a shift.

const AT = Date.UTC(2026, 8, 20, 14, 30, 0);
const report = (over: Partial<CrashReport> = {}): CrashReport => ({
  screen: 'Inventory',
  message: "Cannot read properties of undefined (reading 'map')",
  stack: 'TypeError: ...\n    at InventoryView (index.js:1:1)',
  componentStack: '\n    in InventoryView\n    in ErrorBoundary',
  at: AT,
  user: 'owner@shop.test',
  appVersion: '1.4.2',
  ...over,
});

describe('a crash id somebody can read down the phone', () => {
  it('is short, stable and greppable', () => {
    const id = crashId(report());
    expect(id).toMatch(/^ERR-[0-9A-Z]{7}$/);
    expect(crashId(report())).toBe(id);
  });

  it('differs when a different screen breaks', () => {
    expect(crashId(report({ screen: 'Reports' }))).not.toBe(crashId(report()));
  });

  it('differs for a different error on the same screen', () => {
    expect(crashId(report({ message: 'something else' }))).not.toBe(crashId(report()));
  });
});

describe('the block the Copy details button produces', () => {
  const text = formatCrashDetails(report());

  it('leads with what broke, so a human reads two lines and knows', () => {
    expect(text.split('\n')[0]).toBe(`${crashId(report())} — Inventory`);
  });

  it('carries the message, both stacks, the version and who hit it', () => {
    expect(text).toContain("Cannot read properties of undefined (reading 'map')");
    expect(text).toContain('at InventoryView');
    expect(text).toContain('in ErrorBoundary');
    expect(text).toContain('1.4.2');
    expect(text).toContain('owner@shop.test');
  });

  it('is plain text, not JSON — it gets pasted into a message to a person', () => {
    expect(() => JSON.parse(text)).toThrow();
  });

  it('omits lines it has nothing for, rather than printing undefined', () => {
    const bare = formatCrashDetails({ screen: 'Reports', message: 'boom', at: AT });
    expect(bare).not.toMatch(/undefined|null/);
    expect(bare).not.toMatch(/App version|User:|Stack:/);
  });

  it('says so plainly when the error carried no message at all', () => {
    expect(formatCrashDetails({ screen: 'X', message: '', at: AT })).toContain('(no message)');
  });
});

describe('the one line written to the activity trail', () => {
  it('names the screen and carries the id, so a crash nobody screenshots is still traceable', () => {
    const line = crashActivityLine(report());
    expect(line).toContain('Inventory hit an error');
    expect(line).toContain(crashId(report()));
    expect(line).toContain('Cannot read properties');
  });

  it('is truncated, because the activity feed is read by staff', () => {
    const line = crashActivityLine(report({ message: 'x'.repeat(500) }));
    expect(line.length).toBeLessThan(220);
    expect(line).toContain('…');
  });

  it('never contains a stack', () => {
    expect(crashActivityLine(report())).not.toContain('at InventoryView');
  });
});
