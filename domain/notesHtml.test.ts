// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { markdownToHtml, htmlToMarkdown, markdownAccelerator, sanitizeNoteHtml } from './notesHtml';
import { parseNoteBlocks, checklistProgress } from './notes';

// The editor's whole safety property is that markdown survives a trip through
// the contentEditable DOM unchanged. Everything else in the app still reads the
// stored markdown (checklist badge, LinkedNotes, search, checklist toggle), so a
// lossy round-trip would silently corrupt real business notes.
const el = (html: string): Element => {
  const d = document.createElement('div');
  d.innerHTML = html;
  return d;
};
const roundTrip = (md: string): string => htmlToMarkdown(el(markdownToHtml(md)));

describe('markdownToHtml', () => {
  it('renders headings as real heading elements', () => {
    const html = markdownToHtml('# Big\n## Med\n### Small');
    expect(html).toContain('<h1');
    expect(html).toContain('<h2');
    expect(html).toContain('<h3');
    expect(html).toContain('Big');
  });

  it('renders bold as <strong>, never as visible ** syntax', () => {
    const html = markdownToHtml('order **12** screens');
    expect(html).toContain('<strong>12</strong>');
    expect(html).not.toContain('**');
  });

  it('renders a checkbox widget carrying its checked state', () => {
    const html = markdownToHtml('[x] done\n[] todo');
    expect(html).toContain('data-checked="1"');
    expect(html).toContain('data-checked="0"');
    expect(html).toContain('aria-checked="true"');
  });

  it('escapes HTML in note text so a pasted tag is never executed', () => {
    const html = markdownToHtml('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('gives an empty line a caret target instead of collapsing it', () => {
    expect(markdownToHtml('a\n\nb')).toContain('<br>');
  });
});

describe('sanitizeNoteHtml: allowlist defense-in-depth against stored XSS', () => {
  // Notes are shared across staff — whatever this produces runs in a
  // manager's/owner's session the moment their board loads. markdownToHtml
  // already escapes text into entities, so these payloads can't occur from
  // normal use; this pins down the independent second layer (sanitizeNoteHtml
  // itself, and that markdownToHtml actually calls it) so a future bug in the
  // generator — a new block kind that forgets to escape, a template typo —
  // doesn't become a live stored-XSS hole.
  it('markdownToHtml output never PARSES into a real dangerous element or a live event-handler attribute', () => {
    // Typed as plain note text, this content is only ever escaped into inert
    // entities (e.g. "onerror" surviving as the literal, visible WORD
    // "onerror" inside escaped text — `&lt;img ... onerror=...&gt;` — is
    // correct and safe; it's not a live attribute). The real property under
    // test is what happens when this string is actually parsed as HTML: no
    // element the browser would treat as a tag, no attribute it would treat
    // as an event handler.
    const payloads = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '<a href="javascript:alert(1)">click</a>',
      '<div onclick="alert(1)">x</div>',
      '<iframe src="javascript:alert(1)"></iframe>',
      '<style>body{background:url(javascript:alert(1))}</style>',
    ];
    for (const p of payloads) {
      const parsed = el(markdownToHtml(p));
      expect(parsed.querySelector('script, iframe, object, embed, style, svg, img, a')).toBeNull();
      for (const node of Array.from(parsed.querySelectorAll('*'))) {
        for (const attr of Array.from(node.attributes)) {
          expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
          expect((attr.value || '').toLowerCase()).not.toContain('javascript:');
        }
      }
    }
  });

  it('a crafted note renders inert when actually inserted into a live DOM — no script element, no handler attributes anywhere in the subtree', () => {
    const md = [
      '# Report <script>window.__pwned = true</script>',
      '[x] done <img src=x onerror="window.__pwned = true">',
      'plain <svg/onload=alert(1)> text',
    ].join('\n');
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = markdownToHtml(md);

    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('iframe, object, embed, style, link, meta')).toBeNull();
    const all = host.querySelectorAll('*');
    for (const node of Array.from(all)) {
      for (const attr of Array.from(node.attributes)) {
        expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
      }
    }
    expect((window as any).__pwned).toBeUndefined();
    host.remove();
  });

  it('strips a wrapper tag the editor never emits while keeping its legitimate text', () => {
    // Something outside this editor's own output shape (a hand-edited
    // Firestore doc, a future code path) — the element is discarded, the
    // text inside it survives.
    const out = sanitizeNoteHtml('<div data-nb="text"><font color="red">hello</font> world</div>');
    expect(out).not.toContain('<font');
    expect(out).toContain('hello');
    expect(out).toContain('world');
  });

  it('drops attributes not on the allowlist for a tag this editor does emit', () => {
    const out = sanitizeNoteHtml('<div data-nb="text" onclick="alert(1)" style="color:red">hi</div>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('style');
    expect(out).toContain('data-nb="text"');
    expect(out).toContain('hi');
  });

  it('is safe to call on a string that never came from markdownToHtml at all', () => {
    expect(sanitizeNoteHtml('<script>alert(1)</script>ignored')).not.toContain('<script');
    expect(sanitizeNoteHtml('')).toBe('');
  });
});

