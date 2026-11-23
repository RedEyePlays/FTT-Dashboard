// @vitest-environment happy-dom
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { ResponsiveDialog } from './responsive';
import { MobileDrawer } from './MobileDrawer';

/**
 * A DIALOG STOLE FOCUS ON EVERY KEYSTROKE.
 *
 * Typing into any dialog text field moved the caret away after each
 * character: type "32" into the offer screen's paste box and the "2" went
 * nowhere.
 *
 * The cause was one effect doing two jobs with `onClose` in its dependency
 * array. Every call site passes an inline arrow, which is a new function
 * identity on every render — so a keystroke set state, the parent re-rendered,
 * `onClose` changed identity, the effect re-ran, and `ref.current.focus()`
 * pulled focus out of the input and onto the dialog container.
 *
 * It was never specific to one dialog: EVERY dialog in the app with a text
 * field had it, and it is only noticeable where somebody types more than a
 * word. So the tests below drive the component the way the app does — an
 * inline arrow for `onClose`, and a parent that re-renders on every
 * character — rather than with a memoised handler that would hide it.
 */

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function mount(ui: React.ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    host,
    unmount: () => { act(() => root.unmount()); host.remove(); },
  };
}

/** Type one character into a controlled field, as a real keystroke would. */
const typeChar = (el: HTMLInputElement | HTMLTextAreaElement, next: string) => {
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setNative = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setNative.call(el, next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const pressEscape = () => act(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
});

/**
 * A dialog driven exactly as every real call site drives it: `onClose` is an
 * INLINE ARROW, and the parent re-renders on each character because the text
 * lives in its state.
 */
const Host: React.FC<{ onClosed?: () => void; multiline?: boolean }> = ({ onClosed, multiline }) => {
  const [open, setOpen] = useState(true);
  const [text, setText] = useState('');
  return (
    <ResponsiveDialog open={open} onClose={() => { setOpen(false); onClosed?.(); }} title="Add devices">
      {multiline
        ? <textarea aria-label="field" value={text} onChange={e => setText(e.target.value)} />
        : <input aria-label="field" value={text} onChange={e => setText(e.target.value)} />}
    </ResponsiveDialog>
  );
};

/* ======================================================================== *
 * THE BUG
 * ======================================================================== */

describe('typing in a dialog keeps focus', () => {
  for (const multiline of [false, true]) {
    it(`survives a whole multi-character string (${multiline ? 'textarea' : 'input'})`, () => {
      const v = mount(<Host multiline={multiline} />);
      const field = v.host.querySelector('[aria-label="field"]') as HTMLInputElement;
      act(() => { field.focus(); });
      expect(document.activeElement).toBe(field);

      // Character by character, checking after EVERY one — a test that typed
      // a whole string in a single input event would not have caught this,
      // because the bug needs a re-render between keystrokes.
      const word = 'FTT-000101';
      for (let k = 1; k <= word.length; k++) {
        typeChar(field, word.slice(0, k));
        expect(document.activeElement, `after "${word.slice(0, k)}"`).toBe(field);
      }
      expect(field.value).toBe(word);
      v.unmount();
    });
  }

  it('and the caret stays where the user left it across a re-render', () => {
    // Focus landing back on the field is not enough on its own: re-focusing
    // an input moves the caret to the end, so a "fix" that merely re-focused
    // the field would still lose the insertion point mid-number.
    //
    // The re-render is triggered by something OTHER than the value changing,
    // because setting `.value` through the native setter — which is how a
    // keystroke has to be simulated here — resets the selection itself, and
    // that artefact would mask what is being tested.
    const Outer: React.FC = () => {
      const [, setTick] = useState(0);
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setTick(t => t + 1)}>tick</button>
          <ResponsiveDialog open={open} onClose={() => setOpen(false)} title="T">
            <input aria-label="field" defaultValue="1234" />
          </ResponsiveDialog>
        </>
      );
    };
    const v = mount(<Outer />);
    const field = v.host.querySelector('[aria-label="field"]') as HTMLInputElement;
    act(() => { field.focus(); field.setSelectionRange(2, 2); });
    act(() => { (v.host.querySelector('button') as HTMLButtonElement).click(); });
    expect(document.activeElement).toBe(field);
    expect(field.selectionStart).toBe(2);
    v.unmount();
  });

  it('a parent re-render for any other reason does not steal it either', () => {
    // The trigger is a re-render, not specifically a keystroke.
    const Outer: React.FC = () => {
      const [, setTick] = useState(0);
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setTick(t => t + 1)}>tick</button>
          <ResponsiveDialog open={open} onClose={() => setOpen(false)} title="T">
            <input aria-label="field" />
          </ResponsiveDialog>
        </>
      );
    };
    const v = mount(<Outer />);
    const field = v.host.querySelector('[aria-label="field"]') as HTMLInputElement;
    act(() => { field.focus(); });
    for (let k = 0; k < 3; k++) {
      act(() => { (v.host.querySelector('button') as HTMLButtonElement).click(); });
      expect(document.activeElement).toBe(field);
    }
    v.unmount();
  });
});

