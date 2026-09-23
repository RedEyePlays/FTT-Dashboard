import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  BLOCKED_FRAGMENTS, CODE_SPACE, CONSONANTS, CUSTOM_CODE_MAX, CUSTOM_CODE_MIN,
  MAX_CODE_ATTEMPTS, SHARE_CODE_LENGTH, VOWELS,
  isCleanCode, isShareCode, newShareCode, rawShareCode, validateCustomCode,
} from './shareCode';

afterEach(() => { vi.unstubAllGlobals(); });

describe('the alphabet', () => {
  it('excludes every character that gets misread off a screen', () => {
    const all = CONSONANTS + VOWELS;
    for (const bad of ['l', 'i', 'o', 'q', 'x', 'y']) {
      expect({ bad, present: all.includes(bad) }).toEqual({ bad, present: false });
    }
  });

  it('is lowercase letters only — no digits, no shift key, no case to get wrong', () => {
    expect(CONSONANTS + VOWELS).toMatch(/^[a-z]+$/);
  });

  it('has no character in both lists', () => {
    expect([...CONSONANTS].some(c => VOWELS.includes(c))).toBe(false);
  });
});

describe('generated codes', () => {
  it('are eight letters, strictly alternating consonant and vowel', () => {
    for (let i = 0; i < 200; i++) {
      const code = rawShareCode();
      expect(code).toHaveLength(SHARE_CODE_LENGTH);
      expect(isShareCode(code)).toBe(true);
      for (let j = 0; j < code.length; j++) {
        const set = j % 2 === 0 ? CONSONANTS : VOWELS;
        expect({ j, ok: set.includes(code[j]) }).toEqual({ j, ok: true });
      }
    }
  });

  it('use every symbol in both alphabets over enough draws — no modulo bias shutting one out', () => {
    // Rejection sampling keeps the distribution flat. `byte % 17` would still
    // produce every symbol, so this is a smoke test, not a proof; the real
    // guarantee is the discard in pick(). What it WOULD catch is an off-by-one
    // that made the last consonant unreachable.
    const seen = new Set<string>();
    for (let i = 0; i < 4000; i++) for (const ch of rawShareCode()) seen.add(ch);
    for (const ch of CONSONANTS + VOWELS) {
      expect({ ch, seen: seen.has(ch) }).toEqual({ ch, seen: true });
    }
  });

  it('THROWS rather than falling back to Math.random when there is no secure source', () => {
    vi.stubGlobal('crypto', undefined);
    expect(() => rawShareCode()).toThrow(/secure random/i);
    vi.stubGlobal('crypto', {});
    expect(() => rawShareCode()).toThrow(/secure random/i);
  });

  it('discards a blocked candidate and draws again', () => {
    // Alternating syllables land on real words by accident — that is the point
    // of them — and these go into public adverts under the shop's name.
    const dirty = 'fukubaze';
    expect(isCleanCode(dirty)).toBe(false);
    expect(BLOCKED_FRAGMENTS.some(f => dirty.includes(f))).toBe(true);

    const queue = [dirty, dirty, 'kadamuze'];
    let i = 0;
    expect(newShareCode(() => false, () => queue[Math.min(i++, queue.length - 1)])).toBe('kadamuze');
    expect(i).toBe(3);   // both dirty candidates were thrown away, not cleaned up
  });

  it('gives up rather than handing out a blocked code when every draw is dirty', () => {
    expect(() => newShareCode(() => false, () => 'fukubaze')).toThrow(/unique link code/i);
  });

  it('skips a code already in use and returns a free one', () => {
    const taken = new Set<string>();
    const first = newShareCode();
    taken.add(first);
    const second = newShareCode(c => taken.has(c));
    expect(second).not.toBe(first);
    expect(isShareCode(second)).toBe(true);
  });

  it('gives up with a real error rather than reusing a code', () => {
    // Everything is taken. It must not hand back a duplicate, and it must not
    // loop forever — two adverts pointing at one machine is the failure here.
    expect(() => newShareCode(() => true)).toThrow(/unique link code/i);
    expect(MAX_CODE_ATTEMPTS).toBeGreaterThan(1);
  });
});

describe('isShareCode', () => {
  it('accepts a well-formed code', () => {
    expect(isShareCode('kodamuze'.replace('o', 'a'))).toBe(true);   // 'kadamuze'
  });

  it('rejects the wrong length, the wrong pattern, and the excluded letters', () => {
    expect(isShareCode('kadamuz')).toBe(false);        // 7
    expect(isShareCode('kadamuzeb')).toBe(false);      // 9
    expect(isShareCode('akdamuze')).toBe(false);       // starts on a vowel
    expect(isShareCode('kodamuze')).toBe(false);       // contains o
    expect(isShareCode('kidamuze')).toBe(false);       // contains i
    expect(isShareCode('kadamuz3')).toBe(false);       // a digit
    expect(isShareCode('KADAMUZE')).toBe(false);       // uppercase
    expect(isShareCode(12345678)).toBe(false);
    expect(isShareCode(undefined)).toBe(false);
  });
});

describe('the code space', () => {
  it('is stated honestly — 17⁴ × 3⁴, not "20 to the eighth"', () => {
    expect(CODE_SPACE).toBe(Math.pow(17, 4) * Math.pow(3, 4));
    expect(CODE_SPACE).toBe(6_765_201);
  });

  it('is still far beyond sweeping a throttled endpoint', () => {
    // At a generous one guess per second from one address — far faster than
    // the lookup's throttle allows — covering the space once takes months.
    const daysAtOnePerSecond = CODE_SPACE / 86_400;
    expect(daysAtOnePerSecond).toBeGreaterThan(75);
  });
});

describe('a custom code the owner types', () => {
  it('accepts a real word that is not a generated shape', () => {
    // "reaper" is not consonant-vowel alternating, and that is the point: a
    // word somebody chose is readable by definition.
    expect(validateCustomCode('reaper')).toEqual({ ok: true, code: 'reaper' });
    expect(isShareCode('reaper')).toBe(false);
  });

  it('trims and lowercases before checking', () => {
    expect(validateCustomCode('  REAPER ')).toEqual({ ok: true, code: 'reaper' });
  });

  it('rejects an empty code, the excluded letters, digits and punctuation', () => {
    expect(validateCustomCode('   ')).toEqual({ ok: false, error: 'empty' });
    expect(validateCustomCode('reaper1')).toEqual({ ok: false, error: 'charset' });
    expect(validateCustomCode('rea-per')).toEqual({ ok: false, error: 'charset' });
    expect(validateCustomCode('reaplier')).toEqual({ ok: false, error: 'charset' });  // l
    expect(validateCustomCode('proxy')).toEqual({ ok: false, error: 'charset' });     // x, y
  });

  it('rejects one that is too short or too long', () => {
    expect(validateCustomCode('ab')).toEqual({ ok: false, error: 'length' });
    expect(validateCustomCode('a'.repeat(CUSTOM_CODE_MAX + 1))).toEqual({ ok: false, error: 'length' });
    expect(validateCustomCode('a'.repeat(CUSTOM_CODE_MIN)).ok).toBe(true);
  });

  it('applies the blocklist to the owner’s own typing too', () => {
    expect(validateCustomCode('superfuk')).toEqual({ ok: false, error: 'blocked' });
  });

  it('says plainly when the code is taken, rather than silently renaming it', () => {
    expect(validateCustomCode('reaper', c => c === 'reaper')).toEqual({ ok: false, error: 'taken' });
  });
});