describe('round-trip: markdown -> HTML -> markdown', () => {
  it('preserves a realistic parts-order note exactly', () => {
    const md = [
      '# Parts order',
      '[x] iPhone 14 OLED',
      '[ ] Pixel 7 digitizer',
      '## Batteries',
      '- generic cells',
      'plain note line with **bold** in it',
    ].join('\n');
    expect(roundTrip(md)).toBe(md);
  });

  it('preserves each block kind on its own', () => {
    for (const md of ['# H1', '## H2', '### H3', '- bullet', '[ ] todo', '[x] done', 'plain']) {
      expect(roundTrip(md)).toBe(md);
    }
  });

  it('preserves interior blank lines (deliberate spacing)', () => {
    expect(roundTrip('a\n\nb')).toBe('a\n\nb');
  });

  it('preserves bold mid-sentence and multiple bold runs', () => {
    expect(roundTrip('a **b** c **d**')).toBe('a **b** c **d**');
  });

  it('preserves an empty checkbox with no label', () => {
    expect(roundTrip('[ ]')).toBe('[ ]');
  });

  it('normalises the bare "[]" legacy form to "[ ]" but keeps it a checkbox', () => {
    // Both forms parse identically (domain/notes.ts's CHECK_RE), so the stored
    // text may normalise — what must not change is that it stays an unchecked
    // checkbox with the same label.
    const out = roundTrip('[] todo');
    expect(parseNoteBlocks(out)[0]).toMatchObject({ kind: 'check', text: 'todo', checked: false });
  });

  it('keeps checklist progress stable across a round-trip', () => {
    const md = '# List\n[x] a\n[ ] b\n[x] c';
    expect(checklistProgress(roundTrip(md))).toEqual(checklistProgress(md));
  });

  it('survives an empty note', () => {
    expect(roundTrip('')).toBe('');
  });

  it('does not let a checkbox widget leak into the text', () => {
    expect(roundTrip('[x] screens')).toBe('[x] screens');
    expect(roundTrip('- bullet')).not.toContain('•');
  });
});

describe('htmlToMarkdown: DOM shapes the browser produces on its own', () => {
  it('treats a bare <div> (Enter-split line) as a plain line', () => {
    expect(htmlToMarkdown(el('<div>one</div><div>two</div>'))).toBe('one\ntwo');
  });

  it('treats bare heading tags as headings even without our data attribute', () => {
    expect(htmlToMarkdown(el('<h1>Title</h1><h2>Sub</h2>'))).toBe('# Title\n## Sub');
  });

  it('reads <b> as bold, not just <strong>', () => {
    expect(htmlToMarkdown(el('<div>a <b>bold</b></div>'))).toBe('a **bold**');
  });

  it('does not double-wrap nested bold elements', () => {
    expect(htmlToMarkdown(el('<div><b><strong>x</strong></b></div>'))).toBe('**x**');
  });

  it('converts the non-breaking spaces contentEditable inserts back to spaces', () => {
    expect(htmlToMarkdown(el('<div>a&nbsp;b</div>'))).toBe('a b');
  });

  it('handles a top-level text node (some browsers do this for the first line)', () => {
    expect(htmlToMarkdown(el('first<div>second</div>'))).toBe('first\nsecond');
  });

  it('drops trailing blank lines the browser leaves behind', () => {
    expect(htmlToMarkdown(el('<div>a</div><div><br></div><div><br></div>'))).toBe('a');
  });

  it('returns empty string for a null root rather than throwing', () => {
    expect(htmlToMarkdown(null)).toBe('');
  });

  it('ignores an unchecked box widget but keeps its state attribute', () => {
    const html = '<div data-nb="check" data-checked="1"><span class="nb-check" contenteditable="false"></span><span class="nb-text">done</span></div>';
    expect(htmlToMarkdown(el(html))).toBe('[x] done');
  });
});

describe('markdownAccelerator', () => {
  it('recognises heading prefixes as soon as the space is typed', () => {
    expect(markdownAccelerator('# ')).toMatchObject({ kind: 'h1', strip: 2 });
    expect(markdownAccelerator('## ')).toMatchObject({ kind: 'h2', strip: 3 });
    expect(markdownAccelerator('### ')).toMatchObject({ kind: 'h3', strip: 4 });
  });

  it('recognises the checkbox and bullet prefixes people actually type', () => {
    expect(markdownAccelerator('[] ')).toMatchObject({ kind: 'check', checked: false });
    expect(markdownAccelerator('[x] ')).toMatchObject({ kind: 'check', checked: true });
    expect(markdownAccelerator('- ')).toMatchObject({ kind: 'bullet' });
    expect(markdownAccelerator('* ')).toMatchObject({ kind: 'bullet' });
  });

  it('also fires on the non-breaking space contentEditable may insert', () => {
    expect(markdownAccelerator('# ')).toMatchObject({ kind: 'h1' });
  });

  it('does not fire mid-line or on a prefix without its trailing space', () => {
    expect(markdownAccelerator('#')).toBeNull();
    expect(markdownAccelerator('a # ')).toBeNull();
    expect(markdownAccelerator('#hashtag')).toBeNull();
    expect(markdownAccelerator('#### ')).toBeNull(); // only h1–h3 exist
  });

  it('does not fire once the line already has content after the prefix', () => {
    expect(markdownAccelerator('# Title')).toBeNull();
  });
});