/* ======================================================================== *
 * WHAT MUST STILL WORK
 * ======================================================================== */

describe('the dialog still behaves', () => {
  it('takes focus when it opens', () => {
    const Opener: React.FC = () => {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>open</button>
          <ResponsiveDialog open={open} onClose={() => setOpen(false)} title="T">
            <input aria-label="field" />
          </ResponsiveDialog>
        </>
      );
    };
    const v = mount(<Opener />);
    expect(v.host.querySelector('[role="dialog"]')).toBeNull();
    act(() => { (v.host.querySelector('button') as HTMLButtonElement).click(); });
    // The card itself — the focus trap Escape handling and screen readers need.
    const card = v.host.querySelector('[role="dialog"] > div') as HTMLElement;
    expect(document.activeElement).toBe(card);
    v.unmount();
  });

  it('Escape closes it', () => {
    const onClosed = vi.fn();
    const v = mount(<Host onClosed={onClosed} />);
    pressEscape();
    expect(onClosed).toHaveBeenCalledTimes(1);
    v.unmount();
  });

  it('ESCAPE STILL CLOSES IT AFTER THE PARENT HAS RE-RENDERED — no stale handler', () => {
    // The handler now reads through a ref instead of being a dependency, so
    // the risk this swaps in is a listener closed over the FIRST onClose.
    const seen: string[] = [];
    const Outer: React.FC = () => {
      const [open, setOpen] = useState(true);
      const [text, setText] = useState('');
      return (
        <ResponsiveDialog open={open} onClose={() => { setOpen(false); seen.push(text); }} title="T">
          <input aria-label="field" value={text} onChange={e => setText(e.target.value)} />
        </ResponsiveDialog>
      );
    };
    const v = mount(<Outer />);
    const field = v.host.querySelector('[aria-label="field"]') as HTMLInputElement;
    typeChar(field, 'a');
    typeChar(field, 'ab');
    pressEscape();
    // The LATEST closure ran, not the one captured when the dialog opened.
    expect(seen).toEqual(['ab']);
    expect(v.host.querySelector('[role="dialog"]')).toBeNull();
    v.unmount();
  });

  it('the listener is removed when the dialog closes', () => {
    const onClosed = vi.fn();
    const v = mount(<Host onClosed={onClosed} />);
    pressEscape();
    pressEscape();
    pressEscape();
    expect(onClosed).toHaveBeenCalledTimes(1);
    v.unmount();
  });

  it('closing and reopening focuses it again', () => {
    const Reopener: React.FC = () => {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(o => !o)}>toggle</button>
          <ResponsiveDialog open={open} onClose={() => setOpen(false)} title="T"><input aria-label="field" /></ResponsiveDialog>
        </>
      );
    };
    const v = mount(<Reopener />);
    const toggle = v.host.querySelector('button') as HTMLButtonElement;
    act(() => { toggle.click(); });                       // closed
    expect(v.host.querySelector('[role="dialog"]')).toBeNull();
    act(() => { toggle.click(); });                       // open again
    expect(document.activeElement).toBe(v.host.querySelector('[role="dialog"] > div'));
    v.unmount();
  });
});

/* ======================================================================== *
 * THE OTHER COMPONENT WITH THE SAME SHAPE
 * ======================================================================== */

describe('MobileDrawer had the identical defect', () => {
  // Not visibly broken — a nav drawer holds no text field, so nobody saw
  // focus jump — but the same `[open, onClose]` + `.focus()` effect with an
  // inline-arrow caller. Fixed rather than left as a working copy of a bug
  // just removed.
  const noop = () => {};
  const drawer = (onClose: () => void) => (
    <MobileDrawer open onClose={onClose} view="dashboard" onNavigate={noop}
      allow={() => true} userRole="owner" userEmail="owner@shop.test"
      darkMode={false} onToggleTheme={noop} onOpenFinder={noop} onOpenSettings={noop}
      onOpenBulk={noop} onLock={noop} onManualLock={noop} showNotes={false} />
  );

  it('does not re-focus its panel when the parent re-renders', () => {
    const Outer: React.FC = () => {
      const [, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick(t => t + 1)}>tick</button>
          {drawer(() => setTick(t => t))}
        </>
      );
    };
    const v = mount(<Outer />);
    const tick = v.host.querySelector('button') as HTMLButtonElement;
    act(() => { tick.focus(); });
    act(() => { tick.click(); });
    expect(document.activeElement).toBe(tick);
    v.unmount();
  });

  it('still focuses on open, and still closes on Escape', () => {
    const onClose = vi.fn();
    const v = mount(drawer(onClose));
    expect(document.activeElement).not.toBe(document.body);
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
    v.unmount();
  });
});
