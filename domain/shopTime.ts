/**
 * READING AND WRITING TIMES IN THE SHOP'S TIMEZONE, NOT THE DEVICE'S.
 *
 * THE INCIDENT THIS EXISTS FOR. The owner was travelling and read the Time
 * Clock screen on a phone set to Dubai time, eight hours ahead of the shop. A
 * 1:22 PM shift displayed as 9:22 PM, the correction box wanted a Sep 30 value
 * for a Sep 29 shift, and the heading above it said "Sep 29" — three things
 * that look contradictory and were all, individually, correct. Nothing on
 * screen said which zone any of it was in.
 *
 * Every time on that screen came from a bare `toLocaleTimeString()` and every
 * `datetime-local` value from the device's own local fields, so the whole
 * screen silently followed whichever device was being held.
 *
 * WHAT THIS MODULE IS, AND IS NOT. It converts between an instant (epoch ms,
 * which is what is stored and what must stay stored) and the wall-clock
 * reading of that instant in a named IANA zone. It is DISPLAY AND INPUT
 * PARSING ONLY. It computes no hours, no pay and no period boundaries — those
 * stay exactly where they are, in domain/timeclock.ts, untouched.
 *
 * NO DEPENDENCY. `Intl.DateTimeFormat` already knows every zone's rules
 * including historical DST, so pulling in a date library to do this would be
 * adding weight to reimplement what the platform ships.
 *
 * Pure: no DOM, no Firestore, no React.
 */

/** The wall-clock reading of an instant, in some zone. */
export interface ZonedParts {
  year: number;
  month: number;   // 1-12
  day: number;     // 1-31
  hour: number;    // 0-23
  minute: number;
  second: number;
}

/**
 * A zone we can actually format in.
 *
 * A stored setting can be anything — a typo, or a zone this browser has never
 * heard of. Rather than throwing somewhere deep in a render, an unusable zone
 * falls back to the device's own, which is what the screen did before any of
 * this existed. The caller is expected to LABEL what it is showing, so a
 * fallback is visible rather than silent.
 */
export const isUsableZone = (zone: string): boolean => {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
};

export const safeZone = (zone: string | undefined): string | undefined =>
  zone && isUsableZone(zone) ? zone : undefined;

const partsFormatter = (zone: string | undefined): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat('en-CA', {
    ...(zone ? { timeZone: zone } : {}),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

/** What a clock in `zone` reads at this instant. */
export const zonedParts = (ms: number, zone: string | undefined): ZonedParts => {
  const got: Record<string, number> = {};
  for (const p of partsFormatter(safeZone(zone)).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') got[p.type] = Number(p.value);
  }
  return {
    year: got.year, month: got.month, day: got.day,
    // Some engines render midnight as hour 24 under hour12:false.
    hour: got.hour === 24 ? 0 : got.hour,
    minute: got.minute, second: got.second || 0,
  };
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** The calendar date in `zone`, as 'YYYY-MM-DD'. */
export const isoDateInZone = (ms: number, zone: string | undefined): string => {
  const p = zonedParts(ms, zone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
};

/** 'HH:MM' on a 24-hour clock in `zone`. */
export const timeInZone = (ms: number, zone: string | undefined): string => {
  const p = zonedParts(ms, zone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
};

/** The value a `<input type="datetime-local">` needs, as SHOP wall-clock time. */
export const toZonedInput = (ms: number, zone: string | undefined): string =>
  `${isoDateInZone(ms, zone)}T${timeInZone(ms, zone)}`;

/**
 * THE INSTANT AT WHICH A SHOP CLOCK READS THESE WALL-CLOCK FIELDS.
 *
 * The inverse of toZonedInput, and the delicate half of this module: it is
 * what turns what the owner TYPED into what gets stored.
 *
 * `new Date('2026-09-29T13:22')` parses against the DEVICE's zone, which is
 * precisely the bug. So: read the fields as though they were UTC, ask what
 * that instant reads as in the target zone, and the difference is the zone's
 * offset at roughly that moment — subtract it.
 *
 * TWICE, because the offset is itself a function of the instant. A first pass
 * lands within an hour of the answer, which is close enough that the second
 * pass uses the offset actually in force at the real instant. That is what
 * makes the hour either side of a DST change come out right instead of an
 * hour off.
 *
 * An unmatchable wall-clock time — the hour that does not exist on a
 * spring-forward morning — has no instant to map to. It resolves to the
 * reading one hour BEFORE the typed one (02:30 becomes 01:30, still before the
 * jump), which is verified in the tests rather than assumed. It is a finite,
 * sane instant within an hour of what was typed, and it is still subject to
 * the same validation as any other correction; there is no right answer to a
 * time that did not happen, and this one is at least stable.
 */
export const fromZonedInput = (value: string, zone: string | undefined): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec((value || '').trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const z = safeZone(zone);
  if (!z) return new Date(`${value}`).getTime();   // device-local, as before

  const offsetAt = (instant: number): number => {
    const p = zonedParts(instant, z);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
  };

  let guess = asUtc - offsetAt(asUtc);
  guess = asUtc - offsetAt(guess);
  return guess;
};

/* ---------------- Naming the zone on screen ---------------- */

/**
 * A short human name for a zone — "Toronto" from "America/Toronto".
 *
 * The city, not the abbreviation: "EST" is ambiguous (so is IST, and CST names
 * three different zones), and the person reading this is trying to work out
 * whose clock they are looking at, not to do arithmetic with an offset.
 */
export const zoneCity = (zone: string | undefined): string => {
  const z = safeZone(zone);
  if (!z) return 'this device';
  const last = z.split('/').pop() || z;
  return last.replace(/_/g, ' ');
};

/**
 * The line that goes on the screen, e.g. "all times in shop time — Toronto".
 *
 * Shown ALWAYS, not only when the device disagrees. A label that appears only
 * when something is wrong is a label nobody learns to look for, and the owner
 * standing in the shop should see the same words as the owner in Dubai.
 */
export const shopTimeNote = (zone: string | undefined): string =>
  safeZone(zone)
    ? `all times in shop time — ${zoneCity(zone)}`
    : 'all times in this device\'s timezone — no shop timezone is set';

/**
 * Does this device's clock currently disagree with the shop's?
 *
 * Used to decide whether to spell the difference out more loudly. Compares the
 * two offsets at a given instant rather than the zone names, since
 * America/Toronto and America/New_York are different names for the same
 * reading and there is nothing to warn about there.
 */
export const deviceDiffersFromShop = (ms: number, zone: string | undefined): boolean => {
  const z = safeZone(zone);
  if (!z) return false;
  return toZonedInput(ms, z) !== toZonedInput(ms, undefined);
};
