// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import * as errorReporting from './../services/errorReporting';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return { host, root, unmount: () => { act(() => root.unmount()); host.remove(); } };
}

const Boom: React.FC = () => { throw new Error('kaboom'); };
const Fine: React.FC = () => <div>all good</div>;

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error to console.error too — not the point of
    // these tests, and it clutters output.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('root variant: renders the full-screen recovery UI instead of crashing, and reports the error', () => {
    const spy = vi.spyOn(errorReporting, 'captureError');
    const { host, unmount } = mount(<ErrorBoundary variant="root"><Boom /></ErrorBoundary>);
    expect(host.textContent).toContain('Something went wrong');
    expect(host.textContent).toContain('Reload');
    expect(host.textContent).toContain('last completed sale');
    expect(spy).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ boundary: 'root' }));
    unmount();
  });

  it('route variant: renders an inline recovery UI with the given label, and does not blank the whole page', () => {
    const { host, unmount } = mount(<ErrorBoundary variant="route" label="Reports"><Boom /></ErrorBoundary>);
    expect(host.textContent).toContain('Reports hit an error');
    expect(host.textContent).toContain('Try again');
    expect(host.textContent).toContain('rest of the app is unaffected');
    unmount();
  });

  it('does not render any fallback when the child does not throw', () => {
    const { host, unmount } = mount(<ErrorBoundary variant="route"><Fine /></ErrorBoundary>);
    expect(host.textContent).toBe('all good');
    unmount();
  });

  it('a boundary keyed by route, remounted with a new key, sheds a previous crash instead of staying tripped', () => {
    // This is the mechanism App.tsx relies on (`<ErrorBoundary key={view} .../>`)
    // for "a crash in Reports doesn't take down Quick Sale" — React resets a
    // component's state (including a tripped error boundary) when its key
    // changes, which is a REMOUNT, not the same instance recovering.
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => { root.render(<ErrorBoundary key="reports" variant="route" label="Reports"><Boom /></ErrorBoundary>); });
    expect(host.textContent).toContain('Reports hit an error');

    act(() => { root.render(<ErrorBoundary key="pos" variant="route" label="Quick Sale"><Fine /></ErrorBoundary>); });
    expect(host.textContent).toBe('all good');

    act(() => root.unmount());
    host.remove();
  });
});
