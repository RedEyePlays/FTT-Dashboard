import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  codeFromShareInput, isShareRef, shareAdLine, shareLinkDisplay, shareLinkUrl, shareRefFormat,
} from './shareLink';
import { SHARE_LINK_HOST } from './statusLink';

const CODE = 'kadamuze';
const LONG_TOKEN = 'b7k2m9qrstvwxyz34567bcdfgh';   // 26, the old format

describe('the advertised link', () => {
  it('is short, on the configured host, with no scheme to type', () => {
    expect(shareLinkDisplay(CODE)).toBe(`${SHARE_LINK_HOST}/b/${CODE}`);
    expect(shareLinkDisplay(CODE)).not.toMatch(/https?:/);
  });

  it('is a real URL when it needs to be clickable or scannable', () => {
    expect(shareLinkUrl(CODE)).toBe(`https://${SHARE_LINK_HOST}/b/${CODE}`);
  });

  it('takes the host from config, so switching it moves every link at once', () => {
    expect(shareLinkUrl(CODE, 'status.flipthat.tech')).toBe(`https://status.flipthat.tech/b/${CODE}`);
  });

  it('says what is on the other side, because the link is not clickable', () => {
    expect(shareAdLine(CODE)).toBe(`Full specs and photos: ${SHARE_LINK_HOST}/b/${CODE}`);
  });
});

describe('codeFromShareInput', () => {
  it('reads a bare code', () => {
    expect(codeFromShareInput(CODE)).toBe(CODE);
    expect(codeFromShareInput('  KADAMUZE ')).toBe(CODE);
  });

  it('reads the short link with or without a scheme, host or www', () => {
    for (const input of [
      `/b/${CODE}`,
      `flipthat.tech/b/${CODE}`,
      `https://flipthat.tech/b/${CODE}`,
      `http://www.flipthat.tech/b/${CODE}`,
      `https://www.flipthat.tech/b/${CODE}/`,
      `https://status.flipthat.tech/b/${CODE}?utm=fb`,
    ]) {
      expect({ input, code: codeFromShareInput(input) }).toEqual({ input, code: CODE });
    }
  });

  it('still reads an OLD /build/<token> link — those are in live adverts', () => {
    expect(codeFromShareInput(`https://status.flipthat.tech/build/${LONG_TOKEN}`)).toBe(LONG_TOKEN);
    expect(codeFromShareInput(`/build/${LONG_TOKEN}`)).toBe(LONG_TOKEN);
  });

  it('refuses a hostname or a path that carries no code', () => {
    expect(codeFromShareInput('flipthat.tech')).toBeNull();
    expect(codeFromShareInput('https://flipthat.tech/')).toBeNull();
    expect(codeFromShareInput('')).toBeNull();
    expect(codeFromShareInput('   ')).toBeNull();
  });
});

describe('shareRefFormat', () => {
  it('tells the two minted formats apart, and accepts a custom word', () => {
    expect(shareRefFormat(CODE)).toBe('code');
    expect(shareRefFormat(LONG_TOKEN)).toBe('token');
    expect(shareRefFormat('reaper')).toBe('custom');
  });

  it('rejects what could not be either', () => {
    expect(shareRefFormat('')).toBe('invalid');
    expect(shareRefFormat('ab')).toBe('invalid');           // too short for anything
    expect(shareRefFormat('Reaper')).toBe('invalid');       // uppercase
    expect(shareRefFormat('rea per')).toBe('invalid');
    expect(shareRefFormat(42)).toBe('invalid');
    expect(shareRefFormat(undefined)).toBe('invalid');
  });

  it('accepts BOTH formats through the one shape check — old links keep working', () => {
    expect(isShareRef(CODE)).toBe(true);
    expect(isShareRef(LONG_TOKEN)).toBe(true);
    expect(isShareRef('reaper')).toBe(true);
    expect(isShareRef('!!')).toBe(false);
  });
});

/**
 * OLD LINKS MUST GO ON WORKING.
 *
 * The share reference format changed; the adverts already posted did not. The
 * shape filter is written in three places that must agree — this module, the
 * public page's router and the callable — so it is asserted against the actual
 * source of the other two rather than described in a comment.
 */
describe('both formats pass the same shape filter, everywhere', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it('the callable accepts 4–64 lowercase alphanumeric, which covers both', () => {
    const src = read('functions/src/buildLookup.ts');
    expect(src).toMatch(/token\.length < 4 \|\| token\.length > 64/);
    expect(src).toMatch(/\/\^\[a-z0-9\]\+\$\//);
    // The OLD bound would have rejected every new code outright.
    expect(src).not.toMatch(/token\.length < 22/);
  });

  it('the public page routes BOTH /b/<code> and /build/<token>', () => {
    const src = read('status-page/src/main.ts');
    expect(src).toMatch(/tokenFromPath\(path, 'b', 'build'\)/);
    expect(src).toMatch(/\{4,64\}/);
  });

  it('a 26-character token and an 8-letter code both satisfy this module', () => {
    expect(isShareRef(LONG_TOKEN)).toBe(true);
    expect(isShareRef(CODE)).toBe(true);
    expect(LONG_TOKEN).toMatch(/^[a-z0-9]{22,64}$/);
    expect(CODE).toMatch(/^[a-z0-9]{4,64}$/);
  });
});
