import { describe, it, expect } from 'vitest';
import {
  classifyScannedValue, classifyScannedValues, validateExtractedFields, mergeScannedFields,
  ScannedField,
} from './imeiScan';

const VALID_IMEI = '490154203237518'; // real Luhn-valid test IMEI
const INVALID_IMEI = '490154203237519'; // last digit flipped — fails Luhn
const VALID_IMEI_2 = '353626079191032'; // a second, distinct Luhn-valid IMEI

describe('classifyScannedValue', () => {
  it('a 15-digit Luhn-valid value classifies as a verified IMEI1', () => {
    expect(classifyScannedValue(VALID_IMEI)).toEqual({ key: 'imei1', label: 'IMEI1', value: VALID_IMEI, verified: true });
  });

  it('a 15-digit value that fails Luhn is still classified, but unverified — never silently dropped, never silently accepted', () => {
    expect(classifyScannedValue(INVALID_IMEI)).toEqual({ key: 'imei1', label: 'IMEI1', value: INVALID_IMEI, verified: false });
  });

  it('a plausible alphanumeric serial classifies as a verified serial', () => {
    expect(classifyScannedValue('C02ABCD1FVH7')).toEqual({ key: 'serial', label: 'Serial', value: 'C02ABCD1FVH7', verified: true });
  });

  it('junk too short or too long to be a real serial is rejected, not fabricated as one', () => {
    expect(classifyScannedValue('AB')).toBeNull();
    expect(classifyScannedValue('X'.repeat(40))).toBeNull();
  });

  it('punctuation-laden OCR noise is rejected, not surfaced as a fake serial', () => {
    expect(classifyScannedValue('garbage##')).toBeNull();
    expect(classifyScannedValue('http://x.co')).toBeNull();
  });

  it('a plausible-length word with no digits at all is rejected (not everything alphanumeric is a serial)', () => {
    expect(classifyScannedValue('UNLOCKED')).toBeNull();
  });

  it('blank/whitespace input classifies to nothing', () => {
    expect(classifyScannedValue('')).toBeNull();
    expect(classifyScannedValue('   ')).toBeNull();
  });
});

describe('classifyScannedValues (a batch from one capture)', () => {
  it('a box with two barcodes — IMEI and part-number junk — keeps the IMEI and drops the junk, independent of order', () => {
    const out = classifyScannedValues(['##', VALID_IMEI]);
    expect(out).toEqual([{ key: 'imei1', label: 'IMEI1', value: VALID_IMEI, verified: true }]);
  });

  it('a dual-SIM box printing both IMEI barcodes assigns the second distinct valid IMEI to IMEI2, not overwriting IMEI1', () => {
    const out = classifyScannedValues([VALID_IMEI, VALID_IMEI_2]);
    expect(out).toEqual([
      { key: 'imei1', label: 'IMEI1', value: VALID_IMEI, verified: true },
      { key: 'imei2', label: 'IMEI2', value: VALID_IMEI_2, verified: true },
    ]);
  });

  it('IMEI + serial barcodes on the same box both come back, correctly labelled', () => {
    const out = classifyScannedValues([VALID_IMEI, 'C02ABCD1FVH7']);
    expect(out).toEqual([
      { key: 'imei1', label: 'IMEI1', value: VALID_IMEI, verified: true },
      { key: 'serial', label: 'Serial', value: 'C02ABCD1FVH7', verified: true },
    ]);
  });

  it('a duplicate decode of the same barcode is not listed twice', () => {
    const out = classifyScannedValues([VALID_IMEI, VALID_IMEI]);
    expect(out).toHaveLength(1);
  });

  it('a third IMEI-shaped value beyond IMEI1/IMEI2 in one batch is dropped rather than overwriting either slot', () => {
    const thirdImei = '354187048144049'; // another distinct valid test IMEI
    const out = classifyScannedValues([VALID_IMEI, VALID_IMEI_2, thirdImei]);
    expect(out.map(f => f.key)).toEqual(['imei1', 'imei2']);
  });
});

describe('validateExtractedFields (Gemini structured extraction)', () => {
  it('all four fields present and valid come back fully verified', () => {
    const out = validateExtractedFields({ imei1: VALID_IMEI, imei2: VALID_IMEI_2, serial: 'c02abcd1fvh7', eid: '89049032007008882600123456789012' });
    expect(out).toEqual([
      { key: 'imei1', label: 'IMEI1', value: VALID_IMEI, verified: true },
      { key: 'imei2', label: 'IMEI2', value: VALID_IMEI_2, verified: true },
      { key: 'serial', label: 'Serial', value: 'C02ABCD1FVH7', verified: true },
      { key: 'eid', label: 'EID', value: '89049032007008882600123456789012', verified: true },
    ]);
  });

  it('an image with only a serial visible returns just the serial — the other three fields are never fabricated', () => {
    const out = validateExtractedFields({ imei1: null, imei2: undefined, serial: 'C02ABCD1FVH7', eid: '' });
    expect(out).toEqual([{ key: 'serial', label: 'Serial', value: 'C02ABCD1FVH7', verified: true }]);
  });

  it('a Luhn-failing IMEI1 is returned flagged unverified, not silently accepted as good', () => {
    const out = validateExtractedFields({ imei1: INVALID_IMEI });
    expect(out).toEqual([{ key: 'imei1', label: 'IMEI1', value: INVALID_IMEI, verified: false }]);
  });

  it('a fully empty extraction returns no fields at all', () => {
    expect(validateExtractedFields({})).toEqual([]);
    expect(validateExtractedFields({ imei1: '', imei2: null, serial: undefined, eid: '  ' })).toEqual([]);
  });
});

describe('mergeScannedFields (multi-shot / retake)', () => {
  const imei1Field: ScannedField = { key: 'imei1', label: 'IMEI1', value: VALID_IMEI, verified: true };
  const serialField: ScannedField = { key: 'serial', label: 'Serial', value: 'C02ABCD1FVH7', verified: true };

  it('a second shot that finds a different field adds it without losing the first shot\'s field', () => {
    const merged = mergeScannedFields([imei1Field], [serialField]);
    expect(merged).toEqual([imei1Field, serialField]);
  });

  it('a retake of the SAME field overwrites it with the fresh read', () => {
    const retaken: ScannedField = { key: 'imei1', label: 'IMEI1', value: VALID_IMEI_2, verified: true };
    const merged = mergeScannedFields([imei1Field], [retaken]);
    expect(merged).toEqual([retaken]);
  });

  it('an empty incoming capture (nothing found this shot) leaves everything already found untouched', () => {
    const merged = mergeScannedFields([imei1Field, serialField], []);
    expect(merged).toEqual([imei1Field, serialField]);
  });

  it('always renders in a stable imei1/imei2/serial/eid order regardless of discovery order', () => {
    const eidField: ScannedField = { key: 'eid', label: 'EID', value: 'ABC', verified: true };
    const merged = mergeScannedFields([], [eidField, serialField, imei1Field]);
    expect(merged.map(f => f.key)).toEqual(['imei1', 'serial', 'eid']);
  });
});
